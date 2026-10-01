/**
 * Drizzle ORM schema — embeddings for inspirations and signals.
 *
 * Two stores, one shape. Signal generation needs both: a new inspiration is
 * embedded to find what it resembles, and every signal statement is embedded
 * so match-or-mint can ask "is this the same pattern we already know?"
 * without a model call in the common case.
 *
 * Vectors are jsonb rather than pgvector: the archives are small enough that
 * cosine similarity in application code is fast, and it keeps the schema
 * portable across Postgres hosts. `inputHash` is what makes regeneration
 * cheap — re-embed only when the source text or the model actually changed.
 */

import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { inspirations } from "./schema-inspirations";
import { profiles } from "./schema-profiles";
import { signals } from "./schema-signals";

export type InspirationEmbeddingScope = "personal" | "public";

export const inspirationEmbeddings = pgTable(
  "inspiration_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    inspirationId: uuid("inspiration_id").notNull(),

    model: text("model").notNull(),
    inputScope: text("input_scope").$type<InspirationEmbeddingScope>().notNull().default("personal"),
    dimensions: integer("dimensions").notNull(),
    /** SHA-256 of the canonical embedding input; regenerate only on change. */
    inputHash: text("input_hash").notNull(),
    embedding: jsonb("embedding").$type<number[]>().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    inspirationModelScopeUnique: uniqueIndex("inspiration_embeddings_inspiration_model_scope_idx").on(
      table.inspirationId,
      table.model,
      table.inputScope,
    ),
    inputScopeCheck: check("inspiration_embeddings_input_scope_check", sql`${table.inputScope} IN ('personal', 'public')`),
    profileIdx: index("inspiration_embeddings_profile_idx").on(table.profileId),
    inspirationFk: foreignKey({
      columns: [table.profileId, table.inspirationId],
      foreignColumns: [inspirations.profileId, inspirations.id],
      name: "inspiration_embeddings_inspiration_fk",
    }).onDelete("cascade"),
  }),
);

export type InspirationEmbedding = typeof inspirationEmbeddings.$inferSelect;
export type NewInspirationEmbedding = typeof inspirationEmbeddings.$inferInsert;

export const signalEmbeddings = pgTable(
  "signal_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    signalId: uuid("signal_id").notNull(),

    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    inputHash: text("input_hash").notNull(),
    embedding: jsonb("embedding").$type<number[]>().notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    signalModelUnique: uniqueIndex("signal_embeddings_signal_model_idx").on(
      table.signalId,
      table.model,
    ),
    // Match-or-mint scans one profile's signal vectors on every capture.
    profileIdx: index("signal_embeddings_profile_idx").on(table.profileId),
    signalFk: foreignKey({
      columns: [table.profileId, table.signalId],
      foreignColumns: [signals.profileId, signals.id],
      name: "signal_embeddings_signal_fk",
    }).onDelete("cascade"),
  }),
);

export type SignalEmbedding = typeof signalEmbeddings.$inferSelect;
export type NewSignalEmbedding = typeof signalEmbeddings.$inferInsert;

export const inspirationEmbeddingsRelations = relations(inspirationEmbeddings, ({ one }) => ({
  inspiration: one(inspirations, {
    fields: [inspirationEmbeddings.inspirationId],
    references: [inspirations.id],
  }),
}));

export const signalEmbeddingsRelations = relations(signalEmbeddings, ({ one }) => ({
  signal: one(signals, {
    fields: [signalEmbeddings.signalId],
    references: [signals.id],
  }),
}));
