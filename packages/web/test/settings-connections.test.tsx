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
  profile: { id: "profile-1", name: "Work agent", type: "agent" },
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
    if ((method === "GET" && failRead) || (method === "DELETE" && failDelete)) {
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
async function openConnections(locale: SettingsPanelProps["locale"] = "en-US", activeProfileId?: string) {
  await act(async () => root.render(<SettingsPanel {...props} locale={locale} activeProfileId={activeProfileId} />));
  await act(async () => button(locale === "en-US" ? "Sessions" : "연결된 기기").click());
}
async function openProfile(id = 'profile-1') {
  await act(async () => host.querySelector<HTMLButtonElement>(`[data-profile-id="${id}"]`)!.click());
}

it("summarizes connections by profile and keeps device details off the overview", async () => {
  await act(async () => root.render(<SettingsPanel {...props} />));
  expect(requests).toEqual([]);
  await openConnections();
  expect(host.textContent).toContain("Work agent");
  expect(host.textContent).toContain("Agent profile · 1 connection");
  expect(host.textContent).not.toContain("Work laptop");
  expect(host.textContent).not.toContain("Last used");
  expect(host.textContent).not.toContain("Current browser");
  expect(host.querySelectorAll(".waka-session-list li")).toHaveLength(1);
  await openProfile();
  expect(host.textContent).toContain("Work laptop");
  expect(host.textContent).toContain("Last used");
  expect(host.textContent).toContain("Expires");
  expect(host.textContent).toContain("Read and write only this agent’s own memory");
  expect(host.textContent).toContain("Signed in");
  expect(host.textContent).not.toContain("Current browser");
  expect(host.querySelectorAll(".waka-session-list li")).toHaveLength(1);
  expect(host.querySelector("pre")).toBeNull();
});

it("enters a Sessions subpage and returns to Settings with focus on its navigation row", async () => {
  await openConnections();
  expect(host.querySelector("h2")?.textContent).toBe("Sessions");
  expect(document.activeElement).toBe(host.querySelector("h2"));
  expect(host.querySelector("input[autocomplete='name']")).toBeNull();
  expect(host.querySelector('[data-settings-target="agents"]')).toBeNull();
  const back = host.querySelector<HTMLButtonElement>('button[aria-label="Back to Settings"]')!;
  await act(async () => back.click());
  expect(host.querySelector("h2")?.textContent).toBe("Settings");
  expect(host.querySelector("input[autocomplete='name']")).not.toBeNull();
  expect(document.activeElement).toBe(host.querySelector('[data-settings-target="sessions"]'));
});

it('groups repeated logins without mixing profiles or disconnecting another device', async () => {
  rows.push({ ...session('second-device'), deviceLabel: 'Second laptop' },
    { ...session('another-session'), deviceLabel: 'Another device', profile: { id: 'profile-2', name: 'anotherone', type: 'agent' } });
  await openConnections();
  expect(host.querySelectorAll('.waka-session-profile-row')).toHaveLength(2);
  expect(host.textContent).toContain('2 connections');
  await openProfile();
  expect(document.activeElement).toBe(host.querySelector('.waka-session-list-heading h3'));
  expect(host.querySelectorAll('.waka-session-card')).toHaveLength(2);
  expect(host.textContent).not.toContain('Another device');
  await act(async () => button('Disconnect').click());
  await act(async () => button('Disconnect').click());
  expect(host.textContent).toContain('Second laptop');
  expect(requests.filter(row => row.method === 'DELETE')).toEqual([{ path: '/api/sessions/agent-session', method: 'DELETE' }]);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Back to connections"]')!.click());
  expect(document.activeElement).toBe(host.querySelector('[data-profile-id="profile-1"]'));
  expect(host.querySelector('[data-profile-id="profile-1"]')?.textContent).toContain('1 connection');
  expect(host.querySelector('[data-profile-id="profile-2"]')).not.toBeNull();
});

it("keeps the connection when disconnect fails, then revokes only its session on retry", async () => {
  await openConnections();
  await openProfile();
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
  expect(host.textContent).toContain("Only this browser is signed in");
  expect(requests.filter((request) => request.method === "DELETE")).toEqual([
    { path: "/api/sessions/agent-session", method: "DELETE" },
    { path: "/api/sessions/agent-session", method: "DELETE" },
  ]);
});

it("distinguishes a failed load from an empty list and refreshes after an external login", async () => {
  failRead = true;
  await openConnections();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load connections");
  expect(host.textContent).not.toContain("Only this browser is signed in");
  failRead = false;
  await act(async () => button("Refresh").click());
  expect(host.textContent).toContain("1 connection");
  rows.push({ ...session("new-session"), deviceLabel: "New laptop" });
  await act(async () => button("Refresh").click());
  expect(host.querySelectorAll('.waka-session-profile-row')).toHaveLength(1);
  expect(host.textContent).toContain('2 connections');
  await openProfile();
  expect(host.textContent).toContain("New laptop");
});

it("shows expired sessions honestly and provides setup in Korean", async () => {
  rows[1]!.expiresAt = "2020-01-01T00:00:00Z";
  await openConnections("ko-KR");
  expect(host.textContent).toContain('연결 1개');
  await openProfile();
  expect(host.textContent).toContain("만료됨");
  expect(host.textContent).toContain("MCP 설정");
  expect(host.querySelector('button[aria-label="Work laptop 연결 해제"]')).not.toBeNull();
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
  expect(host.textContent).toContain("Use WAKA to list the profiles I can access");
  rows.push({ ...session("new-session"), deviceLabel: "Claude Code (Work laptop)" });
  await act(async () => button("View connections").click());
  expect(host.textContent).toContain('2 connections');
  await openProfile();
  expect(host.textContent).toContain("Claude Code (Work laptop)");
  expect(host.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Manage");
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
  expect(host.textContent).toContain("Restart Claude Code");
});

it('generates separate pinned login and MCP commands for Noah and anotherone',async()=>{
  await openConnections();
  await act(async()=>button('Set up MCP').click());
  await act(async()=>button('Reconnect an existing setup').click());
  const noah=host.querySelector('pre')!.textContent!;
  expect(noah).toContain('WAKA_HOME="$HOME/.waka/profiles/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"');
  expect(noah).toContain("WAKA_PROFILE_ID='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
  await act(async()=>{
    const select=host.querySelector('select')!;select.value='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';select.dispatchEvent(new Event('change',{bubbles:true}));
  });
  const another=host.querySelector('pre')!.textContent!;
  expect(another).toContain("--profile 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'");
  expect(another).not.toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  expect(another).toContain('Claude Code · anotherone');
  await act(async()=>button('Next: Check connection').click());
  const server=host.querySelector('pre')!.textContent!;
  expect(server).toContain("waka-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  expect(server).toContain("WAKA_PROFILE_ID='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'");
  expect(server).toContain('WAKA_HOME="$HOME/.waka/profiles/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"');
  expect(host.querySelector('blockquote')?.textContent).toContain('only anotherone (bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb)');
});

it('starts MCP setup with the agent currently selected in the world',async()=>{
  await openConnections('en-US','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  await act(async()=>button('Set up MCP').click());
  await act(async()=>button('Reconnect an existing setup').click());
  expect(host.querySelector('select')?.value).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  expect(host.querySelector('pre')?.textContent).toContain('Claude Code · anotherone');
  expect(host.querySelector('pre')?.textContent).not.toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

it('explains that a personal MCP connection can list every profile in the account', async () => {
  await openConnections();
  await act(async()=>button('Set up MCP').click());
  await act(async()=>button('Reconnect an existing setup').click());
  await act(async()=>{
    const select=host.querySelector('select')!;select.value='cccccccc-cccc-4ccc-8ccc-cccccccccccc';select.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await act(async()=>button('Next: Check connection').click());
  expect(host.querySelector('blockquote')?.textContent).toContain('and my agent profiles');
  expect(host.textContent).toContain('can access every profile in your account');
  expect(host.textContent).not.toContain('Only the selected profile should be listed');
});
