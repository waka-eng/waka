/**
 * Drizzle ORM schema — reflections.
 *
 * A short question-and-answer the human attaches to an inspiration, at
 * capture or later. Layer-1 detail: human-authored, never generated, and
 * read by signal extraction as some of the strongest context a capture
 * carries — it is the person saying, in their own words, why this mattered.
 *
 * `skipped` records that a question was offered and declined, which is
 * different from never having been asked.
 */

import { relations } from "drizzle-orm";
import {
  boolean,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { inspirations } from "./schema-inspirations";
import { profiles } from "./schema-profiles";

export const reflections = pgTable(
  "reflections",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    inspirationId: uuid("inspiration_id").notNull(),

    question: text("question").notNull(),
    /** Null while unanswered, or when the prompt was skipped. */
    answer: text("answer"),
    skipped: boolean("skipped").notNull().default(false),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceIdentityUnique: unique("reflections_source_identity_unique").on(table.profileId, table.inspirationId, table.id),
    inspirationIdx: index("reflections_inspiration_idx").on(table.inspirationId),
    // A reflection cannot attach to another profile's inspiration.
    inspirationFk: foreignKey({
      columns: [table.profileId, table.inspirationId],
      foreignColumns: [inspirations.profileId, inspirations.id],
      name: "reflections_inspiration_fk",
    }).onDelete("cascade"),
  }),
);

export type Reflection = typeof reflections.$inferSelect;
export type NewReflection = typeof reflections.$inferInsert;

export const reflectionsRelations = relations(reflections, ({ one }) => ({
  inspiration: one(inspirations, {
    fields: [reflections.inspirationId],
    references: [inspirations.id],
  }),
}));
