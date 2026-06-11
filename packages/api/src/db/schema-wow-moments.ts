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
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { inspirations, signals, users } from "./schema";

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
export const topOfMindNotes = pgTable(
  "top_of_mind_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: wowKindEnum("kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    why: text("why").notNull(),
    beliefStatement: text("belief_statement"),
    reflectionQuestion: text("reflection_question"),
    reflectionGuide: text("reflection_guide"),
    locale: text("locale").notNull().default("en-US"),
    wowScore: integer("wow_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    idempotencyKeyIdx: uniqueIndex("top_of_mind_notes_idempotency_key_unique_idx").on(
      table.idempotencyKey,
    ),
    userCreatedIdx: index("top_of_mind_notes_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
    ),
    userIdIdUnique: uniqueIndex("top_of_mind_notes_user_id_id_unique_idx").on(
      table.userId,
      table.id,
    ),
    userScoreIdx: index("top_of_mind_notes_user_score_idx").on(
      table.userId,
      table.wowScore.desc(),
    ),
  }),
);

export const wowMoments = topOfMindNotes;

/** Join rows explain the role each inspiration played in the WOW moment. */
export const topOfMindNoteSignals = pgTable(
  "top_of_mind_note_signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    wowMomentId: uuid("top_of_mind_note_id")
      .notNull()
      .references(() => topOfMindNotes.id, { onDelete: "cascade" }),
    inspirationId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("related"),
    reason: text("reason").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    momentOrderIdx: index("top_of_mind_note_signals_note_order_idx").on(
      table.userId,
      table.wowMomentId,
      table.sortOrder,
    ),
    inspirationIdx: index("top_of_mind_note_signals_signal_idx").on(
      table.userId,
      table.inspirationId,
    ),
    momentUserFk: foreignKey({
      name: "top_of_mind_note_signals_user_note_fk",
      columns: [table.userId, table.wowMomentId],
      foreignColumns: [topOfMindNotes.userId, topOfMindNotes.id],
    }).onDelete("cascade"),
    inspirationUserFk: foreignKey({
      name: "top_of_mind_note_signals_user_signal_fk",
      columns: [table.userId, table.inspirationId],
      foreignColumns: [signals.userId, signals.id],
    }).onDelete("cascade"),
    momentInspirationUniqueIdx: uniqueIndex(
      "top_of_mind_note_signals_note_signal_unique_idx",
    ).on(table.wowMomentId, table.inspirationId),
  }),
);

export const wowMomentInspirations = topOfMindNoteSignals;

export type TopOfMindNote = typeof topOfMindNotes.$inferSelect;
export type NewTopOfMindNote = typeof topOfMindNotes.$inferInsert;
export type TopOfMindNoteSignal = typeof topOfMindNoteSignals.$inferSelect;
export type NewTopOfMindNoteSignal = typeof topOfMindNoteSignals.$inferInsert;
export type WowMoment = TopOfMindNote;
export type NewWowMoment = NewTopOfMindNote;
export type WowMomentInspiration = TopOfMindNoteSignal;
export type NewWowMomentInspiration = NewTopOfMindNoteSignal;

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
