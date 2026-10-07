import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { z } from 'zod';
import { and, eq, gt } from 'drizzle-orm';
import { accounts, mobileLoginCodes, profiles, sessions } from '../db/index.js';
import { getDb } from '../lib/db.js';
import { signSessionToken, SESSION_TTL_SECONDS, wantsSecureCookie } from '../lib/auth.js';
import { hashSessionToken } from '../lib/session.js';
import { getOAuthRedirectOrigin } from '../lib/google-oauth.js';
import { MOBILE_BINDING_COOKIE, mobileBindingSchema, mobileChallenge, mobileDigest, signMobileBinding } from '../lib/mobile-handoff.js';
import { loadIdentity, serializeAccount, serializeProfile } from './auth-identity.js';

export const mobileAuthRoutes = new Hono();
mobileAuthRoutes.get('/google', async c => {
  const parsed = mobileBindingSchema.safeParse(c.req.query());
  if (!parsed.success) return c.json({ error: 'Invalid sign-in request' }, 400);
  const origin = new URL(process.env.PUBLIC_WEB_URL ?? getOAuthRedirectOrigin());
  const fixture = process.env.WAKA_MOBILE_FIXTURE_RUN === '1' && ['localhost', '127.0.0.1'].includes(origin.hostname) &&
    ['localhost', '127.0.0.1'].includes(new URL(process.env.DB_CONNECTION_URL ?? 'https://invalid').hostname);
  const expectedApp = fixture ? 'im.waka.app.test' : origin.hostname === 'waka.im' ? 'im.waka.app' : 'im.waka.app.dev';
  if (!['waka.im', 'dev.waka.im', 'localhost', '127.0.0.1'].includes(origin.hostname) || parsed.data.appId !== expectedApp) {
    return c.json({ error: 'Unexpected app identity' }, 400);
  }
  setCookie(c, MOBILE_BINDING_COOKIE, await signMobileBinding(parsed.data), {
    httpOnly: true, sameSite: 'Lax', secure: wantsSecureCookie(), path: '/', maxAge: 600,
  });
  // Google still redirects to the existing registered HTTPS server callback,
  // not to a custom Android scheme or the embedded app WebView.
  return c.redirect('/api/auth/google/login?mobile=1', 302);
});

const exchangeSchema = mobileBindingSchema.omit({ challenge: true }).extend({
  code: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
}).strict();
mobileAuthRoutes.post('/exchange', async c => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid sign-in request' }, 400); }
  const parsed = exchangeSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid sign-in request' }, 400);
  const input = parsed.data;
  const result = await getDb().transaction(async tx => {
    // Atomic predicate + DELETE prevents concurrent/replayed exchanges. A
    // wrong verifier cannot consume the legitimate app's matching code.
    const [code] = await tx.delete(mobileLoginCodes).where(and(
      eq(mobileLoginCodes.codeHash, mobileDigest(input.code)), eq(mobileLoginCodes.appId, input.appId),
      eq(mobileLoginCodes.stateHash, mobileDigest(input.state)), eq(mobileLoginCodes.challenge, mobileChallenge(input.verifier)),
      gt(mobileLoginCodes.expiresAt, new Date()),
    )).returning({ profileId: mobileLoginCodes.profileId });
    if (!code) return null;
    const [identity] = await tx.select({ email: accounts.email }).from(profiles).innerJoin(accounts, eq(accounts.id, profiles.accountId))
      .where(and(eq(profiles.id, code.profileId), eq(profiles.type, 'human'))).limit(1);
    if (!identity) return null;
    const token = await signSessionToken({ profileId: code.profileId, email: identity.email });
    await tx.insert(sessions).values({ profileId: code.profileId, tokenHash: await hashSessionToken(token),
      deviceLabel: input.appId === 'im.waka.app' ? 'WAKA mobile' : 'WAKA mobile (dev)',
      expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) });
    const viewer = await loadIdentity(tx, code.profileId);
    if (!viewer) throw new Error('Identity changed during sign-in.');
    return { token, account: serializeAccount(viewer.account), profile: serializeProfile(viewer.profile) };
  });
  if (!result) return c.json({ error: 'Sign-in expired or was already used. Please try again.' }, 401);
  return c.json(result);
});
