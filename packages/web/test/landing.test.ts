// @vitest-environment jsdom

/**
 * WHAT A STRANGER MEETS, AND WHAT SOMEBODY WITH AN ARCHIVE DOES NOT.
 *
 * `/` answers three ways now, and two of the three are easy to get wrong in
 * ways nobody would notice until a real person hit them:
 *
 *   - a person whose session merely lapsed being sold the product they
 *     already pay attention to, instead of being let back in;
 *   - a signed-in person on a dead network getting a marketing page, which is
 *     the worst possible answer to "is my archive still there?" — the exact
 *     failure `AuthContextValue.serverUnreachable` was added to stop, met
 *     again one route up;
 *   - a deep link into somebody's archive quietly becoming a sales page
 *     rather than asking for a password.
 *
 * The rule itself is a pure function, so the first half of this file executes
 * it directly. The second half renders the page, because a landing page that
 * cannot be reached is not a landing page, and because the one link that
 * carries the whole funnel — `begin` — has to arrive on the door's `begin`
 * side rather than its sign-in side.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). One seam.
 *
 *   `lib/api` — the layer directly beneath the subject. `AuthProvider` calls
 *   the HTTP client itself and nothing sits between them; the real module is
 *   spread back in through `importOriginal` so `ApiError` stays the class the
 *   product throws. The session state machine is left real, as it is in the
 *   two suites beside this one: the cases below are about what the door
 *   decides while `/auth/me` is still in flight and just after it answers,
 *   and a faked provider would have no such moment to get wrong.
 *
 *   `window.localStorage` is replaced with an in-memory store rather than
 *   mocked: the door's memory IS a record in it, and the middle case above
 *   cannot be stated unless a test can seed it.
 *
 * THIS SUITE NEVER MOUNTS THE WORLD. The authenticated case asserts that the
 * guard is reached, not what is behind it — `pages/Home` answers a failed load
 * by replacing everything with the dev fixture, so a suite that mocked
 * `lib/api` and mounted it would be asserting against invented rows.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FrontDoor } from "../src/components/FrontDoor";
import { fetchCurrentViewer } from "../src/lib/api";
import type { ApiViewer } from "../src/lib/api";
import { AuthProvider } from "../src/lib/auth-context";
import { frontDoorFor } from "../src/lib/front-door";
import { t } from "../src/lib/locales";
import LandingPage from "../src/pages/Landing";
import LoginPage from "../src/pages/Login";

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    fetchCurrentViewer: vi.fn(async () => null),
    login: vi.fn(),
    signup: vi.fn(),
    logout: vi.fn(async () => undefined),
    updateAuthPreferences: vi.fn(),
    updateAuthProfile: vi.fn(),
    deleteAccount: vi.fn(async () => undefined),
  };
});

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const DOOR_KEY = "waka.door.last";

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;
let storage: Record<string, string> = {};

function installMemoryLocalStorage(): void {
  storage = {};
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: vi.fn((key: string) => storage[key] ?? null),
      setItem: vi.fn((key: string, value: string) => {
        storage[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete storage[key];
      }),
    },
  });
}

beforeEach(() => {
  installMemoryLocalStorage();
  vi.mocked(fetchCurrentViewer).mockReset();
  vi.mocked(fetchCurrentViewer).mockResolvedValue(null as unknown as ApiViewer);
});

afterEach(() => {
  if (mountedRoot) {
    act(() => {
      mountedRoot?.unmount();
    });
  }
  mountedRoot = null;
  mountedContainer?.remove();
  mountedContainer = null;
  storage = {};
  vi.clearAllMocks();
});

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/**
 * The landing page and the door, on a router — the two halves of `/`'s answer
 * that a person can actually walk between.
 */
async function renderFront(initialPath: string): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;
  mountedContainer = container;

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: [initialPath] },
        createElement(
          AuthProvider,
          null,
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/", element: createElement(LandingPage) }),
            createElement(Route, { path: "/login", element: createElement(LoginPage) }),
          ),
        ),
      ),
    );
  });
  await flushReactWork();
  await flushReactWork();
  return container;
}

describe("who `/` is answering", () => {
  it("sells the product to a stranger and nobody else", () => {
    expect(
      frontDoorFor({
        authenticated: false,
        remembered: false,
        serverUnreachable: false,
      }),
    ).toBe("landing");
  });

  it("lets a person the door remembers straight back to the door", () => {
    /* Somebody whose session lapsed already knows what WAKA is — they have an
       archive in it. Selling it to them again is the product failing to
       recognise its own user. */
    expect(
      frontDoorFor({
        authenticated: false,
        remembered: true,
        serverUnreachable: false,
      }),
    ).toBe("door");
  });

  it("never shows the sales page to somebody we simply could not ask about", () => {
    /* THE ONE THAT MATTERS MOST. `serverUnreachable` is set only when the
       client never got an answer — a status of 0, never a 401 — so this is a
       person who may well be signed in, on a dead network, wondering whether
       their archive still exists. The door says the true thing in that case
       ("we couldn't reach the server"); a marketing page says their account
       never existed. Holds even with an empty door memory, which is the
       combination a fresh browser profile on a bad connection produces. */
    expect(
      frontDoorFor({
        authenticated: false,
        remembered: false,
        serverUnreachable: true,
      }),
    ).toBe("door");
  });

  it("sends a confirmed session to the world however the rest reads", () => {
    for (const remembered of [true, false]) {
      for (const serverUnreachable of [true, false]) {
        expect(
          frontDoorFor({ authenticated: true, remembered, serverUnreachable }),
        ).toBe("home");
      }
    }
  });
});

describe("the landing page", () => {
  it("says what WAKA is before it asks for anything", async () => {
    const container = await renderFront("/");
    const text = container.textContent ?? "";

    expect(text).toContain("Keep what moves you.");
    /* The four layers, in the order they happen. A stranger who reads only
       the headings should still come away knowing what the product does. */
    expect(text).toContain("A memory");
    expect(text).toContain("A pattern");
    expect(text).toContain("Your top of mind");
    expect(text).toContain("A principle");

    /* Nothing is asked of them here: no field, no password, no form. */
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("draws the ascent as light rather than as numbers", async () => {
    const container = await renderFront("/");
    const rungs = Array.from(container.querySelectorAll<HTMLElement>(".lp-rung"));
    expect(rungs).toHaveLength(4);

    /* THE RAMP IS THE CONTENT. The four layers are ordered, and this is the
       only place on the page that says so — brightness rising from the memory
       you kept to the principle it became, the same ascent `lib/aliveness.ts`
       spends on an orb. Read off the elements rather than trusted: a ramp that
       stopped rising would still look like a list of four dots. */
    const light = rungs.map((el) => Number(el.style.getPropertyValue("--rung-light")));
    expect(light.every((n) => Number.isFinite(n))).toBe(true);
    for (let i = 1; i < light.length; i += 1) {
      expect(light[i]!).toBeGreaterThan(light[i - 1]!);
    }

    /* And the founder's other law about numbers: none of them reaches a
       person. No step counter, no "1 of 4", no percentage. */
    const said = container.querySelector(".lp-rungs")?.textContent ?? "";
    expect(said).not.toMatch(/\b\d+\b/);
  });

  it("carries a stranger to the side of the door that makes an account", async () => {
    const container = await renderFront("/");
    const begin = Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).filter(
      (a) => a.getAttribute("href") === "/login?begin",
    );
    /* Both acts on the page — the hero's and the closing one — go to the same
       place. A landing page whose two calls to action disagree is one that has
       been edited twice and read once. */
    expect(begin.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      begin[0]!.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    });
    await flushReactWork();

    /* THE FUNNEL'S ONE JOB. Dropping somebody the page has just persuaded on
       the sign-in tab would ask them for a password to an account they do not
       have yet. */
    expect(
      container.querySelector("#login-tab-signup")?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.textContent).toContain("Begin your archive.");
  });

  it("still opens on the sign-in side for anyone who arrives plainly", async () => {
    const container = await renderFront("/login");
    expect(
      container.querySelector("#login-tab-login")?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("offers the returning person a way past it without a query", async () => {
    const container = await renderFront("/");
    const plain = Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).filter(
      (a) => a.getAttribute("href") === "/login",
    );
    expect(plain.length).toBeGreaterThanOrEqual(1);
    expect(plain.some((a) => (a.textContent ?? "").includes("continue"))).toBe(true);
  });

  it("speaks the language the stranger's machine speaks", async () => {
    /* THE DEFECT THIS PINS, and it is the one no gate would have caught.
       This page shipped with forty English sentences written straight into
       JSX, on the argument that English was the product's only language. The
       founder reversed that on 2026-08-31 and the same work moved every
       sentence in the world into the catalogue — leaving this page as the
       last surface writing English into markup.

       `copy.test.ts` passed it (it checks JSX text for canon words and the
       catalogue for dead keys, and neither is this), so what it cost was a
       person: `readStoredLocale` falls back to the BROWSER's language, so
       somebody arriving from a Korean machine met Korean chrome on every
       other surface and an entirely English page explaining the product. The
       one screen whose whole job is to be understood by a stranger was the
       one screen that could not speak to them.

       Hangul rather than an exact string, deliberately: the claim is that
       this page reaches the catalogue at all, and pinning a sentence would
       make the case fail on a reworded translation instead of on a
       regression. */
    window.localStorage.setItem("waka.ui.locale", "ko-KR");
    const container = await renderFront("/");
    const text = container.textContent ?? "";

    expect(/[가-힣]/.test(text)).toBe(true);
    expect(text).not.toContain("Keep what moves you.");
    /* every section, not just the hero — the first pass at this moved the
       headline and left the four layers in English */
    for (const key of [
      "landingAscentTitle",
      "landingKeepBody",
      "landingLawsTitle",
      "landingAgentsTitle",
      "landingRoomsBody",
      "landingCloseBody",
    ] as const) {
      expect(text).toContain(t("ko-KR", key));
    }
  });

  it("seeds the door's memory with nothing — it is a page, not a session", async () => {
    await renderFront("/");
    expect(storage[DOOR_KEY]).toBeUndefined();
  });
});

/**
 * AND THE ROUTE IS WIRED TO THE RULE.
 *
 * "The rule is right" and "`/` asks it" are two claims, and the suite above
 * only checks the first. `FrontDoor` takes its three answers as props exactly
 * so this can check the second without dragging `pages/Home` into the import
 * graph — see its header, and `check-seams.mjs` rule 2 for why that matters.
 */
async function renderAt(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;
  mountedContainer = container;

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        createElement(
          AuthProvider,
          null,
          createElement(FrontDoor, {
            home: createElement("main", null, "THE WORLD"),
            door: createElement("main", null, "THE DOOR"),
            landing: createElement("main", null, "THE LANDING PAGE"),
          }),
        ),
      ),
    );
  });
  await flushReactWork();
  await flushReactWork();
  return container;
}

describe("what `/` actually renders", () => {
  it("shows a stranger the landing page", async () => {
    const container = await renderAt();
    expect(container.textContent).toBe("THE LANDING PAGE");
  });

  it("shows the door to somebody it remembers", async () => {
    storage[DOOR_KEY] = JSON.stringify({
      name: "Yunji",
      email: "yunji@example.test",
      at: new Date().toISOString(),
    });
    const container = await renderAt();
    expect(container.textContent).toBe("THE DOOR");
  });

  it("shows the world to a confirmed session", async () => {
    vi.mocked(fetchCurrentViewer).mockResolvedValue({
      account: {
        id: "a1",
        email: "yunji@example.test",
        onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
        isAdmin: false,
      },
      profile: {
        id: "p1",
        accountId: "a1",
        type: "human",
        name: "Yunji",
        avatarUrl: null,
        preferredLocale: "en-US",
        publicHandle: null,
        publicProfileEnabled: false,
        publicTopOfMindEnabled: false,
      },
    });
    const container = await renderAt();
    expect(container.textContent).toBe("THE WORLD");
  });

  it("shows neither while the session question is still open", async () => {
    /* A landing page flashed at somebody who has an account is the same
       half-appearance the world forbids inside itself, in the worst place for
       it. Nothing is decided until `/auth/me` has answered. */
    let answer: (viewer: ApiViewer | null) => void = () => undefined;
    vi.mocked(fetchCurrentViewer).mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }) as Promise<ApiViewer>,
    );

    const container = await renderAt();
    expect(container.textContent).not.toContain("THE LANDING PAGE");
    expect(container.textContent).not.toContain("THE WORLD");
    expect(container.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "loading",
    );

    await act(async () => {
      answer(null);
    });
    await flushReactWork();
    expect(container.textContent).toBe("THE LANDING PAGE");
  });
});
