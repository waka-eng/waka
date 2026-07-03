// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RequireAuth } from "../src/components/RequireAuth";
import { deleteAccount, fetchCurrentUser, login, updateAuthPreferences, updateAuthProfile } from "../src/lib/api";
import {
  AuthProvider,
  useAuth,
  type AuthContextValue,
} from "../src/lib/auth-context";
import LoginPage from "../src/pages/Login";

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    fetchCurrentUser: vi.fn(async () => null),
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

const STORAGE_KEY = "waka.auth.user";
const cachedUser = {
  id: "cached-user",
  email: "cached@example.com",
  name: "Cached User",
  preferredLocale: "en-US" as const,
  onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
  isAdmin: false,
};

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
  vi.mocked(fetchCurrentUser).mockReset();
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
    latestAuth.user ? `Signed in as ${latestAuth.user.email}` : "Sign in probe",
  );
}

async function renderAuthRoutes({
  initialPath,
  loginElement = createElement(LoginPage),
}: RenderAuthRoutesOptions): Promise<HTMLDivElement> {
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
    vi.mocked(fetchCurrentUser).mockResolvedValue(null);

    const container = await renderAuthRoutes({ initialPath: "/login" });

    expect(container.textContent).toContain("Welcome");
    expect(container.textContent).toContain("Sign in to return to your inspirations.");
    expect(container.querySelector("#login-tab-login")?.textContent).toBe("Sign in");
    expect(container.textContent).not.toContain("PROTECTED HOME DATA");
  });

  it("supports expected keyboard navigation for login and signup tabs", async () => {
    vi.mocked(fetchCurrentUser).mockResolvedValue(null);

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

  it("clears a cached user and routes home visitors to login when /auth/me returns no user", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedUser));
    vi.mocked(fetchCurrentUser).mockResolvedValue(null);

    const container = await renderAuthRoutes({ initialPath: "/" });

    expect(container.textContent).toContain("Sign in to return to your inspirations.");
    expect(container.textContent).not.toContain("PROTECTED HOME DATA");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not treat a cached user as authenticated when initial /auth/me fails", async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cachedUser));
    vi.mocked(fetchCurrentUser).mockRejectedValue(new Error("server unavailable"));

    const container = await renderAuthRoutes({ initialPath: "/" });

    expect(container.textContent).toContain("Sign in to return to your inspirations.");
    expect(container.textContent).not.toContain("PROTECTED HOME DATA");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not let a stale initial /auth/me response clear a newer login", async () => {
    let resolveInitialMe: (user: null) => void = () => undefined;
    vi.mocked(fetchCurrentUser).mockReturnValue(
      new Promise((resolve) => {
        resolveInitialMe = resolve;
      }),
    );
    vi.mocked(login).mockResolvedValue({
      token: "test-token",
      user: {
        id: "fresh-user",
        email: "fresh@example.com",
        name: "Fresh User",
        preferredLocale: "en-US",
        onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
        isAdmin: false,
      },
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
      id: "fresh-user",
      email: "fresh@example.com",
    });
  });

  it("routes authenticated users with incomplete onboarding to onboarding", async () => {
    vi.mocked(fetchCurrentUser).mockResolvedValue({
      id: "fresh-user",
      email: "fresh@example.com",
      name: "",
      preferredLocale: "ko-KR",
      onboardingCompletedAt: null,
      isAdmin: false,
    });

    const container = await renderAuthRoutes({ initialPath: "/" });

    expect(container.textContent).toContain("ONBOARDING");
    expect(container.textContent).not.toContain("PROTECTED HOME DATA");
  });

  it("redirects authenticated non-admin users away from admin routes", async () => {
    vi.mocked(fetchCurrentUser).mockResolvedValue({
      id: "fresh-user",
      email: "fresh@example.com",
      name: "Fresh User",
      preferredLocale: "en-US",
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
      isAdmin: false,
    });

    const container = await renderAuthRoutes({ initialPath: "/admin" });

    expect(container.textContent).toContain("PROTECTED HOME DATA");
    expect(container.textContent).not.toContain("ADMIN DATA");
  });

  it("allows authenticated admin users through admin routes", async () => {
    vi.mocked(fetchCurrentUser).mockResolvedValue({
      id: "admin-user",
      email: "admin@example.com",
      name: "Admin User",
      preferredLocale: "en-US",
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
      isAdmin: true,
    });

    const container = await renderAuthRoutes({ initialPath: "/admin" });

    expect(container.textContent).toContain("ADMIN DATA");
  });

  it("persists locale preference updates through auth state and localStorage", async () => {
    vi.mocked(fetchCurrentUser).mockResolvedValue({
      id: "fresh-user",
      email: "fresh@example.com",
      name: "Fresh User",
      preferredLocale: "en-US",
      onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
      isAdmin: false,
    });
    vi.mocked(updateAuthPreferences).mockResolvedValue({
      user: {
        id: "fresh-user",
        email: "fresh@example.com",
        name: "Fresh User",
        preferredLocale: "ko-KR",
        onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
        isAdmin: false,
      },
    });

    await renderAuthRoutes({
      initialPath: "/login",
      loginElement: createElement(LoginActionProbe),
    });
    if (!latestAuth) throw new Error("LoginActionProbe did not capture auth context");
    await act(async () => {
      await latestAuth.updatePreferredLocale("ko-KR");
    });

    expect(updateAuthPreferences).toHaveBeenCalledWith({ preferredLocale: "ko-KR" });
    expect(latestAuth.user?.preferredLocale).toBe("ko-KR");
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toMatchObject({
      preferredLocale: "ko-KR",
    });
  });
});
