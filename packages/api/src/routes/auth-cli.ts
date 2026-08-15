/**
 * CLI / MCP loopback login routes.
 *
 * Mounted under /api/auth/cli by the parent auth router. Lets a local
 * CLI/MCP process (waka-mcp) obtain its own independently-revocable
 * session, without ever putting the 30-day session JWT in a browser-visible
 * URL:
 *
 *   GET /api/auth/cli/start
 *     Requires an already-authenticated browser (`waka_session` cookie or
 *     Bearer header) — the user must have logged into WAKA in this browser
 *     first. Validates that `callback` points at a loopback address, mints
 *     a short-lived one-time exchange code bound to a profile, and
 *     302-redirects to `${callback}?code=...&state=...`.
 *
 *   POST /api/auth/cli/exchange
 *     Server-to-server (no cookie/session required). Exchanges a valid,
 *     unexpired, single-use code for a brand-new session JWT + row —
 *     completely separate from the browser's own session, so revoking one
 *     does not affect the other.
 *
 * **The credential binds to one profile.** An agent using WAKA as its own
 * memory logs in bound to its agent profile; a person logging in for their
 * own memory binds to the human profile. Audit and revocation are per-profile
 * because the binding is what authorization reads.
 *
 * Why a code instead of minting the session directly in /start?
 *   A 30-day session JWT embedded in a redirect URL would sit in the local
 *   callback server's request log and (depending on the OS) shell/process
 *   history. The one-time code is short-lived (2 minutes) and single-use —
 *   deleted from `cli_login_codes` the instant it is looked up, whether the
 *   exchange succeeds or the code turns out to be expired — so the actual
 *   bearer credential never touches a URL.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { accounts, cliLoginCodes, profiles } from "../db/index.js";
import { SESSION_TTL_SECONDS, signSessionToken } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, profileAccessError, requireAuth } from "../lib/middleware.js";
import { createSessionRow, hashSessionToken } from "../lib/session.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * A loopback round-trip is a same-machine redirect, not a user-facing wait —
 * 2 minutes is generous headroom for the local callback server to be up and
 * the exchange call to land.
 */
const CODE_TTL_SECONDS = 2 * 60;

/** `state` is opaque and only ever echoed back; cap it so a malformed value
 * can't bloat the redirect URL. */
const MAX_STATE_LENGTH = 256;

/** Long enough for "Mina's MacBook Pro", short enough to stay a label. */
const MAX_DEVICE_LABEL_LENGTH = 120;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Base64url-encode a Uint8Array (no padding, +/ → -_). Mirrors
 * auth-google.ts's helper of the same shape — duplicated rather than
 * imported since auth-google.ts doesn't export it and the two files should
 * stay independently readable.
 */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Cryptographically random URL-safe exchange code. */
function randomCode(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Only `http://127.0.0.1:*` and `http://localhost:*` are acceptable
 * `callback` targets — this redirect exists solely to hand a one-time code
 * to a local CLI process's temporary HTTP server. Anything else (including
 * https, or a same-origin WAKA path) is rejected outright; there is no
 * legitimate loopback-login use case for either.
 */
function safeLoopbackCallback(value: string | null): URL | null {
  if (!value || value.length > 2_048) return null;
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return null;
  }
  if (target.protocol !== "http:") return null;
  if (target.hostname !== "127.0.0.1" && target.hostname !== "localhost") {
    return null;
  }
  return target;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const cliAuthRoutes = new Hono<AuthEnv>();

/**
 * GET /api/auth/cli/start?callback=<loopback-url>&state=<opaque>&profile=<id|name>&device=<label>
 *
 * `requireAuth` means an unauthenticated hit gets the standard 401 JSON
 * body rather than a redirect chain back through /login — this endpoint is
 * only ever opened by a CLI tool in a browser the user is expected to
 * already be logged into WAKA with. If not, the JSON error is enough of a
 * signal for the CLI's own error message to tell the user to log in first.
 *
 * `profile` names which of the account's profiles the credential binds to,
 * defaulting to the profile the browser is already acting as. Phase 2 adds
 * the consent step in front of this: an API-rendered page where the person
 * picks the profile and confirms, so a credential is never minted by a
 * top-level navigation alone.
 */
cliAuthRoutes.get("/start", requireAuth, async (c) => {
  const callback = safeLoopbackCallback(c.req.query("callback") ?? null);
  if (!callback) {
    return c.json(
      { error: "callback must be a http://127.0.0.1 or http://localhost URL" },
      400,
    );
  }

  const state = (c.req.query("state") ?? "").slice(0, MAX_STATE_LENGTH);
  if (!state) {
    return c.json({ error: "state is required" }, 400);
  }

  const session = c.get("session");
  const db = getDb();

  let boundProfileId = session.profile.id;
  const requestedProfile = (c.req.query("profile") ?? "").trim();
  if (requestedProfile && requestedProfile !== session.profile.id) {
    // Candidates come from the account, never from the request: a caller can
    // ask for a profile by name, but only ever one of its own.
    const candidates = await db
      .select({ id: profiles.id, accountId: profiles.accountId, name: profiles.name })
      .from(profiles)
      .where(eq(profiles.accountId, session.profile.accountId));

    const target = candidates.find(
      (row) =>
        row.id === requestedProfile ||
        row.name.toLowerCase() === requestedProfile.toLowerCase(),
    );
    if (!target) {
      return c.json({ error: "Unknown profile" }, 400);
    }

    // Minting a credential for a profile is an administrative act, not a
    // read: an agent-bound session may read the human profile but must not
    // be able to issue a credential that acts as it.
    const denied = profileAccessError(session, target, "write");
    if (denied) {
      return c.json(denied, 403);
    }
    boundProfileId = target.id;
  }

  const deviceLabel =
    (c.req.query("device") ?? "").trim().slice(0, MAX_DEVICE_LABEL_LENGTH) || null;

  const code = randomCode();
  const codeHash = await hashSessionToken(code);

  await db.insert(cliLoginCodes).values({
    profileId: boundProfileId,
    codeHash,
    deviceLabel,
    expiresAt: new Date(Date.now() + CODE_TTL_SECONDS * 1000),
  });

  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  return c.redirect(callback.toString(), 302);
});

/**
 * POST /api/auth/cli/exchange
 *
 * Body: { code: string }
 *
 * The code row is deleted on lookup regardless of outcome (found-and-valid,
 * found-but-expired, or not-found-because-already-used) so it is single-use
 * either way. Only on the valid path do we mint a session.
 */
const exchangeSchema = z
  .object({
    code: z.string().min(1).max(512),
  })
  .strict();

cliAuthRoutes.post("/exchange", async (c) => {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = exchangeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      {
        error: "Invalid exchange payload",
        details: parsed.error.flatten().fieldErrors,
      },
      400,
    );
  }

  const db = getDb();
  const codeHash = await hashSessionToken(parsed.data.code);

  const rows = await db
    .select({
      id: cliLoginCodes.id,
      profileId: cliLoginCodes.profileId,
      deviceLabel: cliLoginCodes.deviceLabel,
      expiresAt: cliLoginCodes.expiresAt,
    })
    .from(cliLoginCodes)
    .where(eq(cliLoginCodes.codeHash, codeHash))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return c.json({ error: "Invalid or already-used code" }, 400);
  }

  // Single-use: delete now, before we even know whether it's expired.
  await db.delete(cliLoginCodes).where(eq(cliLoginCodes.id, row.id));

  if (row.expiresAt.getTime() <= Date.now()) {
    return c.json({ error: "Code expired" }, 400);
  }

  // The email comes from the account behind the bound profile — the CLI
  // shows it so the person can see which login they just connected.
  const profileRows = await db
    .select({ id: profiles.id, email: accounts.email })
    .from(profiles)
    .innerJoin(accounts, eq(accounts.id, profiles.accountId))
    .where(eq(profiles.id, row.profileId))
    .limit(1);
  const profile = profileRows[0];
  if (!profile) {
    return c.json({ error: "Profile no longer exists" }, 400);
  }

  // Mint a session independent of the browser's own — revoking this one
  // later (e.g. `waka-mcp logout`) will not touch the browser session, and
  // vice versa.
  const token = await signSessionToken({
    profileId: profile.id,
    email: profile.email,
  });
  await createSessionRow({
    profileId: profile.id,
    token,
    deviceLabel: row.deviceLabel,
  });

  return c.json({
    token,
    expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
    user: { email: profile.email },
  });
});
