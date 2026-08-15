/**
 * Hono test-client harness for route tests.
 *
 * Why this exists
 * ---------------
 * Every protected-route test in this suite drives the real Hono app through
 * `app.request(path, init)` (in-process — no HTTP server bind, no port
 * juggling, no flaky socket teardown). That works, but each call site is
 * forced to:
 *
 *   1. JSON-stringify the body and remember to set `Content-Type`.
 *   2. Stitch `Authorization: Bearer ${user.token}` (or the cookie form)
 *      into the headers, with no help from the type system if the field
 *      name drifts.
 *   3. Read `res.status` AND `await res.json()` separately, then narrow
 *      the parsed shape with an unsafe cast every time.
 *   4. Re-implement the "extract `Set-Cookie` value" / "merge two header
 *      bags" / "assert JSON content-type" plumbing per file.
 *
 * Repeated across the suite, those four lines become the longest part of every
 * spec — and the place a typo (`Authrization`) silently invalidates the
 * test by demoting it to an unauthenticated request that 401s "as expected".
 * The harness here collapses the boilerplate into one ergonomic call site:
 *
 *     const client = authedClient(alice);
 *     const { status, body } = await client.json<{ inspiration: Inspiration }>(
 *       "POST",
 *       "/api/inspirations",
 *       { text: "hello" },
 *     );
 *
 * `body` is typed as `{ inspiration: Inspiration }`, the bearer token is
 * injected once at client construction, and the response is parsed exactly
 * once.
 *
 * Why a thin wrapper (and not a full SDK)?
 * ----------------------------------------
 * - We MUST exercise the real Hono router + middleware stack. A typed RPC
 *   client (e.g. `hc<App>(...)`) would replace the routing/validation we
 *   are trying to test with a parallel implementation that tracks the
 *   server's contract by convention only.
 * - We MUST keep the call shape close to `app.request(...)` so a test can
 *   drop down to the raw Response when it needs to (e.g. read
 *   `Set-Cookie`, assert on a non-JSON body, stream a binary). Hiding
 *   `Response` behind a typed proxy would block those legitimate uses.
 *
 * Therefore: this module exposes
 *   - `apiRequest(path, init)`            → raw Response (escape hatch).
 *   - `apiJson<T>(path, init)`            → `{ status, headers, body }`.
 *   - `authedClient(fixture | token)`     → ergonomic per-session client.
 *   - `extractSetCookie(res, name)`       → strict cookie reader.
 *
 * Authentication contract
 * -----------------------
 * The Hono `requireAuth` middleware (lib/middleware.ts) accepts a session
 * token via either:
 *   1. `Authorization: Bearer <jwt>`  — preferred for tests; explicit, no
 *                                       cookie jar to manage.
 *   2. `Cookie: waka_session=<jwt>`   — exercises the browser path.
 *
 * The harness defaults to (1). The cookie form is available on the
 * client via `client.withAuthMode("cookie")` for tests that explicitly want
 * to validate the cookie path (e.g. logout flows).
 *
 * IMPORTANT — production DB target
 * --------------------------------
 * `app` (re-exported below as `app`) reaches Postgres through the production
 * `getDb()` singleton (lib/db.ts), which is bound to the shared `public`
 * schema on the live Neon instance pinned by `DB_CONNECTION_URL`. The
 * schema-isolated test database returned by `createTestDatabase()` is a
 * SEPARATE connection / schema and is NOT visible to the Hono handlers.
 *
 * Practical implication for route tests:
 *   - When a test drives writes through `client.json("POST", ...)`, the rows
 *     land in the shared schema, and any cleanup MUST go through `getDb()`
 *     against that same schema. Deleting the account reaps everything under
 *     it, because every memory table cascades from `profiles`.
 *   - When a test drives writes DIRECTLY through Drizzle (e.g. exercises a
 *     queue worker handler in isolation), use `createTestDatabase()` for
 *     hermetic schema isolation. Mixing the two on a single test is a bug —
 *     the profile row would live in one schema and the inspiration in
 *     another, with the join silently returning empty.
 *
 * The harness does NOT enforce this distinction; it cannot know which
 * connection a given handler used. Test authors must pick one mode per
 * spec and stick to it.
 */

import { app } from "../../src/index.js";
import { SESSION_COOKIE_NAME } from "../../src/lib/auth.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset of `RequestInit` the harness understands, expressed in terms a
 * test-author actually uses. `body` accepts:
 *
 *   - a plain object → JSON.stringify'd, content-type defaulted to JSON
 *   - a string       → passed through verbatim (use for malformed-JSON tests)
 *   - `undefined`    → no body
 *
 * `headers` is a flat record so call sites don't have to import a `Headers`
 * polyfill type; the harness merges this with auth + content-type defaults.
 */
/**
 * Anything a spec can authenticate as. Structural rather than tied to one
 * factory: a spec that mints its own session row and one that builds a token
 * by hand hand the harness the same thing — the token.
 */
export interface SessionFixture {
  token: string;
}

export interface ApiRequestInit {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
}

/**
 * Result returned by `apiJson` / `client.json`. Captures the three things a
 * route test cares about — status code, response headers (for
 * `Set-Cookie`-style assertions), and the parsed JSON body — without forcing
 * the caller to await the body separately.
 *
 * Generic `T` is what the call site claims the body shape is. The harness
 * does NOT validate against `T` at runtime — that's the route test's job
 * via `expect(...)` assertions. Typing `body` as `T` keeps the call site
 * narrow without an unsafe cast at every read.
 */
export interface ApiJsonResponse<T = unknown> {
  status: number;
  headers: Headers;
  body: T;
}

/**
 * Per-session ergonomic client. Pre-binds the bearer token (or session
 * cookie) so individual call sites stay focused on the request being
 * exercised.
 *
 * Construction:
 *   - `authedClient(fixture)`   — extract `.token` automatically.
 *   - `authedClient(jwtString)` — pass a raw token (e.g. one synthesised
 *                                 manually for a negative-path test).
 *
 * The returned client is immutable; `withAuthMode` returns a new client so
 * a single fixture can drive both bearer-mode and cookie-mode tests in the
 * same describe block without interfering.
 */
export interface AuthedClient {
  /** The bound JWT. Exposed for direct `app.request` calls when needed. */
  readonly token: string;
  /** Current auth-injection mode. Default: bearer header. */
  readonly authMode: "bearer" | "cookie";

  /**
   * Issue a request as this session; return the raw Response. Use when the
   * test needs to inspect a Set-Cookie header, a non-JSON body, etc.
   */
  request(path: string, init?: ApiRequestInit): Promise<Response>;

  /**
   * Issue a request as this session; return `{ status, headers, body }` with
   * `body` typed as `T` (the type is a convenience for the call site —
   * the harness does not enforce the shape at runtime).
   */
  json<T = unknown>(
    method: ApiRequestInit["method"],
    path: string,
    body?: unknown,
    extraInit?: Omit<ApiRequestInit, "method" | "body">,
  ): Promise<ApiJsonResponse<T>>;

  /** Convenience: GET + JSON parse. */
  get<T = unknown>(
    path: string,
    extraInit?: Omit<ApiRequestInit, "method" | "body">,
  ): Promise<ApiJsonResponse<T>>;

  /** Convenience: DELETE + JSON parse. */
  delete<T = unknown>(
    path: string,
    extraInit?: Omit<ApiRequestInit, "method" | "body">,
  ): Promise<ApiJsonResponse<T>>;

  /**
   * Return a sibling client that authenticates via cookie instead of bearer
   * header (or vice versa). Useful for paired tests that must verify both
   * paths reach the same handler.
   */
  withAuthMode(mode: "bearer" | "cookie"): AuthedClient;
}

// ---------------------------------------------------------------------------
// Re-export the live Hono app
// ---------------------------------------------------------------------------

/**
 * The singleton Hono `app` from `src/index.ts`. Re-exported so a test that
 * needs the raw `app.request(...)` API (for diagnostic logging, custom
 * RequestInit, etc.) can do
 *
 *   import { app } from "./helpers/client.js";
 *
 * without a second import path. Identity-equal to `src/index.ts`'s export.
 */
export { app };

// ---------------------------------------------------------------------------
// Header / body helpers
// ---------------------------------------------------------------------------

/**
 * Merge a per-call header bag with the harness defaults. The defaults are
 * conservative: only set `Content-Type: application/json` when the call has
 * a body AND the caller hasn't already specified a content type. This means
 * a malformed-JSON test (body = "not json") passes through whatever the
 * test claims, without the harness silently adding a JSON content-type
 * header that contradicts it.
 *
 * Header keys are normalised to canonical case so a duplicate
 * "content-type" + "Content-Type" pair from the caller doesn't end up in
 * the wire request twice.
 */
function buildHeaders(
  init: ApiRequestInit | undefined,
  extras: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  // Per-call defaults applied first so caller overrides win.
  if (init?.body !== undefined) {
    out["Content-Type"] = "application/json";
  }
  // Harness extras (auth header / cookie) — applied second so the caller
  // can deliberately override them in negative-path tests (e.g.
  // `Authorization: Bearer garbage` to assert 401).
  for (const [k, v] of Object.entries(extras)) {
    out[canonicalHeaderName(k)] = v;
  }
  // Caller overrides — applied last so explicit caller intent always wins.
  if (init?.headers) {
    for (const [k, v] of Object.entries(init.headers)) {
      out[canonicalHeaderName(k)] = v;
    }
  }
  return out;
}

/**
 * Normalise a header name to "Capitalize-Each-Hyphen-Separated-Word" form.
 * HTTP header names are case-insensitive on the wire, but our merge logic
 * needs a deterministic key so "content-type" + "Content-Type" don't both
 * survive into the final bag. We lowercase, then capitalise, rather than
 * trusting the caller's casing.
 */
function canonicalHeaderName(name: string): string {
  return name
    .toLowerCase()
    .split("-")
    .map((part) => (part.length === 0 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join("-");
}

/**
 * Resolve `init.body` to a string (or `undefined`):
 *   - undefined / null → no body
 *   - string           → passthrough (caller is responsible for shape)
 *   - everything else  → JSON.stringify
 *
 * Note: if a caller hands us a `URLSearchParams` / `FormData` etc., they
 * will be JSON-stringified to "[object FormData]" — which is the desired
 * loud failure. The harness is for JSON APIs; non-JSON requests should use
 * `apiRequest` directly with a hand-built `RequestInit`.
 */
function buildBody(body: unknown): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  return JSON.stringify(body);
}

// ---------------------------------------------------------------------------
// Public API: low-level request helpers
// ---------------------------------------------------------------------------

/**
 * Issue an in-process Hono request. Returns the raw `Response` so the caller
 * can read body, headers, status, and Set-Cookie however they want.
 *
 * No auth is injected by this helper; pass `headers["Authorization"]`
 * yourself for unauthenticated negative-path tests, or use `authedClient`.
 */
export async function apiRequest(
  path: string,
  init: ApiRequestInit = {},
): Promise<Response> {
  const headers = buildHeaders(init, {});
  const body = buildBody(init.body);
  return await app.request(path, {
    method: init.method ?? "GET",
    headers,
    body,
  });
}

/**
 * Issue a request and return `{ status, headers, body }` with the body
 * parsed as JSON. If the response body is empty or non-JSON, `body` will be
 * `null` (rather than throwing) so a 204 / 401 / 500 response can still be
 * inspected via the `status` field. Tests that need to assert the body
 * is/isn't JSON should drop to `apiRequest` and read the raw response.
 */
export async function apiJson<T = unknown>(
  path: string,
  init: ApiRequestInit = {},
): Promise<ApiJsonResponse<T>> {
  const res = await apiRequest(path, init);
  let body: T | null = null;
  // 204 No Content has no body; reading it would throw on some runtimes.
  // Same for routes that intentionally return an empty 4xx body. Guard so
  // the harness stays useful for those paths without forcing the caller
  // into a try/catch.
  const text = await res.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = null;
    }
  }
  return {
    status: res.status,
    headers: res.headers,
    body: body as T,
  };
}

// ---------------------------------------------------------------------------
// Public API: per-session client
// ---------------------------------------------------------------------------

/**
 * Build a per-session client that auto-injects auth for every request.
 * Accepts either a fixture carrying a fully-valid session token or a raw JWT
 * string (escape hatch for tests that synthesise tokens manually).
 *
 * Default auth mode: `bearer` (Authorization header). Switch to cookie
 * with `client.withAuthMode("cookie")` for tests that drive the browser
 * path explicitly.
 */
export function authedClient(
  source: SessionFixture | string,
  options: { authMode?: "bearer" | "cookie" } = {},
): AuthedClient {
  const token = typeof source === "string" ? source : source.token;
  const authMode = options.authMode ?? "bearer";

  function authHeaders(): Record<string, string> {
    if (authMode === "bearer") {
      return { Authorization: `Bearer ${token}` };
    }
    // Cookie mode. We use the production cookie name so the middleware's
    // `getCookie(c, SESSION_COOKIE_NAME)` lookup hits.
    return { Cookie: `${SESSION_COOKIE_NAME}=${token}` };
  }

  const client: AuthedClient = {
    token,
    authMode,

    async request(path, init = {}) {
      const headers = buildHeaders(init, authHeaders());
      const body = buildBody(init.body);
      return await app.request(path, {
        method: init.method ?? "GET",
        headers,
        body,
      });
    },

    async json<T = unknown>(
      method: ApiRequestInit["method"],
      path: string,
      body?: unknown,
      extraInit?: Omit<ApiRequestInit, "method" | "body">,
    ): Promise<ApiJsonResponse<T>> {
      const res = await client.request(path, {
        ...extraInit,
        method,
        body,
      });
      let parsed: T | null = null;
      const text = await res.text();
      if (text.length > 0) {
        try {
          parsed = JSON.parse(text) as T;
        } catch {
          parsed = null;
        }
      }
      return {
        status: res.status,
        headers: res.headers,
        body: parsed as T,
      };
    },

    get<T = unknown>(
      path: string,
      extraInit?: Omit<ApiRequestInit, "method" | "body">,
    ) {
      return client.json<T>("GET", path, undefined, extraInit);
    },

    delete<T = unknown>(
      path: string,
      extraInit?: Omit<ApiRequestInit, "method" | "body">,
    ) {
      return client.json<T>("DELETE", path, undefined, extraInit);
    },

    withAuthMode(mode: "bearer" | "cookie") {
      return authedClient(token, { authMode: mode });
    },
  };

  return client;
}

// ---------------------------------------------------------------------------
// Public API: response inspection helpers
// ---------------------------------------------------------------------------

/**
 * Extract the value of a named cookie from a Response's `Set-Cookie` header.
 * Throws (rather than returning `null`) if the header is missing or the
 * cookie is absent — a test that asks for a cookie value almost always
 * intends to assert on it, and a `null` return turns those assertions into
 * misleading "expected '...', got null" messages.
 *
 *   const tokenCookie = extractSetCookie(res, "waka_session");
 *
 * If the test wants to *assert absence* of a cookie, use `extractSetCookieOptional`.
 */
export function extractSetCookie(res: Response, name: string): string {
  const value = extractSetCookieOptional(res, name);
  if (value === null) {
    const raw = res.headers.get("set-cookie") ?? "(no Set-Cookie header)";
    throw new Error(
      `Expected Set-Cookie to include "${name}=…", got: ${raw}`,
    );
  }
  return value;
}

/**
 * Like `extractSetCookie`, but returns `null` instead of throwing when the
 * cookie is absent. Use this in negative-path tests:
 *
 *   expect(extractSetCookieOptional(res, "waka_session")).toBeNull();
 */
export function extractSetCookieOptional(
  res: Response,
  name: string,
): string | null {
  const setCookie = res.headers.get("set-cookie");
  if (!setCookie) return null;
  // Hono's response sets one Set-Cookie header per cookie (joined by ", "
  // when the runtime collapses them). Match the named cookie up to the
  // next "; " or ", " — both are valid header separators.
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = setCookie.match(new RegExp(`(?:^|[,;]\\s*)${escaped}=([^;,]+)`));
  if (!match || !match[1]) return null;
  return match[1];
}
