// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProfilePage from "../src/pages/Profile";

const mockAuthState = vi.hoisted(() => {
  const account = {
    id: "account-1",
    email: "river@example.com",
    onboardingCompletedAt: "2026-05-01T00:00:00.000Z",
    isAdmin: false,
  };
  const profile = {
    id: "profile-1",
    accountId: "account-1",
    type: "human" as "human" | "agent",
    name: "River",
    avatarUrl: null,
    preferredLocale: "en-US" as "en-US" | "ko-KR",
    publicHandle: "q00",
    publicProfileEnabled: false,
    publicTopOfMindEnabled: false,
  };
  return {
    value: {
      account,
      profile,
      isLoading: false,
      isAuthenticated: true,
      login: vi.fn(),
      signup: vi.fn(),
      logout: vi.fn(async () => undefined),
      refresh: vi.fn(async () => null),
      updatePreferredLocale: vi.fn(),
      updateProfile: vi.fn(async () => ({
        account,
        profile: {
          ...profile,
          publicProfileEnabled: true,
          publicTopOfMindEnabled: true,
        },
      })),
      deleteAccount: vi.fn(async () => undefined),
    },
  };
});

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => mockAuthState.value,
}));

const mockProfilesApi = vi.hoisted(() => {
  const human = {
    id: "profile-1",
    accountId: "account-1",
    type: "human" as "human" | "agent",
    name: "River",
    avatarUrl: null,
    preferredLocale: "en-US" as "en-US" | "ko-KR",
    createdAt: "2026-05-01T00:00:00.000Z",
  };
  const agent = { ...human, id: "profile-2", type: "agent" as const, name: "claude" };
  return {
    rows: [human, agent],
    fetchProfiles: vi.fn(async () => mockProfilesApi.rows),
    createProfile: vi.fn(async (name: string) => ({ ...agent, id: "profile-3", name })),
    renameProfile: vi.fn(async (id: string, name: string) => ({ ...agent, id, name })),
    deleteProfile: vi.fn(async () => undefined),
  };
});

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api")>()),
  fetchProfiles: mockProfilesApi.fetchProfiles,
  createProfile: mockProfilesApi.createProfile,
  renameProfile: mockProfilesApi.renameProfile,
  deleteProfile: mockProfilesApi.deleteProfile,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;

afterEach(() => {
  if (mountedRoot) {
    act(() => {
      mountedRoot?.unmount();
    });
  }
  mountedRoot = null;
  mountedContainer?.remove();
  mountedContainer = null;
  mockAuthState.value.logout.mockClear();
  mockAuthState.value.updateProfile.mockClear();
  mockAuthState.value.deleteAccount.mockClear();
});

async function renderProfilePage(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;
  mountedContainer = container;

  await act(async () => {
    root.render(createElement(MemoryRouter, null, createElement(ProfilePage)));
  });

  return container;
}

describe("ProfilePage account actions", () => {
  it("places sign out on the profile page and invokes logout", async () => {
    const container = await renderProfilePage();

    const signOut = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Sign out"),
    );

    expect(signOut).toBeTruthy();
    expect(signOut?.className).toContain("profile-signout-button");

    await act(async () => {
      signOut?.click();
    });

    expect(mockAuthState.value.logout).toHaveBeenCalledTimes(1);
  });

  it("renders delete account as a visibly destructive action", async () => {
    const container = await renderProfilePage();

    const deleteButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Delete account"),
    );

    expect(deleteButton).toBeTruthy();
    expect(deleteButton?.className).toContain("btn-destructive");
  });

  it("saves public profile handle and top-of-mind visibility", async () => {
    const container = await renderProfilePage();

    const checkboxes = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='checkbox']"));
    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Save profile"),
    );

    expect(container.querySelector<HTMLInputElement>("input[name='publicHandle']")).toBeTruthy();
    expect(checkboxes).toHaveLength(2);
    expect(checkboxes[0]?.getAttribute("aria-describedby")).toBe("profile-public-profile-description");
    expect(checkboxes[1]?.getAttribute("aria-describedby")).toBe("profile-public-top-of-mind-description");
    await act(async () => {
      checkboxes[0]!.click();
    });
    await act(async () => {
      checkboxes[1]!.click();
    });
    await act(async () => {
      saveButton?.click();
    });

    expect(mockAuthState.value.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        publicHandle: "q00",
        publicProfileEnabled: true,
        publicTopOfMindEnabled: true,
      }),
    );
  });

  it("describes the destructive delete confirmation input and action", async () => {
    const container = await renderProfilePage();
    const deleteInput = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='text']")).at(-1);
    const deleteButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Delete account"),
    );

    expect(deleteInput?.getAttribute("aria-describedby")).toBe("profile-delete-description");
    expect(deleteButton?.getAttribute("aria-describedby")).toBe("profile-delete-description");
    expect(container.querySelector("#profile-delete-description")?.textContent).toContain("Type DELETE");
  });
});

/**
 * Typing a new name into a memory row.
 *
 * Uses the native value setter plus a real `input` event, which is how React
 * sees a keystroke — the detail matters, because the bug this guards against
 * only appears when React's own onChange path runs.
 */
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function memoryRows(container: HTMLDivElement): HTMLLIElement[] {
  return Array.from(container.querySelectorAll<HTMLLIElement>(".profile-memory-row"));
}

describe("ProfilePage memories", () => {
  it("lists every memory the account owns, labelled by kind", async () => {
    const container = await renderProfilePage();
    const rows = memoryRows(container);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector(".profile-memory-badge")?.textContent).toBe("you");
    expect(rows[1]?.querySelector(".profile-memory-badge")?.textContent).toBe("agent");
  });

  /**
   * The human profile is the account's own memory and the server refuses to
   * delete it. Offering a button that always fails would be a lie; a disabled
   * one would imply it is merely not allowed *right now*.
   */
  it("offers no remove control at all on the human memory", async () => {
    const container = await renderProfilePage();
    const [human, agent] = memoryRows(container);

    const removeLabels = (row?: HTMLLIElement) =>
      Array.from(row?.querySelectorAll("button") ?? []).map((b) => b.textContent);

    expect(removeLabels(human).some((label) => label?.includes("Remove"))).toBe(false);
    expect(removeLabels(agent).some((label) => label?.includes("Remove"))).toBe(true);
  });

  /**
   * The regression this file exists for: reading `event.currentTarget.value`
   * inside a state updater crashed the whole page on the first keystroke,
   * because React runs that callback after the handler returns and nulls
   * `currentTarget` by then. Rendering is not enough to catch it — a key has
   * to actually be typed.
   */
  it("survives typing a new name into a memory row", async () => {
    const container = await renderProfilePage();
    const input = memoryRows(container)[1]?.querySelector<HTMLInputElement>("input");
    expect(input).toBeTruthy();

    await act(async () => {
      typeInto(input!, "claude-code");
    });

    expect(memoryRows(container)).toHaveLength(2);
    expect(input?.value).toBe("claude-code");
  });

  it("keeps rename inert until the name actually changes", async () => {
    const container = await renderProfilePage();
    const row = memoryRows(container)[1]!;
    const rename = Array.from(row.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Rename"),
    );

    expect(rename?.disabled).toBe(true);

    await act(async () => {
      typeInto(row.querySelector<HTMLInputElement>("input")!, "claude-code");
    });
    expect(rename?.disabled).toBe(false);

    await act(async () => {
      rename?.click();
    });
    expect(mockProfilesApi.renameProfile).toHaveBeenCalledWith("profile-2", "claude-code");
  });

  it("asks before removing a memory, and does nothing when declined", async () => {
    const container = await renderProfilePage();
    const remove = Array.from(memoryRows(container)[1]!.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Remove"),
    );

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => {
      remove?.click();
    });
    expect(confirmSpy).toHaveBeenCalled();
    expect(mockProfilesApi.deleteProfile).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await act(async () => {
      remove?.click();
    });
    expect(mockProfilesApi.deleteProfile).toHaveBeenCalledWith("profile-2");
    confirmSpy.mockRestore();
  });
});
