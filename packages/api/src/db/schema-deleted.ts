/** Thirty-day recovery outside the live memory stack; see docs/data-model.md. */
import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { inspirationKindEnum, inspirationSourceEnum, inspirationVisibilityEnum } from "./schema-inspirations";
import type { Attachment } from "./schema-attachments";
import { profiles } from "./schema-profiles";

export const DELETED_KEEP_DAYS = 30;
/** JSON preserves every attachment field; timestamps cross the boundary as ISO strings. */
export type DeletedAttachment = { [K in keyof Attachment]:
  Attachment[K] extends Date ? string : Attachment[K] extends Date | null ? string | null : Attachment[K] };

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
    attachments: jsonb("attachments").$type<DeletedAttachment[]>().notNull().default([]),
    /** Whether it had any attachment (photo, recording, file or link). */
    hadPhoto: boolean("had_photo").notNull().default(false),
    /** When it was first kept — what "Kept <date>" says after a restore. */
    keptAt: timestamp("kept_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    attachmentKeys: index("deleted_inspirations_attachments_idx").using("gin", sql`${table.attachments} jsonb_path_ops`),
    recent: index("deleted_inspirations_recent").on(table.profileId, table.deletedAt),
    /** The daily sweep reads by age across everyone (`sweepDeletedShelf`). */
    expiry: index("deleted_inspirations_expiry").on(table.deletedAt),
  }),
);
