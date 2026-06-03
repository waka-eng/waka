/**
 * Drizzle ORM schema - user feedback.
 *
 * Feedback is intentionally polymorphic: users can validate or correct signals,
 * context nodes, top-of-mind notes, and hypotheses without forcing those target
 * tables to know about every future feedback workflow.
 */

import { relations, sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { users } from "./schema";

export const feedbackTargetEnumValues = [
  "signal",
  "context_node",
  "top_of_mind_note",
  "hypothesis",
] as const;

export type FeedbackTarget = (typeof feedbackTargetEnumValues)[number];

export const feedbackTargetEnum = pgEnum(
  "feedback_target",
  feedbackTargetEnumValues,
);

export const feedbackValueEnumValues = [
  "true",
  "partly",
  "not_true",
  "important",
  "not_important",
] as const;

export type FeedbackValue = (typeof feedbackValueEnumValues)[number];

export const feedbackValueEnum = pgEnum(
  "feedback_value",
  feedbackValueEnumValues,
);

export const feedbackEmotionEnumValues = [
  "admire",
  "envy",
  "want",
  "fear",
  "curious",
  "aesthetic_only",
] as const;

export type FeedbackEmotion = (typeof feedbackEmotionEnumValues)[number];

export const feedbackEmotionEnum = pgEnum(
  "feedback_emotion",
  feedbackEmotionEnumValues,
);

export const feedback = pgTable(
  "feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    targetType: feedbackTargetEnum("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    value: feedbackValueEnum("value").notNull(),
    emotionLabel: feedbackEmotionEnum("emotion_label"),
    correctionText: text("correction_text"),
    source: text("source").notNull().default("user"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userTargetIdx: index("feedback_user_target_idx").on(
      table.userId,
      table.targetType,
      table.targetId,
    ),
    userCreatedIdx: index("feedback_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
  }),
);

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;

export const feedbackRelations = relations(feedback, ({ one }) => ({
  user: one(users, {
    fields: [feedback.userId],
    references: [users.id],
  }),
}));
