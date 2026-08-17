// @vitest-environment jsdom

/**
 * THE PROFILE PAGE — the account's settings, its memories, its connections.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Two modules, one layer apart.
 *
 *   `lib/api` — the layer directly beneath this page. `pages/Profile.tsx`
 *   imports the HTTP client and calls it; nothing sits in between, because
 *   `lib/data` translates only the three layers of the world and this page
 *   renders none of them. Six functions are replaced and the rest of the real
 *   module is spread back in, so `ApiError` and the payload types stay the
 *   product's own.
 *
 *   `lib/auth-context` — one layer ABOVE `lib/api`, and that is the deliberate
 *   part. The subject here is what the page DOES with a session, not how a
 *   session is arrived at; `auth-boundary.test.ts` owns the second question
 *   and drives the real provider through a mocked `lib/api` to answer it.
 *   Stating the session as a fact here is what stops a change in the sign-in
 *   flow from turning twenty assertions about tab order red.
 *
 * WHY MOCKING `lib/api` IS SAFE HERE, given that mocking `lib/api` is the
 * exact mistake G6 exists to prevent. The suite that burned this project
 * mocked it under `pages/Home`, which answers a failed load by replacing the
 * whole world with the dev fixture — so every assertion held against invented
 * rows and the suite stayed green. This page has no such fallback: every
 * `catch` in `Profile.tsx` puts a message on screen and renders nothing in
 * place of the data it did not get. A mock that is wrong here produces an
 * empty page and a red test, not a green one describing something else.
 */
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

const mockConnectionsApi = vi.hoisted(() => {
  const base = {
    profile: { id: "profile-1", name: "River", type: "human" as "human" | "agent" },
    createdAt: "2026-08-16T04:00:00.000Z",
    lastSeenAt: "2026-08-16T06:00:00.000Z",
    expiresAt: "2026-09-15T04:00:00.000Z",
  };
  return {
    rows: [
      { ...base, id: "session-current", deviceLabel: "Chrome on macOS", current: true },
      { ...base, id: "session-other", deviceLabel: "agis-Mac-mini.local", current: false },
      { ...base, id: "session-bare", deviceLabel: null, current: false },
    ],
    fetchConnections: vi.fn(async () => mockConnectionsApi.rows),
    endConnection: vi.fn(async () => undefined),
  };
});

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
  fetchConnections: mockConnectionsApi.fetchConnections,
  endConnection: mockConnectionsApi.endConnection,
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

/** Click a tab by its visible label and let React settle. */
async function openTab(container: HTMLDivElement, label: string): Promise<void> {
  const tab = Array.from(container.querySelectorAll<HTMLButtonElement>(".profile-tab")).find(
    (button) => button.textContent?.trim() === label,
  );
  if (!tab) throw new Error(`no tab labelled ${label}`);
  await act(async () => {
    tab.click();
  });
}

function memoryRows(container: HTMLDivElement): HTMLLIElement[] {
  return Array.from(container.querySelectorAll<HTMLLIElement>(".profile-memory-row"));
}

describe("ProfilePage memories", () => {
  it("lists every memory the account owns, labelled by kind", async () => {
    const container = await renderProfilePage();
    await openTab(container, "Memories & connections");
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
    await openTab(container, "Memories & connections");
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
    await openTab(container, "Memories & connections");
    const input = memoryRows(container)[1]?.querySelector<HTMLInputElement>("input");
    expect(input).toBeTruthy();

    await act(async () => {
      typeInto(input!, "claude-code");
    });

    expect(memoryRows(container)).toHaveLength(2);
    expect(input?.value).toBe("claude-code");
  });

  it("shows rename only once the name actually changes", async () => {
    const container = await renderProfilePage();
    await openTab(container, "Memories & connections");
    const row = () => memoryRows(container)[1]!;
    const rename = () =>
      Array.from(row().querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Rename"),
      );

    // A permanently disabled button on every row is noise pretending to be
    // affordance — until the name changes there is nothing to offer.
    expect(rename()).toBeUndefined();

    await act(async () => {
      typeInto(row().querySelector<HTMLInputElement>("input")!, "claude-code");
    });
    expect(rename()).toBeTruthy();

    await act(async () => {
      rename()?.click();
    });
    expect(mockProfilesApi.renameProfile).toHaveBeenCalledWith("profile-2", "claude-code");
  });

  it("asks before removing a memory, and does nothing when declined", async () => {
    const container = await renderProfilePage();
    await openTab(container, "Memories & connections");
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

describe("ProfilePage connections", () => {
  const connectionRows = (container: HTMLDivElement) =>
    Array.from(container.querySelectorAll<HTMLLIElement>(".profile-connection-row"));

  it("lists every connection, naming the one you are using", async () => {
    const container = await renderProfilePage();
    await openTab(container, "Memories & connections");
    const rows = connectionRows(container);

    expect(rows).toHaveLength(3);
    expect(rows[0]?.textContent).toContain("Chrome on macOS");
    expect(rows[0]?.textContent).toContain("this device");
    expect(rows[1]?.textContent).not.toContain("this device");
  });

  /** A login that never named itself still has to be recognisable in a list. */
  it("gives an unlabelled connection a readable name", async () => {
    const container = await renderProfilePage();
    await openTab(container, "Memories & connections");
    expect(connectionRows(container)[2]?.textContent).toContain("Unnamed device");
  });

  /** No surface may hand back a credential; there is nothing to hand back. */
  it("never renders a token", async () => {
    const container = await renderProfilePage();
    await openTab(container, "Memories & connections");
    const panel = container.querySelector("#profile-connections-title")?.closest("section");
    expect(panel?.textContent).not.toMatch(/token|eyJ/i);
  });

  it("asks before ending a connection, and does nothing when declined", async () => {
    const container = await renderProfilePage();
    await openTab(container, "Memories & connections");
    const end = connectionRows(container)[1]?.querySelector("button");

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => {
      end?.click();
    });
    expect(mockConnectionsApi.endConnection).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    await act(async () => {
      end?.click();
    });
    expect(mockConnectionsApi.endConnection).toHaveBeenCalledWith("session-other");
    confirmSpy.mockRestore();
  });

  /**
   * Ending the device in your hand is a different promise from ending some
   * other machine, so it has to ask a different question — and then leave,
   * because every request this page makes next would be unauthorized.
   */
  it("warns differently before ending the current device", async () => {
    const container = await renderProfilePage();
    await openTab(container, "Memories & connections");
    const end = connectionRows(container)[0]?.querySelector("button");

    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    await act(async () => {
      end?.click();
    });

    expect(confirmSpy.mock.calls[0]?.[0]).toContain("signs you out here");
    confirmSpy.mockRestore();
  });
});

describe("ProfilePage rooms", () => {
  const tabs = (container: HTMLDivElement) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>(".profile-tab"));
  const shown = (container: HTMLDivElement, id: string) =>
    !container.querySelector(`#profile-panel-${id}`)?.hasAttribute("hidden");

  it("offers exactly two rooms as a tablist", async () => {
    const container = await renderProfilePage();

    expect(tabs(container).map((t) => t.textContent)).toEqual([
      "You",
      "Memories & connections",
    ]);
    expect(tabs(container)[0]?.getAttribute("aria-selected")).toBe("true");
    expect(tabs(container)[0]?.getAttribute("aria-controls")).toBe("profile-panel-you");
    expect(tabs(container)[1]?.getAttribute("aria-controls")).toBe("profile-panel-access");
  });

  it("shows one room at a time", async () => {
    const container = await renderProfilePage();
    expect([shown(container, "you"), shown(container, "access")]).toEqual([true, false]);

    await openTab(container, "Memories & connections");
    expect([shown(container, "you"), shown(container, "access")]).toEqual([false, true]);
  });

  /** Deleting an account should not sit beside a language picker. */
  /*
    Two gates, one attribute (`Profile.tsx`): the tab it lives on, and the word
    that reveals it. This asserted only the first, from before the screen
    disclosed progressively — so it read the closed disclosure as a missing
    panel. Both gates are checked now, because "only in the identity room" and
    "only once asked for" are separate promises and either can break alone.
  */
  it("keeps account deletion in the identity room only, and behind a word", async () => {
    const container = await renderProfilePage();
    const danger = () => container.querySelector(".profile-danger-panel");
    const disclose = () =>
      container.querySelector<HTMLButtonElement>(".profile-disclose-inline");

    expect(danger()?.hasAttribute("hidden")).toBe(true);

    await act(async () => {
      disclose()?.click();
    });
    expect(danger()?.hasAttribute("hidden")).toBe(false);

    await openTab(container, "Memories & connections");
    expect(danger()?.hasAttribute("hidden")).toBe(true);
  });

  /** The indicator moves by transform alone; its offset is the active index. */
  it("slides the indicator to the active tab", async () => {
    const container = await renderProfilePage();
    const pill = () =>
      container.querySelector<HTMLElement>(".profile-tabs-indicator")?.style.transform;

    expect(pill()).toBe("translateX(0%)");
    await openTab(container, "Memories & connections");
    expect(pill()).toBe("translateX(100%)");
  });

  /** A tablist that only answers a mouse is a tablist half-built. */
  it("moves between tabs with the arrow keys, wrapping at the ends", async () => {
    const container = await renderProfilePage();
    const press = async (key: string) => {
      const active = tabs(container).find((t) => t.getAttribute("aria-selected") === "true");
      await act(async () => {
        active?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      });
    };

    await press("ArrowRight");
    expect(tabs(container)[1]?.getAttribute("aria-selected")).toBe("true");

    await press("ArrowRight");
    // Wrapped forward from the last tab back to the first.
    expect(tabs(container)[0]?.getAttribute("aria-selected")).toBe("true");
  });
});
