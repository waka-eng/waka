/**
 * Standalone smoke test for POST /api/auth/signup.
 *
 * Run with:
 *   pnpm --filter @waka/api exec tsx src/routes/auth.smoke.ts
 *
 * Exits 0 on full pass, 1 on any failure. Uses a randomised email so it can
 * be re-run safely without manual cleanup. Cleans up the row it inserts so
 * the Neon table doesn't accumulate test residue.
 *
 * NOTE: This is a one-off script, not part of the vitest suite. The vitest
 * suite (Sub-AC for tests) will replace this with proper isolated specs.
 */

import "dotenv/config";

import { eq } from "drizzle-orm";

import { users } from "../db/index.js";
import { verifySessionToken } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { app } from "../index.js";

async function main() {
  const email = `signup-smoke-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}@example.test`;
  const password = "supersecret123";

  // 1. Happy path: 201 + token + cookie + DB row.
  const ok = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name: "Smoke" }),
  });
  if (ok.status !== 201) {
    throw new Error(`Expected 201, got ${ok.status}: ${await ok.text()}`);
  }
  const okBody = (await ok.json()) as {
    user: { id: string; email: string; name: string };
    token: string;
  };
  if (okBody.user.email !== email) {
    throw new Error(`Wrong email returned: ${okBody.user.email}`);
  }
  if (!okBody.token) throw new Error("No token in response body");
  const cookie = ok.headers.get("set-cookie");
  if (!cookie || !cookie.includes("waka_session=")) {
    throw new Error(`Set-Cookie missing session: ${cookie}`);
  }
  const decoded = await verifySessionToken(okBody.token);
  if (!decoded || decoded.sub !== okBody.user.id) {
    throw new Error("Token does not decode back to inserted user id");
  }
  console.log("[1/4] happy path ✅");

  // 2. Duplicate: 409.
  const dup = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (dup.status !== 409) {
    throw new Error(`Expected 409 on duplicate, got ${dup.status}`);
  }
  console.log("[2/4] duplicate email ✅");

  // 3. Bad email: 400.
  const badEmail = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email", password }),
  });
  if (badEmail.status !== 400) {
    throw new Error(`Expected 400 on bad email, got ${badEmail.status}`);
  }
  console.log("[3/4] invalid email ✅");

  // 4. Short password: 400.
  const shortPw = await app.request("/api/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: `x${email}`, password: "short" }),
  });
  if (shortPw.status !== 400) {
    throw new Error(`Expected 400 on short password, got ${shortPw.status}`);
  }
  console.log("[4/4] short password ✅");

  // Cleanup the row we inserted in step 1.
  await getDb().delete(users).where(eq(users.id, okBody.user.id));
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
