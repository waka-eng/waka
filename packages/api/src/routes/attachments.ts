/**
 * Attachments routes.
 *
 * Currently exposes:
 *   - POST /attachments/presign : mint an S3 presigned PUT URL the browser
 *                                 can use to upload an attachment payload
 *                                 directly, bypassing the API for the bytes.
 *   - POST /api/attachments         : finalize an upload (or record a link) by
 *                                 inserting an `attachments` row tied to an
 *                                 inspiration owned by the caller. Called by
 *                                 the SPA *after* the browser's S3 PUT
 *                                 completes (200 from S3) — the row never
 *                                 exists if the upload silently failed.
 *
 * Why presigned PUT and not "POST file to API"?
 * ---------------------------------------------
 * The seed contract is explicit: "Storage: SST Bucket (S3) accessed via
 * presigned PUT URLs; do NOT proxy file bytes through API". Presigning means:
 *   - The Lambda only sees a small JSON payload (filename, contentType, size).
 *   - The image/file is uploaded straight to S3 over a single TLS round-trip.
 *   - We avoid Lambda's 6 MB request body cap and pay-per-ms billing for I/O.
 *
 * Security model
 * --------------
 *   1. The route is gated by `requireAuth` — only authenticated callers can
 *      mint a URL.
 *   2. The S3 object key is *server-generated* and namespaced under
 *      `users/<user-id>/...`. The client never proposes a key, so two users
 *      cannot collide and one user cannot overwrite another's object even by
 *      guessing keys.
 *   3. Content-Type and Content-Length are validated server-side and BAKED
 *      INTO the signed URL via `signableHeaders`. If the browser tries to PUT
 *      with a different MIME type or different byte length than what was
 *      requested, S3 will reject the upload — the signature won't match.
 *   4. A short TTL (5 min) limits the blast radius of a leaked URL.
 *
 * Returned shape (consumed by AC 5.3.3+ to record the attachment row):
 *   {
 *     uploadUrl: string,         // presigned PUT URL — single-use, expires soon
 *     key: string,               // S3 object key the worker / DB row will store
 *     expiresAt: string,         // ISO-8601, redundant with the URL but handy
 *     headers: {                 // headers the browser MUST send with the PUT
 *       "Content-Type": string,
 *       "Content-Length": string,
 *     },
 *   }
 */

import { S3Client } from "@aws-sdk/client-s3";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  attachmentTypeEnumValues,
  attachments,
  inspirations,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Maximum upload size we allow through the presigner. 25 MiB is well above
 * the largest plausible inspiration attachment (a high-res photo, a small
 * PDF) and still leaves enough margin under typical browser/CDN limits.
 *
 * The S3 object itself has no enforced limit beyond this — the signature
 * validates the exact byte length the client declared, so an attempt to
 * upload more than `size` will fail server-side at S3.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Allowed MIME type prefixes.
 *
 *   - `image/*`       : JPEG/PNG/GIF/WebP/AVIF/HEIC — the inspiration
 *                       capture flow's "image" attachment kind.
 *   - `application/pdf`, `application/zip`, `application/json`, `text/*`,
 *     `application/octet-stream` : the "file" attachment kind. We list the
 *     common safe types explicitly rather than allowing the full
 *     application/* surface (which includes things like
 *     `application/x-msdownload`).
 *
 * The check is intentionally generous — we are storing user-private files in
 * a non-public bucket, served back through presigned GET URLs only. The risk
 * surface is "user pays storage for a junk file", not "user pwns the bucket".
 */
const ALLOWED_CONTENT_TYPE_RE =
  /^(image\/[a-z0-9.+-]+|application\/(pdf|zip|json|octet-stream)|text\/[a-z0-9.+-]+)$/i;

/**
 * Presign request schema.
 *
 *   - `filename`    : the original filename. Used to derive an extension for
 *                     the S3 key (so a presigned GET later can serve it with
 *                     a sensible Content-Disposition). NEVER used verbatim as
 *                     the key — that would let a client supply `../foo`.
 *   - `contentType` : the MIME type the browser will set on the PUT. Pinned
 *                     into the signature so the browser cannot upload a
 *                     binary masquerading as text.
 *   - `size`        : byte length the browser will send. Pinned into the
 *                     signature via `Content-Length`. Required so we can
 *                     reject oversize uploads BEFORE issuing a URL rather
 *                     than after the bytes hit the wire.
 */
const presignRequestSchema = z.object({
  filename: z
    .string()
    .trim()
    .min(1, "filename is required")
    .max(255, "filename is too long"),
  contentType: z
    .string()
    .trim()
    .min(1, "contentType is required")
    .max(255, "contentType is too long")
    .refine(
      (v) => ALLOWED_CONTENT_TYPE_RE.test(v),
      "contentType is not an allowed MIME type",
    ),
  size: z
    .number()
    .int("size must be an integer number of bytes")
    .min(1, "size must be > 0")
    .max(MAX_UPLOAD_BYTES, `size exceeds the ${MAX_UPLOAD_BYTES}-byte cap`),
});

export type PresignRequest = z.infer<typeof presignRequestSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the S3 bucket name.
 *
 * Resolution order (Sub-AC 3.4):
 *
 *   1. `ATTACHMENTS_BUCKET` — set explicitly by `sst.config.ts` from
 *      `attachmentsBucket.name`. This is the contract: production code paths
 *      go through this env var so the dependency on the SST link is visible
 *      in the stack file and not buried in a runtime probe.
 *
 *   2. `SST_RESOURCE_Attachments` — auto-injected by SST when the Function
 *      is `link`ed to the Bucket. JSON-encoded `{ name, ... }`. Kept as a
 *      fallback so the handler still works if a future engineer wires the
 *      link without re-exporting the env var.
 *
 * We DON'T import `sst` at the top of this file because the smoke tests run
 * outside Lambda and would otherwise blow up on the Resource Proxy.
 */
function getBucketName(): string {
  const fromEnv = process.env.ATTACHMENTS_BUCKET;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const sstLink = process.env.SST_RESOURCE_Attachments;
  if (sstLink) {
    try {
      const parsed = JSON.parse(sstLink) as { name?: string };
      if (parsed?.name) return parsed.name;
    } catch {
      // fall through to error
    }
  }

  throw new Error(
    "Attachments bucket name is not configured (ATTACHMENTS_BUCKET / SST_RESOURCE_Attachments).",
  );
}

/**
 * Resolve the S3 region.
 *
 * Resolution order (Sub-AC 3.4):
 *
 *   1. `ATTACHMENTS_REGION` — set explicitly by `sst.config.ts`. This is
 *      the canonical answer: it MUST equal the region the bucket lives in,
 *      otherwise SigV4 produces a working signature for the wrong endpoint
 *      and S3 rejects the PUT with a 301 PermanentRedirect.
 *
 *   2. `AWS_REGION` / `AWS_DEFAULT_REGION` — Lambda's standard execution
 *      env var. In practice on AWS this matches the stack region, but it
 *      is a fallback rather than the contract.
 *
 *   3. `"us-west-2"` — last-resort default matching `AWS_REGION` in
 *      `sst.config.ts`.
 */
function getRegion(): string {
  return (
    process.env.ATTACHMENTS_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-west-2"
  );
}

/**
 * Lazy S3 client. One per process; reused across warm Lambda invocations.
 * Credentials come from the standard provider chain — on Lambda this is the
 * execution role attached by SST when the Function is `link`ed to the Bucket.
 */
let cachedS3: S3Client | null = null;
function getS3(): S3Client {
  if (cachedS3) return cachedS3;
  cachedS3 = new S3Client({ region: getRegion() });
  return cachedS3;
}

/**
 * Derive a safe file extension (with leading dot) from a user-supplied
 * filename, or return "" if there is none. Restricts to `[A-Za-z0-9]{1,16}`
 * so a client can't smuggle path separators or shell metachars into the
 * S3 key suffix.
 */
function safeExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return "";
  const raw = filename.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,16}$/.test(raw) ? `.${raw}` : "";
}

/**
 * Build a server-controlled S3 object key namespaced under the caller's
 * user id. Two users can never produce the same key (different `userId`
 * prefix); the same user calling twice cannot collide on the same key
 * (random suffix). The key is intentionally *not* derived from the user's
 * filename so a malicious filename cannot influence storage layout.
 */
function buildKey(userId: string, filename: string): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 10);
  const ext = safeExtension(filename);
  return `users/${userId}/attachments/${ts}-${rand}${ext}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

/**
 * URL TTL in seconds. 5 minutes is the SST/AWS-recommended default for
 * single-shot uploads — long enough for a slow-network user to actually PUT
 * the file, short enough that a leaked URL is rapidly useless.
 */
const PRESIGN_TTL_SECONDS = 5 * 60;

export const attachmentsRoutes = new Hono<AuthEnv>();

// Mount auth at the router level — we cannot ship an unauthenticated handler
// in this namespace by accident.
attachmentsRoutes.use("*", requireAuth);

/**
 * POST /attachments/presign
 *
 * Returns a presigned PUT URL the browser can use to upload directly to S3.
 * The route does NOT create the `attachments` row — that happens AFTER the
 * upload succeeds, via a separate endpoint, so a failed upload never leaves
 * a dangling DB row pointing at a missing object.
 */
/**
 * POST /api/attachments — finalize an upload (or record a link).
 *
 * Called by the SPA after the browser's S3 PUT returns 200 (for image / file)
 * or directly when the user pastes a URL (for link). Inserts the row into
 * `attachments` and returns it.
 *
 * Two payload shapes, discriminated by `type`:
 *
 *   { type: "link",
 *     inspirationId, url, name? }                       → no S3 object
 *
 *   { type: "image" | "file",
 *     inspirationId, key, name?, contentType?, size? }  → S3-backed
 *
 * Validation we enforce here, beyond schema parsing:
 *
 *   1. Tenant ownership of the parent inspiration.
 *      We SELECT the row by (id, user_id) — a foreign user_id won't match,
 *      so a malicious caller cannot stick attachments onto someone else's
 *      inspiration even if they guess the uuid.
 *
 *   2. Tenant ownership of the S3 key (image / file only).
 *      Presigned PUTs always namespace under `users/<userId>/attachments/`
 *      (see `buildKey`). We require the same prefix here so a caller cannot
 *      reuse another user's leaked key. Defense in depth: this is already
 *      enforced cryptographically by the original presign call, but checking
 *      it again means a stolen key alone is useless.
 *
 *   3. Object existence (image / file only, best-effort).
 *      Issue an S3 HEAD for the key. If the object is not there we 404 the
 *      finalize call so we never persist a row pointing at nothing. The HEAD
 *      is best-effort — credential / region failures fall through to the
 *      INSERT rather than blocking the user, with a console.warn for visibility.
 *
 * Why a separate finalize call rather than synthesising the row inside the
 * presign endpoint?
 *   - The presign endpoint cannot know if the upload actually succeeded —
 *     S3 is contacted only by the browser. A "presign + write row" combo
 *     would create dangling rows for every cancelled / failed upload.
 *   - Keeps the presign endpoint side-effect-free, so retries are safe.
 */
const baseFinalizeFields = {
  inspirationId: z
    .string()
    .uuid("inspirationId must be a uuid"),
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
});

const finalizeS3Schema = z.object({
  ...baseFinalizeFields,
  type: z.enum(["image", "file"]),
  key: z
    .string()
    .trim()
    .min(1, "key is required")
    .max(1024, "key is too long"),
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
    .max(MAX_UPLOAD_BYTES, `size exceeds the ${MAX_UPLOAD_BYTES}-byte cap`)
    .optional(),
});

const finalizeRequestSchema = z.discriminatedUnion("type", [
  finalizeLinkSchema,
  finalizeS3Schema,
]);

export type FinalizeAttachmentRequest = z.infer<typeof finalizeRequestSchema>;

/**
 * Build the canonical https URL for an S3 object so the row's `url` column
 * always has a renderable value. The frontend may still mint a presigned GET
 * at view time (the bucket is private), but storing the canonical form means
 * the column is never empty and is portable across signing schemes.
 */
function canonicalS3Url(bucket: string, region: string, key: string): string {
  const encoded = key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `https://${bucket}.s3.${region}.amazonaws.com/${encoded}`;
}

/**
 * HEAD the S3 object to verify the upload actually landed before we write a
 * DB row pointing at it. Returns:
 *   - "exists"        : HEAD returned 200, object is durable.
 *   - "missing"       : HEAD returned 404 / NotFound — refuse to persist.
 *   - "indeterminate" : transport / credential failure. Caller should treat as
 *                       a soft pass (the alternative is failing every upload
 *                       on a flaky network).
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

attachmentsRoutes.post("/", async (c) => {
  // 1. Parse + validate JSON body.
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
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const user = c.get("user");
  const db = getDb();

  // 2. Confirm the inspiration exists AND belongs to the caller. A single
  //    indexed lookup — the `inspirations_user_created_idx` covers (user_id, …),
  //    and the primary key covers `id`, so Postgres can satisfy this with a
  //    cheap PK lookup + filter.
  const [inspiration] = await db
    .select({ id: inspirations.id })
    .from(inspirations)
    .where(
      and(
        eq(inspirations.id, parsed.data.inspirationId),
        eq(inspirations.userId, user.id),
      ),
    )
    .limit(1);

  if (!inspiration) {
    // 404 not 403: don't leak the existence of inspirations the caller
    // doesn't own. From the caller's perspective the row simply isn't there.
    return c.json({ error: "Inspiration not found" }, 404);
  }

  // 3. Build the row, branching on type.
  let rowToInsert: {
    inspirationId: string;
    type: (typeof attachmentTypeEnumValues)[number];
    url: string;
    name: string | null;
    s3Key: string | null;
    contentType: string | null;
    size: number | null;
  };

  if (parsed.data.type === "link") {
    rowToInsert = {
      inspirationId: parsed.data.inspirationId,
      type: "link",
      url: parsed.data.url,
      name: parsed.data.name ?? null,
      s3Key: null,
      contentType: null,
      size: null,
    };
  } else {
    const { key, type, name, contentType, size } = parsed.data;

    // Tenant key namespace check. The presign endpoint hard-codes the
    // `users/<userId>/attachments/` prefix; we require the same shape here
    // so a leaked key cannot be replayed by a different user.
    const expectedPrefix = `users/${user.id}/attachments/`;
    if (!key.startsWith(expectedPrefix)) {
      return c.json(
        { error: "key does not belong to the authenticated user" },
        403,
      );
    }

    // Verify the upload actually landed. Best-effort — credential/transport
    // errors degrade to "let the row through".
    let bucket: string;
    try {
      bucket = getBucketName();
    } catch (err) {
      console.error("[attachments] bucket misconfigured:", err);
      return c.json({ error: "Attachments bucket is not configured" }, 500);
    }

    const verdict = await verifyObjectExists(bucket, key);
    if (verdict === "missing") {
      return c.json(
        {
          error:
            "S3 object not found at the supplied key. Did the PUT succeed?",
        },
        404,
      );
    }

    rowToInsert = {
      inspirationId: parsed.data.inspirationId,
      type,
      url: canonicalS3Url(bucket, getRegion(), key),
      name: name ?? null,
      s3Key: key,
      contentType: contentType ?? null,
      size: size ?? null,
    };
  }

  // 4. INSERT and return the canonical row so the SPA can render it without
  //    a follow-up GET.
  const [inserted] = await db
    .insert(attachments)
    .values(rowToInsert)
    .returning({
      id: attachments.id,
      inspirationId: attachments.inspirationId,
      type: attachments.type,
      url: attachments.url,
      name: attachments.name,
      s3Key: attachments.s3Key,
      contentType: attachments.contentType,
      size: attachments.size,
      createdAt: attachments.createdAt,
    });

  if (!inserted) {
    return c.json({ error: "Failed to record attachment" }, 500);
  }

  return c.json({ attachment: inserted }, 201);
});

attachmentsRoutes.post("/presign", async (c) => {
  // 1. Parse + validate JSON body.
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
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }
  const { filename, contentType, size } = parsed.data;

  const user = c.get("user");
  const key = buildKey(user.id, filename);
  const bucket = getBucketName();
  const s3 = getS3();

  // 2. Build the signed PutObject request.
  //    - `ContentType` and `ContentLength` are pinned into the signature so
  //      the browser cannot deviate at PUT time without invalidating the URL.
  //    - We DO NOT set ACL — the bucket stays private; reads happen through
  //      presigned GETs minted at view time.
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
    ContentLength: size,
  });

  let uploadUrl: string;
  try {
    uploadUrl = await getSignedUrl(s3, command, {
      expiresIn: PRESIGN_TTL_SECONDS,
      // Make sure ContentType / ContentLength are part of the signed payload.
      // Without this, AWS SDK v3 may treat them as "unsignable" and the
      // browser-side PUT would succeed even with a different MIME type or
      // byte count, defeating the validation above.
      signableHeaders: new Set(["content-type", "content-length"]),
    });
  } catch (err) {
    // The most common failure mode is missing AWS credentials in a non-Lambda
    // process. Surface a stable shape instead of leaking the SDK's message.
    console.error("[attachments] presign failed:", err);
    return c.json({ error: "Failed to mint upload URL" }, 500);
  }

  const expiresAt = new Date(
    Date.now() + PRESIGN_TTL_SECONDS * 1000,
  ).toISOString();

  // 3. Return the URL + the canonical key the client must echo back when it
  //    later POSTs to /api/attachments to record the row.
  return c.json(
    {
      uploadUrl,
      key,
      expiresAt,
      // Headers the browser MUST forward verbatim with its PUT. Keeping the
      // contract explicit avoids "but I sent the bytes, why did S3 403?"
      // debugging sessions later.
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(size),
      },
    },
    200,
  );
});
