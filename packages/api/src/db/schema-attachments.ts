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

import { relations, sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { conversationMessages } from "./schema-conversations";
import { inspirations } from "./schema-inspirations";
import { profiles } from "./schema-profiles";

export const attachmentTypeValues = ["link", "image", "file", "audio"] as const;
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
export const attachmentEnrichmentKindValues = ["page_body", "image_description", "audio_transcription"] as const;
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

    /**
     * EXACTLY ONE OWNER (`attachments_owner_check`, migration 0076): an
     * inspiration, or a chat message. Every row before 0076 is an inspiration
     * attachment and keeps this set.
     */
    inspirationId: uuid("inspiration_id"),
    /**
     * A CHAT ATTACHMENT. `conversationId` is set in both of its states;
     * `stagedMessageId` while it waits in the composer for a message that has
     * not been sent (no FK can name a row that does not exist yet), and
     * `messageId` once the send moved it over in the message's own
     * transaction — the composite FK below then holds it to that message.
     */
    conversationId: uuid("conversation_id"),
    messageId: uuid("message_id"),
    stagedMessageId: uuid("staged_message_id"),

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
    /** Null uses the machine transcript; empty explicitly records no words. */
    transcriptCorrection: text('transcript_correction'),
    transcriptRevision: integer('transcript_revision').notNull().default(0),
    transcriptCorrectedAt: timestamp('transcript_corrected_at', { withTimezone: true }),
    enrichmentRetryCount: integer('enrichment_retry_count').notNull().default(0),
    enrichmentRetryWindowAt: timestamp('enrichment_retry_window_at', { withTimezone: true }),

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
    // A chat attachment cannot hang off another profile's or another
    // conversation's message, and goes when its message goes.
    messageFk: foreignKey({
      columns: [table.profileId, table.conversationId, table.messageId],
      foreignColumns: [conversationMessages.profileId, conversationMessages.conversationId, conversationMessages.id],
      name: "attachments_message_fk",
    }).onDelete("cascade"),
    messageIdx: index("attachments_message_idx").on(table.profileId, table.conversationId, table.messageId).where(sql`${table.messageId} IS NOT NULL`),
    stagedIdx: index("attachments_staged_idx").on(table.profileId, table.stagedMessageId).where(sql`${table.stagedMessageId} IS NOT NULL`),
    conversationIdx: index("attachments_conversation_idx").on(table.profileId, table.conversationId).where(sql`${table.conversationId} IS NOT NULL`),
    /* 0077. Serves "one stored object, one attachment" (`assertAttachmentKeysUnused`
       and the chat finalize) and the sweeps' still-referenced check. Not
       unique: rows from before those checks may share a key. */
    s3KeyIdx: index("attachments_s3_key_idx").on(table.s3Key).where(sql`${table.s3Key} IS NOT NULL`),
    /* 0077. The daily sweep of staged uploads whose message was never sent. */
    stagedAgeIdx: index("attachments_staged_age_idx").on(table.createdAt).where(sql`${table.stagedMessageId} IS NOT NULL`),
    ownerCheck: check("attachments_owner_check", sql`(${table.inspirationId} IS NOT NULL AND ${table.conversationId} IS NULL AND ${table.messageId} IS NULL AND ${table.stagedMessageId} IS NULL)
      OR (${table.inspirationId} IS NULL AND ${table.conversationId} IS NOT NULL AND num_nonnulls(${table.messageId},${table.stagedMessageId}) = 1
        AND ${table.type} IN ('image','file') AND ${table.s3Key} IS NOT NULL)`),
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
