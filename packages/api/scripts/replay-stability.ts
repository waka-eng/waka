/**
 * Phase 1 of docs/goals/durable-interest.md — the replay harness.
 *
 * Held-out forward replay on real archives, two criteria:
 *
 *   v1 (the goal's original gate): monthly cuts T, label = node receives
 *      NEW EVIDENCE (a fresh signal citing it) in (T, T+28] / (T, T+90].
 *   v2 (founder-approved 2026-08-09, recorded in the goal Log): weekly
 *      cuts, label = node receives a GRADED RETURN — a graded revisit
 *      event on a signal the node already cited by T — in (T, T+7] /
 *      (T, T+14]. Return labels have class balance on a young archive
 *      (revisits are continuous where evidence is bursty); they measure
 *      "will you come back to this theme," a weaker cousin of "survives
 *      the novelty." v2 runs beside v1, never instead of it.
 *
 * Every node with ≥ 2 prior capture events is scored using ONLY data ≤ T.
 * Predictors are ranked by pooled AUC across cuts; the champion of
 * {S, E[R]} gets a seeded-bootstrap ΔAUC 95% CI against both gate
 * baselines (recency null, currentWeight).
 *
 * Predictors:
 *   recency        − days since last evidence (the null)
 *   currentWeight  the shipped arithmetic, via the production
 *                  deriveMemoryPattern() on a node reconstructed as of T
 *   movementScore  same call
 *   meanSignalImp  mean stored importance_score of citing signals (note:
 *                  stored values are TODAY's — leakage that favors this
 *                  baseline, accepted because the gate only needs the new
 *                  state to beat it)
 *   S              storage strength, replayed from events ≤ T
 *   E[R]           mean retrievability across the label window
 *
 * Pure DB reads (SELECT only) and math. Zero model calls, zero cost.
 * Deterministic: bootstrap uses a fixed-seed PRNG.
 *
 * Run:
 *   WAKA_API_DOTENV_PATH=/path/to/.env.local \
 *     pnpm --filter @waka/api exec tsx scripts/replay-stability.ts
 */

import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import postgres from "postgres";

import {
  evidenceGrade,
  meanRetrievabilityOverWindow,
  replayStability,
  stabilityGradeForEvent,
  type StabilityEvent,
  type StabilityGradeEvent,
} from "../src/scoring/stability.js";
import { deriveMemoryPattern } from "../src/lib/memory-movement.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_PRIOR_EVENTS = 2;
const BOOTSTRAP_RESAMPLES = 1000;
const BOOTSTRAP_SEED = 42;

/** Revisit event types that grade a return (capture_saved never counts). */
const GRADED_REVISIT_TYPES = [
  "detail_opened",
  "detail_returned",
  "reflection_created",
  "inspiration_updated",
] as const;

const dotenvPath =
  process.env.WAKA_API_DOTENV_PATH ?? resolve(process.cwd(), "../../.env.local");
loadDotenv({ path: dotenvPath });

const connectionUrl =
  process.env.DB_CONNECTION_URL ?? process.env.DATABASE_URL;
if (!connectionUrl) {
  console.error(`No DB_CONNECTION_URL in ${dotenvPath}`);
  process.exit(1);
}

const sql = postgres(connectionUrl, { max: 1, prepare: false });

interface EvidenceRow {
  nodeId: string;
  signalId: string;
  weight: number;
  confidence: number;
  createdAt: Date;
}

interface RevisitRow {
  signalId: string;
  eventType: StabilityGradeEvent;
  createdAt: Date;
}

interface NodeMeta {
  id: string;
  type: string;
}

/** Deterministic PRNG so bootstrap CIs are identical across reruns. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mann-Whitney AUC with average ranks for ties. */
function auc(pairs: Array<{ score: number; label: boolean }>): number | null {
  const positives = pairs.filter((p) => p.label).length;
  const negatives = pairs.length - positives;
  if (positives === 0 || negatives === 0) return null;
  const sorted = [...pairs].sort((a, b) => a.score - b.score);
  let rank = 1;
  let positiveRankSum = 0;
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1].score === sorted[i].score) j += 1;
    const averageRank = (rank + rank + (j - i)) / 2;
    for (let k = i; k <= j; k += 1) {
      if (sorted[k].label) positiveRankSum += averageRank;
    }
    rank += j - i + 1;
    i = j + 1;
  }
  return (
    (positiveRankSum - (positives * (positives + 1)) / 2) /
    (positives * negatives)
  );
}

function monthlyCuts(first: Date, last: Date): Date[] {
  const cuts: Date[] = [];
  const cursor = new Date(
    Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1),
  );
  while (cursor.getTime() <= last.getTime()) {
    cuts.push(new Date(cursor.getTime()));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return cuts;
}

function weeklyCuts(first: Date, last: Date): Date[] {
  const cuts: Date[] = [];
  const startOfDay = Date.UTC(
    first.getUTCFullYear(),
    first.getUTCMonth(),
    first.getUTCDate(),
  );
  for (let t = startOfDay + 7 * DAY_MS; t <= last.getTime(); t += 7 * DAY_MS) {
    cuts.push(new Date(t));
  }
  return cuts;
}

interface ScoredPair {
  cut: Date;
  nodeId: string;
  scores: Record<string, number>;
  labels: Record<number, boolean>;
}

async function evaluateUser(userId: string, label: string): Promise<void> {
  const evidence = (await sql`
    SELECT context_node_id AS node_id, signal_id, weight, confidence, created_at
    FROM context_evidence WHERE user_id = ${userId} ORDER BY created_at ASC
  `).map(
    (row): EvidenceRow => ({
      nodeId: row.node_id as string,
      signalId: row.signal_id as string,
      weight: Number(row.weight),
      confidence: Number(row.confidence),
      createdAt: new Date(row.created_at as string),
    }),
  );

  const revisits = (await sql`
    SELECT signal_id, event_type, created_at
    FROM signal_revisit_events
    WHERE user_id = ${userId}
      AND event_type::text = ANY(${sql.array([...GRADED_REVISIT_TYPES])})
    ORDER BY created_at ASC
  `).map(
    (row): RevisitRow => ({
      signalId: row.signal_id as string,
      eventType: row.event_type as StabilityGradeEvent,
      createdAt: new Date(row.created_at as string),
    }),
  );

  const nodes = new Map<string, NodeMeta>();
  for (const row of await sql`
    SELECT id, type FROM context_nodes WHERE user_id = ${userId}
  `) {
    nodes.set(row.id as string, { id: row.id as string, type: row.type as string });
  }

  const signalImportance = new Map<string, number>();
  for (const row of await sql`
    SELECT id, importance_score FROM signals WHERE user_id = ${userId}
  `) {
    signalImportance.set(row.id as string, Number(row.importance_score));
  }

  if (evidence.length === 0) {
    console.log(`\n=== ${label}: no evidence rows — skipped ===`);
    return;
  }

  const evidenceByNode = new Map<string, EvidenceRow[]>();
  for (const row of evidence) {
    const rows = evidenceByNode.get(row.nodeId) ?? [];
    rows.push(row);
    evidenceByNode.set(row.nodeId, rows);
  }
  const revisitsBySignal = new Map<string, RevisitRow[]>();
  for (const row of revisits) {
    const rows = revisitsBySignal.get(row.signalId) ?? [];
    rows.push(row);
    revisitsBySignal.set(row.signalId, rows);
  }

  const firstEvidenceAt = evidence[0].createdAt;
  const lastEvidenceAt = evidence[evidence.length - 1].createdAt;
  const lastRevisitAt =
    revisits.length > 0 ? revisits[revisits.length - 1].createdAt : firstEvidenceAt;
  const lastActivityAt = new Date(
    Math.max(lastEvidenceAt.getTime(), lastRevisitAt.getTime()),
  );

  console.log(`\n=== ${label} ===`);
  console.log(
    `evidence rows: ${evidence.length}  graded revisits: ${revisits.length}  ` +
      `nodes: ${evidenceByNode.size}  span: ${firstEvidenceAt.toISOString().slice(0, 10)} → ` +
      `${lastActivityAt.toISOString().slice(0, 10)}`,
  );
  const byMonth = new Map<string, number>();
  for (const row of evidence) {
    const key = row.createdAt.toISOString().slice(0, 7);
    byMonth.set(key, (byMonth.get(key) ?? 0) + 1);
  }
  console.log(
    "evidence by month: " +
      [...byMonth.entries()].map(([month, count]) => `${month}=${count}`).join("  "),
  );

  /**
   * All predictors for one (node, cut), from data ≤ T only.
   * Returns null when the node is not yet eligible at T.
   */
  function computeScores(
    nodeId: string,
    cutMs: number,
    horizons: readonly number[],
  ): Record<string, number> | null {
    const nodeEvidence = evidenceByNode.get(nodeId)!;
    const prior = nodeEvidence.filter((row) => row.createdAt.getTime() <= cutMs);
    if (prior.length < MIN_PRIOR_EVENTS) return null;
    const meta = nodes.get(nodeId);
    if (!meta) return null;

    const lastAt = prior[prior.length - 1].createdAt;
    const daysSinceLast = (cutMs - lastAt.getTime()) / DAY_MS;

    // Baseline: the shipped arithmetic, reconstructed as of T. node.weight
    // is sum(evidence.weight), confidence is max(confidence) — exactly the
    // aggregates meaning-graph-writer maintains after every insert. Status
    // transitions are unlogged, so contradiction never fires here.
    const pattern = deriveMemoryPattern({
      node: {
        id: nodeId,
        type: meta.type,
        weight: prior.reduce((sum, row) => sum + row.weight, 0),
        confidence: prior.reduce((max, row) => Math.max(max, row.confidence), 0),
        evidenceCount: prior.length,
        firstSeenAt: prior[0].createdAt,
        lastReinforcedAt: lastAt,
      },
      evidence: prior.map((row) => ({
        meaningNodeId: row.nodeId,
        inspirationId: row.signalId,
        createdAt: row.createdAt,
        weight: row.weight,
      })),
      now: new Date(cutMs),
    });

    // The new state: replay evidence + graded returns, day-collapsed.
    const events: StabilityEvent[] = prior.map((row) => ({
      at: row.createdAt,
      // contentDepth is not persisted anywhere in the schema, so every
      // evidence event grades at depth 0.5 ⇒ q = 0.775 (recorded in Log).
      grade: evidenceGrade(0.5),
    }));
    for (const row of prior) {
      for (const revisit of revisitsBySignal.get(row.signalId) ?? []) {
        const at = revisit.createdAt.getTime();
        // A return charges the node only if the citation already existed,
        // and only with data from before the cut.
        if (at > cutMs || at < row.createdAt.getTime()) continue;
        events.push({
          at: revisit.createdAt,
          grade: stabilityGradeForEvent(revisit.eventType),
        });
      }
    }
    const replay = replayStability(events);
    const stability = replay.state?.stability ?? 0;
    const gapDays = replay.state
      ? (cutMs - replay.state.lastEventAt.getTime()) / DAY_MS
      : daysSinceLast;

    const importances = prior
      .map((row) => signalImportance.get(row.signalId))
      .filter((value): value is number => value !== undefined);

    const scores: Record<string, number> = {
      recency: -daysSinceLast,
      currentWeight: pattern.currentWeight,
      movementScore: pattern.movementScore,
      meanSignalImp:
        importances.length > 0
          ? importances.reduce((a, b) => a + b, 0) / importances.length
          : 0,
      S: stability,
    };
    for (const horizon of horizons) {
      scores[`ER${horizon}`] = meanRetrievabilityOverWindow(
        stability,
        gapDays,
        horizon,
      );
    }
    return scores;
  }

  /** v1 label: a fresh signal cites the node inside the window. */
  function evidenceLabel(nodeId: string, cutMs: number, horizonDays: number): boolean {
    return evidenceByNode.get(nodeId)!.some((row) => {
      const at = row.createdAt.getTime();
      return at > cutMs && at <= cutMs + horizonDays * DAY_MS;
    });
  }

  /**
   * v2 label: a graded revisit lands inside the window on a signal the
   * node had already cited by T.
   */
  function returnLabel(nodeId: string, cutMs: number, horizonDays: number): boolean {
    const windowEnd = cutMs + horizonDays * DAY_MS;
    return evidenceByNode.get(nodeId)!.some((row) => {
      if (row.createdAt.getTime() > cutMs) return false;
      return (revisitsBySignal.get(row.signalId) ?? []).some((revisit) => {
        const at = revisit.createdAt.getTime();
        return at > cutMs && at <= windowEnd;
      });
    });
  }

  function runCriterion(input: {
    tag: string;
    cuts: Date[];
    horizons: readonly number[];
    labelFn: (nodeId: string, cutMs: number, horizonDays: number) => boolean;
    observableUntil: Date;
  }): void {
    const pairs: ScoredPair[] = [];
    for (const cut of input.cuts) {
      const cutMs = cut.getTime();
      for (const nodeId of evidenceByNode.keys()) {
        const scores = computeScores(nodeId, cutMs, input.horizons);
        if (!scores) continue;
        const labels: Record<number, boolean> = {};
        for (const horizon of input.horizons) {
          labels[horizon] = input.labelFn(nodeId, cutMs, horizon);
        }
        pairs.push({ cut, nodeId, scores, labels });
      }
    }

    console.log(
      `\n${input.tag}: ${input.cuts.length} cuts, ${pairs.length} node-cut pairs before censoring`,
    );

    for (const horizon of input.horizons) {
      // Right-censoring: a cut whose window extends past the observation
      // boundary cannot see its label.
      const observable = pairs.filter(
        (pair) =>
          pair.cut.getTime() + horizon * DAY_MS <= input.observableUntil.getTime(),
      );
      const positives = observable.filter((pair) => pair.labels[horizon]).length;
      console.log(
        `--- ${input.tag} horizon ${horizon}d: ${observable.length} pairs, ` +
          `${positives} positive (${((100 * positives) / Math.max(1, observable.length)).toFixed(1)}%) ---`,
      );

      const predictors = [
        "recency",
        "currentWeight",
        "movementScore",
        "meanSignalImp",
        "S",
        `ER${horizon}`,
      ];
      const aucs = new Map<string, number | null>();
      for (const predictor of predictors) {
        const value = auc(
          observable.map((pair) => ({
            score: pair.scores[predictor],
            label: pair.labels[horizon],
          })),
        );
        aucs.set(predictor, value);
        console.log(
          `  AUC ${predictor.padEnd(14)} ${value === null ? "n/a" : value.toFixed(4)}`,
        );
      }

      const sAuc = aucs.get("S");
      const erAuc = aucs.get(`ER${horizon}`);
      const champion =
        (erAuc ?? -1) >= (sAuc ?? -1) ? `ER${horizon}` : "S";
      for (const baseline of ["recency", "currentWeight"]) {
        const random = mulberry32(BOOTSTRAP_SEED);
        const deltas: number[] = [];
        for (let b = 0; b < BOOTSTRAP_RESAMPLES; b += 1) {
          const resample: ScoredPair[] = [];
          for (let i = 0; i < observable.length; i += 1) {
            resample.push(observable[Math.floor(random() * observable.length)]);
          }
          const championAuc = auc(
            resample.map((pair) => ({
              score: pair.scores[champion],
              label: pair.labels[horizon],
            })),
          );
          const baselineAuc = auc(
            resample.map((pair) => ({
              score: pair.scores[baseline],
              label: pair.labels[horizon],
            })),
          );
          if (championAuc !== null && baselineAuc !== null) {
            deltas.push(championAuc - baselineAuc);
          }
        }
        deltas.sort((a, b) => a - b);
        if (deltas.length === 0) {
          console.log(
            `  ΔAUC ${champion} − ${baseline.padEnd(13)} n/a — AUC undefined (single-class labels)`,
          );
          continue;
        }
        const lower = deltas[Math.floor(0.025 * deltas.length)];
        const upper = deltas[Math.floor(0.975 * deltas.length)];
        const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        console.log(
          `  ΔAUC ${champion} − ${baseline.padEnd(13)} mean ${mean >= 0 ? "+" : ""}${mean.toFixed(4)}  ` +
            `95% CI [${lower >= 0 ? "+" : ""}${lower.toFixed(4)}, ${upper >= 0 ? "+" : ""}${upper.toFixed(4)}]` +
            `  (${deltas.length} resamples)`,
        );
      }
    }
  }

  runCriterion({
    tag: "criterion v1 (evidence labels, monthly cuts)",
    cuts: monthlyCuts(firstEvidenceAt, lastEvidenceAt),
    horizons: [28, 90],
    labelFn: evidenceLabel,
    observableUntil: lastEvidenceAt,
  });

  runCriterion({
    tag: "criterion v2 (return labels, weekly cuts)",
    cuts: weeklyCuts(firstEvidenceAt, lastActivityAt),
    horizons: [7, 14],
    labelFn: returnLabel,
    observableUntil: lastActivityAt,
  });
}

async function main(): Promise<void> {
  const users = await sql`
    SELECT u.id, u.email, count(ce.id)::int AS evidence_count
    FROM users u LEFT JOIN context_evidence ce ON ce.user_id = u.id
    GROUP BY u.id, u.email ORDER BY evidence_count DESC
  `;
  const archives = users.filter((row) => Number(row.evidence_count) > 0);
  console.log(
    `archives with evidence: ${archives.length} of ${users.length} users`,
  );
  for (const row of archives) {
    console.log(
      `  ${(row.email as string) ?? "<no email>"}  evidence=${row.evidence_count}`,
    );
  }

  for (const row of archives) {
    await evaluateUser(row.id as string, `${row.email} (${row.evidence_count} evidence rows)`);
  }

  await sql.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
