/** WHAT THIS MOCKS, AND WHY (gate G6): `fetch` supplies profile, session,
 * and key responses without real credentials. React renders the real Connect
 * page; tests exercise connecting, one-time key display and Disconnect. */
// @vitest-environment jsdom
// Mock only fetch and the clipboard: exercise the real settings navigation
// and API client without minting credentials on a user's account.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectPanel, type SettingsPanelProps } from '../src/components/SettingsPanel';
import type { ApiProfileKey } from '../src/lib/api/profile-keys';

const noah = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'noah', type: 'agent' };
const another = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'anotherone', type: 'agent' };
const personal = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'You', type: 'human' };
const secret = 'waka_agent_test_secret_only';
let host: HTMLDivElement, root: Root, keys: ApiProfileKey[], copied: string[], fail: string | null;
let calls: Array<{ path: string; method: string; body: unknown }>;
const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const key = (id: string, profileId = noah.id): ApiProfileKey => ({
  id, profileId, label: id, prefix: 'waka_agent_12345', createdAt: '2026-10-23T00:00:00Z', lastUsedAt: null, revokedAt: null,
});
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')]
  .find(b => (b.getAttribute('aria-label') ?? b.textContent?.replace('›', '').trim()) === name)!;
const click = async (name: string) => { await act(async () => button(name).click()); };
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
    if (url.endsWith('/profiles')) return fail === 'profiles'
      ? Response.json({ error: 'Unavailable' }, { status: 500 })
      : Response.json({ profiles: [personal, noah, another] });
    if (url.endsWith('/sessions')) return Response.json({ sessions: [{
      id: 'sibling-session', profile: another, deviceLabel: 'Other client', current: false,
      createdAt: '2026-10-23T00:00:00Z', lastSeenAt: '2026-10-23T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
    }] });
    if (url.includes('/agent-keys') || url.includes('/keeper-keys')) {
      if (fail === method) return Response.json({ error: 'Unavailable' }, { status: 500 });
      if (method === 'GET') return Response.json({ keys });
      if (method === 'POST') {
        const made = { ...key('new-key', url.includes('/keeper-keys') ? personal.id : body.profileId), label: body.label, ...(body.access ? {access:body.access} : {}) }; keys.push(made);
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

const card = (name: string) => host.querySelector<HTMLElement>(`section.waka-connect-tool[aria-label="${name}"]`)!;
const openCard = async (name: string) => { await act(async () => card(name).querySelector<HTMLButtonElement>('.waka-connect-tool-head')!.click()); };

it('shows one card per tool, then a card for every other live personal key, and nothing else', async () => {
  keys.push(key('Personal laptop', personal.id), { ...key('Old personal key', personal.id), revokedAt: '2026-10-22T00:00:00Z' });
  await openPersonal();
  expect(host.querySelector('h2')?.textContent).toBe('Connect');
  expect(host.querySelector('#waka-connect-tools')?.textContent).toBe('Let your AI tools know you');
  expect([...host.querySelectorAll('section.waka-connect-tool')].map(node => node.getAttribute('aria-label')))
    .toEqual(['Claude Code', 'Codex', 'Personal laptop', 'Browser button']);
  /* A key made before Connect, by any name, stays in sight and can be cut off. */
  expect(card('Personal laptop').classList.contains('waka-connect-tool--on')).toBe(true);
  for (const hidden of ['Old personal key', 'Noah laptop', 'Another laptop']) expect(host.textContent).not.toContain(hidden);
  expect(host.textContent, 'the plumbing words are gone from Connect').not.toMatch(/MCP|API key|Keys and details/);
  expect(calls.map(c => c.path)).toEqual(CONNECT_READS());
  expect(calls.every(c => c.method === 'GET')).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  expect(closed, 'Close on Connect did not close it').toBe(1);
});

it('copies a profile-bound setup message that never carries a secret and points back to Connect', async () => {
  await openPersonal();
  await openCard('Codex');
  await click('Copy the message');
  const prompt = copied.at(-1)!;
  const details = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1]!);
  expect(details).toMatchObject({ profileId: personal.id, profileType: 'human', serverName: `waka-${personal.id}`, scope: 'current project only' });
  expect(prompt).toContain('Codex');
  expect(prompt).toContain('under Connect (the linked rings');
  expect(prompt).not.toContain('Settings →');
  expect(prompt).toContain('Do not use browser login');
  expect(prompt).toContain('Never ask me to paste the key into chat');
  expect(prompt).not.toContain(noah.id); expect(prompt).not.toContain(secret);
  expect(calls.some(c => c.method === 'POST'), 'copying made a key').toBe(false);
});

it('asks once before Disconnect, then cuts off only that key', async () => {
  keys.push(key('Personal laptop', personal.id));
  await openPersonal();
  await openCard('Personal laptop');
  await click('Disconnect');
  expect(calls.some(c => c.method === 'DELETE')).toBe(false);
  expect(host.textContent).toContain('Everything saved stays');
  await click('Cancel');
  expect(host.textContent).not.toContain('Everything saved stays');
  await click('Disconnect'); await click('Disconnect');
  expect(calls.filter(c => c.method === 'DELETE').map(c => c.path)).toEqual(['/api/keeper-keys/Personal%20laptop']);
  expect(host.querySelector('section.waka-connect-tool[aria-label="Personal laptop"]')).toBeNull();
  expect(keys.filter(k => k.profileId === noah.id)).toHaveLength(2);
});

it('retries a failed personal profile load and speaks Korean', async () => {
  fail = 'profiles'; await openPersonal('ko-KR');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('내 프로필을 불러오지 못했어요');
  expect(calls.every(c => c.path === '/api/profiles')).toBe(true);
  fail = null;
  await act(async () => host.querySelector<HTMLButtonElement>('.waka-settings-erase')!.click());
  expect(host.querySelector('#waka-connect-tools')?.textContent).toBe('AI 도구가 나를 알게 하기');
  await openCard('Claude Code');
  await click('메시지 복사');
  expect(copied.at(-1)).toContain('브라우저 로그인이나 에이전트 프로필 생성을 사용하지 마세요');
  expect(copied.at(-1)).toContain(personal.id);
});

it('does not fall back to an agent when the personal profile is unavailable', async () => {
  vi.mocked(fetch).mockImplementation(async () => Response.json({ profiles: [noah, another] }));
  await openPersonal();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load your profile');
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  expect(host.querySelector('section.waka-connect-tool[aria-label="Claude Code"]')).toBeNull();
});

it('does not display a returned key bound to a different profile', async () => {
  await openPersonal();
  await openCard('Claude Code');
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((...args) => args[1]?.method === 'POST'
    ? Promise.resolve(Response.json({ key: { ...key('wrong-profile'), secret } })) : original(...args));
  await click('Make the key');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t create the key');
  expect(host.innerHTML).not.toContain(secret);
});

it('says keys could not load, and Try again recovers', async () => {
  fail = 'GET';
  await openPersonal();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t');
  fail = null;
  await act(async () => host.querySelector<HTMLButtonElement>('.waka-connect-tools ~ * .waka-over-clear, [role="alert"] .waka-over-clear')!.click());
  expect(card('Claude Code').textContent).toContain('Not connected');
});

it('keeps the setup message copyable by hand if clipboard access fails', async () => {
  await openPersonal();
  await openCard('Claude Code');
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
  await click('Copy the message');
  expect(host.textContent).toContain('Select the text and copy it yourself');
  expect(host.textContent).toContain(personal.id);
  expect(host.textContent).toContain('waka_verify_connection');
});

/* Use WAKA in Claude Code or Codex lives on Connect, a home door of its own
   (founder, 2026-11-27), not inside Settings. */
let closed = 0;
const CONNECT_READS = () => ['/api/profiles', '/api/keeper-keys', `/api/mcp-reads?profile=${personal.id}`];
async function openPersonal(locale: SettingsPanelProps['locale'] = 'en-US') {
  closed = 0;
  await act(async () => root.render(<ConnectPanel locale={locale} onClose={() => { closed += 1; }} />));
}

it('connects a tool in plain words: a key named after it lights its card, and Disconnect puts it out', async () => {
  keys = [];
  await openPersonal();
  const card = (name: string) => host.querySelector<HTMLElement>(`section.waka-connect-tool[aria-label="${name}"]`)!;
  expect(card('Claude Code').textContent).toContain('Not connected');
  expect(host.querySelector('.waka-connect-tools')?.textContent, 'the cards speak plumbing').not.toMatch(/MCP|API/);
  await act(async () => card('Claude Code').querySelector<HTMLButtonElement>('.waka-connect-tool-head')!.click());
  await click('Make the key');
  expect(calls.find(c => c.method === 'POST')).toEqual({ path: '/api/keeper-keys', method: 'POST', body: { label: 'Claude Code', access: 'read_only' } });
  expect(host.textContent).toContain(secret);
  await click('Copy the message');
  expect(copied.at(-1)).toContain(personal.id);
  await click('Done');
  expect(card('Claude Code').classList.contains('waka-connect-tool--on')).toBe(true);
  expect(card('Claude Code').textContent).toContain('Connected');
  expect(card('Codex').textContent).toContain('Not connected');
  await click('Disconnect'); await click('Disconnect');
  expect(calls.some(c => c.method === 'DELETE')).toBe(true);
  expect(card('Claude Code').textContent).toContain('Not connected');
});
