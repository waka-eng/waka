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

import { ApiError, apiPath, deleteJson, getJson, patchJson, postJson } from "./http";

// ---------------------------------------------------------------------------
// What an attachment is
// ---------------------------------------------------------------------------

/** Attachment kinds — mirrors the Postgres `attachment_type` enum. */
export type AttachmentType = "link" | "image" | "file" | "audio";
export type AttachmentEnrichmentStatus = "pending" | "ready" | "failed" | "unavailable";
export type AttachmentEnrichmentKind = "page_body" | "image_description" | "audio_transcription";

export interface ApiAttachmentTranscript {
  attachmentId: string; inspirationId: string; profileId: string; revision: string;
  status: AttachmentEnrichmentStatus; transcript: string | null; correction: string | null;
  effectiveText: string | null; correctedAt: string | null; reason: string | null;
  canEdit: boolean; canRetry: boolean; retryAfter: string | null;
}
function checkedTranscript(id: string, row: ApiAttachmentTranscript) {
  if (!row || row.attachmentId !== id || typeof row.revision !== 'string' || !/^\d+$/.test(row.revision) ||
    !['pending', 'ready', 'failed', 'unavailable'].includes(row.status) ||
    ![row.transcript, row.correction, row.effectiveText].every(value => value === null || typeof value === 'string') ||
    !(row.retryAfter === null || (typeof row.retryAfter === 'string' && Number.isFinite(Date.parse(row.retryAfter)))) ||
    typeof row.canEdit !== 'boolean' || typeof row.canRetry !== 'boolean') {
    throw new ApiError({ status: 200, code: 'invalid_response', message: 'Could not verify this transcript' });
  }
  return row;
}
export async function fetchAttachmentTranscript(id: string, signal?: AbortSignal) {
  return checkedTranscript(id, await getJson<ApiAttachmentTranscript>(apiPath(`/attachments/${encodeURIComponent(id)}/transcript`), 'Could not load the transcript', signal));
}
export async function correctAttachmentTranscript(id: string, input: { revision: string; correction: string | null }, signal?: AbortSignal) {
  return checkedTranscript(id, await patchJson<ApiAttachmentTranscript>(apiPath(`/attachments/${encodeURIComponent(id)}/transcript`), input, 'Could not save the transcript', signal));
}
export async function retryAttachmentTranscript(id: string, revision: string, signal?: AbortSignal) {
  return checkedTranscript(id, await postJson<ApiAttachmentTranscript>(apiPath(`/attachments/${encodeURIComponent(id)}/transcript/retry`), { revision }, 'Could not retry transcription', signal));
}

export async function fetchAttachmentUrl(id: string, signal?: AbortSignal): Promise<string> {
  const body = await getJson<{ attachmentId: string; url: string }>(apiPath(`/attachments/${encodeURIComponent(id)}/url`), 'Could not open this attachment', signal);
  if (body.attachmentId !== id || !/^https?:\/\//i.test(body.url)) throw new ApiError({ status: 200, code: 'invalid_response', message: 'Could not open this attachment' });
  return body.url;
}

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
  /** Original link remains usable if preview metadata is temporarily unavailable. */
  url?: string;
}

export interface ApiAttachmentDetails {
  attachment: ApiAttachment;
  previewImageAvailable: boolean;
  analysis: { status: AttachmentEnrichmentStatus; canRetry: boolean; retryAfter: string | null };
}
function checkedAttachmentDetails(id: string, value: ApiAttachmentDetails) {
  if (!value || typeof value.previewImageAvailable !== 'boolean' || value.attachment?.id !== id || !['link', 'image'].includes(value.attachment.type) ||
    !['pending', 'ready', 'failed', 'unavailable'].includes(value.analysis?.status) || typeof value.analysis.canRetry !== 'boolean' ||
    !(value.analysis.retryAfter === null || (typeof value.analysis.retryAfter === 'string' && Number.isFinite(Date.parse(value.analysis.retryAfter)))) ||
    typeof value.attachment.url !== 'string' || !value.attachment.enrichment ||
    ![value.attachment.enrichment.text, value.attachment.enrichment.errorReason].every(text => text === null || typeof text === 'string') ||
    (value.attachment.enrichment.link !== null && (!value.attachment.enrichment.link ||
      !['finalUrl', 'hostname', 'title', 'description', 'siteName', 'previewImageUrl'].every(key => {
        const field = value.attachment.enrichment.link![key as keyof NonNullable<ApiAttachmentEnrichment['link']>];
        return field === null || typeof field === 'string';
      })))) {
    throw new ApiError({ status: 200, code: 'invalid_response', message: 'Could not verify this preview' });
  }
  return value;
}
export async function fetchAttachmentDetails(id: string, signal?: AbortSignal) {
  return checkedAttachmentDetails(id, await getJson<ApiAttachmentDetails>(apiPath(`/attachments/${encodeURIComponent(id)}/details`), 'Could not load the preview', signal));
}
export async function retryAttachmentAnalysis(id: string, signal?: AbortSignal) {
  return checkedAttachmentDetails(id, await postJson<ApiAttachmentDetails>(apiPath(`/attachments/${encodeURIComponent(id)}/analysis/retry`), {}, 'Could not retry the preview', signal));
}
export function attachmentPreviewImageUrl(id: string) { return apiPath(`/attachments/${encodeURIComponent(id)}/preview-image`); }

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
  profileId?: string;
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
  signal?: AbortSignal,
  options: { profile?: string } = {},
): Promise<PresignResponse> {
  const result = await postJson<PresignResponse>(
    apiPath(`/attachments/presign${options.profile ? `?profile=${encodeURIComponent(options.profile)}` : ''}`),
    input,
    "Failed to mint upload URL",
    signal,
  );
  if (options.profile && result.profileId !== options.profile) throw new ApiError({ status: 200, code: 'upload_scope_unverified', message: 'Could not verify where this upload belongs' });
  return result;
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
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "PUT",
      credentials: "omit",
      headers,
      body: file,
      ...(signal ? { signal } : {}),
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
export type FinalizeInspirationAttachmentRequest =
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
 * A photo or file for a chat message that has not been sent yet. `messageId`
 * is the id the composer WILL send the message under; the row waits
 * ("staged") until `saveConversationMessage` / `createConversation` sends that
 * id with this attachment's id in `attachmentIds`. `contentType` and `size`
 * are required and must equal what was presigned and PUT.
 */
export interface FinalizeMessageAttachmentRequest {
  conversationId: string;
  messageId: string;
  type: "image" | "file";
  key: string;
  contentType: string;
  size: number;
  name?: string;
}

export type FinalizeAttachmentRequest = FinalizeInspirationAttachmentRequest | FinalizeMessageAttachmentRequest;

/**
 * A photo or file in a chat transcript. No URL: open the bytes with
 * `fetchAttachmentUrl(id)` (a five-minute presigned read, owner-checked),
 * exactly as an inspiration photo is opened. `staged` is true only on the
 * finalize response, before the message is sent.
 */
export interface ApiMessageAttachment {
  id: string;
  conversationId: string;
  messageId: string;
  staged: boolean;
  type: "image" | "file";
  name: string | null;
  contentType: string | null;
  size: number | null;
  createdAt: string;
}
export function isApiMessageAttachment(value: unknown): value is ApiMessageAttachment {
  const row = value as ApiMessageAttachment;
  return Boolean(row) && typeof row.id === "string" && typeof row.conversationId === "string" && typeof row.messageId === "string" &&
    typeof row.staged === "boolean" && (row.type === "image" || row.type === "file") &&
    (row.name === null || typeof row.name === "string") && (row.contentType === null || typeof row.contentType === "string") &&
    (row.size === null || (typeof row.size === "number" && Number.isSafeInteger(row.size))) && Number.isFinite(Date.parse(row.createdAt));
}

/**
 * POST /attachments
 *
 * Finalize an attachment after the S3 PUT has succeeded (image / file) or
 * record a pasted link directly (link). The server enforces inspiration
 * ownership; on success it returns the canonical row and queues enrichment.
 *
 * With `{conversationId, messageId}` instead of `inspirationId` it stages a
 * chat attachment and returns an `ApiMessageAttachment`. `options.profile`
 * is the chat's owner, the same `profile` the conversation calls take.
 */
export async function finalizeAttachment(input: FinalizeInspirationAttachmentRequest): Promise<ApiAttachment>;
export async function finalizeAttachment(input: FinalizeMessageAttachmentRequest, options?: { profile?: string; signal?: AbortSignal }): Promise<ApiMessageAttachment>;
export async function finalizeAttachment(
  input: FinalizeAttachmentRequest,
  options: { profile?: string; signal?: AbortSignal } = {},
): Promise<ApiAttachment | ApiMessageAttachment> {
  if ("conversationId" in input) {
    const body = await postJson<{ attachment: ApiMessageAttachment }>(
      apiPath(`/attachments${options.profile ? `?profile=${encodeURIComponent(options.profile)}` : ""}`),
      input,
      "Could not attach this file",
      options.signal,
    );
    if (!isApiMessageAttachment(body?.attachment) || body.attachment.conversationId !== input.conversationId.toLowerCase() ||
      body.attachment.messageId !== input.messageId.toLowerCase()) {
      throw new ApiError({ status: 200, code: "invalid_response", message: "Could not verify this attachment" });
    }
    return body.attachment;
  }
  const body = await postJson<{ attachment: ApiAttachment }>(
    apiPath("/attachments"),
    input,
    "Failed to record attachment",
  );
  return body.attachment;
}

/**
 * DISCARD AN UNSENT CHAT UPLOAD — the chip's ×. `DELETE /api/attachments/:id`
 * removes a STAGED row and its object (a sent one is 409, someone else's 404).
 * Best effort by design: the send already deletes every staged row the
 * message does not name, and a daily sweep clears week-old ones, so a discard
 * that fails offline costs nothing but a little storage until then.
 */
export async function discardMessageAttachment(id: string, options: { profile?: string; signal?: AbortSignal } = {}): Promise<void> {
  await deleteJson<{ deleted: true; id: string }>(
    apiPath(`/attachments/${encodeURIComponent(id)}${options.profile ? `?profile=${encodeURIComponent(options.profile)}` : ""}`),
    undefined, "Could not remove this attachment", options.signal,
  );
}

/**
 * THE WHOLE CHAT UPLOAD IN ONE CALL: presign → PUT to S3 → stage onto the
 * message about to be sent. `contentType` is the one every step must agree
 * on — `inspectAttachmentFile(file).contentType` for "Add file", the photo
 * sniffer's verdict (`file.type` after `inspectInspirationPhoto`) for "Add
 * photos". Send the returned `id` in the message's `attachmentIds`.
 *
 * `signal` CALLS IT OFF ONLY BEFORE ANYTHING EXISTS. Presigning makes
 * nothing, so it may be abandoned; but once the PUT starts the object may
 * land, and once finalize is sent the row may commit — an abort there would
 * leave bytes no row names (which the staged-row sweep cannot find) or a
 * staged row counting against the six-per-message and thirty-unsent caps.
 * So from the PUT on it runs to the end, and a caller that no longer wants
 * the result discards it (`discardMessageAttachment`) when it arrives.
 *
 * No `name` means none: an unnamed upload is stored unnamed. The presign's
 * `filename` is only a hint for the key, never shown.
 */
export async function uploadMessageAttachment(
  input: { profile: string; conversationId: string; messageId: string; file: File | Blob; name?: string; contentType: string; type: "image" | "file" },
  signal?: AbortSignal,
): Promise<ApiMessageAttachment> {
  const name = input.name ?? ("name" in input.file && typeof input.file.name === "string" ? input.file.name : undefined);
  const presigned = await presignAttachment({ filename: name || "attachment", contentType: input.contentType, size: input.file.size }, signal, { profile: input.profile });
  if (signal?.aborted) throw new DOMException("The upload was called off before it started", "AbortError");
  await uploadToPresignedUrl(presigned.uploadUrl, input.file, presigned.headers);
  return finalizeAttachment({
    conversationId: input.conversationId, messageId: input.messageId, type: input.type, key: presigned.key,
    contentType: input.contentType, size: input.file.size, ...(name ? { name: name.slice(0, 255) } : {}),
  }, { profile: input.profile });
}
