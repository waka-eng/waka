/**
 * Drizzle ORM schema — WOW moments foundation.
 *
 * This slice only models persisted WOW moments and their related inspirations.
 * Generation, scoring updates, Gemini embeddings, and background workers land in
 * later PRs; the user-facing route can already list rows created by a seed,
 * script, or future worker.
 */

import { relations, sql } from "drizzle-orm";
import {
  check,
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

/**
 * The Postgres `wow_kind` type has one MORE value than this list: migration
 * 0037 added `divergence` for the reading-divergence announcer, which was
 * removed with the divergence surface (11d88b4) before it ever shipped. No
 * code produces or consumes it.
 *
 * Left in the database on purpose. Postgres has no `ALTER TYPE … DROP VALUE`,
 * so removing it means recreating the type and rewriting every column that
 * uses it — real risk to buy back a byte nothing reads. Absent here, it cannot
 * be written; absent there, an already-migrated database would break. Do not
 * "fix" the mismatch by adding it back.
 */
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
    semanticKey: text("semantic_key"),
    evidenceFingerprint: text("evidence_fingerprint"),
    lifecycleStatus: text("lifecycle_status").notNull().default("active"),
    replacedAt: timestamp("replaced_at", { withTimezone: true }),
    replacedById: uuid("replaced_by_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    idempotencyKeyIdx: uniqueIndex(
      "top_of_mind_notes_idempotency_key_unique_idx",
    ).on(table.idempotencyKey),
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
    generationIdentityIdx: uniqueIndex(
      "top_of_mind_notes_generation_identity_unique_idx",
    )
      .on(table.userId, table.semanticKey, table.evidenceFingerprint)
      .where(
        sql`${table.semanticKey} is not null and ${table.evidenceFingerprint} is not null`,
      ),
    activeSemanticIdx: uniqueIndex(
      "top_of_mind_notes_active_semantic_unique_idx",
    )
      .on(table.userId, table.semanticKey)
      .where(
        sql`${table.lifecycleStatus} = 'active' and ${table.semanticKey} is not null`,
      ),
    replacedByFk: foreignKey({
      name: "top_of_mind_notes_replaced_by_fk",
      columns: [table.userId, table.replacedById],
      foreignColumns: [table.userId, table.id],
    }),
    valueRangeCheck: check(
      "top_of_mind_notes_wow_score_range_check",
      sql`${table.wowScore} between 0 and 100`,
    ),
    lifecycleCheck: check(
      "top_of_mind_notes_lifecycle_check",
      sql`(${table.lifecycleStatus} = 'active' and ${table.replacedAt} is null and ${table.replacedById} is null) or (${table.lifecycleStatus} = 'replaced' and ${table.replacedAt} is not null and (${table.replacedById} is null or ${table.replacedById} <> ${table.id}))`,
    ),
    identityPairCheck: check(
      "top_of_mind_notes_identity_pair_check",
      sql`(${table.semanticKey} is null) = (${table.evidenceFingerprint} is null)`,
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
    /**
     * The run of words in this save that carried the reading.
     *
     * Null unless the judge named a span AND that span is genuinely present in
     * the save — a missing highlight is honest, a wrong one puts words in
     * someone's mouth.
     */
    quote: text("quote"),
    /**
     * Who was speaking: the person, or the page they linked.
     *
     * A save's readable text has two authors, and attributing an article's
     * argument to a member who only saved the link would be a claim about them
     * that nobody made.
     */
    quoteSource: text("quote_source"),
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
