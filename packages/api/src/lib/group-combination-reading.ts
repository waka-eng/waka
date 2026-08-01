/**
 * Reading a room's combination — the wiring between the board and the reader.
 *
 * `combination-reading.ts` knows how to ask a set of hearts what they want. It
 * does not know how to find them. This module is the join: it takes a group,
 * checks the caller may see it, assembles the notes and saves the reader speaks
 * from, and stores the answer so a wall can show it without paying for a model
 * call on every open.
 *
 * Two rules it exists to keep:
 *
 * **Membership is the visibility contract.** Everything here goes through
 * `loadGroupWithMembers`, which returns null for someone outside the room, so a
 * reading is unreachable to anyone who is not in it. Nothing takes a groupId on
 * trust.
 *
 * **A reading is only regenerated when the material changed.** `signalSetHash`
 * identifies what a reading was made from; when it still matches, the stored
 * reading is re-confirmed rather than re-bought. A room opened twenty times a
 * day costs one model call, and "found again" is itself evidence — a reading
 * derived four times is stronger than one derived once.
 */

import { and, eq, inArray } from "drizzle-orm";

import {
  combinationReadings,
  combinations,
  groupTopOfMindNoteSignals,
  groupTopOfMindNotes,
  signalReadingDivergences,
  signals,
} from "../db/index.js";
import type { CombinationReadingFacet } from "../db/schema-combinations.js";
import {
  COMBINATION_READER_PROMPT_VERSION,
  GeminiCombinationReader,
  evidenceSpan,
  signalSetHash,
  summarizePulse,
  type CombinationReaderClient,
  type CombinationReaderEvidence,
  type CombinationReaderInput,
} from "./combination-reading.js";
import { loadGroupWithMembers } from "./group-top-of-mind.js";
import { labelMembersByUserId } from "./member-labels.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import { normalizeSupportedLocale, type SupportedLocale } from "./locales.js";
import { memberSetHashFor } from "./member-set-hash.js";

/** What a wall shows: the reading, plus how much standing it has earned. */
export interface GroupCombinationReadingSurface {
  state: "revealed" | "forming";
  ambition: string | null;
  facets: CombinationReadingFacet[];
  awayFrom: string | null;
  tension: string | null;
  nextQuestion: string | null;
  whatsMissing: string | null;
  /**
   * Members' own lines the ambition traces to. Names are never sent to the
   * model, but they are shown here — on the wall the words belong to people.
   */
  quotes: Array<{ userId: string; signalId: string; quote: string }>;
  /** How many passes re-derived this reading. */
  reconfirmedCount: number;
  /** Earliest and latest save it rests on, ISO. */
  evidenceSpanStart: string | null;
  evidenceSpanEnd: string | null;
  updatedAt: string;
}

/** Assemble everything the reader speaks from, for one room. */
export async function buildGroupReaderInput(
  db: WakaDb,
  input: { groupId: string; memberUserIds: string[]; locale: SupportedLocale },
): Promise<CombinationReaderInput> {
  // Shared with the judge so both stages letter a room identically.
  const labels = labelMembersByUserId(input.memberUserIds);

  const notes = await db
    .select({
      id: groupTopOfMindNotes.id,
      title: groupTopOfMindNotes.title,
      why: groupTopOfMindNotes.why,
    })
    .from(groupTopOfMindNotes)
    .where(
      and(
        eq(groupTopOfMindNotes.groupId, input.groupId),
        eq(groupTopOfMindNotes.lifecycleStatus, "active"),
      ),
    );

  const noteLinks =
    notes.length === 0
      ? []
      : await db
          .select({
            noteId: groupTopOfMindNoteSignals.groupTopOfMindNoteId,
            signalId: groupTopOfMindNoteSignals.signalId,
          })
          .from(groupTopOfMindNoteSignals)
          .where(
            inArray(
              groupTopOfMindNoteSignals.groupTopOfMindNoteId,
              notes.map((note) => note.id),
            ),
          );

  /**
   * Every SHARED save, not only the ones grounding a note.
   *
   * A note is already an abstraction, and a reading built only from notes is a
   * summary of summaries — which is exactly how the first real run came back
   * at industry-trend level. The specific material is where a want is audible.
   * `sharedToGroups` is the privacy boundary and is enforced here in the query.
   */
  const shared =
    input.memberUserIds.length === 0
      ? []
      : await db
          .select({
            id: signals.id,
            userId: signals.userId,
            text: signals.text,
            enrichment: signals.enrichment,
            captureElapsedMs: signals.captureElapsedMs,
            createdAt: signals.createdAt,
          })
          .from(signals)
          .where(
            and(
              inArray(signals.userId, input.memberUserIds),
              eq(signals.sharedToGroups, true),
            ),
          );

  // How differently each save reads beside THIS room. The sharpest evidence a
  // combination-only reading can have, and the reader ranks by it.
  const divergences = await db
    .select({
      signalId: signalReadingDivergences.signalId,
      score: signalReadingDivergences.score,
    })
    .from(signalReadingDivergences)
    .where(eq(signalReadingDivergences.groupId, input.groupId));
  const scoreBySignal = new Map(divergences.map((row) => [row.signalId, row.score]));

  const evidence: CombinationReaderEvidence[] = shared.map((signal) => ({
    signalId: signal.id,
    userId: signal.userId,
    memberLabel: labels.get(signal.userId) ?? "member ?",
    // Enrichment is what a bare link actually said; without it a URL save is
    // nearly mute to a text model.
    text: [signal.text, signal.enrichment].filter(Boolean).join(" — "),
    createdAt: signal.createdAt,
    divergenceScore: scoreBySignal.get(signal.id) ?? null,
    captureElapsedMs: signal.captureElapsedMs,
  }));

  return {
    memberLabels: [...labels.values()],
    notes: notes.map((note) => ({
      ...note,
      evidenceSignalIds: noteLinks
        .filter((link) => link.noteId === note.id)
        .map((link) => link.signalId),
    })),
    evidence,
    locale: input.locale,
  };
}

/** The stored row a wall renders, or null when nothing has been read yet. */
function toSurface(row: {
  state: string;
  ambitionText: string | null;
  facets: CombinationReadingFacet[];
  awayFrom: string | null;
  tension: string | null;
  nextQuestion: string | null;
  whatsMissing: string | null;
  memberQuotes: Array<{ userId: string; signalId: string; quote: string }>;
  reconfirmedCount: number;
  evidenceSpanStart: Date | null;
  evidenceSpanEnd: Date | null;
  updatedAt: Date;
}): GroupCombinationReadingSurface {
  return {
    state: row.state === "revealed" ? "revealed" : "forming",
    ambition: row.ambitionText,
    facets: row.facets ?? [],
    awayFrom: row.awayFrom,
    tension: row.tension,
    nextQuestion: row.nextQuestion,
    whatsMissing: row.whatsMissing,
    quotes: row.memberQuotes ?? [],
    reconfirmedCount: row.reconfirmedCount,
    evidenceSpanStart: row.evidenceSpanStart?.toISOString() ?? null,
    evidenceSpanEnd: row.evidenceSpanEnd?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const READING_COLUMNS = {
  id: combinationReadings.id,
  state: combinationReadings.state,
  ambitionText: combinationReadings.ambitionText,
  facets: combinationReadings.facets,
  awayFrom: combinationReadings.awayFrom,
  tension: combinationReadings.tension,
  nextQuestion: combinationReadings.nextQuestion,
  whatsMissing: combinationReadings.whatsMissing,
  memberQuotes: combinationReadings.memberQuotes,
  reconfirmedCount: combinationReadings.reconfirmedCount,
  signalSetHash: combinationReadings.signalSetHash,
  evidenceSpanStart: combinationReadings.evidenceSpanStart,
  evidenceSpanEnd: combinationReadings.evidenceSpanEnd,
  updatedAt: combinationReadings.updatedAt,
} as const;

/** The combination row for a room's current membership, created if absent. */
async function ensureCombination(
  db: WakaDb,
  input: { groupId: string; memberUserIds: string[] },
): Promise<string> {
  const hash = memberSetHashFor(input.memberUserIds);
  const [existing] = await db
    .select({ id: combinations.id })
    .from(combinations)
    .where(eq(combinations.memberSetHash, hash))
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(combinations)
    .values({ memberSetHash: hash, origin: "room", groupId: input.groupId })
    .onConflictDoNothing({ target: combinations.memberSetHash })
    .returning({ id: combinations.id });
  if (created) return created.id;

  // Lost the race to a concurrent reader; theirs is just as good.
  const [raced] = await db
    .select({ id: combinations.id })
    .from(combinations)
    .where(eq(combinations.memberSetHash, hash))
    .limit(1);
  if (!raced) throw new Error("Failed to create combination");
  return raced.id;
}

export interface GroupCombinationReadingDeps {
  reader?: CombinationReaderClient;
}

/**
 * The stored reading for a room, without generating one.
 *
 * The outer null means "not yours to see" — the same answer as for a room that
 * does not exist, so an id is never confirmed to someone outside it. An inner
 * `reading: null` means the caller is a member and nothing has been read yet.
 * Two genuinely different answers, and collapsing them into one null would
 * either leak room existence or hide an empty state behind a 404.
 */
export async function getGroupCombinationReading(
  db: WakaDb,
  input: { userId: string; groupId: string; preferredLocale?: SupportedLocale },
): Promise<{ reading: GroupCombinationReadingSurface | null } | null> {
  const loaded = await loadGroupWithMembers(db, {
    userId: input.userId,
    groupId: input.groupId,
  });
  if (!loaded) return null;

  const locale = normalizeSupportedLocale(input.preferredLocale);
  const combinationId = await ensureCombination(db, {
    groupId: input.groupId,
    memberUserIds: loaded.members.map((member) => member.userId),
  });

  const [row] = await db
    .select(READING_COLUMNS)
    .from(combinationReadings)
    .where(
      and(
        eq(combinationReadings.combinationId, combinationId),
        eq(combinationReadings.locale, locale),
        eq(combinationReadings.lifecycleStatus, "active"),
      ),
    )
    .limit(1);

  return { reading: row ? toSurface(row) : null };
}

/**
 * Read this room's combination, buying a model call only if the material moved.
 *
 * Returns null for a non-member. An unchanged signal set re-confirms the stored
 * reading instead of regenerating it — cheaper, and the count is meaningful.
 */
export async function refreshGroupCombinationReading(
  db: WakaDb,
  input: { userId: string; groupId: string; preferredLocale?: SupportedLocale },
  deps: GroupCombinationReadingDeps = {},
): Promise<GroupCombinationReadingSurface | null> {
  const loaded = await loadGroupWithMembers(db, {
    userId: input.userId,
    groupId: input.groupId,
  });
  if (!loaded) return null;

  const locale = normalizeSupportedLocale(input.preferredLocale);
  const memberUserIds = loaded.members.map((member) => member.userId);
  const combinationId = await ensureCombination(db, { groupId: input.groupId, memberUserIds });

  const readerInput = await buildGroupReaderInput(db, {
    groupId: input.groupId,
    memberUserIds,
    locale,
  });
  const hash = signalSetHash(readerInput);

  const [current] = await db
    .select(READING_COLUMNS)
    .from(combinationReadings)
    .where(
      and(
        eq(combinationReadings.combinationId, combinationId),
        eq(combinationReadings.locale, locale),
        eq(combinationReadings.lifecycleStatus, "active"),
      ),
    )
    .limit(1);

  if (current && current.signalSetHash === hash) {
    const [reconfirmed] = await db
      .update(combinationReadings)
      .set({ reconfirmedCount: current.reconfirmedCount + 1, updatedAt: new Date() })
      .where(eq(combinationReadings.id, current.id))
      .returning(READING_COLUMNS);
    return toSurface(reconfirmed ?? current);
  }

  const reader = deps.reader ?? new GeminiCombinationReader({});
  const reading = await reader.read(readerInput);
  const span = evidenceSpan(readerInput.evidence);
  const pulse = summarizePulse(readerInput.evidence);
  const labelToUserId = new Map(
    readerInput.evidence.map((item) => [item.memberLabel, item.userId]),
  );

  const values = {
    combinationId,
    locale,
    state: reading.state,
    ambitionText: reading.state === "revealed" ? reading.ambition : null,
    facets: reading.state === "revealed" ? reading.facets : [],
    awayFrom: reading.state === "revealed" ? reading.awayFrom : null,
    tension: reading.state === "revealed" ? reading.tension : null,
    nextQuestion: reading.state === "revealed" ? reading.nextQuestion : null,
    whatsMissing: reading.whatsMissing,
    memberQuotes:
      reading.state === "revealed"
        ? reading.quotes.map((quote) => ({
            userId: labelToUserId.get(quote.userId) ?? quote.userId,
            signalId: quote.signalId,
            quote: quote.quote,
          }))
        : [],
    groundedNoteIds: reading.state === "revealed" ? reading.groundedNoteIds : [],
    pulseProfile: pulse,
    evidenceSpanStart: span.start,
    evidenceSpanEnd: span.end,
    model: "gemini-3.1-flash-lite",
    promptVersion: COMBINATION_READER_PROMPT_VERSION,
    signalSetHash: hash,
  };

  /**
   * The previous reading is retired, not overwritten.
   *
   * An ambition that changed is the most interesting thing a room can show, and
   * it is invisible if each pass destroys the last. Both writes share one
   * transaction so the partial unique index never sees two active readings.
   */
  return await db.transaction(async (tx) => {
    if (current) {
      await tx
        .update(combinationReadings)
        .set({ lifecycleStatus: "replaced", replacedAt: new Date() })
        .where(eq(combinationReadings.id, current.id));
    }
    const [inserted] = await tx
      .insert(combinationReadings)
      .values(values)
      .returning(READING_COLUMNS);
    if (!inserted) throw new Error("Failed to persist combination reading");
    if (current) {
      await tx
        .update(combinationReadings)
        .set({ replacedByReadingId: inserted.id })
        .where(eq(combinationReadings.id, current.id));
    }
    return toSurface(inserted);
  });
}
