/**
 * What leaves the server, named field by field.
 *
 * Every response body the inspiration routes build out of a stored row is
 * built here — a capture in full, a capture in a list, a reflection. (The two
 * deletes answer with the id the caller just sent, and an error carries no row
 * at all.) The `*Selection` objects below are the column lists the handlers
 * read whole rows with; the list read selects a narrower window of its own — a
 * truncated preview and the text length, never the whole text — and hands it
 * to `serializeInspirationSummary` to be named.
 *
 * The discipline that matters is negative: nothing in this file spreads
 * a database row into a response. A capture row carries `profile_id` and will
 * carry whatever column is added to the table next, and `{...row}` is the one
 * line that would ship a new column to a client the day it is created, without
 * a single line of the change ever mentioning the API surface.
 *
 * So the rule is: a field appears in a response because someone typed its
 * name. If you add a column and want it returned, this is the file you have to
 * edit — which is the point.
 */

import { inspirations, reflections, type Inspiration, type Reflection } from "../db/index.js";
import type { serializeAttachment } from "./attachments.js";

const PREVIEW_CHARS = 220;
/** Read a little more than the preview needs so collapsing cannot under-fill it. */
export const PREVIEW_SOURCE_CHARS = 400;
export const MAX_SUMMARY_ATTACHMENTS = 3;
const MAX_ATTACHMENT_LABEL_CHARS = 120;

export type ReflectionRow = Pick<
  Reflection,
  "id" | "inspirationId" | "question" | "answer" | "skipped" | "createdAt"
>;

export type InspirationRow = Pick<
  Inspiration,
  | "id"
  | "profileId"
  | "text"
  | "kind"
  | "source"
  | "visibility"
  | "createdAt"
  | "updatedAt"
>;

export const inspirationSelection = {
  id: inspirations.id,
  profileId: inspirations.profileId,
  text: inspirations.text,
  kind: inspirations.kind,
  source: inspirations.source,
  visibility: inspirations.visibility,
  createdAt: inspirations.createdAt,
  updatedAt: inspirations.updatedAt,
} as const;

export const reflectionSelection = {
  id: reflections.id,
  inspirationId: reflections.inspirationId,
  question: reflections.question,
  answer: reflections.answer,
  skipped: reflections.skipped,
  createdAt: reflections.createdAt,
} as const;

export function serializeReflection(row: ReflectionRow) {
  return {
    id: row.id,
    inspirationId: row.inspirationId,
    question: row.question,
    answer: row.answer,
    skipped: row.skipped,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One capture in full: what was saved, what was attached, what was answered. */
export function serializeInspirationDetail(
  row: InspirationRow,
  detail: {
    attachments: ReturnType<typeof serializeAttachment>[];
    reflections: ReflectionRow[];
  },
) {
  return {
    id: row.id,
    profileId: row.profileId,
    text: row.text,
    kind: row.kind,
    source: row.source,
    visibility: row.visibility,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attachments: detail.attachments,
    reflections: detail.reflections.map(serializeReflection),
  };
}

export function buildTextPreview(previewSource: string, textLength: number): string {
  const collapsed = previewSource.replace(/\s+/g, " ").trim();
  if (collapsed.length > PREVIEW_CHARS) {
    return `${collapsed.slice(0, PREVIEW_CHARS - 1).trimEnd()}…`;
  }
  return textLength > previewSource.length ? `${collapsed}…` : collapsed;
}

/**
 * A capture as it appears in the archive list: what the list read selects,
 * plus the two counts the page fans out for.
 *
 * `previewSource` is already truncated in Postgres and `textLength` is the
 * length of the row's whole text — the pair is what lets the preview say "there
 * is more" without the rest of the capture ever leaving the database.
 */
export type InspirationSummaryRow = Pick<
  Inspiration,
  "id" | "kind" | "source" | "visibility" | "createdAt" | "updatedAt"
> & {
  previewSource: string;
  textLength: number;
  materialRevision?: string|null;
};

export type AttachmentSummaryEntry = {
  id: string;
  type: string;
  label: string;
};

/** One capture in a list: enough to recognize it, and never its full text. */
export function serializeInspirationSummary(
  row: InspirationSummaryRow,
  summary: {
    attachments: AttachmentSummaryEntry[];
    reflectionCount: number;
  },
) {
  return {
    id: row.id,
    textPreview: buildTextPreview(row.previewSource, Number(row.textLength)),
    ...(row.materialRevision?{materialRevision:row.materialRevision}:{}),
    kind: row.kind,
    source: row.source,
    visibility: row.visibility,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    attachmentSummary: summary.attachments,
    reflectionCount: summary.reflectionCount,
  };
}

/**
 * What an attachment is, in a list. Its own name first, then whatever the page
 * called itself, then the host — a row in an archive has to say what was saved
 * without carrying the enrichment along with it.
 */
export function attachmentLabel(row: {
  name: string | null;
  title: string | null;
  hostname: string | null;
  url: string;
}): string {
  const label = row.name ?? row.title ?? row.hostname ?? row.url;
  return label.length > MAX_ATTACHMENT_LABEL_CHARS
    ? `${label.slice(0, MAX_ATTACHMENT_LABEL_CHARS - 1)}…`
    : label;
}
