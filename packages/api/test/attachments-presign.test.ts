/**
 * S3 presigned URL issuance test suite — Sub-AC 13.4.
 *
 * Surface under test
 * ------------------
 * `POST /attachments/presign` is the API contract that lets the SPA upload
 * attachment bytes directly to S3, bypassing the Lambda body. The endpoint:
 *
 *   1. Authenticates the caller (else 401).
 *   2. Validates the body shape (`filename`, `contentType`, `size`).
 *   3. Restricts `contentType` to a hand-picked set of safe MIME types.
 *   4. Caps `size` at 25 MiB.
 *   5. Generates a server-controlled S3 object key namespaced under
 *      `users/<caller-id>/attachments/...`.
 *   6. Mints a 5-minute SigV4 presigned PUT URL through `@aws-sdk/s3-request-
 *      presigner.getSignedUrl`, with `content-type` and `content-length`
 *      pinned via `signableHeaders` so the browser cannot cheat the
 *      validation at PUT time.
 *
 * Per Sub-AC 13.4 the suite covers three buckets:
 *
 *   • Presigned upload URL generation     — happy path + key tenant scope
 *                                           + signing parameters reach S3 SDK
 *   • Content-type validation             — allow-list enforcement, per-type
 *                                           + sad-path cases
 *   • Authorization                       — anonymous + bad bearer token
 *                                           + tenant-isolated key prefix
 *
 * Why we drive the live Hono `app` (not a unit-tested route handler)
 * ------------------------------------------------------------------
 * The contract this endpoint exposes is the *combined* behaviour of the
 * Hono router + `requireAuth` middleware + zod schema + key builder + AWS
 * SDK. Stubbing any one of those replaces the seam most likely to drift
 * (e.g. middleware mounted at the wrong prefix, schema accepting
 * `application/x-msdownload`) with hand-written assumptions. Round-tripping
 * through `app.request(...)` in-process gives us strong end-to-end
 * coverage for ~zero perf cost.
 *
 * Why we mock the AWS SDK at the module boundary
 * ----------------------------------------------
 * The Seed contract requires `pnpm test` to run hermetically — no AWS
 * account, no IMDS reach, no real bucket. `attachments.ts` constructs an
 * `S3Client` and calls `getSignedUrl`; both can hang on a developer
 * laptop without static credentials. We replace the SDK at the module
 * boundary using the shared `test/mocks/s3.ts` harness:
 *
 *   - `getSignedUrl(client, command, options)` → records the call and
 *     resolves with a deterministic synthetic URL the test can assert on.
 *   - `S3Client` constructor → records its `{ region }` config so tests
 *     can prove the production code reaches the SDK with the right region.
 *
 * The mock factories must run before the SUT imports the SDK, which is
 * why the `vi.mock(...)` calls live above the SUT-touching imports and
 * use the dynamic-`import()` form (so the factory body is evaluated
 * lazily, after this file's own static imports have resolved).
 *
 * Cleanup
 * -------
 * Every user inserted via `createUserFixture` is tracked through
 * `createCleanupTracker()` and DELETEd in `afterEach`. FK CASCADE on
 * `inspirations.user_id` reaps any inspirations + attachments + reflections
 * the test happened to create. `afterAll` flushes a second time as
 * belt-and-braces against an aborted test that skipped its own afterEach.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// ---------------------------------------------------------------------------
// AWS SDK module mocks — MUST be declared before any module that imports
// `@aws-sdk/client-s3` or `@aws-sdk/s3-request-presigner`. The dynamic
// import inside the factory defers the body evaluation until the mocked
// module is first loaded, by which point the static imports below have
// resolved (so `s3MockState` is initialised).
// ---------------------------------------------------------------------------

vi.mock("@aws-sdk/client-s3", async () => {
  const mod = await import("./mocks/s3.js");
  return mod.s3ClientModuleFactory();
});
vi.mock("@aws-sdk/s3-request-presigner", async () => {
  const mod = await import("./mocks/s3.js");
  return mod.s3PresignerModuleFactory();
});

import { getDb } from "../src/lib/db.js";
import { createUserFixture } from "./fixtures/users.js";
import {
  apiRequest,
  authedClient,
  createCleanupTracker,
} from "./helpers/index.js";
import { s3MockState, signedUrlFor } from "./mocks/s3.js";

// ---------------------------------------------------------------------------
// Bucket / region pin — applied process-wide so the route's `getBucketName()`
// + `getRegion()` resolvers find a stable answer. We snapshot any pre-existing
// values in `beforeAll` so concurrently running smoke scripts don't interfere
// with this suite (and vice versa) when a developer runs both back-to-back.
// ---------------------------------------------------------------------------

const TEST_BUCKET = "waka-test-presign-bucket";
const TEST_REGION = "us-west-2";

let originalEnv: {
  ATTACHMENTS_BUCKET: string | undefined;
  ATTACHMENTS_REGION: string | undefined;
  AWS_REGION: string | undefined;
  SST_RESOURCE_Attachments: string | undefined;
};

beforeAll(() => {
  // Pre-flight: secrets are loaded by `test/setup.ts`. Without them the
  // bearer token minted by `createUserFixture` would 401 the route — and
  // the failure shape would be a confusing "401 instead of 200", not a
  // clear "missing JWT_SECRET". Tripwire here so the diagnostic is sharp.
  expect(process.env.DB_CONNECTION_URL, "DB_CONNECTION_URL").toBeTruthy();
  expect(
    process.env.JWT_SECRET ?? process.env.AUTH_SECRET,
    "JWT_SECRET or AUTH_SECRET",
  ).toBeTruthy();

  originalEnv = {
    ATTACHMENTS_BUCKET: process.env.ATTACHMENTS_BUCKET,
    ATTACHMENTS_REGION: process.env.ATTACHMENTS_REGION,
    AWS_REGION: process.env.AWS_REGION,
    SST_RESOURCE_Attachments: process.env.SST_RESOURCE_Attachments,
  };

  process.env.ATTACHMENTS_BUCKET = TEST_BUCKET;
  process.env.ATTACHMENTS_REGION = TEST_REGION;
  // AWS_REGION is not strictly required (route falls back to ATTACHMENTS_REGION)
  // but pinning it makes the intent explicit if a future code path drops the
  // ATTACHMENTS_REGION special-case.
  process.env.AWS_REGION = TEST_REGION;
  // Make sure the SST link fallback doesn't fight with our explicit env var.
  delete process.env.SST_RESOURCE_Attachments;
});

afterAll(() => {
  // Restore so a follow-up suite (or a developer's repl) sees the env
  // exactly as it was. `originalEnv` may have undefined slots; assign-or-
  // delete so we don't leave the literal string "undefined" lying around.
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

// ---------------------------------------------------------------------------
// Cleanup wiring (mirrors inspirations.test.ts).
// ---------------------------------------------------------------------------

const cleanup = createCleanupTracker();

afterEach(async () => {
  await cleanup.flush();
});

afterAll(async () => {
  await cleanup.flush();
});

// Reset the SDK mock between every test so call-log assertions don't bleed
// across cases.
beforeEach(() => {
  s3MockState.reset();
  // Use a deterministic synthetic URL by default that embeds the bucket +
  // key, so URL-shape assertions in tests have a realistic target without
  // depending on the real SigV4 algorithm (which is what the SDK does).
  s3MockState.signedUrl = signedUrlFor(TEST_BUCKET, TEST_REGION);
});

// ---------------------------------------------------------------------------
// Type aliases — narrow the parsed body at the call site only. The harness
// does not enforce the shape at runtime; assertions do that.
// ---------------------------------------------------------------------------

interface PresignSuccessBody {
  uploadUrl: string;
  key: string;
  expiresAt: string;
  headers: { "Content-Type": string; "Content-Length": string };
}

interface ValidationErrorBody {
  error: string;
  details?: Record<string, string[] | undefined>;
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------
//
// The route is mounted under `attachmentsRoutes.use("*", requireAuth)`; an
// unauthenticated caller MUST never reach the body parser, the zod schema,
// the key builder, or the SDK. We assert that here with three independent
// negative cases (no header, malformed bearer, malformed cookie) plus a
// positive sanity case so a regression that 401s every request — including
// the valid ones — does not slip past as a green test.

describe("POST /attachments/presign — authorization", () => {
  it("returns 401 when no Authorization header is presented", async () => {
    const res = await apiRequest("/api/attachments/presign", {
      method: "POST",
      body: { filename: "x.png", contentType: "image/png", size: 1024 },
    });

    expect(res.status).toBe(401);
    // The middleware short-circuits before any SDK call. If the call log is
    // non-empty something has run that should not have — surface that as a
    // distinct failure (auth bypass), not just "wrong status code".
    expect(s3MockState.calls.getSignedUrl).toHaveLength(0);
    expect(s3MockState.calls.send).toHaveLength(0);
  });

  it("returns 401 when the bearer token is malformed", async () => {
    const res = await apiRequest("/api/attachments/presign", {
      method: "POST",
      headers: { Authorization: "Bearer not-a-real-jwt" },
      body: { filename: "x.png", contentType: "image/png", size: 1024 },
    });

    expect(res.status).toBe(401);
    expect(s3MockState.calls.getSignedUrl).toHaveLength(0);
  });

  it("returns 401 when the session cookie is malformed", async () => {
    // Cookie path mirrors the bearer path — same middleware reads either.
    // A malformed cookie value MUST 401 just like a bad bearer token.
    const res = await apiRequest("/api/attachments/presign", {
      method: "POST",
      headers: { Cookie: "waka_session=not-a-jwt" },
      body: { filename: "x.png", contentType: "image/png", size: 1024 },
    });

    expect(res.status).toBe(401);
    expect(s3MockState.calls.getSignedUrl).toHaveLength(0);
  });

  it("an authenticated caller succeeds (sanity counterpart)", async () => {
    // Pair the 401 cases with at least one positive case so a regression
    // that 401s every request — including valid ones — doesn't slip past.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<PresignSuccessBody>(
      "POST",
      "/api/attachments/presign",
      { filename: "ok.png", contentType: "image/png", size: 2048 },
    );

    expect(res.status).toBe(200);
    expect(res.body.uploadUrl).toMatch(/^https:\/\//);
  });
});

// ---------------------------------------------------------------------------
// Presigned upload URL generation
// ---------------------------------------------------------------------------
//
// The happy path is the contract surface the SPA depends on. We assert:
//   1. Status + JSON shape.
//   2. The S3 key sits under `users/<caller-id>/attachments/...` (tenant
//      isolation — defended cryptographically by SigV4 + checked again at
//      finalize time, but the responsibility starts here).
//   3. The headers contract pins Content-Type + Content-Length verbatim.
//   4. `expiresAt` is roughly 5 minutes in the future and ISO-8601.
//   5. `getSignedUrl(client, command, options)` is invoked exactly once with
//      a `PutObjectCommand` whose `input.{Bucket, Key, ContentType, ContentLength}`
//      match the user's request and the test bucket; the options object pins
//      `signableHeaders` to `{ content-type, content-length }`.
//   6. The S3Client is constructed with the configured region (`us-west-2`).

describe("POST /attachments/presign — presigned URL generation", () => {
  it("returns 200 with a fully-populated payload on the happy path", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<PresignSuccessBody>(
      "POST",
      "/api/attachments/presign",
      { filename: "kitten.png", contentType: "image/png", size: 2048 },
    );

    expect(res.status).toBe(200);
    const body = res.body;

    // 1. URL shape — points at the configured bucket, https, signed.
    expect(body.uploadUrl).toMatch(/^https:\/\//);
    expect(body.uploadUrl).toContain(TEST_BUCKET);
    expect(body.uploadUrl).toContain("X-Amz-Signature=");

    // 2. Tenant scope on the S3 key — namespaced under THIS user.
    const expectedPrefix = `users/${fixture.user.id}/attachments/`;
    expect(body.key.startsWith(expectedPrefix)).toBe(true);
    expect(body.key).toMatch(/\.png$/);

    // 3. Headers contract — what the browser MUST forward verbatim.
    expect(body.headers["Content-Type"]).toBe("image/png");
    expect(body.headers["Content-Length"]).toBe("2048");

    // 4. expiresAt is ISO-8601 in the future, roughly 5 minutes out.
    const expiresAtMs = Date.parse(body.expiresAt);
    expect(Number.isFinite(expiresAtMs)).toBe(true);
    const now = Date.now();
    expect(expiresAtMs).toBeGreaterThan(now);
    // Allow generous slack — the route uses 5 min exactly, so [4, 6] min is
    // safe even on a slow test runner.
    expect(expiresAtMs - now).toBeGreaterThanOrEqual(4 * 60 * 1000);
    expect(expiresAtMs - now).toBeLessThanOrEqual(6 * 60 * 1000);
  });

  it("invokes getSignedUrl with PutObjectCommand pinning Bucket/Key/ContentType/ContentLength + signableHeaders", async () => {
    // This is the assertion that catches a future refactor that drops
    // `signableHeaders` (defeating the content-type/length pin), or that
    // changes the bucket/region resolution out from under the route.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<PresignSuccessBody>(
      "POST",
      "/api/attachments/presign",
      { filename: "doc.pdf", contentType: "application/pdf", size: 4096 },
    );
    expect(res.status).toBe(200);

    expect(s3MockState.calls.getSignedUrl).toHaveLength(1);
    const call = s3MockState.calls.getSignedUrl[0]!;
    expect(call.commandName).toBe("PutObjectCommand");

    // The input object on the SDK command must match the user's request,
    // with the server-built key (NOT the user's filename).
    const input = (call.command as { input?: Record<string, unknown> }).input;
    expect(input).toBeTruthy();
    expect(input!.Bucket).toBe(TEST_BUCKET);
    expect(typeof input!.Key).toBe("string");
    expect(input!.Key).toMatch(
      new RegExp(`^users/${fixture.user.id}/attachments/`),
    );
    expect(input!.Key).toMatch(/\.pdf$/);
    expect(input!.ContentType).toBe("application/pdf");
    expect(input!.ContentLength).toBe(4096);

    // signableHeaders must be a Set containing both content-type and
    // content-length. AWS SDK v3 treats these as "unsignable" by default,
    // so dropping this pin would silently let the browser PUT any MIME
    // type / byte length and S3 would still accept it.
    const opts = call.options as { signableHeaders?: Set<string> } | undefined;
    expect(opts?.signableHeaders).toBeInstanceOf(Set);
    const headerSet = opts!.signableHeaders!;
    expect(headerSet.has("content-type")).toBe(true);
    expect(headerSet.has("content-length")).toBe(true);

    // expiresIn is the 5-min TTL the route hard-codes.
    expect(opts).toMatchObject({ expiresIn: 5 * 60 });
  });

  it("constructs the S3Client with the configured region", async () => {
    // The S3Client is module-level cached, so this assertion may capture
    // the constructor call from a prior test in this run. Either way the
    // first recorded constructor call must use the test region.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const client = authedClient(fixture);

    const res = await client.json<PresignSuccessBody>(
      "POST",
      "/api/attachments/presign",
      { filename: "x.png", contentType: "image/png", size: 1024 },
    );
    expect(res.status).toBe(200);

    // We don't assert the count (cached client may yield zero new
    // constructor calls within this file's lifetime); we DO assert that
    // every captured constructor call configured the right region.
    for (const ctor of s3MockState.calls.s3ClientConstructor) {
      const cfg = ctor.config as { region?: string } | undefined;
      expect(cfg?.region).toBe(TEST_REGION);
    }
  });

  it("namespaces the key under each caller's user id (tenant isolation)", async () => {
    // Two separate users hit the same endpoint. Their keys MUST live in
    // disjoint namespaces — one user can never overwrite another's object
    // even by guessing the suffix, because the prefix carries the user id.
    const alice = await createUserFixture(getDb());
    const bob = await createUserFixture(getDb());
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);

    const aliceRes = await authedClient(alice).json<PresignSuccessBody>(
      "POST",
      "/api/attachments/presign",
      { filename: "alice.png", contentType: "image/png", size: 1024 },
    );
    const bobRes = await authedClient(bob).json<PresignSuccessBody>(
      "POST",
      "/api/attachments/presign",
      { filename: "bob.png", contentType: "image/png", size: 1024 },
    );
    expect(aliceRes.status).toBe(200);
    expect(bobRes.status).toBe(200);

    expect(aliceRes.body.key.startsWith(`users/${alice.user.id}/`)).toBe(true);
    expect(bobRes.body.key.startsWith(`users/${bob.user.id}/`)).toBe(true);
    // Disjoint by construction — alice's user id never appears in bob's key
    // and vice versa.
    expect(aliceRes.body.key).not.toContain(bob.user.id);
    expect(bobRes.body.key).not.toContain(alice.user.id);
  });

  it("produces unique keys across consecutive calls from the same user", async () => {
    // Same filename twice MUST yield distinct keys (timestamp + random
    // suffix). Otherwise the second upload would overwrite the first.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const a = await c.json<PresignSuccessBody>("POST", "/api/attachments/presign", {
      filename: "same.png",
      contentType: "image/png",
      size: 1024,
    });
    const b = await c.json<PresignSuccessBody>("POST", "/api/attachments/presign", {
      filename: "same.png",
      contentType: "image/png",
      size: 1024,
    });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.key).not.toBe(b.body.key);
  });

  it("preserves a safe filename extension on the generated key", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const cases: Array<{ filename: string; contentType: string; ext: RegExp }> = [
      { filename: "photo.jpg", contentType: "image/jpeg", ext: /\.jpg$/ },
      { filename: "doc.pdf", contentType: "application/pdf", ext: /\.pdf$/ },
      { filename: "data.json", contentType: "application/json", ext: /\.json$/ },
    ];

    for (const tc of cases) {
      const res = await c.json<PresignSuccessBody>(
        "POST",
        "/api/attachments/presign",
        { filename: tc.filename, contentType: tc.contentType, size: 1024 },
      );
      expect(res.status, `for ${tc.filename}`).toBe(200);
      expect(res.body.key, `for ${tc.filename}`).toMatch(tc.ext);
    }
  });

  it("strips an unsafe filename extension (defense-in-depth on the S3 key)", async () => {
    // A filename with shell-meta or path-separator characters in its
    // "extension" MUST NOT influence the key suffix. The route's
    // safeExtension() restricts to /^[a-z0-9]{1,16}$/ — anything else
    // collapses to "" so the key has no extension.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const res = await c.json<PresignSuccessBody>(
      "POST",
      "/api/attachments/presign",
      {
        filename: "evil.../../etc/passwd",
        // The extension after the last "." is "../etc/passwd" → regex fail
        // → no extension on the key.
        contentType: "application/octet-stream",
        size: 100,
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.key).not.toContain("..");
    expect(res.body.key).not.toContain("/etc/");
    // The trailing segment after `attachments/` is just `<ts>-<rand>`,
    // with no extension.
    const lastSegment = res.body.key.split("/").pop() ?? "";
    expect(lastSegment).not.toContain(".");
  });

  it("returns 500 with a stable error shape if the SDK presigner throws", async () => {
    // Force the next getSignedUrl call to throw (simulating missing creds
    // or a transport blip). The route catches this and returns
    // `{ error: "Failed to mint upload URL" }` with status 500 — a stable
    // shape the SPA can render without leaking SDK internals to the user.
    s3MockState.signedUrl = () => {
      throw new Error("simulated AWS SDK transport failure");
    };

    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const res = await c.json<{ error: string }>(
      "POST",
      "/api/attachments/presign",
      { filename: "x.png", contentType: "image/png", size: 1024 },
    );

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/upload url/i);
  });

  it("returns 500 when the bucket is not configured", async () => {
    // Production code throws from `getBucketName()` if neither
    // ATTACHMENTS_BUCKET nor SST_RESOURCE_Attachments is set. The route
    // wrapper for the FINALIZE path catches that explicitly; the presign
    // path doesn't catch it, so an unconfigured bucket surfaces as a Hono
    // 500 rather than a 200.
    //
    // We unset the env vars for the duration of this test only, then
    // restore them in `finally` so subsequent tests aren't poisoned.
    const savedBucket = process.env.ATTACHMENTS_BUCKET;
    const savedSst = process.env.SST_RESOURCE_Attachments;

    delete process.env.ATTACHMENTS_BUCKET;
    delete process.env.SST_RESOURCE_Attachments;

    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    try {
      const res = await c.json<unknown>("POST", "/api/attachments/presign", {
        filename: "x.png",
        contentType: "image/png",
        size: 1024,
      });
      // The unhandled exception in the route should surface as a 5xx —
      // the exact body shape is Hono's default "Internal Server Error".
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(res.status).toBeLessThan(600);
    } finally {
      if (savedBucket === undefined) {
        delete process.env.ATTACHMENTS_BUCKET;
      } else {
        process.env.ATTACHMENTS_BUCKET = savedBucket;
      }
      if (savedSst === undefined) {
        delete process.env.SST_RESOURCE_Attachments;
      } else {
        process.env.SST_RESOURCE_Attachments = savedSst;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Content-type validation
// ---------------------------------------------------------------------------
//
// The allow-list is hand-picked: image/*, application/{pdf,zip,json,octet-
// stream}, text/*. Anything else MUST 400 BEFORE any SDK call. Test the
// boundary cases per type so a future regex tweak surfaces here, not in
// production where a user uploads a `.exe` and we eat the storage cost.

describe("POST /attachments/presign — content-type validation", () => {
  // Single helper to keep the per-case body terse and consistent. Each
  // case exercises one branch of the allow-list regex.
  async function presign(
    client: ReturnType<typeof authedClient>,
    contentType: string,
    extras: Partial<{ filename: string; size: number }> = {},
  ): Promise<{ status: number; body: ValidationErrorBody | PresignSuccessBody }> {
    const res = await client.json<ValidationErrorBody | PresignSuccessBody>(
      "POST",
      "/api/attachments/presign",
      {
        filename: extras.filename ?? "file.bin",
        contentType,
        size: extras.size ?? 1024,
      },
    );
    return { status: res.status, body: res.body };
  }

  // 12 sequential round-trips through bcrypt + Neon; the 10s default would
  // race a slow runner. 30s is generous and matches the worst-case CI envelope.
  it(
    "accepts every allowed MIME type",
    async () => {
      const fixture = await createUserFixture(getDb());
      cleanup.trackUser(fixture.user.id);
      const c = authedClient(fixture);

      const allowed = [
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp",
        "image/svg+xml", // image/* with a "+" subtype — must pass [a-z0-9.+-]+
        "application/pdf",
        "application/zip",
        "application/json",
        "application/octet-stream",
        "text/plain",
        "text/csv",
        "text/html",
      ];

      for (const ct of allowed) {
        const res = await presign(c, ct);
        expect(res.status, `expected 200 for "${ct}"`).toBe(200);
        expect((res.body as PresignSuccessBody).headers["Content-Type"]).toBe(
          ct,
        );
      }
    },
    30_000,
  );

  it("rejects a disallowed application/* MIME type with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    // application/x-msdownload is a Windows executable MIME — we don't
    // accept it even though the SDK would gladly host the bytes.
    const res = await presign(c, "application/x-msdownload");
    expect(res.status).toBe(400);
    const body = res.body as ValidationErrorBody;
    expect(body.error).toMatch(/invalid presign payload/i);
    expect(body.details?.contentType?.[0]).toMatch(/allowed mime/i);
    // Negative-path proof: the route never reached the SDK.
    expect(s3MockState.calls.getSignedUrl).toHaveLength(0);
  });

  it("rejects application/javascript (out of allow-list) with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    // Even though `text/javascript` would pass via the `text/*` arm, the
    // canonical `application/javascript` MIME falls under `application/*`
    // which is gated by the explicit subtype set — and `javascript` is
    // not in it. Lock the regression in.
    const res = await presign(c, "application/javascript");
    expect(res.status).toBe(400);
    const body = res.body as ValidationErrorBody;
    expect(body.details?.contentType?.[0]).toMatch(/allowed mime/i);
  });

  it("rejects video/mp4 (entire family disallowed) with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const res = await presign(c, "video/mp4");
    expect(res.status).toBe(400);
    const body = res.body as ValidationErrorBody;
    expect(body.details?.contentType?.[0]).toMatch(/allowed mime/i);
  });

  it("rejects an empty contentType with 400 (zod min-length)", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const res = await presign(c, "");
    expect(res.status).toBe(400);
    expect((res.body as ValidationErrorBody).details?.contentType?.[0]).toBeTruthy();
  });

  it("rejects a contentType containing whitespace at the boundary", async () => {
    // Even after `.trim()`, an internal space in the MIME type breaks the
    // allow-list regex. Catch the regression here.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const res = await presign(c, "image / png");
    expect(res.status).toBe(400);
  });

  it("rejects a non-string contentType with 400", async () => {
    // The schema is `z.string()`. Passing a number forces the type-error
    // branch, which surfaces as 400 with `details.contentType` populated.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const res = await c.json<ValidationErrorBody>(
      "POST",
      "/api/attachments/presign",
      { filename: "x.png", contentType: 123, size: 1024 },
    );
    expect(res.status).toBe(400);
    expect(res.body.details?.contentType?.[0]).toBeTruthy();
  });

  it("rejects a contentType beyond 255 chars with 400", async () => {
    // The allow-list regex would also fail this, but the explicit max-
    // length guard fires earlier and produces a friendlier message. We
    // accept either error; both must yield 400.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    // Construct an (illegal) MIME-shaped string that is just over the limit.
    const longSuffix = "a".repeat(260);
    const res = await presign(c, `image/${longSuffix}`);
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Other body validation — not in the three Sub-AC headline buckets but
// adjacent enough that a regression in the schema would muddy "content-type
// validation" coverage. Lock in the size + filename guards too.
// ---------------------------------------------------------------------------

describe("POST /attachments/presign — body validation", () => {
  it("rejects a missing-fields body with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const res = await c.json<ValidationErrorBody>(
      "POST",
      "/api/attachments/presign",
      { filename: "x.png" },
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid presign payload/i);
    // `contentType` and `size` are both required → both surface in details.
    expect(res.body.details?.contentType?.[0]).toBeTruthy();
    expect(res.body.details?.size?.[0]).toBeTruthy();
  });

  it("rejects a non-JSON request body with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    // Bypass the JSON serialiser by passing a raw string — the harness
    // forwards it verbatim because typeof body === "string".
    const res = await c.json<ValidationErrorBody>(
      "POST",
      "/api/attachments/presign",
      "<<not-json>>",
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/json/i);
  });

  it("rejects an empty filename with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const res = await c.json<ValidationErrorBody>(
      "POST",
      "/api/attachments/presign",
      { filename: "", contentType: "image/png", size: 1024 },
    );
    expect(res.status).toBe(400);
    expect(res.body.details?.filename?.[0]).toBeTruthy();
  });

  it("rejects a filename longer than 255 chars with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const res = await c.json<ValidationErrorBody>(
      "POST",
      "/api/attachments/presign",
      {
        filename: "a".repeat(256) + ".png",
        contentType: "image/png",
        size: 1024,
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.details?.filename?.[0]).toMatch(/too long/i);
  });

  it("rejects size <= 0 with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    for (const bad of [0, -1, -1024]) {
      const res = await c.json<ValidationErrorBody>(
        "POST",
        "/api/attachments/presign",
        { filename: "x.png", contentType: "image/png", size: bad },
      );
      expect(res.status, `for size=${bad}`).toBe(400);
      expect(res.body.details?.size?.[0], `for size=${bad}`).toBeTruthy();
    }
  });

  it("rejects a non-integer size with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const res = await c.json<ValidationErrorBody>(
      "POST",
      "/api/attachments/presign",
      { filename: "x.png", contentType: "image/png", size: 1.5 },
    );
    expect(res.status).toBe(400);
    expect(res.body.details?.size?.[0]).toMatch(/integer/i);
  });

  it("rejects size > 25 MiB with 400", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const oversized = 25 * 1024 * 1024 + 1;
    const res = await c.json<ValidationErrorBody>(
      "POST",
      "/api/attachments/presign",
      {
        filename: "huge.bin",
        contentType: "application/octet-stream",
        size: oversized,
      },
    );
    expect(res.status).toBe(400);
    expect(res.body.details?.size?.[0]).toMatch(/exceeds/i);
  });

  it("accepts size exactly equal to the 25 MiB cap", async () => {
    // The schema says `<= 25 * 1024 * 1024`. Edge-case lock-in: the cap
    // itself is inclusive. Off-by-one regressions surface here.
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const c = authedClient(fixture);

    const exactly = 25 * 1024 * 1024;
    const res = await c.json<PresignSuccessBody>(
      "POST",
      "/api/attachments/presign",
      {
        filename: "max.bin",
        contentType: "application/octet-stream",
        size: exactly,
      },
    );
    expect(res.status).toBe(200);
    expect(res.body.headers["Content-Length"]).toBe(String(exactly));
  });
});
