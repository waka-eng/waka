// @vitest-environment jsdom
/**
 * SETTINGS › AGENT PROFILES LISTS AGENTS, AND SAYS WHICH ACT FAILED.
 *
 * Audit f2afcbe2 (desk/51, desk/52): the list offered the person's OWN human
 * profile as a memory to rename and delete, and a failed delete said "Your
 * memories could not be loaded" about a list that was on screen.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api/profiles` — the roster read
 * and the delete are the two network calls this panel makes, and the cases
 * are about what it does with their answers, not about the transport.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deleteProfile, fetchProfiles, type ApiOwnedProfile } from "../src/lib/api/profiles";
import { SettingsPanel } from "../src/components/SettingsPanel";

vi.mock("../src/lib/api/profiles", async (original) => ({ ...await original<typeof import("../src/lib/api/profiles")>(),
  fetchProfiles: vi.fn(), deleteProfile: vi.fn(), renameProfile: vi.fn(), createProfile: vi.fn() }));

const row = (id: string, type: "human" | "agent", name: string): ApiOwnedProfile =>
  ({ id, accountId: "account-1", type, name, avatarUrl: null, preferredLocale: "en-US", createdAt: "2026-10-01T00:00:00Z" });
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(fetchProfiles).mockResolvedValue([row("me", "human", "Mobi"), row("agent-1", "agent", "Work agent")]);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.resetAllMocks(); });

async function openAgentProfiles() {
  await act(async () => root.render(<SettingsPanel locale="en-US" email="you@example.test" name="Mobi" onName={vi.fn()} onLocale={vi.fn()}
    busy={false} failed={false} onSignOut={vi.fn()} onDeleteAccount={vi.fn(async () => {})} onClose={vi.fn()} />));
  const toggle = [...host.querySelectorAll<HTMLButtonElement>(".waka-settings-row")].find((b) => b.textContent?.includes("Agent profiles"))!;
  await act(async () => { toggle.click(); });
  await act(async () => { await Promise.resolve(); });
}

it("lists agent profiles only, never the person's own profile", async () => {
  await openAgentProfiles();
  const names = [...host.querySelectorAll<HTMLInputElement>(".waka-settings-rows input")].map((input) => input.defaultValue);
  expect(names).toEqual(["Work agent"]);
  expect(host.textContent).toContain("Agent memory: Work agent");
  expect(host.textContent).toContain("Each agent has its own look, inspirations, top of mind, principles, and chats");
});

it("cancels a pending delete confirmation when returning to Settings", async () => {
  await openAgentProfiles();
  await act(async () => host.querySelector<HTMLButtonElement>(".waka-settings-erase")!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Back to Settings"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[data-settings-target="agents"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>(".waka-settings-erase")!.click());
  expect(deleteProfile).not.toHaveBeenCalled();
});

it("says the delete failed, not that the list failed to load", async () => {
  vi.mocked(deleteProfile).mockRejectedValue(new Error("nope"));
  await openAgentProfiles();
  const erase = host.querySelector<HTMLButtonElement>(".waka-settings-erase")!;
  await act(async () => { erase.click(); });
  await act(async () => { erase.click(); });
  await act(async () => { await Promise.resolve(); });
  const alert = host.querySelector('[role="alert"]')?.textContent ?? "";
  expect(alert).toContain("could not be deleted");
  expect(alert).not.toContain("loaded");
  expect(host.querySelectorAll(".waka-settings-rows li")).toHaveLength(1);
});
