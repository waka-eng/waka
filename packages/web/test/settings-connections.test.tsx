// @vitest-environment jsdom
/**
 * Settings can end a device session without deleting its memory.
 * WHAT THIS MOCKS, AND WHY: `fetch`, the network boundary. The real
 * sessions client is exercised so revocation must use the session endpoint.
 * `navigator.clipboard.writeText` records copied commands without using the
 * operating system clipboard.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { SettingsPanel, type SettingsPanelProps } from "../src/components/SettingsPanel";
import type { ApiSession } from "../src/lib/api/sessions";

let host: HTMLDivElement, root: Root;
let rows: ApiSession[];
let failRead: boolean, failDelete: boolean;
let copied: string[];
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const requests: Array<{ path: string; method: string }> = [];
const props: SettingsPanelProps = {
  locale: "en-US", email: "you@example.test", name: "Someone",
  onName: () => {}, onLocale: () => {}, nameBusy: false, localeBusy: false, failed: false,
  onSignOut: () => {}, onDeleteAccount: async () => {}, onClose: () => {},
};
const session = (id: string, current = false): ApiSession => ({
  id, current, deviceLabel: current ? "Current browser" : "Work laptop",
  profile: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "noah", type: "agent" },
  createdAt: "2026-01-01T00:00:00Z", lastSeenAt: "2026-10-22T12:00:00Z",
  expiresAt: "2099-01-01T00:00:00Z",
});
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>("button")]
  .find((node) => node.textContent?.includes(name))!;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  rows = [session("browser", true), session("agent-session")];
  requests.length = 0;
  failRead = false; failDelete = false;
  copied = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
    writeText: async (text: string) => { copied.push(text); },
  } });
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    const method = init.method ?? "GET";
    requests.push({ path: String(input), method });
    if ((method === "GET" && failRead && String(input).endsWith('/sessions')) || (method === "DELETE" && failDelete)) {
      return Response.json({ error: "Unavailable" }, { status: 500 });
    }
    if (String(input).endsWith('/api/profiles')) return Response.json({profiles:[
      {id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',name:'noah',type:'agent'},
      {id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',name:'anotherone',type:'agent'},
      {id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',name:'Someone',type:'human'},
    ]});
    return Response.json(method === "GET" ? { sessions: rows } : { id: "agent-session", endedCurrent: false });
  }));
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals();
  if (originalClipboard) Object.defineProperty(navigator, "clipboard", originalClipboard);
  else Reflect.deleteProperty(navigator, "clipboard");
});
async function openConnections(locale: SettingsPanelProps["locale"] = "en-US", profileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') {
  await act(async () => root.render(<SettingsPanel {...props} locale={locale} />));
  await act(async () => button(locale === "en-US" ? "Agent profiles" : "에이전트 프로필").click());
  const name = profileId.startsWith('b') ? 'anotherone' : 'noah';
  const label = locale === 'en-US' ? `Settings for ${name}` : `${name} 설정`;
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}
async function chooseAnotherAgent() {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Back to agent profiles"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Settings for anotherone"]')!.click());
}

it("keeps MCP connections and keys under their agent without a Manage tab", async () => {
  await act(async () => root.render(<SettingsPanel {...props} />));
  expect(requests).toEqual([]);
  expect(host.textContent).toContain('Signed-in devices');
  await openConnections();
  expect(host.querySelector('h2')?.textContent).toBe('noah');
  expect([...host.querySelectorAll('.waka-session-tabs button')].map(node => node.textContent)).toEqual(['MCP connections', 'API keys']);
  expect(host.textContent).toContain("Work laptop");
  expect(host.textContent).toContain("Last used");
  expect(host.textContent).toContain("Expires");
  expect(host.textContent).toContain("Read and write only this agent’s own memory");
  expect(host.textContent).not.toContain("Current browser");
  expect(host.querySelectorAll(".waka-session-list li")).toHaveLength(1);
  expect(host.querySelector("pre")).toBeNull();
});

it('shows verification history and tests the exact existing connection without reinstalling', async () => {
  rows[1]!.verifiedAt = '2026-10-22T12:00:00Z';
  rows.push({ ...session('unverified-session'), deviceLabel: 'Second laptop' });
  await openConnections();
  const cards = host.querySelectorAll('.waka-session-card');
  expect(cards[0]?.textContent).toContain('MCP verified');
  expect(cards[0]?.textContent).toContain('Last verified');
  expect(cards[1]?.textContent).toContain('MCP not verified yet');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Test connection for Work laptop"]')!.click());
  expect(host.textContent).toContain('In Work laptop');
  expect(host.querySelector('pre')).toBeNull();
  expect(host.querySelector('blockquote')?.textContent).toContain(rows[1]!.profile.id);
  expect(host.textContent).not.toContain('Install');
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('No new verification received');
  rows[2]!.verifiedAt = new Date(Date.now() + 1000).toISOString();
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('No new verification received');
  rows[1]!.verifiedAt = new Date(Date.now() + 1000).toISOString();
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('Verified for noah · Work laptop');
  await act(async () => button('View connections').click());
  expect(host.querySelector('.waka-session-card')?.textContent).toContain('Last verified');
  expect(requests.every(request => request.method === 'GET')).toBe(true);
});

it("keeps personal sign-ins in account settings, with no agent list or setup controls", async () => {
  rows.push({ ...session('personal-browser'), profile: { id:'human', name:'Someone', type:'human' }, deviceLabel:'Other browser' });
  await act(async () => root.render(<SettingsPanel {...props} />));
  await act(async () => button('Signed-in devices').click());
  expect(host.querySelector("h2")?.textContent).toBe("Signed-in devices");
  expect(document.activeElement).toBe(host.querySelector("h2"));
  expect(host.textContent).toContain('Other browser');
  expect(host.textContent).not.toContain('Work laptop');
  expect(host.textContent).not.toContain('Set up MCP');
  expect(host.textContent).not.toContain('API keys');
  expect(host.querySelector('.waka-session-tabs')).toBeNull();
  await act(async () => button('Disconnect').click());
  await act(async () => button('Disconnect').click());
  expect(requests.filter(row => row.method === 'DELETE')).toEqual([{path:'/api/sessions/personal-browser',method:'DELETE'}]);
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Back to Settings"]')!.click());
  expect(host.querySelector("h2")?.textContent).toBe("Settings");
  expect(document.activeElement).toBe(host.querySelector('[data-settings-target="sessions"]'));
});

it('disconnects only the selected agent’s device and preserves other profiles', async () => {
  rows.push({ ...session('second-device'), deviceLabel: 'Second laptop' },
    { ...session('another-session'), deviceLabel: 'Another device', profile: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', name: 'anotherone', type: 'agent' } });
  await openConnections();
  expect(host.querySelectorAll('.waka-session-card')).toHaveLength(2);
  expect(host.textContent).not.toContain('Another device');
  await act(async () => button('Disconnect').click());
  await act(async () => button('Disconnect').click());
  expect(host.textContent).toContain('Second laptop');
  expect(requests.filter(row => row.method === 'DELETE')).toEqual([{ path: '/api/sessions/agent-session', method: 'DELETE' }]);
  await chooseAnotherAgent();
  expect(host.textContent).toContain('Another device');
  expect(host.textContent).not.toContain('Second laptop');
});

it("keeps the connection when disconnect fails, then revokes only its session on retry", async () => {
  await openConnections();
  await act(async () => button("Disconnect").click());
  expect(host.textContent).toContain("The profile and its memory stay saved");
  expect(document.activeElement).toBe(host.querySelector(".waka-session-confirm p"));
  expect(requests.filter((request) => request.method === "DELETE")).toHaveLength(0);
  await act(async () => button("Cancel").click());
  expect(host.querySelector(".waka-session-confirm")).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('button[aria-label="Disconnect Work laptop"]'));
  await act(async () => button("Disconnect").click());
  failDelete = true;
  await act(async () => button("Disconnect").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not disconnect");
  expect(host.querySelectorAll(".waka-session-list li")).toHaveLength(1);
  failDelete = false;
  await act(async () => button("Disconnect").click());
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelectorAll(".waka-session-list li")).toHaveLength(0);
  expect(host.textContent).toContain("The profile and its memory are still saved");
  expect(host.textContent).toContain("No live sign-in connections for noah");
  expect(requests.filter((request) => request.method === "DELETE")).toEqual([
    { path: "/api/sessions/agent-session", method: "DELETE" },
    { path: "/api/sessions/agent-session", method: "DELETE" },
  ]);
});

it("distinguishes a failed load from an empty list and refreshes after an external login", async () => {
  failRead = true;
  await openConnections();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load connections");
  expect(host.textContent).not.toContain("No live sign-in connections for noah");
  failRead = false;
  await act(async () => button("Refresh").click());
  expect(host.textContent).toContain("Work laptop");
  rows.push({ ...session("new-session"), deviceLabel: "New laptop" });
  await act(async () => button("Refresh").click());
  expect(host.querySelectorAll('.waka-session-card')).toHaveLength(2);
  expect(host.textContent).toContain("New laptop");
});

it("hides expired sessions from the list and counts in Korean", async () => {
  rows[1]!.expiresAt = "2020-01-01T00:00:00Z";
  await openConnections("ko-KR");
  expect(host.textContent).not.toContain('연결 1개');
  expect(host.querySelectorAll('.waka-session-profile-row')).toHaveLength(0);
  expect(host.textContent).not.toContain("만료됨");
  expect(host.textContent).toContain("MCP 설정");
  expect(host.querySelector('button[aria-label="Work laptop 연결 해제"]')).toBeNull();
});

it('sets up an agent with one prompt, no wizard or key instructions', async () => {
  await openConnections();
  expect(host.textContent).not.toContain('without an API key');
  await act(async () => button('Set up MCP').click());
  expect(host.querySelector('#waka-mcp-setup-title')?.textContent).toBe('Agent · noah');
  expect(document.activeElement).toBe(host.querySelector('#waka-mcp-setup-title'));
  expect(host.querySelector('pre')).toBeNull();
  expect(host.querySelectorAll('select')).toHaveLength(1);
  expect(host.querySelectorAll('.waka-mcp-setup button')).toHaveLength(1);
  expect(host.textContent).not.toMatch(/Step 1|Install manually|Create key|30 days/);
  await act(async () => button('Copy setup prompt').click());
  const prompt = copied.at(-1)!;
  const data = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(prompt)![1]!);
  expect(data).toMatchObject({profileId: rows[1]!.profile.id, profileType: 'agent', scope: 'current project only'});
  expect(data.login.args).toContain(rows[1]!.profile.id);
  expect(prompt).toContain('waka_verify_connection');
  expect(prompt).toContain('Do not save, edit, or delete any memory');
  expect(prompt).toContain('Let me complete the browser approval');
  expect(button('Check connection')).toBeUndefined();
  expect(host.textContent).not.toContain('Verified for');
  expect(requests.every(request => request.method === 'GET')).toBe(true);
  expect(requests.some(request => /keys/.test(request.path))).toBe(false);
});

it('copies only the chosen agent and client without creating a session', async () => {
  await openConnections();
  await act(async () => button('Set up MCP').click());
  await act(async () => button('Copy setup prompt').click());
  expect(copied.at(-1)).toContain('Claude Code · noah');
  await chooseAnotherAgent();
  await act(async () => button('Set up MCP').click());
  await act(async () => {
    const client = host.querySelector('select')!;
    client.value = 'codex'; client.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button('Copy setup prompt').click());
  const prompt = copied.at(-1)!;
  expect(prompt).toContain('Codex · anotherone');
  expect(prompt).toContain('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  expect(prompt).not.toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(prompt).toContain('current project only');
  expect(host.textContent).toContain('Agent · anotherone');
  expect(requests.every(request => request.method === 'GET')).toBe(true);
});

it('allows manual copying when the clipboard is unavailable without claiming verification', async () => {
  await openConnections('ko-KR');
  await act(async () => button('MCP 설정').click());
  expect(host.textContent).toContain('에이전트 · noah');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
  await act(async () => button('설정 프롬프트 복사').click());
  expect(host.textContent).toContain('waka_verify_connection');
  expect(host.querySelectorAll('blockquote')).toHaveLength(1);
  expect(host.querySelectorAll('.waka-mcp-setup button')).toHaveLength(1);
});

it('rejects stale, expired and cross-profile verification and recovers from a failed check', async () => {
  await openConnections();
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Test connection for Work laptop"]')!.click());
  const target = rows[1]!;
  const expectedProfile = target.profile;
  target.verifiedAt = '2020-01-01T00:00:00Z';
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('No new verification received');
  target.verifiedAt = new Date(Date.now() + 1000).toISOString();
  target.expiresAt = '2020-01-01T00:00:00Z';
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('No new verification received');
  target.expiresAt = '2099-01-01T00:00:00Z';
  target.profile = {...expectedProfile, id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('No new verification received');
  target.profile = expectedProfile;
  failRead = true;
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('Could not check the connection');
  failRead = false;
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('Verified for noah · Work laptop');
});
