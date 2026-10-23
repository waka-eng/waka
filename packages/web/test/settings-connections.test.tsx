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
  const label = locale === 'en-US' ? `Connections and API keys for ${name}` : `${name}의 연결 및 API 키`;
  await act(async () => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click());
}
async function chooseAnotherAgent() {
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Back to agent profiles"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Connections and API keys for anotherone"]')!.click());
}

it("keeps MCP connections and keys under their agent without a Manage tab", async () => {
  await act(async () => root.render(<SettingsPanel {...props} />));
  expect(requests).toEqual([]);
  expect(host.textContent).toContain('Account connections');
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

it("keeps personal sign-ins in account settings, with no agent list or setup controls", async () => {
  rows.push({ ...session('personal-browser'), profile: { id:'human', name:'Someone', type:'human' }, deviceLabel:'Other browser' });
  await act(async () => root.render(<SettingsPanel {...props} />));
  await act(async () => button('Account connections').click());
  expect(host.querySelector("h2")?.textContent).toBe("Account connections");
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

it("guides installation, browser consent and a real MCP check as separate steps with copyable commands", async () => {
  await openConnections();
  await act(async () => button("Set up MCP").click());
  expect(host.textContent).toContain("Step 1 of 3");
  expect(host.querySelector("pre")?.textContent).toContain("git clone --branch dev");
  expect(host.textContent).not.toContain("--device");
  await act(async () => button("Copy command").click());
  expect(copied[0]).toContain("pnpm install");
  expect(host.querySelector('[role="status"]')?.textContent).toBe("Copied");
  await act(async () => button("Next: Sign in").click());
  expect(host.textContent).toContain("Step 2 of 3");
  expect(host.textContent).toContain("Connect as profile");
  expect(host.textContent).toContain("Read and write only this agent’s own memory");
  await act(async () => button("Copy command").click());
  expect(copied[1]).toContain(`pnpm run login -- '${window.location.origin}'`);
  expect(copied[1]).toContain("--device 'Claude Code · noah'");
  expect(copied[1]).toContain("--profile 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
  await act(async () => button("Next: Check connection").click());
  expect(host.textContent).toContain("Step 3 of 3");
  expect(host.querySelector("pre")?.textContent).toContain("claude mcp add");
  expect(host.textContent).toContain("Use waka_verify_connection");
  rows.push({ ...session("new-session"), deviceLabel: "Claude Code · noah",
    profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'noah', type: 'agent' }, verifiedAt: new Date(Date.now() + 1000).toISOString() });
  await act(async () => button("Check connection").click());
  await act(async () => button("View connections").click());
  expect(host.querySelectorAll('.waka-session-card')).toHaveLength(2);
  expect(host.textContent).toContain("Claude Code · noah");
  expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("MCP connections");
});

it("lets existing installations reconnect with a pinned server entry without cloning again", async () => {
  await openConnections();
  await act(async () => button("Set up MCP").click());
  await act(async () => button("Reconnect an existing setup").click());
  expect(host.textContent).toContain("Step 1 of 2");
  expect(host.querySelector("pre")?.textContent).toContain("pnpm run login");
  await act(async () => button("Next: Check connection").click());
  expect(host.textContent).toContain("Step 2 of 2");
  expect(host.querySelector("pre")?.textContent).toContain("WAKA_PROFILE_ID");
  expect(host.querySelector("pre")?.textContent).toContain("claude mcp remove --scope user 'waka-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
  expect(host.querySelector("pre")?.textContent).toContain("WAKA_API_KEY=''");
  expect(host.textContent).toContain("Restart Claude Code");
});

it('generates separate pinned login and MCP commands for Noah and anotherone',async()=>{
  await openConnections();
  await act(async()=>button('Set up MCP').click());
  await act(async()=>button('Reconnect an existing setup').click());
  const noah=host.querySelector('pre')!.textContent!;
  expect(noah).toContain('WAKA_HOME="$HOME/.waka/profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"');
  expect(noah).toContain("WAKA_PROFILE_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
  await chooseAnotherAgent();
  await act(async()=>button('Set up MCP').click());
  await act(async()=>button('Reconnect an existing setup').click());
  const another=host.querySelector('pre')!.textContent!;
  expect(another).toContain("--profile 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'");
  expect(another).not.toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(another).toContain('Claude Code · anotherone');
  await act(async()=>button('Next: Check connection').click());
  const server=host.querySelector('pre')!.textContent!;
  expect(server).toContain("waka-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  expect(server).toContain("WAKA_PROFILE_ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'");
  expect(server).toContain('WAKA_HOME="$HOME/.waka/profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"');
  expect(host.querySelector('blockquote')?.textContent).toContain('profileId "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"');
});

it('keeps MCP setup pinned to the agent whose settings are open',async()=>{
  await openConnections('en-US','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  await act(async()=>button('Set up MCP').click());
  await act(async()=>button('Reconnect an existing setup').click());
  expect(host.querySelector('select')).toBeNull();
  expect(host.querySelector('pre')?.textContent).toContain('Claude Code · anotherone');
  expect(host.querySelector('pre')?.textContent).not.toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

it('requires a fresh verification for the selected profile and device', async () => {
  await openConnections();
  await act(async () => button('Set up MCP').click());
  await act(async () => button('Reconnect an existing setup').click());
  await act(async () => button('Next: Check connection').click());
  const noah = { ...session('noah'), deviceLabel: 'Claude Code · noah',
    profile: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'noah', type: 'agent' as const },
    verifiedAt: '2020-01-01T00:00:00Z' };
  rows.push(noah);
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('No new verification received');
  noah.verifiedAt = new Date(Date.now() + 1000).toISOString();
  noah.deviceLabel = 'A different app';
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('No new verification received');
  noah.deviceLabel = 'Claude Code · noah';
  noah.expiresAt = '2020-01-01T00:00:00Z';
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('No new verification received');
  noah.expiresAt = '2099-01-01T00:00:00Z';
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('Verified for noah · Claude Code · noah');
  await chooseAnotherAgent();
  await act(async () => button('Set up MCP').click());
  await act(async () => button('Reconnect an existing setup').click());
  await act(async () => button('Next: Check connection').click());
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('No new verification received');
  expect(host.textContent).not.toContain('Verified for noah');
  failRead = true;
  await act(async () => button('Check connection').click());
  expect(host.textContent).toContain('Could not check the connection');
});
