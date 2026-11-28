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
 *     ("Someone else holds one of your principles"). The visiting creature
 *     and the shared principle appear only when BOTH say Introduce us to that
 *     match, and even then nothing identifies the other person.
 *  5. A NO IS NEVER OBSERVABLE. Each side's state is computed from its OWN
 *     answer and its OWN clock, never from the other side's answer: an
 *     unanswered ask stays an ask, and a yes stays "waiting", until
 *     `INTRODUCTION_WINDOW` after it began, and then lapses quietly. That
 *     lapse is identical whether the other side said no, said nothing, or
 *     turned introductions off. The only thing the other side's answer can
 *     do is complete an introduction, and only a yes does that.
 *  6. NOTHING IS EVER SAID ABOUT THE OTHER PERSON beyond the fact that they
 *     hold the principle. No name at all: a "first name" leaked whole names
 *     (Korean names have no space, some orders put the surname first), and
 *     with no way to message there is nothing a name would be for. Each side
 *     reads the principle in its OWN words; the other side's wording is
 *     stored for them and returned only to them.
 *  7. ONE AT A TIME. A person with an open ask, a waiting yes or an unseen
 *     introduction is not matched again until it settles or lapses, and a
 *     pair is offered once, ever (the row is kept even when a principle is
 *     withdrawn; only the withdrawn words are erased, see migration 0097).
 *  8. A WITHDRAWAL IS SILENT. A principle reworded, deleted or no longer held
 *     withdraws only its own side; the other side's view is computed exactly
 *     as before and lapses at the ordinary time.
 *
 * Matching runs on the queue (`match_introductions`), and only where
 * `WAKA_INTRODUCTIONS=1`. With the flag unset the routes report the feature
 * unavailable, nothing is enqueued and a queued job does nothing.
 */
import { and, asc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";

import { introductionConsents, introductions, principles } from "../db/index.js";
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
/* Korean negation, read as a whole word, never as a piece inside another
   word (잘못 "a mistake" is not 못 "cannot"): 못 standing alone, 아니다, a
   word that begins with 않/못하 (or 지않 run together), and 없다/없는/없이
   standing alone. */
/* 안 is not read at all: as its own word it is as often "inside" (마음 안)
   as "not". 없다 counts only as a word of its own (변명 없이), never inside an
   adverb (끊임없이, 아낌없이). */
const KOREAN_NEGATION_WORDS = new Set(["못", "아니다", "아닌", "아니라", "아니고"]);
/* 없다 only in its own predicate forms (없애다 "remove" is not one), and 지않
   run together except in 못지않게 ("no less than"). */
const KOREAN_NONE = /^없(다|어|어서|어요|었다|었고|었던|는|던|이|고|음|을|으면|으며|지만|으니|기에)$/u;
const koreanNegated = (word: string) => KOREAN_NEGATION_WORDS.has(word)
  || /^(않|못하|못한|못해|못했)/u.test(word) || (/지않/u.test(word) && !/못지않/u.test(word)) || KOREAN_NONE.test(word);

/* Korean function pieces: whole words that carry no content, the endings and
   particles taken off a word's end before it is cut into pieces, and pieces
   that are endings in disguise. Without them "…하는 것이 중요하다" alone made
   two unrelated principles look alike. */
const KOREAN_STOP_WORDS = new Set(["것", "것이", "것은", "것을", "것도", "수", "더", "잘", "그리고", "그러나", "하지만", "또", "또는",
  "그", "이", "저", "나", "내", "나는", "내가", "우리", "우리는", "늘", "항상", "언제나", "때", "때는", "중요하다", "중요한"]);
const KOREAN_ENDINGS = ["하는", "하게", "하고", "하며", "하면", "하기", "하다", "한다", "했다", "해야", "이다", "이고", "에서", "으로", "보다",
  "처럼", "까지", "부터", "에게", "는", "은", "을", "를", "이", "가", "에", "의", "도", "로", "게", "고", "다", "며", "면"];
const KOREAN_STOP_PIECES = new Set(["것이", "하다", "하는", "한다", "하게", "하고", "하기", "중요", "요하", "있다", "있는", "에서", "으로",
  "그리", "리고", "이다", "되는", "된다", "없다", "않는", "않다", "는것"]);

function koreanPieces(word: string, out: Set<string>): void {
  if (KOREAN_STOP_WORDS.has(word)) return;
  let w = word;
  for (const end of KOREAN_ENDINGS) {
    if (w.endsWith(end) && w.length - end.length >= 2) { w = w.slice(0, -end.length); break; }
  }
  if (w.length < 2) return;
  const add = (piece: string) => { if (!KOREAN_STOP_PIECES.has(piece)) out.add(piece); };
  if (w.length === 2) { add(w); return; }
  for (let i = 0; i + 1 < w.length; i += 1) add(w.slice(i, i + 2));
}

/** A light English stemmer: plural, -ing, -ed, a doubled final consonant, a
 * silent e. "values" and "value", "creates" and "create", "planning" and
 * "plan" all land on one stem. */
export function stem(word: string): string {
  let w = word;
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 4 && /(ss|sh|ch|x|z)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) w = w.slice(0, -1);
  /* -ed only where a real base of four or more letters is left and the word
     is not one that merely ends in "eed" (speed, need). A doubled final
     consonant is undone only on a base longer than three letters, so
     planning lands on plan and adding stays on add. */
  const base = w.endsWith("ing") ? w.slice(0, -3) : w.endsWith("ed") && !w.endsWith("eed") && w.length - 2 > 3 ? w.slice(0, -2) : null;
  if (base !== null && base.length >= 3) {
    w = base;
    if (w.length > 3 && /([b-df-hj-np-tv-z])\1$/.test(w) && !/(ll|ss|zz)$/.test(w)) w = w.slice(0, -1);
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
  return tokens(statement).some((t) => /\p{Script=Hangul}/u.test(t) ? koreanNegated(t) : NEGATIONS.has(t) || t.endsWith("n't"));
}

/** The meaningful words of a statement. Hangul runs become two-letter pieces,
 * since Korean particles attach to the word they follow. */
export function principleWords(statement: string): Set<string> {
  const out = new Set<string>();
  for (const raw of tokens(statement)) {
    if (/\p{Script=Hangul}/u.test(raw)) { if (!koreanNegated(raw)) koreanPieces(raw, out); continue; }
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
    handle: a ? row.handleA : row.handleB,
    withdrawn: a ? row.withdrawnAAt : row.withdrawnBAt,
    answer: a ? row.answerA : row.answerB, answeredAt: a ? row.answeredAAt : row.answeredBAt,
    seen: a ? row.seenAAt : row.seenBAt, text: a ? row.principleAText : row.principleBText,
    otherId: a ? row.profileBId : row.profileAId,
  };
}
const within = (from: Date | null, now: Date) => Boolean(from) && now.getTime() - from!.getTime() < WINDOW_MS;
export function sideState(row: Row, profileId: string, now: Date): "ask" | "waiting" | "introduced" | null {
  const me = mine(row, profileId);
  if (me.withdrawn) return null;
  if (row.status === "accepted") return me.seen ? null : "introduced";
  if (me.answer === null) return within(row.createdAt, now) ? "ask" : null;
  /* A yes waits only as long as the ask was open: both end at createdAt + window. */
  if (me.answer === "yes") return within(row.createdAt, now) ? "waiting" : null;
  return null;
}
/* The same three conditions in SQL, for the matcher's "busy". Keep in step
   with `sideState`. */
const BUSY = (who: SQL) => {
  const w = sql.raw(`interval '${INTRODUCTION_WINDOW_DAYS} days'`);
  const side = (s: "a" | "b") => sql`(${sql.raw(`i.profile_${s}_id`)} = ${who} AND ${sql.raw(`i.withdrawn_${s}_at`)} IS NULL AND (
      (i.status = 'accepted' AND ${sql.raw(`i.seen_${s}_at`)} IS NULL)
      OR (i.status <> 'accepted' AND (${sql.raw(`i.answer_${s}`)} IS NULL OR ${sql.raw(`i.answer_${s}`)} = 'yes') AND i.created_at > now() - ${w})))`;
  return sql`EXISTS (SELECT 1 FROM introductions i WHERE ${side("a")} OR ${side("b")})`;
};

/** A match pass to queue for a person who has just become free, or will at `runAfter`. */
export interface FollowUp { profileId: string; key: string; runAfter?: Date }
/* ONE LOCK FOR EVERY WRITE THAT DECIDES WHICH TWO PEOPLE ARE PAIRED: the matcher,
   the consent switch and an answer. So a revocation and the other side's
   yes, or a revocation and a match, can never interleave. Writes here are
   rare and short (no model call, no saves read). */
const lockIntroductions = (tx: Pick<Db, "execute">) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('waka:introductions'))`);

const passAt = (profileId: string, key: string, from?: Date): FollowUp =>
  from ? { profileId, key, runAfter: new Date(from.getTime() + WINDOW_MS + 60_000) } : { profileId, key };

// ---------------------------------------------------------------------------
// What a person may read
// ---------------------------------------------------------------------------

export type IntroductionView =
  /** A match waiting on this person. Nothing about the other side. `id` is
      this person's own handle for it, never the row id. */
  | { id: string; stage: "ask" }
  /** Both said yes. This person's own principle words, and nothing about the other. */
  | { id: string; stage: "introduced"; principle: string };

export interface IntroductionState {
  available: boolean;
  consent: { enabled: boolean; answered: boolean };
  /** True once: the first ask, for a person who holds a principle and has never answered. */
  offerConsent: boolean;
  introduction: IntroductionView | null;
}

/* A person reaches a row only through their OWN side's handle: the other
   side's handle, or the row id, finds nothing, exactly like a missing row. */
const byHandle = (profileId: string, handle: string) => or(
  and(eq(introductions.handleA, handle), eq(introductions.profileAId, profileId)),
  and(eq(introductions.handleB, handle), eq(introductions.profileBId, profileId)));
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
  const rows = await db.select().from(introductions).where(involves(profileId))
    .orderBy(asc(introductions.createdAt), asc(introductions.id));
  /* An introduction both said yes to comes first; then the oldest ask this
     person has not answered. Nothing about the other side's answer is read
     here except through `accepted`, which is the introduction itself. */
  for (const row of rows) {
    if (sideState(row, profileId, now) !== "introduced") continue;
    const me = mine(row, profileId);
    if (!me.text) continue;
    state.introduction = { id: me.handle, stage: "introduced", principle: me.text };
    return state;
  }
  for (const row of rows) {
    if (sideState(row, profileId, now) === "ask") { state.introduction = { id: mine(row, profileId).handle, stage: "ask" }; return state; }
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
 * TURNING IT OFF WITHDRAWS THIS PERSON'S SIDE OF EVERY ROW, and nothing else:
 *   - an open row takes their no, so turning back on never resurrects a stale
 *     ask, and a yes still waiting can no longer complete;
 *   - every row is marked withdrawn on their side and their principle words
 *     are erased; the row stays, so the pair is never offered twice;
 *   - the other side's view does not change at all. Their ask stays, their
 *     yes waits, and a complete introduction they have not dismissed stays
 *     on their screen: it carries only their own principle, nothing about
 *     this person, so leaving it shows nothing that was taken back.
 */
export async function setIntroductionConsent(db: Db, profileId: string, enabled: boolean): Promise<FollowUp[]> {
  return db.transaction(async (tx) => {
    await lockIntroductions(tx);
    await tx.insert(introductionConsents).values({ profileId, enabled })
      .onConflictDoUpdate({ target: introductionConsents.profileId, set: { enabled, updatedAt: sql`now()` } });
    if (enabled) return [passAt(profileId, "now")];
    for (const s of ["a", "b"] as const) {
      const col = (name: string) => sql.raw(`${name}_${s}`);
      const pcol = (name: string) => sql.raw(name.replace("?", s));
      await tx.execute(sql`
        UPDATE introductions SET
          ${col("answer")} = CASE WHEN status = 'offered' AND (${col("answer")} IS NULL OR ${col("answer")} = 'yes') THEN 'no' ELSE ${col("answer")} END,
          ${pcol("answered_?_at")} = CASE WHEN status = 'offered' AND (${col("answer")} IS NULL OR ${col("answer")} = 'yes') THEN now() ELSE ${pcol("answered_?_at")} END,
          status = CASE WHEN status = 'offered' THEN 'declined' ELSE status END,
          ${pcol("principle_?_id")} = NULL, ${pcol("principle_?_text")} = NULL,
          ${pcol("withdrawn_?_at")} = coalesce(${pcol("withdrawn_?_at")}, now()),
          updated_at = now()
         WHERE ${pcol("profile_?_id")} = ${profileId}::uuid`);
    }
    return [];
  });
}

/** What the person who answered is told. `waiting` is the same whether the
 * other side has not answered yet, already said no, or turned introductions off. */
export type AnswerOutcome =
  | { ok: true; result: { stage: "waiting" } | { stage: "declined" } | IntroductionView & { stage: "introduced" }; followUps: FollowUp[] }
  | { ok: false; status: 404 | 409 };

export async function answerIntroduction(db: Db, profileId: string, handle: string, answer: IntroductionAnswer): Promise<AnswerOutcome> {
  const outcome = await db.transaction(async (tx): Promise<AnswerOutcome | "introduced"> => {
    await lockIntroductions(tx);
    const [row] = await tx.select().from(introductions).where(byHandle(profileId, handle)).for("update").limit(1);
    /* Somebody else's introduction answers exactly like one that does not exist. */
    if (!row) return { ok: false, status: 404 };
    const now = await dbNow(tx);
    if (sideState(row, profileId, now) !== "ask") return { ok: false, status: 409 };
    const [consent] = await tx.select({ enabled: introductionConsents.enabled }).from(introductionConsents)
      .where(eq(introductionConsents.profileId, profileId)).limit(1);
    if (answer === "yes" && !consent?.enabled) return { ok: false, status: 409 };
    const a = row.profileAId === profileId;
    const otherId = a ? row.profileBId : row.profileAId;
    const otherAnswer = a ? row.answerB : row.answerA;
    const otherWithdrawn = Boolean(a ? row.withdrawnBAt : row.withdrawnAAt);
    /* Only the other side's yes completes it, and only while they still have
       introductions on: a yes from someone who has since turned them off just
       lapses, as if they had never answered. */
    /* An erased account leaves its side null and withdrawn: never completes. */
    const [otherConsent] = otherId ? await tx.select({ enabled: introductionConsents.enabled }).from(introductionConsents)
      .where(eq(introductionConsents.profileId, otherId)).limit(1) : [];
    const completes = answer === "yes" && otherAnswer === "yes" && !otherWithdrawn && Boolean(otherConsent?.enabled);
    const status = completes ? "accepted" : answer === "no" && row.status === "offered" ? "declined" : row.status;
    await tx.update(introductions).set({
      ...(a ? { answerA: answer, answeredAAt: sql`now()` } : { answerB: answer, answeredBAt: sql`now()` }),
      status, updatedAt: sql`now()`,
    }).where(eq(introductions.id, row.id));
    await touch(tx, profileId);
    if (answer === "no") return { ok: true, result: { stage: "declined" }, followUps: [passAt(profileId, "now")] };
    if (completes) return "introduced";
    /* The yes waits quietly until the ask's own window ends; the pass queued
       for that moment when the match was made frees this person then. */
    return { ok: true, result: { stage: "waiting" }, followUps: [passAt(profileId, `asked:${row.id}`, row.createdAt)] };
  });
  if (outcome !== "introduced") return outcome;
  const state = await readIntroductionState(db, profileId, true);
  return state.introduction?.stage === "introduced" && state.introduction.id === handle
    ? { ok: true, result: state.introduction, followUps: [] }
    : { ok: true, result: { stage: "waiting" }, followUps: [] };
}

/**
 * Done on the introduction: it is not shown to this side again. Under the
 * same lock as every other act, and only for a side that still has
 * introductions on and has not withdrawn. `changed` is false when it had
 * already been dismissed, so no pass is queued for nothing.
 */
export async function markIntroductionSeen(db: Db, profileId: string, handle: string): Promise<"changed" | "unchanged" | "missing"> {
  return db.transaction(async (tx) => {
    await lockIntroductions(tx);
    const [consent] = await tx.select({ enabled: introductionConsents.enabled }).from(introductionConsents)
      .where(eq(introductionConsents.profileId, profileId)).limit(1);
    if (!consent?.enabled) return "missing";
    const [row] = await tx.select().from(introductions).where(byHandle(profileId, handle)).for("update").limit(1);
    if (!row || row.status !== "accepted") return "missing";
    const me = mine(row, profileId);
    if (me.withdrawn) return "missing";
    if (me.seen) return "unchanged";
    const a = row.profileAId === profileId;
    await tx.update(introductions).set({ ...(a ? { seenAAt: sql`now()` } : { seenBAt: sql`now()` }), updatedAt: sql`now()` })
      .where(eq(introductions.id, row.id));
    await touch(tx, profileId);
    return "changed";
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
  /** Tests only: runs after scoring, before each locked insert. */
  beforeInsert?: () => Promise<void>;
  /** Runs inside the transaction once a match is written: queue each side's lapse pass. */
  onMatched?: (tx: Tx, followUps: FollowUp[]) => Promise<void>;
}

export async function matchIntroductionsForProfile(db: Db, profileId: string, options: MatchOptions = {}): Promise<MatchResult> {
  if (!(options.available ?? introductionsAvailable())) return "off";
  /* SCORING HAPPENS OUTSIDE THE LOCK: it reads consents and principle words
     and compares them in memory. Only the final re-check and the insert hold
     the lock the consent switch and answers take, so a pass over hundreds of
     candidates never stalls a person's own act. */
  const [me] = await db.execute(sql`
    SELECT p.account_id AS "accountId", ${BUSY(sql`p.id`)} AS busy
      FROM profiles p JOIN introduction_consents c ON c.profile_id = p.id AND c.enabled
     WHERE p.id = ${profileId}::uuid AND p.type = 'human' AND p.account_id IS NOT NULL`) as unknown as Array<{ accountId: string; busy: boolean }>;
  if (!me) return "not_consenting";
  if (me.busy) return "busy";
  const candidates = await db.execute(sql`
    SELECT p.id FROM profiles p JOIN introduction_consents c ON c.profile_id = p.id AND c.enabled
     WHERE p.type = 'human' AND p.account_id IS NOT NULL AND p.account_id <> ${me.accountId}::uuid
       AND p.id <> ${profileId}::uuid
       AND EXISTS (SELECT 1 FROM principles h WHERE h.profile_id = p.id AND h.state = 'held' AND h.unsupported_at IS NULL)
       AND NOT EXISTS (SELECT 1 FROM introductions i
                        WHERE (i.profile_a_id = p.id AND i.profile_b_id = ${profileId}::uuid)
                           OR (i.profile_b_id = p.id AND i.profile_a_id = ${profileId}::uuid))
       AND NOT ${BUSY(sql`p.id`)}
     ORDER BY c.updated_at DESC, p.id
     LIMIT ${options.candidateLimit ?? CANDIDATES_PER_PASS}`) as unknown as Array<{ id: string }>;
  if (!candidates.length) return "none";
  const ids = [profileId, ...candidates.map((row) => row.id)];
  /* Statements only: id, owner and words. Nothing else is selected. */
  const held = await db.select({ id: principles.id, profileId: principles.profileId, statement: principles.statement })
    .from(principles)
    .where(and(inArray(principles.profileId, ids), eq(principles.state, "held"), isNull(principles.unsupportedAt)))
    .orderBy(asc(principles.rank), asc(principles.id));
  const own = held.filter((row) => row.profileId === profileId);
  if (!own.length) return "none";
  /* The best pair per candidate, best first; up to `TRIES` are tried in
     turn, so one pair refused by the locked re-check (someone turned off,
     was matched elsewhere, or reworded meanwhile) does not end the pass. */
  const bestFor = new Map<string, { score: number; mine: (typeof held)[number]; theirs: (typeof held)[number] }>();
  for (const theirs of held) {
    if (theirs.profileId === profileId) continue;
    for (const mineRow of own) {
      const score = principleOverlap(mineRow.statement, theirs.statement);
      const kept = bestFor.get(theirs.profileId);
      if (score >= OVERLAP_FLOOR && (!kept || score > kept.score)) bestFor.set(theirs.profileId, { score, mine: mineRow, theirs });
    }
  }
  const ranked = [...bestFor.values()].sort((x, y) => y.score - x.score).slice(0, TRIES);
  if (!ranked.length) return "none";
  for (const pick of ranked) {
    await options.beforeInsert?.();
    const result = await insertPair(db, profileId, pick.mine, pick.theirs, options);
    if (result === "matched") return result;
  }
  return "none";
}

/** How many best pairs one pass tries before giving up. */
const TRIES = 5;

type HeldRow = { id: string; profileId: string; statement: string };
async function insertPair(db: Db, profileId: string, mine: HeldRow, theirs: HeldRow, options: MatchOptions): Promise<"matched" | "none"> {
  const aIsMe = profileId < theirs.profileId;
  const [a, b] = aIsMe ? [mine, theirs] : [theirs, mine];
  return db.transaction(async (tx) => {
    await lockIntroductions(tx);
    /* The two principle rows are read FOR SHARE first: a reword or delete
       still in flight is waited for, and one already committed is seen, so
       the words compared below are the words as they stand. A reword that
       starts after this waits for the insert to commit, and its trigger then
       withdraws the new row. */
    await tx.execute(sql`SELECT id FROM principles WHERE (profile_id, id) IN ((${a.profileId}::uuid, ${a.id}::uuid), (${b.profileId}::uuid, ${b.id}::uuid)) FOR SHARE`);
    /* Re-checked under the lock, in the insert itself: both people still have
       introductions on, neither has been handed another open ask meanwhile,
       and both principles are still held in the words that were scored. */
    const inserted = (await tx.execute(sql`
      INSERT INTO introductions (profile_a_id, profile_b_id, principle_a_id, principle_b_id, principle_a_text, principle_b_text)
      SELECT ${a.profileId}::uuid, ${b.profileId}::uuid, ${a.id}::uuid, ${b.id}::uuid, ${a.statement}, ${b.statement}
       WHERE (SELECT count(*) FROM introduction_consents c WHERE c.enabled AND c.profile_id IN (${a.profileId}::uuid, ${b.profileId}::uuid)) = 2
         AND NOT ${BUSY(sql`${a.profileId}::uuid`)} AND NOT ${BUSY(sql`${b.profileId}::uuid`)}
         AND (SELECT count(*) FROM principles p WHERE p.state = 'held' AND p.unsupported_at IS NULL
               AND ((p.profile_id = ${a.profileId}::uuid AND p.id = ${a.id}::uuid AND p.statement = ${a.statement})
                 OR (p.profile_id = ${b.profileId}::uuid AND p.id = ${b.id}::uuid AND p.statement = ${b.statement}))) = 2
      ON CONFLICT DO NOTHING
      RETURNING id, created_at AS "createdAt"`)) as unknown as Array<{ id: string; createdAt: Date | string }>;
    if (!inserted.length) { await options.beforeCommit?.(tx); return "none" as const; }
    /* An unanswered ask lapses for both sides at the same moment; a pass then
       finds them free. */
    const row = inserted[0]!;
    await options.onMatched?.(tx, [a.profileId, b.profileId].map((id) => passAt(id, `asked:${row.id}`, new Date(row.createdAt))));
    await options.beforeCommit?.(tx);
    return "matched" as const;
  });
}
