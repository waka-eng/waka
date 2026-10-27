// @vitest-environment jsdom
/**
 * SETTINGS › AGENT PROFILES LISTS AGENTS, AND SAYS WHICH ACT FAILED.
 *
 * Audit f2afcbe2 (desk/51, desk/52): the list offered the person's OWN human
 * profile as a memory to rename and delete, and a failed delete said "Your
 * memories could not be loaded" about a list that was on screen.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/profiles` — the roster read
 * and the delete are network calls this panel makes. `lib/api/sessions`
 * returns no connections so these tests isolate profile management. The cases
 * are about what it does with their answers, not about the transport.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProfile, deleteProfile, fetchProfiles, renameProfile, type ApiOwnedProfile } from "../src/lib/api/profiles";
import { Menu } from "../src/components/Menu";
import { SettingsPanel } from "../src/components/SettingsPanel";

vi.mock("../src/lib/api/profiles", async (original) => ({ ...await original<typeof import("../src/lib/api/profiles")>(),
  fetchProfiles: vi.fn(), deleteProfile: vi.fn(), renameProfile: vi.fn(), createProfile: vi.fn() }));

vi.mock("../src/lib/api/sessions", () => ({ fetchSessions: vi.fn(async () => []), revokeSession: vi.fn() }));

const row = (id: string, type: "human" | "agent", name: string): ApiOwnedProfile =>
  ({ id, accountId: "account-1", type, name, avatarUrl: null, preferredLocale: "en-US", createdAt: "2026-10-01T00:00:00Z" });
let host: HTMLDivElement, root: Root;
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.trim() === name)!;
const nameInput = () => host.querySelector<HTMLInputElement>('.waka-agent-details input')!;
async function editName(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(nameInput(), value);
    nameInput().dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => nameInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(fetchProfiles).mockResolvedValue([row("me", "human", "Mobi"), row("agent-1", "agent", "Work agent")]);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.resetAllMocks(); });

async function openAgentProfiles() {
  await act(async () => root.render(<SettingsPanel locale="en-US" email="you@example.test" name="Mobi" onName={vi.fn()} onLocale={vi.fn()}
    nameBusy={false} localeBusy={false} failed={false} onSignOut={vi.fn()} onDeleteAccount={vi.fn(async () => {})} onClose={vi.fn()} />));
  const toggle = [...host.querySelectorAll<HTMLButtonElement>(".waka-settings-row")].find((b) => b.textContent?.includes("Agent profiles"))!;
  await act(async () => { toggle.click(); });
  await act(async () => { await Promise.resolve(); });
}

async function openAgent() {
  await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-id="agent-1"]')!.click());
}

it("lists agent profiles only, never the person's own profile", async () => {
  await openAgentProfiles();
  const rows = host.querySelectorAll('.waka-settings-rows li');
  expect(rows).toHaveLength(1);
  expect(rows[0]?.textContent).toContain('Work agent');
  expect(rows[0]?.querySelectorAll('button')).toHaveLength(1);
  expect(rows[0]?.querySelector('input')).toBeNull();
  expect(host.textContent).not.toContain('Delete profile');
  expect(host.textContent).toContain('Each agent keeps its own memory');
  await openAgent();
  expect(nameInput().value).toBe('Work agent');
  expect(host.querySelector('h2')?.textContent).toBe('Work agent');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Back to agent profiles"]')!.click());
  expect(document.activeElement).toBe(host.querySelector('[data-agent-id="agent-1"]'));
});

it("cancels a pending delete confirmation when returning to the agent list", async () => {
  await openAgentProfiles(); await openAgent();
  await act(async () => button('Delete profile').click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Back to agent profiles"]')!.click());
  await openAgent();
  expect(host.querySelector('.waka-session-confirm')).toBeNull();
  expect(deleteProfile).not.toHaveBeenCalled();
});

it("says the delete failed, not that the list failed to load", async () => {
  vi.mocked(deleteProfile).mockRejectedValue(new Error("nope"));
  await openAgentProfiles(); await openAgent();
  const erase = button('Delete profile');
  await act(async () => { erase.click(); });
  await act(async () => button("Delete profile and memory").click());
  await act(async () => { await Promise.resolve(); });
  const alert = host.querySelector('[role="alert"]')?.textContent ?? "";
  expect(alert).toContain("could not be deleted");
  expect(alert).not.toContain("loaded");
  expect(nameInput().value).toBe('Work agent');
});

it('replaces failed loading with Retry and recovers the agent roster', async () => {
  vi.mocked(fetchProfiles).mockRejectedValueOnce(new Error('offline'));
  await openAgentProfiles();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('could not be loaded');
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(button('Add agent').disabled).toBe(true);
  await act(async () => button('Try again').click());
  expect(fetchProfiles).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[data-agent-id="agent-1"]')?.textContent).toContain('Work agent');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('validates blank names and makes failed, pending and saved renames explicit', async () => {
  await openAgentProfiles(); await openAgent();
  await editName('  ');
  expect(nameInput().getAttribute('aria-invalid')).toBe('true');
  expect(host.textContent).toContain('Enter an agent name');
  expect(renameProfile).not.toHaveBeenCalled();
  expect(host.querySelector('h2')?.textContent).toBe('Work agent');
  let fail!: (reason: Error) => void;
  vi.mocked(renameProfile).mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  await editName('Noah');
  expect(host.textContent).toContain('Saving');
  await act(async () => fail(new Error('offline')));
  expect(nameInput().value).toBe('Noah');
  expect(host.textContent).toContain('Name not saved. Try again');
  expect(host.querySelector('h2')?.textContent).toBe('Work agent');
  vi.mocked(renameProfile).mockResolvedValueOnce(row('agent-1', 'agent', 'Noah'));
  await act(async () => button('Try again').click());
  expect(renameProfile).toHaveBeenLastCalledWith('agent-1', 'Noah');
  expect(host.textContent).toContain('Saved');
  expect(host.querySelector('h2')?.textContent).toBe('Noah');
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it('names the agent being deleted and lets Cancel return focus without deleting memory', async () => {
  await openAgentProfiles(); await openAgent();
  await act(async () => button('Delete profile').click());
  expect(host.textContent).toContain('Permanently delete Work agent and all of its memory?');
  expect(document.activeElement).toBe(host.querySelector('.waka-session-confirm p'));
  await act(async () => button('Cancel').click());
  expect(deleteProfile).not.toHaveBeenCalled();
  expect(host.querySelector('.waka-session-confirm')).toBeNull();
  expect(document.activeElement).toBe(button('Delete profile'));
  vi.mocked(deleteProfile).mockResolvedValueOnce(undefined);
  await act(async () => button('Delete profile').click());
  await act(async () => button('Delete profile and memory').click());
  expect(deleteProfile).toHaveBeenCalledWith('agent-1');
  expect(host.querySelector('.waka-agent-profile')).toBeNull();
  expect(host.querySelector('h2')?.textContent).toBe('Agent profiles');
  expect(document.activeElement).toBe(host.querySelector('h2'));
});


it('opens a newly created agent’s settings without creating credentials', async () => {
  vi.mocked(createProfile).mockResolvedValueOnce(row('agent-new', 'agent', 'Research'));
  await openAgentProfiles();
  const input = host.querySelector<HTMLInputElement>('.waka-settings-add input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Research');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => button('Add agent').click());
  expect(createProfile).toHaveBeenCalledWith('Research');
  expect(host.querySelector('h2')?.textContent).toBe('Research');
  expect(host.textContent).toContain('Set up MCP');
  expect(document.activeElement).toBe(host.querySelector('h2'));
});

it('waits for a rename on Back, keeps errors and drafts visible, and allows an explicit discard', async () => {
  await openAgentProfiles(); await openAgent();
  let reject!: (error: Error) => void;
  vi.mocked(renameProfile).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  await editName('New name');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Back to agent profiles"]')!.click());
  expect(host.querySelector('h2')?.textContent).toBe('Work agent');
  expect(renameProfile).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('offline')));
  expect(nameInput().value).toBe('New name');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Name not saved');
  await act(async () => button('Discard name change').click());
  expect(nameInput().value).toBe('Work agent');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Back to agent profiles"]')!.click());
  expect(host.querySelector('h2')?.textContent).toBe('Agent profiles');
});


it.each(['Close', 'Escape', 'Info', 'Scrim', 'Gear'])('keeps a failed rename visible when leaving via %s', async exit => {
  await act(async () => root.render(<Menu locale="en-US" items={[]} settings={{
    name: 'Mobi', onName: () => {}, onLocale: () => {}, nameBusy: false, localeBusy: false,
    failed: false, onDeleteAccount: async () => {},
  }} />));
  await act(async () => host.querySelector<HTMLButtonElement>('.waka-corner--settings')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-settings-target="agents"]')!.click());
  await openAgent();
  let resolve!: (profile: ApiOwnedProfile) => void;
  let reject!: (error: Error) => void;
  vi.mocked(renameProfile).mockImplementationOnce(() => new Promise((done, fail) => { resolve = done; reject = fail; }));
  await editName('Pending name');
  await act(async () => {
    if (exit === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else if (exit === 'Close') button('Close').click();
    else host.querySelector<HTMLButtonElement>(exit === 'Info' ? '.waka-corner--info' : exit === 'Gear' ? '.waka-corner--settings' : '.waka-menu-scrim')!.click();
  });
  expect(nameInput().value).toBe('Pending name'); expect(renameProfile).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('offline')));
  expect(nameInput().value).toBe('Pending name'); expect(host.textContent).toContain('Name not saved');
  vi.mocked(renameProfile).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => button('Close').click());
  expect(nameInput().value).toBe('Pending name');
  await act(async () => resolve(row('agent-1', 'agent', 'Pending name')));
  expect(host.querySelector('.waka-settings')).toBeNull();
});
