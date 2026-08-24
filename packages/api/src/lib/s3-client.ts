/**
 * ONE PLACE THAT KNOWS HOW TO REACH THE ATTACHMENTS BUCKET.
 *
 * WHAT THIS REPLACES. Four call sites each built their own `S3Client` and each
 * carried a byte-identical copy of the region ladder —
 * `ATTACHMENTS_REGION || AWS_REGION || AWS_DEFAULT_REGION || "us-west-2"`:
 * `routes/attachments.ts`, `routes/inspirations-editing.ts`,
 * `lib/signal-enrichment.ts`, `lib/account-erasure.ts`. Four copies of a rule
 * is four places for it to drift, and the drift would be silent: a delete path
 * pointed at the wrong region does not error, it simply fails to delete.
 *
 * WHY IT EXISTS NOW, THOUGH. Consolidation was the excuse; testability was the
 * reason. On 2026-08-22 the `organic` e2e harness failed steps 7 and 8 — a
 * saved link and a saved image, both "enriched" — after waiting ninety seconds
 * each. Nothing was broken. There was no bucket, so `attachments.ts` refused
 * every upload, no attachment row was ever written, no `enrich_attachment` job
 * was ever enqueued, and the harness sat waiting for a pipeline that had never
 * been started. Two of the product's four capture kinds were therefore proven
 * by nothing at all, and could not be, because proving them needed AWS.
 *
 * `ATTACHMENTS_ENDPOINT` is what makes them provable. Point it at anything that
 * speaks enough S3 — `tools/e2e/s3-stub.ts` does, in about a hundred lines —
 * and the whole path runs for real: presign, PUT, HEAD, the job, `GetObject`,
 * the description. What is being tested there is OUR half of the contract, and
 * that is the half that breaks. S3's own correctness was never the risk.
 *
 * WHAT IT MAY NEVER BECOME. This is not a way to run production against
 * something other than S3. When the variable is unset — which is every
 * deployed stage, and nothing in `sst.config.ts` sets it — the client is
 * exactly the client each call site built before: real region, real
 * credentials from the environment, real bucket. The override is dev-only by
 * being opt-in, and the static credentials below are reachable ONLY through
 * it, so a missing endpoint can never silently downgrade a real deployment to
 * a fake identity.
 */
import { S3Client } from "@aws-sdk/client-s3";

/**
 * The region the attachments bucket lives in.
 *
 * `ATTACHMENTS_REGION` is canonical and must equal the bucket's real region:
 * SigV4 signs the region into the request, so a mismatch is a signature
 * failure rather than a redirect.
 */
export function attachmentsRegion(): string {
  return (
    process.env.ATTACHMENTS_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    "us-west-2"
  );
}

/** The local-endpoint override, trimmed and normalised, or null when unset. */
export function attachmentsEndpoint(): string | null {
  const raw = process.env.ATTACHMENTS_ENDPOINT?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/**
 * Build a client for the attachments bucket.
 *
 * With no `ATTACHMENTS_ENDPOINT` this is the plain client every call site used
 * to construct for itself. With one, it additionally:
 *
 *   - talks to that endpoint instead of AWS;
 *   - uses **path-style** addressing, because `bucket.localhost` does not
 *     resolve and virtual-host style is what the SDK would otherwise pick;
 *   - signs with a fixed dummy identity, because a local endpoint has no real
 *     credentials to find and the SDK's credential chain would otherwise throw
 *     before the request was ever attempted. The stub does not verify
 *     signatures; it only needs the request to be well-formed enough to send.
 */
export function makeAttachmentsS3Client(): S3Client {
  const endpoint = attachmentsEndpoint();
  const region = attachmentsRegion();
  if (!endpoint) return new S3Client({ region });

  return new S3Client({
    region,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: "waka-local",
      secretAccessKey: "waka-local-secret",
    },
  });
}
