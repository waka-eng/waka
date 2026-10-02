/**
 * Client for `/api/attachments` — mirrors `packages/api/src/routes/attachments.ts`.
 *
 * What hangs off a capture: a pasted link, an image, a file. An upload is
 * three steps and the middle one does not touch our server at all — presign
 * here, PUT straight to S3, then finalize here so the row exists and
 * enrichment is queued.
 *
 * The attachment TYPES lived under the inspirations heading in the single-file
 * client, which read as though they were layer-1 vocabulary. They are not —
 * they are this route's, and an inspiration merely carries them, so
 * `inspirations.ts` imports them from here and not the other way round.
 */

import { ApiError, apiPath, postJson } from "./http";

// ---------------------------------------------------------------------------
// What an attachment is
// ---------------------------------------------------------------------------

/** Attachment kinds — mirrors the Postgres `attachment_type` enum. */
export type AttachmentType = "link" | "image" | "file" | "audio";
export type AttachmentEnrichmentStatus = "pending" | "ready" | "failed" | "unavailable";
export type AttachmentEnrichmentKind = "page_body" | "image_description";

/**
 * Capture-time context the server derived from an attachment: a bounded fetch
 * of a link, or a one-time description of an image. It exists so signal
 * extraction can read what a person *saved* and not only what they typed, and
 * is never presented as their words.
 */
export interface ApiAttachmentEnrichment {
  status: AttachmentEnrichmentStatus | null;
  kind: AttachmentEnrichmentKind | null;
  text: string | null;
  errorReason: string | null;
  updatedAt: string | null;
  /** Present for link attachments; null for anything else. */
  link: {
    finalUrl: string | null;
    hostname: string | null;
    title: string | null;
    description: string | null;
    siteName: string | null;
    previewImageUrl: string | null;
  } | null;
  /** Present for image attachments; null for anything else. */
  image: { width: number | null; height: number | null } | null;
}

/**
 * Canonical attachment row. The S3 key never crosses to the browser — a link
 * carries the URL it was saved from, and an image or file carries the URL the
 * server is willing to serve it at.
 */
export interface ApiAttachment {
  id: string;
  inspirationId: string;
  type: AttachmentType;
  url: string;
  name: string | null;
  contentType: string | null;
  size: number | null;
  createdAt: string;
  enrichment: ApiAttachmentEnrichment;
}

/** Enough of an attachment to render a row without loading the detail. */
export interface ApiAttachmentSummary {
  id: string;
  type: AttachmentType;
  label: string;
}

// ---------------------------------------------------------------------------
// Uploading one
// ---------------------------------------------------------------------------

/**
 * Response from POST /attachments/presign.
 *
 * `headers` MUST be forwarded verbatim with the browser PUT — the signature
 * is bound to Content-Type and Content-Length, so deviating from these
 * causes S3 to 403 the upload.
 */
export interface PresignResponse {
  uploadUrl: string;
  key: string;
  expiresAt: string;
  headers: {
    "Content-Type": string;
    "Content-Length": string;
  };
}

export interface PresignRequest {
  filename: string;
  contentType: string;
  size: number;
}

/**
 * POST /attachments/presign
 *
 * Mints a single-use presigned PUT URL the browser uses to upload an
 * attachment payload directly to S3. Returns the canonical key the caller
 * MUST echo back in the subsequent finalize call.
 */
export async function presignAttachment(
  input: PresignRequest,
): Promise<PresignResponse> {
  return postJson<PresignResponse>(
    apiPath("/attachments/presign"),
    input,
    "Failed to mint upload URL",
  );
}

/**
 * Browser-side PUT to S3. Surfaces a stable error so the caller's catch
 * branch can render a banner without parsing the SDK's network errors.
 *
 * We intentionally do NOT include credentials — the URL is presigned, the
 * cookie is irrelevant, and sending it to a non-same-origin host would just
 * be ignored by S3.
 */
export async function uploadToPresignedUrl(
  url: string,
  file: File | Blob,
  headers: Record<string, string>,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      headers,
      body: file,
    });
  } catch {
    throw new ApiError({
      status: 0,
      message: "Network unreachable while uploading attachment",
    });
  }
  if (!res.ok) {
    // S3 returns plain XML on failures; we don't try to parse it because the
    // useful detail (the AWS-side reason) is in `res.statusText`.
    throw new ApiError({
      status: res.status,
      message: `Upload failed (HTTP ${res.status}). Please try again.`,
    });
  }
}

/**
 * Discriminated union for POST /attachments. Mirrors the server zod schema
 * so a misuse here trips a typecheck error rather than a 400 at runtime.
 */
export type FinalizeAttachmentRequest =
  | {
      type: "link";
      inspirationId: string;
      url: string;
      name?: string;
    }
  | {
      type: "image" | "file";
      inspirationId: string;
      key: string;
      name?: string;
      contentType?: string;
      size?: number;
    };

/**
 * POST /attachments
 *
 * Finalize an attachment after the S3 PUT has succeeded (image / file) or
 * record a pasted link directly (link). The server enforces inspiration
 * ownership; on success it returns the canonical row and queues enrichment.
 */
export async function finalizeAttachment(
  input: FinalizeAttachmentRequest,
): Promise<ApiAttachment> {
  const body = await postJson<{ attachment: ApiAttachment }>(
    apiPath("/attachments"),
    input,
    "Failed to record attachment",
  );
  return body.attachment;
}
