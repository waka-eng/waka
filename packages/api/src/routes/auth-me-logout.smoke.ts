/**
 * Standalone smoke test for GET /auth/me and POST /auth/logout.
 *
 * Run with:
 *   pnpm --filter @waka/api exec tsx src/routes/auth-me-logout.smoke.ts
 *
 * Exits 0 on full pass, 1 on any failure. Uses a randomised email so it can
 * be re-run safely without manual cleanup. Cleans up the test user it
 * inserts (CASCADE drops the sessions row with it) on exit.
 *
 * Coverage:
 *   1. Signup mints a session — /auth/me returns the user via cookie.
 *   2. /auth/me returns the user via Authorization: Bearer header.
 *   3. /auth/me returns 401 with no credentials.
 *   4. /auth/me returns 401 with a tampered/garbage cookie.
 *   5. /auth/logout deletes the session row; /auth/me then returns 401
 *      even if the same JWT is replayed.
 *   6. /auth/logout is idempotent — calling it again returns 200.
 *   7. /auth/logout always emits a Max-Age=0 clear-cookie header.
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { sessions, users } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { hashSessionToken } from "../lib/session.js";
import { app } from "../index.js";

function extractSessionCookie(setCookie: string | null): string {
  if (!setCookie) throw new Error("Set-Cookie header missing");
  const match = setCookie.match(/waka_session=([^;]+)/);
  if (!match) throw new Error(`Set-Cookie missing waka_session: ${setCookie}`);
  return match[1]!;
}

async function main() {
  const email = `me-logout-smoke-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.test`;
  const password = "supersecret123";
  const db = getDb();

  // ---------------------------------------------------------------------
  // Sign up to get a live session cookie + token.
  // ---------------------------------------------------------------------
  const signupRes = await app.request("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "MeSmoke" }),
  });
  if (signupRes.status !== 201) {
    throw new Error(`Signup failed: ${signupRes.status} ${await signupRes.text()}`);
  }
  const signupBody = (await signupRes.json()) as {
    user: { id: string; email: string; name: string };
    token: string;
  };
  const userId = signupBody.user.id;
  const token = signupBody.token;
  const cookieToken = extractSessionCookie(signupRes.headers.get("set-cookie"));
  if (cookieToken !== token) {
    throw new Error("Cookie token does not match body token");
  }

  // The session row should now exist in Postgres.
  const tokenHash = await hashSessionToken(token);
  const sessionRows = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash));
  if (sessionRows.length !== 1) {
    throw new Error(
      `Expected 1 session row after signup, got ${sessionRows.length}`,
    );
  }
  if (sessionRows[0]!.userId !== userId) {
    throw new Error("Session row userId does not match signup user");
  }
  console.log("[1/7] signup persists session row ✅");

  // ---------------------------------------------------------------------
  // 1. /auth/me via cookie
  // ---------------------------------------------------------------------
  const meCookieRes = await app.request("/auth/me", {
    method: "GET",
    headers: { Cookie: `waka_session=${token}` },
  });
  if (meCookieRes.status !== 200) {
    throw new Error(
      `Expected 200 from /auth/me via cookie, got ${meCookieRes.status}: ${await meCookieRes.text()}`,
    );
  }
  const meCookieBody = (await meCookieRes.json()) as {
    user: { id: string; email: string };
  };
  if (meCookieBody.user.id !== userId || meCookieBody.user.email !== email) {
    throw new Error(
      `/auth/me cookie returned wrong user: ${JSON.stringify(meCookieBody)}`,
    );
  }
  console.log("[2/7] /auth/me via cookie ✅");

  // ---------------------------------------------------------------------
  // 2. /auth/me via Authorization: Bearer
  // ---------------------------------------------------------------------
  const meBearerRes = await app.request("/auth/me", {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (meBearerRes.status !== 200) {
    throw new Error(
      `Expected 200 from /auth/me via bearer, got ${meBearerRes.status}`,
    );
  }
  const meBearerBody = (await meBearerRes.json()) as {
    user: { id: string };
  };
  if (meBearerBody.user.id !== userId) {
    throw new Error("/auth/me bearer returned wrong user");
  }
  console.log("[3/7] /auth/me via Authorization header ✅");

  // ---------------------------------------------------------------------
  // 3. /auth/me with no credentials → 401
  // ---------------------------------------------------------------------
  const meAnonRes = await app.request("/auth/me", { method: "GET" });
  if (meAnonRes.status !== 401) {
    throw new Error(`Expected 401 from anonymous /auth/me, got ${meAnonRes.status}`);
  }
  console.log("[4/7] /auth/me anonymous returns 401 ✅");

  // ---------------------------------------------------------------------
  // 4. /auth/me with a garbage cookie → 401
  // ---------------------------------------------------------------------
  const meGarbageRes = await app.request("/auth/me", {
    method: "GET",
    headers: { Cookie: "waka_session=not.a.real.jwt" },
  });
  if (meGarbageRes.status !== 401) {
    throw new Error(
      `Expected 401 from garbage cookie, got ${meGarbageRes.status}`,
    );
  }
  console.log("[5/7] /auth/me garbage cookie returns 401 ✅");

  // ---------------------------------------------------------------------
  // 5. /auth/logout deletes the session row and revokes the JWT.
  // ---------------------------------------------------------------------
  const logoutRes = await app.request("/auth/logout", {
    method: "POST",
    headers: { Cookie: `waka_session=${token}` },
  });
  if (logoutRes.status !== 200) {
    throw new Error(
      `Expected 200 from logout, got ${logoutRes.status}: ${await logoutRes.text()}`,
    );
  }
  const logoutCookie = logoutRes.headers.get("set-cookie") ?? "";
  if (!logoutCookie.includes("waka_session=") || !logoutCookie.includes("Max-Age=0")) {
    throw new Error(`Logout did not emit clear-cookie: ${logoutCookie}`);
  }

  const sessionRowsAfterLogout = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(eq(sessions.tokenHash, tokenHash));
  if (sessionRowsAfterLogout.length !== 0) {
    throw new Error(
      `Session row still present after logout: ${sessionRowsAfterLogout.length} row(s)`,
    );
  }

  // The JWT itself is still cryptographically valid, but the row is
  // gone, so /auth/me MUST refuse it.
  const meAfterLogoutRes = await app.request("/auth/me", {
    method: "GET",
    headers: { Cookie: `waka_session=${token}` },
  });
  if (meAfterLogoutRes.status !== 401) {
    throw new Error(
      `Expected 401 after logout, got ${meAfterLogoutRes.status}`,
    );
  }
  console.log("[6/7] /auth/logout revokes session ✅");

  // ---------------------------------------------------------------------
  // 6. Logout is idempotent (no cookie, no row → still 200).
  // ---------------------------------------------------------------------
  const logoutAgainRes = await app.request("/auth/logout", { method: "POST" });
  if (logoutAgainRes.status !== 200) {
    throw new Error(
      `Expected 200 from idempotent logout, got ${logoutAgainRes.status}`,
    );
  }
  const logoutAgainCookie = logoutAgainRes.headers.get("set-cookie") ?? "";
  if (!logoutAgainCookie.includes("Max-Age=0")) {
    throw new Error(
      `Idempotent logout did not emit clear-cookie: ${logoutAgainCookie}`,
    );
  }
  console.log("[7/7] /auth/logout is idempotent ✅");

  // Cleanup. ON DELETE CASCADE on sessions.user_id wipes any leftover
  // session rows along with the user.
  await db.delete(users).where(eq(users.id, userId));
  console.log("cleaned up test user");
}

main()
  .then(() => {
    console.log("ALL SMOKE TESTS PASSED");
    process.exit(0);
  })
  .catch((err) => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
  });
