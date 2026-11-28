/**
 * ═══ INTRODUCTIONS (design "Agent introductions", approved 2026-11-27) ═══
 *
 * WAKA introduces two consenting people whose principles overlap. The whole
 * feature is a privacy model, so the rules are written here once:
 *
 *  1. OFF UNTIL THE PERSON SAYS "Introduce us". Consent is a row in
 *     `introduction_consents`, per human profile, revocable at any time.
 *  2. ONLY PRINCIPLES ARE COMPARED. The matcher reads `principles.statement`
 *     of held, supported principles and nothing else: no inspirations, no
 *     signals, no readings. There are no principle embeddings in the schema,
 *     so the comparison is plain word overlap (see `principleOverlap`); it
 *     spends no model call.
 *  3. ONLY CONSENTING HUMANS ARE COMPARED. A person who has not said yes is
 *     never read, so nobody is ever told "someone matched you" about a person
 *     who did not agree to be looked at.
 *  4. DOUBLE BLIND. A match is first offered to each side as an anonymous ask
 *     ("Someone else holds one of your principles"). Names, the visiting
 *     creature and the shared principle appear only when BOTH say Introduce
 *     us to that match. A no is never shown to the other side: their ask
 *     stays exactly as it was, and their yes simply never completes.
 *  5. WHAT IS EVER SAID ABOUT THE OTHER PERSON: their first name, and that
 *     they hold the principle. Each side reads the principle in its OWN words;
 *     the other side's wording is stored for them and returned only to them.
 *  6. ONE AT A TIME. A person with an open ask or an unseen introduction is
 *     not matched again until it settles, and a pair is offered once, ever.
 *
 * Matching runs on the queue (`match_introductions`), and only where
 * `WAKA_INTRODUCTIONS=1`. With the flag unset the routes report the feature
 * unavailable, nothing is enqueued and a queued job does nothing.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { introductionConsents, introductions, principles, profiles } from "../db/index.js";
import type { IntroductionAnswer } from "../db/index.js";
import type { getDb } from "./db.js";

type Db = ReturnType<typeof getDb>;

/** The flag. Off unless the environment says exactly "1". */
export function introductionsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return env.WAKA_INTRODUCTIONS === "1";
}

// ---------------------------------------------------------------------------
// The comparison: word overlap between two principle statements
// ---------------------------------------------------------------------------

/* Function words that every principle shares and that say nothing about it. */
const STOP = new Set(("a an and are as at be been but by can do does doing for from had has have how i if in into is it its " +
  "just me more most my no not of on one or our over rather so some something than that the their them then there these " +
  "they thing things this those to too very was we were what when where which while who why will with would you your " +
  "yourself always never even every much many each other ever own same such only also both all any").split(" "));
/* `rather` and `than` are in the list so "I'd rather X than Y" is compared on
   X and Y, which is where a principle's meaning sits. */

function stem(word: string): string {
  for (const end of ["ing", "ed", "es", "s"]) {
    if (word.length - end.length >= 3 && word.endsWith(end)) return word.slice(0, -end.length);
  }
  return word;
}

/** The meaningful words of a statement. Hangul runs become two-letter pieces,
 * since Korean particles attach to the word they follow. */
export function principleWords(statement: string): Set<string> {
  const out = new Set<string>();
  for (const raw of statement.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (/\p{Script=Hangul}/u.test(raw)) {
      if (raw.length < 2) continue;
      for (let i = 0; i + 1 < raw.length; i += 1) out.add(raw.slice(i, i + 2));
      continue;
    }
    if (raw.length < 3 || STOP.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

/** The minimum agreement for two principles to count as one shared principle. */
export const OVERLAP_FLOOR = 0.5;
const SHARED_WORDS_FLOOR = 2;

/** Dice overlap of the meaningful words, 0..1; 0 below two shared words. */
export function principleOverlap(a: string, b: string): number {
  const left = principleWords(a), right = principleWords(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  if (shared < SHARED_WORDS_FLOOR) return 0;
  return (2 * shared) / (left.size + right.size);
}

// ---------------------------------------------------------------------------
// What a person may read
// ---------------------------------------------------------------------------

export type IntroductionView =
  /** A match waiting on this person. Nothing about the other side. */
  | { id: string; stage: "ask" }
  /** Both said yes. Their first name and this person's own principle words. */
  | { id: string; stage: "introduced"; name: string; principle: string };

export interface IntroductionState {
  available: boolean;
  consent: { enabled: boolean; answered: boolean };
  /** True once: the first ask, for a person who holds a principle and has never answered. */
  offerConsent: boolean;
  introduction: IntroductionView | null;
}

/** First name only: the board's "a first name. Nothing else." */
export function firstName(name: string): string {
  return name.trim().split(/\s+/u)[0] ?? "";
}

type Row = typeof introductions.$inferSelect;
function side(row: Row, profileId: string) {
  const a = row.profileAId === profileId;
  return {
    mine: { answer: a ? row.answerA : row.answerB, seen: a ? row.seenAAt : row.seenBAt, text: a ? row.principleAText : row.principleBText },
    otherId: a ? row.profileBId : row.profileAId,
  };
}

const involves = (profileId: string) => or(eq(introductions.profileAId, profileId), eq(introductions.profileBId, profileId));

async function holdsAPrinciple(db: Pick<Db, "select">, profileId: string): Promise<boolean> {
  const [row] = await db.select({ id: principles.id }).from(principles)
    .where(and(eq(principles.profileId, profileId), eq(principles.state, "held"), isNull(principles.unsupportedAt))).limit(1);
  return Boolean(row);
}

export async function readIntroductionState(db: Pick<Db, "select">, profileId: string,
  available = introductionsAvailable()): Promise<IntroductionState> {
  const [consent] = await db.select().from(introductionConsents).where(eq(introductionConsents.profileId, profileId)).limit(1);
  const state: IntroductionState = {
    available,
    consent: { enabled: Boolean(consent?.enabled), answered: Boolean(consent) },
    offerConsent: false,
    introduction: null,
  };
  if (!available) return state;
  if (!consent) {
    state.offerConsent = await holdsAPrinciple(db, profileId);
    return state;
  }
  if (!consent.enabled) return state;
  const rows = await db.select().from(introductions).where(involves(profileId)).orderBy(asc(introductions.createdAt), asc(introductions.id));
  /* An introduction both said yes to comes first; then the oldest ask this
     person has not answered. Whether the OTHER side answered, and how, is
     never part of what is chosen or returned (only `accepted` reveals that
     both said yes, which is the introduction itself). */
  for (const row of rows) {
    const { mine, otherId } = side(row, profileId);
    if (row.status !== "accepted" || mine.seen) continue;
    const [other] = await db.select({ name: profiles.name }).from(profiles).where(eq(profiles.id, otherId)).limit(1);
    state.introduction = { id: row.id, stage: "introduced", name: firstName(other?.name ?? ""), principle: mine.text };
    return state;
  }
  for (const row of rows) {
    if (side(row, profileId).mine.answer === null) { state.introduction = { id: row.id, stage: "ask" }; return state; }
  }
  return state;
}

// ---------------------------------------------------------------------------
// What a person may do
// ---------------------------------------------------------------------------

/**
 * Answer the ask (either way) or flip the switch in Settings. Turning it off
 * also withdraws this person from every match still in the air, silently:
 * each open row takes their no, and an introduction they have not seen yet
 * is marked seen so it is not shown to them after they said stop.
 */
export async function setIntroductionConsent(db: Db, profileId: string, enabled: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(introductionConsents).values({ profileId, enabled })
      .onConflictDoUpdate({ target: introductionConsents.profileId, set: { enabled, updatedAt: sql`now()` } });
    if (enabled) return;
    await tx.execute(sql`
      UPDATE introductions SET
        answer_a = CASE WHEN profile_a_id = ${profileId}::uuid AND status = 'offered' THEN 'no' ELSE answer_a END,
        answered_a_at = CASE WHEN profile_a_id = ${profileId}::uuid AND status = 'offered' THEN now() ELSE answered_a_at END,
        answer_b = CASE WHEN profile_b_id = ${profileId}::uuid AND status = 'offered' THEN 'no' ELSE answer_b END,
        answered_b_at = CASE WHEN profile_b_id = ${profileId}::uuid AND status = 'offered' THEN now() ELSE answered_b_at END,
        seen_a_at = CASE WHEN profile_a_id = ${profileId}::uuid AND status = 'accepted' THEN coalesce(seen_a_at, now()) ELSE seen_a_at END,
        seen_b_at = CASE WHEN profile_b_id = ${profileId}::uuid AND status = 'accepted' THEN coalesce(seen_b_at, now()) ELSE seen_b_at END,
        status = CASE WHEN status = 'offered' THEN 'declined' ELSE status END,
        updated_at = now()
      WHERE (profile_a_id = ${profileId}::uuid OR profile_b_id = ${profileId}::uuid)
        AND status IN ('offered', 'accepted')`);
  });
}

/** What the person who answered is told. `waiting` is the same whether the
 * other side has not answered yet or already said no. */
export type AnswerOutcome =
  | { ok: true; result: { stage: "waiting" } | { stage: "declined" } | IntroductionView & { stage: "introduced" } }
  | { ok: false; status: 404 | 409 };

export async function answerIntroduction(db: Db, profileId: string, id: string, answer: IntroductionAnswer): Promise<AnswerOutcome> {
  const outcome = await db.transaction(async (tx): Promise<AnswerOutcome | "introduced"> => {
    const [row] = await tx.select().from(introductions).where(and(eq(introductions.id, id), involves(profileId))).for("update").limit(1);
    /* Somebody else's introduction answers exactly like one that does not exist. */
    if (!row) return { ok: false, status: 404 };
    const a = row.profileAId === profileId;
    if ((a ? row.answerA : row.answerB) !== null) return { ok: false, status: 409 };
    const [consent] = await tx.select({ enabled: introductionConsents.enabled }).from(introductionConsents)
      .where(eq(introductionConsents.profileId, profileId)).limit(1);
    if (answer === "yes" && !consent?.enabled) return { ok: false, status: 409 };
    const other = a ? row.answerB : row.answerA;
    const status = answer === "no" ? (row.status === "offered" ? "declined" : row.status)
      : row.status === "offered" && other === "yes" ? "accepted" : row.status;
    await tx.update(introductions).set({
      ...(a ? { answerA: answer, answeredAAt: sql`now()` } : { answerB: answer, answeredBAt: sql`now()` }),
      status, updatedAt: sql`now()`,
    }).where(eq(introductions.id, row.id));
    if (answer === "no") return { ok: true, result: { stage: "declined" } };
    return status === "accepted" ? "introduced" : { ok: true, result: { stage: "waiting" } };
  });
  if (outcome !== "introduced") return outcome;
  const state = await readIntroductionState(db, profileId, true);
  return state.introduction?.stage === "introduced" && state.introduction.id === id
    ? { ok: true, result: state.introduction } : { ok: true, result: { stage: "waiting" } };
}

/** Done on the introduction: it is not shown to this side again. */
export async function markIntroductionSeen(db: Db, profileId: string, id: string): Promise<boolean> {
  const rows = await db.execute(sql`
    UPDATE introductions SET
      seen_a_at = CASE WHEN profile_a_id = ${profileId}::uuid THEN coalesce(seen_a_at, now()) ELSE seen_a_at END,
      seen_b_at = CASE WHEN profile_b_id = ${profileId}::uuid THEN coalesce(seen_b_at, now()) ELSE seen_b_at END,
      updated_at = now()
    WHERE id = ${id}::uuid AND status = 'accepted'
      AND (profile_a_id = ${profileId}::uuid OR profile_b_id = ${profileId}::uuid)
    RETURNING id`);
  return (rows as unknown as unknown[]).length > 0;
}

// ---------------------------------------------------------------------------
// The matcher (the `match_introductions` job)
// ---------------------------------------------------------------------------

/** How many consenting people one pass reads. Oldest consent first, so
 * nobody waits behind a stream of newcomers. */
const CANDIDATES_PER_PASS = 500;

/* A person is busy while an ask waits on them, while a match they said yes to
   is still open, or while an introduction waits to be seen. */
const BUSY = (column: ReturnType<typeof sql.raw>) => sql`EXISTS (
  SELECT 1 FROM introductions i WHERE
    (i.profile_a_id = ${column} AND (i.status = 'offered' OR (i.answer_a IS NULL AND i.status = 'declined') OR (i.status = 'accepted' AND i.seen_a_at IS NULL)))
    OR
    (i.profile_b_id = ${column} AND (i.status = 'offered' OR (i.answer_b IS NULL AND i.status = 'declined') OR (i.status = 'accepted' AND i.seen_b_at IS NULL))))`;

export type MatchResult = "off" | "not_consenting" | "busy" | "none" | "matched";

export async function matchIntroductionsForProfile(db: Db, profileId: string,
  available = introductionsAvailable()): Promise<MatchResult> {
  if (!available) return "off";
  return db.transaction(async (tx) => {
    /* One matcher at a time across the install, so two passes can never both
       hand the same person a new ask. The pass reads no saves and calls no
       model, so holding it is short. */
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('waka:match_introductions'))`);
    const [me] = await tx.execute(sql`
      SELECT p.account_id AS "accountId", ${BUSY(sql.raw("p.id"))} AS busy
        FROM profiles p JOIN introduction_consents c ON c.profile_id = p.id AND c.enabled
       WHERE p.id = ${profileId}::uuid AND p.type = 'human' AND p.account_id IS NOT NULL`) as unknown as Array<{ accountId: string; busy: boolean }>;
    if (!me) return "not_consenting";
    if (me.busy) return "busy";
    const candidates = await tx.execute(sql`
      SELECT p.id FROM profiles p JOIN introduction_consents c ON c.profile_id = p.id AND c.enabled
       WHERE p.type = 'human' AND p.account_id IS NOT NULL AND p.account_id <> ${me.accountId}::uuid
         AND p.id <> ${profileId}::uuid
         AND NOT EXISTS (SELECT 1 FROM introductions i
                          WHERE (i.profile_a_id = p.id AND i.profile_b_id = ${profileId}::uuid)
                             OR (i.profile_b_id = p.id AND i.profile_a_id = ${profileId}::uuid))
         AND NOT ${BUSY(sql.raw("p.id"))}
       ORDER BY c.answered_at, p.id
       LIMIT ${CANDIDATES_PER_PASS}`) as unknown as Array<{ id: string }>;
    if (!candidates.length) return "none";
    const ids = [profileId, ...candidates.map((row) => row.id)];
    /* Statements only: id, owner and words. Nothing else is selected. */
    const held = await tx.select({ id: principles.id, profileId: principles.profileId, statement: principles.statement })
      .from(principles)
      .where(and(inArray(principles.profileId, ids), eq(principles.state, "held"), isNull(principles.unsupportedAt)))
      .orderBy(asc(principles.rank), asc(principles.id));
    const mine = held.filter((row) => row.profileId === profileId);
    if (!mine.length) return "none";
    let best: { score: number; mine: (typeof held)[number]; theirs: (typeof held)[number] } | null = null;
    for (const theirs of held) {
      if (theirs.profileId === profileId) continue;
      for (const own of mine) {
        const score = principleOverlap(own.statement, theirs.statement);
        if (score >= OVERLAP_FLOOR && (!best || score > best.score)) best = { score, mine: own, theirs };
      }
    }
    if (!best) return "none";
    const aIsMe = profileId < best.theirs.profileId;
    const [a, b] = aIsMe ? [best.mine, best.theirs] : [best.theirs, best.mine];
    const inserted = await tx.insert(introductions).values({
      profileAId: a.profileId, profileBId: b.profileId, principleAId: a.id, principleBId: b.id,
      principleAText: a.statement, principleBText: b.statement,
    }).onConflictDoNothing().returning({ id: introductions.id });
    return inserted.length ? "matched" : "none";
  });
}
