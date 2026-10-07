/**
 * Client for `/api/auth` — mirrors `packages/api/src/routes/auth.ts`.
 *
 * Signing up, signing in, signing out, and the two things a session may change
 * about itself. The vocabulary is `docs/data-model.md`'s: an **account** logs
 * in, a **profile** owns memory, and `/auth/me` answers with both because a
 * session is the pairing of the two.
 *
 * The Google and CLI sign-in routes (`auth-google.ts`, `auth-cli.ts` on the
 * server) have no client helpers here: the first is a browser redirect the app
 * never fetches, and the second is for machines that are not this app.
 */

import type { SupportedLocale } from "../locales";
import {
  ApiError,
  apiPath,
  patchJson,
  postJson,
  type ApiFieldErrors,
  type ApiProfileType,
} from "./http";
import { apiFetch, nativeSession, revokeRetiredNativeSessions } from './transport';
import { isMobileBuild, platformServices } from '../platform';

// ---------------------------------------------------------------------------
// Who a session is
// ---------------------------------------------------------------------------

/**
 * The auth identity: one login, one person. Everything on it answers "who
 * signed in and what may they reach", which is why the display fields live on
 * the profile instead — a person's name is a property of the memory they own,
 * and an account owns several.
 */
export interface ApiAccount {
  id: string;
  email: string;
  onboardingCompletedAt: string | null;
  isAdmin: boolean;
}

/** The unit that owns memory. Every session acts as exactly one of these. */
export interface ApiProfile {
  id: string;
  accountId: string;
  type: ApiProfileType;
  name: string;
  avatarUrl: string | null;
  preferredLocale: SupportedLocale;
  publicHandle: string | null;
  publicProfileEnabled: boolean;
  publicTopOfMindEnabled: boolean;
}

/** Who the session is: the account that logged in, acting as one profile. */
export interface ApiViewer {
  account: ApiAccount;
  profile: ApiProfile;
}

/**
 * Field-level validation errors as emitted by the Hono signup handler.
 */
export interface SignupFieldErrors extends ApiFieldErrors {
  email?: string[];
  password?: string[];
  name?: string[];
}

/**
 * Field-level validation errors as emitted by the Hono login handler.
 * Distinct alias so call-sites can be specific even though the runtime
 * shape is a strict subset of `SignupFieldErrors`.
 */
export interface LoginFieldErrors extends ApiFieldErrors {
  email?: string[];
  password?: string[];
}

// ---------------------------------------------------------------------------
// Signup
// ---------------------------------------------------------------------------

export interface SignupRequest {
  email: string;
  password: string;
  name?: string;
  preferredLocale?: SupportedLocale;
}

export interface AuthSessionResponse extends ApiViewer {
  /**
   * Session JWT. Mirrored in the httpOnly cookie; included in the body so
   * non-browser clients (CLI, e2e tests) can authenticate too. The web app
   * deliberately does NOT persist this in localStorage — the cookie is the
   * source of truth — but having it here keeps the contract symmetric.
   */
  token: string;
}

/**
 * POST /auth/signup
 *
 * Creates an email+password account, its human profile, and a session. On
 * success the server has already set the `waka_session` cookie; the returned
 * object is what the app renders itself from until the next `/auth/me`.
 *
 * Throws `ApiError` on any non-2xx response so callers get a single,
 * predictable failure path (try/catch instead of a discriminated union).
 */
export async function signup(input: SignupRequest): Promise<AuthSessionResponse> {
  return authenticate('/auth/signup', input, 'Signup failed');
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export interface LoginRequest {
  email: string;
  password: string;
}

/**
 * POST /auth/login
 *
 * Authenticate an existing account. Server sets the `waka_session` cookie;
 * the account + acting profile are returned for UI rendering.
 */
export async function login(input: LoginRequest): Promise<AuthSessionResponse> {
  return authenticate('/auth/login', input, 'Login failed');
}

async function authenticate(path: string, input: SignupRequest | LoginRequest, message: string): Promise<AuthSessionResponse> {
  const version = isMobileBuild ? nativeSession.beginChange() : 0;
  if (isMobileBuild) await (await platformServices()).credentials.remove('auth.authorization');
  const response = await postJson<AuthSessionResponse>(apiPath(path), input, message);
  if (isMobileBuild) {
    if (response.profile.type !== 'human' || response.profile.accountId !== response.account.id) {
      throw new ApiError({ status: 403, message: 'Mobile sign-in requires your personal profile.' });
    }
    try { await nativeSession.adopt(response.token, version); }
    catch { throw new ApiError({ status: 0, code: 'NATIVE_SESSION_NOT_SAVED', message: 'Sign-in could not be saved securely. Please try again.' }); }
    void revokeRetiredNativeSessions();
  }
  return response;
}

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

/**
 * POST /auth/logout
 *
 * Asks the server to clear the session cookie. We swallow non-2xx responses
 * here because client-side state (the in-memory viewer, localStorage cache)
 * MUST be cleared regardless of whether the network round-trip succeeds —
 * otherwise a flaky network leaves the UI showing a "logged in" state that
 * the server has already invalidated. The auth context handles that policy.
 */
export async function logout(): Promise<void> {
  if (isMobileBuild) {
    await (await platformServices()).credentials.remove('auth.authorization');
    await nativeSession.clear();
    await revokeRetiredNativeSessions();
    return;
  }
  await apiFetch(apiPath("/auth/logout"), {
    method: "POST",
    credentials: "include",
  }).catch(() => {
    // Network failure: still proceed; the caller wipes local state anyway.
  });
}

// ---------------------------------------------------------------------------
// Current viewer
// ---------------------------------------------------------------------------

/**
 * GET /auth/me
 *
 * Returns the account implied by the session cookie plus the profile that
 * session acts as, or `null` when the cookie is missing/invalid/expired. Used
 * by `<AuthProvider>` on mount to hydrate state from the server (the cookie is
 * httpOnly so JS cannot read it directly — the server must tell us who it
 * sees).
 *
 * A 401 response is treated as "no session" rather than an error: it's the
 * expected outcome for an anonymous visitor. Genuine network failures throw
 * `ApiError` so the caller can decide whether to retry.
 */
export async function fetchCurrentViewer(): Promise<ApiViewer | null> {
  if (isMobileBuild) void revokeRetiredNativeSessions();
  let res: Response;
  try {
    res = await apiFetch(apiPath("/auth/me"), {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ApiError({
      status: 0,
      message: "Network unreachable while loading session",
    });
  }

  if (res.status === 401) return null;

  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON response — handled below.
  }

  if (!res.ok) {
    const errorBody = (body ?? {}) as { error?: string };
    throw new ApiError({
      status: res.status,
      message:
        errorBody.error ?? `Failed to load session (HTTP ${res.status}).`,
    });
  }

  const payload = (body ?? {}) as Partial<ApiViewer>;
  if (!payload.account || !payload.profile) return null;
  if (isMobileBuild && (payload.profile.type !== 'human' || payload.profile.accountId !== payload.account.id)) {
    await nativeSession.clear();
    throw new ApiError({ status: 403, message: 'Mobile sign-in requires your personal profile.' });
  }
  if (isMobileBuild) void revokeRetiredNativeSessions();
  return { account: payload.account, profile: payload.profile };
}

export interface UpdateAuthPreferencesRequest {
  preferredLocale: SupportedLocale;
}

/**
 * PATCH /auth/me/preferences
 *
 * Persists preferences that should follow the person across devices. Today
 * that is only preferredLocale, which also drives the language of everything
 * the server generates for this profile.
 */
export async function updateAuthPreferences(
  input: UpdateAuthPreferencesRequest,
): Promise<ApiViewer> {
  return patchJson<ApiViewer>(
    apiPath("/auth/me/preferences"),
    input,
    "Failed to update preferences",
  );
}

export interface UpdateAuthProfileRequest {
  name: string;
  preferredLocale: SupportedLocale;
  completeOnboarding?: boolean;
  publicHandle?: string | null;
  publicProfileEnabled?: boolean;
  publicTopOfMindEnabled?: boolean;
}

/**
 * PATCH /auth/me/profile
 *
 * The name, avatar, language and public surface all belong to the profile;
 * `completeOnboarding` is the one field here that lands on the account, which
 * is why the response carries both.
 */
export async function updateAuthProfile(
  input: UpdateAuthProfileRequest,
): Promise<ApiViewer> {
  return patchJson<ApiViewer>(
    apiPath("/auth/me/profile"),
    input,
    "Failed to update profile",
  );
}

export async function deleteAccount(): Promise<void> {
  const res = await apiFetch(apiPath("/auth/me"), {
    method: "DELETE",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirmation: "DELETE" }),
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      // ignore malformed error bodies
    }
    const errorBody = (body ?? {}) as { error?: string; details?: ApiFieldErrors };
    throw new ApiError({
      status: res.status,
      message: errorBody.error ?? `Failed to delete account (HTTP ${res.status}).`,
      fieldErrors: errorBody.details,
    });
  }
  if (isMobileBuild) await nativeSession.clear();
}
