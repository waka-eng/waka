/**
 * Drizzle ORM schema — combinations and their readings.
 *
 * A **combination** is a set of hearts read together. A room is one origin of
 * one; later origins (a subset of a room, a handshake between strangers to it)
 * reuse this table rather than growing parallel ones.
 *
 * A **reading** is what that combination wants, in its own words — the layer
 * above notes. Notes say what the collections have in common that is
 * non-obvious; a reading says what the combination is *after*.
 */

import { relations, sql } from "drizzle-orm";
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

import { users } from "./schema";
import { groups } from "./schema-groups";

export const combinations = pgTable(
  "combinations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Canonical identity: sorted member user ids, hashed. Reading the same set
     * twice is the same combination — so a reading can be cached, re-confirmed
     * across passes, and invalidated when the set's shared signals change.
     */
    memberSetHash: text("member_set_hash").notNull(),
    /** `room` today; `subset` and `handshake` arrive with the next goal. */
    origin: text("origin").notNull().default("room"),
    /** Set when this combination *is* a room's membership. */
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    memberSetUnique: uniqueIndex("combinations_member_set_hash_unique_idx").on(
      table.memberSetHash,
    ),
    groupIdx: index("combinations_group_idx").on(table.groupId),
  }),
);

/** Whose evidence the reading actually rests on, and how heavily. */
export interface CombinationMemberGrade {
  userId: string;
  /** `load_bearing` when the ambition collapses without them; else `supporting`. */
  grade: "load_bearing" | "supporting" | "ungraded";
  evidenceCount: number;
}

/**
 * One dimension a want actually has, named by the reading itself.
 *
 * Not a fixed taxonomy on purpose. `impact` / `people` / `place` used to be
 * three columns here, which asserted that every want has an effect, a who and
 * a where. Many do not — a combination can be after a standard of craft, a
 * pace, a material, an audience, a question nobody is asking — and a reading
 * given only three boxes says nothing about the dimension it can actually see.
 */
export interface CombinationReadingFacet {
  /** e.g. "the pace", "who it is for", "what it refuses". */
  dimension: string;
  text: string;
}

/** A line of a member's own words the reading traces to. */
export interface CombinationMemberQuote {
  userId: string;
  signalId: string;
  quote: string;
}

/**
 * Reaction vs composition mix of the grounding evidence.
 *
 * `captureElapsedMs` is the pulse-speed proxy recorded at save: a fast save is
 * a reaction, a slow one a composition. Stored on the reading so "you can't
 * talk your pulse into quickening" is something the reading carries, not just
 * something the prompt was told.
 */
export interface CombinationPulseProfile {
  reactionCount: number;
  compositionCount: number;
  unknownCount: number;
  medianElapsedMs: number | null;
}

export const combinationReadings = pgTable(
  "combination_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    combinationId: uuid("combination_id")
      .notNull()
      .references(() => combinations.id, { onDelete: "cascade" }),

    /**
     * `forming` is not failure and not silence: it means the hearts here have
     * not yet said enough together, and `whatsMissing` names what is thin.
     */
    state: text("state").notNull().default("forming"),

    /** One dissolved statement. Never a stack of summaries. */
    ambitionText: text("ambition_text"),

    /**
     * Zero to three, empty by default. A reading forced to fill a fixed set of
     * facets pads whichever the evidence does not speak to — the stacking
     * failure the personal board already corrected. A dimension the evidence
     * cannot support belongs in `whatsMissing`, not in prose nobody meant.
     */
    facets: jsonb("facets").$type<CombinationReadingFacet[]>().notNull().default([]),
    /** The refusal half of a want: what this combination is moving against. */
    awayFrom: text("away_from"),
    /** Two hearts can combine and still disagree. Naming it beats smoothing it. */
    tension: text("tension"),
    /** "Knowing which actions are worth taking" — the reading's next step. */
    nextQuestion: text("next_question"),
    whatsMissing: text("whats_missing"),

    memberGrades: jsonb("member_grades")
      .$type<CombinationMemberGrade[]>()
      .notNull()
      .default([]),
    memberQuotes: jsonb("member_quotes")
      .$type<CombinationMemberQuote[]>()
      .notNull()
      .default([]),
    groundedNoteIds: jsonb("grounded_note_ids").$type<string[]>().notNull().default([]),

    /**
     * How many passes re-derived this reading. "Accumulated over time" means a
     * reading found four times is stronger evidence than one found once.
     */
    reconfirmedCount: integer("reconfirmed_count").notNull().default(0),

    pulseProfile: jsonb("pulse_profile").$type<CombinationPulseProfile | null>(),
    /** Earliest and latest grounding save: an ambition visible across a year
     *  is not the same as one from last week. */
    evidenceSpanStart: timestamp("evidence_span_start", { withTimezone: true }),
    evidenceSpanEnd: timestamp("evidence_span_end", { withTimezone: true }),

    locale: text("locale").notNull().default("en-US"),
    /** Provenance: a reading you cannot tie to what produced it cannot be
     *  compared, trusted, or invalidated when members save more. */
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    signalSetHash: text("signal_set_hash").notNull(),

    /**
     * `active` is what a wall shows; `replaced` is what the combination used
     * to want. Same vocabulary as `group_top_of_mind_notes` on purpose, so
     * notes and readings age one way rather than two.
     *
     * An ambition that changed is the most interesting thing a room can show,
     * and it is invisible if every reading overwrites the last.
     */
    lifecycleStatus: text("lifecycle_status").notNull().default("active"),
    replacedAt: timestamp("replaced_at", { withTimezone: true }),
    replacedByReadingId: uuid("replaced_by_reading_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** One *active* reading per combination per language; ancestors kept. */
    activeUnique: uniqueIndex("combination_readings_active_unique_idx")
      .on(table.combinationId, table.locale)
      .where(sql`${table.lifecycleStatus} = 'active'`),
    timelineIdx: index("combination_readings_timeline_idx").on(
      table.combinationId,
      table.createdAt,
      table.replacedAt,
    ),
    replacedByFk: foreignKey({
      name: "combination_readings_replaced_by_reading_id_fk",
      columns: [table.replacedByReadingId],
      foreignColumns: [table.id],
    }).onDelete("set null"),
  }),
);

export const combinationsRelations = relations(combinations, ({ one, many }) => ({
  group: one(groups, {
    fields: [combinations.groupId],
    references: [groups.id],
  }),
  readings: many(combinationReadings),
}));

export const combinationReadingsRelations = relations(combinationReadings, ({ one }) => ({
  combination: one(combinations, {
    fields: [combinationReadings.combinationId],
    references: [combinations.id],
  }),
}));

export type Combination = typeof combinations.$inferSelect;
export type CombinationReading = typeof combinationReadings.$inferSelect;
