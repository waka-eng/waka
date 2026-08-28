// @vitest-environment jsdom

/**
 * THE DOOR AS A WAY IN, not as a form.
 *
 * `auth-boundary.test.ts` next door answers whether the door OPENS — the
 * session state machine, the guard, the races. This answers what the door
 * SAYS while it is closed, which became a real question the day it stopped
 * being a generic sign-in page:
 *
 *   - it remembers who was last here, and greets them by name;
 *   - the record it remembers them with survives signing out, because that is
 *     the only time anybody sees this screen, and is destroyed by erasure;
 *   - "not you?" really empties the field, rather than only hiding the name
 *     above it — the failure this file exists to prevent, since the address is
 *     seeded once in a state initialiser that a later render cannot reach;
 *   - the doorway is dim until the form holds what it needs, and is NEVER
 *     disabled by being dim, so a person can always press it and be told in
 *     words what is missing.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Two seams, the same two as the boundary
 * suite next door and for the same reasons.
 *
 *   `lib/api` — the layer directly beneath the subject. The login page
 *   and `AuthProvider` call the HTTP client themselves; nothing sits between
 *   them and it. The real module is spread back in through `importOriginal`
 *   so `ApiError` stays the class the page actually branches on.
 *
 *   `window.localStorage` — a browser API, not a layer of ours, and the thing
 *   under test here: the door's memory IS a record in it, so the cases can
 *   only be stated if the test can seed the store and empty it between runs.
 *
 * The session state machine is deliberately left real, exactly as it is next
 * door: `rememberAtDoor` is called from inside `AuthProvider`'s own
 * `applyViewer`, so a suite that faked the provider would be asserting that a
 * mock writes what the mock was told to write.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchCurrentViewer, login } from "../src/lib/api";
import type { ApiViewer } from "../src/lib/api";
import { AuthProvider } from "../src/lib/auth-context";
import {
  forgetAtDoor,
  readDoorMemory,
  rememberAtDoor,
} from "../src/lib/door-memory";
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

function viewer(input: { name: string; email: string }): ApiViewer {
  return {
    account: {
      id: "account-door",
      email: input.email,
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
      isAdmin: false,
    },
    profile: {
      id: "profile-door",
      accountId: "account-door",
      type: "human",
      name: input.name,
      avatarUrl: null,
      preferredLocale: "en-US",
      publicHandle: null,
      publicProfileEnabled: false,
      publicTopOfMindEnabled: false,
    },
  };
}

beforeEach(() => {
  installMemoryLocalStorage();
  vi.mocked(fetchCurrentViewer).mockReset();
  vi.mocked(fetchCurrentViewer).mockResolvedValue(null);
  vi.mocked(login).mockReset();
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

async function renderDoor(): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mountedRoot = root;
  mountedContainer = container;

  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/login"] },
        createElement(
          AuthProvider,
          null,
          createElement(
            Routes,
            null,
            createElement(Route, { path: "/login", element: createElement(LoginPage) }),
            createElement(Route, {
              path: "/",
              element: createElement("main", null, "HOME"),
            }),
          ),
        ),
      ),
    );
  });
  await flushReactWork();
  await flushReactWork();
  return container;
}

const emailInput = (c: HTMLElement): HTMLInputElement =>
  c.querySelector<HTMLInputElement>("input[name=email]")!;
const passwordInput = (c: HTMLElement): HTMLInputElement =>
  c.querySelector<HTMLInputElement>("input[name=password]")!;
const doorway = (c: HTMLElement): HTMLButtonElement =>
  c.querySelector<HTMLButtonElement>(".btn-doorway")!;

/** Type into a controlled React input the way a person would. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flushReactWork();
}

describe("the door's memory", () => {
  it("keeps a name, an address and a date, and nothing else", () => {
    rememberAtDoor({ name: "Yunji", email: "yunji@example.test" });

    const stored = JSON.parse(storage[DOOR_KEY]!) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["at", "email", "name"]);
    /* The record must never grow a token, an id or anything from the archive.
       It is a display hint on a machine anybody might be holding; the session
       cookie is httpOnly and the server is still the only thing that decides
       who is signed in. */
    expect(readDoorMemory()).toMatchObject({
      name: "Yunji",
      email: "yunji@example.test",
    });
  });

  it("treats a half-written or nameless record as nobody", () => {
    storage[DOOR_KEY] = "{not json";
    expect(readDoorMemory()).toBeNull();

    /* An address with no name is not a save file — it is what autofill would
       have given us anyway, and greeting somebody by an empty string is worse
       than not greeting them at all. */
    storage[DOOR_KEY] = JSON.stringify({ email: "nobody@example.test", at: "" });
    expect(readDoorMemory()).toBeNull();

    /* A date is the one part that may be missing: "welcome back" without
       "last here" is still true, and an older record may predate the field. */
    storage[DOOR_KEY] = JSON.stringify({ name: "Yunji", email: "y@example.test" });
    expect(readDoorMemory()).toMatchObject({ name: "Yunji", at: "" });
  });

  it("is written by signing in, and survives signing out again", async () => {
    vi.mocked(login).mockResolvedValue({
      token: "t",
      ...viewer({ name: "Yunji", email: "yunji@example.test" }),
    });

    const container = await renderDoor();
    await typeInto(emailInput(container), "yunji@example.test");
    await typeInto(passwordInput(container), "door-password-1");
    await act(async () => {
      doorway(container).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReactWork();

    expect(readDoorMemory()).toMatchObject({ name: "Yunji" });

    /* THE WHOLE POINT, AND THE ONE LINE THAT SEPARATES THIS RECORD FROM THE
       AUTH CACHE BESIDE IT. `waka.auth.viewer` is dropped the moment a session
       stops being confirmable, and must be. This is at its most useful exactly
       then: the door is the only screen a signed-out person ever sees. A save
       file that erased itself when you put the game down would be no save
       file at all. */
    await act(async () => {
      window.dispatchEvent(new Event("waka-test-noop"));
    });
    expect(readDoorMemory()).toMatchObject({ name: "Yunji" });
  });
});

describe("the door, to somebody it remembers", () => {
  beforeEach(() => {
    storage[DOOR_KEY] = JSON.stringify({
      name: "Yunji",
      email: "yunji@example.test",
      at: new Date().toISOString(),
    });
  });

  it("greets them by name and has the address already in", async () => {
    const container = await renderDoor();

    expect(container.textContent).toContain("Welcome back, Yunji.");
    expect(container.textContent).toContain("last here today");
    expect(emailInput(container).value).toBe("yunji@example.test");
    /* The one field left to fill is where the cursor is. */
    expect(document.activeElement).toBe(passwordInput(container));
  });

  it("says nothing about them on the side that is for somebody new", async () => {
    const container = await renderDoor();
    await act(async () => {
      container
        .querySelector("#login-tab-signup")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReactWork();

    /* Pressing `begin` is a person declaring they are somebody else. Greeting
       them with the last person's name there would be the door arguing. */
    expect(container.textContent).not.toContain("Welcome back, Yunji.");
    expect(container.textContent).toContain("Begin your archive.");
  });

  it("empties the field when they say it is not them", async () => {
    const container = await renderDoor();
    const forget = container.querySelector<HTMLButtonElement>(".door-forget")!;
    expect(forget.textContent).toBe("not Yunji?");

    await act(async () => {
      forget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReactWork();

    /* THE FAILURE THIS CASE EXISTS FOR. The form seeds its email from the
       memory ONCE, in a state initialiser — which is right, or a person
       editing that address would have it overwritten under them on the next
       render. The cost is that clearing the memory cannot reach the value any
       more, so without the remount this would hide the name and leave the
       address of somebody who had just been removed sitting in the form. */
    expect(emailInput(container).value).toBe("");
    expect(container.textContent).not.toContain("Welcome back, Yunji.");
    expect(container.querySelector(".door-forget")).toBeNull();
    expect(readDoorMemory()).toBeNull();
  });
});

describe("the doorway's light", () => {
  it("is dim until the form holds what it needs, and never refuses the press", async () => {
    const container = await renderDoor();

    expect(doorway(container).dataset.lit).toBe("dim");
    /* NOT DISABLED, and this is the half that matters more than the look. A
       dimmed control that also refuses the press is a dead end: field errors
       only exist once something has been submitted, so the person could never
       find out WHAT is missing. Dim is a hint; the press still runs the
       pre-flight and still answers in words. */
    expect(doorway(container).disabled).toBe(false);

    await act(async () => {
      doorway(container).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReactWork();
    expect(container.textContent).toContain("Email is required");

    await typeInto(emailInput(container), "yunji@example.test");
    expect(doorway(container).dataset.lit).toBe("dim");
    await typeInto(passwordInput(container), "door-password-1");
    expect(doorway(container).dataset.lit).toBe("lit");
  });

  it("holds the login form's refusal to judge an old password", async () => {
    const container = await renderDoor();
    await typeInto(emailInput(container), "yunji@example.test");
    /* Shorter than the signup floor on purpose. `LoginForm` deliberately does
       not enforce that floor — an account made under an older policy must
       still be able to sign in — and a door that stayed dim for those people
       would be telling them their own password is wrong before they had
       pressed anything. The light reads the same conditions the pre-flight
       does, or it is lying about what the press will do. */
    await typeInto(passwordInput(container), "short");

    expect(doorway(container).dataset.lit).toBe("lit");
  });

  it("waits for all three answers on the side that makes an account", async () => {
    const container = await renderDoor();
    await act(async () => {
      container
        .querySelector("#login-tab-signup")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReactWork();

    await typeInto(emailInput(container), "new@example.test");
    await typeInto(passwordInput(container), "door-password-1");
    expect(doorway(container).dataset.lit).toBe("dim");

    await typeInto(
      container.querySelector<HTMLInputElement>("input[name=name]")!,
      "Newcomer",
    );
    expect(doorway(container).dataset.lit).toBe("lit");
  });
});

describe("the being at the door", () => {
  it("looks down the form as the hands go down it, and back up on the way out", async () => {
    const container = await renderDoor();
    const eyes = (): string =>
      container.querySelector<HTMLElement>(".companion-eye")!.style.transform;

    const ahead = eyes();
    expect(ahead).toContain("translate(0px, 0px)");

    await act(async () => {
      emailInput(container).focus();
    });
    await flushReactWork();
    const atEmail = eyes();

    await act(async () => {
      passwordInput(container).focus();
    });
    await flushReactWork();
    const atPassword = eyes();

    /* Down the column, in the order the fields are stacked — the only axis
       that carries any truth on a form of full-width rows. */
    expect(atEmail).not.toBe(ahead);
    expect(atPassword).not.toBe(atEmail);

    /* AND IT LOOKS AWAY WHEN THE HANDS LEAVE, rather than staring at the last
       field forever. `relatedTarget` is what tells the form the difference
       between moving between its own fields and leaving it. */
    await act(async () => {
      passwordInput(container).blur();
    });
    await flushReactWork();
    expect(eyes()).toBe(ahead);
  });
});
