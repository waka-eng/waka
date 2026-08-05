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
 * **A reading is regenerated when its material or interpretation contract
 * changed.** `signalSetHash` identifies what a reading was made from; when it
 * and the prompt version still match, the stored reading is re-confirmed rather
 * than re-bought. A room opened twenty times a day costs one model call, and
 * "found again" is itself evidence — a reading derived four times is stronger
 * than one derived once.
 */

import { and, asc, desc, eq, inArray } from "drizzle-orm";

import {
  combinationReadings,
  combinations,
  groupDirectionContributions,
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
  materialSetHash,
  signalSetHash,
  summarizePulse,
  type CombinationReaderClient,
  type CombinationReaderEvidence,
  type CombinationReaderInput,
} from "./combination-reading.js";
import { loadGroupWithMembers } from "./group-top-of-mind.js";
import { requiredDirectionContributors } from "./group-direction-policy.js";
import { labelMembersByUserId } from "./member-labels.js";
import type { WakaDb } from "./inspiration-embeddings.js";
import { normalizeSupportedLocale, type SupportedLocale } from "./locales.js";
import { memberSetHashFor } from "./member-set-hash.js";

/** What a wall shows: the reading, plus how much standing it has earned. */
export interface GroupCombinationReadingSurface {
  id: string;
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
  createdAt: string;
  changeSummary: string | null;
}

/** Assemble everything the reader speaks from, for one room. */
export async function buildGroupReaderInput(
  db: WakaDb,
  input: {
    groupId: string;
    memberUserIds: string[];
    locale: SupportedLocale;
    currentReading?: {
      id: string;
      ambitionText: string | null;
      facets: CombinationReadingFacet[];
      awayFrom: string | null;
      tension: string | null;
      nextQuestion: string | null;
    } | null;
  },
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

  const contributionRows = input.currentReading
    ? await db
        .select({
          id: groupDirectionContributions.id,
          userId: groupDirectionContributions.userId,
          kind: groupDirectionContributions.kind,
          body: groupDirectionContributions.body,
          createdAt: groupDirectionContributions.createdAt,
        })
        .from(groupDirectionContributions)
        .where(
          and(
            eq(groupDirectionContributions.groupId, input.groupId),
            eq(groupDirectionContributions.readingId, input.currentReading.id),
            inArray(groupDirectionContributions.userId, input.memberUserIds),
          ),
        )
        .orderBy(asc(groupDirectionContributions.createdAt))
    : [];

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
    currentReading:
      input.currentReading?.ambitionText
        ? {
            ambition: input.currentReading.ambitionText,
            facets: input.currentReading.facets ?? [],
            awayFrom: input.currentReading.awayFrom,
            tension: input.currentReading.tension,
            nextQuestion: input.currentReading.nextQuestion,
          }
        : null,
    roomContributions: contributionRows.map((row) => ({
      ...row,
      memberLabel: labels.get(row.userId) ?? "member ?",
    })),
    locale: input.locale,
  };
}

/** The stored row a wall renders, or null when nothing has been read yet. */
function toSurface(row: {
  id: string;
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
  createdAt: Date;
  changeSummary: string | null;
}): GroupCombinationReadingSurface {
  return {
    id: row.id,
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
    createdAt: row.createdAt.toISOString(),
    changeSummary: row.changeSummary,
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
  promptVersion: combinationReadings.promptVersion,
  signalSetHash: combinationReadings.signalSetHash,
  materialSetHash: combinationReadings.materialSetHash,
  evidenceSignalIds: combinationReadings.evidenceSignalIds,
  combinationId: combinationReadings.combinationId,
  previousReadingId: combinationReadings.previousReadingId,
  changeSummary: combinationReadings.changeSummary,
  lifecycleStatus: combinationReadings.lifecycleStatus,
  evidenceSpanStart: combinationReadings.evidenceSpanStart,
  evidenceSpanEnd: combinationReadings.evidenceSpanEnd,
  createdAt: combinationReadings.createdAt,
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
    .where(
      and(
        eq(combinations.groupId, input.groupId),
        eq(combinations.memberSetHash, hash),
      ),
    )
    .limit(1);
  if (existing) return existing.id;

  const [created] = await db
    .insert(combinations)
    .values({ memberSetHash: hash, origin: "room", groupId: input.groupId })
    .onConflictDoNothing()
    .returning({ id: combinations.id });
  if (created) return created.id;

  // Lost the race to a concurrent reader; theirs is just as good.
  const [raced] = await db
    .select({ id: combinations.id })
    .from(combinations)
    .where(
      and(
        eq(combinations.groupId, input.groupId),
        eq(combinations.memberSetHash, hash),
      ),
    )
    .limit(1);
  if (!raced) throw new Error("Failed to create combination");
  return raced.id;
}

export interface GroupCombinationReadingDeps {
  reader?: CombinationReaderClient;
}

/**
 * Once a room has a current reading, ordinary material changes need collective
 * participation before they earn another model pass. Explicit shaping and new
 * inspirations each have to reach half of the current room independently; one
 * inspiration author plus one shaping author cannot masquerade as two people
 * agreeing on either route. A changed roster and a changed reader prompt are
 * different: both can invalidate the stored answer without new participation.
 * A forming result also gets another baseline chance once shared inspiration
 * evidence itself spans the same proportion of the room.
 */
export function shouldRegenerateGroupReading(input: {
  memberCount: number;
  directionContributorCount: number;
  newInspirationContributorCount: number;
  currentState: "revealed" | "forming";
  evidenceContributorCount: number;
  membershipChanged: boolean;
  promptVersionChanged: boolean;
}): boolean {
  const requiredContributors = requiredDirectionContributors(input.memberCount);
  return (
    input.membershipChanged ||
    input.promptVersionChanged ||
    (requiredContributors > 0 &&
      ((input.currentState === "forming" &&
        input.evidenceContributorCount >= requiredContributors) ||
        input.directionContributorCount >= requiredContributors ||
        input.newInspirationContributorCount >= requiredContributors))
  );
}

export interface GroupReadingLifecyclePlan {
  retireCurrent: boolean;
  nextLifecycleStatus: "active" | "proposed" | "superseded";
  returnCurrent: boolean;
}

/**
 * Decide how a generated result sits beside the room's current result.
 *
 * A forming row is a placeholder, so the first grounded result replaces it
 * instead of becoming a proposal behind it. Conversely, a temporary forming
 * pass must not knock a grounded direction off the wall unless the room's
 * membership changed and its provenance is no longer current.
 */
export function planGroupReadingLifecycle(input: {
  currentState: "revealed" | "forming" | null;
  nextState: "revealed" | "forming";
  membershipChanged: boolean;
}): GroupReadingLifecyclePlan {
  if (!input.currentState) {
    return {
      retireCurrent: false,
      nextLifecycleStatus: "active",
      returnCurrent: false,
    };
  }

  if (input.currentState === "forming") {
    return {
      retireCurrent: true,
      nextLifecycleStatus: "active",
      returnCurrent: false,
    };
  }

  if (input.nextState === "revealed") {
    return {
      retireCurrent: false,
      nextLifecycleStatus: "proposed",
      returnCurrent: false,
    };
  }

  if (input.membershipChanged) {
    return {
      retireCurrent: true,
      nextLifecycleStatus: "active",
      returnCurrent: false,
    };
  }

  return {
    retireCurrent: false,
    nextLifecycleStatus: "superseded",
    returnCurrent: true,
  };
}

/** A first grounded draft inherits the member takes that made it possible. */
export function shouldCarryFormationContributions(input: {
  currentState: "revealed" | "forming" | null;
  nextState: "revealed" | "forming";
  nextLifecycleStatus: GroupReadingLifecyclePlan["nextLifecycleStatus"];
}): boolean {
  return (
    input.currentState === "forming" &&
    input.nextState === "revealed" &&
    input.nextLifecycleStatus === "active"
  );
}

/** A pass that says the same thing strengthens a version; it does not create one. */
export function readingMeaningfullyChanged(
  current: {
    ambitionText: string | null;
    facets: CombinationReadingFacet[];
    awayFrom: string | null;
    tension: string | null;
    nextQuestion: string | null;
  },
  next: {
    ambition: string;
    facets: CombinationReadingFacet[];
    awayFrom: string | null;
    tension: string | null;
    nextQuestion: string | null;
  },
): boolean {
  const clean = (value: string | null) => value?.replace(/\s+/g, " ").trim() ?? null;
  const facets = (value: CombinationReadingFacet[]) =>
    value.map((facet) => ({
      dimension: clean(facet.dimension),
      text: clean(facet.text),
    }));
  return JSON.stringify({
    ambition: clean(current.ambitionText),
    facets: facets(current.facets ?? []),
    awayFrom: clean(current.awayFrom),
    tension: clean(current.tension),
    nextQuestion: clean(current.nextQuestion),
  }) !== JSON.stringify({
    ambition: clean(next.ambition),
    facets: facets(next.facets ?? []),
    awayFrom: clean(next.awayFrom),
    tension: clean(next.tension),
    nextQuestion: clean(next.nextQuestion),
  });
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
  const [row] = await db
    .select(READING_COLUMNS)
    .from(combinationReadings)
    .innerJoin(combinations, eq(combinationReadings.combinationId, combinations.id))
    .where(
      and(
        eq(combinations.groupId, input.groupId),
        eq(combinationReadings.locale, locale),
        eq(combinationReadings.lifecycleStatus, "active"),
      ),
    )
    .orderBy(desc(combinationReadings.createdAt))
    .limit(1);

  return { reading: row ? toSurface(row) : null };
}

/**
 * Read this room's combination, buying a model call only when its inputs moved.
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

  /**
   * Present tense belongs to the room, not to one exact roster. Keeping the
   * previous room-level reading visible while a changed roster is reread makes
   * opening the room stored-first and gives history one continuous spine.
   */
  const [current] = await db
    .select(READING_COLUMNS)
    .from(combinationReadings)
    .innerJoin(combinations, eq(combinationReadings.combinationId, combinations.id))
    .where(
      and(
        eq(combinations.groupId, input.groupId),
        eq(combinationReadings.locale, locale),
        eq(combinationReadings.lifecycleStatus, "active"),
      ),
    )
    .orderBy(desc(combinationReadings.createdAt))
    .limit(1);

  const readerInput = await buildGroupReaderInput(db, {
    groupId: input.groupId,
    memberUserIds,
    locale,
    currentReading: current ?? null,
  });
  const hash = signalSetHash(readerInput);
  const materialHash = materialSetHash(readerInput);
  const membershipChanged = Boolean(current && current.combinationId !== combinationId);
  const promptVersionChanged = Boolean(
    current && current.promptVersion !== COMBINATION_READER_PROMPT_VERSION,
  );

  if (current && current.signalSetHash === hash && !promptVersionChanged) {
    const [reconfirmed] = await db
      .update(combinationReadings)
      .set({ reconfirmedCount: current.reconfirmedCount + 1, updatedAt: new Date() })
      .where(eq(combinationReadings.id, current.id))
      .returning(READING_COLUMNS);
    return toSurface(reconfirmed ?? current);
  }

  /** A rejected or already-visible proposal for this exact input must not be
   * regenerated on every room open. New material or another member note changes
   * the hash and earns a new attempt. */
  const [alreadyGenerated] = await db
    .select({ id: combinationReadings.id })
    .from(combinationReadings)
    .innerJoin(combinations, eq(combinationReadings.combinationId, combinations.id))
    .where(
      and(
        eq(combinations.groupId, input.groupId),
        eq(combinationReadings.locale, locale),
        eq(combinationReadings.signalSetHash, hash),
        eq(combinationReadings.promptVersion, COMBINATION_READER_PROMPT_VERSION),
        inArray(combinationReadings.lifecycleStatus, [
          "proposed",
          "rejected",
          "superseded",
        ]),
      ),
    )
    .orderBy(desc(combinationReadings.createdAt))
    .limit(1);
  if (current && alreadyGenerated) return toSurface(current);

  /**
   * A collective direction should not twitch because one person posted several
   * things. A proposal is earned when either new material or explicit responses
   * independently come from at least half of the current members. A roster
   * change is the exception: the old reading may literally name a combination
   * that no longer exists.
   */
  if (current) {
    const priorSignalIds = new Set(current.evidenceSignalIds ?? []);
    const priorEnd = current.evidenceSpanEnd?.getTime() ?? 0;
    const newInspirationContributors = new Set<string>();
    for (const item of readerInput.evidence) {
      const isNew =
        priorSignalIds.size > 0
          ? !priorSignalIds.has(item.signalId)
          : item.createdAt.getTime() > priorEnd;
      if (isNew) newInspirationContributors.add(item.userId);
    }
    const directionContributors = new Set(
      (readerInput.roomContributions ?? []).map((response) => response.userId),
    );
    if (
      !shouldRegenerateGroupReading({
        memberCount: memberUserIds.length,
        directionContributorCount: directionContributors.size,
        newInspirationContributorCount: newInspirationContributors.size,
        currentState: current.state === "revealed" ? "revealed" : "forming",
        evidenceContributorCount: new Set(
          readerInput.evidence.map((item) => item.userId),
        ).size,
        membershipChanged,
        promptVersionChanged,
      })
    ) {
      return toSurface(current);
    }
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
    materialSetHash: materialHash,
    evidenceSignalIds: readerInput.evidence.map((item) => item.signalId),
    previousReadingId: current?.id ?? null,
    changeSummary: reading.state === "revealed" ? reading.changeSummary : null,
  };

  if (current && reading.state === "revealed" && !readingMeaningfullyChanged(current, reading)) {
    const [reconfirmed] = await db
      .update(combinationReadings)
      .set({
        reconfirmedCount: current.reconfirmedCount + 1,
        memberQuotes: values.memberQuotes,
        groundedNoteIds: values.groundedNoteIds,
        pulseProfile: pulse,
        evidenceSpanStart: span.start,
        evidenceSpanEnd: span.end,
        evidenceSignalIds: values.evidenceSignalIds,
        signalSetHash: hash,
        materialSetHash: materialHash,
        model: values.model,
        promptVersion: values.promptVersion,
        updatedAt: new Date(),
      })
      .where(eq(combinationReadings.id, current.id))
      .returning(READING_COLUMNS);
    return toSurface(reconfirmed ?? current);
  }

  /**
   * A changed reading is proposed, not silently made true.
   *
   * The first grounded reading can become current on its own. Afterwards the
   * room keeps living with its current wording while people review a candidate.
   * A grounded first answer replaces a forming placeholder. Once a grounded
   * answer exists, only a forming answer after the roster changed retires it;
   * it would be misleading to keep attributing departed evidence to the
   * present room.
   */
  return await db.transaction(async (tx) => {
    const lifecycle = planGroupReadingLifecycle({
      currentState: current
        ? current.state === "revealed"
          ? "revealed"
          : "forming"
        : null,
      nextState: reading.state,
      membershipChanged,
    });
    if (!lifecycle.returnCurrent) {
      const proposedRows = await tx
        .select({ id: combinationReadings.id })
        .from(combinationReadings)
        .innerJoin(combinations, eq(combinationReadings.combinationId, combinations.id))
        .where(
          and(
            eq(combinations.groupId, input.groupId),
            eq(combinationReadings.locale, locale),
            eq(combinationReadings.lifecycleStatus, "proposed"),
          ),
        );
      if (proposedRows.length > 0) {
        await tx
          .update(combinationReadings)
          .set({ lifecycleStatus: "superseded", updatedAt: new Date() })
          .where(inArray(combinationReadings.id, proposedRows.map((row) => row.id)));
      }
    }

    if (lifecycle.retireCurrent && current) {
      await tx
        .update(combinationReadings)
        .set({ lifecycleStatus: "replaced", replacedAt: new Date() })
        .where(eq(combinationReadings.id, current.id));
    }

    const [inserted] = await tx
      .insert(combinationReadings)
      .values({
        ...values,
        lifecycleStatus: lifecycle.nextLifecycleStatus,
      })
      .returning(READING_COLUMNS);
    if (!inserted) throw new Error("Failed to persist combination reading");

    /**
     * Takes that helped a forming room find its first wording remain visible on
     * that wording. Without carrying them forward, the successful reread used
     * the members' input and immediately made it disappear, making the result
     * look model-authored rather than collectively shaped.
     */
    if (current && shouldCarryFormationContributions({
      currentState: current.state === "revealed" ? "revealed" : "forming",
      nextState: reading.state,
      nextLifecycleStatus: lifecycle.nextLifecycleStatus,
    })) {
      await tx
        .update(groupDirectionContributions)
        .set({ readingId: inserted.id, updatedAt: new Date() })
        .where(
          and(
            eq(groupDirectionContributions.groupId, input.groupId),
            eq(groupDirectionContributions.readingId, current.id),
            inArray(groupDirectionContributions.userId, memberUserIds),
          ),
        );
    }
    if (lifecycle.retireCurrent && current) {
      await tx
        .update(combinationReadings)
        .set({ replacedByReadingId: inserted.id })
        .where(eq(combinationReadings.id, current.id));
    }
    return lifecycle.returnCurrent && current
      ? toSurface(current)
      : toSurface(inserted);
  });
}
