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
        /* this case is `/`, and only `/` may sell */
        offersLanding: true,
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

    /* THE TURN THE PAGE IS BUILT ON, and the promise that answers it. A
       stranger who reads only these two sentences should know what is being
       offered and why it is not the thing they already have. */
    expect(text).toContain("Everything deciding for you is guessing about you.");
    expect(text).toContain("read by whatever acts on your behalf");

    /* The three it has room for: what it does, why its sentences can be
       trusted, and that you keep the pen and the exit. */
    expect(text).toContain("WAKA does the rereading");
    expect(text).toContain("It quotes you rather than summarising you.");
    expect(text).toContain("Correct one and it stays corrected");
    expect(text).toContain("Leave with all of it");

    /* Nothing is asked of them here: no field, no password, no form. */
    expect(container.querySelector("input")).toBeNull();
    expect(container.querySelector("form")).toBeNull();
  });

  it("is one screen — it has a stage and no sections under it", async () => {
    const container = await renderFront("/");

    /* THE SHAPE THE ONE-SCREEN RULING LEFT (founder, 2026-08-28). jsdom has
       no layout, so it cannot see the page overflow — `tools/e2e/one-screen`
       measures that in a real engine. What CAN be held here is the structure
       that makes it possible, and the structure is the part a later change
       would break first: a header, one stage, and nothing stacked below it.

       The three sections this replaced are named so the test fails loudly if
       one is pasted back rather than quietly growing a second screen. */
    expect(container.querySelector(".lp-stage")).not.toBeNull();
    expect(container.querySelectorAll(".lp-point")).toHaveLength(3);

    expect(container.querySelector(".lp-section")).toBeNull();
    expect(container.querySelector(".lp-rungs")).toBeNull();
    expect(container.querySelector(".lp-laws")).toBeNull();

    /* And the founder's other law about numbers: none of them reaches a
       person. No step counter, no "one of three", no percentage. */
    const said = container.querySelector(".lp-stage")?.textContent ?? "";
    expect(said).not.toMatch(/\b\d+\b/);
  });

  it("carries a stranger to the side of the door that makes an account", async () => {
    const container = await renderFront("/");
    const begin = Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).filter(
      (a) => a.getAttribute("href") === "/login?begin",
    );
    /* EXACTLY ONE, and that is the one-screen ruling showing up in the
       funnel. The scrolling page repeated the act at the bottom because a
       reader who had travelled three screens needed it again where they had
       arrived; there is nowhere to arrive now, so a second copy would be a
       duplicate rather than a repeat — and two acts that can disagree is how
       a page gets edited twice and read once. */
    expect(begin).toHaveLength(1);

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

  it("only the root may sell — every other address asks for a password", () => {
    /* `/w/:wall` renders the same component as `/`, and it arrived on dev
       after this rule was written, so git merged the two edits in silence.
       Without this parameter a deep link into somebody's archive answers an
       anonymous visitor with a marketing page.

       Executed rather than reasoned about, which is why the rule takes the
       fact instead of `main.tsx` branching on it: the entry point calls
       `createRoot` at module scope, so no test can import it. */
    for (const remembered of [true, false]) {
      for (const serverUnreachable of [true, false]) {
        expect(
          frontDoorFor({
            authenticated: false,
            remembered,
            serverUnreachable,
            offersLanding: false,
          }),
        ).toBe("door");
      }
    }
    /* and the root still answers all three ways */
    expect(
      frontDoorFor({
        authenticated: false,
        remembered: false,
        serverUnreachable: false,
        offersLanding: true,
      }),
    ).toBe("landing");
    /* the default is the safe direction: absent the fact, it is a deep link */
    expect(
      frontDoorFor({ authenticated: false, remembered: false, serverUnreachable: false }),
    ).toBe("door");
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
            /* these cases mount the component as the ROOT route renders it */
            offersLanding: true,
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
