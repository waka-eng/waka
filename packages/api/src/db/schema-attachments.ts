/**
 * Drizzle ORM schema — attachments table.
 *
 * Attachments belong to a single inspiration and represent one of three kinds:
 *   - link  : an external URL the user pasted (no S3 object)
 *   - image : an image uploaded to S3 via presigned PUT
 *   - file  : any other file uploaded to S3 via presigned PUT
 *
 * For S3-backed kinds (image, file), the actual bytes are uploaded directly
 * from the browser to S3 using a presigned URL — the API never proxies the
 * payload. We persist:
 *   - url     : public/canonical URL the frontend renders (for link kind this
 *               is the user-supplied URL; for S3-backed kinds it is the
 *               object URL — may be a presigned GET if the bucket is private).
 *   - s3Key   : the S3 object key, NULL for `link`. Used to issue presigned
 *               GET URLs and to delete the object on inspiration delete.
 *   - name    : original filename (for image/file) or display label (for link).
 *
 * The foreign key cascades on inspiration delete so attachments are cleaned
 * up automatically when their parent inspiration is removed. Note that this
 * cascade does NOT delete the underlying S3 object — that is handled in
 * application code so we can also call DeleteObject before the row is gone.
 */

import { relations } from "drizzle-orm";
import {
  bigint,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { inspirations } from "./schema";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * Allowed attachment kinds. Postgres enforces the set at the DB layer; the
 * frontend uses the same string literals (`link` | `image` | `file`).
 *
 * Ordering is the canonical order written into Postgres; do NOT reorder
 * existing values once a migration has been applied.
 */
export const attachmentTypeEnumValues = ["link", "image", "file"] as const;

export type AttachmentType = (typeof attachmentTypeEnumValues)[number];

export const attachmentTypeEnum = pgEnum(
  "attachment_type",
  attachmentTypeEnumValues,
);

// ---------------------------------------------------------------------------
// attachments
// ---------------------------------------------------------------------------

export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    inspirationId: uuid("inspiration_id")
      .notNull()
      .references(() => inspirations.id, { onDelete: "cascade" }),

    type: attachmentTypeEnum("type").notNull(),

    // Canonical URL the UI renders. For link attachments this is the user's
    // URL verbatim. For S3-backed attachments this is typically the
    // `https://<bucket>.s3.<region>.amazonaws.com/<key>` form, or a
    // presigned GET URL minted at read time if the bucket is private.
    url: text("url").notNull(),

    // Display name. Optional because pasted links may not have a label.
    name: text("name"),

    // S3 object key. NULL when type === "link" (no S3 object). Required for
    // type ∈ {image, file} — application code enforces this; the DB only
    // requires it to be nullable so link rows are valid.
    s3Key: text("s3_key"),

    // MIME type captured at presigned-PUT time (e.g. "image/png",
    // "application/pdf"). Used to set the correct Content-Type header when
    // serving the file back via a presigned GET, and to render the right
    // preview affordance in the UI. NULL for `link` attachments (the URL is
    // dereferenced directly by the browser).
    contentType: text("content_type"),

    // Object size in bytes. bigint because S3 objects can exceed the 2^31
    // boundary that Postgres `integer` enforces. NULL for `link` attachments
    // and for rows recorded before the metadata was captured.
    //
    // We use Drizzle's `mode: "number"` form so values flow through as plain
    // JS numbers in the typical < 2^53 range — application code that needs
    // larger files can switch to "bigint" mode without a schema migration.
    size: bigint("size", { mode: "number" }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    // Loading an inspiration detail view fetches all of its attachments;
    // this index supports that lookup.
    inspirationIdx: index("attachments_inspiration_idx").on(
      table.inspirationId,
    ),
  }),
);

export type Attachment = typeof attachments.$inferSelect;
export type NewAttachment = typeof attachments.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  inspiration: one(inspirations, {
    fields: [attachments.inspirationId],
    references: [inspirations.id],
  }),
}));
