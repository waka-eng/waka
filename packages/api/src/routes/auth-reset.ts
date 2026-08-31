/**
 * Getting back into your own memory: requesting a reset letter, and using it.
 *
 * These two handlers are one subject, kept in one file the way signup and
 * login are — the letter's budget exists because of what the request handler
 * refuses to reveal, and neither half is readable without the other.
 *
 * What the request handler must not become is an oracle. It answers 200
 * identically for a known address, an unknown one, an over-budget one, and a
 * throttled-and-refused one is the single exception (429, same as login,
 * because the throttle is per-attempt and an attacker learns only that they
 * are flooding). Whether a letter went anywhere is never in the response.
 *
 * Security posture, in order:
 *   - Every request charges the SAME throttle pool as login, before any
 *     lookup — a reset flood costs what a guessing flood costs. A completed
 *     reset clears the pool, same as a successful login does.
 *   - At most three letters per account per hour, judged from the token
 *     table itself; past that the request 200s and posts nothing.
 *   - The letter's link is built from configured origins only — NEVER from
 *     the request's own Origin/Host, which the requester controls. A forged
 *     origin in a reset letter is a phishing page with a valid token in its
 *     URL.
 *   - Only the SHA-256 of the token is stored; the raw token exists in the
 *     letter alone. Thirty minutes, one use.
 *   - Confirm revokes every session on the account before answering — a
 *     reset is a recovery act, and the sessions it ends may be the reason
 *     the person is here.
 *
 * A Google-only account (no passwordHash) may reset: proving control of the
 * address is the same proof signup accepts, and the person who lost their
 * Google access keeps their memory. The reset simply gives the account its
 * password door.
 */
import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, inArray, isNull } from "drizzle-orm";
import { type Context } from "hono";
import { getCookie } from "hono/cookie";
import { z } from "zod";

import {
  accounts,
  passwordResets,
  profiles,
  sessions,
} from "../db/index.js";
import { buildSessionCookie, hashPassword, signSessionToken, wantsSecureCookie } from "../lib/auth.js";
import { getDb } from "../lib/db.js";
import { sendEmail } from "../lib/email.js";
import {
  buildLoginDeviceCookie,
  clearLoginFailures,
  judgeLoginThrottle,
  LOGIN_DEVICE_COOKIE_NAME,
  mintLoginDeviceCredential,
  readLoginDeviceCredential,
  readLoginThrottle,
  readRequestOrigin,
  recordLoginFailure,
  resolveLoginSource,
} from "../lib/login-throttle.js";
import type { AuthEnv } from "../lib/middleware.js";
import { createSessionRow, describeUserAgent } from "../lib/session.js";
import { validationDetails } from "../lib/validation.js";
import {
  accountColumns,
  profileColumns,
  serializeAccount,
  serializeProfile,
} from "./auth-identity.js";

/** The letter opens the door this long. Short on purpose: the link is a
    bearer credential for the whole memory, sitting in an inbox. */
export const PASSWORD_RESET_TTL_MINUTES = 30;
/** Letters per account per hour. The fourth request 200s and posts nothing. */
export const PASSWORD_RESET_LETTERS_PER_HOUR = 3;

const requestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Invalid email address").max(254),
});

const confirmSchema = z.object({
  token: z.string().min(20).max(200),
  /* the same floor signup enforces, for the same reason — bcrypt does the
     hard work, and character-class rules push people toward patterns */
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * The origin the letter's link points at — configuration only, never the
 * request. One origin serves both the API and the web bundle in every
 * deployment of this stack, so the API's public URL is the web's too.
 */
function getLetterOrigin(): string {
  const explicit =
    process.env.WAKA_WEB_ORIGIN ??
    process.env.PUBLIC_API_URL ??
    process.env.VITE_API_URL;
  if (explicit && explicit.length > 0) return explicit.replace(/\/$/, "");
  // The local stack's one origin; matches pnpm dev:local.
  return "http://localhost:3010";
}

/** The letter, in the person's own language. */
function composeResetLetter(locale: string, link: string): { subject: string; text: string } {
  if (locale === "ko-KR") {
    return {
      subject: "메모리로 돌아가는 길",
      text:
        "이 주소로 WAKA 비밀번호 재설정 요청이 있었어요. 본인이 맞다면, " +
        "아래 링크가 앞으로 30분 동안 문을 열어 줍니다.\n\n" +
        `${link}\n\n` +
        "본인이 아니라면 이 편지는 무시하세요 — 링크 없이는 아무것도 바뀌지 않아요.",
    };
  }
  return {
    subject: "The way back into your memory",
    text:
      "Someone asked to reset the password for this address at WAKA. " +
      "If it was you, this link opens the door for the next thirty minutes.\n\n" +
      `${link}\n\n` +
      "If it wasn't you, ignore this letter — nothing changes without it.",
  };
}

/**
 * POST /api/auth/reset/request
 *
 * Always 200 (throttle refusals excepted). The work happens, or quietly does
 * not, behind that one answer.
 */
export async function resetRequestHandler(c: Context<AuthEnv>): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }
  const parsed = requestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: "Invalid reset payload", details: validationDetails(parsed.error) }, 400);
  }

  const { email } = parsed.data;
  const db = getDb();
  const now = new Date();

  // Throttle first, lookup after — same order and same pool as login.
  const deviceId = readLoginDeviceCredential(getCookie(c, LOGIN_DEVICE_COOKIE_NAME), email, { now });
  const reading = await readLoginThrottle(
    db,
    { identifier: email, source: resolveLoginSource(readRequestOrigin(c)), deviceId },
    { now },
  );
  const verdict = judgeLoginThrottle(reading);
  if (verdict.refused) {
    c.header("Retry-After", String(verdict.retryAfterSeconds));
    return c.json(
      { error: "Too many attempts. Wait a few minutes and try again." },
      429,
    );
  }
  await recordLoginFailure(db, reading);

  const done = () => c.json({ ok: true }, 200);

  const rows = await db
    .select({
      accountId: accounts.id,
      preferredLocale: profiles.preferredLocale,
    })
    .from(accounts)
    .innerJoin(profiles, and(eq(profiles.accountId, accounts.id), eq(profiles.type, "human")))
    .where(eq(accounts.email, email))
    .limit(1);
  const candidate = rows[0];
  if (!candidate) return done();

  // The letter budget, judged from the token table itself.
  const recent = await db
    .select({ id: passwordResets.id })
    .from(passwordResets)
    .where(
      and(
        eq(passwordResets.accountId, candidate.accountId),
        gt(passwordResets.createdAt, new Date(now.getTime() - 60 * 60 * 1000)),
      ),
    );
  if (recent.length >= PASSWORD_RESET_LETTERS_PER_HOUR) return done();

  const token = randomBytes(32).toString("base64url");
  await db.insert(passwordResets).values({
    accountId: candidate.accountId,
    tokenHash: hashResetToken(token),
    expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MINUTES * 60 * 1000),
  });

  const letter = composeResetLetter(
    candidate.preferredLocale ?? "en-US",
    `${getLetterOrigin()}/reset?token=${token}`,
  );
  await sendEmail({ to: email, subject: letter.subject, text: letter.text });

  return done();
}

/**
 * POST /api/auth/reset/confirm
 *
 * One generic failure for every bad token — expired, spent, unknown — so the
 * message never says which. Success finishes exactly the way login does: the
 * person lands inside their memory, holding the only session that survived.
 */
export async function resetConfirmHandler(c: Context<AuthEnv>): Promise<Response> {
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }
  const parsed = confirmSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json({ error: "Invalid reset payload", details: validationDetails(parsed.error) }, 400);
  }

  const { token, password } = parsed.data;
  const db = getDb();
  const now = new Date();

  const rows = await db
    .select({
      resetId: passwordResets.id,
      account: accountColumns,
      profile: { ...profileColumns, accountId: accounts.id },
    })
    .from(passwordResets)
    .innerJoin(accounts, eq(accounts.id, passwordResets.accountId))
    .innerJoin(profiles, and(eq(profiles.accountId, accounts.id), eq(profiles.type, "human")))
    .where(
      and(
        eq(passwordResets.tokenHash, hashResetToken(token)),
        isNull(passwordResets.usedAt),
        gt(passwordResets.expiresAt, now),
      ),
    )
    .limit(1);
  const match = rows[0];
  if (!match) {
    return c.json({ error: "That letter has expired or was already used. Ask for a new one." }, 400);
  }

  await db
    .update(passwordResets)
    .set({ usedAt: now })
    .where(eq(passwordResets.id, match.resetId));
  await db
    .update(accounts)
    .set({ passwordHash: await hashPassword(password), updatedAt: now })
    .where(eq(accounts.id, match.account.id));

  // Every session on the account ends here — agent profiles' included. The
  // sessions a reset sweeps away may be exactly why the person needed one.
  const accountProfiles = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.accountId, match.account.id));
  if (accountProfiles.length > 0) {
    await db.delete(sessions).where(
      inArray(
        sessions.profileId,
        accountProfiles.map((p) => p.id),
      ),
    );
  }

  // A proven owner starts clean, same as a successful login.
  const deviceId = readLoginDeviceCredential(
    getCookie(c, LOGIN_DEVICE_COOKIE_NAME),
    match.account.email,
    { now },
  );
  const reading = await readLoginThrottle(
    db,
    {
      identifier: match.account.email,
      source: resolveLoginSource(readRequestOrigin(c)),
      deviceId,
    },
    { now },
  );
  await clearLoginFailures(db, reading);

  const sessionToken = await signSessionToken({
    profileId: match.profile.id,
    email: match.account.email,
  });
  await createSessionRow({
    profileId: match.profile.id,
    token: sessionToken,
    deviceLabel: describeUserAgent(c.req.header("user-agent")),
  });
  c.header("Set-Cookie", buildSessionCookie(sessionToken));
  c.header(
    "Set-Cookie",
    buildLoginDeviceCookie(mintLoginDeviceCredential(match.account.email, { now }), {
      secure: wantsSecureCookie(),
    }),
    { append: true },
  );

  return c.json(
    {
      account: serializeAccount(match.account),
      profile: serializeProfile(match.profile),
      token: sessionToken,
    },
    200,
  );
}
