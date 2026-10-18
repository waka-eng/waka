// @vitest-environment jsdom

/**
 * WHO IS SIGNED IN, AND WHAT THAT OPENS.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Two seams, and they are different kinds
 * of thing.
 *
 *   `lib/api` — the layer directly beneath the subject. `AuthProvider`,
 *   `RequireAuth` and the login page call the HTTP client themselves. Nothing
 *   sits between them and it: `lib/data` translates only the three layers of
 *   the world, and none of them appear on this screen. So the module
 *   immediately below the code under test is `lib/api`, and that is the one
 *   replaced. The real module is spread back in through `importOriginal` so
 *   that `ApiError` stays the class the product actually throws — the login
 *   page branches on it, and a look-alike would take the wrong branch.
 *
 *   `window.localStorage` — a browser API, not a layer of ours. The cached
 *   viewer is written there, and several cases below are about a stale cache
 *   losing a race with a fresh sign-in, which can only be stated if the test
 *   can see the store and empty it between runs.
 *
 * WHAT IS DELIBERATELY LEFT REAL, and this is the whole point of the file: the
 * session state machine. Every case runs through the real `AuthProvider`, the
 * real `RequireAuth` and a real router, because the bugs this suite exists for
 * are ORDERING bugs — a slow `/auth/me` answering after a login has already
 * succeeded and wiping it. Faking the provider would leave no order left to
 * get wrong, and the three cases about stale responses would all pass against
 * a provider that had no race in it because it had no logic in it.
 *
 * THIS SUITE NEVER MOUNTS THE WORLD, and that is what keeps the G6 incident
 * away from it. The protected routes below render a one-line `<main>`, not
 * `pages/Home`. `pages/Home` answers a failed load by replacing everything
 * with the dev fixture, so a suite that mocked `lib/api` and then mounted it
 * would be asserting against invented rows. Guarding a placeholder is the
 * honest subject here: whether the door opens, not what is behind it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequireAuth } from "../src/components/RequireAuth";
import {
  ApiError,
  deleteAccount,
  fetchCurrentViewer,
  login,
  updateAuthPreferences,
  updateAuthProfile,
} from "../src/lib/api";
import type { ApiViewer } from "../src/lib/api";
import {
  AuthProvider,
  useAuth,
  type AuthContextValue,
} from "../src/lib/auth-context";
import LoginPage, { SignupForm } from "../src/pages/Login";

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

const STORAGE_KEY = "waka.auth.viewer";

/**
 * The two halves of "who is this session", built together so a test never
 * accidentally asserts against an account carrying a profile's fields.
 */
function viewer(input: {
  id: string;
  email: string;
  name: string;
  preferredLocale?: "en-US";
  onboardingCompletedAt?: string | null;
  isAdmin?: boolean;
}): ApiViewer {
  return {
    account: {
      id: `account-${input.id}`,
      email: input.email,
      onboardingCompletedAt:
        input.onboardingCompletedAt === undefined
          ? "2026-01-01T00:00:00.000Z"
          : input.onboardingCompletedAt,
      isAdmin: input.isAdmin === true,
    },
    profile: {
      id: `profile-${input.id}`,
      accountId: `account-${input.id}`,
      type: "human",
      name: input.name,
      avatarUrl: null,
      preferredLocale: input.preferredLocale ?? "en-US",
      publicHandle: null,
      publicProfileEnabled: false,
      publicTopOfMindEnabled: false,
    },
  };
}

const cachedViewer = viewer({
  id: "cached",
  email: "cached@example.com",
  name: "Cached User",
});

let mountedRoot: Root | null = null;
let mountedContainer: HTMLDivElement | null = null;
let storage: Record<string, string> = {};
let latestAuth: AuthContextValue | null = null;

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
  vi.mocked(login).mockReset();
  vi.mocked(updateAuthPreferences).mockReset();
  vi.mocked(updateAuthProfile).mockReset();
  vi.mocked(deleteAccount).mockReset();
  latestAuth = null;
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
  delete storage[STORAGE_KEY];
  vi.clearAllMocks();
});

async function flushReactWork(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

interface RenderAuthRoutesOptions {
  initialPath: string;
  loginElement?: JSX.Element;
}

function LoginActionProbe(): JSX.Element {
  latestAuth = useAuth();
  return createElement(
    "p",
    null,
    latestAuth.account ? `Signed in as ${latestAuth.account.email}` : "Sign in probe",
  );
}

async function renderAuthRoutes({
  initialPath,
  loginElement = createElement(LoginPage),
}: RenderAuthRoutesOptions): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  window.history.pushState({}, "", initialPath);
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
            createElement(Route, {
              path: "/login",
              element: loginElement,
            }),
            createElement(Route, {
              path: "/onboarding",
              element: createElement(
                RequireAuth,
                null,
                createElement("main", null, "ONBOARDING"),
              ),
            }),
            createElement(Route, {
              path: "/",
              element: createElement(
                RequireAuth,
                null,
                createElement("main", null, "PROTECTED HOME DATA"),
              ),
            }),
            createElement(Route, {
              path: "/admin",
              element: createElement(
                RequireAuth,
                { requireAdmin: true },
                createElement("main", null, "ADMIN DATA"),
              ),
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

describe("auth boundary", () => {
  it("keeps the login page reachable and visible for unauthenticated visitors", async () => {
    vi.mocked(fetchCurrentViewer).mockResolvedValue(null);

    const container = await renderAuthRoutes({ initialPath: "/login" });

    expect(container.textContent).toContain("Welcome");
    expect(container.textContent).toContain("Sign in to return to what you kept.");
    expect(container.querySelector("#login-tab-login")?.textContent).toBe("Sign in");
    expect(container.textContent).not.toContain("PROTECTED HOME DATA");
  });

  it("supports expected keyboard navigation for login and signup tabs", async () => {
    vi.mocked(fetchCurrentViewer).mockResolvedValue(null);

    const container = await renderAuthRoutes({ initialPath: "/login" });
    const loginTab = container.querySelector<HTMLButtonElement>("#login-tab-login");
    const signupTab = container.querySelector<HTMLButtonElement>("#login-tab-signup");

    expect(container.querySelector("#login-tabpanel")?.getAttribute("aria-labelledby")).toBe("login-tab-login");
    expect(loginTab?.getAttribute("aria-selected")).toBe("true");
    expect(loginTab?.tabIndex).toBe(0);
    expect(signupTab?.tabIndex).toBe(-1);

    await act(async () => {
      loginTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    await flushReactWork();

    expect(container.querySelector("#login-tabpanel")?.getAttribute("aria-labelledby")).toBe("login-tab-signup");
    expect(container.querySelector<HTMLButtonElement>("#login-tab-signup")?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector<HTMLButtonElement>("#login-tab-signup")?.tabIndex).toBe(0);
    expect(document.activeElement).toBe(container.querySelector("#login-tab-signup"));
    expect(container.textContent).toContain("Create account");

    await act(async () => {
      signupTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    });
    await flushReactWork();

    expect(container.querySelector("#login-tabpanel")?.getAttribute("aria-labelledby")).toBe("login-tab-login");
    expect(container.querySelector<HTMLButtonElement>("#login-tab-login")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(container.querySelector("#login-tab-login"));

    await act(async () => {
      loginTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    });
    await flushReactWork();

    expect(container.querySelector("#login-tabpanel")?.getAttribute("aria-labelledby")).toBe("login-tab-signup");
    expect(container.querySelector<HTMLButtonElement>("#login-tab-signup")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(container.querySelector("#login-tab-signup"));

    await act(async () => {
      signupTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    await flushReactWork();

    expect(container.querySelector("#login-tabpanel")?.getAttribute("aria-labelledby")).toBe("login-tab-login");
    expect(container.querySelector<HTMLButtonElement>("#login-tab-login")?.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(container.querySelector("#login-tab-login"));
  });

  it("offers the language choice at the door — English and Korean", async () => {
    // The pre-submit selector is BACK (founder, 2026-08-31, reversing
    // 2026-08-22): the choice drives what language the memory itself is
    // written in, so it belongs before the first keep.
    vi.mocked(fetchCurrentViewer).mockResolvedValue(null);

    const container = await renderAuthRoutes({ initialPath: "/login" });
    const signupTab = container.querySelector<HTMLButtonElement>("#login-tab-signup");

    await act(async () => {
      signupTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushReactWork();

    expect(container.textContent).toContain("Begin your archive.");
    expect(container.textContent).toContain("Continue with Google");
    const selector = container.querySelector<HTMLSelectElement>(
      'select[name="preferredLocale"]',
    );
    expect(selector).not.toBeNull();
    expect(Array.from(selector!.options).map((o) => o.value)).toEqual(["en-US", "ko-KR"]);
    expect(selector!.value).toBe("en-US");
    expect(container.textContent).toContain("한국어");
  });

  it("renders the standalone SignupForm with the language field", async () => {
    vi.mocked(fetchCurrentViewer).mockResolvedValue(null);

    const container = await renderAuthRoutes({
      initialPath: "/login",
      loginElement: createElement(SignupForm),
    });

    expect(container.querySelector('select[name="preferredLocale"]')).not.toBeNull();
    expect(container.textContent).toContain("Create account");
  });

  it("clears the cache and routes home visitors to login when /auth/me returns nobody", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedViewer));
    vi.mocked(fetchCurrentViewer).mockResolvedValue(null);

    const container = await renderAuthRoutes({ initialPath: "/" });

    expect(container.textContent).toContain("Sign in to return to what you kept.");
    expect(container.textContent).not.toContain("PROTECTED HOME DATA");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not treat a cached viewer as authenticated when initial /auth/me fails", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedViewer));
    vi.mocked(fetchCurrentViewer).mockRejectedValue(new Error("server unavailable"));

    const container = await renderAuthRoutes({ initialPath: "/" });

    expect(container.textContent).toContain("Sign in to return to what you kept.");
    expect(container.textContent).not.toContain("PROTECTED HOME DATA");
    expect(window.localStorage.getItem(STORAGE_KEY), "a thrown error is not 'unreachable': the hint is cleared").toBeNull();
  });

  /* Only "we never got an answer" (status 0) keeps the stored hint; a 5xx is
     an answer that proves nothing about the session, and clears it. */
  it.each([[0, false], [503, true]] as const)("on a startup /auth/me failure with status %i, clears the stored hint: %s", async (status, cleared) => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedViewer));
    vi.mocked(fetchCurrentViewer).mockRejectedValue(new ApiError({ status, message: "failed" }));
    const container = await renderAuthRoutes({ initialPath: "/" });
    expect(container.textContent).not.toContain("PROTECTED HOME DATA");
    expect(window.localStorage.getItem(STORAGE_KEY) === null).toBe(cleared);
  });

  it.each(["refresh", "profile", "preferences"])("does not restore a signed-out account from an older %s response", async (operation) => {
    vi.mocked(fetchCurrentViewer).mockResolvedValue(cachedViewer);
    await renderAuthRoutes({ initialPath: "/login", loginElement: createElement(LoginActionProbe) });
    let settle: (value: ApiViewer) => void = () => undefined;
    const response = new Promise<ApiViewer>((resolve) => { settle = resolve; });
    vi.mocked(fetchCurrentViewer).mockReturnValue(response);
    vi.mocked(updateAuthProfile).mockReturnValue(response);
    vi.mocked(updateAuthPreferences).mockReturnValue(response);
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = operation === "refresh" ? latestAuth!.refresh()
        : operation === "profile" ? latestAuth!.updateProfile({ name: "New name" })
        : latestAuth!.updatePreferredLocale("en-US");
    });
    await act(async () => latestAuth!.logout());
    await act(async () => { settle(cachedViewer); await pending; });
    expect(latestAuth!.account).toBeNull();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not let a stale initial /auth/me response clear a newer login", async () => {
    let resolveInitialMe: (viewer: null) => void = () => undefined;
    vi.mocked(fetchCurrentViewer).mockReturnValue(
      new Promise((resolve) => {
        resolveInitialMe = resolve;
      }),
    );
    vi.mocked(login).mockResolvedValue({
      token: "test-token",
      ...viewer({ id: "fresh", email: "fresh@example.com", name: "Fresh User" }),
    });

    const container = await renderAuthRoutes({
      initialPath: "/login",
      loginElement: createElement(LoginActionProbe),
    });
    if (!latestAuth) throw new Error("LoginActionProbe did not capture auth context");
    await act(async () => {
      await latestAuth.login({ email: "fresh@example.com", password: "password123" });
    });
    expect(login).toHaveBeenCalledOnce();
    await flushReactWork();
    await flushReactWork();
    expect(container.textContent).toContain("Signed in as fresh@example.com");

    await act(async () => {
      resolveInitialMe(null);
    });
    await flushReactWork();

    expect(container.textContent).toContain("Signed in as fresh@example.com");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      account: { email: "fresh@example.com" },
      profile: { name: "Fresh User" },
    });
  });

  it("routes authenticated users with incomplete onboarding to onboarding", async () => {
    vi.mocked(fetchCurrentViewer).mockResolvedValue(
      viewer({
        id: "fresh",
        email: "fresh@example.com",
        name: "",
        onboardingCompletedAt: null,
      }),
    );

    const container = await renderAuthRoutes({ initialPath: "/" });

    expect(container.textContent).toContain("ONBOARDING");
    expect(container.textContent).not.toContain("PROTECTED HOME DATA");
  });

  it("redirects authenticated non-admin users away from admin routes", async () => {
    vi.mocked(fetchCurrentViewer).mockResolvedValue(
      viewer({ id: "fresh", email: "fresh@example.com", name: "Fresh User" }),
    );

    const container = await renderAuthRoutes({ initialPath: "/admin" });

    expect(container.textContent).toContain("PROTECTED HOME DATA");
    expect(container.textContent).not.toContain("ADMIN DATA");
  });

  it("allows authenticated admin users through admin routes", async () => {
    vi.mocked(fetchCurrentViewer).mockResolvedValue(
      viewer({
        id: "admin",
        email: "admin@example.com",
        name: "Admin User",
        isAdmin: true,
      }),
    );

    const container = await renderAuthRoutes({ initialPath: "/admin" });

    expect(container.textContent).toContain("ADMIN DATA");
  });

  it("persists locale preference updates through auth state and localStorage", async () => {
    vi.mocked(fetchCurrentViewer).mockResolvedValue(
      viewer({ id: "fresh", email: "fresh@example.com", name: "Fresh User" }),
    );
    vi.mocked(updateAuthPreferences).mockResolvedValue(
      viewer({
        id: "fresh",
        email: "fresh@example.com",
        name: "Fresh User",
        preferredLocale: "en-US",
      }),
    );

    await renderAuthRoutes({
      initialPath: "/login",
      loginElement: createElement(LoginActionProbe),
    });
    if (!latestAuth) throw new Error("LoginActionProbe did not capture auth context");
    await act(async () => {
      await latestAuth.updatePreferredLocale("en-US");
    });

    expect(updateAuthPreferences).toHaveBeenCalledWith({ preferredLocale: "en-US" });
    expect(latestAuth.profile?.preferredLocale).toBe("en-US");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      profile: { preferredLocale: "en-US" },
    });
  });
});
