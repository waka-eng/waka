/**
 * INTRODUCTIONS: TWO CONSENTING PEOPLE WHOSE PRINCIPLES OVERLAP (design
 * "Agent introductions", approved 2026-11-27; insight goal, "Later: values
 * other agents can ask").
 *
 * Two tables, and the privacy model is in their shape:
 *
 *   - `introduction_consents`: one row per HUMAN profile, written only when
 *     the person answers the ask (Introduce us / Not now) or flips the switch
 *     in Settings. No row means never asked, and off. Off is the default and
 *     the matcher reads only rows with `enabled = true`.
 *   - `introductions`: one row per pair, ever. A pair is stored with the
 *     smaller profile id on side A, so the unique index makes "never offered
 *     twice" a database fact. Each side keeps its own answer; the derived
 *     `status` is never returned to either person, because a decline must
 *     look exactly like silence from the other side.
 *
 * Only principles are compared, never inspirations, signals or readings.
 * Each side cites its own principle through a composite key on
 * `(profile_id, principle_id)`, so a row can never cite somebody else's
 * principle. Rewording or deleting the principle, or it ceasing to be held,
 * WITHDRAWS that side (migration 0097's triggers): its id and words are
 * nulled, so no copy of withdrawn words is kept, and `withdrawn_x_at` is set.
 * The OTHER side's view does not change at all: their ask stays answerable
 * and a yes just waits, until the ordinary lapse. The row itself stays, so
 * the pair is never offered again.
 *
 * TIME IS THE ONLY THING THAT CLOSES A SIDE QUIETLY. An unanswered ask, and
 * a yes still waiting on the other side, each lapse `INTRODUCTION_WINDOW`
 * after they began (`lib/introductions.ts`). A no never closes the row and
 * never changes anything the other side can see.
 *
 * Humans only: a trigger in migration 0097 refuses agent and room profiles in
 * either table, beneath the route's `humanSessionsOnly`.
 */
import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { principles } from "./schema-principles";
import { profiles } from "./schema-profiles";

export const introductionConsents = pgTable("introduction_consents", {
  profileId: uuid("profile_id").primaryKey().references(() => profiles.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  /** When the person first answered the ask, either way. It never repeats. */
  answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const introductionStatusValues = ["offered", "accepted", "declined"] as const;
export type IntroductionStatus = (typeof introductionStatusValues)[number];
export const introductionAnswerValues = ["yes", "no"] as const;
export type IntroductionAnswer = (typeof introductionAnswerValues)[number];

export const introductions = pgTable("introductions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * EACH SIDE'S OWN HANDLE. The only id a person is ever given for this row,
   * in what they read and in the URLs they answer through. Two random
   * values, so the two people never hold a shared token that would let them
   * (or anyone who sees both sides' logs or storage) confirm they are each
   * other's match. The row id never leaves the server.
   */
  handleA: uuid("handle_a").notNull().defaultRandom(),
  handleB: uuid("handle_b").notNull().defaultRandom(),
  /**
   * Null once that person's account is erased. Erasure is a withdrawal of
   * their side (migration 0097's profile trigger erases their words first),
   * never a delete of the shared row: deleting it would change what the
   * other side sees, and so tell them something.
   */
  profileAId: uuid("profile_a_id").references(() => profiles.id, { onDelete: "set null" }),
  profileBId: uuid("profile_b_id").references(() => profiles.id, { onDelete: "set null" }),
  /** Null once that side withdrew the principle (reworded or deleted it). */
  principleAId: uuid("principle_a_id"),
  principleBId: uuid("principle_b_id"),
  /** Each side's own words, shown only to that side; null once withdrawn. */
  principleAText: text("principle_a_text"),
  principleBText: text("principle_b_text"),
  /** offered until both say yes (accepted) or either says no (declined). Internal only. */
  status: text("status").$type<IntroductionStatus>().notNull().default("offered"),
  answerA: text("answer_a").$type<IntroductionAnswer>(),
  answerB: text("answer_b").$type<IntroductionAnswer>(),
  answeredAAt: timestamp("answered_a_at", { withTimezone: true }),
  answeredBAt: timestamp("answered_b_at", { withTimezone: true }),
  /** Done on the introduction: it is not shown to that side again. */
  seenAAt: timestamp("seen_a_at", { withTimezone: true }),
  seenBAt: timestamp("seen_b_at", { withTimezone: true }),
  /** That side withdrew its principle: it sees nothing more, and the row can never complete. */
  withdrawnAAt: timestamp("withdrawn_a_at", { withTimezone: true }),
  withdrawnBAt: timestamp("withdrawn_b_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pairUnique: uniqueIndex("introductions_pair_unique_idx").on(table.profileAId, table.profileBId),
  handleAUnique: uniqueIndex("introductions_handle_a_unique_idx").on(table.handleA),
  handleBUnique: uniqueIndex("introductions_handle_b_unique_idx").on(table.handleB),
  profileBIdx: index("introductions_profile_b_idx").on(table.profileBId),
  principleAFk: foreignKey({ columns: [table.profileAId, table.principleAId],
    foreignColumns: [principles.profileId, principles.id], name: "introductions_principle_a_fk" }),
  principleBFk: foreignKey({ columns: [table.profileBId, table.principleBId],
    foreignColumns: [principles.profileId, principles.id], name: "introductions_principle_b_fk" }),
  orderedPair: check("introductions_ordered_pair_check", sql`${table.profileAId} < ${table.profileBId}`),
  statusCheck: check("introductions_status_check", sql`${table.status} IN ('offered', 'accepted', 'declined')`),
  answerCheck: check("introductions_answer_check",
    sql`(${table.answerA} IS NULL OR ${table.answerA} IN ('yes', 'no')) AND (${table.answerB} IS NULL OR ${table.answerB} IN ('yes', 'no'))`),
}));

/**
 * People to look at again: written by migration 0097's principle triggers (a
 * principle withdrawn, or one becoming held for a consenting person) and
 * drained by application code into ordinary `match_introductions` jobs
 * (`drainIntroductionFollowUps` in `lib/queue.ts`), so the queue has one
 * enqueue path.
 */
export const introductionFollowups = pgTable("introduction_followups", {
  profileId: uuid("profile_id").primaryKey().references(() => profiles.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
