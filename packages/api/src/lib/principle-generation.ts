/**
 * Layer 4 generation: how principles are minted from what survives.
 *
 * The mirror of top-of-mind synthesis in both directions that matter.
 * Selection is by LONGEVITY, not recency — a principle is what keeps being
 * true after the current moment moves on. And generation is mint-or-match
 * into an open, uncapped set (signals-shaped), not a whole-artifact rewrite
 * (top-of-mind-shaped): one candidate at a time, judged against the standing
 * set, merged on overlap, marked contested on genuine collision.
 *
 * Material changes request a deduplicated background pass. The nightly cron
 * recovers missed work. Three evidenced patterns and a citing top-of-mind
 * version can support an initial principle, without a fixed calendar wait.
 *
 * Canon: docs/data-model.md ("Principle (layer 4)"); mechanics and the
 * qualification tests: docs/generation.md; phases: docs/goals/principles.md.
 */

import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import { randomUUID } from "node:crypto";
import { readGenerationRevision, assertGenerationRevision } from "./generation-revision.js";
import { personalSignalReadable, projectPersonalEntries } from "./personal-output.js";
import {
  inspirations,
  principles,
  principleSignals,
  signals,
  signalEvidence,
  topOfMindEntrySignals,
  topOfMindEntries,
  topOfMinds,
  profiles,
} from "../db/index.js";
import { getDb } from "./db.js";
import { normalizeSupportedLocale } from "./locales.js";
import { writePrincipleStatementChain } from "./statement-chains.js";
import { GROUP_INPUT_POLICY } from "./group-inputs.js";
import { groupPrincipleReadable, groupSignalReadable, projectGroupEntries } from "./group-output.js";
import {
  getDefaultModelProvider,
  type ModelProvider,
  type PrincipleCandidate,
} from "./model-provider.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Tuning — the longevity bar. Named exports so docs/generation.md can pin
// them (drift-locked in Phase 6 of the goal), tuned only with real data.
// ---------------------------------------------------------------------------

/** Distinct citing signals a principle must rest on. */
export const PRINCIPLE_MIN_SIGNALS = 3;

/** No calendar wait for an initial principle; evidence is still required. */
export const PRINCIPLE_MIN_SPAN_DAYS = 0;

/** Distinct top-of-mind versions the citing signals were selected into. */
export const PRINCIPLE_MIN_TOM_APPEARANCES = 1;

/** Statement ceiling — a principle is a directive, not an essay. */
export const PRINCIPLE_MAX_STATEMENT_LENGTH = 200;

/** Candidates one nightly distillation may propose for one profile. */
export const PRINCIPLE_MAX_CANDIDATES_PER_RUN = 3;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * E2e cannot wait 45 days or for midnight, so the bars accept env overrides —
 * honored only when the variable is set, absent in deployed configuration.
 * The exported constants stay the truth the docs pin.
 */
function bar(name: "SPAN" | "SIGNALS" | "TOM"): number {
  const override = process.env[`WAKA_PRINCIPLE_MIN_${name}_OVERRIDE`];
  if (override !== undefined && override !== "") {
    const parsed = Number.parseInt(override, 10);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return name === "SPAN"
    ? PRINCIPLE_MIN_SPAN_DAYS
    : name === "SIGNALS"
      ? PRINCIPLE_MIN_SIGNALS
      : PRINCIPLE_MIN_TOM_APPEARANCES;
}

// ---------------------------------------------------------------------------
// Pure arithmetic — what the unit tests pin.
// ---------------------------------------------------------------------------

export interface CitationEvidence {
  signalId: string;
  /** Evidence timestamps of the signal itself. */
  evidenceAt: Date[];
  /** Distinct top-of-mind version ids this signal was selected into. */
  tomVersionIds: string[];
}

export interface EligibilityVerdict {
  eligible: boolean;
  distinctSignals: number;
  spanDays: number;
  tomAppearances: number;
}

/**
 * The longevity bar, applied to one set of citing signals.
 *
 * Span is the first-to-last across the UNION of the signals' evidence — the
 * theme's lifetime, not any one signal's. Top-of-mind appearances count
 * distinct versions in which ANY citing signal was selected: survival of the
 * theme, however it was worded that week.
 */
export function computeCitationEligibility(
  citations: CitationEvidence[],
  now: Date,
): EligibilityVerdict {
  const distinctSignals = new Set(citations.map((row) => row.signalId)).size;

  const times = citations
    .flatMap((row) => row.evidenceAt)
    .map((date) => date.getTime())
    .filter((t) => Number.isFinite(t) && t <= now.getTime());
  const spanDays =
    times.length < 2 ? 0 : (Math.max(...times) - Math.min(...times)) / MS_PER_DAY;

  const tomAppearances = new Set(citations.flatMap((row) => row.tomVersionIds)).size;

  return {
    eligible:
      distinctSignals >= bar("SIGNALS") &&
      citations.every((row) => row.evidenceAt.some((at) => at <= now)) &&
      spanDays >= bar("SPAN") &&
      tomAppearances >= bar("TOM"),
    distinctSignals,
    spanDays,
    tomAppearances,
  };
}

/**
 * Where a new principle lands in the order.
 *
 * Rank is THE tie-breaker, so its maintenance is deliberately dumb: append
 * at the bottom, always. When the owner has arranged the order (any row
 * carries owner_ranked_at), that arrangement is sticky and generation never
 * re-sorts — this function is the whole of what generation may do to rank.
 */
export function nextRank(existing: Array<{ rank: number }>): number {
  return existing.length === 0 ? 1 : Math.max(...existing.map((row) => row.rank)) + 1;
}

/**
 * What happens to a standing principle whose citations no longer clear the
 * bar. Declared or edited wording stays, with lost support recorded. Only an
 * unedited minted claim is removed. A disagreement survives either outcome
 * for preserved words, and still-eligible rows are untouched.
 */
export function reconcileAction(
  row: { origin: "minted" | "declared"; state: "held" | "aspirational" | "contested"; lockedAt?: Date | null },
  stillEligible: boolean,
): "keep" | "demote" | "remove" {
  if (row.state === "aspirational" || stillEligible) return "keep";
  return row.origin === "declared" || row.lockedAt != null ? "demote" : "remove";
}

/** Redemption: only an aspirational principle promotes, and only on the bar. */
export function promoteDecision(
  state: "held" | "aspirational" | "contested",
  eligible: boolean,
): boolean {
  return state === "aspirational" && eligible;
}

// ---------------------------------------------------------------------------
// Evidence loading
// ---------------------------------------------------------------------------

async function loadCitationEvidence(
  db: WakaDb | WakaTx,
  profileId: string,
  signalIds: string[],
): Promise<Map<string, CitationEvidence>> {
  const out = new Map<string, CitationEvidence>();
  if (signalIds.length === 0) return out;
  for (const id of signalIds) {
    out.set(id, { signalId: id, evidenceAt: [], tomVersionIds: [] });
  }
  const [profile] = await db.select({ groupId: profiles.groupId }).from(profiles)
    .where(eq(profiles.id, profileId)).limit(1);

  // Dated by the CAPTURE that witnesses it, not by when the link was noticed
  // — same rule as confidence and selection. The span describes the
  // theme's lifetime in the profile's history; a retroactively cited old save
  // must widen it with its own date, not collapse it to the day of noticing.
  const evidenceRows = await db
    .select({ signalId: signalEvidence.signalId, createdAt: inspirations.createdAt })
    .from(signalEvidence)
    .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
    .where(
      and(eq(signalEvidence.profileId, profileId), inArray(signalEvidence.signalId, signalIds),
        ...(profile?.groupId ? [eq(inspirations.visibility, "public"), sql`EXISTS (
          SELECT 1 FROM group_members m WHERE m.group_id = ${profile.groupId}::uuid
          AND m.profile_id = ${inspirations.profileId})`] : [])),
    );
  for (const row of evidenceRows) out.get(row.signalId)?.evidenceAt.push(row.createdAt);

  const tomRows = await db
    .select({ signalId: topOfMindEntrySignals.signalId, topOfMindId: topOfMindEntries.topOfMindId })
    .from(topOfMindEntrySignals)
    .innerJoin(topOfMindEntries, eq(topOfMindEntries.id, topOfMindEntrySignals.entryId))
    .innerJoin(topOfMinds, eq(topOfMinds.id, topOfMindEntries.topOfMindId))
    .where(
      and(
        profile?.groupId
          ? eq(topOfMinds.groupId, profile.groupId)
          : eq(topOfMinds.profileId, profileId),
        inArray(topOfMindEntrySignals.signalId, signalIds),
        ...(profile?.groupId ? [eq(topOfMindEntries.inputPolicy, GROUP_INPUT_POLICY)] : []),
      ),
    );
  for (const row of tomRows) {
    if (row.signalId === null) continue;
    const bucket = out.get(row.signalId);
    if (bucket && !bucket.tomVersionIds.includes(row.topOfMindId)) {
      bucket.tomVersionIds.push(row.topOfMindId);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The nightly run
// ---------------------------------------------------------------------------

export interface RefreshPrinciplesResult {
  status: "below_bar" | "no_candidates" | "evaluated";
  minted: number;
  attached: number;
  conflicts: number;
  redeemed: number;
  dropped: number;
}

export interface PrincipleGenerationDependencies {
  db?: WakaDb;
  modelProvider?: ModelProvider;
  now?: Date;
  /** No network calls: verify the worker still owns its claim at commit. */
  beforeCommit?: (tx: Pick<WakaTx, "select">) => Promise<void>;
}

/** Room signals must pass the same current-member visibility gate as the wall. */
export async function loadPrincipleMaterial(db: WakaDb, profileId: string) {
  const [profile] = await db.select({ groupId: profiles.groupId, preferredLocale: profiles.preferredLocale }).from(profiles)
    .where(eq(profiles.id, profileId)).limit(1);
  const rows = await db.select({ id: signals.id, statement: signals.statement,
    lastEvidenceAt: signals.lastEvidenceAt, updatedAt: signals.updatedAt })
    .from(signals).where(and(eq(signals.profileId, profileId), eq(signals.status, "active"),
      ...(profile?.groupId ? [groupSignalReadable(profile.groupId)] : [personalSignalReadable(profileId)])));
  const activeSignals = rows;
  const evidence = await loadCitationEvidence(db, profileId, activeSignals.map((row) => row.id));
  return { activeSignals, evidence, groupId: profile?.groupId ?? null,
    preferredLocale: profile?.preferredLocale ?? "en-US",
    eligibility: computeCitationEligibility([...evidence.values()], new Date()) };
}

export async function refreshPrinciplesForProfile(
  input: { profileId: string },
  deps: PrincipleGenerationDependencies = {},
): Promise<RefreshPrinciplesResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const none: RefreshPrinciplesResult = {
    status: "below_bar",
    minted: 0,
    attached: 0,
    conflicts: 0,
    redeemed: 0,
    dropped: 0,
  };
  const revision = await readGenerationRevision(db, { profileId: input.profileId });
  if (!revision) return none;

  // The cheap gate: active signals with their longevity stats. Nearly every
  // night ends here, with zero model calls.
  const { activeSignals, evidence, groupId } = await loadPrincipleMaterial(db, input.profileId);
  if (activeSignals.length < bar("SIGNALS")) return none;

  const overall = computeCitationEligibility([...evidence.values()], now);
  if (!overall.eligible) return none;

  const provider = deps.modelProvider ?? (await getDefaultModelProvider());
  const [profileRow] = await db
    .select({ preferredLocale: profiles.preferredLocale })
    .from(profiles)
    .where(eq(profiles.id, input.profileId))
    .limit(1);
  const preferredLocale = normalizeSupportedLocale(profileRow?.preferredLocale);

  const existing = await db
    .select()
    .from(principles)
    .where(and(eq(principles.profileId, input.profileId),
      ...(groupId ? [groupPrincipleReadable(groupId, PRINCIPLE_MIN_SIGNALS)] : [])));

  const [liveTom] = await db
    .select({ id: topOfMinds.id })
    .from(topOfMinds)
    .where(and(groupId ? eq(topOfMinds.groupId, groupId) : eq(topOfMinds.profileId, input.profileId), eq(topOfMinds.status, "live")))
    .limit(1);
  const storedEntries = liveTom
    ? await db
        .select()
        .from(topOfMindEntries)
        .where(eq(topOfMindEntries.topOfMindId, liveTom.id))
    : [];
  const currentEntries = groupId
    ? (await projectGroupEntries(db, groupId, storedEntries)).entries
    : (await projectPersonalEntries(db, input.profileId, storedEntries)).entries.filter((entry) => !entry.supportChanged);

  const distilled = await provider.distillPrinciples({
    profileId: input.profileId,
    preferredLocale,
    signals: activeSignals.map((row) => {
      const stats = evidence.get(row.id);
      const times = (stats?.evidenceAt ?? []).map((d) => d.getTime());
      return {
        id: row.id,
        statement: row.statement,
        evidenceCount: stats?.evidenceAt.length ?? 0,
        firstEvidenceAt: times.length ? new Date(Math.min(...times)) : null,
        lastEvidenceAt: row.lastEvidenceAt,
        tomAppearances: stats?.tomVersionIds.length ?? 0,
      };
    }),
    currentPrinciples: existing.map((row) => ({
      id: row.id,
      statement: row.statement,
      state: row.state,
    })),
    currentEntries: currentEntries.map((row) => ({ body: row.body })),
  });

  const result: RefreshPrinciplesResult = { ...none, status: "no_candidates" };
  const activeIds = new Set(activeSignals.map((row) => row.id));

  const candidates = distilled.candidates.slice(0, PRINCIPLE_MAX_CANDIDATES_PER_RUN);
  const valid: PrincipleCandidate[] = [];
  for (const candidate of candidates) {
    const statement = candidate.statement.trim();
    const cited = [...new Set(candidate.citedSignalIds)].filter((id) => activeIds.has(id));
    const verdict = computeCitationEligibility(
      cited.map((id) => evidence.get(id)!).filter(Boolean),
      now,
    );
    if (
      statement.length === 0 ||
      statement.length > PRINCIPLE_MAX_STATEMENT_LENGTH ||
      !verdict.eligible
    ) {
      result.dropped += 1;
      continue;
    }
    valid.push({ ...candidate, statement, citedSignalIds: cited });
  }
  if (valid.length === 0) {
    await db.transaction(async (tx) => {
      await assertGenerationRevision(tx, revision);
      await deps.beforeCommit?.(tx);
    });
    return result;
  }

  result.status = "evaluated";

  // Plan the complete batch before writing. Provisional IDs let a later
  // candidate compare against an earlier mint without persisting it first.
  const standingSet = existing.map((row) => ({ id: row.id, statement: row.statement }));
  const planned: Array<{ candidate: PrincipleCandidate; matchedId: string | null; conflictingId: string | null; mintedId: string }> = [];
  for (const candidate of valid) {
    // Compare against the standing set, including earlier planned candidates.
    // An unavailable comparison aborts the entire batch before any write.
    let matchedId: string | null = null;
    let conflictingId: string | null = null;
    for (const standing of standingSet) {
      /* An unreachable judge used to mean "independent for this pair" —
         which minted near-duplicate principles on layer 4, the ranked,
         visible surface, whenever the road was down. It propagates now:
         the nightly job attempt fails and retries, and the candidate is
         judged against the whole standing set or not at all. */
      const { relation } = await provider.judgePrincipleRelation({
        preferredLocale,
        candidateStatement: candidate.statement,
        existingStatement: standing.statement,
      });
      if (relation === "same") {
        matchedId = standing.id;
        break;
      }
      if (relation === "conflicting" && !conflictingId) conflictingId = standing.id;
    }
    const mintedId = randomUUID();
    planned.push({ candidate, matchedId, conflictingId, mintedId });
    if (!matchedId) standingSet.push({ id: mintedId, statement: candidate.statement });
  }

  return db.transaction(async (tx) => {
    await assertGenerationRevision(tx, revision);
    await deps.beforeCommit?.(tx);
    try {
      // A human update may already own a row while its revision trigger waits
      // on our fence. Never wait back on that row: release and retry instead
      // of creating a deadlock that could abort the person's edit.
      await tx.select({ id: principles.id }).from(principles)
        .where(eq(principles.profileId, input.profileId)).for("no key update", { noWait: true });
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
      if (code === "55P03") throw new Error("Generation inputs changed; retry current inputs");
      throw error;
    }
    for (const { candidate, matchedId, conflictingId, mintedId } of planned) {
      if (matchedId) {
        const attached = await attachCitations(tx, input.profileId, matchedId, candidate.citedSignalIds);
        result.attached += attached;
        const matched = existing.find((row) => row.id === matchedId);
        if (matched && (matched.state === "aspirational" || matched.unsupportedAt !== null)) {
          const promoted = await promoteIfDemonstrated(tx, input.profileId, matchedId, now);
          if (promoted) result.redeemed += 1;
        }
        continue;
      }

      const ranks = await tx
        .select({ rank: principles.rank })
        .from(principles)
        .where(eq(principles.profileId, input.profileId));
      const [row] = await tx
        .insert(principles)
        .values({
          id: mintedId,
          profileId: input.profileId,
          statement: candidate.statement,
          inputPolicy: groupId ? GROUP_INPUT_POLICY : null,
          type: candidate.type,
          state: "held",
          origin: "minted",
          rank: nextRank(ranks),
          heldSince: now,
        })
        .returning();
      await tx.insert(principleSignals).values(
        candidate.citedSignalIds.map((signalId) => ({
          profileId: input.profileId,
          principleId: row!.id,
          signalId,
        })),
      );
      // The chain begins at birth — the machine's sentence every later
      // revert returns to (no-quiet-corners Phase 2).
      await writePrincipleStatementChain(tx, {
        profileId: input.profileId,
        principleId: row!.id,
        statement: candidate.statement,
        reason: "minted",
        now,
      });
      result.minted += 1;

      if (conflictingId) {
        await tx
          .update(principles)
          .set({ state: "contested", conflictsWithId: conflictingId, updatedAt: now })
          .where(eq(principles.id, mintedId));
        await tx
          .update(principles)
          .set({ state: "contested", conflictsWithId: mintedId, updatedAt: now })
          .where(eq(principles.id, conflictingId));
        result.conflicts += 1;
      }
    }

    return result;
  });
}

async function attachCitations(
  db: WakaDb | WakaTx,
  profileId: string,
  principleId: string,
  signalIds: string[],
): Promise<number> {
  if (signalIds.length === 0) return 0;
  const inserted = await db
    .insert(principleSignals)
    .values(signalIds.map((signalId) => ({ profileId, principleId, signalId })))
    .onConflictDoNothing()
    .returning({ id: principleSignals.id });
  return inserted.length;
}

/**
 * The redemption path: an aspirational declaration whose citations now meet
 * the bar becomes held — the declaration was a promise; the evidence redeems
 * it. Never touches the statement (declarations are locked from birth).
 */
export async function promoteIfDemonstrated(
  db: WakaDb | WakaTx,
  profileId: string,
  principleId: string,
  now: Date,
): Promise<boolean> {
  const cited = await db
    .select({ signalId: principleSignals.signalId })
    .from(principleSignals)
    .innerJoin(signals, eq(signals.id, principleSignals.signalId))
    .where(and(eq(principleSignals.principleId, principleId), eq(signals.status, "active")));
  const evidence = await loadCitationEvidence(
    db,
    profileId,
    cited.map((row) => row.signalId),
  );
  const verdict = computeCitationEligibility([...evidence.values()], now);
  const [current] = await db
    .select({ state: principles.state, unsupportedAt: principles.unsupportedAt })
    .from(principles)
    .where(eq(principles.id, principleId))
    .limit(1);
  if (!current || !verdict.eligible ||
    (!promoteDecision(current.state, true) && current.unsupportedAt === null)) return false;

  const updated = await db
    .update(principles)
    .set({
      state: sql`case when ${principles.state} = 'contested' then 'contested'::principle_state else 'held'::principle_state end`,
      unsupportedAt: null, heldSince: now, updatedAt: now,
    })
    .where(and(eq(principles.id, principleId), eq(principles.profileId, profileId),
      or(eq(principles.state, "aspirational"), isNotNull(principles.unsupportedAt))))
    .returning({ id: principles.id });
  return updated.length > 0;
}

/**
 * Immediate state maintenance after signals are lost or retired — never
 * waits for midnight, involves no model. A held principle whose citations
 * fall below the bar: declared → back to aspirational (the owner's words
 * stand, undemonstrated again); minted → removed (a machine claim without
 * support has no words worth keeping). Conflict links pointing at a removed
 * row are cleared rather than left dangling.
 */
export async function reconcilePrinciplesAfterSignalLoss(
  db: WakaDb | WakaTx,
  input: { profileId: string; signalIds: string[]; now?: Date },
): Promise<{ demoted: string[]; removed: string[] }> {
  const now = input.now ?? new Date();
  const demoted: string[] = [];
  const removed: string[] = [];
  if (input.signalIds.length === 0) return { demoted, removed };

  const affected = await db
    .selectDistinct({ principleId: principleSignals.principleId })
    .from(principleSignals)
    .where(
      and(
        eq(principleSignals.profileId, input.profileId),
        inArray(principleSignals.signalId, input.signalIds),
      ),
    );

  for (const { principleId } of affected) {
    await db.transaction(async (tx) => {
      // Read standing under the row lock: a committed human edit must be
      // observed before deciding whether automatic deletion is allowed.
      const [row] = await tx
        .select()
        .from(principles)
        .where(and(eq(principles.id, principleId), eq(principles.profileId, input.profileId)))
        .for("update")
        .limit(1);
      if (!row) return;

      const cited = await tx
        .select({ signalId: principleSignals.signalId })
        .from(principleSignals)
        .innerJoin(signals, eq(signals.id, principleSignals.signalId))
        .where(and(eq(principleSignals.principleId, principleId), eq(signals.status, "active")));
      const evidence = await loadCitationEvidence(tx, input.profileId, cited.map((c) => c.signalId));
      const action = reconcileAction(row, computeCitationEligibility([...evidence.values()], now).eligible);
      if (action === "keep") return;

      if (action === "demote") {
        await tx.update(principles).set({
          state: row.state === "contested" ? "contested" : "aspirational",
          heldSince: null,
          unsupportedAt: row.unsupportedAt ?? now,
          updatedAt: now,
        }).where(eq(principles.id, principleId));
        demoted.push(principleId);
      } else {
        await tx.update(principles).set({ conflictsWithId: null })
          .where(eq(principles.conflictsWithId, principleId));
        await tx.delete(principles).where(eq(principles.id, principleId));
        removed.push(principleId);
      }
    });
  }
  return { demoted, removed };
}
