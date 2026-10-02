/**
 * Drizzle ORM schema — feedback.
 *
 * A reader's verdict on something WAKA generated: is this signal true? does
 * this top-of-mind entry land? Feedback teaches the next regeneration.
 *
 * Deliberately narrow. Pin, dismiss, and lock are **not** feedback — they
 * are entry state, stored as columns on the entry, because the generator has
 * to read them on every pass and "is this pinned?" should never require
 * reconstructing a history of reactions. What remains here is the part that
 * is genuinely a reaction: whether the claim rings true.
 */

import { relations, sql } from "drizzle-orm";
import { bigint, check, index, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { profiles } from "./schema-profiles";

export const feedbackTargetTypeValues = ["signal", "top_of_mind_entry", "principle"] as const;
export type FeedbackTargetType = (typeof feedbackTargetTypeValues)[number];
export const feedbackTargetTypeEnum = pgEnum("feedback_target_type", feedbackTargetTypeValues);

export const feedbackValueValues = ["true", "partly", "not_true"] as const;
export type FeedbackValue = (typeof feedbackValueValues)[number];
export const feedbackValueEnum = pgEnum("feedback_value", feedbackValueValues);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    targetType: feedbackTargetTypeEnum("target_type").notNull(),
    /**
     * Deliberately not a foreign key: it points at two different tables, and
     * feedback outliving its target is useful history rather than a defect.
     */
    targetId: uuid("target_id").notNull(),
    /** Null legacy bindings refer only to the migration's revision-one baseline. */
    targetRevision: bigint("target_revision", { mode: "bigint" }),

    value: feedbackValueEnum("value").notNull(),
    /** The correction itself, when the reader bothered to write one. */
    correctionText: text("correction_text"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    targetRevisionPositive: check("feedback_target_revision_positive", sql`${table.targetRevision} > 0`),
    profileTargetIdx: index("feedback_profile_target_idx").on(
      table.profileId,
      table.targetType,
      table.targetId,
    ),
    // Regeneration reads "recent feedback" for a profile, newest first.
    profileCreatedIdx: index("feedback_profile_created_idx").on(
      table.profileId,
      table.createdAt.desc(),
    ),
  }),
);

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;

export const feedbackRelations = relations(feedback, ({ one }) => ({
  profile: one(profiles, {
    fields: [feedback.profileId],
    references: [profiles.id],
  }),
}));
