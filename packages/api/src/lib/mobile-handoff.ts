import { randomBytes, createHash } from 'node:crypto';
import { sign, verify } from 'hono/jwt';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { mobileLoginCodes, profiles } from '../db/index.js';
import { getDb } from './db.js';

export const MOBILE_BINDING_COOKIE = 'waka_mobile_login';
export const mobileBindingSchema = z.object({
  appId: z.enum(['im.waka.app', 'im.waka.app.dev', 'im.waka.app.test']),
  state: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
export type MobileBinding = z.infer<typeof mobileBindingSchema>;
function secret() {
  const value = process.env.JWT_SECRET ?? process.env.AUTH_SECRET;
  if (!value) throw new Error('Session signing key is unavailable.');
  return value;
}
export function mobileDigest(value: string) { return createHash('sha256').update(value).digest('hex'); }
export function mobileChallenge(verifier: string) { return createHash('sha256').update(verifier).digest('base64url'); }
export function mobileCallback(binding: MobileBinding, values: { code: string } | { error: 'cancelled' | 'failed' | 'expired' }) {
  const params = new URLSearchParams({ ...values, state: binding.state });
  return `${binding.appId}://auth/callback?${params}`;
}
export function signMobileBinding(binding: MobileBinding) {
  return sign({ purpose: 'mobile-google-handoff', binding, exp: Math.floor(Date.now() / 1000) + 600 }, secret(), 'HS256');
}
export async function readMobileBinding(value: string | undefined): Promise<MobileBinding | null> {
  if (!value) return null;
  try {
    const payload = await verify(value, secret(), 'HS256');
    if (payload.purpose !== 'mobile-google-handoff') return null;
    return mobileBindingSchema.parse(payload.binding);
  } catch { return null; }
}
/** Only a resolved human identity can issue a mobile code. */
export async function issueMobileCode(profileId: string, binding: MobileBinding): Promise<string> {
  const db = getDb();
  const [profile] = await db.select({ type: profiles.type }).from(profiles).where(eq(profiles.id, profileId)).limit(1);
  if (profile?.type !== 'human') throw new Error('Mobile sign-in requires a human profile.');
  const code = randomBytes(32).toString('base64url');
  await db.insert(mobileLoginCodes).values({ profileId, appId: binding.appId, stateHash: mobileDigest(binding.state),
    challenge: binding.challenge, codeHash: mobileDigest(code), expiresAt: new Date(Date.now() + 120_000) });
  return code;
}
