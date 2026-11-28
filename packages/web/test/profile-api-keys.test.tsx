/** WHAT THIS MOCKS, AND WHY (gate G6): `fetch` supplies profile, session,
 * and key responses without real credentials. React renders the real settings
 * controls; tests exercise creation, one-time secret display and revocation. */
// @vitest-environment jsdom
// Mock only fetch and the clipboard: exercise the real settings navigation
// and API client without minting credentials on a user's account.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ConnectPanel, SettingsPanel, type SettingsPanelProps } from '../src/components/SettingsPanel';
import type { ApiProfileKey } from '../src/lib/api/profile-keys';

const noah = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'noah', type: 'agent' };
const another = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'anotherone', type: 'agent' };
const personal = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'You', type: 'human' };
const props: SettingsPanelProps = {
  locale: 'en-US', email: 'you@example.test', name: 'You', nameBusy: false, localeBusy: false, failed: false,
  onName() {}, onLocale() {}, onSignOut() {}, onDeleteAccount: async () => {}, onClose() {},
};
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
async function openAgent(profile = noah) {
  await act(async () => root.render(<SettingsPanel {...props} />));
  await click('Agents');
  await act(async () => host.querySelector<HTMLButtonElement>(`button[aria-label="Settings for ${profile.name}"]`)!.click());
}

it('offers personal MCP without an agent and lists only live personal keys', async () => {
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((...args) => String(args[0]).endsWith('/profiles')
    ? Promise.resolve(Response.json({ profiles: [personal] })) : original(...args));
  keys.push(key('Personal laptop', personal.id), { ...key('Old personal key', personal.id), revokedAt: '2026-10-22T00:00:00Z' });
  await openPersonal();
  /* Connect is its own door now (founder, 2026-11-27): the page is Connect,
     and its first section is Claude Code and Codex. */
  expect(host.querySelector('h2')?.textContent).toBe('Connect');
  expect(host.querySelector('#waka-connect-tools')?.textContent).toBe('Let your AI tools know you');
  /* The tool cards read keys once, to light the dot of a connected tool. */
  expect(calls.filter(c => c.path === '/api/keeper-keys')).toHaveLength(1);
  await click('API keys');
  expect(host.textContent).toMatch(/Neither can edit or delete inspirations or manage your account/i);
  expect(host.textContent).toContain('Read and capture also allows new saves');
  expect(host.textContent).toContain('Personal laptop');
  expect([...host.querySelectorAll('thead th')].map(header => header.textContent)).toEqual([
    'Name', 'Permissions', 'API key', 'Last used', 'Delete key',
  ]);
  for (const hidden of ['Noah laptop', 'Another laptop', 'Old personal key', 'Agent name']) expect(host.textContent).not.toContain(hidden);
  /* The cards' read, then the Keys and details tab's own. */
  expect(vi.mocked(fetch).mock.calls.map(([path]) => path)).toEqual([...CONNECT_READS(), '/api/keeper-keys', `/api/mcp-reads?profile=${personal.id}`]);
  expect(calls.every(c => c.method === 'GET')).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  expect(closed, 'Close on Connect did not close it').toBe(1);
});

it('keeps personal keys in their tab and copies a profile-bound setup prompt without a secret', async () => {
  await openPersonal();
  expect(button('Create key')).toBeUndefined();
  expect(calls.map(c=>c.path)).toEqual(CONNECT_READS());
  await click('API keys');
  expect([...host.querySelectorAll('select')].find(node=>node.value==='read_only')).toBeDefined();
  await input('Key name, e.g. Work laptop', 'My Codex'); await click('Create key');
  expect(calls.find(c => c.method === 'POST')).toEqual({ path: '/api/keeper-keys', method: 'POST', body: { label: 'My Codex', access:'read_only' } });
  expect(host.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(secret);
  await click('Copy configuration');
  expect(copied.at(-1)).toContain('YOUR_API_KEY');
  expect(copied.at(-1)).not.toContain(secret);
  expect(copied.at(-1)).toContain('WAKA_MCP_MODE');
  await click('MCP setup');
  expect(host.querySelector('input[readonly]')).toBeNull();
  expect(host.textContent).not.toContain('My Codex');
  expect(host.querySelectorAll('.waka-mcp-setup button')).toHaveLength(1);
  await click('Copy setup prompt');
  const prompt = copied.at(-1)!;
  const details = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1]!);
  expect(details).toMatchObject({ profileId: personal.id, profileType: 'human', serverName: `waka-${personal.id}`, scope: 'current project only' });
  expect(details.login).toBeUndefined();
  expect(prompt).toContain('Settings → Use WAKA in Claude Code or Codex → API keys');
  expect(prompt).toContain('Do not use browser login');
  expect(prompt).toContain('Never ask me to paste the key into chat');
  expect(prompt).not.toContain(noah.id); expect(prompt).not.toContain(secret);
  await act(async () => {
    const select = host.querySelector('select')!;
    select.value = 'codex'; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('Copy setup prompt');
  expect(copied.at(-1)).toContain('Codex');
  expect(copied.at(-1)).toContain(personal.id);
  await click('API keys');
  expect(host.querySelector('input[readonly]')).toBeNull();
  expect(host.textContent).toContain('My Codex');
});

it('revokes a personal key without touching an agent key, session or memory', async () => {
  keys.push(key('Personal laptop', personal.id));
  await openPersonal(); await click('API keys');
  const trigger = button('Delete key Personal laptop');
  expect(trigger.closest('tr')?.querySelector('th[scope="row"]')?.textContent).toContain('Personal laptop');
  await click('Delete key Personal laptop');
  expect(calls.some(c => c.method === 'DELETE')).toBe(false);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(host.textContent).toContain('Everything saved stays');
  await click('Cancel');
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
  await click('Delete key Personal laptop');
  await click('Delete');
  expect(calls.filter(c => c.method === 'DELETE').map(c => c.path)).toEqual(['/api/keeper-keys/Personal%20laptop']);
  expect(host.textContent).not.toContain('Personal laptop');
  expect(keys.filter(k => k.profileId === noah.id)).toHaveLength(2);
});

it('retries a failed personal profile load and translates personal setup in Korean', async () => {
  keys.push(key('Personal laptop', personal.id));
  fail = 'profiles'; await openPersonal('ko-KR');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('내 프로필을 불러오지 못했어요');
  expect(calls.every(c => c.path === '/api/profiles')).toBe(true);
  fail = null;
  await act(async () => host.querySelector<HTMLButtonElement>('.waka-settings-erase')!.click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await click('연결 요청 문구 복사');
  expect(copied.at(-1)).toContain('브라우저 로그인이나 에이전트 프로필 생성을 사용하지 마세요');
  expect(copied.at(-1)).toContain(personal.id);
});

it('does not fall back to an agent when the personal profile is unavailable', async () => {
  vi.mocked(fetch).mockImplementation(async () => Response.json({ profiles: [noah, another] }));
  await openPersonal();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t load your profile');
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  expect(host.querySelector('input')).toBeNull();
  expect(host.querySelector('blockquote')).toBeNull();
});

it('does not display a returned key bound to a different profile', async () => {
  await openPersonal(); await click('API keys');
  const original = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation((...args) => args[1]?.method === 'POST'
    ? Promise.resolve(Response.json({ key: { ...key('wrong-profile'), secret } })) : original(...args));
  expect([...host.querySelectorAll('select')].find(node=>node.value==='read_only')).toBeDefined();
  await input('Key name, e.g. Work laptop', 'My Codex'); await click('Create key');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Couldn’t create the key');
  expect(host.querySelector('input[readonly]')).toBeNull();
  expect(host.innerHTML).not.toContain(secret);
});


it('offers personal setup even when keys cannot load or five keys are active', async () => {
  keys.push(...Array.from({length:5}, (_,i)=>key(`Personal ${i}`,personal.id)));
  fail = 'GET';
  await openPersonal();
  expect([...host.querySelectorAll('.waka-session-tabs button')].map(b=>b.textContent)).toEqual(['MCP setup', 'API keys']);
  /* The cards say keys could not load; the setup below still works. */
  expect(host.querySelector('.waka-connect-tools, [role="alert"]')?.textContent).toContain('Couldn’t');
  expect(host.querySelector('input')).toBeNull();
  expect(host.textContent).not.toMatch(/Create key|Last used|Revoke|Step 1/);
  await click('Copy setup prompt');
  expect(copied.at(-1)).toContain(personal.id);
  expect(calls.map(c=>c.path)).toEqual(CONNECT_READS());
  await click('API keys');
  expect(host.textContent).toContain('Couldn’t load API keys');
  fail = null; await click('Refresh');
  expect(host.textContent).toContain('You have five active keys');
  expect(button('Create key').disabled).toBe(true);
  await click('MCP setup');
  expect(button('Copy setup prompt').disabled).toBe(false);
  expect(host.textContent).not.toContain('Personal 0');
  expect(calls.some(c=>c.method==='POST')).toBe(false);
});

it('keeps personal setup manually copyable if clipboard access fails', async () => {
  await openPersonal();
  Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
  await click('Copy setup prompt');
  expect(host.textContent).toContain('Select the text and copy it yourself');
  expect(host.textContent).toContain(personal.id);
  expect(host.textContent).toContain('waka_verify_connection');
  expect(calls.map(c=>c.path)).toEqual(CONNECT_READS());
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
  await click('Disconnect');
  expect(calls.some(c => c.method === 'DELETE')).toBe(true);
  expect(card('Claude Code').textContent).toContain('Not connected');
});
