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
 *     us to that match.
 *  5. A NO IS NEVER OBSERVABLE. Each side's state is computed from its OWN
 *     answer and its OWN clock, never from the other side's answer: an
 *     unanswered ask stays an ask, and a yes stays "waiting", until
 *     `INTRODUCTION_WINDOW` after it began, and then lapses quietly. That
 *     lapse is identical whether the other side said no, said nothing, or
 *     turned introductions off. The only thing the other side's answer can
 *     do is complete an introduction, and only a yes does that.
 *  6. WHAT IS EVER SAID ABOUT THE OTHER PERSON: their first name, and that
 *     they hold the principle. Each side reads the principle in its OWN words;
 *     the other side's wording is stored for them and returned only to them.
 *  7. ONE AT A TIME. A person with an open ask, a waiting yes or an unseen
 *     introduction is not matched again until it settles or lapses, and a
 *     pair is offered once, ever (the row is kept even when a principle is
 *     withdrawn; only the withdrawn words are erased, see migration 0097).
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
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** The flag. Off unless the environment says exactly "1". */
export function introductionsAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return env.WAKA_INTRODUCTIONS === "1";
}

/** How long an ask stays open, and how long a yes waits, before either lapses quietly. */
export const INTRODUCTION_WINDOW_DAYS = 14;
const WINDOW_MS = INTRODUCTION_WINDOW_DAYS * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The comparison: word overlap between two principle statements
// ---------------------------------------------------------------------------

/* Function words that every principle shares and that say nothing about it.
   Negations are NOT here: they are read separately (`negated`), because a
   principle and its negation must never count as one. `rather` and `than`
   are here so "I'd rather X than Y" is compared on X and Y. */
const STOP = new Set(("a an and are as at be been but by can do does doing for from had has have how i if in into is it its " +
  "just me more most my of on one or our over rather so some something than that the their them then there these " +
  "they thing things this those to too very was we were what when where which while who why will with would you your " +
  "yourself always even every much many each other ever own same such only also both all any i'd i'm you'd you're it's").split(" "));
const NEGATIONS = new Set(["not", "no", "never", "nothing", "nobody", "none", "neither", "nor", "without", "cannot"]);
/* Korean negation: 안 as its own word, and the 않/못/없 forms. */
const KOREAN_NEGATION = /(^|\s)안\s|않|못|없/u;

/** A light English stemmer: plural, -ing, -ed, a doubled final consonant, a
 * silent e. "values" and "value", "creates" and "create", "planning" and
 * "plan" all land on one stem. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ss|sh|ch|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  for (const end of ["ing", "ed"]) {
    if (w.length - end.length >= 3 && w.endsWith(end)) {
      w = w.slice(0, -end.length);
      if (/([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1);
      break;
    }
  }
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

/** Words of a statement, apostrophes kept inside a word ("don't", not "don"). */
function tokens(statement: string): string[] {
  return statement.normalize("NFKC").toLowerCase().replace(/[‘’ʼ]/gu, "'")
    .match(/[\p{L}\p{N}]+(?:'[\p{L}]+)*/gu) ?? [];
}

/** Whether a statement is negated ("don't", "never", "not", 않다…). */
export function negated(statement: string): boolean {
  if (KOREAN_NEGATION.test(statement.normalize("NFKC"))) return true;
  return tokens(statement).some((t) => NEGATIONS.has(t) || t.endsWith("n't"));
}

/** The meaningful words of a statement. Hangul runs become two-letter pieces,
 * since Korean particles attach to the word they follow. */
export function principleWords(statement: string): Set<string> {
  const out = new Set<string>();
  for (const raw of tokens(statement)) {
    if (/\p{Script=Hangul}/u.test(raw)) {
      if (raw.length < 2) continue;
      for (let i = 0; i + 1 < raw.length; i += 1) out.add(raw.slice(i, i + 2));
      continue;
    }
    if (NEGATIONS.has(raw) || raw.endsWith("n't") || STOP.has(raw)) continue;
    const word = raw.replace(/'s$/u, "");
    if (word.length < 3 || STOP.has(word)) continue;
    out.add(stem(word));
  }
  return out;
}

/** The minimum agreement for two principles to count as one shared principle. */
export const OVERLAP_FLOOR = 0.5;
const SHARED_WORDS_FLOOR = 2;

/** Dice overlap of the meaningful words, 0..1; 0 below two shared words, and
 * 0 when one says the opposite of the other. */
export function principleOverlap(a: string, b: string): number {
  if (negated(a) !== negated(b)) return 0;
  const left = principleWords(a), right = principleWords(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  if (shared < SHARED_WORDS_FLOOR) return 0;
  return (2 * shared) / (left.size + right.size);
}

// ---------------------------------------------------------------------------
// Each side's state, from its own answer and its own clock
// ---------------------------------------------------------------------------

type Row = typeof introductions.$inferSelect;
function mine(row: Row, profileId: string) {
  const a = row.profileAId === profileId;
  return {
    answer: a ? row.answerA : row.answerB, answeredAt: a ? row.answeredAAt : row.answeredBAt,
    seen: a ? row.seenAAt : row.seenBAt, text: a ? row.principleAText : row.principleBText,
    otherId: a ? row.profileBId : row.profileAId,
  };
}
const within = (from: Date | null, now: Date) => Boolean(from) && now.getTime() - from!.getTime() < WINDOW_MS;
export function sideState(row: Row, profileId: string, now: Date): "ask" | "waiting" | "introduced" | null {
  if (row.closedAt) return null;
  const me = mine(row, profileId);
  if (row.status === "accepted") return me.seen ? null : "introduced";
  if (me.answer === null) return within(row.createdAt, now) ? "ask" : null;
  if (me.answer === "yes") return within(me.answeredAt, now) ? "waiting" : null;
  return null;
}
/* The same three conditions in SQL, for the matcher's "busy". Keep in step
   with `sideState`. */
const BUSY = (column: string) => {
  const w = `interval '${INTRODUCTION_WINDOW_DAYS} days'`;
  const side = (s: "a" | "b") => `(i.profile_${s}_id = ${column} AND (
      (i.status = 'accepted' AND i.seen_${s}_at IS NULL)
      OR (i.status <> 'accepted' AND i.answer_${s} IS NULL AND i.created_at > now() - ${w})
      OR (i.status <> 'accepted' AND i.answer_${s} = 'yes' AND i.answered_${s}_at > now() - ${w})))`;
  return sql.raw(`EXISTS (SELECT 1 FROM introductions i WHERE i.closed_at IS NULL AND (${side("a")} OR ${side("b")}))`);
};

/** A match pass to queue for a person who has just become free, or will at `runAfter`. */
export interface FollowUp { profileId: string; key: string; runAfter?: Date }
const passAt = (profileId: string, key: string, from?: Date): FollowUp =>
  from ? { profileId, key, runAfter: new Date(from.getTime() + WINDOW_MS + 60_000) } : { profileId, key };

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

const involves = (profileId: string) => or(eq(introductions.profileAId, profileId), eq(introductions.profileBId, profileId));

async function dbNow(db: Pick<Db, "execute">): Promise<Date> {
  const [row] = (await db.execute(sql`SELECT now() AS now`)) as unknown as Array<{ now: Date | string }>;
  return new Date(row!.now);
}

export async function holdsAPrinciple(db: Pick<Db, "select">, profileId: string): Promise<boolean> {
  const [row] = await db.select({ id: principles.id }).from(principles)
    .where(and(eq(principles.profileId, profileId), eq(principles.state, "held"), isNull(principles.unsupportedAt))).limit(1);
  return Boolean(row);
}

export async function readIntroductionState(db: Pick<Db, "select" | "execute">, profileId: string,
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
  const now = await dbNow(db);
  const rows = await db.select().from(introductions).where(and(involves(profileId), isNull(introductions.closedAt)))
    .orderBy(asc(introductions.createdAt), asc(introductions.id));
  /* An introduction both said yes to comes first; then the oldest ask this
     person has not answered. Nothing about the other side's answer is read
     here except through `accepted`, which is the introduction itself. */
  for (const row of rows) {
    if (sideState(row, profileId, now) !== "introduced") continue;
    const me = mine(row, profileId);
    if (!me.text) continue;
    const [other] = await db.select({ name: profiles.name }).from(profiles).where(eq(profiles.id, me.otherId)).limit(1);
    state.introduction = { id: row.id, stage: "introduced", name: firstName(other?.name ?? ""), principle: me.text };
    return state;
  }
  for (const row of rows) {
    if (sideState(row, profileId, now) === "ask") { state.introduction = { id: row.id, stage: "ask" }; return state; }
  }
  return state;
}

// ---------------------------------------------------------------------------
// What a person may do
// ---------------------------------------------------------------------------

/* Recent activity orders the matcher's candidates (`matchIntroductionsForProfile`). */
const touch = (tx: Pick<Db, "execute">, profileId: string) =>
  tx.execute(sql`UPDATE introduction_consents SET updated_at = now() WHERE profile_id = ${profileId}::uuid`);

/**
 * Answer the ask (either way) or flip the switch in Settings.
 *
 * TURNING IT OFF FULLY WITHDRAWS, and still never shows a no:
 *   - every row this person has not answered, or answered yes to without it
 *     completing, takes their no (so turning back on never resurrects a stale
 *     ask). The other side's view is computed from its own answer and clock,
 *     so it does not change;
 *   - an introduction that is complete but not yet seen by both is closed for
 *     both, so this person's name is never shown after they said stop. The
 *     other side, now free, gets a match pass.
 */
export async function setIntroductionConsent(db: Db, profileId: string, enabled: boolean): Promise<FollowUp[]> {
  return db.transaction(async (tx) => {
    await tx.insert(introductionConsents).values({ profileId, enabled })
      .onConflictDoUpdate({ target: introductionConsents.profileId, set: { enabled, updatedAt: sql`now()` } });
    if (enabled) return [passAt(profileId, "now")];
    const closed = (await tx.execute(sql`
      UPDATE introductions SET closed_at = now(), updated_at = now()
       WHERE (profile_a_id = ${profileId}::uuid OR profile_b_id = ${profileId}::uuid)
         AND closed_at IS NULL AND status = 'accepted' AND (seen_a_at IS NULL OR seen_b_at IS NULL)
      RETURNING CASE WHEN profile_a_id = ${profileId}::uuid THEN profile_b_id ELSE profile_a_id END AS other,
                CASE WHEN profile_a_id = ${profileId}::uuid THEN seen_b_at ELSE seen_a_at END AS "otherSeen"`)) as unknown as
      Array<{ other: string; otherSeen: Date | null }>;
    for (const s of ["a", "b"] as const) {
      await tx.execute(sql`
        UPDATE introductions SET ${sql.raw(`answer_${s}`)} = 'no', ${sql.raw(`answered_${s}_at`)} = now(),
               status = CASE WHEN status = 'offered' THEN 'declined' ELSE status END, updated_at = now()
         WHERE ${sql.raw(`profile_${s}_id`)} = ${profileId}::uuid AND closed_at IS NULL AND status <> 'accepted'
           AND (${sql.raw(`answer_${s}`)} IS NULL OR ${sql.raw(`answer_${s}`)} = 'yes')`);
    }
    return closed.filter((row) => !row.otherSeen).map((row) => passAt(row.other, "now"));
  });
}

/** What the person who answered is told. `waiting` is the same whether the
 * other side has not answered yet, already said no, or turned introductions off. */
export type AnswerOutcome =
  | { ok: true; result: { stage: "waiting" } | { stage: "declined" } | IntroductionView & { stage: "introduced" }; followUps: FollowUp[] }
  | { ok: false; status: 404 | 409 };

export async function answerIntroduction(db: Db, profileId: string, id: string, answer: IntroductionAnswer): Promise<AnswerOutcome> {
  const outcome = await db.transaction(async (tx): Promise<AnswerOutcome | "introduced"> => {
    const [row] = await tx.select().from(introductions).where(and(eq(introductions.id, id), involves(profileId))).for("update").limit(1);
    /* Somebody else's introduction answers exactly like one that does not exist. */
    if (!row) return { ok: false, status: 404 };
    const now = await dbNow(tx);
    if (sideState(row, profileId, now) !== "ask") return { ok: false, status: 409 };
    const [consent] = await tx.select({ enabled: introductionConsents.enabled }).from(introductionConsents)
      .where(eq(introductionConsents.profileId, profileId)).limit(1);
    if (answer === "yes" && !consent?.enabled) return { ok: false, status: 409 };
    const a = row.profileAId === profileId;
    const other = { answer: a ? row.answerB : row.answerA, at: a ? row.answeredBAt : row.answeredAAt };
    /* Only the other side's yes, still within its own wait, completes it. */
    const completes = answer === "yes" && other.answer === "yes" && within(other.at, now);
    const status = completes ? "accepted" : answer === "no" && row.status === "offered" ? "declined" : row.status;
    await tx.update(introductions).set({
      ...(a ? { answerA: answer, answeredAAt: sql`now()` } : { answerB: answer, answeredBAt: sql`now()` }),
      status, updatedAt: sql`now()`,
    }).where(eq(introductions.id, row.id));
    await touch(tx, profileId);
    if (answer === "no") return { ok: true, result: { stage: "declined" }, followUps: [passAt(profileId, "now")] };
    if (completes) return "introduced";
    /* The yes waits quietly; when its window lapses this person is free again. */
    return { ok: true, result: { stage: "waiting" }, followUps: [passAt(profileId, `waited:${row.id}`, now)] };
  });
  if (outcome !== "introduced") return outcome;
  const state = await readIntroductionState(db, profileId, true);
  return state.introduction?.stage === "introduced" && state.introduction.id === id
    ? { ok: true, result: state.introduction, followUps: [] }
    : { ok: true, result: { stage: "waiting" }, followUps: [] };
}

/** Done on the introduction: it is not shown to this side again. */
export async function markIntroductionSeen(db: Db, profileId: string, id: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`
      UPDATE introductions SET
        seen_a_at = CASE WHEN profile_a_id = ${profileId}::uuid THEN coalesce(seen_a_at, now()) ELSE seen_a_at END,
        seen_b_at = CASE WHEN profile_b_id = ${profileId}::uuid THEN coalesce(seen_b_at, now()) ELSE seen_b_at END,
        updated_at = now()
      WHERE id = ${id}::uuid AND status = 'accepted' AND closed_at IS NULL
        AND (profile_a_id = ${profileId}::uuid OR profile_b_id = ${profileId}::uuid)
      RETURNING id`);
    if (!(rows as unknown as unknown[]).length) return false;
    await touch(tx, profileId);
    return true;
  });
}

// ---------------------------------------------------------------------------
// The matcher (the `match_introductions` job)
// ---------------------------------------------------------------------------

/** How many consenting people one pass reads: the most recently active
 * first, so a long tail of idle consents never starves newcomers. */
const CANDIDATES_PER_PASS = 500;

export type MatchResult = "off" | "not_consenting" | "busy" | "none" | "matched";

export interface MatchOptions {
  available?: boolean;
  /** How many candidates one pass reads (default `CANDIDATES_PER_PASS`). */
  candidateLimit?: number;
  /** Runs inside the pass's transaction before it commits (the job's ownership check). */
  beforeCommit?: (tx: Tx) => Promise<void>;
  /** Runs inside the transaction once a match is written: queue each side's lapse pass. */
  onMatched?: (tx: Tx, followUps: FollowUp[]) => Promise<void>;
}

export async function matchIntroductionsForProfile(db: Db, profileId: string, options: MatchOptions = {}): Promise<MatchResult> {
  if (!(options.available ?? introductionsAvailable())) return "off";
  return db.transaction(async (tx) => {
    /* One matcher at a time across the install, so two passes can never both
       hand the same person a new ask. The pass reads no saves and calls no
       model, so holding it is short. */
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('waka:match_introductions'))`);
    const settle = async (result: MatchResult) => { await options.beforeCommit?.(tx); return result; };
    const [me] = await tx.execute(sql`
      SELECT p.account_id AS "accountId", ${BUSY("p.id")} AS busy
        FROM profiles p JOIN introduction_consents c ON c.profile_id = p.id AND c.enabled
       WHERE p.id = ${profileId}::uuid AND p.type = 'human' AND p.account_id IS NOT NULL`) as unknown as Array<{ accountId: string; busy: boolean }>;
    if (!me) return settle("not_consenting");
    if (me.busy) return settle("busy");
    const candidates = await tx.execute(sql`
      SELECT p.id FROM profiles p JOIN introduction_consents c ON c.profile_id = p.id AND c.enabled
       WHERE p.type = 'human' AND p.account_id IS NOT NULL AND p.account_id <> ${me.accountId}::uuid
         AND p.id <> ${profileId}::uuid
         AND NOT EXISTS (SELECT 1 FROM introductions i
                          WHERE (i.profile_a_id = p.id AND i.profile_b_id = ${profileId}::uuid)
                             OR (i.profile_b_id = p.id AND i.profile_a_id = ${profileId}::uuid))
         AND NOT ${BUSY("p.id")}
       ORDER BY c.updated_at DESC, p.id
       LIMIT ${options.candidateLimit ?? CANDIDATES_PER_PASS}`) as unknown as Array<{ id: string }>;
    if (!candidates.length) return settle("none");
    const ids = [profileId, ...candidates.map((row) => row.id)];
    /* Statements only: id, owner and words. Nothing else is selected. */
    const held = await tx.select({ id: principles.id, profileId: principles.profileId, statement: principles.statement })
      .from(principles)
      .where(and(inArray(principles.profileId, ids), eq(principles.state, "held"), isNull(principles.unsupportedAt)))
      .orderBy(asc(principles.rank), asc(principles.id));
    const own = held.filter((row) => row.profileId === profileId);
    if (!own.length) return settle("none");
    let best: { score: number; mine: (typeof held)[number]; theirs: (typeof held)[number] } | null = null;
    for (const theirs of held) {
      if (theirs.profileId === profileId) continue;
      for (const mineRow of own) {
        const score = principleOverlap(mineRow.statement, theirs.statement);
        if (score >= OVERLAP_FLOOR && (!best || score > best.score)) best = { score, mine: mineRow, theirs };
      }
    }
    if (!best) return settle("none");
    const aIsMe = profileId < best.theirs.profileId;
    const [a, b] = aIsMe ? [best.mine, best.theirs] : [best.theirs, best.mine];
    const inserted = await tx.insert(introductions).values({
      profileAId: a.profileId, profileBId: b.profileId, principleAId: a.id, principleBId: b.id,
      principleAText: a.statement, principleBText: b.statement,
    }).onConflictDoNothing().returning({ id: introductions.id, createdAt: introductions.createdAt });
    if (!inserted.length) return settle("none");
    /* An unanswered ask lapses for both sides at the same moment; a pass then
       finds them free. */
    const row = inserted[0]!;
    await options.onMatched?.(tx, [a.profileId, b.profileId].map((id) => passAt(id, `asked:${row.id}`, row.createdAt)));
    return settle("matched");
  });
}
