/** WHAT THIS MOCKS, AND WHY (gate G6): `fetch` supplies profile, session,
 * and key responses without real credentials. React renders the real settings
 * controls; tests exercise creation, one-time secret display and revocation. */
// @vitest-environment jsdom
// Mock only fetch and the clipboard: exercise the real settings navigation
// and API client without minting credentials on a user's account.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SettingsPanel, type SettingsPanelProps } from '../src/components/SettingsPanel';
import type { ApiAgentKey } from '../src/lib/api/agent-keys';

const noah = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'noah', type: 'agent' };
const another = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'anotherone', type: 'agent' };
const props: SettingsPanelProps = {
  locale: 'en-US', email: 'you@example.test', name: 'You', nameBusy: false, localeBusy: false, failed: false,
  onName() {}, onLocale() {}, onSignOut() {}, onDeleteAccount: async () => {}, onClose() {},
};
const secret = 'waka_agent_test_secret_only';
let host: HTMLDivElement, root: Root, keys: ApiAgentKey[], copied: string[], fail: string | null;
let calls: Array<{ path: string; method: string; body: unknown }>;
const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const key = (id: string, profileId = noah.id): ApiAgentKey => ({
  id, profileId, label: id, prefix: 'waka_agent_12345', createdAt: '2026-10-23T00:00:00Z', lastUsedAt: null, revokedAt: null,
});
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.replace('›', '').trim() === name)!;
const click = async (name: string) => { await act(async () => button(name).click()); };
const input = async (name: string, value: string) => {
  const node = host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  keys = [key('Noah laptop'), key('Another laptop', another.id), { ...key('Old key'), revokedAt: '2026-10-22T00:00:00Z' }];
  calls = []; copied = []; fail = null;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { copied.push(value); } } });
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    const method = init.method ?? 'GET', url = String(path);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: url, method, body });
    if (url.endsWith('/profiles')) return Response.json({ profiles: [noah, another] });
    if (url.endsWith('/sessions')) return Response.json({ sessions: [{
      id: 'sibling-session', profile: another, deviceLabel: 'Other client', current: false,
      createdAt: '2026-10-23T00:00:00Z', lastSeenAt: '2026-10-23T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
    }] });
    if (url.includes('/agent-keys')) {
      if (fail === method) return Response.json({ error: 'Unavailable' }, { status: 500 });
      if (method === 'GET') return Response.json({ keys });
      if (method === 'POST') {
        const made = { ...key('new-key', body.profileId), label: body.label }; keys.push(made);
        return Response.json({ key: { ...made, secret } }, { status: 201 });
      }
      keys = keys.filter(k => !url.endsWith(encodeURIComponent(k.id)));
      return Response.json({ revoked: true });
    }
    throw new Error(`Unexpected ${method} ${url}`);
  }));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard); else Reflect.deleteProperty(navigator, 'clipboard');
});
async function openAgent(profile = noah) {
  await act(async () => root.render(<SettingsPanel {...props} />));
  await click('Agent profiles');
  await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="Connections and API keys for ${profile.name}"]`)!.click());
}

it('opens an agent with no connections and pins setup to its identity', async () => {
  await openAgent();
  expect(host.querySelector('h2')?.textContent).toBe('noah');
  expect(host.textContent).toContain('No live sign-in connections for noah');
  expect(host.textContent).not.toContain('Other client');
  await click('Set up MCP'); await click('Next: Sign in');
  expect(host.querySelector('select')).toBeNull();
  expect(host.textContent).toContain(`--profile '${noah.id}'`);
  expect(host.textContent).not.toContain(another.id);
});

it('shows only active keys for the selected agent and creates nothing on navigation', async () => {
  await openAgent(); await click('API keys');
  expect(host.textContent).toContain('Noah laptop');
  expect(host.textContent).not.toContain('Another laptop');
  expect(host.textContent).not.toContain('Old key');
  expect(calls.some(call => call.method === 'POST')).toBe(false);
});

it('creates a named key for the selected agent, copies it, and never displays it again after leaving', async () => {
  await openAgent(); await click('API keys');
  await input('Key name, e.g. Work laptop', 'Claude desktop'); await click('Create key');
  expect(calls.find(call => call.method === 'POST')?.body).toEqual({ profileId: noah.id, label: 'Claude desktop' });
  expect(host.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(secret);
  await click('Copy key'); expect(copied).toEqual([secret]);
  await click('MCP connections'); await click('API keys');
  expect(host.querySelector('input[readonly]')).toBeNull();
  expect(host.textContent).toContain('Claude desktop');
  expect(host.innerHTML).not.toContain(secret);
});

it('revokes only after confirmation and preserves the agent and other credentials', async () => {
  await openAgent(); await click('API keys'); await click('Revoke key');
  expect(calls.some(call => call.method === 'DELETE')).toBe(false);
  await click('Revoke this key');
  expect(calls.filter(call => call.method === 'DELETE').map(call => call.path)).toEqual(['/api/agent-keys/Noah%20laptop']);
  expect(host.textContent).not.toContain('Noah laptop');
  expect(keys.some(k => k.profileId === another.id)).toBe(true);
  expect(host.querySelector('h2')?.textContent).toBe('noah');
});

it('keeps a key visible when revocation fails and allows retry', async () => {
  await openAgent(); await click('API keys'); await click('Revoke key');
  fail = 'DELETE'; await click('Revoke this key');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not revoke');
  expect(host.textContent).toContain('Noah laptop');
  fail = null; await click('Revoke this key'); expect(host.textContent).not.toContain('Noah laptop');
});

it('retries failed loads and binds configuration to the selected agent', async () => {
  fail = 'GET'; await openAgent(another); await click('API keys');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not load API keys');
  expect(button('Create key')).toBeUndefined();
  fail = null; await click('Refresh');
  expect(host.textContent).toContain('Another laptop');
  expect(host.textContent).not.toContain('Noah laptop');
  const config = host.querySelector('pre')!.textContent!;
  expect(config).toContain(another.id); expect(config).not.toContain(noah.id);
  expect(config).toContain('YOUR_API_KEY');
});

it('never reveals a late key response after navigating to another agent', async () => {
  await openAgent(); await click('API keys');
  const original = vi.mocked(fetch).getMockImplementation()!;
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(fetch).mockImplementation(async (...args) => {
    if (args[1]?.method === 'POST') await pending;
    return original(...args);
  });
  await input('Key name, e.g. Work laptop', 'Pending key'); await click('Create key');
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Back to agent profiles"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Connections and API keys for anotherone"]')!.click());
  await click('API keys');
  await act(async () => { release(); await pending; });
  expect(host.querySelector('h2')?.textContent).toBe('anotherone');
  expect(host.querySelector('input[readonly]')).toBeNull();
  expect(host.innerHTML).not.toContain(secret);
  expect(host.textContent).not.toContain('Pending key');
});
