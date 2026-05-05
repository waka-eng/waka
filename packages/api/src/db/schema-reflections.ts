/**
 * Drizzle ORM schema — reflections table.
 *
 * A reflection is a (question, answer) pair attached to an inspiration. The
 * question is mandatory at creation time; the answer is filled in later by
 * the user, or skipped explicitly via the `skipped` flag. Both states
 * (unanswered-pending and unanswered-skipped) are valid persistent states,
 * which is why `answer` is nullable AND `skipped` is a separate boolean
 * (rather than overloading NULL to mean "skipped").
 *
 * Reflections are scoped to a single inspiration via foreign key with
 * cascade-on-delete, so removing an inspiration also removes its reflections.
 *
 * Out of scope (per Seed): AI auto-generation of the question. The question
 * is supplied by the user (or by a future client-side template) and stored
 * verbatim.
 */

import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { inspirations, users } from "./schema";

// ---------------------------------------------------------------------------
// reflections
// ---------------------------------------------------------------------------

export const reflections = pgTable(
  "reflections",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    inspirationId: uuid("inspiration_id")
      .notNull()
      .references(() => inspirations.id, { onDelete: "cascade" }),

    // Denormalised owner pointer. The reflection is also reachable via
    // inspirations.user_id, but storing user_id directly on this row lets
    // every read path enforce per-user data isolation with a single WHERE
    // clause (no join required) and matches the same pattern used for
    // inspirations and attachments. Cascade on delete so removing a user
    // removes their reflections, even if the inspiration row is gone.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    // The prompt the user is reflecting against. Required at insert.
    question: text("question").notNull(),

    // The user's answer. NULL until the user answers (or forever if skipped).
    answer: text("answer"),

    // Explicit "I don't want to answer this" marker. Distinguishing this
    // from `answer IS NULL` lets the UI render different affordances for
    // pending vs deliberately skipped reflections.
    skipped: boolean("skipped").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // The detail view loads all reflections for an inspiration ordered by
    // creation time; this index supports both the filter and the ordering.
    inspirationCreatedIdx: index("reflections_inspiration_created_idx").on(
      table.inspirationId,
      table.createdAt,
    ),
    // The "all my reflections" view (and per-user authorization checks) walks
    // the table by user_id ordered by created_at DESC. Mirrors the layout of
    // inspirations_user_created_idx.
    userCreatedIdx: index("reflections_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
  }),
);

export type Reflection = typeof reflections.$inferSelect;
export type NewReflection = typeof reflections.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const reflectionsRelations = relations(reflections, ({ one }) => ({
  inspiration: one(inspirations, {
    fields: [reflections.inspirationId],
    references: [inspirations.id],
  }),
  user: one(users, {
    fields: [reflections.userId],
    references: [users.id],
  }),
}));
