// @vitest-environment jsdom
/** THE RETURN PATH BELONGS TO THE ACCOUNT THAT LEFT (docs/plans/session-expiry.md, A).
 *
 * WHAT THIS MOCKS, AND WHY: `lib/api` (the network under the AuthProvider),
 * `lib/platform` (to run the same flow as web and as native) and the Google
 * button `components/GoogleSignIn` (it leaves the page; the test reads the
 * destination it was handed) and `components/Companion` (a canvas character
 * jsdom cannot draw, irrelevant to where sign-in lands).
 * The real AuthProvider, RequireAuth, Login page and router run. */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { Location } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ native: false }));
vi.mock('../src/lib/platform', async original => ({
  ...await original<typeof import('../src/lib/platform')>(),
  get isMobileBuild() { return platform.native; },
}));
vi.mock('../src/lib/api', async original => ({
  ...await original<typeof import('../src/lib/api')>(),
  fetchCurrentViewer: vi.fn(), login: vi.fn(), logout: vi.fn(),
}));
vi.mock('../src/components/GoogleSignIn', async original => ({
  ...await original<typeof import('../src/components/GoogleSignIn')>(),
  GoogleSignInButton: ({ returnTo }: { returnTo?: string }) => createElement('a', { 'data-google-return': returnTo ?? '/' }, 'Google'),
}));

vi.mock('../src/components/Companion', () => ({ Companion: () => null }));

import { fetchCurrentViewer, login, logout } from '../src/lib/api';
import { AuthProvider, useAuth, type AuthContextValue } from '../src/lib/auth-context';
import { RequireAuth } from '../src/components/RequireAuth';
import { resolveRedirect } from '../src/lib/sign-in-destination';
import LoginPage from '../src/pages/Login';

function viewerFor(id: string) {
  return {
    account: { id, email: `${id}@example.test`, onboardingCompletedAt: '2026-10-07', isAdmin: false },
    profile: { id: `${id}-profile`, accountId: id, type: 'human' as const, name: id, avatarUrl: null,
      preferredLocale: 'en-US' as const, publicHandle: null, publicProfileEnabled: false, publicTopOfMindEnabled: false },
  };
}
const A = viewerFor('account-a'), B = viewerFor('account-b');

let root: Root, host: HTMLDivElement, auth: AuthContextValue, here: Location;
function Probe() { auth = useAuth(); here = useLocation(); return null; }

async function mountAt(path: string) {
  await act(async () => {
    root.render(createElement(AuthProvider, null, createElement(MemoryRouter, { initialEntries: [path] },
      createElement(Probe),
      createElement(Routes, null,
        createElement(Route, { path: '/login', element: createElement(LoginPage) }),
        createElement(Route, { path: '/', element: createElement('p', null, 'home') }),
        createElement(Route, { path: '/rooms/:id', element: createElement(RequireAuth, null, createElement('p', null, 'room')) })))));
  });
}
async function signInWithForm(email: string) {
  const form = host.querySelector<HTMLFormElement>('form:has(input[name="password"]):not(:has(input[name="name"]))')!;
  const set = (name: string, value: string) => {
    const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  await act(async () => { set('email', email); set('password', 'synthetic-only-password'); });
  await act(async () => { form.requestSubmit(); });
}
async function signOut() {
  vi.mocked(logout).mockImplementation(async () => {
    if (platform.native) window.dispatchEvent(new Event('waka:session-expired'));
  });
  await act(async () => { await auth.logout(); });
}
const googleReturn = () => host.querySelector('[data-google-return]')?.getAttribute('data-google-return');

beforeEach(() => {
  vi.clearAllMocks(); window.localStorage.clear();
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.mocked(fetchCurrentViewer).mockResolvedValue(A);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); platform.native = false; });

describe.each([['web', false], ['native', true]])('%s sign-out', (_name, native) => {
  beforeEach(() => { platform.native = native; });

  it('the same account signing back in returns to where it left', async () => {
    await mountAt('/rooms/r1?tab=2');
    expect(here.pathname).toBe('/rooms/r1');
    await signOut();
    expect(here.pathname).toBe('/login');
    expect(here.state).toEqual({ from: '/rooms/r1?tab=2', owner: A.account.id });
    vi.mocked(login).mockResolvedValue({ ...A, token: 'synthetic-only' });
    await signInWithForm(A.account.email);
    expect(`${here.pathname}${here.search}`).toBe('/rooms/r1?tab=2');
  });

  it('a different account signing in goes home, not to the previous account\'s page', async () => {
    await mountAt('/rooms/r1');
    await signOut();
    vi.mocked(login).mockResolvedValue({ ...B, token: 'synthetic-only' });
    await signInWithForm(B.account.email);
    expect(auth.account?.id).toBe(B.account.id);
    expect(here.pathname).toBe('/');
  });

  it('Google, which cannot know who will sign in, never carries an owned page', async () => {
    await mountAt('/rooms/r1');
    await signOut();
    expect(googleReturn()).toBe('/');
  });
});

it('a cached hint the server rejected claims no owner (dev behaviour for a deep link)', async () => {
  window.localStorage.setItem('waka.auth.viewer', JSON.stringify(A));
  vi.mocked(fetchCurrentViewer).mockResolvedValue(null);
  await mountAt('/rooms/r1');
  expect(here.pathname).toBe('/login');
  expect(here.state).toEqual({ from: '/rooms/r1' });
  expect(googleReturn()).toBe('/rooms/r1');
});

describe('resolveRedirect', () => {
  const at = (state: unknown, search = '') => ({ pathname: '/login', search, hash: '', state, key: 'k' }) as Location;
  it('honours an unowned from for anyone ("Switch account" keeps working)', () => {
    expect(resolveRedirect(at({ from: '/rooms/x' }), 'account-b')).toBe('/rooms/x');
    expect(resolveRedirect(at({ from: '/rooms/x' }))).toBe('/rooms/x');
  });
  it('honours an owned from only for its owner', () => {
    expect(resolveRedirect(at({ from: '/rooms/x', owner: 'account-a' }), 'account-a')).toBe('/rooms/x');
    expect(resolveRedirect(at({ from: '/rooms/x', owner: 'account-a' }), 'account-b')).toBe('/');
    expect(resolveRedirect(at({ from: '/rooms/x', owner: 'account-a' }))).toBe('/');
  });
  it('still runs the owner\'s path through safeInAppPath', () => {
    expect(resolveRedirect(at({ from: '//evil.example', owner: 'account-a' }), 'account-a')).toBe('/');
    expect(resolveRedirect(at({ from: '/login', owner: 'account-a' }), 'account-a')).toBe('/');
  });
});
