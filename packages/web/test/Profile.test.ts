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
