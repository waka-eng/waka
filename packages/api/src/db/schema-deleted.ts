/**
 * deleted_inspirations — what a person deleted, held for thirty days so it
 * can come back.
 *
 * Founder, 2026-10-15: "just delete when user clicks on this, but give option
 * to undo it. also create option to see all deleted inspirations in the
 * inspirations list".
 *
 * ── A SHELF BESIDE THE ARCHIVE, NOT A FLAG IN IT ────────────────────────
 *
 * Deleting still deletes: the inspiration row goes, its evidence goes, and
 * every signal that stood on it is reconciled exactly as before. This table
 * holds a copy of the words, so nothing that reads `inspirations` (sixty-odd
 * queries across derivation, recall, rooms, review and export) has to learn
 * to skip a deleted row. A `deleted_at` column on `inspirations` would have
 * made every one of those queries a place to forget it.
 *
 * Restoring is an ordinary save under the same id and the original date, and
 * the reading runs again. What a restore cannot return is listed at the top
 * of routes/inspirations-deleted.ts: attachments of every kind (swept from
 * storage at delete time; `had_photo` is true when there were any, the name
 * kept from when only photos were counted), the experience, decision
 * citations and conversation origin.
 *
 * Thirty days, then the copy goes for good: on the person's own reads and
 * deletes, and for everyone in the worker's daily run (`sweepDeletedShelf`),
 * so a person who never comes back is not held past the month either.
 */
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { inspirationKindEnum, inspirationSourceEnum, inspirationVisibilityEnum } from "./schema-inspirations";
import { profiles } from "./schema-profiles";

export const DELETED_KEEP_DAYS = 30;

export interface DeletedReflection {
  question: string;
  answer: string | null;
  skipped: boolean;
}

export const deletedInspirations = pgTable(
  "deleted_inspirations",
  {
    /** The inspiration's own id, reused when it comes back. */
    id: uuid("id").primaryKey(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    kind: inspirationKindEnum("kind"),
    category: text("category"),
    source: inspirationSourceEnum("source").notNull(),
    visibility: inspirationVisibilityEnum("visibility").notNull(),
    reflections: jsonb("reflections").$type<DeletedReflection[]>().notNull().default([]),
    /** Whether it had any attachment (photo, recording, file or link). */
    hadPhoto: boolean("had_photo").notNull().default(false),
    /** When it was first kept — what "Kept <date>" says after a restore. */
    keptAt: timestamp("kept_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    recent: index("deleted_inspirations_recent").on(table.profileId, table.deletedAt),
  }),
);
