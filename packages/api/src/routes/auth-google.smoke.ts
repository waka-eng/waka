/**
 * Standalone smoke test for the Google OAuth routes.
 *
 * Run with:
 *   pnpm --filter @waka/api exec tsx src/routes/auth-google.smoke.ts
 *
 * What we cover (without actually round-tripping to Google):
 *   1. GET /auth/google/login redirects to accounts.google.com with the
 *      expected query params (response_type=code, scope, state,
 *      code_challenge_method=S256) and sets both temp cookies.
 *   2. GET /auth/google/callback rejects requests with no `code`+`state`
 *      with a redirect back to /login?error=missing_code.
 *   3. GET /auth/google/callback rejects state mismatch (cookie value
 *      different from query value) with /login?error=state_mismatch.
 *   4. GET /auth/google/callback rejects requests where the temp cookies
 *      are absent (simulating cookie expiry / cross-origin tampering).
 *
 * The token-exchange + ID-token-decode path is exercised in vitest with
 * a mocked fetch (a later sub-AC for the test suite). This script's job
 * is to prove the routes are wired and the cookie/state machinery works.
 *
 * Exits 0 on full pass, 1 on any failure.
 */

import { loadLocalEnv } from "../../../../tools/local-env/load.js";

loadLocalEnv();

import { app } from "../index.js";

const GOOGLE_AUTHORIZE_PREFIX = "https://accounts.google.com/o/oauth2/v2/auth";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/**
 * Pull a cookie value out of one (or many) Set-Cookie headers. Hono's
 * Response surface concatenates multiple Set-Cookie values with newlines
 * via Headers.getSetCookie(); we accept either form.
 */
function readSetCookie(res: Response, name: string): string | null {
  // getSetCookie() is the spec-correct way; fall back to splitting the
  // single combined value if the polyfill isn't there. We cast through
  // unknown because Node's lib types vary between TS versions.
  const all: string[] | undefined = (
    res.headers as unknown as { getSetCookie?: () => string[] }
  ).getSetCookie?.();
  const cookies =
    all && all.length > 0
      ? all
      : (res.headers.get("set-cookie") ?? "").split(/,(?=\s*[A-Za-z0-9_-]+=)/);
  for (const raw of cookies) {
    const trimmed = raw.trim();
    if (trimmed.startsWith(`${name}=`)) {
      const eq = trimmed.indexOf("=");
      const semi = trimmed.indexOf(";");
      return trimmed.slice(eq + 1, semi === -1 ? undefined : semi);
    }
  }
  return null;
}

async function main() {
  // -------------------------------------------------------------------------
  // 1. /auth/google/login → 302 to Google with PKCE + state.
  // -------------------------------------------------------------------------
  const login = await app.request("/auth/google/login", {
    method: "GET",
    redirect: "manual",
  } as RequestInit);
  assert(
    login.status === 302,
    `Expected 302 from /auth/google/login, got ${login.status}: ${await login.text()}`,
  );

  const location = login.headers.get("location") ?? "";
  assert(
    location.startsWith(GOOGLE_AUTHORIZE_PREFIX),
    `Expected redirect to Google, got ${location}`,
  );

  const url = new URL(location);
  assert(url.searchParams.get("response_type") === "code", "response_type missing");
  assert(url.searchParams.get("scope")?.includes("openid"), "openid scope missing");
  assert(url.searchParams.get("scope")?.includes("email"), "email scope missing");
  assert(
    url.searchParams.get("code_challenge_method") === "S256",
    "PKCE challenge method must be S256",
  );
  assert(url.searchParams.get("code_challenge"), "PKCE code_challenge missing");
  const stateInUrl = url.searchParams.get("state");
  assert(stateInUrl && stateInUrl.length >= 32, "state missing or too short");
  assert(url.searchParams.get("client_id"), "client_id missing");
  assert(url.searchParams.get("redirect_uri"), "redirect_uri missing");

  const stateCookie = readSetCookie(login, "waka_oauth_state");
  const pkceCookie = readSetCookie(login, "waka_oauth_pkce");
  assert(stateCookie, "state cookie not set");
  assert(pkceCookie, "pkce cookie not set");
  assert(stateCookie === stateInUrl, "state cookie must match state in URL");

  console.log("[1/4] /login redirect + PKCE + state cookies ✅");

  // -------------------------------------------------------------------------
  // 2. /auth/google/callback with no code/state → /login?error=missing_code
  // -------------------------------------------------------------------------
  const noCode = await app.request("/auth/google/callback", {
    method: "GET",
    redirect: "manual",
  } as RequestInit);
  assert(noCode.status === 302, `Expected 302, got ${noCode.status}`);
  const noCodeLocation = noCode.headers.get("location") ?? "";
  assert(
    noCodeLocation.includes("/login") && noCodeLocation.includes("error=missing_code"),
    `Expected /login?error=missing_code, got ${noCodeLocation}`,
  );
  console.log("[2/4] callback without code → missing_code ✅");

  // -------------------------------------------------------------------------
  // 3. /auth/google/callback with state cookie absent → state_expired
  // -------------------------------------------------------------------------
  const noCookie = await app.request(
    "/auth/google/callback?code=abc&state=xyz",
    { method: "GET", redirect: "manual" } as RequestInit,
  );
  assert(noCookie.status === 302, `Expected 302, got ${noCookie.status}`);
  const noCookieLocation = noCookie.headers.get("location") ?? "";
  assert(
    noCookieLocation.includes("error=state_expired"),
    `Expected state_expired, got ${noCookieLocation}`,
  );
  console.log("[3/4] callback without cookies → state_expired ✅");

  // -------------------------------------------------------------------------
  // 4. /auth/google/callback with state cookie that does NOT match → mismatch
  // -------------------------------------------------------------------------
  const mismatch = await app.request(
    "/auth/google/callback?code=abc&state=fromUrl",
    {
      method: "GET",
      redirect: "manual",
      headers: {
        Cookie:
          "waka_oauth_state=fromCookieDifferent; waka_oauth_pkce=verifierValue",
      },
    } as RequestInit,
  );
  assert(mismatch.status === 302, `Expected 302, got ${mismatch.status}`);
  const mismatchLocation = mismatch.headers.get("location") ?? "";
  assert(
    mismatchLocation.includes("error=state_mismatch"),
    `Expected state_mismatch, got ${mismatchLocation}`,
  );
  console.log("[4/4] callback with mismatched state → state_mismatch ✅");
}

main()
  .then(() => {
    console.log("ALL GOOGLE OAUTH SMOKE TESTS PASSED");
    process.exit(0);
  })
  .catch((err) => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
  });
