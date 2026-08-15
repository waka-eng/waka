/**
 * Auth context + provider.
 *
 * Single source of truth for "who is this session?" inside the React tree.
 * Wraps the app at the router root so any page (Login, Surface, Profile, ...)
 * can call `useAuth()` instead of duplicating fetch logic.
 *
 * The answer has two halves and they are kept apart on purpose: the
 * **account** is the login (email, admin, whether onboarding is done), and the
 * **profile** is the memory this session acts as (name, avatar, language,
 * public handle). One account owns several profiles, so a display name is a
 * property of the profile and never of the account.
 *
 * Storage strategy
 * ----------------
 * The httpOnly `waka_session` cookie set by the API is the SECURITY source
 * of truth — JS cannot read it, and only the server can validate it. We
 * mirror the viewer into `localStorage` only as a reload hint. On mount we
 * always re-validate with the server via `GET /auth/me`; if the server cannot
 * confirm a session, the cached viewer is dropped and the route guard sends
 * the visitor to /login.
 *
 * The cache is therefore an *optimistic hint*, never a credential. Anything
 * that requires authority (loading captures, calling write endpoints) still
 * depends on the cookie reaching the API.
 *
 * Hooks
 * -----
 *   - `useAuth()`        → full context (viewer, loading, login, signup, ...)
 *   - `useCurrentProfile()` → just the acting profile (or null)
 *   - `useIsAuthenticated()` → boolean — convenience for route guards
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import {
  fetchCurrentViewer,
  login as apiLogin,
  deleteAccount as apiDeleteAccount,
  logout as apiLogout,
  signup as apiSignup,
  updateAuthPreferences,
  updateAuthProfile,
} from "./api";
import type {
  ApiAccount,
  ApiProfile,
  ApiViewer,
  LoginRequest,
  SignupRequest,
} from "./api";
import { normalizeSupportedLocale, writeStoredLocale } from "./locales";
import type { SupportedLocale } from "./locales";

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Namespaced localStorage key. The `waka.` prefix prevents collisions with
 * any other app sharing the same origin (matters for `sst dev` where the
 * Vite server hosts more than just this React tree).
 */
const STORAGE_KEY = "waka.auth.viewer";

/**
 * Read the cached viewer from localStorage, defensively. Anything malformed
 * (manual edit, corrupted profile) is treated as "no cache" rather than
 * thrown — the worst case is one extra `/auth/me` round-trip on next load.
 */
function readCachedViewer(): ApiViewer | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ApiViewer> | null;
    const account = parsed?.account;
    const profile = parsed?.profile;
    if (
      !account ||
      !profile ||
      typeof account.id !== "string" ||
      typeof account.email !== "string" ||
      typeof profile.id !== "string" ||
      typeof profile.name !== "string"
    ) {
      return null;
    }
    return {
      account: {
        id: account.id,
        email: account.email,
        onboardingCompletedAt:
          typeof account.onboardingCompletedAt === "string"
            ? account.onboardingCompletedAt
            : null,
        isAdmin: account.isAdmin === true,
      },
      profile: {
        id: profile.id,
        accountId: account.id,
        type: profile.type === "agent" ? "agent" : "human",
        name: profile.name,
        avatarUrl: typeof profile.avatarUrl === "string" ? profile.avatarUrl : null,
        preferredLocale: normalizeSupportedLocale(profile.preferredLocale),
        publicHandle:
          typeof profile.publicHandle === "string" ? profile.publicHandle : null,
        publicProfileEnabled: profile.publicProfileEnabled === true,
        publicTopOfMindEnabled: profile.publicTopOfMindEnabled === true,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Persist (or clear) the cached viewer. Failures here are non-fatal — Safari
 * private mode and quota-exceeded conditions both throw, and neither should
 * be allowed to block the person from logging in.
 */
function writeCachedViewer(viewer: ApiViewer | null): void {
  if (typeof window === "undefined") return;
  try {
    if (viewer) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(viewer));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore — cache is best-effort
  }
}

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

export interface UpdateProfileInput {
  name: string;
  preferredLocale: SupportedLocale;
  completeOnboarding?: boolean;
  publicHandle?: string | null;
  publicProfileEnabled?: boolean;
  publicTopOfMindEnabled?: boolean;
}

export interface AuthContextValue {
  /** The signed-in account, or null when anonymous. */
  account: ApiAccount | null;
  /** The profile this session acts as, or null when anonymous. */
  profile: ApiProfile | null;
  /**
   * True while the initial `/auth/me` round-trip is in flight. Pages should
   * render a neutral loading state (not the login screen) during this window
   * so a signed-in person does not see a /login flash on reload.
   */
  isLoading: boolean;
  /** Convenience boolean — equivalent to `account !== null`. */
  isAuthenticated: boolean;
  /**
   * Authenticate an existing account. Throws `ApiError` on failure so the
   * caller (typically a form) can render server-side validation messages.
   */
  login: (input: LoginRequest) => Promise<ApiViewer>;
  /**
   * Create a new account. Same error contract as `login`.
   */
  signup: (input: SignupRequest) => Promise<ApiViewer>;
  /**
   * Clear the session both server-side (POST /auth/logout) and locally.
   * Never throws — logging out has to be a guaranteed-success operation
   * from the person's perspective.
   */
  logout: () => Promise<void>;
  /**
   * Force a re-fetch from the server. Useful after mutations elsewhere in the
   * app (e.g. updating the display name).
   */
  refresh: () => Promise<ApiViewer | null>;
  /** Persist and apply the language used by the UI and by generated copy. */
  updatePreferredLocale: (preferredLocale: SupportedLocale) => Promise<ApiViewer>;
  updateProfile: (input: UpdateProfileInput) => Promise<ApiViewer>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface AuthProviderProps {
  children: ReactNode;
}

/**
 * Mounts auth state for the React subtree. Should wrap the router so every
 * route — public or private — can read `useAuth()` without prop-drilling.
 *
 * Mount sequence:
 *   1. Hydrate synchronously from localStorage as a short-lived hint while
 *      `/auth/me` is pending. Protected routes must still wait for
 *      `isLoading` to clear before rendering authenticated data.
 *   2. Kick off `GET /auth/me` to confirm with the server. If the cookie is
 *      missing, expired, or cannot be validated, the cache is cleared.
 *   3. While that round-trip is pending, `isLoading` is true so route
 *      guards can show a spinner instead of redirecting prematurely.
 */
export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const [viewer, setViewer] = useState<ApiViewer | null>(() => readCachedViewer());
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /**
   * Tracks whether the component is still mounted so async callbacks don't
   * call setState on an unmounted tree (StrictMode double-invoke + fast
   * navigation make this a real, not theoretical, hazard).
   */
  const aliveRef = useRef<boolean>(true);
  const authMutationRef = useRef<number>(0);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  /**
   * Centralised setter that keeps in-memory state and the localStorage
   * cache in lock-step. Every code path that mutates the viewer must go
   * through this so the two never drift.
   */
  const applyViewer = useCallback(
    (next: ApiViewer | null, options?: { countAsAuthMutation?: boolean }): void => {
      if (options?.countAsAuthMutation !== false) {
        authMutationRef.current += 1;
      }
      setViewer(next);
      writeCachedViewer(next);
      if (next) {
        writeStoredLocale(normalizeSupportedLocale(next.profile.preferredLocale));
      }
    },
    [],
  );

  // Initial hydration: confirm the cached viewer against the server.
  useEffect(() => {
    let cancelled = false;
    const initialAuthMutation = authMutationRef.current;
    (async () => {
      try {
        const fresh = await fetchCurrentViewer();
        if (cancelled || !aliveRef.current) return;
        if (authMutationRef.current === initialAuthMutation) {
          applyViewer(fresh, { countAsAuthMutation: false });
        }
      } catch {
        // The cache is only an optimistic display hint, not proof of an
        // authenticated session. If the initial server validation fails
        // before we have a fresh `/auth/me`, drop the hint rather than
        // letting RequireAuth render protected routes from stale localStorage.
        if (cancelled || !aliveRef.current) return;
        if (authMutationRef.current === initialAuthMutation) {
          applyViewer(null, { countAsAuthMutation: false });
        }
      } finally {
        if (!cancelled && aliveRef.current) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyViewer]);

  const login = useCallback(
    async (input: LoginRequest): Promise<ApiViewer> => {
      const { account, profile } = await apiLogin(input);
      const next: ApiViewer = { account, profile };
      applyViewer(next);
      return next;
    },
    [applyViewer],
  );

  const signup = useCallback(
    async (input: SignupRequest): Promise<ApiViewer> => {
      const { account, profile } = await apiSignup(input);
      const next: ApiViewer = { account, profile };
      applyViewer(next);
      return next;
    },
    [applyViewer],
  );

  const logout = useCallback(async (): Promise<void> => {
    // Wipe local state FIRST so the UI updates immediately even if the
    // network call hangs. The server-side cookie clear is a best-effort
    // follow-up; `apiLogout()` swallows network errors by design.
    applyViewer(null);
    await apiLogout();
  }, [applyViewer]);

  const refresh = useCallback(async (): Promise<ApiViewer | null> => {
    const fresh = await fetchCurrentViewer();
    applyViewer(fresh);
    return fresh;
  }, [applyViewer]);

  const updatePreferredLocale = useCallback(
    async (preferredLocale: SupportedLocale): Promise<ApiViewer> => {
      const updated = await updateAuthPreferences({ preferredLocale });
      applyViewer(updated);
      return updated;
    },
    [applyViewer],
  );

  const updateProfile = useCallback(
    async (input: UpdateProfileInput): Promise<ApiViewer> => {
      const updated = await updateAuthProfile(input);
      applyViewer(updated);
      return updated;
    },
    [applyViewer],
  );

  const deleteAccount = useCallback(async (): Promise<void> => {
    await apiDeleteAccount();
    applyViewer(null);
  }, [applyViewer]);

  /**
   * Memoised so consumers using `useAuth()` only re-render when something
   * meaningful actually changes, not on every parent re-render.
   */
  const value = useMemo<AuthContextValue>(
    () => ({
      account: viewer?.account ?? null,
      profile: viewer?.profile ?? null,
      isLoading,
      isAuthenticated: viewer !== null,
      login,
      signup,
      logout,
      refresh,
      updatePreferredLocale,
      updateProfile,
      deleteAccount,
    }),
    [
      viewer,
      isLoading,
      login,
      signup,
      logout,
      refresh,
      updatePreferredLocale,
      updateProfile,
      deleteAccount,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Auth for callers that may legitimately render outside a provider — the
 * public profile page is reachable signed out and only wants to know whether
 * there is somewhere to send the visitor.
 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

/**
 * Primary auth hook. Throws if the caller is rendered outside an
 * `<AuthProvider>` — that's a programmer bug, not a runtime condition, so a
 * loud error beats a silent `null` that crashes deeper in the tree.
 */
export function useAuth(): AuthContextValue {
  const ctx = useOptionalAuth();
  if (!ctx) {
    throw new Error(
      "useAuth() called outside <AuthProvider>. Wrap your router in <AuthProvider>.",
    );
  }
  return ctx;
}

/** Convenience selector — just the acting profile. */
export function useCurrentProfile(): ApiProfile | null {
  return useAuth().profile;
}

/** Convenience selector — just the boolean. */
export function useIsAuthenticated(): boolean {
  return useAuth().isAuthenticated;
}
