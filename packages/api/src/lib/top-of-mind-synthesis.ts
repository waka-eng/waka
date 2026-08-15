/**
 * Layer 3 — synthesizing one profile's top of mind.
 *
 * The artifact is the unit. A refresh selects the profile's strongest signals
 * deterministically, asks the provider for the WHOLE artifact once, validates
 * what comes back against facts the database owns, and then writes a new
 * version. Nothing is mutated in place: the previous live row is marked
 * superseded and points forward at its replacement, so the history is a chain
 * a reader can walk.
 *
 * Two invariants are enforced here rather than trusted:
 *
 *   - **Every cited signal exists and belongs to this profile.** A citation
 *     the model invented is dropped, and an entry left with no citation is
 *     dropped with it. An artifact that cites nothing is a horoscope.
 *
 *   - **Human decisions survive regeneration.** Entries the owner locked,
 *     pinned, or dismissed are copied forward verbatim from the previous
 *     version — read out of the database, never out of the model's reply.
 *     The instruction asks the model to reproduce locked entries exactly, and
 *     we check that it did, but the bytes that get written are the stored
 *     ones. That is the difference between a rule and a request.
 *
 * Every refresh records a decision. When nothing moved, the pass writes a
 * version with `reason: "no_change"` rather than returning quietly — a silent
 * empty pass and a broken generator look identical from the outside, and the
 * previous system hid its failures in exactly that gap.
 */

import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import {
  profiles,
  signalEvidence,
  signals,
  topOfMindEntries,
  topOfMindEntrySignals,
  topOfMinds,
  type TopOfMindEntryType,
  type TopOfMindRevisionReason,
  feedback,
} from "../db/index.js";
import { getDb } from "./db.js";
import { normalizeSupportedLocale } from "./locales.js";
import {
  getDefaultModelProvider,
  type ModelProvider,
  type TopOfMindSynthesisEntry,
  type TopOfMindRecentFeedback,
} from "./model-provider.js";
import { acquireTopOfMindArtifactLock } from "./top-of-mind-family-lock.js";

type WakaDb = ReturnType<typeof getDb>;
type WakaTx = Parameters<Parameters<WakaDb["transaction"]>[0]>[0];

// ---------------------------------------------------------------------------
// Selection tuning
//
// Named exports rather than inline numbers so Phase 5 can tune ranking in one
// diff, and so a reviewer can see the whole ranking policy in one screen.
// ---------------------------------------------------------------------------

/** How many signals the synthesis call is allowed to consider. */
export const TOP_OF_MIND_SIGNAL_LIMIT = 12;

/** Weights of the four ranking terms; they sum to 1. */
export const SELECTION_CONFIDENCE_WEIGHT = 0.45;
export const SELECTION_EVIDENCE_WEIGHT = 0.2;
export const SELECTION_RECENCY_WEIGHT = 0.2;
export const SELECTION_COMEBACK_WEIGHT = 0.15;

/**
 * Applied to a signal whose most recent verdict from its owner is "not_true".
 * A multiplier rather than an exclusion: the person may be wrong, the pattern
 * may return with new evidence, and a memory that silently drops whatever was
 * disputed is a memory that cannot be argued with. Disputed signals fight
 * uphill; they are not banished.
 */
export const SELECTION_DISPUTED_MULTIPLIER = 0.4;

/** Evidence count at which the support term saturates. */
export const SELECTION_EVIDENCE_SATURATION = 6;
/** Half-life of the recency term, in days. */
export const SELECTION_RECENCY_HALF_LIFE_DAYS = 30;

/**
 * A signal that went quiet and then came back is more interesting than one
 * that never stopped: the return is the person's own attention re-landing on
 * something, which is exactly what a top of mind is for. The bonus needs a
 * real gap before it, and the return itself has to be recent — a comeback
 * from four months ago is just history.
 */
export const COMEBACK_MIN_DORMANT_DAYS = 21;
export const COMEBACK_SATURATION_DAYS = 90;
export const COMEBACK_MAX_RETURN_AGE_DAYS = 14;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export interface RefreshTopOfMindInput {
  profileId: string;
  reason: "signals_changed" | "manual";
}

export interface TopOfMindRefreshDependencies {
  db?: WakaDb;
  modelProvider?: ModelProvider;
  now?: Date;
}

export interface TopOfMindRefreshResult {
  status: "versioned" | "nothing_to_synthesize";
  topOfMindId: string | null;
  version: number;
  reason: TopOfMindRevisionReason | null;
  entryCount: number;
  /** Signals whose ids the model cited but the profile does not hold. */
  droppedCitations: number;
  /** Locked entries the model failed to reproduce byte-identically. */
  lockViolations: number;
}

interface SelectedSignal {
  id: string;
  statement: string;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  score: number;
}

export interface CarriedEntry {
  type: TopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  lockedAt: Date | null;
  pinnedAt: Date | null;
  dismissedAt: Date | null;
  sortOrder: number;
  citedSignalIds: string[];
}

interface LiveArtifactSnapshot {
  id: string;
  version: number;
  entries: CarriedEntry[];
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * The dormancy-comeback bonus, in 0..1, computed from one signal's evidence
 * timestamps: how long the gap before the newest piece of evidence was, and
 * whether that return is recent enough to still be a return.
 */
export function computeComebackBonus(evidenceAt: Date[], now: Date): number {
  if (evidenceAt.length < 2) return 0;

  const times = evidenceAt.map((date) => date.getTime()).sort((a, b) => a - b);
  const last = times[times.length - 1]!;
  const previous = times[times.length - 2]!;

  const returnAgeDays = (now.getTime() - last) / MS_PER_DAY;
  if (returnAgeDays > COMEBACK_MAX_RETURN_AGE_DAYS) return 0;

  const dormantDays = (last - previous) / MS_PER_DAY;
  if (dormantDays < COMEBACK_MIN_DORMANT_DAYS) return 0;

  const span = COMEBACK_SATURATION_DAYS - COMEBACK_MIN_DORMANT_DAYS;
  return Math.min(1, (dormantDays - COMEBACK_MIN_DORMANT_DAYS) / span);
}

/** 0..100. Deterministic: same rows, same clock, same order, every time. */
export function computeSelectionScore(input: {
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  comebackBonus: number;
  /** True when the owner's latest verdict on this signal is "not_true". */
  disputed?: boolean;
  now: Date;
}): number {
  const support = Math.min(1, input.evidenceCount / SELECTION_EVIDENCE_SATURATION);
  const quietDays = input.lastEvidenceAt
    ? Math.max(0, (input.now.getTime() - input.lastEvidenceAt.getTime()) / MS_PER_DAY)
    : Number.POSITIVE_INFINITY;
  const recency = Number.isFinite(quietDays)
    ? Math.pow(2, -quietDays / SELECTION_RECENCY_HALF_LIFE_DAYS)
    : 0;

  const score =
    SELECTION_CONFIDENCE_WEIGHT * input.confidence +
    SELECTION_EVIDENCE_WEIGHT * support * 100 +
    SELECTION_RECENCY_WEIGHT * recency * 100 +
    SELECTION_COMEBACK_WEIGHT * input.comebackBonus * 100;

  const damped = input.disputed ? score * SELECTION_DISPUTED_MULTIPLIER : score;

  return Math.max(0, Math.min(100, damped));
}

async function selectSignals(
  db: WakaDb,
  profileId: string,
  now: Date,
): Promise<SelectedSignal[]> {
  const rows = await db
    .select({
      id: signals.id,
      statement: signals.statement,
      confidence: signals.confidence,
      lastEvidenceAt: signals.lastEvidenceAt,
    })
    .from(signals)
    .where(
      and(
        eq(signals.profileId, profileId),
        eq(signals.status, "active"),
        // A locked statement with no support left is still the owner's text,
        // but it is not evidence of anything current, and the artifact is a
        // claim about what is current.
        isNull(signals.unsupportedAt),
      ),
    )
    .orderBy(desc(signals.confidence), desc(signals.lastEvidenceAt));

  if (rows.length === 0) return [];

  const evidenceRows = await db
    .select({
      signalId: signalEvidence.signalId,
      createdAt: signalEvidence.createdAt,
    })
    .from(signalEvidence)
    .where(
      inArray(
        signalEvidence.signalId,
        rows.map((row) => row.id),
      ),
    );

  const evidenceBySignal = new Map<string, Date[]>();
  for (const row of evidenceRows) {
    const bucket = evidenceBySignal.get(row.signalId);
    if (bucket) bucket.push(row.createdAt);
    else evidenceBySignal.set(row.signalId, [row.createdAt]);
  }

  // The latest verdict per signal decides `disputed` — newest first, first
  // write wins per target. A later "true" therefore lifts an older "not_true",
  // which is what changing one's mind should do.
  const verdictRows = await db
    .select({
      targetId: feedback.targetId,
      value: feedback.value,
    })
    .from(feedback)
    .where(
      and(
        eq(feedback.profileId, profileId),
        eq(feedback.targetType, "signal"),
        inArray(
          feedback.targetId,
          rows.map((row) => row.id),
        ),
      ),
    )
    .orderBy(desc(feedback.createdAt));

  const latestVerdict = new Map<string, string>();
  for (const row of verdictRows) {
    if (!latestVerdict.has(row.targetId)) latestVerdict.set(row.targetId, row.value);
  }

  return rows
    .map((row) => {
      const evidenceAt = evidenceBySignal.get(row.id) ?? [];
      return {
        id: row.id,
        statement: row.statement,
        confidence: row.confidence,
        evidenceCount: evidenceAt.length,
        lastEvidenceAt: row.lastEvidenceAt,
        score: computeSelectionScore({
          confidence: row.confidence,
          evidenceCount: evidenceAt.length,
          lastEvidenceAt: row.lastEvidenceAt,
          comebackBonus: computeComebackBonus(evidenceAt, now),
          disputed: latestVerdict.get(row.id) === "not_true",
          now,
        }),
      };
    })
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aRecency = a.lastEvidenceAt?.getTime() ?? 0;
      const bRecency = b.lastEvidenceAt?.getTime() ?? 0;
      if (bRecency !== aRecency) return bRecency - aRecency;
      // Ids as the last tiebreak so two identically-scored signals never
      // swap places between two runs over identical data.
      return a.id < b.id ? -1 : 1;
    })
    .slice(0, TOP_OF_MIND_SIGNAL_LIMIT);
}

// ---------------------------------------------------------------------------
// Reading the live artifact
// ---------------------------------------------------------------------------

async function loadLiveArtifact(
  db: WakaDb | WakaTx,
  profileId: string,
): Promise<LiveArtifactSnapshot | null> {
  const [artifact] = await db
    .select({ id: topOfMinds.id, version: topOfMinds.version })
    .from(topOfMinds)
    .where(and(eq(topOfMinds.profileId, profileId), eq(topOfMinds.status, "live")))
    .limit(1);
  if (!artifact) return null;

  const entryRows = await db
    .select()
    .from(topOfMindEntries)
    .where(eq(topOfMindEntries.topOfMindId, artifact.id))
    .orderBy(asc(topOfMindEntries.sortOrder));

  const citationRows =
    entryRows.length === 0
      ? []
      : await db
          .select({
            entryId: topOfMindEntrySignals.entryId,
            signalId: topOfMindEntrySignals.signalId,
          })
          .from(topOfMindEntrySignals)
          .where(
            inArray(
              topOfMindEntrySignals.entryId,
              entryRows.map((row) => row.id),
            ),
          );

  const citationsByEntry = new Map<string, string[]>();
  for (const row of citationRows) {
    const bucket = citationsByEntry.get(row.entryId);
    if (bucket) bucket.push(row.signalId);
    else citationsByEntry.set(row.entryId, [row.signalId]);
  }

  return {
    id: artifact.id,
    version: artifact.version,
    entries: entryRows.map((row) => ({
      type: row.type,
      body: row.body,
      belief: row.belief,
      prompt: row.prompt,
      lockedAt: row.lockedAt,
      pinnedAt: row.pinnedAt,
      dismissedAt: row.dismissedAt,
      sortOrder: row.sortOrder,
      citedSignalIds: citationsByEntry.get(row.id) ?? [],
    })),
  };
}

/** Locked, pinned, and dismissed are the three ways a human touched an entry. */
function isHumanTouched(entry: CarriedEntry): boolean {
  return entry.lockedAt !== null || entry.pinnedAt !== null || entry.dismissedAt !== null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

interface ValidationOutcome {
  entries: TopOfMindSynthesisEntry[];
  droppedCitations: number;
}

/**
 * Keep only what the database can vouch for: citations that name a signal
 * this profile actually holds, and entries that still have at least one after
 * the filter. An entry with no citation left is not a weaker entry, it is an
 * unsourced claim about someone.
 */
export function validateSynthesizedEntries(
  entries: TopOfMindSynthesisEntry[],
  knownSignalIds: Set<string>,
): ValidationOutcome {
  let droppedCitations = 0;
  const validated: TopOfMindSynthesisEntry[] = [];

  for (const entry of entries) {
    const cited = entry.citedSignalIds.filter((id) => {
      if (knownSignalIds.has(id)) return true;
      droppedCitations += 1;
      return false;
    });
    if (cited.length === 0) continue;
    validated.push({ ...entry, citedSignalIds: [...new Set(cited)] });
  }

  return { entries: validated, droppedCitations };
}

/**
 * Did the model return every locked entry unchanged? The answer does not
 * change what gets written — locked entries are copied from storage either
 * way — but a model that quietly rewrites a person's own words is a fact
 * worth seeing in the logs before it is a fact worth seeing in the product.
 */
export function countLockViolations(
  lockedEntries: CarriedEntry[],
  returned: TopOfMindSynthesisEntry[],
): number {
  const returnedBodies = new Set(returned.map((entry) => entry.body));
  return lockedEntries.filter((entry) => !returnedBodies.has(entry.body)).length;
}

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

export interface PersistedEntry {
  type: TopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  lockedAt: Date | null;
  pinnedAt: Date | null;
  dismissedAt: Date | null;
  citedSignalIds: string[];
}

/**
 * The order a reader meets the artifact in:
 *   pinned, then locked, then what the model wrote, then dismissed.
 *
 * Pinned first because pinning is the owner saying "keep this where I can see
 * it". Dismissed last because they are carried only so a dismissal survives
 * the next regeneration; every read path filters them out by default.
 */
export function assembleEntries(input: {
  carried: CarriedEntry[];
  generated: TopOfMindSynthesisEntry[];
}): PersistedEntry[] {
  const humanTouched = input.carried.filter(isHumanTouched);
  const carriedBodies = new Set(humanTouched.map((entry) => entry.body));

  const bySortOrder = (a: CarriedEntry, b: CarriedEntry) => a.sortOrder - b.sortOrder;
  const toPersisted = (entry: CarriedEntry): PersistedEntry => ({
    type: entry.type,
    body: entry.body,
    belief: entry.belief,
    prompt: entry.prompt,
    lockedAt: entry.lockedAt,
    pinnedAt: entry.pinnedAt,
    dismissedAt: entry.dismissedAt,
    citedSignalIds: entry.citedSignalIds,
  });

  const pinned = humanTouched
    .filter((entry) => entry.pinnedAt !== null && entry.dismissedAt === null)
    .sort(bySortOrder)
    .map(toPersisted);
  const locked = humanTouched
    .filter(
      (entry) =>
        entry.lockedAt !== null && entry.pinnedAt === null && entry.dismissedAt === null,
    )
    .sort(bySortOrder)
    .map(toPersisted);
  const dismissed = humanTouched
    .filter((entry) => entry.dismissedAt !== null)
    .sort(bySortOrder)
    .map(toPersisted);

  const generated = input.generated
    // The model was asked to reproduce locked entries; those copies are
    // redundant with the verbatim ones, and a dismissed body coming back is
    // the regeneration re-proposing something the owner already refused.
    .filter((entry) => !carriedBodies.has(entry.body))
    .map<PersistedEntry>((entry) => ({
      type: entry.type,
      body: entry.body,
      belief: entry.belief ?? null,
      prompt: entry.prompt ?? null,
      lockedAt: null,
      pinnedAt: null,
      dismissedAt: null,
      citedSignalIds: entry.citedSignalIds,
    }));

  return [...pinned, ...locked, ...generated, ...dismissed];
}

/**
 * Same entries, same order, same citations — nothing for a reader to notice.
 *
 * Dismissed entries are excluded from the comparison because they are
 * excluded from every read: they ride along so a dismissal survives the next
 * regeneration, and where they sit in the list is not something anyone sees.
 */
export function isUnchanged(previous: CarriedEntry[], next: PersistedEntry[]): boolean {
  const before = [...previous]
    .filter((entry) => entry.dismissedAt === null)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const after = next.filter((entry) => entry.dismissedAt === null);
  if (before.length !== after.length) return false;

  // Citations compared as sets, not sequences: the carried order comes from a
  // query with no ORDER BY and the generated order from the model, so the same
  // citations arriving shuffled would otherwise read as a change and mislabel
  // a genuine no-change pass as `regenerated`.
  const sortedIds = (ids: string[]): string => [...ids].sort().join(",");

  return before.every((entry, index) => {
    const candidate = after[index]!;
    return (
      entry.type === candidate.type &&
      entry.body === candidate.body &&
      (entry.belief ?? null) === candidate.belief &&
      (entry.prompt ?? null) === candidate.prompt &&
      sortedIds(entry.citedSignalIds) === sortedIds(candidate.citedSignalIds)
    );
  });
}

/** Everything the previous version held, in the order it held it. */
function carryEverything(previous: LiveArtifactSnapshot): PersistedEntry[] {
  return [...previous.entries]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((entry) => ({
      type: entry.type,
      body: entry.body,
      belief: entry.belief,
      prompt: entry.prompt,
      lockedAt: entry.lockedAt,
      pinnedAt: entry.pinnedAt,
      dismissedAt: entry.dismissedAt,
      citedSignalIds: entry.citedSignalIds,
    }));
}

async function writeVersion(
  tx: WakaTx,
  input: {
    profileId: string;
    previous: LiveArtifactSnapshot | null;
    entries: PersistedEntry[];
    reason: TopOfMindRevisionReason;
    now: Date;
  },
): Promise<{ id: string; version: number }> {
  // Supersede before inserting: the partial unique index permits exactly one
  // live row per profile, so the old one has to step down first.
  if (input.previous) {
    await tx
      .update(topOfMinds)
      .set({ status: "superseded", replacedAt: input.now })
      .where(eq(topOfMinds.id, input.previous.id));
  }

  const [created] = await tx
    .insert(topOfMinds)
    .values({
      profileId: input.profileId,
      version: (input.previous?.version ?? 0) + 1,
      status: "live",
      reason: input.reason,
    })
    .returning({ id: topOfMinds.id, version: topOfMinds.version });
  if (!created) throw new Error("Failed to insert top of mind version");

  if (input.previous) {
    await tx
      .update(topOfMinds)
      .set({ replacedById: created.id })
      .where(eq(topOfMinds.id, input.previous.id));
  }

  for (const [index, entry] of input.entries.entries()) {
    const [insertedEntry] = await tx
      .insert(topOfMindEntries)
      .values({
        topOfMindId: created.id,
        type: entry.type,
        body: entry.body,
        belief: entry.belief,
        prompt: entry.prompt,
        lockedAt: entry.lockedAt,
        pinnedAt: entry.pinnedAt,
        dismissedAt: entry.dismissedAt,
        sortOrder: index,
      })
      .returning({ id: topOfMindEntries.id });
    if (!insertedEntry) throw new Error("Failed to insert top of mind entry");

    if (entry.citedSignalIds.length > 0) {
      await tx
        .insert(topOfMindEntrySignals)
        .values(
          entry.citedSignalIds.map((signalId) => ({
            entryId: insertedEntry.id,
            signalId,
          })),
        )
        .onConflictDoNothing();
    }
  }

  return created;
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/** Newest verdicts, with the text each one was about, bounded for the prompt. */
const RECENT_FEEDBACK_LIMIT = 20;

async function loadRecentFeedback(
  db: WakaDb,
  profileId: string,
): Promise<TopOfMindRecentFeedback[]> {
  const rows = await db
    .select({
      targetType: feedback.targetType,
      targetId: feedback.targetId,
      value: feedback.value,
      correctionText: feedback.correctionText,
    })
    .from(feedback)
    .where(eq(feedback.profileId, profileId))
    .orderBy(desc(feedback.createdAt))
    .limit(RECENT_FEEDBACK_LIMIT);
  if (rows.length === 0) return [];

  const signalIds = rows
    .filter((row) => row.targetType === "signal")
    .map((row) => row.targetId);
  const entryIds = rows
    .filter((row) => row.targetType === "top_of_mind_entry")
    .map((row) => row.targetId);

  const statements = signalIds.length
    ? await db
        .select({ id: signals.id, statement: signals.statement })
        .from(signals)
        .where(inArray(signals.id, signalIds))
    : [];
  const bodies = entryIds.length
    ? await db
        .select({ id: topOfMindEntries.id, body: topOfMindEntries.body })
        .from(topOfMindEntries)
        .where(inArray(topOfMindEntries.id, entryIds))
    : [];

  const aboutById = new Map<string, string>();
  for (const row of statements) aboutById.set(row.id, row.statement);
  for (const row of bodies) aboutById.set(row.id, row.body);

  return rows.flatMap((row) => {
    const about = aboutById.get(row.targetId);
    // A verdict on something since deleted still shaped the person's history,
    // but without its text the model would be reasoning about a blank.
    if (!about) return [];
    return [
      {
        target: row.targetType === "signal" ? ("signal" as const) : ("entry" as const),
        about,
        value: row.value,
        correction: row.correctionText,
      },
    ];
  });
}

export async function refreshTopOfMindForProfile(
  input: RefreshTopOfMindInput,
  deps: TopOfMindRefreshDependencies = {},
): Promise<TopOfMindRefreshResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const provider = deps.modelProvider ?? (await getDefaultModelProvider());

  const [profileRows, selected, liveBefore] = await Promise.all([
    db
      .select({ preferredLocale: profiles.preferredLocale })
      .from(profiles)
      .where(eq(profiles.id, input.profileId))
      .limit(1),
    selectSignals(db, input.profileId, now),
    loadLiveArtifact(db, input.profileId),
  ]);

  if (selected.length === 0 && liveBefore === null) {
    // There is no artifact and nothing to make one from. Recording versions
    // of nothing would fill the chain with entries that say only that the
    // profile is new.
    return {
      status: "nothing_to_synthesize",
      topOfMindId: null,
      version: 0,
      reason: null,
      entryCount: 0,
      droppedCitations: 0,
      lockViolations: 0,
    };
  }

  const lockedBefore = (liveBefore?.entries ?? []).filter(
    (entry) => entry.lockedAt !== null && entry.dismissedAt === null,
  );

  let generated: TopOfMindSynthesisEntry[] = [];
  let modelSaidNoChange = false;
  let droppedCitations = 0;
  let lockViolations = 0;

  if (selected.length > 0) {
    const recentFeedback = await loadRecentFeedback(db, input.profileId);
    const synthesis = await provider.synthesizeTopOfMind({
      recentFeedback,
      profileId: input.profileId,
      preferredLocale: normalizeSupportedLocale(profileRows[0]?.preferredLocale),
      signals: selected.map((signal) => ({
        id: signal.id,
        statement: signal.statement,
        confidence: signal.confidence,
        evidenceCount: signal.evidenceCount,
        lastEvidenceAt: signal.lastEvidenceAt,
      })),
      lockedEntries: lockedBefore.map((entry, index) => ({
        id: `${liveBefore?.id ?? "pending"}:${index}`,
        type: entry.type,
        body: entry.body,
        belief: entry.belief,
        prompt: entry.prompt,
        citedSignalIds: entry.citedSignalIds,
      })),
      currentEntries: (liveBefore?.entries ?? [])
        .filter((entry) => entry.dismissedAt === null)
        .map((entry) => ({
          type: entry.type,
          body: entry.body,
          citedSignalIds: entry.citedSignalIds,
        })),
    });

    modelSaidNoChange = synthesis.noChange === true;
    lockViolations = countLockViolations(lockedBefore, synthesis.entries);
    if (lockViolations > 0) {
      console.warn("[top-of-mind] model did not reproduce locked entries verbatim", {
        profileId: input.profileId,
        lockViolations,
      });
    }

    const validated = validateSynthesizedEntries(
      synthesis.entries,
      new Set(selected.map((signal) => signal.id)),
    );
    generated = validated.entries;
    droppedCitations = validated.droppedCitations;
    if (droppedCitations > 0) {
      console.warn("[top-of-mind] dropped citations the profile does not hold", {
        profileId: input.profileId,
        droppedCitations,
      });
    }
  }

  const written = await db.transaction(async (tx) => {
    await acquireTopOfMindArtifactLock(tx, { profileId: input.profileId });

    // Re-read under the lock. Another pass may have landed a version while
    // this one was waiting on the provider, and the human decisions on that
    // newer version are the ones that must be carried forward.
    const previous = await loadLiveArtifact(tx, input.profileId);

    // No eligible signals and an artifact already standing: nothing was
    // synthesized, so nothing is known to have moved. Carrying the previous
    // version forward whole is the honest record of that. Dropping its
    // generated entries here would empty someone's top of mind on a
    // technicality, without a single model call having been made.
    const nothingReconsidered = selected.length === 0 && previous !== null;
    const entries = nothingReconsidered
      ? carryEverything(previous)
      : assembleEntries({ carried: previous?.entries ?? [], generated });

    const unchanged =
      previous !== null &&
      (nothingReconsidered || modelSaidNoChange || isUnchanged(previous.entries, entries));
    const reason: TopOfMindRevisionReason = previous === null
      ? "initial"
      : unchanged
        ? "no_change"
        : "regenerated";

    const created = await writeVersion(tx, {
      profileId: input.profileId,
      previous,
      entries,
      reason,
      now,
    });

    return { created, reason, entryCount: entries.length };
  });

  return {
    status: "versioned",
    topOfMindId: written.created.id,
    version: written.created.version,
    reason: written.reason,
    entryCount: written.entryCount,
    droppedCitations,
    lockViolations,
  };
}

/**
 * The group artifact is generated from members' shared signals rather than a
 * profile's own, and its co-editing mechanism (proposals, affirmations) is a
 * different versioning story. The seam exists so the queue can route the job
 * type today and the behaviour can land without touching the router.
 */
export async function refreshTopOfMindForGroup(input: {
  groupId: string;
  reason: string;
}): Promise<{ status: "not_implemented"; groupId: string }> {
  console.log("[top-of-mind] group synthesis is not wired yet", {
    groupId: input.groupId,
    reason: input.reason,
  });
  return { status: "not_implemented", groupId: input.groupId };
}
