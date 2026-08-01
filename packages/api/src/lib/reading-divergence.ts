/**
 * Reading divergence — does the same signal read differently beside the room?
 *
 * After group synthesis, some of the room's evidence signals also sit inside
 * their owner's own active Top of Mind. For each such signal this pass asks a
 * judge to compare the two belief statements — what the signal means alone
 * versus what it means in this room — and stores a 0–100 divergence score with
 * a one-sentence rationale, one row per (signal, group), updated in place.
 *
 * This is the measurement half of the founder's central claim ("the same
 * signal points to a completely different ambition depending on which other
 * signals it sits next to"). The announcement half reads these rows later and
 * surfaces the large gaps PRIVATELY to the signal's owner — a divergence
 * references their solo reading, which the room must never see.
 *
 * The pass is deliberately best-effort and bounded: it runs after synthesis,
 * never blocks or fails a board read, and judges at most `maxPairs` new or
 * changed pairs per run. A pair whose two note ids are unchanged since the
 * last run is skipped without a model call, so a stable board costs nothing.
 */

import { and, eq, inArray } from "drizzle-orm";

import {
  groupMembers,
  groupTopOfMindNoteSignals,
  groupTopOfMindNotes,
  signalReadingDivergences,
  signals,
  topOfMindNoteSignals,
  topOfMindNotes,
} from "../db/index.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import { GeminiReadingDivergenceClient } from "./reading-divergence-gemini.js";
import type { SupportedLocale } from "./locales.js";

// ---------------------------------------------------------------------------
// The judge seam
// ---------------------------------------------------------------------------

/**
 * Judge-call budget per pass. Stable pairs are free, so this only bounds how
 * fast a changed board's measurements catch up.
 */
const DEFAULT_MAX_PAIRS = 12;

export interface ReadingDivergenceInput {
  /** Untrusted user-authored signal text. */
  signalText: string;
  /** The owner's solo reading of it. */
  soloBelief: string;
  soloWhy: string;
  /** The room's reading of the same signal. */
  groupBelief: string;
  groupWhy: string;
  locale: SupportedLocale;
}

export interface ReadingDivergenceJudgment {
  /** 0 = the room reads it the way the owner does; 100 = a different ambition. */
  score: number;
  /** One plain sentence naming the difference, in `locale`. */
  rationale: string;
}

export interface ReadingDivergenceClient {
  judgeReadingDivergence(
    input: ReadingDivergenceInput,
  ): Promise<ReadingDivergenceJudgment | null>;
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

export interface DivergenceGroupSideRow {
  signalId: string;
  ownerUserId: string;
  noteId: string;
  belief: string | null;
  title: string;
  why: string;
  locale: string;
  noteCreatedAt: Date;
}

export interface DivergenceSoloSideRow {
  signalId: string;
  ownerUserId: string;
  noteId: string;
  belief: string | null;
  title: string;
  why: string;
  noteCreatedAt: Date;
}

export interface DivergencePair {
  signalId: string;
  ownerUserId: string;
  solo: DivergenceSoloSideRow;
  group: DivergenceGroupSideRow;
}

/**
 * One pair per signal: its newest group-side note against its owner's newest
 * solo note. Pairs whose two note ids match an existing judgment are dropped —
 * nothing changed, so there is nothing to re-measure.
 */
export function pickDivergencePairs(
  groupRows: DivergenceGroupSideRow[],
  soloRows: DivergenceSoloSideRow[],
  existing: Array<{ signalId: string; soloNoteId: string; groupNoteId: string }>,
): DivergencePair[] {
  const newestGroupBySignal = new Map<string, DivergenceGroupSideRow>();
  for (const row of groupRows) {
    const current = newestGroupBySignal.get(row.signalId);
    if (!current || row.noteCreatedAt > current.noteCreatedAt) {
      newestGroupBySignal.set(row.signalId, row);
    }
  }

  const newestSoloBySignal = new Map<string, DivergenceSoloSideRow>();
  for (const row of soloRows) {
    const current = newestSoloBySignal.get(row.signalId);
    if (!current || row.noteCreatedAt > current.noteCreatedAt) {
      newestSoloBySignal.set(row.signalId, row);
    }
  }

  const judged = new Map(
    existing.map((row) => [row.signalId, `${row.soloNoteId}:${row.groupNoteId}`]),
  );

  const pairs: DivergencePair[] = [];
  for (const [signalId, group] of newestGroupBySignal) {
    const solo = newestSoloBySignal.get(signalId);
    if (!solo) continue;
    // A group note's evidence rows carry the owner; the solo citation is
    // scoped by that same user. A mismatch would mean cross-tenant data —
    // skip it rather than measure it.
    if (solo.ownerUserId !== group.ownerUserId) continue;
    if (judged.get(signalId) === `${solo.noteId}:${group.noteId}`) continue;
    pairs.push({ signalId, ownerUserId: group.ownerUserId, solo, group });
  }
  return pairs;
}

// ---------------------------------------------------------------------------
// Scoring pass
// ---------------------------------------------------------------------------

export interface ScoreReadingDivergencesResult {
  pairsConsidered: number;
  pairsJudged: number;
  pairsStored: number;
  pairsDropped: number;
}

/**
 * Lazy so importing this module never constructs a Gemini client. Tests inject
 * through `input.client` rather than swapping this, so it needs no setter.
 */
let defaultClient: ReadingDivergenceClient | null = null;

function getDefaultClient(): ReadingDivergenceClient {
  if (!defaultClient) defaultClient = new GeminiReadingDivergenceClient();
  return defaultClient;
}

/**
 * Measure divergence for every signal this group's board cites that also sits
 * in its owner's active solo Top of Mind. Bounded, idempotent per note-pair,
 * and safe to call after every synthesis run.
 */
export async function scoreReadingDivergencesForGroup(
  db: WakaDb,
  input: {
    groupId: string;
    client?: ReadingDivergenceClient;
    maxPairs?: number;
  },
): Promise<ScoreReadingDivergencesResult> {
  const client = input.client ?? getDefaultClient();
  const maxPairs = Math.max(1, input.maxPairs ?? DEFAULT_MAX_PAIRS);

  const groupRows: DivergenceGroupSideRow[] = (
    await db
      .select({
        signalId: groupTopOfMindNoteSignals.signalId,
        ownerUserId: groupTopOfMindNoteSignals.ownerUserId,
        noteId: groupTopOfMindNotes.id,
        belief: groupTopOfMindNotes.beliefStatement,
        title: groupTopOfMindNotes.title,
        why: groupTopOfMindNotes.why,
        locale: groupTopOfMindNotes.locale,
        noteCreatedAt: groupTopOfMindNotes.createdAt,
      })
      .from(groupTopOfMindNoteSignals)
      .innerJoin(
        groupTopOfMindNotes,
        eq(groupTopOfMindNoteSignals.groupTopOfMindNoteId, groupTopOfMindNotes.id),
      )
      .innerJoin(signals, eq(groupTopOfMindNoteSignals.signalId, signals.id))
      // The same guards the wall applies to evidence. A gap is a claim that
      // "the room reads this differently", and the room does not read a save
      // its owner has withdrawn, nor one belonging to someone who has left.
      .innerJoin(
        groupMembers,
        and(
          eq(groupMembers.groupId, groupTopOfMindNotes.groupId),
          eq(groupMembers.userId, groupTopOfMindNoteSignals.ownerUserId),
        ),
      )
      // Measure against what the room reads now. A retired reading's gap was
      // already measured (and possibly announced) while it was current.
      .where(
        and(
          eq(groupTopOfMindNotes.groupId, input.groupId),
          eq(groupTopOfMindNotes.lifecycleStatus, "active"),
          eq(signals.sharedToGroups, true),
        ),
      )
  );

  if (groupRows.length === 0) {
    return { pairsConsidered: 0, pairsJudged: 0, pairsStored: 0, pairsDropped: 0 };
  }

  const signalIds = [...new Set(groupRows.map((row) => row.signalId))];
  const soloRows: DivergenceSoloSideRow[] = (
    await db
      .select({
        signalId: topOfMindNoteSignals.inspirationId,
        ownerUserId: topOfMindNoteSignals.userId,
        noteId: topOfMindNotes.id,
        belief: topOfMindNotes.beliefStatement,
        title: topOfMindNotes.title,
        why: topOfMindNotes.why,
        noteCreatedAt: topOfMindNotes.createdAt,
      })
      .from(topOfMindNoteSignals)
      .innerJoin(
        topOfMindNotes,
        eq(topOfMindNoteSignals.wowMomentId, topOfMindNotes.id),
      )
      .where(
        and(
          inArray(topOfMindNoteSignals.inspirationId, signalIds),
          eq(topOfMindNotes.lifecycleStatus, "active"),
        ),
      )
  );

  const existing = await db
    .select({
      signalId: signalReadingDivergences.signalId,
      soloNoteId: signalReadingDivergences.soloNoteId,
      groupNoteId: signalReadingDivergences.groupNoteId,
    })
    .from(signalReadingDivergences)
    .where(eq(signalReadingDivergences.groupId, input.groupId));

  const pairs = pickDivergencePairs(groupRows, soloRows, existing);
  const bounded = pairs.slice(0, maxPairs);
  if (pairs.length > bounded.length) {
    console.warn("[reading-divergence] pair budget exceeded, deferring rest:", {
      groupId: input.groupId,
      considered: pairs.length,
      judged: bounded.length,
    });
  }

  if (bounded.length === 0) {
    return {
      pairsConsidered: pairs.length,
      pairsJudged: 0,
      pairsStored: 0,
      pairsDropped: pairs.length,
    };
  }

  const textRows = await db
    .select({ id: signals.id, text: signals.text })
    .from(signals)
    .where(inArray(signals.id, bounded.map((pair) => pair.signalId)));
  const textBySignal = new Map(textRows.map((row) => [row.id, row.text]));

  let pairsJudged = 0;
  let pairsStored = 0;
  for (const pair of bounded) {
    const locale = (pair.group.locale || "en-US") as SupportedLocale;
    let judgment: ReadingDivergenceJudgment | null;
    try {
      judgment = await client.judgeReadingDivergence({
        signalText: textBySignal.get(pair.signalId) ?? "",
        soloBelief: pair.solo.belief?.trim() || pair.solo.title,
        soloWhy: pair.solo.why,
        groupBelief: pair.group.belief?.trim() || pair.group.title,
        groupWhy: pair.group.why,
        locale,
      });
    } catch (err) {
      console.warn("[reading-divergence] judge failed for pair:", {
        groupId: input.groupId,
        signalId: pair.signalId,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    pairsJudged += 1;
    if (!judgment) continue;

    const now = new Date();
    await db
      .insert(signalReadingDivergences)
      .values({
        signalId: pair.signalId,
        groupId: input.groupId,
        ownerUserId: pair.ownerUserId,
        soloNoteId: pair.solo.noteId,
        groupNoteId: pair.group.noteId,
        score: judgment.score,
        rationale: judgment.rationale,
        locale,
        judgedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [signalReadingDivergences.signalId, signalReadingDivergences.groupId],
        set: {
          soloNoteId: pair.solo.noteId,
          groupNoteId: pair.group.noteId,
          ownerUserId: pair.ownerUserId,
          score: judgment.score,
          rationale: judgment.rationale,
          locale,
          judgedAt: now,
          updatedAt: now,
        },
      });
    pairsStored += 1;
  }

  return {
    pairsConsidered: pairs.length,
    pairsJudged,
    pairsStored,
    pairsDropped: pairs.length - bounded.length,
  };
}
