/**
 * Layer 3 — synthesizing a top of mind: one profile's, or one group's.
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

import { and, asc, desc, eq, inArray, isNull, ne } from "drizzle-orm";

import {
  groupMembers,
  groups,
  groupTopOfMindProposals,
  inspirations,
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
import { computeSignalConfidence } from "./signal-derivation.js";
import { GROUP_SIGNAL_MIN_VOICES } from "./signal-derivation-thresholds.js";
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

/**
 * Below this many active signals, the selection reaches into `emerging` ones
 * to reach a small artifact. It exists for the cold start: a signal needs
 * three pieces of evidence to become active, and a new profile rarely says
 * the same thing three ways in its first sitting, so an active-only selection
 * leaves it staring at nothing. A handful of forming patterns *is* what
 * currently matters to someone who just arrived — shown tentatively, and
 * superseded the moment real patterns cross the bar.
 *
 * The floor is also the ceiling on how far emerging reaches: once a profile
 * has this many active signals, emerging ones never appear, so an established
 * artifact is never diluted with single-observation noise.
 */
export const TOP_OF_MIND_MIN_SIGNALS = 3;

interface SelectionOutcome {
  signals: SelectedSignal[];
  /** True when the selection leaned on emerging signals to fill the floor. */
  provisional: boolean;
}

async function selectSignals(
  db: WakaDb,
  profileId: string,
  now: Date,
): Promise<SelectionOutcome> {
  const rows = await db
    .select({
      id: signals.id,
      statement: signals.statement,
      status: signals.status,
      confidence: signals.confidence,
      lastEvidenceAt: signals.lastEvidenceAt,
    })
    .from(signals)
    .where(
      and(
        eq(signals.profileId, profileId),
        inArray(signals.status, ["active", "emerging"]),
        // A locked statement with no support left is still the owner's text,
        // but it is not evidence of anything current, and the artifact is a
        // claim about what is current.
        isNull(signals.unsupportedAt),
      ),
    )
    .orderBy(desc(signals.confidence), desc(signals.lastEvidenceAt));

  if (rows.length === 0) return { signals: [], provisional: false };

  const evidenceRows = await db
    .select({
      signalId: signalEvidence.signalId,
      createdAt: inspirations.createdAt,
      source: inspirations.source,
    })
    .from(signalEvidence)
    .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
    .where(
      inArray(
        signalEvidence.signalId,
        rows.map((row) => row.id),
      ),
    );

  const evidenceBySignal = new Map<
    string,
    Array<{ createdAt: Date; source: "app" | "agent" }>
  >();
  for (const row of evidenceRows) {
    const bucket = evidenceBySignal.get(row.signalId);
    if (bucket) bucket.push(row);
    else evidenceBySignal.set(row.signalId, [row]);
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

  const scored = rows
    .map((row) => {
      const evidence = evidenceBySignal.get(row.id) ?? [];
      const evidenceAt = evidence.map((item) => item.createdAt);
      // Live, not the stored snapshot: the snapshot was written the moment
      // evidence last landed — its decay term frozen at full — so ranking by
      // it would keep a signal that went quiet months ago scoring as if it
      // were still current. Time only passes for this signal if it passes
      // here, at read.
      const confidence = computeSignalConfidence(evidence, now);
      return {
        id: row.id,
        statement: row.statement,
        status: row.status,
        confidence,
        evidenceCount: evidenceAt.length,
        lastEvidenceAt: row.lastEvidenceAt,
        score: computeSelectionScore({
          confidence,
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
    });

  const strip = (s: (typeof scored)[number]): SelectedSignal => ({
    id: s.id,
    statement: s.statement,
    confidence: s.confidence,
    evidenceCount: s.evidenceCount,
    lastEvidenceAt: s.lastEvidenceAt,
    score: s.score,
  });

  const chosen = chooseSelection(
    scored.filter((s) => s.status === "active"),
    scored.filter((s) => s.status === "emerging"),
  );
  return { signals: chosen.signals.map(strip), provisional: chosen.provisional };
}

/**
 * The cold-start rule, isolated from the database so it can be reasoned about
 * directly. Both lists arrive already ranked, strongest first.
 *
 * With enough durable patterns, the artifact is those alone — identical to
 * the behaviour before the cold start existed, so an established profile is
 * never diluted with single-observation noise. Below the floor, the selection
 * borrows the strongest forming patterns, and only enough to reach the floor,
 * and reports itself provisional so the synthesis writes tentatively.
 */
export function chooseSelection<T>(
  active: T[],
  emerging: T[],
): { signals: T[]; provisional: boolean } {
  if (active.length >= TOP_OF_MIND_MIN_SIGNALS) {
    return { signals: active.slice(0, TOP_OF_MIND_SIGNAL_LIMIT), provisional: false };
  }
  const backfill = emerging.slice(0, Math.max(0, TOP_OF_MIND_MIN_SIGNALS - active.length));
  return { signals: [...active, ...backfill], provisional: backfill.length > 0 };
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
    if (row.signalId === null) continue;
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

  const [profileRows, selection, liveBefore] = await Promise.all([
    db
      .select({ preferredLocale: profiles.preferredLocale })
      .from(profiles)
      .where(eq(profiles.id, input.profileId))
      .limit(1),
    selectSignals(db, input.profileId, now),
    loadLiveArtifact(db, input.profileId),
  ]);
  const selected = selection.signals;
  const provisional = selection.provisional;

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
      provisional,
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

// ---------------------------------------------------------------------------
// The group pass
//
// Same artifact grammar, different subject and different hands. The signals
// are the ones members chose to put on the group's wall — an explicit act,
// so there is no scoring pass and no cold start: the wall IS the selection,
// capped at TOP_OF_MIND_SIGNAL_LIMIT by live confidence. And where a personal
// artifact is edited directly, a group's is edited by ACCEPTED PROPOSALS:
// each one applied here, deterministically, before the model writes anything
// — an accepted change is the members' own hand and never passes through a
// model. An applied edit locks its entry; an applied removal dismisses it;
// an applied addition arrives locked. From there the personal carry rules
// take over unchanged.
// ---------------------------------------------------------------------------

export interface GroupTopOfMindRefreshResult {
  status: "versioned" | "nothing_to_synthesize" | "waiting_for_affirmations";
  topOfMindId: string | null;
  version: number;
  reason: TopOfMindRevisionReason | null;
  entryCount: number;
  /** Accepted proposals materialized into this version. */
  appliedProposals: number;
  droppedCitations: number;
}

interface GroupCarriedEntry extends CarriedEntry {
  /** Null for an entry added by proposal in this very pass. */
  id: string | null;
}

interface GroupLiveArtifactSnapshot {
  id: string;
  version: number;
  createdAt: Date;
  entries: GroupCarriedEntry[];
  /** signalId → the member whose signal it was when cited. */
  citationOwners: Map<string, string>;
}

interface GroupSharedSignal {
  id: string;
  statement: string;
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  /**
   * Null since 2026-08-24: a ROOM-GROWN signal belongs to the mind of the
   * group, not to any member. The type name kept "Shared" through the
   * transition so every reader did not churn in one commit; the loader
   * below says what actually fills it now.
   */
  ownerProfileId: string | null;
  /** whose memories stand under it (room-grown); empty for legacy rows */
  contributorNames: string[];
}

export interface GroupProposalToApply {
  kind: "edit_entry" | "add_entry" | "remove_entry";
  entryId: string | null;
  body: string | null;
}

/**
 * Materialize accepted proposals into the carried set. Pure, so the three
 * rules — edit rewrites and locks, removal dismisses, addition arrives
 * locked — are testable without a database. A proposal aimed at an entry
 * that no longer exists is skipped and not counted: its target left before
 * the decision could land, and inventing a place for it would be worse.
 */
export function applyGroupProposals(
  carried: GroupCarriedEntry[],
  proposals: GroupProposalToApply[],
  now: Date,
): { entries: GroupCarriedEntry[]; applied: number } {
  const entries = carried.map((entry) => ({ ...entry }));
  let applied = 0;
  let nextSort = entries.reduce((max, entry) => Math.max(max, entry.sortOrder), -1) + 1;

  for (const proposal of proposals) {
    if (proposal.kind === "add_entry") {
      const body = proposal.body?.trim();
      if (!body) continue;
      entries.push({
        id: null,
        type: "pattern",
        body,
        belief: null,
        prompt: null,
        lockedAt: now,
        pinnedAt: null,
        dismissedAt: null,
        sortOrder: nextSort,
        citedSignalIds: [],
      });
      nextSort += 1;
      applied += 1;
      continue;
    }

    const target = entries.find((entry) => entry.id !== null && entry.id === proposal.entryId);
    if (!target) continue;

    if (proposal.kind === "remove_entry") {
      target.dismissedAt = now;
      applied += 1;
    } else {
      const body = proposal.body?.trim();
      if (!body) continue;
      target.body = body;
      target.lockedAt = now;
      applied += 1;
    }
  }

  return { entries, applied };
}

async function loadLiveGroupArtifact(
  db: WakaDb | WakaTx,
  groupId: string,
): Promise<GroupLiveArtifactSnapshot | null> {
  const [artifact] = await db
    .select({
      id: topOfMinds.id,
      version: topOfMinds.version,
      createdAt: topOfMinds.createdAt,
    })
    .from(topOfMinds)
    .where(and(eq(topOfMinds.groupId, groupId), eq(topOfMinds.status, "live")))
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
            ownerProfileId: topOfMindEntrySignals.ownerProfileId,
          })
          .from(topOfMindEntrySignals)
          .where(
            inArray(
              topOfMindEntrySignals.entryId,
              entryRows.map((row) => row.id),
            ),
          );

  const citationsByEntry = new Map<string, string[]>();
  const citationOwners = new Map<string, string>();
  for (const row of citationRows) {
    if (row.signalId === null) continue;
    const bucket = citationsByEntry.get(row.entryId);
    if (bucket) bucket.push(row.signalId);
    else citationsByEntry.set(row.entryId, [row.signalId]);
    if (row.ownerProfileId) citationOwners.set(row.signalId, row.ownerProfileId);
  }

  return {
    id: artifact.id,
    version: artifact.version,
    createdAt: artifact.createdAt,
    citationOwners,
    entries: entryRows.map((row) => ({
      id: row.id,
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

/**
 * THE WALL IS THE SELECTION — and the wall is the ROOM'S OWN LAYER 2 now
 * (founder rulings, 2026-08-24). This reads the live signals of the group's
 * mind, gated exactly as the wall gates them: at least
 * `GROUP_SIGNAL_MIN_VOICES` distinct CURRENT members' memories under each.
 * A one-member pattern is that member's own, and a departed member's voice
 * no longer carries — the same withdrawal rule the share wall applied.
 * Confidence is computed live from the evidence rows, which this loader may
 * now touch because they are the room's rows.
 */
async function loadGroupSharedSignals(
  db: WakaDb,
  groupId: string,
  now: Date,
): Promise<GroupSharedSignal[]> {
  const mindRows = await db
    .select({ mindId: profiles.id })
    .from(profiles)
    .where(and(eq(profiles.groupId, groupId), eq(profiles.type, "group")))
    .limit(1);
  const mind = mindRows[0];
  if (!mind) return [];

  const rows = await db
    .select({
      id: signals.id,
      statement: signals.statement,
      lastEvidenceAt: signals.lastEvidenceAt,
    })
    .from(signals)
    .where(
      and(
        eq(signals.profileId, mind.mindId),
        ne(signals.status, "retired"),
        isNull(signals.dismissedAt),
      ),
    );
  if (rows.length === 0) return [];

  const evidenceRows = await db
    .select({
      signalId: signalEvidence.signalId,
      createdAt: signalEvidence.createdAt,
      source: inspirations.source,
      visibility: inspirations.visibility,
      ownerProfileId: signalEvidence.ownerProfileId,
      ownerName: profiles.name,
      memberProfileId: groupMembers.profileId,
    })
    .from(signalEvidence)
    .innerJoin(inspirations, eq(inspirations.id, signalEvidence.inspirationId))
    .innerJoin(profiles, eq(profiles.id, signalEvidence.ownerProfileId))
    .leftJoin(
      groupMembers,
      and(
        eq(groupMembers.groupId, groupId),
        eq(groupMembers.profileId, signalEvidence.ownerProfileId),
      ),
    )
    .where(
      inArray(
        signalEvidence.signalId,
        rows.map((row) => row.id),
      ),
    );

  const evidenceBySignal = new Map<
    string,
    Array<{ createdAt: Date; source: "app" | "agent" }>
  >();
  const voicesBySignal = new Map<string, Map<string, string>>();
  for (const row of evidenceRows) {
    const bucket = evidenceBySignal.get(row.signalId);
    if (bucket) bucket.push(row);
    else evidenceBySignal.set(row.signalId, [row]);
    /* a voice counts only while its member is in the room AND the memory
       behind it is still public: sharing IS visibility, so taking a memory
       private has to take its voice out of the room's count too. Read here
       rather than withdrawn from the table, so flipping public again puts
       the voice back. */
    if (row.memberProfileId && row.visibility === "public") {
      const voices = voicesBySignal.get(row.signalId) ?? new Map<string, string>();
      voices.set(row.ownerProfileId, row.ownerName);
      voicesBySignal.set(row.signalId, voices);
    }
  }

  return rows
    .flatMap((row) => {
      const voices = voicesBySignal.get(row.id);
      if (!voices || voices.size < GROUP_SIGNAL_MIN_VOICES) return [];
      const evidence = evidenceBySignal.get(row.id) ?? [];
      return [
        {
          id: row.id,
          statement: row.statement,
          confidence: computeSignalConfidence(evidence, now),
          evidenceCount: evidence.length,
          lastEvidenceAt: row.lastEvidenceAt,
          ownerProfileId: null,
          contributorNames: [...voices.values()],
        },
      ];
    })
    .sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return a.id < b.id ? -1 : 1;
    })
    .slice(0, TOP_OF_MIND_SIGNAL_LIMIT);
}

/** Accepted proposals not yet materialized: resolved after the live version was written. */
async function loadUnappliedProposals(
  db: WakaDb | WakaTx,
  groupId: string,
  since: Date | null,
): Promise<GroupProposalToApply[]> {
  const rows = await db
    .select({
      kind: groupTopOfMindProposals.kind,
      entryId: groupTopOfMindProposals.entryId,
      body: groupTopOfMindProposals.body,
      resolvedAt: groupTopOfMindProposals.resolvedAt,
    })
    .from(groupTopOfMindProposals)
    .where(
      and(
        eq(groupTopOfMindProposals.groupId, groupId),
        eq(groupTopOfMindProposals.status, "accepted"),
      ),
    )
    .orderBy(asc(groupTopOfMindProposals.resolvedAt));

  return rows
    .filter((row) => row.resolvedAt !== null && (since === null || row.resolvedAt > since))
    .map((row) => ({ kind: row.kind, entryId: row.entryId, body: row.body }));
}

function carryCarriedEntries(entries: GroupCarriedEntry[]): PersistedEntry[] {
  return [...entries]
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

async function writeGroupVersion(
  tx: WakaTx,
  input: {
    groupId: string;
    previous: GroupLiveArtifactSnapshot | null;
    entries: PersistedEntry[];
    reason: TopOfMindRevisionReason;
    /** signalId → member, for citation attribution on group entries. */
    ownerBySignalId: Map<string, string>;
    now: Date;
  },
): Promise<{ id: string; version: number }> {
  if (input.previous) {
    await tx
      .update(topOfMinds)
      .set({ status: "superseded", replacedAt: input.now })
      .where(eq(topOfMinds.id, input.previous.id));
  }

  const [created] = await tx
    .insert(topOfMinds)
    .values({
      groupId: input.groupId,
      version: (input.previous?.version ?? 0) + 1,
      status: "live",
      reason: input.reason,
    })
    .returning({ id: topOfMinds.id, version: topOfMinds.version });
  if (!created) throw new Error("Failed to insert group top of mind version");

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
    if (!insertedEntry) throw new Error("Failed to insert group top of mind entry");

    if (entry.citedSignalIds.length > 0) {
      await tx
        .insert(topOfMindEntrySignals)
        .values(
          entry.citedSignalIds.map((signalId) => ({
            entryId: insertedEntry.id,
            signalId,
            ownerProfileId: input.ownerBySignalId.get(signalId) ?? null,
          })),
        )
        .onConflictDoNothing();
    }
  }

  return created;
}

/**
 * A ROOM'S FIRST DRAFT WAITS FOR AFFIRMED MATERIAL.
 *
 * The goal's rule: synthesis fires on accumulated evidence, never on a clock
 * or a button — a cadence would draft from thin evidence in a slow week,
 * which is exactly how ungrounded statements reach a sky. The same shape as
 * `emerging → active` at 3, one level up: a shared statement is AFFIRMED
 * when at least one current member other than its owner has said "true" of
 * it (their latest verdict is the one that stands — a later "not true"
 * withdraws the affirmation), and the room's FIRST generative draft waits
 * until GROUP_DRAFT_MIN_AFFIRMED shared statements are affirmed.
 *
 * Only the first model draft is gated. An established room re-reads its
 * standing artifact as shares and verdicts move — that is maintenance of
 * something the room already said, not the room speaking first. And member
 * decisions are NEVER gated: an accepted proposal materializes a version
 * whatever the count, because the members speaking directly is the strongest
 * evidence there is.
 */
export const GROUP_DRAFT_MIN_AFFIRMED = 3;

async function countAffirmedSharedSignals(
  db: WakaDb,
  groupId: string,
  shared: GroupSharedSignal[],
): Promise<number> {
  if (shared.length === 0) return 0;
  const rows = await db
    .select({
      targetId: feedback.targetId,
      reactorProfileId: feedback.profileId,
      value: feedback.value,
    })
    .from(feedback)
    .innerJoin(
      groupMembers,
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.profileId, feedback.profileId)),
    )
    .where(
      and(
        eq(feedback.targetType, "signal"),
        inArray(
          feedback.targetId,
          shared.map((signal) => signal.id),
        ),
      ),
    )
    .orderBy(desc(feedback.createdAt));

  const ownerBySignal = new Map(shared.map((signal) => [signal.id, signal.ownerProfileId]));
  const seenPair = new Set<string>();
  const affirmedSignals = new Set<string>();
  // Newest-first: the first (signal, reactor) pair seen is the standing verdict.
  for (const row of rows) {
    if (ownerBySignal.get(row.targetId) === row.reactorProfileId) continue;
    const pair = `${row.targetId}:${row.reactorProfileId}`;
    if (seenPair.has(pair)) continue;
    seenPair.add(pair);
    if (row.value === "true") affirmedSignals.add(row.targetId);
  }
  return affirmedSignals.size;
}

export async function refreshTopOfMindForGroup(
  input: { groupId: string; reason: string },
  deps: TopOfMindRefreshDependencies = {},
): Promise<GroupTopOfMindRefreshResult> {
  const db = deps.db ?? getDb();
  const now = deps.now ?? new Date();
  const provider = deps.modelProvider ?? (await getDefaultModelProvider());

  const nothing: GroupTopOfMindRefreshResult = {
    status: "nothing_to_synthesize",
    topOfMindId: null,
    version: 0,
    reason: null,
    entryCount: 0,
    appliedProposals: 0,
    droppedCitations: 0,
  };

  const [groupRows, memberRows] = await Promise.all([
    db
      .select({
        id: groups.id,
        name: groups.name,
        createdByProfileId: groups.createdByProfileId,
      })
      .from(groups)
      .where(eq(groups.id, input.groupId))
      .limit(1),
    db
      .select({
        profileId: groupMembers.profileId,
        name: profiles.name,
        preferredLocale: profiles.preferredLocale,
      })
      .from(groupMembers)
      .innerJoin(profiles, eq(profiles.id, groupMembers.profileId))
      .where(eq(groupMembers.groupId, input.groupId)),
  ]);
  const group = groupRows[0];
  // The group can be deleted while the job sits in the queue; that is a
  // no-op, not an error.
  if (!group || memberRows.length === 0) return nothing;

  const [shared, liveBefore] = await Promise.all([
    loadGroupSharedSignals(db, input.groupId, now),
    loadLiveGroupArtifact(db, input.groupId),
  ]);
  const pending = await loadUnappliedProposals(db, input.groupId, liveBefore?.createdAt ?? null);

  if (shared.length === 0 && liveBefore === null && pending.length === 0) {
    return nothing;
  }

  // The first-draft gate. Legible silence rather than a silent pass: the
  // caller learns the room is waiting, not that there was nothing to say.
  let waitingForAffirmations = false;
  if (liveBefore === null && shared.length > 0) {
    const affirmed = await countAffirmedSharedSignals(db, input.groupId, shared);
    if (affirmed < GROUP_DRAFT_MIN_AFFIRMED) {
      if (pending.length === 0) {
        return { ...nothing, status: "waiting_for_affirmations" };
      }
      // Accepted proposals still materialize — the members spoke directly —
      // but the model does not draft alongside them yet.
      waitingForAffirmations = true;
    }
  }

  // Members' decisions land before the model writes a word.
  const appliedBefore = applyGroupProposals(liveBefore?.entries ?? [], pending, now);
  const lockedNow = appliedBefore.entries.filter(
    (entry) => entry.lockedAt !== null && entry.dismissedAt === null,
  );

  const memberNameById = new Map(memberRows.map((row) => [row.profileId, row.name]));
  // The room speaks in its host's language until groups carry their own.
  const hostLocale = normalizeSupportedLocale(
    (
      memberRows.find((row) => row.profileId === group.createdByProfileId) ?? memberRows[0]
    )?.preferredLocale,
  );

  let generated: TopOfMindSynthesisEntry[] = [];
  let modelSaidNoChange = false;
  let droppedCitations = 0;

  if (shared.length > 0 && !waitingForAffirmations) {
    const synthesis = await provider.synthesizeTopOfMind({
      profileId: input.groupId,
      preferredLocale: hostLocale,
      provisional: false,
      recentFeedback: [],
      group: {
        name: group.name,
        memberNames: memberRows.map((row) => row.name),
      },
      signals: shared.map((signal) => ({
        id: signal.id,
        statement: signal.statement,
        confidence: signal.confidence,
        evidenceCount: signal.evidenceCount,
        lastEvidenceAt: signal.lastEvidenceAt,
        /* a room-grown statement is the room's, standing on named voices; a
           legacy shared one still names its owner */
        ownerName:
          signal.ownerProfileId === null
            ? signal.contributorNames.join(" & ") || "the room"
            : memberNameById.get(signal.ownerProfileId) ?? "a former member",
      })),
      lockedEntries: lockedNow.map((entry, index) => ({
        id: `${liveBefore?.id ?? "pending"}:${index}`,
        type: entry.type,
        body: entry.body,
        belief: entry.belief,
        prompt: entry.prompt,
        citedSignalIds: entry.citedSignalIds,
      })),
      currentEntries: appliedBefore.entries
        .filter((entry) => entry.dismissedAt === null)
        .map((entry) => ({
          type: entry.type,
          body: entry.body,
          citedSignalIds: entry.citedSignalIds,
        })),
    });

    modelSaidNoChange = synthesis.noChange === true;
    const validated = validateSynthesizedEntries(
      synthesis.entries,
      new Set(shared.map((signal) => signal.id)),
    );
    generated = validated.entries;
    droppedCitations = validated.droppedCitations;
    if (droppedCitations > 0) {
      console.warn("[top-of-mind] dropped citations the group wall does not hold", {
        groupId: input.groupId,
        droppedCitations,
      });
    }
  }

  const written = await db.transaction(async (tx) => {
    await acquireTopOfMindArtifactLock(tx, { groupId: input.groupId });

    // Re-read under the lock, same as the personal pass: a version may have
    // landed while this one waited on the provider, and the members'
    // decisions on that newer version are the ones that must carry.
    const previous = await loadLiveGroupArtifact(tx, input.groupId);
    const proposals = await loadUnappliedProposals(
      tx,
      input.groupId,
      previous?.createdAt ?? null,
    );
    const applied = applyGroupProposals(previous?.entries ?? [], proposals, now);

    const nothingReconsidered = shared.length === 0 && previous !== null;
    const entries = nothingReconsidered
      ? carryCarriedEntries(applied.entries)
      : assembleEntries({ carried: applied.entries, generated });

    const unchanged =
      previous !== null &&
      applied.applied === 0 &&
      (nothingReconsidered || modelSaidNoChange || isUnchanged(previous.entries, entries));
    const reason: TopOfMindRevisionReason =
      previous === null
        ? "initial"
        : applied.applied > 0
          ? "member_proposal"
          : unchanged
            ? "no_change"
            : "regenerated";

    const ownerBySignalId = new Map<string, string>(previous?.citationOwners ?? []);
    for (const signal of shared) {
      /* a room-grown signal has no single owner: its citation row carries a
         null owner and the board derives contributors from the evidence */
      if (signal.ownerProfileId !== null) ownerBySignalId.set(signal.id, signal.ownerProfileId);
    }

    const created = await writeGroupVersion(tx, {
      groupId: input.groupId,
      previous,
      entries,
      reason,
      ownerBySignalId,
      now,
    });

    return { created, reason, entryCount: entries.length, applied: applied.applied };
  });

  return {
    status: "versioned",
    topOfMindId: written.created.id,
    version: written.created.version,
    reason: written.reason,
    entryCount: written.entryCount,
    appliedProposals: written.applied,
    droppedCitations,
  };
}
