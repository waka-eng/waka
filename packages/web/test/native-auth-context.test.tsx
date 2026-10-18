// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` is directly beneath the
 * AuthProvider; `lib/platform` enables native-only behavior. OS/network work
 * is replaced, not the real auth state machine, React lifecycle or DOM events.
 * This never mounts Home or any data fixture. */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('../src/lib/platform', () => ({ isMobileBuild: true }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), fetchCurrentViewer: vi.fn(async () => null), login: vi.fn(), logout: vi.fn() }));
import { login, logout } from '../src/lib/api';
import { AuthProvider, useAuth, type AuthContextValue } from '../src/lib/auth-context';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from '../src/pages/Login';
const account = { id: 'synthetic-account', email: 'fixture@example.test', onboardingCompletedAt: '2026-10-07', isAdmin: false };
const profile = { id: 'synthetic-profile', accountId: account.id, type: 'human' as const, name: 'Fixture', avatarUrl: null,
  preferredLocale: 'en-US' as const, publicHandle: null, publicProfileEnabled: false, publicTopOfMindEnabled: false };
let root: Root, host: HTMLDivElement, auth: AuthContextValue;
function Reader() { auth = useAuth(); return createElement('p', null, auth.account?.id ?? 'signed out'); }
beforeEach(async () => {
  vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => { root.render(createElement(AuthProvider, null, createElement(Reader))); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it('late logout completion cannot wipe a newer native sign-in', async () => {
  let finish!: () => void;
  vi.mocked(logout).mockImplementation(async () => {
    window.dispatchEvent(new Event('waka:session-expired'));
    await new Promise<void>(resolve => { finish = resolve; });
  });
  let pending!: Promise<void>;
  await act(async () => { pending = auth.logout(); });
  vi.mocked(login).mockResolvedValue({ account, profile, token: 'synthetic-only' });
  await act(async () => { await auth.login({ email: account.email, password: 'synthetic-only' }); });
  await act(async () => { finish(); await pending; });
  expect(auth.account?.id).toBe(account.id);
});
/* The store's expiry event is ignored during a logout, so the sign-out has
   to clear the viewer itself — or a native person who pressed Sign out
   stayed signed in. And it lands on the ordinary door, not "you were
   signed out". */
it('a native sign-out from a signed-in session signs out and shows the ordinary door', async () => {
  await act(async () => root.unmount());
  root = createRoot(host);
  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(AuthProvider, null, createElement(Reader), createElement(LoginPage))));
  });
  vi.mocked(login).mockResolvedValue({ account, profile, token: 'synthetic-only' });
  await act(async () => { await auth.login({ email: account.email, password: 'synthetic-only' }); });
  expect(auth.isAuthenticated).toBe(true);
  vi.mocked(logout).mockImplementation(async () => { window.dispatchEvent(new Event('waka:session-expired')); });
  await act(async () => { await auth.logout(); });
  expect(auth.isAuthenticated, 'Sign out left the native session signed in').toBe(false);
  expect(auth.sessionExpired, 'a deliberate sign-out read as an expiry').toBeNull();
  expect(host.textContent).toContain('Welcome back.');
  expect(host.textContent).not.toContain('You were signed out.');
});
it('a failed durable retirement does not claim a successful sign-out', async () => {
  vi.mocked(login).mockResolvedValue({ account, profile, token: 'synthetic-only' });
  await act(async () => { await auth.login({ email: account.email, password: 'synthetic-only' }); });
  vi.mocked(logout).mockRejectedValue(new Error('secure retirement failed'));
  await act(async () => { await expect(auth.logout()).rejects.toThrow('secure retirement failed'); });
  expect(auth.account?.id).toBe(account.id);
});
