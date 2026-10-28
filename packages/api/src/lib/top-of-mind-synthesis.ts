/**
 * Layer 3 — synthesizing one profile's top of mind.
 *
 * (The group pass, `refreshTopOfMindForGroup`, was deleted with the room
 * engine on 2026-10-17. Rooms' stored artifacts are kept as data; nothing
 * regenerates them. See docs/map.md.)
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

import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { readGenerationRevision, assertGenerationRevision } from "./generation-revision.js";
import { personalEntryReadable, personalSignalReadable, projectPersonalEntries } from "./personal-output.js";
import { feedbackWordingCurrent } from './feedback-revisions.js';
import { assertSignalSupportSettled, loadSignalStatementRevisions } from './signal-support-state.js';
import { BackgroundJobHeldError } from './background-job-hold.js';

import {
  signalEmbeddings,
  profiles,
  signals,
  topOfMindEntries,
  topOfMindEntrySignals,
  topOfMinds,
  type TopOfMindEntryType,
  type TopOfMindRevisionReason,
  type BackgroundJobResult,
  feedback,
  signalContradictions,
  inspirations,
  reflections,
  attachments,
} from "../db/index.js";
import { cosineSimilarity } from "../scoring/vector.js";
import { hashEmbeddingInput } from "./inspiration-embeddings.js";
import { getDb } from "./db.js";
import { computeSignalConfidence, selectIndependentEvidence, type ConfidenceEvidence } from "./signal-lifecycle.js";
import {loadSignalEvidence} from './review-evidence.js';
import { normalizeSupportedLocale } from "./locales.js";
import {
  getDefaultModelProvider,
  type ModelProvider,
  type TopOfMindSynthesisEntry,
  type TopOfMindRecentFeedback,
} from "./model-provider.js";
import { acquireTopOfMindArtifactLock } from "./top-of-mind-family-lock.js";
import { effectiveAttachmentText, effectiveAttachmentStatus } from './attachment-material.js';
import { distinctReadingOrigins, readingQualityIssue, reviewReadingEntries, type TopOfMindQualityContext } from './top-of-mind-quality.js';

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

/**
 * NO TWO VOICES ON THE BOARD SAYING ONE THING. Selection is score-ranked, and
 * a dominant theme can spend every slot restating itself — twelve sentences
 * about work is not a top of MIND. At or above this cosine, two candidates
 * are close enough that the judge band would already be asking whether they
 * are the same pattern (0.70–0.86, docs/generation.md §4), so the stronger
 * one holds the slot. A shorter board is preferable to filling empty slots
 * with echoes. The signals remain in memory, not deleted or demoted.
 * Deliberately conservative: genuinely different signals about one theme
 * (0.5–0.7 apart) are untouched until the funnel earns a lower bar.
 */
export const SELECTION_DIVERSITY_MAX_COSINE = 0.8;

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

/**
 * THE FLOOR: the top of mind shifts at most once a day.
 *
 * The founder's intended behavior (2026-08-31): inspirations shape the
 * artifact naturally, but the artifact holds still — a board that rewrites
 * itself three times over one active morning (observed live, 2026-08-30:
 * versions 1→3 in ninety seconds) is a ticker, not a top of mind. The floor
 * is queue arithmetic, never model behavior: a `signals_changed` refresh
 * that arrives while the latest CONTENT version (reason ≠ no_change) is
 * younger than this many hours is HELD — its row sleeps until the floor
 * opens, further enqueues collapse into it, and the signals keep accruing
 * underneath so the one shift that lands reads everything.
 *
 * `manual` refreshes never wait: the person's own "Read it again" and a
 * language change are the user moving the world, and the machine holds a
 * day while the person never does. A profile with no content version yet
 * has nothing to hold stable — the cold start is exempt.
 */
export const TOP_OF_MIND_MIN_SHIFT_HOURS = 24;

const SHIFT_FLOOR_MS = TOP_OF_MIND_MIN_SHIFT_HOURS * 60 * 60 * 1000;

export type ShiftFloorVerdict = { held: false } | { held: true; heldUntil: Date };

/** Pure: the rule alone, so the boundary can be tested without a database. */
export function assessShiftFloor(
  lastContentShiftAt: Date | null,
  now: Date,
): ShiftFloorVerdict {
  if (lastContentShiftAt === null) return { held: false };
  const opensAt = lastContentShiftAt.getTime() + SHIFT_FLOOR_MS;
  if (now.getTime() >= opensAt) return { held: false };
  return { held: true, heldUntil: new Date(opensAt) };
}

/**
 * Thrown by the refresh when the floor holds. The drain catches it and puts
 * the job back to sleep (pending, run_after = heldUntil, attempts untouched)
 * — a hold, not a failure, exactly as the model budget defers.
 */
export class ShiftFloorHeldError extends BackgroundJobHeldError {
  constructor(heldUntil: Date) {
    super(heldUntil, `top-of-mind shift floor holds until ${heldUntil.toISOString()}`, 'cadence');
    this.name = "ShiftFloorHeldError";
  }
}

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
  /** Worker claim fence, inside the final transaction after input validation. */
  beforeCommit?: (tx: Pick<WakaTx, "select">) => Promise<void>;
  onPublished?: (tx: WakaTx, publication: { profileId: string; result: BackgroundJobResult }) => Promise<void>;
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
  status: 'active' | 'emerging';
  confidence: number;
  evidenceCount: number;
  lastEvidenceAt: Date | null;
  score: number;
  /** the pattern's life in time, worded — see describeTimeShape */
  timeShape: string | null;
  /** open contested pairs whose other side is ALSO in this selection —
      the only ids the model may cite, so a one-sided mark never exists */
  contestedWithIds?: string[];
}

const TIME_SHAPE_MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A pattern's life in time, said in words the synthesis can use — because
 * "top of MIND" is a claim about now, and the model was reading a bare
 * ISO timestamp per signal and could not tell a pattern that has held for a
 * year from one that appeared on Tuesday, or a comeback from a steady hum.
 * Deterministic arithmetic over the evidence dates; English tokens on
 * purpose (this is prompt-internal metadata — the Locale line governs what
 * the ARTIFACT speaks).
 */
export function describeTimeShape(evidenceAt: Date[], now: Date): string | null {
  if (evidenceAt.length === 0) return null;
  const times = evidenceAt.map((d) => d.getTime()).sort((a, b) => a - b);
  const first = times[0]!;
  const last = times[times.length - 1]!;
  const ageDays = Math.max(0, (now.getTime() - first) / TIME_SHAPE_MS_PER_DAY);
  const quietDays = Math.max(0, (now.getTime() - last) / TIME_SHAPE_MS_PER_DAY);

  const span = (days: number): string => {
    const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
    if (days < 14) return unit(Math.max(1, Math.round(days)), "day");
    if (days < 60) return unit(Math.max(1, Math.round(days / 7)), "week");
    if (days < 400) return unit(Math.max(1, Math.round(days / 30)), "month");
    return "over a year";
  };

  if (ageDays < 7) return "new this week";

  /* a return: the latest evidence is fresh, and the gap it ended was long —
     the same dormancy bar the selection's comeback bonus uses */
  if (times.length >= 2 && quietDays <= COMEBACK_MAX_RETURN_AGE_DAYS) {
    const previous = times[times.length - 2]!;
    const gapDays = (last - previous) / TIME_SHAPE_MS_PER_DAY;
    if (gapDays >= COMEBACK_MIN_DORMANT_DAYS) {
      return `returning after ${span(gapDays)} quiet`;
    }
  }

  return `held for ${span(ageDays)}; last fed ${span(quietDays)} ago`;
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
  supportChanged?: boolean;
}

interface LiveArtifactSnapshot {
  id: string;
  version: number;
  entries: CarriedEntry[];
  storedEntries: CarriedEntry[];
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
 * Established profiles also admit a bounded recent focus, but never a
 * single-observation emerging signal. Status is carried per signal so the
 * model does not weaken established patterns when one new interest arrives.
 */
export const TOP_OF_MIND_MIN_SIGNALS = 3;
export const TOP_OF_MIND_FOCUS_LIMIT = 3;
export const TOP_OF_MIND_FOCUS_DAYS = 14;
export const TOP_OF_MIND_EMERGING_MIN_EVIDENCE = 2;

interface SelectionOutcome {
  signals: SelectedSignal[];
  evidence: ReadonlyMap<string, ConfidenceEvidence[]>;
  /** All current standing disputes, including signals outside this pass. */
  contested: ReadonlyMap<string, readonly string[]>;
  /** True when the selection includes a still-forming interest. */
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
        personalSignalReadable(profileId),
        inArray(signals.status, ["active", "emerging"]),
        // A locked statement with no support left is still the owner's text,
        // but it is not evidence of anything current, and the artifact is a
        // claim about what is current.
        isNull(signals.unsupportedAt),
      ),
    )
    .orderBy(desc(signals.confidence), desc(signals.lastEvidenceAt));

  if (rows.length === 0) return { signals: [], evidence: new Map(), provisional: false, contested:new Map() };

  const {witnesses:evidenceBySignal}=await loadSignalEvidence(db,profileId,rows.map(row=>row.id));

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
        feedbackWordingCurrent(),
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
      const evidence = selectIndependentEvidence(evidenceBySignal.get(row.id) ?? []);
      const evidenceAt = evidence.map((item) => item.createdAt);
      // Live, not the stored snapshot: the snapshot was written the moment
      // evidence last landed — its decay term frozen at full — so ranking by
      // it would keep a signal that went quiet months ago scoring as if it
      // were still current. Time only passes for this signal if it passes
      // here, at read.
      const confidence = computeSignalConfidence(evidence, now, {
        affirmed: latestVerdict.get(row.id) === "true",
      });
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

  /* Open contested pairs, so the selection can keep both voices of a
     dispute together (goal: contested-speaks, 2026-08-31). Ordered for
     determinism — the pull below follows this order when one signal
     stands in several pairs. */
  const openPairs = await db
    .select({
      aSignalId: signalContradictions.aSignalId,
      bSignalId: signalContradictions.bSignalId,
    })
    .from(signalContradictions)
    .where(
      and(
        eq(signalContradictions.profileId, profileId),
        isNull(signalContradictions.resolvedAt),
      ),
    )
    .orderBy(asc(signalContradictions.createdAt), asc(signalContradictions.aSignalId));
  const opposing = new Map<string, string[]>();
  for (const pair of openPairs) {
    opposing.set(pair.aSignalId, [...(opposing.get(pair.aSignalId) ?? []), pair.bSignalId]);
    opposing.set(pair.bSignalId, [...(opposing.get(pair.bSignalId) ?? []), pair.aSignalId]);
  }

  const strip = (s: (typeof scored)[number], speaking: ReadonlySet<string>): SelectedSignal => {
    const contestedWithIds = (opposing.get(s.id) ?? []).filter((other) => speaking.has(other));
    return {
      id: s.id,
      statement: s.statement,
      status: s.status as 'active' | 'emerging',
      confidence: s.confidence,
      evidenceCount: s.evidenceCount,
      lastEvidenceAt: s.lastEvidenceAt,
      score: s.score,
      timeShape: describeTimeShape(
        (evidenceBySignal.get(s.id) ?? []).map((item) => item.createdAt),
        now,
      ),
      ...(contestedWithIds.length > 0 ? { contestedWithIds } : {}),
    };
  };

  /* the board's twelve slots are worth one bounded read of the candidate
     vectors — jsonb rows, cosine in process, no model anywhere */
  const embeddingRows = await db
    .select({ signalId: signalEmbeddings.signalId, inputHash: signalEmbeddings.inputHash, embedding: signalEmbeddings.embedding })
    .from(signalEmbeddings)
    .where(
      and(eq(signalEmbeddings.profileId, profileId), inArray(
        signalEmbeddings.signalId,
        scored.map((s) => s.id),
      )),
    );
  const embeddingById = new Map<string, number[]>();
  const currentHash = new Map(scored.map(row=>[row.id,hashEmbeddingInput(row.statement)]));
  for (const row of embeddingRows) {
    if (row.inputHash===currentHash.get(row.signalId)&&!embeddingById.has(row.signalId)) embeddingById.set(row.signalId, row.embedding);
  }

  const diverse = diversifyRanked(scored, embeddingById, SELECTION_DIVERSITY_MAX_COSINE);
  const recentFocus = diverse.filter(row=>row.lastEvidenceAt !== null &&
    row.lastEvidenceAt.getTime()>=now.getTime()-TOP_OF_MIND_FOCUS_DAYS*MS_PER_DAY &&
    (row.status==='active'||row.evidenceCount>=TOP_OF_MIND_EMERGING_MIN_EVIDENCE))
    .sort((a,b)=>(b.lastEvidenceAt?.getTime()??0)-(a.lastEvidenceAt?.getTime()??0)||b.score-a.score||a.id.localeCompare(b.id));
  const chosen = chooseSelection(
    diverse.filter((s) => s.status === "active"),
    diverse.filter((s) => s.status === "emerging"),
    recentFocus.slice(0,TOP_OF_MIND_FOCUS_LIMIT),
  );

  const finalList = keepContestedTogether(
    chosen.signals,
    new Map(scored.map((s) => [s.id, s])),
    opposing,
  );
  const inList = new Set(finalList.map((s) => s.id));

  const standingIds=new Set(scored.map(row=>row.id));
  const standingContested=new Map([...opposing].filter(([id])=>standingIds.has(id)).map(([id,partners])=>[id,partners.filter(partner=>standingIds.has(partner))]));
  return { signals: finalList.map((s) => strip(s, inList)), evidence: evidenceBySignal, provisional: chosen.provisional, contested:standingContested };
}

/** Batch the current original material for selected and carried citations.
 * Synthesis reads signals; publication review reads bounded original excerpts.
 * Ownership predicates and the generation revision fence cover every read. */
async function loadReadingQualityContext(db: WakaDb, profileId: string,
  locale: TopOfMindQualityContext['locale'], selection: SelectionOutcome,
  current: LiveArtifactSnapshot | null): Promise<TopOfMindQualityContext> {
  const signalIds = new Set([...selection.signals.map(row => row.id),
    ...(current?.entries.flatMap(entry => entry.citedSignalIds) ?? [])]);
  const signalOrigins = new Map([...signalIds].map(id => [id,
    [...new Set((selection.evidence.get(id) ?? []).flatMap(row => row.lineage?.originIds ?? []))]]));
  const ids = [...new Set([...signalOrigins.values()].flat())];
  const sourceTexts = new Map<string, string[]>();
  if (!ids.length) return { locale, signalOrigins, sourceTexts };
  const [originals, answers, media] = await Promise.all([
    db.select({ id: inspirations.id, text: inspirations.text }).from(inspirations)
      .where(and(eq(inspirations.profileId, profileId), inArray(inspirations.id, ids))),
    db.select({ id: reflections.inspirationId, text: reflections.answer }).from(reflections)
      .where(and(eq(reflections.profileId, profileId), inArray(reflections.inspirationId, ids), eq(reflections.skipped, false))),
    db.select({ id: attachments.inspirationId, text: effectiveAttachmentText }).from(attachments)
      .where(and(eq(attachments.profileId, profileId), inArray(attachments.inspirationId, ids), eq(effectiveAttachmentStatus, 'ready'))),
  ]);
  for (const row of originals) sourceTexts.set(row.id, row.text ? [row.text] : []);
  for (const row of [...answers, ...media]) {
    if (row.id && row.text && sourceTexts.has(row.id)) sourceTexts.get(row.id)!.push(row.text);
  }
  return { locale, signalOrigins, sourceTexts };
}

/**
 * A TENSION NEEDS BOTH VOICES. When a chosen signal stands in an open
 * contested pair whose other side is standing (in `standing`) but was not
 * chosen, the partner is pulled in behind it — the list may exceed the
 * twelve slots by the pulled few, which is the honest trade: delivering one
 * side of a dispute as if it were alone is the machine quietly arbitrating,
 * and the machine never arbitrates. A partner that is not standing at all
 * (retired, unsupported) cannot speak, and its pair stays dormant for this
 * pass. Deliberately not transitive: a pulled partner's OWN other pairs are
 * not chased — the walk covers what the chosen set stands in, and stops.
 */
export function keepContestedTogether<T extends { id: string }>(
  chosen: readonly T[],
  standing: ReadonlyMap<string, T>,
  opposing: ReadonlyMap<string, readonly string[]>,
): T[] {
  const finalList = [...chosen];
  const inList = new Set(finalList.map((s) => s.id));
  for (const signal of chosen) {
    for (const other of opposing.get(signal.id) ?? []) {
      if (inList.has(other)) continue;
      const partner = standing.get(other);
      if (partner) {
        finalList.push(partner);
        inList.add(other);
      }
    }
  }
  return finalList;
}

/**
 * Greedy diversity over a ranked list: walk strongest-first, hold back any
 * candidate whose current embedding sits at or above `maxCosine` to one
 * already accepted. Empty slots stay empty rather than repeating a theme.
 * A signal without an embedding (dropped on edit) is not suppressed.
 * Deterministic by construction: same rows, same order, every run.
 */
export function diversifyRanked<T extends { id: string }>(
  ranked: T[],
  embeddingById: Map<string, number[]>,
  maxCosine: number,
): T[] {
  const accepted: T[] = [];
  const acceptedVectors: number[][] = [];
  for (const candidate of ranked) {
    const vector = embeddingById.get(candidate.id) ?? null;
    let nearAccepted = false;
    if (vector !== null) {
      for (const held of acceptedVectors) {
        /* cosineSimilarity answers null for degenerate vectors — mismatched
           dimensions, a zero norm — and null is "not near", never a skip */
        const similarity = cosineSimilarity(vector, held);
        if (similarity !== null && similarity >= maxCosine) {
          nearAccepted = true;
          break;
        }
      }
    }
    if (nearAccepted) {
      continue;
    }
    accepted.push(candidate);
    if (vector !== null) acceptedVectors.push(vector);
  }
  return accepted;
}

/**
 * The cold-start rule, isolated from the database so it can be reasoned about
 * directly. Both lists arrive already ranked, strongest first.
 *
 * The caller supplies at most three diverse recent focuses with current
 * support. They lead; stable ranked patterns fill the remaining slots.
 * Cold-start backfill still permits a first tentative read from one save.
 */
export function chooseSelection<T>(
  active: T[],
  emerging: T[],
  recentFocus: T[] = [],
): { signals: T[]; provisional: boolean } {
  const focus=recentFocus.slice(0,TOP_OF_MIND_FOCUS_LIMIT);
  const primary=[...focus,...active.filter(row=>!focus.includes(row))].slice(0,TOP_OF_MIND_SIGNAL_LIMIT);
  const backfill=emerging.filter(row=>!primary.includes(row)).slice(0,Math.max(0,TOP_OF_MIND_MIN_SIGNALS-primary.length));
  const selected=[...primary,...backfill];
  return {signals:selected,provisional:selected.some(row=>emerging.includes(row))};
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

  const asCarried = (row: typeof entryRows[number] & { supportChanged?: boolean }): CarriedEntry => ({
      type: row.type,
      body: row.body,
      belief: row.belief,
      prompt: row.prompt,
      lockedAt: row.lockedAt,
      pinnedAt: row.pinnedAt,
      dismissedAt: row.dismissedAt,
      sortOrder: row.sortOrder,
      citedSignalIds: citationsByEntry.get(row.id) ?? [],
      supportChanged: row.supportChanged,
  });
  const projected = await projectPersonalEntries(db, profileId, entryRows);
  return {
    id: artifact.id,
    version: artifact.version,
    entries: projected.entries.map(asCarried),
    storedEntries: entryRows.map(asCarried),
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

function contestedEntryAllowed(entry: {type:TopOfMindEntryType;belief?:string|null;citedSignalIds:string[]},
  contested: ReadonlyMap<string, readonly string[]>) {
  const partners=entry.citedSignalIds.flatMap(id=>contested.get(id)??[]);
  return !partners.length||(entry.type==='tension'&&partners.every(id=>entry.citedSignalIds.includes(id)));
}

/** The optional belief slot must not introduce a second, stronger claim.
 * Keep a repeated body or exact cited statement; human fields bypass this. */
function machineBelief(entry:{body:string;belief?:string|null;citedSignalIds:string[]},statements:ReadonlyMap<string,string>){
  if(!entry.belief)return undefined;
  return entry.belief===entry.body||entry.citedSignalIds.some(id=>statements.get(id)===entry.belief)?entry.belief:undefined;
}

function contestedCarryAllowed(entry:{type:TopOfMindEntryType;citedSignalIds:string[]},contested:ReadonlyMap<string,readonly string[]>){
  const disputed=entry.citedSignalIds.some(id=>contested.get(id)?.length);
  // A carried tension may describe one direct pair in a larger graph, but
  // never carry a single disputed voice as a settled pattern.
  return !disputed||(entry.type==='tension'&&entry.citedSignalIds.some(id=>contested.get(id)?.some(partner=>entry.citedSignalIds.includes(partner))));
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
  contested: ReadonlyMap<string, readonly string[]> = new Map(),
  statements?: ReadonlyMap<string,string>,
  onRejected?: (index: number, reason: 'no_owned_citations' | 'unresolved_conflict') => void,
): ValidationOutcome {
  let droppedCitations = 0;
  const validated: TopOfMindSynthesisEntry[] = [];

  for (const [index, entry] of entries.entries()) {
    const cited = entry.citedSignalIds.filter((id) => {
      if (knownSignalIds.has(id)) return true;
      droppedCitations += 1;
      return false;
    });
    if (cited.length === 0) { onRejected?.(index, 'no_owned_citations'); continue; }
    if(!contestedEntryAllowed({...entry,citedSignalIds:cited},contested)) { onRejected?.(index, 'unresolved_conflict'); continue; }
    const belief=cited.some(id=>contested.get(id)?.length)?undefined:statements?machineBelief({...entry,citedSignalIds:cited},statements):entry.belief;
    validated.push({ ...entry, belief, citedSignalIds: [...new Set(cited)] });
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
    // Reground exact kept words only when this pass supplied fresh valid
    // citations. Never rewrite them to fit a new machine interpretation.
    citedSignalIds: entry.supportChanged
      ? input.generated.find((candidate) => candidate.body === entry.body && candidate.type === entry.type && candidate.citedSignalIds.length > 0)?.citedSignalIds ?? entry.citedSignalIds
      : entry.citedSignalIds,
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

/** Carry the projected reading, optionally regrounding exact protected words. */
function carryEverything(previous: LiveArtifactSnapshot, generated: TopOfMindSynthesisEntry[]): PersistedEntry[] {
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
      citedSignalIds: entry.supportChanged
        ? generated.find((candidate) => candidate.body === entry.body && candidate.type === entry.type && candidate.citedSignalIds.length > 0)?.citedSignalIds ?? entry.citedSignalIds
        : entry.citedSignalIds,
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
      .returning({ id: topOfMindEntries.id, bodyRevision: topOfMindEntries.bodyRevision });
    if (!insertedEntry) throw new Error("Failed to insert top of mind entry");

    if (entry.citedSignalIds.length > 0) {
      const revisions = await loadSignalStatementRevisions(tx, entry.citedSignalIds);
      await tx
        .insert(topOfMindEntrySignals)
        .values(
          entry.citedSignalIds.map((signalId) => ({
            entryId: insertedEntry.id,
            signalId,
            statementRevision: revisions.get(signalId),
            entryBodyRevision: insertedEntry.bodyRevision,
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
    .where(and(eq(feedback.profileId, profileId), feedbackWordingCurrent(), or(
      and(eq(feedback.targetType, "signal"), sql`EXISTS (SELECT 1 FROM signals
        WHERE signals.id = ${feedback.targetId} AND ${personalSignalReadable(profileId)})`),
      and(eq(feedback.targetType, "top_of_mind_entry"), sql`EXISTS (SELECT 1 FROM top_of_mind_entries
        JOIN top_of_minds fm ON fm.id = top_of_mind_entries.top_of_mind_id
        WHERE top_of_mind_entries.id = ${feedback.targetId} AND fm.profile_id = ${profileId}::uuid
          AND ${personalEntryReadable(profileId)})`),
    )))
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
        .where(and(eq(signals.profileId, profileId), inArray(signals.id, signalIds)))
    : [];
  const bodies = entryIds.length
    ? await db
        .select({ id: topOfMindEntries.id, body: topOfMindEntries.body })
        .from(topOfMindEntries)
        .innerJoin(topOfMinds, eq(topOfMinds.id, topOfMindEntries.topOfMindId))
        .where(and(eq(topOfMinds.profileId, profileId), inArray(topOfMindEntries.id, entryIds)))
    : [];

  const aboutById = new Map<string, string>();
  for (const row of statements) aboutById.set(row.id, row.statement);
  for (const row of bodies) aboutById.set(row.id, row.body);

  return rows.flatMap((row) => {
    const about = aboutById.get(row.targetId);
    // Personal synthesis corrects this profile's own readings. Room reactions
    // stay in room context; old feedback is not permission to fetch another
    // profile's evolving (possibly now-private) statement.
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
  const revision = await readGenerationRevision(db, { profileId: input.profileId });
  if (!revision) return { status: "nothing_to_synthesize", topOfMindId: null, version: 0,
    reason: null, entryCount: 0, droppedCitations: 0, lockViolations: 0 };
  await assertSignalSupportSettled(db, input.profileId, now);

  /* THE FLOOR, before any other work. Only the automatic path waits: a
     `manual` refresh is the person (their own "Read it again", a language
     change) and never holds. The last CONTENT shift is the newest version
     whose reason is not the honest no_change — no_change rows record that a
     read happened, not that the board moved, so they are invisible here. */
  if (input.reason === "signals_changed") {
    const [lastShift] = await db
      .select({ createdAt: topOfMinds.createdAt })
      .from(topOfMinds)
      .where(
        and(
          eq(topOfMinds.profileId, input.profileId),
          ne(topOfMinds.reason, "no_change"),
        ),
      )
      .orderBy(desc(topOfMinds.createdAt))
      .limit(1);
    const verdict = assessShiftFloor(lastShift?.createdAt ?? null, now);
    if (verdict.held) throw new ShiftFloorHeldError(verdict.heldUntil);
  }

  const [profileRows, selection, liveBefore] = await Promise.all([
    db
      .select({ preferredLocale: profiles.preferredLocale })
      .from(profiles)
      .where(eq(profiles.id, input.profileId))
      .limit(1),
    selectSignals(db, input.profileId, now),
    loadLiveArtifact(db, input.profileId),
  ]);
  const preferredLocale = normalizeSupportedLocale(profileRows[0]?.preferredLocale);
  const quality = await loadReadingQualityContext(db, input.profileId, preferredLocale, selection, liveBefore);
  const lockedBefore = (liveBefore?.entries ?? []).filter(
    (entry) => (entry.lockedAt !== null || entry.pinnedAt !== null) && entry.dismissedAt === null,
  );
  // Several signals extracted from one capture are still only one source.
  // Human-kept entries may still regain support without changing their words.
  const selected = lockedBefore.length > 0 || distinctReadingOrigins(selection.signals.map(row => row.id), quality) >= 2
    ? selection.signals : [];
  const provisional = selection.provisional;

  if (selected.length === 0 && liveBefore === null) {
    // There is no artifact and nothing to make one from. Recording versions
    // of nothing would fill the chain with entries that say only that the
    // profile is new.
    if (deps.onPublished) await db.transaction(async (tx) => {
      await acquireTopOfMindArtifactLock(tx, { profileId: input.profileId });
      await assertGenerationRevision(tx, revision);
      await deps.beforeCommit?.(tx);
      await deps.onPublished!(tx, { profileId: input.profileId, result: { kind: "top_of_mind", topOfMindId: null, version: 0, outcome: "empty" } });
    });
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

  let generated: TopOfMindSynthesisEntry[] = [];
  let modelSaidNoChange = false;
  let droppedCitations = 0;
  let lockViolations = 0;
  let generationFailure: unknown = null;
  const entryKey = (entry: { type: string; body: string; belief?: string | null; prompt?: string | null; citedSignalIds: string[] }) =>
    JSON.stringify([entry.type, entry.body, entry.belief ?? null, entry.prompt ?? null, [...entry.citedSignalIds].sort()]);
  const priorCandidates = (liveBefore?.entries ?? []).filter(entry => !isHumanTouched(entry) &&
    contestedCarryAllowed(entry, selection.contested) && readingQualityIssue(entry, quality) === null);
  let approvedPrevious = new Set(priorCandidates.map(entryKey));
  const keptWording = (entry: TopOfMindSynthesisEntry) => lockedBefore.some(kept => kept.type === entry.type && kept.body === entry.body);
  const contested = new Map(selected.map(signal=>[signal.id,signal.contestedWithIds??[]]));
  const selectedStatements = new Map(selected.map(signal=>[signal.id,signal.statement]));
  const rejected: Record<string, number> = {};
  const reportRejection = (stage: 'parse' | 'checks' | 'review', reason: string,
    detail: { entryIndex?: number; fields?: string[]; distinctOrigins?: number } = {}, count = 1) => {
    const code = `${stage}_${reason}`;
    rejected[code] = (rejected[code] ?? 0) + count;
    // Controlled codes and counts only; never generated wording or source text.
    console.warn('[top-of-mind] publication rejected', JSON.stringify({
      profileId: input.profileId, locale: preferredLocale, stage, reason, count, ...detail,
    }));
  };
  const rejectionSummary = () => Object.entries(rejected).sort().map(([reason, count]) => `${reason}=${count}`).join(', ');

  if (selected.length > 0) {
    try {
      const recentFeedback = await loadRecentFeedback(db, input.profileId);
      const synthesis = await provider.synthesizeTopOfMind({
        recentFeedback,
        provisional,
        profileId: input.profileId,
        preferredLocale,
        signals: selected.map((signal) => ({
          id: signal.id,
          statement: signal.statement,
          status: signal.status,
          confidence: signal.confidence,
          evidenceCount: signal.evidenceCount,
          lastEvidenceAt: signal.lastEvidenceAt,
          timeShape: signal.timeShape ?? undefined,
          contestedWithIds: signal.contestedWithIds,
          inspirationIds: [...(quality.signalOrigins.get(signal.id) ?? [])],
        })),
        lockedEntries: lockedBefore.map((entry, index) => ({
          id: `${liveBefore?.id ?? "pending"}:${index}`,
          type: entry.type,
          body: entry.body,
          belief: entry.belief,
          prompt: entry.prompt,
          citedSignalIds: entry.supportChanged ? [] : entry.citedSignalIds,
          supportChanged: entry.supportChanged,
        })),
        currentEntries: (liveBefore?.entries ?? [])
          .filter((entry) => entry.dismissedAt === null && !entry.supportChanged &&
            (isHumanTouched(entry) || readingQualityIssue(entry, quality) === null))
          .map((entry) => ({
            type: entry.type,
            body: entry.body,
            citedSignalIds: entry.citedSignalIds,
          })),
      });

      modelSaidNoChange = synthesis.noChange === true;
      if (synthesis.rejectedEntries) reportRejection('parse', 'invalid_entry', {}, synthesis.rejectedEntries);
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
        contested,
        selectedStatements,
        (entryIndex, reason) => reportRejection('checks', reason, { entryIndex }),
      );
      generated = validated.entries.filter((entry, entryIndex) => keptWording(entry) || readingQualityIssue(entry, quality,
        detail => reportRejection('checks', detail.reason, { entryIndex, fields: detail.fields, distinctOrigins: detail.distinctOrigins })) === null);
      if ((synthesis.rejectedEntries || synthesis.entries.some(entry => !keptWording(entry))) && !generated.some(entry => !keptWording(entry))) {
        generationFailure = new Error(`Top of mind generation failed publication checks: ${rejectionSummary()}`);
      }
      droppedCitations = validated.droppedCitations;
      if (droppedCitations > 0) {
        console.warn("[top-of-mind] dropped citations the profile does not hold", {
          profileId: input.profileId,
          droppedCitations,
        });
      }
    } catch (error) {
      reportRejection('parse', 'unavailable_or_invalid');
      generationFailure = error;
      generated = [];
    }
  }

  // Review the fallback as well as the proposal: noChange cannot grandfather
  // a wrong-language or unsupported legacy reading into the new version.
  const machineEntries = generated.filter(entry => !keptWording(entry));
  try {
    const approved = await reviewReadingEntries([...machineEntries, ...priorCandidates], quality, provider,
      (entryIndex, reasons) => { for (const reason of reasons) reportRejection('review', reason, { entryIndex }); });
    generated = generated.filter(entry => keptWording(entry) || approved.has(machineEntries.indexOf(entry)));
    approvedPrevious = new Set(priorCandidates.filter((_, index) => approved.has(machineEntries.length + index)).map(entryKey));
    if (machineEntries.length && !generated.some(entry => !keptWording(entry))) {
      generationFailure = new Error(`Top of mind generation failed publication review: ${rejectionSummary()}`);
    }
  } catch (error) {
    // Reviewer downtime is a failed job, not permission to publish unchecked
    // text. Keep only the existing supported fallback; the queue retries.
    reportRejection('review', 'unavailable_or_invalid');
    generationFailure = error;
    generated = [];
  }

  console.info('[top-of-mind] publication assessment', JSON.stringify({ profileId: input.profileId,
    locale: preferredLocale, acceptedEntries: generated.filter(entry => !keptWording(entry)).length,
    rejected, canPublish: generationFailure === null }));

  const written = await db.transaction(async (tx) => {
    await acquireTopOfMindArtifactLock(tx, { profileId: input.profileId });
    await assertGenerationRevision(tx, revision);
    await deps.beforeCommit?.(tx);

    // Re-read under the validated revision/family locks. Any intervening
    // version or edit was rejected above, not blended with stale model output.
    const previous = await loadLiveArtifact(tx, input.profileId);

    // A no-change response may omit entries, but it cannot resurrect a
    // conclusion whose cited support is no longer current. The live snapshot
    // has already projected that support while retaining human choices.
    const validPrevious = previous?.entries.filter(entry => isHumanTouched(entry) ||
      approvedPrevious.has(entryKey(entry))) ?? [];
    // noChange may not carry an old-language quotation or a one-source
    // reading forward. Accept valid replacement entries even when the model
    // incorrectly labels its repair as noChange.
    const preserveCurrent = previous !== null && (generationFailure !== null || selected.length === 0 ||
      (modelSaidNoChange && (generated.length === 0 || validPrevious.length === previous.entries.length)));
    const entries = preserveCurrent
      ? carryEverything({...previous,entries:validPrevious
          .map(entry=>isHumanTouched(entry)?entry:{...entry,belief:entry.citedSignalIds.some(id=>selection.contested.get(id)?.length)?null:machineBelief(entry,selectedStatements)??null})}, generated)
      : assembleEntries({ carried: previous?.entries ?? [], generated });

    const unchanged =
      previous !== null &&
      isUnchanged(previous.storedEntries, entries);
    const reason: TopOfMindRevisionReason = previous === null
      ? "initial"
      : unchanged
        ? "no_change"
        : "regenerated";

    // A bad response must neither erase a valid reading nor record success.
    // Prune invalid/stale prior machine text if needed, then fail outside this
    // transaction so that cleanup commits and normal bounded retries apply.
    if (generationFailure !== null && (previous === null || unchanged)) return null;
    const created = await writeVersion(tx, {
      profileId: input.profileId,
      previous,
      entries,
      reason,
      now,
    });

    if (generationFailure === null) await deps.onPublished?.(tx, { profileId: input.profileId, result: { kind: "top_of_mind", topOfMindId: created.id,
      version: created.version, outcome: entries.length === 0 ? "empty" : reason === "no_change" ? "unchanged" : "changed" } });

    return { created, reason, entryCount: entries.length };
  });

  if (generationFailure !== null) throw generationFailure;
  if (!written) throw new Error('Top of mind publication did not complete');
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
