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
import {clearUnsentDrafts} from './draft-eviction';
import {setInspirationSnapshotOwner} from './inspiration-snapshots';
import type { ReactNode } from "react";

import {
  ApiError,
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
import { isMobileBuild } from './platform';
import { SESSION_EXPIRED_EVENT, webSessionChanged } from './api/transport';

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
  if (isMobileBuild) return null;
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
    if (viewer && !isMobileBuild) {
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
  /**
   * WE COULD NOT ASK, WHICH IS NOT THE SAME AS "NOT SIGNED IN".
   *
   * Hydration drops the cached viewer whenever `/auth/me` fails, and that is
   * right and stays right: a cache is a display hint, never proof of a
   * session, and rendering protected routes off stale localStorage is the one
   * mistake this must never make. `isAuthenticated` is unchanged by this flag
   * and `RequireAuth` still sends the visitor to the door.
   *
   * What was wrong is what the door then SAID. Measured 2026-08-26: kill every
   * `/api/` request and reload, and a person with a perfectly valid session is
   * shown "Welcome back. Sign in to return to what you kept." Restore the
   * network, reload, and they are straight back in — nothing was ever wrong
   * with their account. The product asserted a fact about their session that
   * it had no way of knowing, in the one situation where a person is already
   * inclined to fear the worst.
   *
   * So: access control reads `isAuthenticated`; the door reads this to choose
   * its words. Never the other way round.
   */
  serverUnreachable: boolean;
  /**
   * Whether this browser held a signed-in hint when the server could not be
   * reached. Only then may a screen say "you're still signed in": for a
   * visitor with no hint that sentence is an invention.
   */
  unreachableWasSignedIn: boolean;
  /**
   * THE SESSION ENDED WHILE IN USE, AND WHERE THE PERSON WAS WHEN IT DID.
   *
   * Set when a request made with a session comes back 401 (see
   * `SESSION_EXPIRED_EVENT` in `lib/api/transport.ts`), never by the
   * initial `/auth/me` check — a visitor who arrives signed out did not lose
   * anything. The door reads it to say "you were signed out" rather than
   * greet a returning visitor, and to send them back to `from` once they are
   * in again. Unsent drafts are NOT cleared on this path: only `logout`
   * evicts them, because only `logout` is somebody choosing to leave.
   */
  sessionExpired: { from: string } | null;
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
   * Web clears locally even offline. Native secure-retirement failures are
   * reported rather than falsely claiming the saved credential was removed.
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
  /* Which identity requests are being sent under — see `webSessionChanged`
     in `lib/api/transport.ts`. Seeded from the cached hint so hydration that
     confirms the same person is not counted as a change. */
  const identityRef = useRef<string | null>(viewer ? `${viewer.account.id}:${viewer.profile.id}` : null);
  const applyViewer = useCallback(
    (next: ApiViewer | null, options?: { countAsAuthMutation?: boolean }): void => {
      if (options?.countAsAuthMutation !== false) {
        authMutationRef.current += 1;
      }
      const identity = next ? `${next.account.id}:${next.profile.id}` : null;
      if (identity !== identityRef.current) { identityRef.current = identity; webSessionChanged(); }
      setViewer(next);
      setInspirationSnapshotOwner(next?{accountId:next.account.id,profileId:next.profile.id}:null);
      writeCachedViewer(next);
      if (next) {
        writeStoredLocale(normalizeSupportedLocale(next.profile.preferredLocale));
      }
    },
    [],
  );

  /** See `AuthContextValue.serverUnreachable`. Says nothing about access. */
  const [serverUnreachable, setServerUnreachable] = useState(false);
  const [sessionExpired, setSessionExpired] = useState<{ from: string } | null>(null);
  const [unreachableWasSignedIn, setUnreachableWasSignedIn] = useState(false);
  const viewerRef = useRef(viewer);
  viewerRef.current = viewer;
  useEffect(() => {
    const expired = () => {
      /* ON THE WEB THE EVENT FIRES FOR ANY 401, so it only means something
         when there was a session to lose. Native fires it from the
         credential store itself, which already implies there was one. */
      if (!isMobileBuild && !viewerRef.current) return;
      const at = window.location;
      setSessionExpired({ from: `${at.pathname}${at.search}${at.hash}` });
      applyViewer(null); setServerUnreachable(false); setIsLoading(false);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, [applyViewer]);

  // Initial hydration: confirm the cached viewer against the server.
  useEffect(() => {
    let cancelled = false;
    const initialAuthMutation = authMutationRef.current;
    (async () => {
      try {
        const fresh = await fetchCurrentViewer();
        if (cancelled || !aliveRef.current) return;
        setServerUnreachable(false);
        if (authMutationRef.current === initialAuthMutation) {
          applyViewer(fresh, { countAsAuthMutation: false });
        }
      } catch (err) {
        /* A STATUS OF 0 IS THE CLIENT SAYING IT NEVER GOT AN ANSWER — see
           `http.ts`, where every helper rethrows a dead fetch as
           `ApiError { status: 0 }`. A 401 is an answer and means signed out; a
           0 means the question was never asked. Only the second sets this. */
        if (!cancelled && aliveRef.current) {
          /* AN UNKNOWN ERROR IS NOT EVIDENCE THE SERVER WAS UNREACHABLE.
             This defaulted to `true` for anything that was not an `ApiError`,
             which would have put "We couldn't reach the server" in front of a
             person whose network was fine and whose session was fine — a
             crash inside `applyViewer` reads the same from here. Claiming a
             cause on no evidence is the exact mistake this flag was added to
             stop; only a status of 0, which the client sets when it never got
             an answer, is evidence of it.

             Note a 401 never reaches this catch at all: `fetchCurrentViewer`
             RETURNS null for it rather than throwing, so signed-out is
             handled above and the door greets it normally. */
          setServerUnreachable(err instanceof ApiError && err.status === 0);
          setUnreachableWasSignedIn(identityRef.current !== null);
        }
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
      const startedAt = ++authMutationRef.current;
      const { account, profile } = await apiLogin(input);
      if (!aliveRef.current || startedAt !== authMutationRef.current) throw new ApiError({ status: 409, message: 'Sign-in changed. Please try again.' });
      /* THE SERVER ANSWERED, so whatever the door was told earlier is stale.
         Without this the flag survived the whole page session: a person who
         hit a dead network, signed in once it came back, then signed out
         again, met "We couldn't reach the server" on a door that had just
         worked twice. Cleared wherever a round trip actually resolves —
         `logout` is deliberately not one of those, because it wipes state
         first and swallows its own network errors by design. */
      setServerUnreachable(false);
      setSessionExpired(null);
      const next: ApiViewer = { account, profile };
      applyViewer(next);
      return next;
    },
    [applyViewer],
  );

  const signup = useCallback(
    async (input: SignupRequest): Promise<ApiViewer> => {
      const startedAt = ++authMutationRef.current;
      const { account, profile } = await apiSignup(input);
      if (!aliveRef.current || startedAt !== authMutationRef.current) throw new ApiError({ status: 409, message: 'Sign-in changed. Please try again.' });
      setServerUnreachable(false);
      setSessionExpired(null);
      const next: ApiViewer = { account, profile };
      applyViewer(next);
      return next;
    },
    [applyViewer],
  );

  /*
   * SIGNING OUT HAS TO TAKE THE UNSENT WORDS WITH IT.
   *
   * Draft text outlived logout in `localStorage`, so the next person at the
   * browser could read the save the previous one had not decided to keep and
   * the message they had not decided to send. `clearUnsentDrafts` is the
   * narrow version of that — see its header for what is deliberately left
   * behind, which is everything the returning owner is entitled to find.
   *
   * It hangs off `logout`, not off `applyViewer(null)`, and the difference
   * matters: hydration also clears the viewer when `/auth/me` cannot be
   * reached, and that is a person with a dead network and a valid session, not
   * a person leaving. Evicting there would delete a draft as a consequence of
   * bad wifi.
   *
   * The two platforms clear at different moments for the same reason they log
   * out differently. Web wipes local state first and treats the server round
   * trip as best-effort, so the drafts go with that wipe. Native reports a
   * failed secure retirement instead of claiming a logout that did not happen,
   * so it clears only once `apiLogout()` has resolved — a person still signed
   * in because the keychain write failed must not already have lost what they
   * were typing.
   *
   * IT IS AWAITED, because the save box also keeps photographs and voice
   * recordings in IndexedDB and emptying those is a transaction rather than a
   * synchronous write. `clearUnsentDrafts` does all of its `localStorage` work
   * before it returns a promise at all and bounds the asynchronous half with
   * its own deadline, so awaiting here can delay a logout but can never hold
   * one open — see that module's header for the reasoning on both halves.
   */
  const logout = useCallback(async (): Promise<void> => {
    const leaving = viewer
      ? { accountId: viewer.account.id, profileId: viewer.profile.id }
      : null;
    setSessionExpired(null);
    // Wipe local state FIRST so the UI updates immediately even if the
    // network call hangs. The server-side cookie clear is a best-effort
    // follow-up; `apiLogout()` swallows network errors by design.
    if (isMobileBuild) {
      // Native invalidation is emitted after durable retirement, before the
      // server round trip. A failed secure write must not claim successful logout.
      await apiLogout();
      await clearUnsentDrafts(leaving);
      return;
    }
    applyViewer(null);
    /* Started before the server round trip and awaited after it, so the
       asynchronous half of the eviction overlaps the request instead of
       delaying the cookie clear behind it. */
    const evicted = clearUnsentDrafts(leaving);
    await apiLogout();
    await evicted;
  }, [applyViewer, viewer]);

  /* ALSO THE "TRY AGAIN" BEHIND "WE CAN'T REACH WAKA". So a dead connection
     here re-raises `serverUnreachable` rather than leaving the flag at
     whatever the last answer said — the screen asking the question again
     has to be told when the answer is still no. */
  const refresh = useCallback(async (): Promise<ApiViewer | null> => {
    const startedAt = authMutationRef.current;
    let fresh: ApiViewer | null;
    try {
      fresh = await fetchCurrentViewer();
    } catch (err) {
      if (aliveRef.current && err instanceof ApiError && err.status === 0) setServerUnreachable(true);
      throw err;
    }
    if (!aliveRef.current || startedAt !== authMutationRef.current) return fresh;
    setServerUnreachable(false);
    if (fresh) setSessionExpired(null);
    applyViewer(fresh);
    return fresh;
  }, [applyViewer]);

  const updatePreferredLocale = useCallback(
    async (preferredLocale: SupportedLocale): Promise<ApiViewer> => {
      const startedAt = authMutationRef.current;
      const updated = await updateAuthPreferences({ preferredLocale });
      if (aliveRef.current && startedAt === authMutationRef.current) applyViewer(updated);
      return updated;
    },
    [applyViewer],
  );

  const updateProfile = useCallback(
    async (input: UpdateProfileInput): Promise<ApiViewer> => {
      const startedAt = authMutationRef.current;
      const updated = await updateAuthProfile(input);
      if (aliveRef.current && startedAt === authMutationRef.current) applyViewer(updated);
      return updated;
    },
    [applyViewer],
  );

  const deleteAccount = useCallback(async (): Promise<void> => {
    const startedAt = authMutationRef.current;
    await apiDeleteAccount();
    if (aliveRef.current && startedAt === authMutationRef.current) applyViewer(null);
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
      serverUnreachable,
      unreachableWasSignedIn,
      sessionExpired,
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
      serverUnreachable,
      unreachableWasSignedIn,
      sessionExpired,
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
