/** WHAT THIS MOCKS, AND WHY: the database is an in-memory recorder of the two
 * inserts signup makes, and token/session/cookie helpers are stubs. The real
 * handler, Hono and validation run. The claim under test is one column: a
 * name chosen at signup no longer finishes onboarding, because onboarding is
 * now the name AND three first saves (see `pages/Onboarding.tsx` in web). */
import { Hono } from 'hono';
import { beforeEach, expect, it, vi } from 'vitest';

const inserted = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>> }));
vi.mock('../lib/db.js', () => ({
  getDb: () => {
    const insert = () => ({
      values: (values: Record<string, unknown>) => {
        inserted.rows.push(values);
        return {
          returning: async () => [{
            id: values.accountId ? 'profile-1' : 'account-1',
            email: values.email ?? 'new@example.test',
            accountId: values.accountId ?? null,
            onboardingCompletedAt: values.onboardingCompletedAt ?? null,
            type: 'human', name: values.name ?? '', avatarUrl: null,
            preferredLocale: values.preferredLocale ?? 'en-US', publicHandle: null,
            publicProfileEnabled: false, publicTopOfMindEnabled: false, isAdmin: false,
          }],
        };
      },
    });
    const select = () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) });
    return { select, transaction: async (work: (tx: unknown) => unknown) => work({ insert }) };
  },
}));
vi.mock('../lib/auth.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/auth.js')>(),
  hashPassword: vi.fn(async () => 'hashed'),
  signSessionToken: vi.fn(async () => 'signed-token'),
  buildSessionCookie: () => 'waka_session=test; Path=/; HttpOnly',
}));
vi.mock('../lib/login-throttle.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/login-throttle.js')>(),
  mintLoginDeviceCredential: () => 'device',
  buildLoginDeviceCookie: () => 'waka_device=device; Path=/',
}));
vi.mock('../lib/session.js', () => ({ createSessionRow: vi.fn(async () => undefined), describeUserAgent: () => 'test' }));

import { signupHandler } from './auth-password.js';

const app = new Hono().post('/signup', signupHandler);
beforeEach(() => { inserted.rows = []; });

it.each([
  ['with a name', { name: 'Mina', preferredLocale: 'ko-KR' }],
  ['without a name', {}],
])('leaves onboarding open for a new account %s', async (_label, extra) => {
  const response = await app.request('/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'new@example.test', password: 'correct horse battery', ...extra }),
  });
  expect(response.status).toBe(201);
  const account = inserted.rows.find((row) => 'email' in row)!;
  expect(account.onboardingCompletedAt).toBeNull();
  const body = await response.json() as { account: { onboardingCompletedAt: string | null } };
  expect(body.account.onboardingCompletedAt).toBeNull();
});
