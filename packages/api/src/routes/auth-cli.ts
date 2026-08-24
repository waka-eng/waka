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
 *     Bearer header) held by a **human-profile** session — the user must have
 *     logged into WAKA in this browser first. Validates that `callback`
 *     points at a loopback address and **renders a consent page**: which
 *     device is asking, which profile it would act as, and a button. It
 *     mints nothing.
 *
 *   POST /api/auth/cli/consent
 *     The consent page's form target, same human-profile requirement. Mints
 *     the one-time code and 302-redirects to
 *     `${callback}?code=...&state=...`.
 *
 *     Why a page and a POST rather than minting in /start? A session cookie
 *     is `SameSite=Lax`, which is deliberately sent on top-level GET
 *     navigations — so any page that could make the browser visit /start
 *     while the person was logged in would have minted a credential and
 *     handed it to a local port of its choosing, without the person seeing
 *     anything. Lax does not send the cookie on a cross-site POST, and a
 *     human has to press the button, so the same navigation now ends at a
 *     page instead of a credential.
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

import { accounts, cliLoginCodes, profiles, type ProfileType } from "../db/index.js";
import { SESSION_TTL_SECONDS, signSessionToken } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import {
  type AuthEnv,
  humanSessionsOnly,
  resolveProfileAccess,
  requireAuth,
  asAccountProfile,
} from "../lib/middleware.js";
import {
  type AuthenticatedSession,
  createSessionRow,
  hashSessionToken,
} from "../lib/session.js";

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

/**
 * How long a rendered consent page stays actionable. Long enough to read
 * the page and pick a profile, short enough that a form left open in a tab
 * overnight cannot still mint a credential in the morning.
 */
const CONSENT_TTL_SECONDS = 10 * 60;

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
// Consent token
// ---------------------------------------------------------------------------

interface ConsentBinding {
  sessionId: string;
  callback: string;
  state: string;
}

function consentSecret(): string {
  const secret = process.env.JWT_SECRET ?? process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET (or AUTH_SECRET) is not set; cannot sign consent.");
  }
  return secret;
}

async function consentSignature(binding: ConsentBinding, expiresAt: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(consentSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const payload = [
    "waka.cli_consent.v1",
    binding.sessionId,
    binding.callback,
    binding.state,
    String(expiresAt),
  ].join("\n");
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64UrlEncode(new Uint8Array(mac));
}

async function signConsentToken(binding: ConsentBinding): Promise<string> {
  const expiresAt = Date.now() + CONSENT_TTL_SECONDS * 1000;
  return `${expiresAt}.${await consentSignature(binding, expiresAt)}`;
}

/**
 * Constant-time-ish comparison. The window here is a signed MAC rather than
 * a secret being guessed character by character, but comparing without an
 * early return costs nothing and removes the question.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyConsentToken(token: string, binding: ConsentBinding): Promise<boolean> {
  const separator = token.indexOf(".");
  if (separator <= 0) return false;

  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  return timingSafeEqual(
    token.slice(separator + 1),
    await consentSignature(binding, expiresAt),
  );
}

// ---------------------------------------------------------------------------
// Consent page
// ---------------------------------------------------------------------------

/** Everything interpolated below is either account-owned or request-supplied. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderConsentPage(input: {
  accountEmail: string;
  callback: string;
  state: string;
  deviceLabel: string | null;
  candidates: Array<{ id: string; name: string; type: ProfileType }>;
  preselectedId: string;
  consentToken: string;
}): string {
  const asking = input.deviceLabel
    ? `${escapeHtml(input.deviceLabel)} on this machine`
    : "A program on this machine";

  const options = input.candidates
    .map((profile) => {
      const label = profile.name.trim() || (profile.type === "human" ? "You" : "Agent");
      const hint =
        profile.type === "human"
          ? "Your own memory — everything you capture and everything WAKA distils from it."
          : "This agent's own memory, kept separate from yours.";
      return `
        <label class="choice">
          <input type="radio" name="profileId" value="${escapeHtml(profile.id)}"${
            profile.id === input.preselectedId ? " checked" : ""
          } />
          <span>
            <strong>${escapeHtml(label)}</strong>
            <small>${hint}</small>
          </span>
        </label>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>Connect a terminal to WAKA</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
         max-width: 34rem; margin: 4rem auto; padding: 0 1.5rem; line-height: 1.55; }
  h1 { font-size: 1.35rem; font-weight: 600; margin-bottom: .25rem; }
  .who { color: #6b7280; margin-top: 0; }
  fieldset { border: 0; padding: 0; margin: 1.75rem 0; }
  legend { font-weight: 600; margin-bottom: .5rem; }
  .choice { display: flex; gap: .75rem; align-items: flex-start; padding: .85rem 1rem;
            border: 1px solid #d1d5db; border-radius: .6rem; margin-bottom: .6rem; cursor: pointer; }
  .choice:has(input:checked) { border-color: #111827; }
  .choice small { display: block; color: #6b7280; margin-top: .15rem; }
  .actions { display: flex; gap: .75rem; align-items: center; }
  button { font: inherit; padding: .6rem 1.15rem; border-radius: .5rem; border: 1px solid #111827;
           background: #111827; color: #fff; cursor: pointer; }
  .note { color: #6b7280; font-size: .875rem; margin-top: 1.75rem; }
  @media (prefers-color-scheme: dark) {
    .choice { border-color: #374151; } .choice:has(input:checked) { border-color: #e5e7eb; }
    button { background: #e5e7eb; color: #111827; border-color: #e5e7eb; }
  }
</style>
</head>
<body>
  <h1>Connect a terminal to WAKA</h1>
  <p class="who">${asking} is asking to connect as <strong>${escapeHtml(input.accountEmail)}</strong>.</p>

  <form method="post" action="/api/auth/cli/consent">
    <input type="hidden" name="callback" value="${escapeHtml(input.callback)}" />
    <input type="hidden" name="state" value="${escapeHtml(input.state)}" />
    <input type="hidden" name="device" value="${escapeHtml(input.deviceLabel ?? "")}" />
    <input type="hidden" name="consent" value="${escapeHtml(input.consentToken)}" />

    <fieldset>
      <legend>Which memory should it use?</legend>
      ${options}
    </fieldset>

    <div class="actions">
      <button type="submit">Allow</button>
      <span class="note" style="margin:0">Close this tab to refuse.</span>
    </div>
  </form>

  <p class="note">
    The connection lasts 30 days and can be revoked without affecting this browser.
    It can read and add to the memory you choose; only a connection bound to your own
    profile can change or delete what is already there.
  </p>
</body>
</html>`;
}

/**
 * The page has no SPA behind it, so nothing in the web build renders it.
 * Exported so `scripts/render-consent-page.ts` can put it on disk to be
 * looked at.
 */
export const renderConsentPageForPreview = renderConsentPage;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const cliAuthRoutes = new Hono<AuthEnv>();

/**
 * The profiles a session may issue a credential for.
 *
 * Candidates come from the account, never from the request: a caller may
 * name a profile, but only ever one of its own. That is the property this
 * function is here for, and it is the one both routes lean on.
 *
 * The `write` filter is a second, narrower rule — an agent-bound session may
 * read the human profile but must never mint a credential that *acts* as it.
 * Both routes now refuse an agent session at the door, so no request that
 * reaches this helper can exercise that filter any more. It stays rather
 * than being deleted because it is keyed off the access matrix instead of a
 * profile type spelled out here, so it cannot fall behind the matrix, and
 * because the next route to reach for this helper should not have to know
 * that its own middleware is what makes the filter redundant.
 *
 * Keeping it costs a test, and that cost is the point. No route-level
 * assertion in auth-cli.test.ts can reach the filter now — the gate answers
 * first — so deleting the filter outright leaves the whole suite green,
 * which is precisely how a defence decays into a comment claiming a
 * guarantee nothing enforces. Hence the export: the filter is held up by its
 * own tests in auth-cli.test.ts rather than by routes that can no longer
 * see it.
 */
export async function bindableProfiles(
  session: AuthenticatedSession,
): Promise<Array<{ id: string; accountId: string; name: string; type: ProfileType }>> {
  const rows = await getDb()
    .select({
      id: profiles.id,
      accountId: profiles.accountId,
      name: profiles.name,
      type: profiles.type,
    })
    .from(profiles)
    .where(eq(profiles.accountId, session.profile.accountId))
    .orderBy(profiles.type, profiles.createdAt);

  /* The WHERE proved every row is this account's (NULL never equals an id),
     so a room's mind cannot appear here; the narrow states that for the
     types. Write never rides a grant, so the sync matrix answers alone. */
  return rows.flatMap((row) => {
    const held = asAccountProfile(row);
    if (!held) return [];
    return resolveProfileAccess(session, held, "write") === "allowed" ? [held] : [];
  });
}

/**
 * GET /api/auth/cli/start?callback=<loopback-url>&state=<opaque>&profile=<id|name>&device=<label>
 *
 * Renders the consent page. `requireAuth` means an unauthenticated hit gets
 * the standard 401 JSON body rather than a redirect chain through /login —
 * this endpoint is only ever opened by a CLI tool in a browser the person is
 * expected to already be signed into, and the JSON error is enough for the
 * CLI to tell them so.
 *
 * Nothing is minted here. `profile` preselects a choice; the person confirms
 * it on the page.
 */
/*
 * humanSessionsOnly, for the reason account erasure and public handles have
 * it — and for one more that is specific to this pair of routes.
 *
 * `requireAuth` accepts a Bearer token, which is exactly what a CLI/MCP
 * process presents. So both halves of the consent flow were reachable by an
 * agent-bound credential, and `bindableProfiles` let that session bind to
 * *itself*: an agent holding one token could walk /start → /consent →
 * /exchange with no human anywhere in the loop and come out the other side
 * holding a second, independently-revocable 30-day session. Then a third.
 * The consent page was never seen; the "did a person press Allow?" question
 * was answered by the agent.
 *
 * What that breaks is the remedy. sessions.ts is the account holder's
 * documented answer to a misbehaving agent — see the connections a session
 * may end — and it is already human-only for the same reason. But ending a
 * connection only helps if the set of connections shrinks when you end one.
 * If every spare token can mint more, revocation is a race the person loses:
 * they revoke the one they can see, the agent mints two they cannot, and the
 * loop never converges. A remedy that does not terminate is not a remedy.
 *
 * The gate reads the session's bound profile, not its transport, which is
 * the same line every other account-level route draws (sessions.ts and
 * groups.ts write it inline; auth.ts reaches for this middleware). A CLI
 * credential the person minted for their OWN human profile can still walk
 * this flow — it is the person's own credential, and treating "arrived over
 * Bearer" as disqualifying would break the documented header path for no
 * boundary the data model actually recognises.
 *
 * Which makes the narrowing honest but partial, and it should be read that
 * way: what converges now is revocation against an AGENT-bound credential,
 * the population sessions.ts was written for. A human-bound CLI credential
 * can still mint another, so the racing-revocation shape survives for the
 * ordinary "connect Claude Code to my own memory" install. Closing that too
 * needs a different instrument — a live-session cap per account, or
 * requiring an interactive cookie session rather than a Bearer on /consent —
 * not a wider reading of profile type, which is a data-model boundary and
 * not a proxy for "is a person here".
 */
cliAuthRoutes.get("/start", requireAuth, humanSessionsOnly, async (c) => {
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
  const candidates = await bindableProfiles(session);
  if (candidates.length === 0) {
    return c.json({ error: "No profile available to connect" }, 403);
  }

  const requested = (c.req.query("profile") ?? "").trim().toLowerCase();
  const preselected =
    candidates.find(
      (row) => row.id === requested || row.name.toLowerCase() === requested,
    ) ??
    candidates.find((row) => row.id === session.profile.id) ??
    candidates[0]!;

  const deviceLabel =
    (c.req.query("device") ?? "").trim().slice(0, MAX_DEVICE_LABEL_LENGTH) || null;

  return c.html(
    renderConsentPage({
      accountEmail: session.account.email,
      callback: callback.toString(),
      state,
      deviceLabel,
      candidates,
      preselectedId: preselected.id,
      consentToken: await signConsentToken({
        sessionId: session.sessionId,
        callback: callback.toString(),
        state,
      }),
    }),
  );
});

/**
 * POST /api/auth/cli/consent
 *
 * Form target of the consent page. Mints the one-time code and hands it to
 * the loopback callback.
 *
 * humanSessionsOnly here as well as on /start. The reason is thinner than
 * it looks, and worth stating plainly because the obvious reason is wrong.
 *
 * It is NOT that an agent could otherwise still reach the mint. The consent
 * token is an HMAC over the requesting session's own `sessionId`
 * (signConsentToken, up in /start), and the check below re-derives it from
 * `session.sessionId` — so a token minted for the person's browser cannot be
 * replayed by an agent session, and the only route that hands tokens out is
 * the one gated above. Take this middleware away and leave /start's, and the
 * end-to-end attack test fails on its status code alone: no row is written,
 * because the agent never obtains a token that verifies.
 *
 * It is here because the endpoint that writes the row should not be safe
 * only by virtue of a different route's middleware. What makes /start's gate
 * sufficient today is that one `sessionId` inside the MAC — a local detail
 * of a helper in this file, and the first thing a "finish the login on
 * another device" flow would loosen. This is the half that mints; it carries
 * its own lock.
 *
 * The reverse pairing was considered and rejected, though not for the reason
 * it first appears. Gating only /consent would let an agent session render
 * the consent page, but the page it gets back lists only its own profile
 * (the `write` filter in bindableProfiles) and an account email it can
 * already read from GET /api/auth/me — and /start returns that HTML in its
 * own response, never to the callback. So the cost is not disclosure. The
 * cost is that the agent walks away holding a valid consent token, and the
 * mint hangs off that token.
 */
cliAuthRoutes.post("/consent", requireAuth, humanSessionsOnly, async (c) => {
  const form = await c.req.parseBody();
  const readField = (name: string): string =>
    typeof form[name] === "string" ? (form[name] as string) : "";

  const callback = safeLoopbackCallback(readField("callback") || null);
  if (!callback) {
    return c.json(
      { error: "callback must be a http://127.0.0.1 or http://localhost URL" },
      400,
    );
  }

  const state = readField("state").slice(0, MAX_STATE_LENGTH);
  if (!state) {
    return c.json({ error: "state is required" }, 400);
  }

  const session = c.get("session");

  /**
   * The token ties this confirmation to the page that was rendered for this
   * session, this callback, and this state. `SameSite=Lax` already keeps the
   * cookie off a cross-site POST, so this is the second lock rather than the
   * first — but it also means a stale tab cannot replay a confirmation for a
   * callback the person never saw.
   */
  const consentOk = await verifyConsentToken(readField("consent"), {
    sessionId: session.sessionId,
    callback: callback.toString(),
    state,
  });
  if (!consentOk) {
    return c.json({ error: "Consent expired — start the login again" }, 400);
  }

  const candidates = await bindableProfiles(session);
  const target = candidates.find((row) => row.id === readField("profileId"));
  if (!target) {
    return c.json({ error: "Unknown profile" }, 400);
  }

  const deviceLabel = readField("device").trim().slice(0, MAX_DEVICE_LABEL_LENGTH) || null;

  const code = randomCode();
  const codeHash = await hashSessionToken(code);

  await getDb().insert(cliLoginCodes).values({
    profileId: target.id,
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

  // Claim and consume in one statement. A select-then-delete would let two
  // concurrent exchanges of the same code both read the row and both mint a
  // session; DELETE ... RETURNING hands the row to exactly one of them, and
  // the loser sees no row and is told the code is spent. The code transits a
  // loopback URL (local server logs, shell history), so single-use is the
  // property bounding that exposure.
  const rows = await db
    .delete(cliLoginCodes)
    .where(eq(cliLoginCodes.codeHash, codeHash))
    .returning({
      id: cliLoginCodes.id,
      profileId: cliLoginCodes.profileId,
      deviceLabel: cliLoginCodes.deviceLabel,
      expiresAt: cliLoginCodes.expiresAt,
    });

  const row = rows[0];
  if (!row) {
    return c.json({ error: "Invalid or already-used code" }, 400);
  }

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
