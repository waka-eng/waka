/**
 * THE SIGNAL GARDENER — the pass that revisits the standing set.
 *
 * Matching happens at candidate time and never again, so two ACTIVE signals
 * that name one pattern — minted on different days as the wording drifted,
 * or minted as siblings during a judge outage before the failure-honesty
 * change — coexist forever, splitting their evidence, each weaker than the
 * truth. This is the machinery that looks: pairwise cosine over the stored
 * vectors, a bounded number of judge calls on the suspicious pairs, and a
 * RECORD of what it finds — never an act.
 *
 *   judge says same     → a `signal_duplicates` row, unresolved: a proposal.
 *                         The merge is the owner's to say (the world never
 *                         moves unless the user moved it, and a merge moves
 *                         their memory). `resolveSignalDuplicate` below is
 *                         the owner's door.
 *   judge says opposed  → the same contradiction row a capture-time
 *                         opposition writes — the contested surface already
 *                         knows how to show it.
 *   judge says independent → nothing is written. The pair may be re-judged
 *                         a week later; with the suspect bar at the attach
 *                         threshold such pairs are rare, and a memory table
 *                         for "asked, nothing there" is not worth its rows.
 *
 * Pairs already recorded — as duplicates in any state (an unresolved
 * proposal, a merge, a standing `kept_apart`) or as contradictions — are
 * never asked about again. `kept_apart` is the owner's answer, and the
 * gardener respects it forever.
 *
 * Spend is bounded twice: the scan reads at most GARDENER_SCAN_LIMIT
 * most-recently-evidenced signals, and at most GARDENER_MAX_JUDGED_PAIRS
 * pairs are judged per pass. Everything else is arithmetic in process.
 */

import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import {
  signalDuplicates,
  signalContradictions,
  signalEmbeddings,
  signals,
} from "../db/index.js";
import { recordContradiction } from "./contested-pairs.js";
import { getDb } from "./db.js";
import type { ModelProvider } from "./model-provider.js";
import { getDefaultModelProvider } from "./model-provider.js";
import { cosineSimilarity } from "../scoring/vector.js";
import {
  GARDENER_MAX_JUDGED_PAIRS,
  GARDENER_SCAN_LIMIT,
  GARDENER_SUSPECT_MIN_COSINE,
} from "./signal-derivation-thresholds.js";
import { refreshSignalLifecycle } from "./signal-lifecycle.js";
import type { SupportedLocale } from "./locales.js";

type WakaDb = ReturnType<typeof getDb>;

const normalizePair = (x: string, y: string): { a: string; b: string } =>
  x < y ? { a: x, b: y } : { a: y, b: x };

export interface GardenPassSummary {
  scanned: number;
  suspectPairs: number;
  judged: number;
  proposed: number;
  opposed: number;
}

export async function tendSignalGarden(
  db: WakaDb,
  input: {
    profileId: string;
    preferredLocale: SupportedLocale;
    provider?: ModelProvider;
    now?: Date;
  },
): Promise<GardenPassSummary> {
  const provider = input.provider ?? (await getDefaultModelProvider());

  /* The standing set, most-recently-evidenced first — the same bounding rule
     match-or-mint scans by. Dismissed rows are out (their vectors are
     suppression anchors now, a different job), and so is anything retired. */
  const rows = await db
    .select({
      id: signals.id,
      statement: signals.statement,
      status: signals.status,
    })
    .from(signals)
    .where(
      and(
        eq(signals.profileId, input.profileId),
        inArray(signals.status, ["active", "emerging"]),
        isNull(signals.dismissedAt),
      ),
    )
    .orderBy(desc(signals.lastEvidenceAt), desc(signals.createdAt))
    .limit(GARDENER_SCAN_LIMIT);
  if (rows.length < 2) {
    return { scanned: rows.length, suspectPairs: 0, judged: 0, proposed: 0, opposed: 0 };
  }

  const ids = rows.map((row) => row.id);
  const embeddingRows = await db
    .select({ signalId: signalEmbeddings.signalId, embedding: signalEmbeddings.embedding })
    .from(signalEmbeddings)
    .where(inArray(signalEmbeddings.signalId, ids));
  const vectorById = new Map<string, number[]>();
  for (const row of embeddingRows) {
    if (!vectorById.has(row.signalId)) vectorById.set(row.signalId, row.embedding);
  }

  /* every pair already on the record, in either table, in any state */
  const [duplicateRows, contradictionRows] = await Promise.all([
    db
      .select({ a: signalDuplicates.aSignalId, b: signalDuplicates.bSignalId })
      .from(signalDuplicates)
      .where(
        or(inArray(signalDuplicates.aSignalId, ids), inArray(signalDuplicates.bSignalId, ids)),
      ),
    db
      .select({ a: signalContradictions.aSignalId, b: signalContradictions.bSignalId })
      .from(signalContradictions)
      .where(
        or(
          inArray(signalContradictions.aSignalId, ids),
          inArray(signalContradictions.bSignalId, ids),
        ),
      ),
  ]);
  const recorded = new Set<string>();
  for (const row of [...duplicateRows, ...contradictionRows]) {
    recorded.add(`${row.a}:${row.b}`);
  }

  /* pairwise, in process — bounded by the scan limit, and only the pairs
     the attach threshold itself would call the same pattern */
  const suspects: Array<{ a: (typeof rows)[number]; b: (typeof rows)[number]; sim: number }> = [];
  for (let i = 0; i < rows.length; i += 1) {
    const va = vectorById.get(rows[i]!.id);
    if (!va) continue;
    for (let j = i + 1; j < rows.length; j += 1) {
      const vb = vectorById.get(rows[j]!.id);
      if (!vb) continue;
      const sim = cosineSimilarity(va, vb);
      if (sim === null || sim < GARDENER_SUSPECT_MIN_COSINE) continue;
      const { a, b } = normalizePair(rows[i]!.id, rows[j]!.id);
      if (recorded.has(`${a}:${b}`)) continue;
      suspects.push({ a: rows[i]!, b: rows[j]!, sim });
    }
  }
  suspects.sort((x, y) => y.sim - x.sim);

  const summary: GardenPassSummary = {
    scanned: rows.length,
    suspectPairs: suspects.length,
    judged: 0,
    proposed: 0,
    opposed: 0,
  };

  for (const pair of suspects.slice(0, GARDENER_MAX_JUDGED_PAIRS)) {
    /* the same austere judge derivation uses; a road failure throws and the
       job attempt retries — the failure-honesty rule, unchanged here */
    const verdict = await provider.judgeSignalMatch({
      preferredLocale: input.preferredLocale,
      candidateStatement: pair.a.statement,
      existingStatement: pair.b.statement,
    });
    summary.judged += 1;

    if (verdict.relation === "same") {
      const { a, b } = normalizePair(pair.a.id, pair.b.id);
      await db
        .insert(signalDuplicates)
        .values({
          profileId: input.profileId,
          aSignalId: a,
          bSignalId: b,
          similarity: pair.sim,
          createdAt: input.now ?? new Date(),
        })
        .onConflictDoNothing();
      summary.proposed += 1;
    } else if (verdict.relation === "opposed") {
      await recordContradiction(db, {
        profileId: input.profileId,
        signalId: pair.a.id,
        opposesSignalId: pair.b.id,
        now: input.now,
      });
      summary.opposed += 1;
    }
  }

  return summary;
}

// ---------------------------------------------------------------------------
// The owner's door
// ---------------------------------------------------------------------------

export type DuplicateResolutionAct = "merge" | "keep_apart";

export interface ResolveDuplicateResult {
  status: "merged" | "kept_apart" | "not_found" | "already_resolved";
  survivorId?: string;
  retiredId?: string;
}

/**
 * Resolve one proposal, as the owner.
 *
 * `keep_apart` writes the standing answer and nothing else moves.
 *
 * `merge` unions the pair under a survivor, in one transaction:
 *   - the survivor is the LOCKED side if exactly one side is locked (the
 *     person's own words always win), otherwise the elder by creation —
 *     the pattern's first naming;
 *   - evidence rows repoint to the survivor, the (signal, inspiration)
 *     uniqueness swallowing overlap;
 *   - top-of-mind citations and principle citations repoint the same way;
 *   - the other signal retires — status `retired`, never a delete: its
 *     statement, its history, and the duplicate row naming where it went
 *     (`mergedIntoSignalId`) all stay readable;
 *   - the survivor's lifecycle recomputes from its widened evidence.
 */
export async function resolveSignalDuplicate(
  db: WakaDb,
  input: {
    profileId: string;
    duplicateId: string;
    act: DuplicateResolutionAct;
    now?: Date;
  },
): Promise<ResolveDuplicateResult> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(signalDuplicates)
      .where(
        and(
          eq(signalDuplicates.id, input.duplicateId),
          eq(signalDuplicates.profileId, input.profileId),
        ),
      )
      .limit(1)
      .for("update");
    if (!row) return { status: "not_found" };
    if (row.resolvedAt !== null) return { status: "already_resolved" };

    if (input.act === "keep_apart") {
      await tx
        .update(signalDuplicates)
        .set({ resolvedAt: now, resolvedBy: "kept_apart" })
        .where(eq(signalDuplicates.id, row.id));
      return { status: "kept_apart" };
    }

    const pair = await tx
      .select({
        id: signals.id,
        createdAt: signals.createdAt,
        lockedAt: signals.lockedAt,
      })
      .from(signals)
      .where(inArray(signals.id, [row.aSignalId, row.bSignalId]))
      .for("update");
    const a = pair.find((s) => s.id === row.aSignalId);
    const b = pair.find((s) => s.id === row.bSignalId);
    if (!a || !b) return { status: "not_found" };

    const exactlyOneLocked = (a.lockedAt === null) !== (b.lockedAt === null);
    const survivor = exactlyOneLocked
      ? a.lockedAt !== null
        ? a
        : b
      : a.createdAt <= b.createdAt
        ? a
        : b;
    const retired = survivor.id === a.id ? b : a;

    /* the union is written by ADDITION: the survivor gains a link for every
       inspiration the retired side witnessed that it does not already hold —
       cloned with its reason, quote, and owner — while the retired signal
       KEEPS its own links. A retired row that still shows what it stood on
       is provenance; stripping it would make the retirement a half-delete. */
    await tx.execute(sql`
      INSERT INTO signal_evidence
        (profile_id, owner_profile_id, signal_id, inspiration_id, reason, quote, quote_source, created_at)
      SELECT profile_id, owner_profile_id, ${survivor.id}, inspiration_id, reason, quote, quote_source, created_at
      FROM signal_evidence
      WHERE signal_id = ${retired.id}
      ON CONFLICT (signal_id, inspiration_id) DO NOTHING`);

    /* citations follow — raw SQL for the two link tables, each with its own
       uniqueness to respect */
    await tx.execute(sql`
      UPDATE top_of_mind_entry_signals SET signal_id = ${survivor.id}
      WHERE signal_id = ${retired.id}
        AND NOT EXISTS (
          SELECT 1 FROM top_of_mind_entry_signals other
          WHERE other.entry_id = top_of_mind_entry_signals.entry_id
            AND other.signal_id = ${survivor.id}
        )`);
    await tx.execute(sql`
      UPDATE principle_signals SET signal_id = ${survivor.id}
      WHERE signal_id = ${retired.id}
        AND NOT EXISTS (
          SELECT 1 FROM principle_signals other
          WHERE other.principle_id = principle_signals.principle_id
            AND other.signal_id = ${survivor.id}
        )`);

    await tx
      .update(signals)
      .set({ status: "retired", updatedAt: now })
      .where(eq(signals.id, retired.id));
    await tx
      .update(signalDuplicates)
      .set({ resolvedAt: now, resolvedBy: "merged", mergedIntoSignalId: survivor.id })
      .where(eq(signalDuplicates.id, row.id));

    await refreshSignalLifecycle(tx, survivor.id, now);

    return { status: "merged", survivorId: survivor.id, retiredId: retired.id };
  });
}
