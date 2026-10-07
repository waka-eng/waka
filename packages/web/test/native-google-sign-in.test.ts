/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/platform` provides an injected
 * CredentialStore/browser seam; `@capacitor/browser` provides OS dismissal;
 * `fetch` is the network seam and `window` an EventTarget in this Node suite.
 * `VITE_API_URL` and `VITE_APP_ID` choose the dev identity. Real WebCrypto,
 * protocol validation, session ordering and resource transport remain. This
 * does not claim actual provider/OS behavior or mount Home/data fixtures. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ values: new Map<string, string>(), dismissal: undefined as undefined | (() => void),
  browser: vi.fn(async (_url: string) => {}), remove: vi.fn(async () => {}) }));
vi.mock('../src/lib/platform', () => ({ isMobileBuild: true, platformServices: async () => ({
  credentials: { get: async (key: string) => fixture.values.get(key) ?? null,
    set: async (key: string, value: string) => { fixture.values.set(key, value); }, remove: async (key: string) => { fixture.values.delete(key); } },
  openBrowser: fixture.browser,
}) }));
vi.mock('@capacitor/browser', () => ({ Browser: {
  close: async () => {}, addListener: async (_event: string, listener: () => void) => { fixture.dismissal = listener; return { remove: fixture.remove }; },
} }));
import { startNativeGoogleSignIn, hasNativeGoogleSignIn, noteNativeAuthorizationCallback, completeNativeGoogleSignIn, cancelNativeGoogleSignIn } from '../src/lib/platform/google-sign-in';
import { nativeSession } from '../src/lib/api/transport';
const token = 'synthetic_human_session_token_only';
const response = () => Response.json({ token, account: { id: 'account-one' }, profile: { accountId: 'account-one', type: 'human' } });
beforeEach(async () => {
  vi.stubGlobal('window', new EventTarget()); vi.stubEnv('VITE_API_URL', 'https://dev.waka.im'); vi.stubEnv('VITE_APP_ID', 'im.waka.app.dev');
  await cancelNativeGoogleSignIn(); await nativeSession.clear(); fixture.values.clear(); fixture.browser.mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function callback() {
  const pending = JSON.parse(fixture.values.get('auth.authorization')!);
  return `${pending.attempt.callback}?code=${'a'.repeat(43)}&state=${pending.attempt.state}`;
}
it('browser dismissal invalidates a pending attempt without changing a prior account', async () => {
  await nativeSession.adopt(token, nativeSession.beginChange());
  await startNativeGoogleSignIn('/chat/new'); expect(await hasNativeGoogleSignIn()).toBe(true);
  fixture.dismissal!(); expect(await hasNativeGoogleSignIn()).toBe(false); expect(await nativeSession.read()).toBe(token);
});
it('valid URL delivery prevents browser-close from cancelling the in-flight exchange', async () => {
  await startNativeGoogleSignIn('/inspirations/owned-id');
  const raw = callback(); noteNativeAuthorizationCallback(raw); fixture.dismissal!();
  vi.stubGlobal('fetch', vi.fn(async () => response()));
  expect(await completeNativeGoogleSignIn(raw)).toBe('/inspirations/owned-id');
  expect(await nativeSession.read()).toBe(token); expect(await hasNativeGoogleSignIn()).toBe(false);
  expect(fixture.remove).toHaveBeenCalled();
});
it('expiry removes persisted attempts instead of showing a permanent pending state', async () => {
  await startNativeGoogleSignIn('/');
  const saved = JSON.parse(fixture.values.get('auth.authorization')!); saved.attempt.expiresAt = 0;
  fixture.values.set('auth.authorization', JSON.stringify(saved));
  expect(await hasNativeGoogleSignIn()).toBe(false);
});
