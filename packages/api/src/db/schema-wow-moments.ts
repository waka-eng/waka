/**
 * Drizzle ORM schema — WOW moments foundation.
 *
 * This slice only models persisted WOW moments and their related inspirations.
 * Generation, scoring updates, Gemini embeddings, and background workers land in
 * later PRs; the user-facing route can already list rows created by a seed,
 * script, or future worker.
 */

import { relations } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { inspirations, users } from "./schema";

export const wowKindEnumValues = [
  "recurrence",
  "bridge",
  "surprise_bridge",
  "tension",
  "outlier",
] as const;

export type WowKind = (typeof wowKindEnumValues)[number];

export const wowKindEnum = pgEnum("wow_kind", wowKindEnumValues);

/**
 * Persisted WOW moment shown to users. `wowScore` is a denormalised snapshot
 * owned by the future signal-updater pipeline, not calculated on GET.
 */
export const wowMoments = pgTable(
  "wow_moments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: wowKindEnum("kind").notNull(),
    why: text("why").notNull(),
    reflectionQuestion: text("reflection_question"),
    wowScore: integer("wow_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index("wow_moments_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    userScoreIdx: index("wow_moments_user_score_idx").on(
      table.userId,
      table.wowScore.desc(),
    ),
  }),
);

/** Join rows explain the role each inspiration played in the WOW moment. */
export const wowMomentInspirations = pgTable(
  "wow_moment_inspirations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wowMomentId: uuid("wow_moment_id")
      .notNull()
      .references(() => wowMoments.id, { onDelete: "cascade" }),
    inspirationId: uuid("inspiration_id")
      .notNull()
      .references(() => inspirations.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("related"),
    reason: text("reason").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    momentOrderIdx: index("wow_moment_inspirations_moment_order_idx").on(
      table.wowMomentId,
      table.sortOrder,
    ),
    inspirationIdx: index("wow_moment_inspirations_inspiration_idx").on(
      table.inspirationId,
    ),
  }),
);

export type WowMoment = typeof wowMoments.$inferSelect;
export type NewWowMoment = typeof wowMoments.$inferInsert;
export type WowMomentInspiration = typeof wowMomentInspirations.$inferSelect;
export type NewWowMomentInspiration = typeof wowMomentInspirations.$inferInsert;

export const wowMomentsRelations = relations(wowMoments, ({ one, many }) => ({
  user: one(users, {
    fields: [wowMoments.userId],
    references: [users.id],
  }),
  relatedInspirations: many(wowMomentInspirations),
}));

export const wowMomentInspirationsRelations = relations(
  wowMomentInspirations,
  ({ one }) => ({
    wowMoment: one(wowMoments, {
      fields: [wowMomentInspirations.wowMomentId],
      references: [wowMoments.id],
    }),
    inspiration: one(inspirations, {
      fields: [wowMomentInspirations.inspirationId],
      references: [inspirations.id],
    }),
  }),
);
