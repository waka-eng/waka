/**
 * Drizzle ORM schema — signal reading divergence.
 *
 * One row per (signal, group): how differently the same saved signal reads in
 * that room's Top of Mind versus its owner's own. Scored by a judge after
 * group synthesis, updated in place when either side's note changes — this is
 * a measurement, not a log, so the pair is unique and history is not kept.
 *
 * PRIVACY: a divergence necessarily references the owner's PRIVATE solo
 * reading. Rows are only ever surfaced to `owner_user_id` (the announcement
 * lands on their wall, never the room's). Nothing here may feed a
 * group-visible response.
 */

import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { signals, users } from "./schema";
import { groups, groupTopOfMindNotes } from "./schema-groups";
import { topOfMindNotes } from "./schema-wow-moments";

export const signalReadingDivergences = pgTable(
  "signal_reading_divergences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** The signal's owner — the only user this row may ever be shown to. */
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The two notes that were actually compared. When either is replaced by
     * a newer reading, the pass re-judges and overwrites this row. */
    soloNoteId: uuid("solo_note_id")
      .notNull()
      .references(() => topOfMindNotes.id, { onDelete: "cascade" }),
    groupNoteId: uuid("group_note_id")
      .notNull()
      .references(() => groupTopOfMindNotes.id, { onDelete: "cascade" }),
    /** 0 = the room reads it the way you do; 100 = a different ambition. */
    score: integer("score").notNull(),
    /** The judge's one-sentence naming of the difference, in `locale`. */
    rationale: text("rationale").notNull().default(""),
    locale: text("locale").notNull().default("en-US"),
    judgedAt: timestamp("judged_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One measurement per pair; the scoring pass upserts against this.
    signalGroupUnique: uniqueIndex(
      "signal_reading_divergences_signal_group_unique_idx",
    ).on(table.signalId, table.groupId),
    groupIdx: index("signal_reading_divergences_group_idx").on(table.groupId),
    // The announcement pass scans an owner's high scores.
    ownerScoreIdx: index("signal_reading_divergences_owner_score_idx").on(
      table.ownerUserId,
      table.score,
    ),
  }),
);

export type SignalReadingDivergenceRow = typeof signalReadingDivergences.$inferSelect;
export type NewSignalReadingDivergenceRow = typeof signalReadingDivergences.$inferInsert;
