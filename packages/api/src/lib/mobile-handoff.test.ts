import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mobileBindingSchema, readMobileBinding, signMobileBinding, mobileCallback, mobileChallenge } from './mobile-handoff.js';
beforeEach(() => vi.stubEnv('JWT_SECRET', 'synthetic-mobile-binding-signing-key-only'));
afterEach(() => vi.unstubAllEnvs());
const binding = { appId: 'im.waka.app.dev' as const, state: randomBytes(32).toString('base64url'), challenge: randomBytes(32).toString('base64url') };
it('binds signed browser context and refuses tampering or expiry', async () => {
  const token = await signMobileBinding(binding);
  expect(await readMobileBinding(token)).toEqual(binding);
  expect(await readMobileBinding(token.slice(0, -5) + 'other')).toBeNull();
  vi.useFakeTimers();
  try { vi.setSystemTime(Date.now() + 601_000); expect(await readMobileBinding(token)).toBeNull(); }
  finally { vi.useRealTimers(); }
});
it('callbacks expose only an opaque code or error and app state, never a session', () => {
  const callback = mobileCallback(binding, { code: 'synthetic_code' });
  expect(callback).toBe(`im.waka.app.dev://auth/callback?code=synthetic_code&state=${binding.state}`);
  expect(mobileCallback(binding, { error: 'cancelled' })).toContain('error=cancelled');
});
it('refuses foreign identities, malformed state/challenge and extra redirects', () => {
  for (const input of [ { ...binding, appId: 'foreign.app' }, { ...binding, state: 'short' }, { ...binding, challenge: 'bad' }, { ...binding, callback: 'https://evil.test' } ]) {
    expect(mobileBindingSchema.safeParse(input).success).toBe(false);
  }
  expect(mobileChallenge('synthetic-verifier')).toHaveLength(43);
});
