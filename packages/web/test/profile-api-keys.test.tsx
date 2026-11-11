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
        const made = { ...key('new-key', url.includes('/keeper-keys') ? personal.id : body.profileId), label: body.label }; keys.push(made);
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
  expect(host.querySelector('h2')?.textContent).toBe('You');
  expect(host.textContent).toContain('You · You');
  expect(calls.some(c => c.path.includes('keys'))).toBe(false);
  await click('API keys');
  expect(host.textContent).toContain('can’t edit or delete notes or manage your account');
  expect(host.textContent).toContain('Personal laptop');
  for (const hidden of ['Noah laptop', 'Another laptop', 'Old personal key', 'Agent name']) expect(host.textContent).not.toContain(hidden);
  expect(vi.mocked(fetch).mock.calls.map(([path]) => path)).toEqual(['/api/profiles', '/api/keeper-keys']);
  expect(calls.every(c => c.method === 'GET')).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Back"]')!.click());
  expect(document.activeElement).toBe(host.querySelector('[data-settings-target="personal"]'));
});

it('keeps personal keys in their tab and copies a profile-bound setup prompt without a secret', async () => {
  await openPersonal();
  expect(button('Create key')).toBeUndefined();
  expect(calls.map(c=>c.path)).toEqual(['/api/profiles']);
  await click('API keys');
  await input('Key name, e.g. Work laptop', 'My Codex'); await click('Create key');
  expect(calls.find(c => c.method === 'POST')).toEqual({ path: '/api/keeper-keys', method: 'POST', body: { label: 'My Codex' } });
  expect(host.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(secret);
  await click('Copy configuration');
  expect(copied.at(-1)).toContain('YOUR_API_KEY');
  expect(copied.at(-1)).not.toContain(secret);
  await click('MCP setup');
  expect(host.querySelector('input[readonly]')).toBeNull();
  expect(host.textContent).not.toContain('My Codex');
  expect(host.querySelectorAll('.waka-mcp-setup button')).toHaveLength(1);
  await click('Copy setup prompt');
  const prompt = copied.at(-1)!;
  const details = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1]!);
  expect(details).toMatchObject({ profileId: personal.id, profileType: 'human', serverName: `waka-${personal.id}`, scope: 'current project only' });
  expect(details.login).toBeUndefined();
  expect(prompt).toContain('Settings → You · MCP → API keys');
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
  await click('Delete key');
  expect(calls.some(c => c.method === 'DELETE')).toBe(false);
  expect(host.textContent).toContain('Everything kept stays');
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
  expect(host.textContent).toContain('나 · You');
  await click('설정 프롬프트 복사');
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
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('input')).toBeNull();
  expect(host.textContent).not.toMatch(/Create key|Last used|Revoke|Step 1/);
  await click('Copy setup prompt');
  expect(copied.at(-1)).toContain(personal.id);
  expect(calls.map(c=>c.path)).toEqual(['/api/profiles']);
  await click('API keys');
  expect(host.textContent).toContain('Couldn’t load API keys');
  fail = null; await click('Refresh');
  expect(host.textContent).toContain('Five keys are active');
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
  expect(calls.map(c=>c.path)).toEqual(['/api/profiles']);
});

async function openPersonal(locale: SettingsPanelProps['locale'] = 'en-US') {
  await act(async () => root.render(<SettingsPanel {...props} locale={locale} />));
  await click(locale === 'en-US' ? 'You · MCP' : '나 · MCP');
}
