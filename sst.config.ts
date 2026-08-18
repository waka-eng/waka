/// <reference path="./.sst/platform/config.d.ts" />

/**
 * SST v3 (Ion) application config.
 *
 * Responsibilities of this file (and only this file):
 *   - Declare SST Secrets for every credential the API needs at runtime.
 *     These are `sst secret set` -driven values, never committed, and only
 *     ever materialised inside the Lambda execution environment via the
 *     `link` mechanism below.
 *   - Stand up the runtime resources: a Bucket for attachment uploads, a
 *     Hono Function for the API, and a StaticSite for the Vite/React frontend.
 *   - Wire the Function's environment via `link` so the Hono handler can
 *     read each secret through `Resource.<name>.value` (or the matching
 *     uppercase env var SST injects automatically).
 *
 * Secrets bound to the Hono API Lambda
 * ------------------------------------
 *   GoogleClientId     → Google OAuth client id        (was AUTH_GOOGLE_ID)
 *   GoogleClientSecret → Google OAuth client secret    (was AUTH_GOOGLE_SECRET)
 *   SessionSecret      → cookie/session signing key    (was AUTH_SECRET)
 *   JwtSecret          → JWT signing key               (was JWT_SECRET)
 *   DbConnectionUrl    → Neon Postgres URL             (was DB_CONNECTION_URL)
 *   GeminiApiKey       → Gemini classifier key         (was GEMINI_API_KEY)
 *
 * Local dev workflow
 * ------------------
 *   1. One-time, per-stage:
 *        pnpm sst secret set GoogleClientId      "$AUTH_GOOGLE_ID"
 *        pnpm sst secret set GoogleClientSecret  "$AUTH_GOOGLE_SECRET"
 *        pnpm sst secret set SessionSecret       "$AUTH_SECRET"
 *        pnpm sst secret set JwtSecret           "$JWT_SECRET"
 *        pnpm sst secret set DbConnectionUrl     "$DB_CONNECTION_URL"
 *        pnpm sst secret set GeminiApiKey        "$GEMINI_API_KEY"
 *      (See docs/google-oauth-setup.md for how to provision the Google
 *      client id / secret in Google Cloud Console with the correct
 *      authorized redirect URIs for `sst dev`.)
 *
 *   2. `pnpm dev` (alias for `sst dev`) starts the StaticSite, the API
 *      Function URL, and the Bucket. The Function picks up each linked secret
 *      through `Resource.<name>.value` at request time.
 *
 * Why SST Secrets and not plain `environment: { ... }`?
 *   - Secrets are encrypted at rest in SSM Parameter Store, never end up in
 *     the CloudFormation template, and can be rotated without redeploying
 *     code. Plain `environment` values are visible to anyone with read
 *     access to the Lambda config.
 *   - `link` produces a typed `Resource` import the handler can rely on, so
 *     "did I spell the env var right?" becomes a compile error rather than
 *     a runtime 500.
 */

/**
 * AWS region the stack runs in. Pulled out as a module-scope constant so
 * the `app.providers.aws.region` declaration and the Lambda's
 * `ATTACHMENTS_REGION` env var (Sub-AC 3.4) can never drift apart — the
 * region the bucket is created in MUST match the region the SDK signs
 * presigned URLs against, otherwise SigV4 fails with a redirect / 301
 * "PermanentRedirect" at PUT time.
 */
const AWS_REGION = "us-west-2";
const PUBLIC_DOMAINS: Partial<Record<string, string>> = {
  development: "dev.waka.im",
  dev: "dev.waka.im",
  production: "waka.im",
};
const WAKA_CERT_ARN =
  "arn:aws:acm:us-east-1:182498323408:certificate/742541cb-5e84-4d88-9e5b-d2695f92df12";

export default $config({
  app(input) {
    return {
      name: "waka",
      // `removal: "remove"` for non-production stages so torn-down sandboxes
      // don't leave orphan AWS resources behind. Production (when it lands)
      // should be flipped to "retain".
      removal: input?.stage === "production" ? "retain" : "remove",
      home: "aws",
      providers: {
        aws: {
          // us-west-2 matches AWS_REGION_APP in .env so the dev S3 bucket
          // lives next to any future production bucket. Override per-stage
          // by editing AWS_REGION above and re-running `sst deploy`.
          region: AWS_REGION,
        },
      },
    };
  },

  async run() {
    // -----------------------------------------------------------------------
    // Secrets
    //
    // Each secret is created once at deploy time and managed via the
    // `sst secret set` CLI. The values committed to .env are NOT used at
    // runtime — they are only there to seed local CLI commands and the
    // drizzle-kit migration runner (which reads DB_CONNECTION_URL directly
    // from .env to keep migrations decoupled from the SST stack).
    // -----------------------------------------------------------------------

    /** Google OAuth 2.0 client id from Google Cloud Console. */
    const googleClientId = new sst.Secret("GoogleClientId");

    /** Google OAuth 2.0 client secret. NEVER returned to the browser. */
    const googleClientSecret = new sst.Secret("GoogleClientSecret");

    /**
     * Session signing/encryption secret. Used to sign the OpenAuth session
     * cookie. Distinct from JwtSecret so we can rotate one without nuking
     * already-issued JWT bearer tokens (or vice versa).
     */
    const sessionSecret = new sst.Secret("SessionSecret");

    /** JWT signing key used by `lib/auth.ts:signSessionToken`. */
    const jwtSecret = new sst.Secret("JwtSecret");

    /** Neon Postgres connection URL (pooled, sslmode=require). */
    const dbConnectionUrl = new sst.Secret("DbConnectionUrl");

    /** Gemini API key for the classifier queue worker. */
    const geminiApiKey = new sst.Secret("GeminiApiKey");

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    /**
     * Attachment bucket. Frontend uploads via presigned PUT; the API never
     * proxies bytes. Public read is *not* enabled — downloads will use
     * presigned GET URLs scoped to the authenticated user.
     *
     * CORS wiring (Sub-AC 3.4)
     * ------------------------
     * The browser PUTs directly to the bucket's regional virtual-hosted URL
     * (`https://<bucket>.s3.<region>.amazonaws.com/<key>`) using the URL
     * minted by `POST /attachments/presign`. That counts as a cross-origin
     * request from the StaticSite origin (`http://localhost:5173` in dev,
     * the CloudFront distribution in any future prod), so we need explicit
     * S3 CORS rules — without them every preflight OPTIONS fails and the
     * upload never leaves the browser.
     *
     * We allow `*` for origins because:
     *   - The bucket has no public read; the only writable surface is a
     *     short-lived (5 min), narrowly-scoped SigV4 PUT URL whose signature
     *     pins Content-Type, Content-Length, key, and method.
     *   - A relaxed CORS policy on a private, signature-gated bucket cannot
     *     be abused: a different origin can only succeed at PUTting if it
     *     was already handed a valid presigned URL by our Lambda, which
     *     requires a valid session.
     *   - Pinning to a specific origin would mean re-deploying SST every
     *     time the dev StaticSite URL changes (and every `sst dev` run can
     *     mint a fresh one).
     *
     * `exposeHeaders: ["ETag"]` lets the SPA read the upload's ETag back
     * from the PUT response, which is useful if we ever want to fingerprint
     * the object client-side before calling `POST /api/attachments`.
     */
    const attachmentsBucket = new sst.aws.Bucket("Attachments", {
      cors: {
        allowOrigins: ["*"],
        allowHeaders: ["*"],
        allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE"],
        exposeHeaders: ["ETag"],
        maxAge: "1 hour",
      },
    });

    /**
     * Vault bucket. User-meaning YAML documents live here as the source of
     * truth; the Postgres `documents` table is a rebuildable index over this
     * prefix.
     */
    const vaultBucket = new sst.aws.Bucket("Vault");

    // -----------------------------------------------------------------------
    // Hono API Function
    //
    // The `link` array is the security boundary. Anything in here is
    // available to the handler via `Resource.<Name>.value`; anything not in
    // here is unreachable. That means a future engineer cannot accidentally
    // leak GeminiApiKey to the public StaticSite — they would have to add
    // it to a `link` here first, which shows up in code review.
    // -----------------------------------------------------------------------

    /**
     * IAM wiring for S3 presigned PUT (Sub-AC 3.4)
     * --------------------------------------------
     * Linking `attachmentsBucket` here does two things:
     *   1. Generates the typed `Resource.Attachments.{name,arn}` binding
     *      so handler code can resolve the bucket without hard-coding it.
     *   2. Attaches an IAM policy to the Lambda's execution role granting
     *      `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, and
     *      `s3:ListBucket` scoped to this bucket only.
     *
     * That last point is what lets `getSignedUrl` actually mint a working
     * URL: SigV4 signing is local, but the *signing identity* is the
     * Lambda role, and S3 will reject the upload at PUT time if the role
     * is not authorized to PutObject on the bucket. A common failure mode
     * before this link existed was "presign returns 200, browser PUT
     * returns 403 SignatureDoesNotMatch / AccessDenied" — the signature
     * was fine, the role just had no permission.
     *
     */
    const publicDomain = PUBLIC_DOMAINS[$app.stage];
    const publicWebUrl = publicDomain ? `https://${publicDomain}` : undefined;
    const publicApiUrl = publicWebUrl;
    const isDevelopmentDomain = $app.stage === "development" || $app.stage === "dev";
    const runtimeLinks = [
      googleClientId,
      googleClientSecret,
      sessionSecret,
      jwtSecret,
      dbConnectionUrl,
      geminiApiKey,
      attachmentsBucket,
      vaultBucket,
    ];
    const runtimeEnvironment = {
      AUTH_GOOGLE_ID: googleClientId.value,
      AUTH_GOOGLE_SECRET: googleClientSecret.value,
      AUTH_SECRET: sessionSecret.value,
      JWT_SECRET: jwtSecret.value,
      DB_CONNECTION_URL: dbConnectionUrl.value,
      GEMINI_API_KEY: geminiApiKey.value,
      ATTACHMENTS_BUCKET: attachmentsBucket.name,
      ATTACHMENTS_REGION: AWS_REGION,
      WAKA_VAULT_BUCKET: vaultBucket.name,
      WAKA_VAULT_PREFIX: "vault/",
      WAKA_VAULT_REGION: AWS_REGION,
      ...(publicApiUrl ? { PUBLIC_API_URL: publicApiUrl } : {}),
      ...(publicWebUrl ? { PUBLIC_WEB_URL: publicWebUrl } : {}),
      ...(isDevelopmentDomain
        ? {
            WAKA_ENABLE_ADMIN_ROUTES: "true",
            WAKA_SHOW_INTERNAL_STATUS: "true",
            WAKA_ENABLE_BACKGROUND_JOBS_ADMIN: "true",
          }
        : {}),
    };

    const router = publicDomain
      ? new sst.aws.Router("Router", {
          domain: {
            name: publicDomain,
            // Route53 already has live waka.im/dev.waka.im records from the
            // legacy CloudFront distributions. Let SST attach the CloudFront
            // alias using the existing ACM cert, then manually UPSERT
            // Route53 after deployment to avoid unmanaged-record conflicts.
            dns: false,
            cert: WAKA_CERT_ARN,
          },
        })
      : undefined;

    /**
     * The background worker, defined before the API so the API can hold a
     * reference to it.
     *
     * Work is *pushed* here: enqueueing wakes this function directly, so a
     * capture starts deriving in the same second rather than waiting for the
     * next sweep. The cron below is only a safety net, which is what lets it
     * run daily instead of every minute — and a queue nobody is polling is a
     * database that can go to sleep.
     */
    const backgroundWorker = new sst.aws.Function("BackgroundWorker", {
      handler: "packages/api/src/background-worker.handler",
      timeout: "14 minutes",
      link: runtimeLinks,
      environment: {
        ...runtimeEnvironment,
        WAKA_BACKGROUND_JOB_CRON_LIMIT: "25",
      },
    });

    const api = new sst.aws.Function("Api", {
      handler: "packages/api/src/lambda.handler",
      url: router
        ? {
            router: {
              instance: router,
              path: "/api",
              /**
               * Never cache an API response at the edge.
               *
               * Every response is scoped to one session's profile, so two
               * callers asking the same URL are owed different answers. The
               * default distribution behaviour keys on the URL and does not
               * vary on `Authorization`, which on the deployed stage served a
               * non-member's 404 for a group wall back to that group's owner
               * — and would, in the other order, have served a member's wall
               * to someone who never joined.
               *
               * The API also sends `Cache-Control: no-store`; this is the
               * half that does not depend on the distribution choosing to
               * honour an origin header.
               *
               * `4135ea2d-…` is AWS's managed **CachingDisabled** policy.
               */
              cachePolicy: "4135ea2d-6df8-44a3-9df3-4b5a84be39ad",
            },
          }
        : true,
      link: runtimeLinks,
      // Fallback environment names so the existing Hono code that reads
      // `process.env.JWT_SECRET` / `process.env.DB_CONNECTION_URL` keeps
      // working without a refactor. SST also exposes the same values as
      // `Resource.<Name>.value` for new code paths.
      //
      // ATTACHMENTS_BUCKET / ATTACHMENTS_REGION are exposed explicitly
      // (Sub-AC 3.4) so the presign route in `packages/api/src/routes/
      // attachments.ts` can resolve the bucket name and region without
      // depending on SST's auto-injected `SST_RESOURCE_Attachments` JSON
      // env var. That keeps the handler unit-testable outside Lambda
      // (vitest / smoke runs) where the SST env is not present.
      environment: {
        ...runtimeEnvironment,
        // Which function to wake when work is enqueued. Absent (local, tests)
        // means the in-process drain owns it instead.
        WAKA_BACKGROUND_WORKER_FUNCTION: backgroundWorker.name,
      },
      // Waking the worker is the whole point of the push model; without this
      // the invoke fails and every job waits for the daily safety net.
      permissions: [
        {
          actions: ["lambda:InvokeFunction"],
          resources: [backgroundWorker.arn],
        },
      ],
      // Group readings are bounded but intentionally synthesize across
      // several members and can take longer than Lambda's short default on a
      // cold or first/backfill pass. The browser keeps an explicit reading
      // state visible for this request.
      timeout: "60 seconds",
    });

    /**
     * The safety net, not the mechanism.
     *
     * Everything normal is pushed: the API wakes the worker on enqueue, and
     * the worker drains until the queue is dry, so the derive → synthesize
     * chain completes in one invocation. What is left for a sweep is only the
     * error path — a job whose backoff outlived its invocation, a row locked
     * by a worker that died, an enqueue whose wake-up call itself failed.
     *
     * Daily rather than every minute because a minute-by-minute poll is a
     * query every minute forever, which keeps a serverless Postgres awake
     * around the clock for an app that is idle most of it. Cost aside, the
     * poll was also *slower* than pushing: it added up to a minute before a
     * capture began deriving.
     */
    new sst.aws.Cron("BackgroundJobDrain", {
      schedule: "rate(1 day)",
      enabled: true,
      function: backgroundWorker.arn,
    });

    // -----------------------------------------------------------------------
    // Frontend (Vite + React)
    // -----------------------------------------------------------------------

    const web = new sst.aws.StaticSite("Web", {
      path: "packages/web",
      ...(router
        ? {
            router: {
              instance: router,
            },
          }
        : {}),
      build: {
        command: "pnpm build",
        output: "dist",
      },
      environment: {
        // Vite inlines anything prefixed VITE_ at build time. We expose only
        // the API URL — never any secret — so the SPA can talk to the
        // Function URL without hard-coding a value.
        VITE_API_URL: publicDomain ? "" : api.url,
      },
      dev: {
        command: "pnpm --filter @waka/web dev",
      },
    });

    return {
      apiUrl: api.url,
      webUrl: web.url,
      attachmentsBucket: attachmentsBucket.name,
      vaultBucket: vaultBucket.name,
    };
  },
});
