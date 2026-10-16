/**
 * Attachments routes.
 *
 *   - POST /api/attachments/presign : mint an S3 presigned PUT URL the browser
 *                                     uses to upload bytes directly, bypassing
 *                                     the API.
 *   - POST /api/attachments         : finalize an upload (or record a link) by
 *                                     inserting an `attachments` row against an
 *                                     inspiration the caller may capture into.
 *                                     Called by the client *after* the S3 PUT
 *                                     returns 200 — the row never exists if the
 *                                     upload silently failed.
 *
 * Why presigned PUT and not "POST file to API"?
 * ---------------------------------------------
 *   - The Lambda only ever sees a small JSON payload (filename, type, size).
 *   - The bytes travel straight to S3 in one TLS round-trip.
 *   - It avoids Lambda's 6 MB request body cap and pay-per-ms billing for I/O.
 *
 * Security model
 * --------------
 *   1. `requireAuth` gates the whole namespace — only a session can mint a URL.
 *   2. The S3 key is server-generated and namespaced under the acting profile.
 *      The client never proposes a key, so two profiles cannot collide and one
 *      cannot overwrite another's object by guessing.
 *   3. Content-Type and Content-Length are validated server-side and baked into
 *      the signature via `signableHeaders`. A PUT with a different MIME type or
 *      byte length is rejected by S3 itself.
 *   4. A 5-minute TTL bounds the blast radius of a leaked URL.
 *
 * Two facts are kept apart on an S3-backed attachment: the key records which
 * profile *uploaded* the bytes, and the row's `profile_id` records which
 * profile's memory the attachment belongs to. They differ whenever an agent
 * session captures into the account's human profile, and conflating them would
 * either break that capture or let a key be replayed across profiles.
 */

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { attachmentsRegion, makeAttachmentsS3Client } from "../lib/s3-client.js";
import { and, eq, isNotNull } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { z } from "zod";

import {
  attachments,
  conversationMessages,
  conversations,
  inspirations,
  profiles,
  type Attachment,
  type AttachmentEnrichmentStatus,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, profileAccessError, requireAuth, asAccountProfile } from "../lib/middleware.js";
import { enqueueEnrichAttachment, wakeCommittedBackgroundJobs } from "../lib/queue.js";
import { attachmentKeyPrefix, attachmentObjectUrl, getAttachmentsBucket } from '../lib/attachment-storage.js';
import { ALLOWED_ATTACHMENT_CONTENT_TYPE, MAX_ATTACHMENT_UPLOAD_BYTES, isAllowedFileContentType, isRasterImageContentType } from '../lib/inspiration-attachment-input.js';
import { InspirationAttachmentError, assertAttachmentKeysUnused, verifyUploadedAttachment, type AttachmentHead } from '../lib/inspiration-attachments.js';
import { ConversationAttachmentError, MAX_MESSAGE_ATTACHMENTS, MAX_STAGED_MESSAGE_ATTACHMENTS, discardStagedAttachment, messageAttachmentSelection, serializeMessageAttachment, stagedCapCutoff, unreferencedAttachmentKeys } from '../lib/conversation-attachments.js';
import { sweepAttachmentObjects, type DeleteAttachmentObjects } from '../lib/attachment-sweep.js';
import { requestSignalDerivation } from "../lib/inspiration-derivation-requests.js";
import { validationDetails } from "../lib/validation.js";
import { profileQuerySchema } from './inspirations-validation.js';
import { resolveTargetProfile } from './inspirations-tenancy.js';
import { createAttachmentTranscriptRoutes } from './attachment-transcripts.js';
import { attachmentAnalysisState, recoverAttachmentAnalysis } from '../lib/attachment-analysis-retry.js';
import { fetchLinkPreviewImage } from '../lib/signal-enrichment.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Maximum upload size the presigner will sign. 25 MiB is well above the largest
 * plausible attachment (a high-res photo, a small PDF) and still leaves margin
 * under typical browser and CDN limits. The signature pins the exact declared
 * length, so an attempt to send more fails at S3.
 */

/**
 * Allowed MIME type prefixes: images for the "image" attachment kind, and the
 * common safe document types for "file". The full `application/*` surface is
 * deliberately not allowed — it includes things like `application/x-msdownload`.
 * The risk being managed is "a member pays storage for a junk file", not bucket
 * compromise: the bucket is private and served only through presigned GETs.
 */

/**
 * Presign request.
 *
 *   - `filename`    : used only to derive a bounded extension for the key.
 *                     Never used verbatim — that would let a client supply
 *                     `../foo`.
 *   - `contentType` : pinned into the signature, so the browser cannot upload a
 *                     binary masquerading as text.
 *   - `size`        : pinned as Content-Length, so an oversize upload is refused
 *                     before a URL is issued rather than after the bytes land.
 */
const presignRequestSchema = z.object({
  filename: z.string().trim().min(1, "filename is required").max(255, "filename is too long"),
  contentType: z
    .string()
    .trim()
    .min(1, "contentType is required")
    .max(255, "contentType is too long")
    .refine((v) => ALLOWED_ATTACHMENT_CONTENT_TYPE.test(v), "contentType is not an allowed MIME type"),
  size: z
    .number()
    .int("size must be an integer number of bytes")
    .min(1, "size must be > 0")
    .max(MAX_ATTACHMENT_UPLOAD_BYTES, `size exceeds the ${MAX_ATTACHMENT_UPLOAD_BYTES}-byte cap`),
}).strict();

export type PresignRequest = z.infer<typeof presignRequestSchema>;

const baseFinalizeFields = {
  inspirationId: z.string().uuid("inspirationId must be a uuid"),
  name: z
    .string()
    .trim()
    .max(255, "name is too long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
};

const finalizeLinkSchema = z.object({
  ...baseFinalizeFields,
  type: z.literal("link"),
  url: z
    .string()
    .trim()
    .min(1, "url is required")
    .max(2048, "url is too long")
    .url("url must be a valid URL"),
}).strict();

/**
 * An image that already lives somewhere — pasted from the web rather than
 * uploaded. It carries no S3 key, so enrichment reads the bytes from the URL
 * under the same address guard a link gets: an attachment is user-supplied
 * either way, and being an image is not a reason to let it point inward.
 */
const finalizeRemoteImageSchema = z.object({
  ...baseFinalizeFields,
  type: z.literal("image"),
  url: z
    .string()
    .trim()
    .min(1, "url is required")
    .max(2048, "url is too long")
    .url("url must be a valid URL"),
  contentType: z
    .string()
    .trim()
    .max(255, "contentType is too long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
})
  /* Strict does real routing work here: these schemas are tried in order,
     and before it, a payload carrying BOTH `url` and `key` parsed as a
     remote image with the key silently dropped. */
  .strict();

const finalizeS3Schema = z.object({
  ...baseFinalizeFields,
  type: z.enum(["image", "file", "audio"]),
  key: z.string().trim().min(1, "key is required").max(1024, "key is too long"),
  contentType: z
    .string()
    .trim()
    .max(255, "contentType is too long")
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),
  size: z
    .number()
    .int("size must be an integer number of bytes")
    .min(0, "size must be >= 0")
    .max(MAX_ATTACHMENT_UPLOAD_BYTES, `size exceeds the ${MAX_ATTACHMENT_UPLOAD_BYTES}-byte cap`)
    .optional(),
}).strict();

/**
 * A PHOTO OR FILE FOR A CHAT MESSAGE (0076). Uploaded bytes only — no links,
 * no remote images, no audio — and stricter than the inspiration shape above:
 * `contentType` and `size` are required, checked against the type's
 * allowlist here and against S3's HEAD in the handler. `messageId` is the id
 * the client will send the message under; the message must not exist yet.
 * Strict, and without `inspirationId`, so a payload naming both owners
 * matches no shape at all.
 */
const finalizeChatSchema = z.object({
  conversationId: z.string().uuid("conversationId must be a uuid").transform((v) => v.toLowerCase()),
  messageId: z.string().uuid("messageId must be a uuid").transform((v) => v.toLowerCase()),
  name: baseFinalizeFields.name,
  type: z.enum(["image", "file"]),
  key: z.string().trim().min(1, "key is required").max(1024, "key is too long"),
  contentType: z.string().trim().min(1).max(255),
  size: z.number().int().min(1).max(MAX_ATTACHMENT_UPLOAD_BYTES, `size exceeds the ${MAX_ATTACHMENT_UPLOAD_BYTES}-byte cap`),
}).strict().superRefine((value, context) => {
  /* A chat photo is a raster photo — never `image/svg+xml`, a document that
     can carry script. A chat file's list (`isAllowedFileContentType`) holds
     only the same raster images among its `image/*` entries. The presign is
     target-agnostic (it never knows a chat is the destination), so this
     refusal is the gate. */
  const allowed = value.type === "image"
    ? isRasterImageContentType(value.contentType)
    : isAllowedFileContentType(value.contentType);
  if (!allowed || !ALLOWED_ATTACHMENT_CONTENT_TYPE.test(value.contentType)) {
    context.addIssue({ code: "custom", path: ["contentType"], message: "This file type cannot be attached" });
  }
});

/**
 * Ordered rather than discriminated: `image` arrives two ways, carrying a
 * `key` when it was uploaded and a `url` when it was pasted, so the S3 shape
 * is tried first and a payload without a key falls through to the remote one.
 * The chat shape is last; it is the only one without `inspirationId`.
 */
const finalizeRequestSchema = z.union([
  finalizeLinkSchema,
  finalizeS3Schema,
  finalizeRemoteImageSchema,
  finalizeChatSchema,
]);

export type FinalizeAttachmentRequest = z.infer<typeof finalizeRequestSchema>;

// ---------------------------------------------------------------------------
// S3 plumbing
// ---------------------------------------------------------------------------

/**
 * Resolve the bucket name.
 *
 *   1. `ATTACHMENTS_BUCKET` — set explicitly by `sst.config.ts`. This is the
 *      contract: the dependency on the SST link stays visible in the stack file
 *      rather than buried in a runtime probe.
 *   2. `SST_RESOURCE_Attachments` — auto-injected when the Function is `link`ed
 *      to the Bucket. A fallback, so the handler still works if the env var is
 *      ever wired without being re-exported.
 *
 * `sst` is deliberately not imported at module scope: the tests run outside
 * Lambda and would blow up on the Resource proxy.
 */

/**
 * Resolve the region.
 *
 * `ATTACHMENTS_REGION` is canonical and MUST equal the bucket's region: SigV4
 * otherwise produces a valid signature for the wrong endpoint and S3 answers a
 * 301 PermanentRedirect. Lambda's own `AWS_REGION` is a fallback.
 */
function getRegion(): string {
  /* One resolver, in lib/s3-client.ts. This wrapper stays because the region
     is read here for more than client construction. */
  return attachmentsRegion();
}

/**
 * Lazy S3 client, one per process, reused across warm invocations. Credentials
 * come from the standard provider chain — on Lambda, the execution role SST
 * attaches when the Function is linked to the Bucket.
 */
let cachedS3: S3Client | null = null;
function getS3(): S3Client {
  if (cachedS3) return cachedS3;
  cachedS3 = makeAttachmentsS3Client();
  return cachedS3;
}

/**
 * Derive a safe extension from a client-supplied filename, or "" when there is
 * none. Restricted to `[A-Za-z0-9]{1,16}` so a filename cannot smuggle path
 * separators or shell metacharacters into the key.
 */
function safeExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "";
  const raw = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(raw) ? `.${raw}` : "";
}

/** Every uploaded object lives under the uploading profile, and only there. */

/**
 * Build a server-controlled key. Two profiles can never produce the same key
 * (different prefix); one profile uploading twice cannot collide (random
 * suffix). The key is not derived from the filename, so a hostile filename
 * cannot influence storage layout.
 */
/**
 * The prefix names the UPLOADER, not necessarily the final owner: a human
 * presigns under their own prefix and may finalize onto an agent's
 * inspiration (a capture the matrix allows), so key locality and row
 * ownership can diverge. Deliberately benign: every deletion path — account
 * erasure and inspiration scrubbing alike — walks the ROWS' stored s3Key,
 * never the prefix, so no object outlives its row whatever prefix it wears.
 * The prefix stays because "who uploaded this" is provenance worth keeping.
 */
function buildKey(profileId: string, filename: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  return `${attachmentKeyPrefix(profileId)}${ts}-${rand}${safeExtension(filename)}`;
}

/**
 * Build the canonical https URL for an object so the row's `url` column always
 * has a renderable value. The client still mints a presigned GET at view time
 * (the bucket is private), but storing the canonical form keeps the column
 * non-empty and portable across signing schemes.
 */

/**
 * HEAD the object to verify the upload actually landed before writing a row
 * that points at it.
 *
 *   - "exists"        : the object is durable.
 *   - "missing"       : 404 / NotFound — refuse to persist.
 *   - "indeterminate" : transport or credential failure. The caller treats this
 *                       as a soft pass; the alternative is failing every upload
 *                       on a flaky network.
 */
async function verifyObjectExists(
  bucket: string,
  key: string,
): Promise<"exists" | "missing" | "indeterminate"> {
  try {
    await getS3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return "exists";
  } catch (err) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
    const status = e?.$metadata?.httpStatusCode;
    if (status === 404 || e?.name === "NotFound" || e?.name === "NoSuchKey") {
      return "missing";
    }
    console.warn("[attachments] HEAD verification inconclusive:", err);
    return "indeterminate";
  }
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export type SerializableAttachment = Pick<
  Attachment,
  | "id"
  | "inspirationId"
  | "type"
  | "url"
  | "name"
  | "contentType"
  | "size"
  | "enrichmentStatus"
  | "enrichmentKind"
  | "enrichmentText"
  | "enrichmentErrorReason"
  | "enrichmentUpdatedAt"
  | "finalUrl"
  | "hostname"
  | "title"
  | "description"
  | "siteName"
  | "previewImageUrl"
  | "imageWidth"
  | "imageHeight"
  | "createdAt"
>;

/**
 * The attachment shape every surface renders. Enrichment is nested under its
 * own key so a reader can never mistake machine-derived text for something the
 * member wrote.
 */
export function serializeAttachment(row: SerializableAttachment) {
  return {
    id: row.id,
    inspirationId: row.inspirationId,
    type: row.type,
    url: row.url,
    name: row.name,
    contentType: row.contentType,
    size: row.size,
    createdAt: row.createdAt.toISOString(),
    enrichment: {
      status: row.enrichmentStatus,
      kind: row.enrichmentKind,
      text: row.enrichmentText,
      errorReason: row.enrichmentErrorReason,
      updatedAt: row.enrichmentUpdatedAt ? row.enrichmentUpdatedAt.toISOString() : null,
      link:
        row.type === "link"
          ? {
              finalUrl: row.finalUrl,
              hostname: row.hostname,
              title: row.title,
              description: row.description,
              siteName: row.siteName,
              previewImageUrl: row.previewImageUrl,
            }
          : null,
      image:
        row.type === "image"
          ? { width: row.imageWidth, height: row.imageHeight }
          : null,
    },
  };
}

/** Columns `serializeAttachment` needs, for callers building their own select. */
export const attachmentSelection = {
  id: attachments.id,
  inspirationId: attachments.inspirationId,
  type: attachments.type,
  url: attachments.url,
  name: attachments.name,
  contentType: attachments.contentType,
  size: attachments.size,
  enrichmentStatus: attachments.enrichmentStatus,
  enrichmentKind: attachments.enrichmentKind,
  enrichmentText: attachments.enrichmentText,
  enrichmentErrorReason: attachments.enrichmentErrorReason,
  enrichmentUpdatedAt: attachments.enrichmentUpdatedAt,
  finalUrl: attachments.finalUrl,
  hostname: attachments.hostname,
  title: attachments.title,
  description: attachments.description,
  siteName: attachments.siteName,
  previewImageUrl: attachments.previewImageUrl,
  imageWidth: attachments.imageWidth,
  imageHeight: attachments.imageHeight,
  createdAt: attachments.createdAt,
} as const;

// ---------------------------------------------------------------------------
// Enrichment scheduling
// ---------------------------------------------------------------------------

/**
 * Links, images and audio carry material a machine can read. A file records
 * the honest verdict immediately rather than occupying a queue slot to reach
 * the same conclusion.
 */
function initialEnrichmentStatus(type: Attachment["type"]): AttachmentEnrichmentStatus {
  return type === "link" || type === "image" || type === 'audio' ? "pending" : "unavailable";
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * URL TTL. Five minutes is long enough for a slow-network upload and short
 * enough that a leaked URL is rapidly useless.
 */
const PRESIGN_TTL_SECONDS = 5 * 60;

export interface AttachmentRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: typeof requireAuth;
  previewImage?: typeof fetchLinkPreviewImage;
  /** S3 HEAD for the chat finalize's upload check; injected by tests. */
  attachmentHead?: AttachmentHead;
  /** S3 delete for a discarded staged upload; injected by tests. */
  deleteAttachmentObjects?: DeleteAttachmentObjects;
}

/**
 * The factory every other router already is. Attachments was the one
 * straggler built as a bare module-level Hono, which is exactly why it was
 * also the one profile-scoped surface with no boundary coverage: the
 * injected-session seam the contract suite drives did not exist here.
 */
export function createAttachmentRoutes(
  deps: AttachmentRouteDependencies = {},
): Hono<AuthEnv> {
  const getDatabase = deps.getDatabase ?? getDb;
  const attachmentsRoutes = new Hono<AuthEnv>();

// Mounted at the router level so an unauthenticated handler cannot be shipped
// into this namespace by accident.
attachmentsRoutes.use("*", deps.authMiddleware ?? requireAuth);
attachmentsRoutes.route('/', createAttachmentTranscriptRoutes(getDatabase));

async function previewAccess(c: Context<AuthEnv>, write = false) {
  c.header('Cache-Control', 'private, no-store');
  const id = z.string().uuid().safeParse(c.req.param('attachmentId'));
  if (!id.success) return c.json({ error: 'Invalid attachment' }, 400);
  const db = getDatabase(), session = c.get('session');
  const [found] = await db.select({ row: attachments, accountId: profiles.accountId, type: profiles.type })
    .from(attachments).innerJoin(profiles, eq(profiles.id, attachments.profileId)).where(eq(attachments.id, id.data)).limit(1);
  // A chat attachment has no preview or analysis surface (it is never enriched).
  if (!found || found.accountId !== session.profile.accountId || !['link', 'image'].includes(found.row.type) || found.row.inspirationId === null) return c.json({ error: 'Attachment not found' }, 404);
  const target = asAccountProfile({ id: found.row.profileId, accountId: found.accountId, type: found.type });
  if (!target) return c.json({ error: 'Attachment not found' }, 404);
  const denied = await profileAccessError(db, session, target, write ? 'write' : 'read');
  if (denied) return c.json(denied, 403);
  return { row: found.row, canEdit: !await profileAccessError(db, session, target, 'write') };
}
function previewDetails(row: Attachment) {
  const attachment = serializeAttachment(row);
  const previewImageAvailable = row.type === 'link' && Boolean(row.previewImageUrl);
  // Detail thumbnails are fetched through the owned route. Never hand an
  // external tracking URL to a renderer or to the field's memory projection.
  if (attachment.enrichment.link) attachment.enrichment.link.previewImageUrl = null;
  return { attachment, previewImageAvailable };
}
attachmentsRoutes.get('/:attachmentId/details', async c => {
  const allowed = await previewAccess(c); if (allowed instanceof Response) return allowed;
  return c.json({ ...previewDetails(allowed.row),
    analysis: await attachmentAnalysisState(getDatabase(), allowed.row, allowed.canEdit) });
});
attachmentsRoutes.get('/:attachmentId/preview-image', async c => {
  const allowed = await previewAccess(c); if (allowed instanceof Response) return allowed;
  if (allowed.row.type !== 'link' || !allowed.row.previewImageUrl) return c.json({ error: 'Preview image unavailable' }, 404);
  try {
    const image = await (deps.previewImage ?? fetchLinkPreviewImage)(allowed.row.previewImageUrl);
    c.header('Content-Type', image.contentType); c.header('X-Content-Type-Options', 'nosniff');
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return c.body(new Uint8Array(image.bytes).buffer);
  } catch { return c.json({ error: 'Preview image unavailable' }, 404); }
});
attachmentsRoutes.post('/:attachmentId/analysis/retry', async c => {
  const allowed = await previewAccess(c, true); if (allowed instanceof Response) return allowed;
  if (!z.object({}).strict().safeParse(await c.req.json().catch(() => null)).success) return c.json({ error: 'Invalid retry request' }, 400);
  const saved = await getDatabase().transaction(tx => recoverAttachmentAnalysis(tx, {
    profileId: allowed.row.profileId, attachmentId: allowed.row.id, expectedType: allowed.row.type,
  }));
  if (!saved) return c.json({ error: 'Attachment not found' }, 404);
  if (saved === 'rate_limited') return c.json({ error: 'This attachment has reached its retry limit. Try again later.' }, 429);
  if (saved === 'conflict') return c.json({ error: 'This attachment changed. Reload it first.' }, 409);
  await wakeCommittedBackgroundJobs();
  return c.json({ ...previewDetails(saved), analysis: await attachmentAnalysisState(getDatabase(), saved, true) }, 202);
});

// Raw uploads remain private. Resolve one current owned attachment to a short
// read URL; a guessed id or public room source never grants raw-file access.
attachmentsRoutes.get('/:attachmentId/url', async c => {
  c.header('Cache-Control', 'private, no-store');
  const id = z.string().uuid().safeParse(c.req.param('attachmentId'));
  if (!id.success) return c.json({ error: 'Invalid attachment' }, 400);
  const db = getDatabase(), session = c.get('session');
  const [row] = await db.select({ id: attachments.id, profileId: attachments.profileId, key: attachments.s3Key,
    url: attachments.url, conversationId: attachments.conversationId, accountId: profiles.accountId, type: profiles.type }).from(attachments)
    .innerJoin(profiles, eq(profiles.id, attachments.profileId)).where(eq(attachments.id, id.data)).limit(1);
  if (!row || row.accountId !== session.profile.accountId) return c.json({ error: 'Attachment not found' }, 404);
  /* A chat's photos and files are as private as the chat: conversations are
     the person at a browser's alone (`humanSessionsOnly`), so an agent
     session's read grant over the human profile does not reach them. */
  if (row.conversationId !== null && (session.profile.type !== 'human' || session.keyScoped)) return c.json({ error: 'Attachment not found' }, 404);
  const target = asAccountProfile({ id: row.profileId, accountId: row.accountId, type: row.type });
  if (!target) return c.json({ error: 'Attachment not found' }, 404);
  const denied = await profileAccessError(db, session, target, 'read');
  if (denied) return c.json(denied, 403);
  if (!row.key) {
    if (!/^https?:\/\//i.test(row.url)) return c.json({ error: 'Attachment unavailable' }, 404);
    return c.json({ attachmentId: row.id, url: row.url, expiresAt: null });
  }
  try {
    const url = await getSignedUrl(getS3(), new GetObjectCommand({ Bucket: getAttachmentsBucket(), Key: row.key }), { expiresIn: PRESIGN_TTL_SECONDS });
    return c.json({ attachmentId: row.id, url, expiresAt: new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString() });
  } catch { return c.json({ error: 'Could not open this attachment. Try again.' }, 503); }
});

/**
 * DELETE /api/attachments/:attachmentId — DISCARD A STAGED CHAT UPLOAD.
 *
 * A chip removed from the composer before its message is sent. The same
 * gates as the chat finalize: the person at a browser only (403 for an agent
 * session or keeper key), and the owner resolved from `?profile=` with
 * "write". Then:
 *
 *   200 { deleted: true, id }  the staged row is gone; its object is swept
 *   404                        no staged-or-sent chat attachment of this
 *                              profile has this id (another's, an
 *                              inspiration's, or already discarded)
 *   409                        it was already sent with its message; a sent
 *                              message's attachments go with the chat
 */
attachmentsRoutes.delete('/:attachmentId', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  const session = c.get('session');
  if (session.profile.type !== 'human' || session.keyScoped) return c.json({ error: 'Only the account holder can remove a conversation attachment' }, 403);
  const id = z.string().uuid().safeParse(c.req.param('attachmentId'));
  if (!id.success) return c.json({ error: 'Invalid attachment' }, 400);
  const query = profileQuerySchema.safeParse(c.req.query());
  if (!query.success) return c.json({ error: 'Invalid profile' }, 400);
  const db = getDatabase();
  const target = await resolveTargetProfile(db, session, query.data.profile, 'write');
  if (!target.ok) return c.json(target.body, target.status);
  let key: string | null;
  try { key = await db.transaction((tx) => discardStagedAttachment(tx, target.profileId, id.data.toLowerCase())); }
  catch (error) {
    if (error instanceof ConversationAttachmentError) return c.json({ error: error.message }, error.status);
    throw error;
  }
  const keys = await unreferencedAttachmentKeys(db, key ? [key] : []);
  if (keys.length) await (deps.deleteAttachmentObjects ?? sweepAttachmentObjects)(keys);
  return c.json({ deleted: true, id: id.data.toLowerCase() });
});

/**
 * FINALIZE ONTO A CHAT MESSAGE THAT IS ABOUT TO BE SENT (0076).
 *
 *   { conversationId, messageId, type: "image" | "file", key, contentType, size, name? }
 *
 * The row is STAGED: it waits for `POST /conversations[/:id/messages]` to
 * send `messageId` with this attachment's id in `attachmentIds`. Checks, in
 * order:
 *
 *   1. The person at a browser only — conversations are `humanSessionsOnly`,
 *      so an agent session or keeper key cannot attach to one either.
 *   2. The chat's owner is resolved exactly as the conversation routes
 *      resolve it (`?profile=`, default the session's own, "write"). If the
 *      conversation exists it must be that profile's and not deleted; if it
 *      does not exist yet this is a first message, and the create links it.
 *   3. `messageId` must not be a sent message — a sent message is immutable.
 *      All staged rows for one message id must name the same conversation.
 *   4. The upload is what it says: key under the uploader's own prefix, and
 *      S3's HEAD reports the declared length and type (shared with capture).
 *      One object backs one row, so a delete never sweeps bytes another row
 *      still names.
 *   5. Bounds: six per message, thirty staged per profile in the last 24
 *      hours. Older staged rows do not count (a draft abandoned yesterday
 *      must not hold the composer shut), and the worker's daily sweep
 *      removes them, bytes and all, after seven days.
 *
 * Locks the profile row, then the conversation row, so it serializes with
 * conversation create (profile lock) and message send (conversation lock):
 * a row can never be staged for a message that committed a moment earlier.
 */
async function finalizeChatAttachment(c: Context<AuthEnv>, data: z.infer<typeof finalizeChatSchema>) {
  const session = c.get("session");
  if (session.profile.type !== 'human' || session.keyScoped) return c.json({ error: "Only the account holder can attach files to a conversation" }, 403);
  const query = profileQuerySchema.safeParse(c.req.query());
  if (!query.success) return c.json({ error: 'Invalid profile' }, 400);
  const db = getDatabase();
  const target = await resolveTargetProfile(db, session, query.data.profile, 'write');
  if (!target.ok) return c.json(target.body, target.status);
  const profileId = target.profileId;
  let object: Awaited<ReturnType<typeof verifyUploadedAttachment>>;
  try { object = await verifyUploadedAttachment(data, session.profile.id, deps.attachmentHead); }
  catch (error) {
    if (error instanceof InspirationAttachmentError) return c.json({ error: error.message, code: error.code }, error.status);
    throw error;
  }
  type Refusal = { refused: { error: string; status: 404 | 409 | 410 | 429 } };
  const outcome = await db.transaction(async (tx): Promise<Refusal | { row: Parameters<typeof serializeMessageAttachment>[0] }> => {
    await tx.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profileId)).for('update');
    const [conversation] = await tx.select({ profileId: conversations.profileId, deletedAt: conversations.deletedAt })
      .from(conversations).where(eq(conversations.id, data.conversationId)).for('update');
    if (conversation && conversation.profileId !== profileId) return { refused: { error: 'Conversation not found', status: 404 } };
    if (conversation?.deletedAt) return { refused: { error: 'This conversation was deleted.', status: 410 } };
    const [sent] = await tx.select({ id: conversationMessages.id }).from(conversationMessages).where(eq(conversationMessages.id, data.messageId)).limit(1);
    if (sent) return { refused: { error: 'This message was already sent. Attach to a new message.', status: 409 } };
    const staged = await tx.select({ conversationId: attachments.conversationId, stagedMessageId: attachments.stagedMessageId, createdAt: attachments.createdAt }).from(attachments)
      .where(and(eq(attachments.profileId, profileId), isNotNull(attachments.stagedMessageId)));
    const forMessage = staged.filter((row) => row.stagedMessageId === data.messageId);
    if (forMessage.some((row) => row.conversationId !== data.conversationId)) return { refused: { error: 'This message belongs to another conversation.', status: 409 } };
    if (forMessage.length >= MAX_MESSAGE_ATTACHMENTS) return { refused: { error: `A message can carry up to ${MAX_MESSAGE_ATTACHMENTS} attachments.`, status: 409 } };
    const capFrom = stagedCapCutoff(new Date()).getTime();
    if (staged.filter((row) => row.createdAt.getTime() > capFrom).length >= MAX_STAGED_MESSAGE_ATTACHMENTS) return { refused: { error: 'Too many unsent attachments. Send or discard a draft first.', status: 429 } };
    const [reused] = await tx.select({ id: attachments.id }).from(attachments).where(eq(attachments.s3Key, data.key)).limit(1);
    if (reused) return { refused: { error: 'This upload is already attached. Upload it again.', status: 409 } };
    const [row] = await tx.insert(attachments).values({
      profileId, inspirationId: null, conversationId: data.conversationId, stagedMessageId: data.messageId,
      type: data.type, name: data.name ?? null, ...object, enrichmentStatus: 'unavailable',
    }).returning(messageAttachmentSelection);
    return { row: row! };
  });
  if ('refused' in outcome) return c.json({ error: outcome.refused.error }, outcome.refused.status);
  return c.json({ attachment: serializeMessageAttachment(outcome.row) }, 201);
}

/**
 * POST /api/attachments — finalize an upload, or record a link.
 *
 * Two payload shapes, discriminated by `type`:
 *
 *   { type: "link", inspirationId, url, name? }                      → no object
 *   { type: "image" | "file", inspirationId, key, name?, contentType?, size? }
 *
 * Beyond schema parsing, three checks:
 *
 *   1. The parent inspiration must exist and the session must be allowed to
 *      capture into the profile that owns it. A missing row and a row in
 *      another account are both 404, so the endpoint cannot be used to discover
 *      which uuids exist.
 *   2. For an S3-backed attachment, the key must sit under the acting profile's
 *      prefix. The presign call already enforces this cryptographically;
 *      re-checking means a leaked key alone is useless.
 *   3. The object must exist (S3 HEAD). Best-effort: credential and transport
 *      failures fall through to the insert rather than blocking the member.
 *
 * Finalizing separately from presigning is what keeps the presign endpoint
 * side-effect-free — it cannot know whether the upload succeeded, so writing
 * the row there would leave a dangling row behind every cancelled upload.
 */
attachmentsRoutes.post("/", async (c) => {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = finalizeRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid attachment payload",
        details: validationDetails(parsed.error),
      },
      400,
    );
  }

  if ("conversationId" in parsed.data) return finalizeChatAttachment(c, parsed.data);

  const session = c.get("session");
  const db = getDatabase();

  // The parent's owning profile decides both authorization and the row's
  // tenant: an attachment always belongs to the same profile as the
  // inspiration it hangs off, whichever session uploaded it.
  const [parent] = await db
    .select({
      id: inspirations.id,
      profileId: inspirations.profileId,
      accountId: profiles.accountId,
      profileType: profiles.type,
    })
    .from(inspirations)
    .innerJoin(profiles, eq(profiles.id, inspirations.profileId))
    .where(eq(inspirations.id, parsed.data.inspirationId))
    .limit(1);

  if (!parent || parent.accountId !== session.profile.accountId) {
    return c.json({ error: "Inspiration not found" }, 404);
  }

  /* A room's mind keeps no inspirations, so a mind-owned parent here is a
     bug upstream — but the narrow costs nothing and keeps the access matrix
     typed on account-held profiles only. */
  const parentProfile = asAccountProfile({
    accountId: parent.accountId,
    type: parent.profileType,
  });
  if (!parentProfile) return c.json({ error: "Inspiration not found" }, 404);
  const denied = await profileAccessError(
    db,
    session,
    { id: parent.profileId, accountId: parentProfile.accountId, type: parentProfile.type },
    "capture",
  );
  if (denied) return c.json(denied, 403);

  let rowToInsert: typeof attachments.$inferInsert;

  if (parsed.data.type === "link") {
    rowToInsert = {
      profileId: parent.profileId,
      inspirationId: parent.id,
      type: "link",
      url: parsed.data.url,
      name: parsed.data.name ?? null,
      enrichmentStatus: initialEnrichmentStatus("link"),
    };
  } else if (!("key" in parsed.data)) {
    rowToInsert = {
      profileId: parent.profileId,
      inspirationId: parent.id,
      type: "image",
      url: parsed.data.url,
      name: parsed.data.name ?? null,
      contentType: parsed.data.contentType ?? null,
      enrichmentStatus: initialEnrichmentStatus("image"),
    };
  } else {
    const { key, type, name, contentType, size } = parsed.data;

    const expectedPrefix = attachmentKeyPrefix(session.profile.id);
    if (!key.startsWith(expectedPrefix)) {
      return c.json({ error: "key does not belong to the authenticated profile" }, 403);
    }

    let bucket: string;
    try {
      bucket = getAttachmentsBucket();
    } catch (err) {
      console.error("[attachments] bucket misconfigured:", err);
      return c.json({ error: "Attachments bucket is not configured" }, 500);
    }

    const verdict = await verifyObjectExists(bucket, key);
    if (verdict === "missing") {
      return c.json(
        { error: "S3 object not found at the supplied key. Did the PUT succeed?" },
        404,
      );
    }

    rowToInsert = {
      profileId: parent.profileId,
      inspirationId: parent.id,
      type,
      url: attachmentObjectUrl(bucket, getRegion(), key),
      name: name ?? null,
      s3Key: key,
      contentType: contentType ?? null,
      size: size ?? null,
      enrichmentStatus: initialEnrichmentStatus(type),
    };
  }

  const finalized = await db.transaction(async (tx) => {
    /* ONE STORED OBJECT, ONE ATTACHMENT — the rule note capture and the chat
       finalize keep: a second row on an object would lose its bytes when
       the first row's owner is deleted. */
    if (rowToInsert.s3Key) {
      try { await assertAttachmentKeysUnused(tx, [rowToInsert.s3Key]); }
      catch (error) { if (error instanceof InspirationAttachmentError) return { refused: error }; throw error; }
    }
    const [row] = await tx.insert(attachments).values(rowToInsert).returning(attachmentSelection);
    if (row?.enrichmentStatus === "pending") await enqueueEnrichAttachment(parent.profileId, row.id, parent.id, tx);
    else if (row) await requestSignalDerivation({ profileId: parent.profileId, inspirationId: parent.id,
      reason: "edited", changedSource: "inspiration" }, tx);
    return { row };
  });
  if ('refused' in finalized && finalized.refused) return c.json({ error: finalized.refused.message, code: finalized.refused.code }, finalized.refused.status);
  const inserted = 'row' in finalized ? finalized.row : undefined;

  if (!inserted) {
    return c.json({ error: "Failed to record attachment" }, 500);
  }

  await wakeCommittedBackgroundJobs();

  return c.json({ attachment: serializeAttachment(inserted) }, 201);
});

/**
 * POST /api/attachments/presign
 *
 * Returns a presigned PUT URL for a direct-to-S3 upload. It deliberately does
 * NOT create the row — that happens after the upload succeeds, so a failed
 * upload never leaves a row pointing at a missing object.
 */
attachmentsRoutes.post("/presign", async (c) => {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = presignRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid presign payload",
        details: validationDetails(parsed.error),
      },
      400,
    );
  }
  const query = profileQuerySchema.safeParse(c.req.query());
  if (!query.success) return c.json({ error: 'Invalid upload destination' }, 400);
  const session = c.get('session');
  let targetProfileId = session.profile.id;
  if (query.data.profile) {
    const target = await resolveTargetProfile(getDatabase(), session, query.data.profile, 'capture');
    if (!target.ok) return c.json(target.body, target.status);
    targetProfileId = target.profileId;
  }
  const { filename, contentType, size } = parsed.data;

  const key = buildKey(session.profile.id, filename);

  let bucket: string;
  try {
    bucket = getAttachmentsBucket();
  } catch (err) {
    console.error("[attachments] bucket misconfigured:", err);
    return c.json({ error: "Attachments bucket is not configured" }, 500);
  }

  // ContentType and ContentLength are pinned into the signature, so the browser
  // cannot deviate at PUT time without invalidating the URL. No ACL is set —
  // the bucket stays private and reads happen through presigned GETs.
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  });

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUrl(getS3(), command, {
      expiresIn: PRESIGN_TTL_SECONDS,
      // Without this the SDK may treat these as unsignable, and a PUT with a
      // different MIME type or byte count would succeed — defeating the
      // validation above.
      signableHeaders: new Set(["content-type", "content-length"]),
    });
  } catch (err) {
    // Usually missing credentials in a non-Lambda process. Return a stable
    // shape rather than leaking the SDK's message.
    console.error("[attachments] presign failed:", err);
    return c.json({ error: "Failed to mint upload URL" }, 500);
  }

  const expiresAt = new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString();

  return c.json(
    {
      uploadUrl,
      profileId: targetProfileId,
      key,
      expiresAt,
      // Headers the browser must forward verbatim with its PUT. Stating the
      // contract here avoids "but I sent the bytes, why did S3 403?" later.
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
      },
    },
    200,
  );
});

  return attachmentsRoutes;
}

export const attachmentsRoutes = createAttachmentRoutes();
