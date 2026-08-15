/**
 * Drizzle ORM schema — attachments and their enrichment.
 *
 * An attachment is a link, image, or file saved with an inspiration.
 *
 * **Enrichment** is machine-derived context about what was attached, so that
 * signal extraction can read what the human *saved* and not only what they
 * typed: a link's page body, an image's transcribed description. It is
 * cached on the row and re-derived only when the attachment changes.
 *
 * Enrichment is never presented as the human's words. Downstream, a quote
 * drawn from enrichment is attributed to the source, not to the person —
 * attributing an article's argument to the member who saved the link would
 * be a claim about them that nobody made.
 */

import { relations } from "drizzle-orm";
import {
  bigint,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { inspirations } from "./schema-inspirations";
import { profiles } from "./schema-profiles";

export const attachmentTypeValues = ["link", "image", "file"] as const;
export type AttachmentType = (typeof attachmentTypeValues)[number];
export const attachmentTypeEnum = pgEnum("attachment_type", attachmentTypeValues);

export const attachmentEnrichmentStatusValues = [
  "pending",
  "ready",
  "failed",
  "unavailable",
] as const;
export type AttachmentEnrichmentStatus = (typeof attachmentEnrichmentStatusValues)[number];
export const attachmentEnrichmentStatusEnum = pgEnum(
  "attachment_enrichment_status",
  attachmentEnrichmentStatusValues,
);

/**
 * How the enrichment text was obtained. Extraction reads `enrichmentText`
 * uniformly, but a reader (and a quote's attribution) needs to know whether
 * it is a page's own prose or a description of a picture.
 */
export const attachmentEnrichmentKindValues = ["page_body", "image_description"] as const;
export type AttachmentEnrichmentKind = (typeof attachmentEnrichmentKindValues)[number];
export const attachmentEnrichmentKindEnum = pgEnum(
  "attachment_enrichment_kind",
  attachmentEnrichmentKindValues,
);

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),

    inspirationId: uuid("inspiration_id").notNull(),

    type: attachmentTypeEnum("type").notNull(),

    /** For links, the user's URL verbatim; for uploads, the object URL. */
    url: text("url").notNull(),
    name: text("name"),

    /** S3 object key — NULL for links, required for image/file uploads. */
    s3Key: text("s3_key"),
    contentType: text("content_type"),
    /** bigint: S3 objects can exceed Postgres integer's 2^31 boundary. */
    size: bigint("size", { mode: "number" }),

    // --- enrichment ---------------------------------------------------------
    enrichmentStatus: attachmentEnrichmentStatusEnum("enrichment_status"),
    enrichmentKind: attachmentEnrichmentKindEnum("enrichment_kind"),
    /**
     * The bounded text extraction reads: a link's main body prose, or an
     * image's description including any legible text transcribed verbatim.
     */
    enrichmentText: text("enrichment_text"),
    enrichmentErrorReason: text("enrichment_error_reason"),
    enrichmentUpdatedAt: timestamp("enrichment_updated_at", { withTimezone: true }),

    // Structured link metadata, kept separate from the bulk text.
    finalUrl: text("final_url"),
    hostname: text("hostname"),
    title: text("title"),
    description: text("description"),
    siteName: text("site_name"),
    previewImageUrl: text("preview_image_url"),
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    inspirationIdx: index("attachments_inspiration_idx").on(table.inspirationId),
    profileIdx: index("attachments_profile_idx").on(table.profileId),
    // An attachment cannot hang off another profile's inspiration.
    inspirationFk: foreignKey({
      columns: [table.profileId, table.inspirationId],
      foreignColumns: [inspirations.profileId, inspirations.id],
      name: "attachments_inspiration_fk",
    }).onDelete("cascade"),
  }),
);

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  inspiration: one(inspirations, {
    fields: [attachments.inspirationId],
    references: [inspirations.id],
  }),
}));
