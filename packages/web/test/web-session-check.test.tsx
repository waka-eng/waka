// @vitest-environment jsdom
/** A WEB 401 ASKS; `/auth/me` ANSWERS (docs/plans/session-expiry.md, B).
 *
 * WHAT THIS MOCKS, AND WHY: `lib/api`'s `fetchCurrentViewer`/`login`/`logout`
 * for the provider tests (the network beneath it), `lib/platform` (pinned to
 * the web build, where the cookie is invisible to script) and global `fetch`
 * for the transport test. The real AuthProvider state machine, transport, React
 * lifecycle and DOM events run. */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/platform', async original => ({ ...await original<typeof import('../src/lib/platform')>(), isMobileBuild: false }));
vi.mock('../src/lib/api', async original => ({
  ...await original<typeof import('../src/lib/api')>(),
  fetchCurrentViewer: vi.fn(), login: vi.fn(), logout: vi.fn(async () => undefined),
}));

import { ApiError, fetchCurrentViewer, login, logout } from '../src/lib/api';
import { apiFetch } from '../src/lib/api/transport';
import { AuthProvider, useAuth, type AuthContextValue } from '../src/lib/auth-context';

function viewerFor(id: string) {
  return {
    account: { id, email: `${id}@example.test`, onboardingCompletedAt: '2026-10-07', isAdmin: false },
    profile: { id: `${id}-profile`, accountId: id, type: 'human' as const, name: id, avatarUrl: null,
      preferredLocale: 'en-US' as const, publicHandle: null, publicProfileEnabled: false, publicTopOfMindEnabled: false },
  };
}
const A = viewerFor('account-a'), B = viewerFor('account-b');
const stray401 = () => window.dispatchEvent(new Event('waka:session-check'));
const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }

describe('transport', () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it('a web 401 from a resource asks for a check and still passes through', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const heard = vi.fn(); window.addEventListener('waka:session-check', heard);
    const response = await apiFetch('/api/rooms', { method: 'POST' });
    expect(response.status).toBe(401);
    expect(heard).toHaveBeenCalledTimes(1);
    await apiFetch('/api/rooms');
    expect(heard).toHaveBeenCalledTimes(2);
    window.removeEventListener('waka:session-check', heard);
  });
  it('an auth endpoint 401 (wrong password, signed-out /auth/me) asks nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const heard = vi.fn(); window.addEventListener('waka:session-check', heard);
    await apiFetch('/api/auth/login', { method: 'POST' });
    await apiFetch('/api/auth/me');
    expect(heard).not.toHaveBeenCalled();
    window.removeEventListener('waka:session-check', heard);
  });
});

describe('provider', () => {
  let root: Root, host: HTMLDivElement, auth: AuthContextValue;
  function Reader() { auth = useAuth(); return null; }
  beforeEach(async () => {
    vi.resetAllMocks(); window.localStorage.clear();
    vi.mocked(logout).mockResolvedValue(undefined);
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(fetchCurrentViewer).mockResolvedValue(A);
    await act(async () => { root.render(createElement(AuthProvider, null, createElement(Reader))); });
    expect(auth.account?.id).toBe(A.account.id);
    vi.mocked(fetchCurrentViewer).mockClear();
  });
  afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

  it('a session the server confirms ended signs the viewer out (the door opens)', async () => {
    vi.mocked(fetchCurrentViewer).mockResolvedValue(null);
    await act(async () => { stray401(); });
    await flush();
    expect(auth.isAuthenticated).toBe(false);
    expect(auth.serverUnreachable).toBe(false);
  });

  it('a stale 401 never ends the session the server still confirms', async () => {
    await act(async () => { stray401(); });
    await flush();
    expect(fetchCurrentViewer).toHaveBeenCalledTimes(1);
    expect(auth.account?.id).toBe(A.account.id);
  });

  it('a late signed-out answer cannot erase a different account that signed in meanwhile', async () => {
    const answer = deferred<null>();
    vi.mocked(fetchCurrentViewer).mockReturnValueOnce(answer.promise);
    await act(async () => { stray401(); });
    await act(async () => { await auth.logout(); });
    vi.mocked(login).mockResolvedValue({ ...B, token: 'synthetic-only' });
    await act(async () => { await auth.login({ email: B.account.email, password: 'synthetic-only' }); });
    await act(async () => { answer.resolve(null); });
    await flush();
    expect(auth.account?.id).toBe(B.account.id);
  });

  it('a 401 during web sign-out, and during sign-in, does nothing', async () => {
    const leaving = deferred<void>();
    vi.mocked(logout).mockReturnValueOnce(leaving.promise);
    let pending!: Promise<void>;
    await act(async () => { pending = auth.logout(); });
    await act(async () => { stray401(); });
    await act(async () => { leaving.resolve(); await pending; });
    const signingIn = deferred<typeof A & { token: string }>();
    vi.mocked(login).mockReturnValueOnce(signingIn.promise);
    let signedIn!: Promise<unknown>;
    await act(async () => { signedIn = auth.login({ email: A.account.email, password: 'synthetic-only' }); });
    await act(async () => { stray401(); });
    await act(async () => { signingIn.resolve({ ...A, token: 'synthetic-only' }); await signedIn; });
    expect(fetchCurrentViewer).not.toHaveBeenCalled();
    expect(auth.account?.id).toBe(A.account.id);
  });

  it('an unanswered check changes nothing and claims nothing', async () => {
    vi.mocked(fetchCurrentViewer).mockRejectedValue(new ApiError({ status: 0, message: 'offline' }));
    await act(async () => { stray401(); });
    await flush();
    expect(auth.account?.id).toBe(A.account.id);
    expect(auth.serverUnreachable).toBe(false);
  });

  it('a check in flight coalesces 401s but never swallows a later expiry', async () => {
    const first = deferred<typeof A>();
    vi.mocked(fetchCurrentViewer).mockReturnValueOnce(first.promise);
    await act(async () => { stray401(); stray401(); stray401(); });
    expect(fetchCurrentViewer).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(A); });
    await flush();
    vi.mocked(fetchCurrentViewer).mockResolvedValue(null);
    await act(async () => { stray401(); });
    await flush();
    expect(fetchCurrentViewer).toHaveBeenCalledTimes(2);
    expect(auth.isAuthenticated).toBe(false);
  });
});
