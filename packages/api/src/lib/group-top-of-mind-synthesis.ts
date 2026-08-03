/**
 * Group Top of Mind synthesis (US-053).
 *
 * Generates group notes by running the existing Top of Mind judge over the
 * POOLED shared inspirations of every member: each viable shared signal is used
 * as a trigger, its cross-member similar candidates are retrieved, and the judge
 * decides whether they form a group note. Results persist to the group-scoped
 * tables with per-evidence `owner_user_id`, so a note can cite inspirations from
 * several members and the board can tag each one with its owner.
 *
 * This is a genuine synthesis over the pooled signals — not a merge of each
 * member's already-generated personal notes.
 */

import { createHash } from "node:crypto";

import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import {
  groupMembers,
  groupTopOfMindNoteSignals,
  groupTopOfMindNotes,
  inspirationEmbeddings,
  signals,
} from "../db/index.js";
import { getDb } from "./db.js";
import { GeminiEmbeddingHttpClient, type WakaDb } from "./inspiration-embeddings.js";
import type { SupportedLocale } from "./locales.js";
import { selectBoard } from "../scoring/board-selection.js";
import { cosineSimilarity, fromPersistedScore } from "../scoring/wow-score.js";
import { MIN_AUDIBLE_CHARS, isAudible } from "./signal-enrichment.js";
import { judgeGroupWowMoment, type WowMomentJudgment } from "./wow-judge.js";

// Bound the model calls per synthesis run. Each trigger is one judge call, and
// the judge is deliberately selective (many triggers return "no note"), so we
// try a healthy number of triggers, spread across members, to surface several
// group notes rather than one.
const MAX_TRIGGERS = 24;
const TARGET_NOTES = 6;
const CANDIDATE_LIMIT = 8;
// How many of each member's strongest shared signals to consider as triggers
// before interleaving. Keeps one prolific member from dominating the pass.
const PER_MEMBER_TRIGGER_CAP = 8;
/**
 * How many readings a pass gathers before choosing a wall from them.
 *
 * Above `TARGET_NOTES` on purpose: selection with exactly as many candidates
 * as places is not selection, and the board falls back to arrival order. The
 * gap between the two is the only thing that costs extra model calls, so this
 * is the dial to turn if cost ever bites — not the choosing.
 */
const CANDIDATE_POOL_TARGET = 12;
/**
 * How many of a member's signals to consider before ranking them.
 *
 * Wider than the cap because the ranking below is not the order the database
 * returns: the signal that reaches furthest into someone else's collection can
 * sit well down a member's own list, and on a real board it sat thirteenth.
 */
const PER_MEMBER_TRIGGER_SCAN = 60;
/**
 * How much a trigger's redundancy counts against its reach.
 *
 * Applied to a similarity measured RELATIVE TO THE GROUP'S OWN SPREAD, not to
 * a raw cosine — see `redundancyAgainst`. A constant tuned against one board's
 * absolute numbers would be wrong for every other board: a group of colleagues
 * saving the same industry reading sits near 0.81 average similarity, while
 * two strangers might sit near 0.45, and the same threshold either flattens
 * the first or shreds the second.
 */
const TRIGGER_DIVERSITY_WEIGHT = 0.6;

/**
 * A reading that cleared every gate and is waiting to be chosen.
 *
 * Carries what selection needs and nothing else: who its evidence belongs to
 * (so a board can spread across members) and the judgment itself (whose title
 * and belief statement are what "says a different thing" is measured over).
 */
export interface BoardCandidate {
  judgment: Extract<WowMomentJudgment, { isWowMoment: true }>;
  /** Signal id -> owner, as the persist step needs it. */
  owners: Map<string, string>;
  /** Distinct members this reading rests on. Always at least two. */
  ownerIds: string[];
  triggerWowScore: number;
  /** Stable identity — the same key persistence dedupes on. */
  key: string;
}

export interface GroupSynthesisResult {
  /**
   * The single instant this whole pass is stamped with.
   *
   * A synthesis pass is one event, so every note it writes shares one
   * `created_at` and the caller retires the previous generation at exactly the
   * same moment. Letting each insert take its own clock reading opened a
   * window — 62 seconds wide on a real run — in which the timeline believed
   * the board held the old notes AND the new ones at once, a state no one ever
   * saw and which a scrubbing wall would render as the board doubling.
   */
  passAt: Date;
  triggersTried: number;
  notesCreated: number;
  notesExisting: number;
  /**
   * Notes this pass re-derived rather than invented.
   *
   * A run that reaches the same reading again has confirmed it, not failed to
   * produce it. Callers that prune the previous generation must keep these, or
   * every refresh deletes exactly the readings the group found most stable.
   */
  reconfirmedNoteIds: string[];
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function isTransientModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b(503|429|500|502|504)\b/.test(msg) || /unavailable|overloaded|rate.?limit/i.test(msg);
}

/**
 * Judge a group trigger, retrying a few times on transient model errors (503
 * overloaded / 429 rate limit) with backoff so a brief provider blip does not
 * wipe out an entire synthesis pass.
 */
async function judgeGroupWithRetry(
  params: Parameters<typeof judgeGroupWowMoment>[0],
): Promise<WowMomentJudgment> {
  const delaysMs = [800, 2000, 4000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    try {
      const judgment = await judgeGroupWowMoment(params);
      /**
       * A response our parser could not read is not an answer.
       *
       * `invalid_judge_json` is returned rather than thrown, so it never
       * reached the retry below and the trigger was dropped as though the
       * judge had declined it. It had not — we simply could not hear it, and
       * the note it was about to make was lost for good.
       *
       * Measured on a real board: two identical read-only passes agreed on 16
       * of 18 triggers, and both disagreements were transport failures rather
       * than changes of mind. One of them cost a genuine note. That is where
       * a board's coverage was moving between refreshes.
       */
      if (
        !judgment.isWowMoment &&
        judgment.reason === "invalid_judge_json" &&
        attempt < delaysMs.length
      ) {
        await sleep(delaysMs[attempt]!);
        continue;
      }
      return judgment;
    } catch (err) {
      lastError = err;
      if (attempt < delaysMs.length && isTransientModelError(err)) {
        await sleep(delaysMs[attempt]!);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

async function loadMemberUserIds(db: WakaDb, groupId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId))
    // Ordered because this order decides the round-robin, which decides who is
    // asked before `TARGET_NOTES` ends the pass. Unordered, Postgres may return
    // members differently as the table grows or under concurrent writes, and
    // the same board would then cover different people on different days for no
    // reason anyone could see.
    .orderBy(asc(groupMembers.userId));
  return rows.map((r) => r.userId);
}

/**
 * Shared, already-embedded signals to use as synthesis triggers, interleaved
 * round-robin across members so one prolific member does not dominate the pass
 * and cross-member combinations get a fair chance. Only shared signals are
 * eligible — private ones never seed group synthesis.
 *
 * Exported for tests: "every member is represented even when one member's
 * signals all outrank another's" is the property this function exists for, and
 * it is not observable through `generateGroupTopOfMind` without a live judge.
 */
export async function loadTriggerSignals(
  db: WakaDb,
  memberUserIds: string[],
): Promise<Array<{ id: string; userId: string; wowScore: number }>> {
  const uniqueMemberIds = [...new Set(memberUserIds)];
  if (uniqueMemberIds.length === 0) return [];

  // One bounded read per member, run concurrently, carrying embeddings.
  //
  // A single query with a global LIMIT would have to be ordered across the
  // whole group, and a member whose signals all rank below another's could fall
  // outside the window entirely — the imbalance the round-robin below exists to
  // prevent. Per-member keeps the read bounded and every member represented.
  const perMember = await Promise.all(
    uniqueMemberIds.map((userId) =>
      db
        .select({
          id: signals.id,
          userId: signals.userId,
          wowScore: signals.wowScore,
          text: signals.text,
          enrichment: signals.enrichment,
          embedding: inspirationEmbeddings.embedding,
        })
        .from(signals)
        .innerJoin(
          inspirationEmbeddings,
          and(
            eq(inspirationEmbeddings.inspirationId, signals.id),
            eq(inspirationEmbeddings.userId, signals.userId),
          ),
        )
        .where(
          and(
            eq(signals.userId, userId),
            eq(signals.sharedToGroups, true),
            /**
             * Deliberately GENEROUS, and not the authority.
             *
             * `isAudible` decides; this only stops the scan window being spent
             * on saves with nothing in them. Written to over-include (no
             * whitespace normalization) so the two predicates can never
             * disagree in the direction that silently drops a real signal.
             */
            sql`length(regexp_replace(${signals.text}, 'https?://\\S+', ' ', 'g')) + coalesce(length(${signals.enrichment}), 0) >= ${MIN_AUDIBLE_CHARS}`,
          ),
        )
        // `id` last so ties break the same way every run.
        .orderBy(desc(signals.wowScore), desc(signals.createdAt), asc(signals.id))
        .limit(PER_MEMBER_TRIGGER_SCAN),
    ),
  );

  /**
   * The authoritative gate.
   *
   * A save with no readable words cannot seed a reading — there is nothing in
   * it to read — and letting one through costs a whole judge call plus a
   * candidate slot, and drags every similarity threshold toward the floor
   * because a bare URL embeds to noise. Measured on Waka: one member held 13
   * bare links out of 14 shared saves, appeared in no reading, and the absence
   * read as "their taste does not combine" when it was only that nobody could
   * hear them.
   *
   * This gates being *quoted*, never being *saved*. A silent save still lives
   * on its owner's wall and still counts as something they reacted to.
   */
  const audibleByMember = perMember.map((rows) => rows.filter(isAudible));
  const excluded = perMember.reduce((sum, rows) => sum + rows.length, 0) -
    audibleByMember.reduce((sum, rows) => sum + rows.length, 0);
  if (excluded > 0) {
    // Never silent: a pass that quietly ignores a third of a room looks
    // identical to a room that had nothing to say.
    console.log("[group-synthesis] inaudible signals skipped as triggers", {
      excluded,
      minAudibleChars: MIN_AUDIBLE_CHARS,
    });
  }

  /**
   * Rank each member's signals by how strongly they reach *someone else*, not
   * by what they are worth alone.
   *
   * `wow_score` says how much a signal matters on its owner's own board. Using
   * it to pick group triggers assumes the signals that matter most alone are
   * the ones most likely to combine — and that is the one assumption this
   * product denies. A signal's meaning depends on what it sits next to, so the
   * question a group trigger has to answer is "whose collection does this
   * reach?", which `wow_score` cannot see.
   *
   * Measured on a real board: for one member the two orderings were nearly
   * inverted — their highest-scoring signal had the weakest cross-member match
   * of all fourteen. Their four highest-scoring signals, which is all the pass
   * ever tried, produced no note across repeated runs. Re-ranked this way, the
   * same budget of four produced a real note with another member; the signal it
   * came from sat thirteenth by `wow_score` and would never have been asked.
   */
  const everything = audibleByMember.flat();
  const crossReach = new Map<string, number>();
  for (const signal of everything) {
    const own = signal.embedding as number[] | null;
    if (!own) continue;
    let best = -1;
    for (const other of everything) {
      if (other.userId === signal.userId) continue;
      const theirs = other.embedding as number[] | null;
      if (!theirs || theirs.length !== own.length) continue;
      const score = cosineSimilarity(own, theirs);
      if (score > best) best = score;
    }
    crossReach.set(signal.id, best);
  }

  /**
   * Ranked but NOT yet truncated.
   *
   * Cutting each member to their top `PER_MEMBER_TRIGGER_CAP` by reach before
   * the diversity pass hands that pass a bucket already narrowed to the most
   * central signals — it can then only choose which centre-of-mass signal to
   * take, never how to escape the centre. The cap belongs on how many are
   * *taken* below, not on what may be considered.
   */
  const ranked = audibleByMember.map((rows) =>
    [...rows].sort((a, b) => {
      const delta = (crossReach.get(b.id) ?? -1) - (crossReach.get(a.id) ?? -1);
      // Ties fall back to id so a pass stays reproducible.
      return delta !== 0 ? delta : a.id.localeCompare(b.id);
    }),
  );

  const embeddingById = new Map(
    everything.map((signal) => [signal.id, signal.embedding as number[] | null]),
  );

  /**
   * How alike this group is with itself.
   *
   * Every judgement about whether a trigger is "too similar" has to be made
   * against this, not against an absolute number. A tight group — colleagues
   * reading the same field — can sit above 0.8 while a group of strangers sits
   * near half that, and "0.85 is too close" is true for one and meaningless
   * for the other. Sampled rather than exhaustive so a large group stays cheap.
   */
  const groupBaseline = (() => {
    const vectors = everything
      .map((signal) => signal.embedding as number[] | null)
      .filter((embedding): embedding is number[] => Boolean(embedding))
      .slice(0, 60);
    let total = 0;
    let pairs = 0;
    for (let i = 0; i < vectors.length; i += 1) {
      for (let j = i + 1; j < vectors.length; j += 1) {
        if (vectors[i]!.length !== vectors[j]!.length) continue;
        total += cosineSimilarity(vectors[i]!, vectors[j]!);
        pairs += 1;
      }
    }
    return pairs === 0 ? 0 : total / pairs;
  })();

  /**
   * Redundancy on a scale this group can actually be measured against: 0 when
   * a signal is no more alike its neighbours than the group is with itself, 1
   * when it is a near-duplicate. A group whose members genuinely share little
   * gets almost no penalty and keeps its reach ranking intact; a group that
   * says one thing five ways gets pushed toward its own edges.
   */
  const redundancyAgainst = (similarity: number): number => {
    if (similarity <= groupBaseline) return 0;
    const headroom = 1 - groupBaseline;
    return headroom <= 0 ? 0 : (similarity - groupBaseline) / headroom;
  };

  // De-dupe across buckets: the embedding join can return a signal more than
  // once if it carries several embedding rows.
  const seen = new Set<string>();
  const buckets = ranked
    .map((rows) =>
      rows.filter((row) => {
        if (seen.has(row.id)) return false;
        seen.add(row.id);
        return true;
      }),
    )
    .filter((bucket) => bucket.length > 0);

  /**
   * Round-robin for fairness, and within each member's turn, pick the signal
   * that reaches furthest while being least like what is already chosen.
   *
   * Ranking purely by cross-member reach recovered members who were being
   * starved, but it bought that by aiming at the group's centre of mass:
   * measured on a real board, reach-ranked triggers sat at 0.835 mean pairwise
   * similarity against the group's own 0.807, so every trigger drew a
   * candidate pool from the same cluster and every note came out a rephrasing
   * of the same idea. Five notes, one thought.
   *
   * So each pick trades a little reach for distance from the triggers already
   * taken. Coverage and spread stop being opposites: a member is still
   * guaranteed their turn, but the signal they contribute is the one that adds
   * something the pass has not already asked about.
   *
   * The distance is judged against the group's own spread, so this behaves
   * correctly for a group that has not formed a centre yet as well as for one
   * that has hardened into a single theme.
   */
  const out: Array<{ id: string; userId: string; wowScore: number }> = [];
  const takenEmbeddings: number[][] = [];
  const remaining = buckets.map((bucket) => [...bucket]);
  /** The per-member cap applies to what is taken, not to what is considered. */
  const takenPerMember = new Map<string, number>();

  const noveltyPenalty = (id: string): number => {
    const embedding = embeddingById.get(id);
    if (!embedding || takenEmbeddings.length === 0) return 0;
    let closest = -1;
    for (const taken of takenEmbeddings) {
      if (taken.length !== embedding.length) continue;
      const score = cosineSimilarity(embedding, taken);
      if (score > closest) closest = score;
    }
    return closest < 0 ? 0 : closest;
  };

  while (out.length < MAX_TRIGGERS) {
    let advanced = false;
    for (const bucket of remaining) {
      if (bucket.length === 0) continue;
      const owner = bucket[0]!.userId;
      if ((takenPerMember.get(owner) ?? 0) >= PER_MEMBER_TRIGGER_CAP) continue;
      let bestIndex = 0;
      let bestScore = -Infinity;
      for (let i = 0; i < bucket.length; i += 1) {
        const candidate = bucket[i]!;
        const score =
          (crossReach.get(candidate.id) ?? 0) -
          TRIGGER_DIVERSITY_WEIGHT * redundancyAgainst(noveltyPenalty(candidate.id));
        if (score > bestScore) {
          bestScore = score;
          bestIndex = i;
        }
      }
      const [chosen] = bucket.splice(bestIndex, 1);
      if (!chosen) continue;
      out.push({ id: chosen.id, userId: chosen.userId, wowScore: chosen.wowScore });
      takenPerMember.set(chosen.userId, (takenPerMember.get(chosen.userId) ?? 0) + 1);
      const embedding = embeddingById.get(chosen.id);
      if (embedding) takenEmbeddings.push(embedding);
      advanced = true;
      if (out.length >= MAX_TRIGGERS) break;
    }
    if (!advanced) break;
  }

  return out;
}

/**
 * Crude lexical overlap, used only to catch a note that paraphrases one
 * member's own signals.
 *
 * Deliberately generous: this rejects near-copies, not merely-related
 * readings. It must never be the reason a genuinely new reading is discarded,
 * so the bar is set where only restatement clears it.
 */
const SINGLE_MEMBER_RESTATEMENT_THRESHOLD = 0.82;

function contentTokens(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2),
  );
}

/** What share of the note's own words already appear in `source`. */
function overlapRatio(note: string, source: string): number {
  const left = contentTokens(note);
  if (left.size === 0) return 0;
  const right = contentTokens(source);
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / left.size;
}

/**
 * Exported for the eval. A judgment is not a note: production discards those
 * grounded in one member, and an eval that counts raw judgments measures the
 * judge rather than the board — which is exactly the mistake that made three
 * runs of this look twice as good as the board they were meant to predict.
 */
export async function restatesASingleMember(
  db: WakaDb,
  judgment: Extract<WowMomentJudgment, { isWowMoment: true }>,
  ownersBySignalId: Map<string, string>,
): Promise<boolean> {
  const ids = judgment.relatedInspirationIds.filter((id) => ownersBySignalId.has(id));
  if (ids.length === 0) return false;

  const rows = await db
    .select({ id: signals.id, userId: signals.userId, text: signals.text })
    .from(signals)
    .where(inArray(signals.id, ids));

  const textsByOwner = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = textsByOwner.get(row.userId) ?? [];
    bucket.push(row.text);
    textsByOwner.set(row.userId, bucket);
  }

  const note = `${judgment.title} ${judgment.why ?? ""}`;
  for (const texts of textsByOwner.values()) {
    if (overlapRatio(note, texts.join(" ")) >= SINGLE_MEMBER_RESTATEMENT_THRESHOLD) {
      return true;
    }
  }
  return false;
}

/** Exported alongside {@link restatesASingleMember}, which needs it. */
export async function loadOwnersBySignalId(
  db: WakaDb,
  signalIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (signalIds.length === 0) return map;
  const rows = await db
    .select({ id: signals.id, userId: signals.userId, shared: signals.sharedToGroups })
    .from(signals)
    .where(inArray(signals.id, signalIds));
  for (const r of rows) {
    // Defense in depth: never attribute (or expose) a signal that isn't shared.
    if (r.shared) map.set(r.id, r.userId);
  }
  return map;
}

function idempotencyKeyFor(
  groupId: string,
  judgment: Extract<WowMomentJudgment, { isWowMoment: true }>,
  locale: string,
): string {
  const ids = [...judgment.relatedInspirationIds].sort().join(",");
  return createHash("sha256")
    .update(`${groupId}|${judgment.kind}|${ids}|${locale}`)
    .digest("hex");
}

async function persistGroupNote(
  db: WakaDb,
  input: {
    groupId: string;
    judgment: Extract<WowMomentJudgment, { isWowMoment: true }>;
    locale: SupportedLocale;
    triggerWowScore: number;
    ownersBySignalId: Map<string, string>;
    /** One instant for the whole pass — see `GroupSynthesisResult.passAt`. */
    passAt: Date;
    /**
     * A reading the pass produced but selection did not put on the wall.
     *
     * Written retired at the instant it was created, so it never appears on a
     * board — `noteIsOnBoardAt` is half-open, and a note replaced at the same
     * moment it was written is already gone at that moment.
     *
     * Kept rather than dropped because it cost the same to make and it is the
     * most interesting thing a timeline can show: not only what the wall said,
     * but what the room considered and set aside. Also keeps the spark
     * engine's line intact — only decisions become memory, and choosing not to
     * show a reading is a decision.
     */
    consideredOnly?: boolean;
  },
): Promise<{ outcome: "created" | "existing" | "skipped"; noteId?: string }> {
  const sourceEvidenceById = new Map(
    input.judgment.sourceEvidence.map((e) => [e.inspirationId, e]),
  );
  // Keep only related ids whose owner is a real, still-shared member signal.
  const relatedIds = input.judgment.relatedInspirationIds.filter((id) =>
    input.ownersBySignalId.has(id),
  );
  if (relatedIds.length === 0) return { outcome: "skipped" };

  const idempotencyKey = idempotencyKeyFor(input.groupId, input.judgment, input.locale);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(groupTopOfMindNotes)
      .values({
        groupId: input.groupId,
        title: input.judgment.title,
        kind: input.judgment.kind,
        idempotencyKey,
        why: input.judgment.why,
        beliefStatement: input.judgment.beliefStatement ?? null,
        reflectionQuestion: input.judgment.reflectionQuestion ?? null,
        reflectionGuide: input.judgment.reflectionGuide ?? null,
        locale: input.locale,
        wowScore: input.triggerWowScore,
        createdAt: input.passAt,
        updatedAt: input.passAt,
        ...(input.consideredOnly
          ? { lifecycleStatus: "replaced" as const, replacedAt: input.passAt }
          : {}),
      })
      .onConflictDoNothing({
        target: [groupTopOfMindNotes.groupId, groupTopOfMindNotes.idempotencyKey],
      })
      .returning({ id: groupTopOfMindNotes.id });

    if (!created) {
      // Idempotent: this reading already exists. Say *which* note it is, so a
      // caller marking the previous generation replaced can keep it rather
      // than retire the very reading this pass just re-confirmed.
      const [existing] = await tx
        .select({
          id: groupTopOfMindNotes.id,
          lifecycleStatus: groupTopOfMindNotes.lifecycleStatus,
        })
        .from(groupTopOfMindNotes)
        .where(
          and(
            eq(groupTopOfMindNotes.groupId, input.groupId),
            eq(groupTopOfMindNotes.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1);

      // The room came back to a reading it had retired. Revive that row rather
      // than leaving the pass with nothing to show: the unique key means a
      // second row can never be written, so without this the reading would be
      // re-derived forever and never reappear on the wall.
      if (existing && existing.lifecycleStatus !== "active") {
        await tx
          .update(groupTopOfMindNotes)
          .set({
            lifecycleStatus: "active",
            replacedAt: null,
            replacedByNoteId: null,
            updatedAt: new Date(),
          })
          .where(eq(groupTopOfMindNotes.id, existing.id));
      }
      return { outcome: "existing", noteId: existing?.id };
    }

    await tx
      .insert(groupTopOfMindNoteSignals)
      .values(
        relatedIds.map((signalId, index) => {
          const evidence = sourceEvidenceById.get(signalId);
          return {
            groupTopOfMindNoteId: created.id,
            signalId,
            ownerUserId: input.ownersBySignalId.get(signalId)!,
            role: evidence?.role ?? "related",
            reason: evidence?.reason ?? "",
            sortOrder: index,
          };
        }),
      )
      .onConflictDoNothing({
        target: [
          groupTopOfMindNoteSignals.groupTopOfMindNoteId,
          groupTopOfMindNoteSignals.signalId,
        ],
      });

    return { outcome: "created", noteId: created.id };
  });
}


/**
 * Turn the readings a pass produced into the wall it should show.
 *
 * The only part of selection that needs the world: it embeds each reading so
 * "says a different thing" can be measured, and asks the board which readings
 * it already holds so a re-confirmed one keeps its place instead of competing
 * for it.
 *
 * Falls back to the candidates in hand when embedding is unavailable. A pass
 * that cannot measure difference should still produce a board — worse than a
 * chosen one, no worse than what the pass did before selection existed.
 */
async function chooseBoard(
  db: WakaDb,
  groupId: string,
  candidates: BoardCandidate[],
  k: number,
): Promise<BoardCandidate[]> {
  if (candidates.length <= k) return candidates;

  /**
   * Readings this room already shows.
   *
   * A reading the pass reached again has been CONFIRMED, not superseded.
   * Letting selection drop one would reintroduce the bug that took a real
   * board from six notes to four, and would make the wall churn between
   * refreshes for reasons nobody could see.
   */
  const activeKeys = new Set(
    (
      await db
        .select({ key: groupTopOfMindNotes.idempotencyKey })
        .from(groupTopOfMindNotes)
        .where(
          and(
            eq(groupTopOfMindNotes.groupId, groupId),
            eq(groupTopOfMindNotes.lifecycleStatus, "active"),
          ),
        )
    ).map((row) => row.key),
  );

  let embeddings: number[][];
  try {
    const client = new GeminiEmbeddingHttpClient();
    embeddings = await Promise.all(
      candidates.map((candidate) =>
        client.embed(
          // What the reading SAYS, not what it rests on — two readings can cite
          // the same saves and mean different things, which is the whole reason
          // a room is worth reading.
          `${candidate.judgment.title}\n${candidate.judgment.beliefStatement ?? candidate.judgment.why}`,
        ),
      ),
    );
  } catch (err) {
    console.warn("[group-synthesis] could not embed candidates; keeping arrival order", {
      groupId,
      error: err instanceof Error ? err.message : String(err),
    });
    return candidates.slice(0, k);
  }

  const selectable = candidates.map((candidate, index) => ({
    id: candidate.key,
    embedding: embeddings[index] ?? [],
    ownerIds: candidate.ownerIds,
    quality: fromPersistedScore(candidate.triggerWowScore),
    reconfirmed: activeKeys.has(candidate.key),
  }));

  const chosenIds = new Set(selectBoard(selectable, k).map((c) => c.id));
  const chosen = candidates.filter((candidate) => chosenIds.has(candidate.key));

  console.log("[group-synthesis] board chosen", {
    groupId,
    candidates: candidates.length,
    chosen: chosen.length,
    reconfirmed: selectable.filter((c) => c.reconfirmed).length,
  });

  return chosen;
}

/**
 * Run group synthesis for one group: pool members' shared signals, judge each
 * viable trigger over the cross-member candidate pool, and persist the resulting
 * notes with owner-tagged evidence. Idempotent — re-running does not duplicate.
 */
export async function generateGroupTopOfMind(
  db: WakaDb,
  input: {
    groupId: string;
    locale?: SupportedLocale;
    maxTriggers?: number;
    /** Overridable so a caller can align the retirement of the old generation. */
    passAt?: Date;
  },
): Promise<GroupSynthesisResult> {
  const passAt = input.passAt ?? new Date();
  const memberUserIds = await loadMemberUserIds(db, input.groupId);
  // A group note must span two members, so a single-member group cannot
  // produce one. Judging its triggers is a guaranteed-empty run of model
  // calls; skip the whole pass rather than paying for the proof.
  if (new Set(memberUserIds).size < 2) {
    return { passAt, triggersTried: 0, notesCreated: 0, notesExisting: 0, reconfirmedNoteIds: [] };
  }
  const maxTriggers = Math.max(1, Math.min(input.maxTriggers ?? MAX_TRIGGERS, MAX_TRIGGERS));
  const triggers = (await loadTriggerSignals(db, memberUserIds)).slice(0, maxTriggers);
  const locale = (input.locale ?? "en-US") as SupportedLocale;

  let notesCreated = 0;
  let notesExisting = 0;
  let triggersTried = 0;
  const reconfirmedNoteIds: string[] = [];

  /**
   * Readings that cleared every gate, held rather than written.
   *
   * Generating and persisting used to be the same step: a judgment that
   * survived went straight onto the board, and the pass stopped at
   * `TARGET_NOTES`. That made the wall "the first six that worked" rather than
   * the best six — arrival order decided it, and no stage was ever in a
   * position to see the six together.
   *
   * Separating the two is what lets a *set* exist at all. Selection lands
   * between them.
   */
  const candidates: BoardCandidate[] = [];

  for (const trigger of triggers) {
    /**
     * Deliberately NOT stopping at `TARGET_NOTES`.
     *
     * Selection needs more readings than the wall has places, or it has
     * nothing to choose between and the board falls back to arrival order.
     * The pool is what costs the extra model calls, and `MAX_TRIGGERS` is the
     * dial if that ever matters — the stopping rule is not.
     *
     * A hard ceiling still applies so a huge room cannot run away with a pass.
     */
    if (candidates.length >= CANDIDATE_POOL_TARGET) break;
    triggersTried += 1;

    let judgment: WowMomentJudgment;
    try {
      judgment = await judgeGroupWithRetry({
        db,
        memberUserIds,
        triggerUserId: trigger.userId,
        triggerInspirationId: trigger.id,
        limit: CANDIDATE_LIMIT,
        locale,
      });
    } catch (err) {
      console.warn("[group-synthesis] judge failed for trigger:", {
        groupId: input.groupId,
        triggerId: trigger.id,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!judgment.isWowMoment) continue;

    const owners = await loadOwnersBySignalId(db, judgment.relatedInspirationIds);
    // A group Top of Mind must be a shared one: its evidence has to span at
    // least two members. Skip judgments grounded in a single person's
    // inspirations (they belong on that person's own board, not the group's).
    const distinctOwners = new Set(
      judgment.relatedInspirationIds
        .map((id) => owners.get(id))
        .filter((uid): uid is string => Boolean(uid)),
    );
    if (distinctOwners.size < 2) continue;

    // Spanning two members is necessary but not sufficient. A note can cite two
    // people and still say only what one of them already says alone, which
    // satisfies the letter of a shared reading and not its point: the group saw
    // nothing their own collection did not already contain. Checked here rather
    // than asked for in the prompt, because a model told to find a
    // combination-only insight will happily claim one.
    if (await restatesASingleMember(db, judgment, owners)) continue;

    candidates.push({
      judgment,
      owners,
      ownerIds: [...distinctOwners],
      triggerWowScore: trigger.wowScore,
      // The same identity persistence will use, so "did selection pick this?"
      // and "is this already on the board?" are the same question.
      key: idempotencyKeyFor(input.groupId, judgment, locale),
    });
  }

  /**
   * Choose the wall, then write it.
   *
   * Everything above decided which readings are TRUE. This decides which of
   * them make the best board — the most people spoken for, the most different
   * things said. Without it the wall is whichever readings the trigger order
   * happened to reach first, which on a real board produced three readings
   * that were three phrasings of one idea.
   */
  const chosen = await chooseBoard(db, input.groupId, candidates, TARGET_NOTES);
  const chosenKeys = new Set(chosen.map((c) => c.key));

  for (const candidate of candidates) {
    const selected = chosenKeys.has(candidate.key);
    const outcome = await persistGroupNote(db, {
      groupId: input.groupId,
      judgment: candidate.judgment,
      locale,
      triggerWowScore: candidate.triggerWowScore,
      ownersBySignalId: candidate.owners,
      passAt,
      consideredOnly: !selected,
    });
    if (!selected) continue;
    if (outcome.outcome === "created") notesCreated += 1;
    else if (outcome.outcome === "existing") {
      notesExisting += 1;
      if (outcome.noteId) reconfirmedNoteIds.push(outcome.noteId);
    }
  }

  return { passAt, triggersTried, notesCreated, notesExisting, reconfirmedNoteIds };
}
