// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/platform` supplies a fixture native
 * CredentialStore in place of OS bridges; `fetch` is the network seam and
 * `VITE_API_URL` chooses a fixed fixture origin. Real
 * transport, session ordering, headers, AbortController and Response parsing
 * remain. No Home/data fixture, real account, provider or database is used. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const fixtures = vi.hoisted(() => ({ values: new Map<string, string>() }));
vi.mock('../src/lib/platform', () => ({
  isMobileBuild: true,
  platformServices: async () => ({ credentials: {
    get: async (key: string) => fixtures.values.get(key) ?? null,
    set: async (key: string, value: string) => { fixtures.values.set(key, value); },
    remove: async (key: string) => { fixtures.values.delete(key); },
  } }),
}));
import { apiFetch, nativeSession, revokeRetiredNativeSessions } from '../src/lib/api/transport';
const origin = 'https://dev.waka.im', token = 'synthetic_session_token_account_a';
beforeEach(async () => {
  vi.stubEnv('VITE_API_URL', origin);
  await nativeSession.clear();
  for (const retired of await nativeSession.revocations()) await nativeSession.acknowledgeRevocation(retired);
  fixtures.values.clear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('native resource transport', () => {
  it('uses bearer only at the configured API and preserves resource headers/body', async () => {
    await nativeSession.adopt(token, nativeSession.beginChange());
    const fetch = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal('fetch', fetch);
    const response = await apiFetch(`${origin}/api/inspirations`, { method: 'POST', body: '{"text":"fixture"}', headers: { 'Idempotency-Key': 'fixture-id' } });
    const init = fetch.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('Authorization')).toBe(`Bearer ${token}`);
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe('fixture-id');
    expect(init.credentials).toBe('omit'); expect(init.redirect).toBe('error'); expect(await response.json()).toEqual({ ok: true });
  });
  it.each(['https://waka.im/api/auth/me', 'https://uploads.example.test/file', `${origin}/not-api`, `${origin}/api/health#token`, 'https://other@dev.waka.im/api/auth/me'])('refuses credential disclosure to %s', async url => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(apiFetch(url)).rejects.toThrow('configured WAKA API'); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects caller-chosen authorization', async () => {
    await expect(apiFetch(`${origin}/api/auth/me`, { headers: { Authorization: 'Bearer other' } })).rejects.toThrow('cannot choose');
  });
  it('password/code rejection does not send or revoke an unrelated active session', async () => {
    await nativeSession.adopt(token, nativeSession.beginChange());
    const fetch = vi.fn(async () => new Response(null, { status: 401 })); vi.stubGlobal('fetch', fetch);
    await apiFetch(`${origin}/api/auth/mobile/exchange`, { method: 'POST' });
    expect(new Headers((fetch.mock.calls[0]![1] as RequestInit).headers).has('Authorization')).toBe(false);
    expect(await nativeSession.read()).toBe(token);
  });
  it('clears an active unauthorized session but does not clear a newer sign-in', async () => {
    await nativeSession.adopt(token, nativeSession.beginChange());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    expect((await apiFetch(`${origin}/api/auth/me`)).status).toBe(401); expect(await nativeSession.read()).toBeNull();
    await nativeSession.adopt(token, nativeSession.beginChange());
    vi.stubGlobal('fetch', vi.fn(async () => {
      await nativeSession.adopt('synthetic_session_token_account_b', nativeSession.beginChange());
      return new Response(null, { status: 401 });
    }));
    await apiFetch(`${origin}/api/auth/me`); expect(await nativeSession.read()).toBe('synthetic_session_token_account_b');
  });
  it('forwards cancellation and enforces the body deadline', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener('abort', () => reject(init.signal!.reason), { once: true });
      })));
      const controller = new AbortController(), cancelled = apiFetch(`${origin}/api/auth/me`, { signal: controller.signal });
      const check = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
      await vi.advanceTimersByTimeAsync(0); controller.abort(); await check;
      const timed = apiFetch(`${origin}/api/auth/me`), timeout = expect(timed).rejects.toMatchObject({ name: 'TimeoutError' });
      await vi.advanceTimersByTimeAsync(20_000); await timeout;
    } finally { vi.useRealTimers(); }
  });
  it('retries retired logout with its own credential without reviving the viewer', async () => {
    await nativeSession.adopt(token, nativeSession.beginChange()); await nativeSession.clear();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    await revokeRetiredNativeSessions(); expect(await nativeSession.revocations()).toEqual([token]); expect(await nativeSession.read()).toBeNull();
    const fetch = vi.fn(async () => Response.json({ ok: true })); vi.stubGlobal('fetch', fetch);
    await revokeRetiredNativeSessions(); expect(await nativeSession.revocations()).toEqual([]);
    expect(new Headers((fetch.mock.calls[0]![1] as RequestInit).headers).get('Authorization')).toBe(`Bearer ${token}`);
  });
});
