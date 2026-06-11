/**
 * Drizzle ORM schema — inspiration embeddings.
 *
 * Stores one Gemini embedding vector per inspiration. The table carries both
 * `user_id` and `inspiration_id` so worker/route code can preserve tenant
 * scope in every lookup, and the composite foreign key prevents an embedding
 * row from pairing one user's id with another user's inspiration.
 */

import { relations } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { inspirations, signals, users } from "./schema";

export const signalEmbeddings = pgTable(
  "signal_embeddings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    inspirationId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    dimensions: integer("dimensions").notNull(),
    inputHash: text("input_hash").notNull(),
    embedding: jsonb("embedding").$type<number[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    onePerInspirationIdx: uniqueIndex(
      "signal_embeddings_signal_unique_idx",
    ).on(table.inspirationId),
    userInspirationIdx: index("signal_embeddings_user_signal_idx").on(
      table.userId,
      table.inspirationId,
    ),
    userModelIdx: index("signal_embeddings_user_model_idx").on(
      table.userId,
      table.model,
    ),
    userModelDimensionsIdx: index(
      "signal_embeddings_user_model_dimensions_idx",
    ).on(table.userId, table.model, table.dimensions),
    tenantInspirationFk: foreignKey({
      name: "signal_embeddings_user_signal_fk",
      columns: [table.userId, table.inspirationId],
      foreignColumns: [signals.userId, signals.id],
    }).onDelete("cascade"),
  }),
);

export const inspirationEmbeddings = signalEmbeddings;

export type SignalEmbedding = typeof signalEmbeddings.$inferSelect;
export type NewSignalEmbedding = typeof signalEmbeddings.$inferInsert;
export type InspirationEmbedding = SignalEmbedding;
export type NewInspirationEmbedding = NewSignalEmbedding;

export const inspirationEmbeddingsRelations = relations(
  inspirationEmbeddings,
  ({ one }) => ({
    user: one(users, {
      fields: [inspirationEmbeddings.userId],
      references: [users.id],
    }),
    inspiration: one(inspirations, {
      fields: [inspirationEmbeddings.inspirationId],
      references: [inspirations.id],
    }),
  }),
);
