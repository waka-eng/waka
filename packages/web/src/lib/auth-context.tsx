/**
 * Auth context + provider.
 *
 * Single source of truth for "who is the current user?" inside the React
 * tree. Wraps the app at the router root so any page (Login, Home, future
 * settings, ...) can call `useAuth()` instead of duplicating fetch logic.
 *
 * Storage strategy
 * ----------------
 * The httpOnly `waka_session` cookie set by the API is the SECURITY source
 * of truth — JS cannot read it, and only the server can validate it. We
 * mirror a small slice of the user object (id / email / name) into
 * `localStorage` only as a reload hint. On mount we always re-validate with
 * the server via `GET /auth/me`; if the server cannot confirm a session, the
 * cached user is dropped and the route guard sends the visitor to /login.
 *
 * The cache is therefore an *optimistic hint*, never a credential. Anything
 * that requires authority (loading inspirations, calling write endpoints)
 * still depends on the cookie reaching the API.
 *
 * Hooks
 * -----
 *   - `useAuth()`     → full context (user, loading, login, signup, logout, refresh)
 *   - `useCurrentUser()` → just the user (or null) — convenience for read-only callers
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
  fetchCurrentUser,
  login as apiLogin,
  logout as apiLogout,
  signup as apiSignup,
  updateAuthPreferences,
} from "./api";
import type { ApiUser, LoginRequest, SignupRequest } from "./api";
import { normalizeSupportedLocale } from "./locales";
import type { SupportedLocale } from "./locales";

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

/**
 * Namespaced localStorage key. The `waka.` prefix prevents collisions with
 * any other app sharing the same origin (matters for `sst dev` where the
 * Vite server hosts more than just this React tree).
 */
const STORAGE_KEY = "waka.auth.user";

/**
 * Read the cached user from localStorage, defensively. Anything malformed
 * (manual edit, corrupted profile) is treated as "no cache" rather than
 * thrown — the worst case is one extra `/auth/me` round-trip on next load.
 */
function readCachedUser(): ApiUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ApiUser> | null;
    if (
      parsed &&
      typeof parsed.id === "string" &&
      typeof parsed.email === "string" &&
      typeof parsed.name === "string"
    ) {
      return {
        id: parsed.id,
        email: parsed.email,
        name: parsed.name,
        preferredLocale: normalizeSupportedLocale(parsed.preferredLocale),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Persist (or clear) the cached user. Failures here are non-fatal — Safari
 * private mode and quota-exceeded conditions both throw, and neither should
 * be allowed to block the user from logging in.
 */
function writeCachedUser(user: ApiUser | null): void {
  if (typeof window === "undefined") return;
  try {
    if (user) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
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

export interface AuthContextValue {
  /** Currently authenticated user, or null when anonymous. */
  user: ApiUser | null;
  /**
   * True while the initial `/auth/me` round-trip is in flight. Pages should
   * render a neutral loading state (not the login screen) during this window
   * so a logged-in user does not see a /login flash on reload.
   */
  isLoading: boolean;
  /** Convenience boolean — equivalent to `user !== null`. */
  isAuthenticated: boolean;
  /**
   * Authenticate an existing account. Throws `ApiError` on failure so the
   * caller (typically a form) can render server-side validation messages.
   */
  login: (input: LoginRequest) => Promise<ApiUser>;
  /**
   * Create a new account. Same error contract as `login`.
   */
  signup: (input: SignupRequest) => Promise<ApiUser>;
  /**
   * Clear the session both server-side (POST /auth/logout) and locally.
   * Never throws — logging out has to be a guaranteed-success operation
   * from the user's perspective.
   */
  logout: () => Promise<void>;
  /**
   * Force a re-fetch of the current user from the server. Useful after
   * profile mutations elsewhere in the app (e.g. updating display name).
   */
  refresh: () => Promise<ApiUser | null>;
  /** Persist and apply the account language used by UI and AI-generated copy. */
  updatePreferredLocale: (preferredLocale: SupportedLocale) => Promise<ApiUser>;
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
 *   1. Hydrate `user` synchronously from localStorage as a short-lived hint
 *      while `/auth/me` is pending. Protected routes must still wait for
 *      `isLoading` to clear before rendering authenticated data.
 *   2. Kick off `GET /auth/me` to confirm with the server. If the cookie is
 *      missing, expired, or cannot be validated, the cached user is cleared.
 *   3. While that round-trip is pending, `isLoading` is true so route
 *      guards can show a spinner instead of redirecting prematurely.
 */
export function AuthProvider({ children }: AuthProviderProps): JSX.Element {
  const [user, setUser] = useState<ApiUser | null>(() => readCachedUser());
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
   * cache in lock-step. Every code path that mutates `user` must go through
   * this so the two never drift.
   */
  const applyUser = useCallback(
    (next: ApiUser | null, options?: { countAsAuthMutation?: boolean }): void => {
      if (options?.countAsAuthMutation !== false) {
        authMutationRef.current += 1;
      }
      setUser(next);
      writeCachedUser(next);
    },
    [],
  );

  // Initial hydration: confirm the cached user against the server.
  useEffect(() => {
    let cancelled = false;
    const initialAuthMutation = authMutationRef.current;
    (async () => {
      try {
        const fresh = await fetchCurrentUser();
        if (cancelled || !aliveRef.current) return;
        if (authMutationRef.current === initialAuthMutation) {
          applyUser(fresh, { countAsAuthMutation: false });
        }
      } catch {
        // The cached user is only an optimistic display hint, not proof of an
        // authenticated session. If the initial server validation fails
        // before we have a fresh `/auth/me` user, drop the hint rather than
        // letting RequireAuth render protected routes from stale localStorage.
        if (cancelled || !aliveRef.current) return;
        if (authMutationRef.current === initialAuthMutation) {
          applyUser(null, { countAsAuthMutation: false });
        }
      } finally {
        if (!cancelled && aliveRef.current) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyUser]);

  const login = useCallback(
    async (input: LoginRequest): Promise<ApiUser> => {
      const { user: u } = await apiLogin(input);
      applyUser(u);
      return u;
    },
    [applyUser],
  );

  const signup = useCallback(
    async (input: SignupRequest): Promise<ApiUser> => {
      const { user: u } = await apiSignup(input);
      applyUser(u);
      return u;
    },
    [applyUser],
  );

  const logout = useCallback(async (): Promise<void> => {
    // Wipe local state FIRST so the UI updates immediately even if the
    // network call hangs. The server-side cookie clear is a best-effort
    // follow-up; `apiLogout()` swallows network errors by design.
    applyUser(null);
    await apiLogout();
  }, [applyUser]);

  const refresh = useCallback(async (): Promise<ApiUser | null> => {
    const fresh = await fetchCurrentUser();
    applyUser(fresh);
    return fresh;
  }, [applyUser]);

  const updatePreferredLocale = useCallback(
    async (preferredLocale: SupportedLocale): Promise<ApiUser> => {
      const { user: updated } = await updateAuthPreferences({ preferredLocale });
      applyUser(updated);
      return updated;
    },
    [applyUser],
  );

  /**
   * Memoised so consumers using `useAuth()` only re-render when something
   * meaningful actually changes, not on every parent re-render.
   */
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isLoading,
      isAuthenticated: user !== null,
      login,
      signup,
      logout,
      refresh,
      updatePreferredLocale,
    }),
    [user, isLoading, login, signup, logout, refresh, updatePreferredLocale],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Primary auth hook. Throws if the caller is rendered outside an
 * `<AuthProvider>` — that's a programmer bug, not a runtime condition, so a
 * loud error beats a silent `null` that crashes deeper in the tree.
 */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}

export function useAuth(): AuthContextValue {
  const ctx = useOptionalAuth();
  if (!ctx) {
    throw new Error(
      "useAuth() called outside <AuthProvider>. Wrap your router in <AuthProvider>.",
    );
  }
  return ctx;
}

/** Convenience selector — just the user object. */
export function useCurrentUser(): ApiUser | null {
  return useAuth().user;
}

/** Convenience selector — just the boolean. */
export function useIsAuthenticated(): boolean {
  return useAuth().isAuthenticated;
}
