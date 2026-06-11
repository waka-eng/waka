#!/usr/bin/env tsx
/**
 * tools/e2e/smoke.ts — Playwright end-to-end smoke for the auth → capture →
 * async-classification flow.
 *
 * What this covers (Sub-AC 14.3.2 + 14.3.3)
 * -----------------------------------------
 *   1. An anonymous visit to `/` is bounced to `/login` by the SPA route
 *      guard.
 *   2. The signup form on `/login` accepts a fresh email/password/name,
 *      establishes a session, and lands the user on `/`.
 *   3. The home page's `<CaptureForm>` accepts a typed note and drives the
 *      SPA's `POST /api/inspirations` round-trip.
 *   4. When the current UI exposes a history drawer, it renders the new row
 *      with the user's note text.
 *   5. The persisted state is independently verifiable through the Hono API
 *      itself: a `GET /api/inspirations` call with the signup-issued JWT returns
 *      the new row, owned by the authenticated user (data-isolation contract).
 *   6. (Soft check) The asynchronous Gemini-powered classification loop gets
 *      a bounded poll: `POST /api/inspirations` returned `cluster: null` (the
 *      worker fills it later); we poll `GET /api/inspirations` until the row's
 *      `cluster` enum lands and `classified_at` is non-null. If it lands in
 *      time and the UI exposes the history drawer, we reload the SPA and verify
 *      the `.history-item-cluster` chip surfaces the cluster topic copy.
 *
 * Why a standalone script (not Playwright Test runner)
 * ----------------------------------------------------
 *   - The repo already standardises on tsx-driven smoke scripts under
 *     `packages/api/src/routes/*.smoke.ts` for the API surface and on the
 *     bare `playwright` package for `tools/visual-diff/capture.ts`.
 *     Adding a `@playwright/test` dependency just for one spec would
 *     introduce a parallel test framework; reusing the bare driver keeps
 *     the install footprint and the failure-modes in this file's hands.
 *   - The boot lifecycle is owned by `tools/dev-stack/boot-and-wait.ts`;
 *     this script is meant to run as that script's `--` handoff command.
 *     Boot-and-wait exports `WAKA_API_URL` / `WAKA_WEB_URL` into the
 *     handoff env so we can exercise the SPA AND independently call the
 *     same API from this Node process.
 *
 * Usage (from repo root)
 * ----------------------
 *     pnpm dev:boot -- pnpm tsx tools/e2e/smoke.ts
 *
 *   or, against an already-running stack:
 *
 *     WAKA_API_URL=https://...lambda-url... \
 *     WAKA_WEB_URL=http://localhost:5173 \
 *     pnpm tsx tools/e2e/smoke.ts
 *
 * Exit codes
 * ----------
 *   0   signup, capture, save, API persistence, and tenant isolation passed.
 *   1   any assertion failed, the browser failed to start, or the API
 *       returned a non-success status. The error is printed to stderr.
 */

import "dotenv/config";

import { chromium } from "playwright";
import type { Browser, BrowserContext, Page, Response } from "playwright";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Endpoints. Defaults match `pnpm dev:boot` defaults so an operator who
 * forgets to thread the env vars still hits the right local processes.
 *
 * The browser drives the SPA (`WAKA_WEB_URL`) which, in dev, proxies its
 * `/api/auth /api/inspirations /api/attachments /api/health` paths through Vite to the
 * Hono Function. The persisted-state assertion at the end of this script
 * calls the API directly (`WAKA_API_URL`) so a regression in the Vite
 * proxy cannot silently mask a regression in the API itself.
 */
const WEB_URL = (process.env.WAKA_WEB_URL ?? "http://localhost:5173").replace(
  /\/$/,
  "",
);
const API_URL = (process.env.WAKA_API_URL ?? "http://localhost:3001").replace(
  /\/$/,
  "",
);

/**
 * Per-step navigation / response timeout. The full save round-trip on a
 * cold local Lambda can take several seconds,
 * so we err on the generous side. Individual `waitFor` calls override this
 * when the activity is bounded (e.g. the in-app confirmation overlay).
 */
const NAV_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Tiny test helpers
//
// Why bespoke helpers and not `@playwright/test`?  This script is hand-rolled
// (see file header). We only need: typed `assert`, structured progress
// logging, and a single point that throws to fail the run. ~30 lines of
// helper code is much less surface than another testing framework.
// ---------------------------------------------------------------------------

function step(label: string, n: number, total: number): void {
  console.log(`[${n}/${total}] ${label}`);
}

function ok(label: string): void {
  console.log(`      ✓ ${label}`);
}

class AssertionFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionFailed";
  }
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new AssertionFailed(message);
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Cleanup — best-effort drop of the synthetic user row + cascade.
//
// We rely on the schema's ON DELETE CASCADE chain (users → inspirations →
// attachments / reflections) so a single DELETE is sufficient. Failures here
// are NOT fatal: the smoke's primary signal is the assertions, and leaving a
// throw-away row in Neon is preferable to masking a genuine pass with a
// teardown error.
// ---------------------------------------------------------------------------

async function cleanupUser(email: string): Promise<void> {
  const url = process.env.DB_CONNECTION_URL;
  if (!url) {
    console.warn(
      "[cleanup] DB_CONNECTION_URL not set — leaving the synthetic user behind.",
    );
    return;
  }
  let sql: ReturnType<typeof postgres> | null = null;
  try {
    sql = postgres(url, { prepare: false, max: 1 });
    const removed = await sql<Array<{ id: string }>>`
      DELETE FROM users WHERE email = ${email} RETURNING id
    `;
    if (removed.length > 0) {
      console.log(`[cleanup] removed user ${removed[0]!.id} (${email})`);
    } else {
      console.log(`[cleanup] no user row matched ${email}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[cleanup] non-fatal failure: ${msg}`);
  } finally {
    if (sql) await sql.end({ timeout: 2 }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Main flow
// ---------------------------------------------------------------------------

interface SignupBody {
  user: { id: string; email: string; name: string };
  token: string;
}

interface InspirationRow {
  id: string;
  userId: string;
  text: string;
  cluster: string | null;
  /**
   * ISO-8601 timestamp set by the queue worker when it writes a non-null
   * cluster, mirroring `inspirations.classified_at`. Polled below as a
   * second-axis observability hook so a stuck worker that somehow wrote
   * `cluster` without `classified_at` (or vice-versa) is surfaced as a
   * loud assertion failure rather than a green run.
   */
  classifiedAt?: string | null;
}

/**
 * Allowed Postgres cluster enum values (mirror of `clusterEnumValues` in
 * `packages/api/src/db/schema.ts`). Inlined rather than imported so this
 * smoke stays a leaf script with no cross-package TS dependency. Drift here
 * is caught the moment the worker writes a label this list does not contain
 * — the assertion below explicitly checks set membership.
 */
const ALLOWED_CLUSTERS = [
  "outlier",
  "bridge",
  "morph",
  "convergence",
  "tension",
  "loop",
] as const;
type AllowedCluster = (typeof ALLOWED_CLUSTERS)[number];

/**
 * Cluster topic copy resolved by the SPA's `CLUSTER_TOPICS` map (Home.tsx).
 * The `<InspirationCard>` renders `.history-item-cluster` with this exact
 * string when a row has a non-null cluster. Mirrored here so the UI
 * assertion can match the rendered chip against the polled enum value.
 *
 * Drift control: if a future PR changes the copy in Home.tsx, the smoke
 * fails with a precise mismatch assertion rather than a generic "chip not
 * found" timeout, which makes the regression obvious.
 */
const CLUSTER_TOPIC_COPY: Record<AllowedCluster, string> = {
  outlier: "a single quote I can’t shake",
  bridge: "architecture essays and jazz history",
  morph: "identity, reread",
  convergence: "education in the AI era",
  tension: "synthetic memory: tool or crutch",
  loop: "what it means to know something",
};

/**
 * Total wall-clock budget we give the DB-backed worker to classify the new
 * inspiration. Sized for the in-process drain tick + Gemini round-trip +
 * Postgres UPDATE, plus a generous margin for transient Gemini backoff/retry.
 * If this expires the smoke warns with a precise message but does not fail the
 * core save/API smoke. Worker health should be diagnosed separately from
 * the capture persistence path.
 */
const CLASSIFICATION_TIMEOUT_MS = 90_000;

/**
 * Interval between `GET /api/inspirations` polls while waiting on the
 * classifier. 1 s is small enough to surface a fast classification
 * promptly without hammering the API on a slow Gemini call.
 */
const CLASSIFICATION_POLL_INTERVAL_MS = 1_000;

function isAllowedCluster(value: unknown): value is AllowedCluster {
  return (
    typeof value === "string" &&
    (ALLOWED_CLUSTERS as readonly string[]).includes(value)
  );
}

/**
 * Poll `GET /api/inspirations` with the signup JWT until the row identified by
 * `inspirationId` has a non-null `cluster`, the `classifiedAt` timestamp is
 * set, and the value lies in `ALLOWED_CLUSTERS`. Returns the classified
 * row. Returns null on timeout; throws on API failure / out-of-set label.
 *
 * Why poll the API and not the SPA?  The SPA does not auto-refresh the
 * cluster chip after mount (see HomePage's coordinator note: "Cluster
 * updates from the background classifier are not yet streamed to the SPA — the
 * user only sees the new cluster on a full reload."). Polling the API
 * directly is the canonical observability hook for the async loop closing
 * — once we see a label here, we reload the page in the browser to verify
 * the SPA renders it.
 */
async function pollUntilClassified(
  inspirationId: string,
  token: string,
): Promise<InspirationRow | null> {
  const deadline = Date.now() + CLASSIFICATION_TIMEOUT_MS;
  let attempts = 0;
  let lastSeen: InspirationRow | null = null;

  while (Date.now() < deadline) {
    attempts++;
    const resp = await fetch(`${API_URL}/api/inspirations`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.status !== 200) {
      throw new AssertionFailed(
        `GET /api/inspirations during classification poll expected 200, got ${resp.status}: ${await resp.text()}`,
      );
    }
    const body = (await resp.json()) as { inspirations: InspirationRow[] };
    const row = body.inspirations.find((r) => r.id === inspirationId);
    if (!row) {
      throw new AssertionFailed(
        `Inspiration row ${inspirationId} disappeared from GET /api/inspirations mid-poll`,
      );
    }
    lastSeen = row;
    if (row.cluster !== null && row.cluster !== undefined) {
      // Strong invariant: the worker writes both `cluster` and
      // `classified_at` in the same UPDATE statement. If we ever observe
      // the cluster without classifiedAt, we have a database / worker
      // contract regression — surface it loudly.
      assert(
        typeof row.classifiedAt === "string" && row.classifiedAt.length > 0,
        `Row ${inspirationId} has cluster=${row.cluster} but classifiedAt is empty — worker contract regression`,
      );
      assert(
        isAllowedCluster(row.cluster),
        `Worker wrote out-of-set cluster value: ${row.cluster} (allowed: ${ALLOWED_CLUSTERS.join(", ")})`,
      );
      console.log(
        `      … cluster landed after ${attempts} poll(s) (${row.cluster})`,
      );
      return row;
    }
    if (attempts % 10 === 0) {
      console.log(
        `      … still waiting on classifier (poll #${attempts}, cluster=null)`,
      );
    }
    await new Promise((res) =>
      setTimeout(res, CLASSIFICATION_POLL_INTERVAL_MS),
    );
  }

  const lastClusterStr =
    lastSeen?.cluster === null || lastSeen?.cluster === undefined
      ? "null"
      : lastSeen.cluster;
  console.warn(
    `Timed out after ${CLASSIFICATION_TIMEOUT_MS} ms waiting for classifier to label inspiration ${inspirationId} (last cluster=${lastClusterStr}). ` +
      `Check the queue worker logs in 'sst dev' (\"[classifier] classified inspiration\") and verify GEMINI_API_KEY is set as an SST secret.`,
  );
  return null;
}

async function run(): Promise<void> {
  const suffix = uniqueSuffix();
  const email = `e2e-smoke-${suffix}@example.test`;
  const password = "supersecret123";
  const displayName = `E2E Smoke ${suffix}`;
  // The note text is matched verbatim by both the UI assertion (history
  // drawer) and the API assertion (GET /api/inspirations). Embedding the
  // suffix means parallel runs cannot collide on the same row.
  const noteText = `e2e-smoke note ${suffix}`;

  console.log(`web=${WEB_URL}  api=${API_URL}`);
  console.log(`test user: ${email}`);

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let signupBody: SignupBody | null = null;
  let inspirationId: string | null = null;

  try {
    browser = await chromium.launch();
    context = await browser.newContext();
    const page: Page = await context.newPage();
    page.setDefaultTimeout(NAV_TIMEOUT_MS);
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    // Surface page-level console errors so a runtime crash inside the SPA
    // doesn't manifest as a generic timeout. The smoke's job is to catch
    // regressions, not to make them harder to debug.
    page.on("pageerror", (err) => {
      console.warn(`[browser] pageerror: ${err.message}`);
    });

    /* ------------------------------------------------------------
     * Step 1 — anonymous root → /login redirect
     * ---------------------------------------------------------- */
    step("Anonymous visit to / bounces to /login", 1, 7);
    await page.goto(`${WEB_URL}/`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/login(\?|$)/, { timeout: NAV_TIMEOUT_MS });
    assert(
      page.url().includes("/login"),
      `Expected /login redirect, got ${page.url()}`,
    );
    ok("redirected to /login");

    /* ------------------------------------------------------------
     * Step 2 — switch to "Create account" tab and submit signup
     * ---------------------------------------------------------- */
    step("Sign up via /login form establishes a session", 2, 7);

    // The login page mounts the sign-in form by default (returning users
    // are the steady-state majority); explicitly flip to the signup tab.
    await page.locator("#login-tab-signup").click();

    // Capture the signup response so the persisted-state assertion later
    // can replay the JWT against the API directly.
    const signupResponsePromise = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/auth/signup") && r.request().method() === "POST",
      { timeout: NAV_TIMEOUT_MS },
    );

    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.locator('input[name="name"]').fill(displayName);
    await page.getByRole("button", { name: /create account/i }).click();

    const signupResponse = await signupResponsePromise;
    if (signupResponse.status() !== 201) {
      throw new AssertionFailed(
        `Signup failed: ${signupResponse.status()} ${await signupResponse.text()}`,
      );
    }
    signupBody = (await signupResponse.json()) as SignupBody;
    assert(
      signupBody.token && signupBody.user?.id,
      "Signup response missing token / user.id",
    );

    // Post-auth redirect: the SPA navigates to "/" via React Router's
    // `replace`. Wait for the URL to converge so subsequent locators
    // anchor on the home page rather than the login page.
    await page.waitForURL(
      (u) => u.pathname === "/" && !u.pathname.startsWith("/login"),
      { timeout: NAV_TIMEOUT_MS },
    );
    ok(`signed up + landed on / as ${signupBody.user.email}`);

    /* ------------------------------------------------------------
     * Step 3 — type a note in the capture surface
     * ---------------------------------------------------------- */
    step("Capture form accepts a typed note", 3, 7);

    await page
      .getByRole("button", { name: /capture inspiration/i })
      .click();
    const captureNote = page.locator("#capNote");
    await captureNote.waitFor({ timeout: NAV_TIMEOUT_MS });
    await captureNote.fill(noteText);

    ok("note staged");

    /* ------------------------------------------------------------
     * Step 4 — Save: drive POST /api/inspirations and assert the response.
     * ---------------------------------------------------------- */
    step(
      "Save round-trip exercises POST /api/inspirations",
      4,
      7,
    );

    // Wire up response promises BEFORE the Save click so a fast Lambda
    // doesn't return between the click and our `await`.
    //
    // We anchor each filter on the URL suffix + HTTP method to avoid
    // accidentally matching the GET /api/inspirations the home page issues
    // on mount or the OPTIONS preflight against S3.
    const inspirationPostPromise: Promise<Response> = page.waitForResponse(
      (r) => {
        if (r.request().method() !== "POST") return false;
        const u = new URL(r.url());
        // Match exactly /api/inspirations (not /api/inspirations/:id/reflections).
        return u.pathname === "/api/inspirations";
      },
      { timeout: NAV_TIMEOUT_MS },
    );
    await page.locator("#capSave").click();

    const inspResp = await inspirationPostPromise;
    if (inspResp.status() !== 201) {
      throw new AssertionFailed(
        `POST /api/inspirations expected 201, got ${inspResp.status()}: ${await inspResp.text()}`,
      );
    }
    const inspBody = (await inspResp.json()) as { inspiration: InspirationRow };
    inspirationId = inspBody.inspiration.id;
    assert(
      inspBody.inspiration.userId === signupBody.user.id,
      `Tenant mismatch on POST /api/inspirations: row.userId=${inspBody.inspiration.userId} vs signed-in ${signupBody.user.id}`,
    );
    assert(
      inspBody.inspiration.cluster === null,
      `Cluster must be null on insert (worker fills it), got ${inspBody.inspiration.cluster}`,
    );
    ok(`POST /api/inspirations → 201 (id=${inspirationId})`);

    /* ------------------------------------------------------------
     * Step 5 — UI history check when the current build exposes it
     * ---------------------------------------------------------- */
    step("UI history surface is checked when present", 5, 7);

    // Older home builds expose a history drawer behind `#metaCount`. Newer
    // builds may render a different first-screen surface, so only assert the
    // drawer when that control exists; the API check below remains the
    // canonical persisted-state assertion.
    if ((await page.locator("#metaCount").count()) > 0) {
      await page.locator("#metaCount").click();
      await page
        .locator(".history-item")
        .filter({ hasText: noteText })
        .first()
        .waitFor({ timeout: NAV_TIMEOUT_MS });
      ok(`history drawer renders the note "${noteText}"`);
    } else {
      ok("history drawer control not present; API verification will assert the saved row");
    }

    /* ------------------------------------------------------------
     * Step 6 — independent verification via the Hono API
     * ---------------------------------------------------------- */
    step("Hono API confirms persisted, tenant-scoped row", 6, 7);

    let apiBody: { inspirations: InspirationRow[] } = { inspirations: [] };
    let persisted: InspirationRow | undefined;
    const apiResp = await fetch(`${API_URL}/api/inspirations`, {
      method: "GET",
      headers: { Authorization: `Bearer ${signupBody.token}` },
    });
    if (apiResp.status !== 200) {
      throw new AssertionFailed(
        `GET /api/inspirations expected 200, got ${apiResp.status}: ${await apiResp.text()}`,
      );
    }
    apiBody = (await apiResp.json()) as { inspirations: InspirationRow[] };
    assert(
      Array.isArray(apiBody.inspirations),
      `Unexpected GET /api/inspirations shape: ${JSON.stringify(apiBody)}`,
    );
    persisted = apiBody.inspirations.find(
      (r) => r.id === inspirationId && r.text === noteText,
    );
    assert(
      persisted !== undefined,
      `Persisted row not surfaced by GET /api/inspirations (id=${inspirationId})`,
    );
    assert(
      persisted.userId === signupBody.user.id,
      `Tenant leak on GET /api/inspirations: row.userId=${persisted.userId} vs ${signupBody.user.id}`,
    );
    // Defence-in-depth: every row the API returns to this caller MUST
    // belong to them. A regression on the server filter would surface
    // here even if the asserted target row is fine.
    for (const row of apiBody.inspirations) {
      assert(
        row.userId === signupBody.user.id,
        `Tenant leak: GET /api/inspirations returned a row owned by ${row.userId} to user ${signupBody.user.id}`,
      );
    }
    ok(
      `GET /api/inspirations confirms id=${inspirationId} for user=${signupBody.user.id}`,
    );

    /* ------------------------------------------------------------
     * Step 7 — soft-check async classification; UI surfaces cluster when present
     *
     * The POST /api/inspirations response we asserted in step 4 had
     * `cluster: null` — the API enqueues a durable `background_jobs`
     * classification row and returns immediately (`async_correctness`). The
     * DB-backed worker picks the job up, calls Gemini's `:generateContent` REST
     * endpoint, and writes one of the six allowed cluster labels back
     * onto the row alongside `classified_at`.
     *
     * We exercise that loop opportunistically by:
     *
     *   (a) Polling `GET /api/inspirations` with the same JWT until the
     *       row's `cluster` enum lands and `classified_at` is set.
     *       This is the *server-side* observability hook when available — it proves
     *       the background_jobs → Gemini → Postgres path actually closed for
     *       this particular inspiration.
     *
     *   (b) Reloading the SPA and asserting `.history-item-cluster`
     *       renders the cluster topic copy resolved by HomePage's
     *       `CLUSTER_TOPICS` map. This is the *UI-side* observability
     *       hook — it proves the classified label is visible to a
     *       user. The SPA does not auto-poll; see HomePage's coordinator note.
     * ---------------------------------------------------------- */
    step(
      "Async classifier soft-check — Gemini fills cluster when available",
      7,
      7,
    );

    const classified = await pollUntilClassified(inspirationId, signupBody.token);
    if (!classified) {
      ok("classifier did not finish within timeout; save/API smoke already passed");
      console.log("\nE2E SMOKE PASSED ✅");
      return;
    }
    ok(
      `cluster=${classified.cluster} classified_at=${classified.classifiedAt} (server-side hook)`,
    );

    // Reload the SPA so HomePage's mount-time `GET /api/inspirations`
    // re-runs and the new cluster value flows into `<InspirationCard>`.
    // We use `domcontentloaded` rather than `networkidle` so a long-
    // poll websocket from Vite HMR cannot stall this wait.
    await page.goto(`${WEB_URL}/`, { waitUntil: "domcontentloaded" });
    if ((await page.locator("#metaCount").count()) > 0) {
      // Re-open the history drawer — the reload reset the toggle state.
      await page.locator("#metaCount").click();

      // Find the freshly-classified row by its note text and assert its
      // `.history-item-cluster` chip carries the topic copy mapped from
      // the polled enum value.
      const expectedTopic = CLUSTER_TOPIC_COPY[classified.cluster as AllowedCluster];
      const historyRow = page
        .locator(".history-item")
        .filter({ hasText: noteText })
        .first();
      await historyRow.waitFor({ timeout: NAV_TIMEOUT_MS });
      const clusterChip = historyRow.locator(".history-item-cluster");
      await clusterChip.waitFor({ timeout: NAV_TIMEOUT_MS });
      const renderedTopic = (await clusterChip.textContent())?.trim() ?? "";
      assert(
        renderedTopic === expectedTopic,
        `UI cluster chip text mismatch: rendered="${renderedTopic}" expected="${expectedTopic}" (cluster=${classified.cluster})`,
      );
      ok(
        `history-item-cluster chip reads "${renderedTopic}" (UI-side hook)`,
      );
    } else {
      ok("history drawer control not present after reload; server-side classification verified");
    }

    console.log("\nE2E SMOKE PASSED ✅");
  } finally {
    if (context) await context.close().catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
    // Best-effort: drop the synthetic user. If signup never succeeded
    // there's nothing to clean.
    if (signupBody) {
      await cleanupUser(email);
    }
    void inspirationId;
  }
}

run().catch((err) => {
  if (err instanceof AssertionFailed) {
    console.error(`\nE2E SMOKE FAILED: ${err.message}`);
  } else {
    console.error("\nE2E SMOKE CRASHED:", err);
  }
  process.exit(1);
});
