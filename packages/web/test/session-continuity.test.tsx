// @vitest-environment jsdom

/**
 * A DEAD NETWORK IS NOT A SIGN-OUT, AND A SIGN-OUT IS NOT A DEAD END.
 *
 * Two failures of the way in, found by the dead-ends audit of 2026-10-17:
 *
 *   OFFLINE AT STARTUP SIGNED YOU OUT. `/auth/me` failing with no answer fell
 *   through `RequireAuth` to the sign-in form, so a person with a perfectly
 *   good session was asked for a password they did not need, with nothing on
 *   screen that would ask the server again.
 *
 *   A SESSION THAT ENDED MID-FLOW HAD NOWHERE TO GO. Every screen met the 401
 *   as its own local error, and the door, when reached, said "Welcome back"
 *   and sent the person to the top of the product rather than to where they
 *   were — and whether their unsent words survived was anybody's guess.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api`'s `fetchCurrentViewer` only —
 * the one call `AuthProvider` makes itself, so a case can say "the server did
 * not answer" and then "now it does". Everything else is real: the provider,
 * `RequireAuth`, the login page, a real router, jsdom's real `localStorage`
 * holding a real conversation draft, and the real transport for the 401
 * signal (with the global `fetch` as its network seam, as in `api.test.ts`).
 * The protected route renders a one-line placeholder, never `pages/Home`,
 * for the reason `auth-boundary.test.ts` gives.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LoadingHome } from "../src/components/LoadingHome";
import { RequireAuth } from "../src/components/RequireAuth";
import { ApiError, fetchCurrentViewer, fetchInspiration, login } from "../src/lib/api";
import type { ApiViewer } from "../src/lib/api";
import { AuthProvider } from "../src/lib/auth-context";
import { readConversationDrafts, storeConversationDraft } from "../src/lib/conversation-drafts";
import LoginPage from "../src/pages/Login";

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return { ...actual, fetchCurrentViewer: vi.fn(async () => null), login: vi.fn() };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWER: ApiViewer = {
  account: { id: "account-1", email: "ada@example.com", onboardingCompletedAt: "2026-01-01T00:00:00.000Z", isAdmin: false },
  profile: {
    id: "profile-1", accountId: "account-1", type: "human", name: "Ada", avatarUrl: null,
    preferredLocale: "en-US", publicHandle: null, publicProfileEnabled: false, publicTopOfMindEnabled: false,
  },
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(path: string): Promise<void> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(createElement(MemoryRouter, { initialEntries: [path] },
      createElement(AuthProvider, null,
        createElement(Routes, null,
          createElement(Route, { path: "/login", element: createElement(LoginPage) }),
          createElement(Route, { path: "*", element: createElement(RequireAuth, null, createElement("main", null, "protected")) }),
        ))));
  });
  await act(async () => { await Promise.resolve(); });
}

const text = () => container?.textContent ?? "";
const press = async (label: string) => {
  const button = [...(container?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
  expect(button, `no "${label}" button on screen: ${text()}`).toBeTruthy();
  await act(async () => { button!.click(); });
  await act(async () => { await Promise.resolve(); });
};

beforeEach(() => { window.localStorage.clear(); vi.mocked(fetchCurrentViewer).mockReset(); });
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null; container = null;
  vi.unstubAllGlobals();
});

describe("offline at startup", () => {
  it("says WAKA cannot be reached, keeps the door shut, and lets the person ask again", async () => {
    vi.mocked(fetchCurrentViewer).mockRejectedValue(new ApiError({ status: 0, message: "unreachable" }));
    await mount("/");
    expect(text()).toContain("We can’t reach WAKA right now");
    expect(text(), "an unanswered check sent a signed-in person to the sign-in form").not.toContain("Sign in to return");
    expect(text()).not.toContain("protected");

    vi.mocked(fetchCurrentViewer).mockResolvedValue(VIEWER);
    await press("Try again");
    expect(text()).toContain("protected");
  });

  it("goes to the door when the second ask answers signed-out", async () => {
    vi.mocked(fetchCurrentViewer).mockRejectedValue(new ApiError({ status: 0, message: "unreachable" }));
    await mount("/");
    vi.mocked(fetchCurrentViewer).mockResolvedValue(null);
    await press("Try again");
    expect(text()).toContain("Sign in to return");
  });
});

describe("a session that ends mid-flow", () => {
  it("lands on a calm door that names what happened, keeps the draft, and returns to the same place", async () => {
    window.history.replaceState(null, "", "/chat/thread-1");
    vi.mocked(fetchCurrentViewer).mockResolvedValue(VIEWER);
    await mount("/chat/thread-1");
    expect(text()).toContain("protected");
    storeConversationDraft({ accountId: "account-1", profileId: "profile-1" }, "thread-1",
      { id: crypto.randomUUID(), writer: crypto.randomUUID(), updatedAt: 1, revision: 0, pending: false, content: "half a thought" });

    /* the real transport sees a 401 from a resource route */
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 })));
    await act(async () => { await fetchInspiration("inspiration-1").catch(() => undefined); });
    await act(async () => { await Promise.resolve(); });

    expect(text()).toContain("You were signed out.");
    expect(text()).toContain("Anything you were writing is still here.");
    expect(readConversationDrafts({ accountId: "account-1", profileId: "profile-1" }, "thread-1").map((row) => row.value.content))
      .toEqual(["half a thought"]);

    vi.mocked(login).mockResolvedValue(VIEWER);
    const email = container!.querySelector<HTMLInputElement>('input[type="email"]')!;
    const password = container!.querySelector<HTMLInputElement>('input[type="password"]')!;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setValue.call(email, "ada@example.com"); email.dispatchEvent(new Event("input", { bubbles: true }));
      setValue.call(password, "correct horse battery"); password.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { email.form!.requestSubmit(); });
    await act(async () => { await Promise.resolve(); });
    expect(text(), "signing in again did not return to the conversation").toContain("protected");
    expect(text()).not.toContain("You were signed out.");
  });

  it("does not treat a wrong password or an anonymous /auth/me as an expiry", async () => {
    const heard = vi.fn();
    window.addEventListener("waka:session-expired", heard);
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
      const { apiFetch } = await import("../src/lib/api/transport");
      await apiFetch("/api/auth/login", { method: "POST" });
      await apiFetch("/api/auth/me");
      expect(heard).not.toHaveBeenCalled();
      await apiFetch("/api/inspirations");
      expect(heard).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("waka:session-expired", heard);
    }
  });
});

describe("the loading screen's failure face", () => {
  it("replaces LOADING with what went wrong and every way out it was given", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const retry = vi.fn(), out = vi.fn();
    await act(async () => {
      root!.render(createElement(LoadingHome, { problem: {
        message: "Your home didn’t load.", detail: "The server could not be reached.",
        actions: [{ label: "Try again", onClick: retry }, { label: "Sign out", onClick: out }],
      } }));
    });
    expect(text()).not.toContain("Loading");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Your home didn’t load.");
    await press("Try again");
    await press("Sign out");
    expect(retry).toHaveBeenCalledTimes(1);
    expect(out).toHaveBeenCalledTimes(1);
  });
});
