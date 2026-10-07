/**
 * THE GOOGLE WAY IN — the whole round-trip, in one file.
 *
 * /login offers two ways to sign in and they have almost nothing in common.
 * The email-and-password way is a form: React owns the values, submits them,
 * and reads the answer. The Google way is a departure — the browser leaves
 * our app entirely, visits our API, then Google, then comes back to /login
 * with either a session cookie or an error code in the URL.
 *
 * Because it leaves and returns, the Google path has three parts that only
 * make sense read together, and they sat far apart in `Login.tsx`: the URL
 * that starts the trip, the button that navigates to it, and the table of
 * what can come back broken. Someone asking "why does signing in with Google
 * show me this message" had to find a helper near the top of the page, a
 * component two hundred lines below it, and a lookup table between them.
 * They are now one file, in the order the trip happens.
 *
 * What is NOT here: reading the `?error=` param off the URL and clearing it
 * afterwards. That is page behaviour — it decides what banner /login shows on
 * mount — so it stayed with the page. This file only says what a code MEANS.
 */

import { apiPath } from "../lib/api";
import { readStoredLocale, t } from "../lib/locales";
import type { MessageKey, SupportedLocale } from "../lib/locales";
import { DEFAULT_REDIRECT } from "../lib/sign-in-destination";
import { useEffect, useState } from 'react';
import { isMobileBuild } from '../lib/platform';

/**
 * Build the absolute (or relative) URL the browser should navigate to in
 * order to start the Google OAuth flow.
 *
 * - In same-origin mode this navigates to `/api/auth/google/login`.
 * - When `VITE_API_URL` points at a different API origin, `apiPath` prefixes
 *   that origin while still targeting the API's `/api` route namespace.
 *
 * Centralised here (rather than inlined in JSX) so the same helper can be
 * unit-tested and reused if a future page adds a "Re-authenticate with
 * Google" affordance.
 */
export function googleLoginUrl(returnTo: string): string {
  const params = new URLSearchParams({ returnTo });
  return `${apiPath("/auth/google/login")}?${params.toString()}`;
}

/**
 * Human-readable copy for the OAuth error codes the API redirects back
 * with on `/login?error=...`. Keeping this map next to the page that
 * renders it (rather than baked into the API) means the API is free to
 * stay terse and machine-friendly while the UI can evolve its language.
 *
 * Unknown codes degrade to a generic banner instead of crashing — useful
 * if the API adds a new failure mode before the SPA learns about it.
 */
const OAUTH_ERROR_KEYS = {
  oauth_denied: "oauthDenied",
  state_expired: "oauthExpired",
  state_mismatch: "oauthMismatch",
  missing_code: "oauthMissingCode",
  token_exchange_failed: "oauthExchangeFailed",
  invalid_id_token: "oauthInvalidToken",
  account_conflict: "oauthAccountConflict",
  upsert_failed: "oauthUpsertFailed",
} as const satisfies Record<string, MessageKey>;

export function oauthErrorMessageKey(code: string | null): MessageKey | null {
  if (!code) return null;
  return OAUTH_ERROR_KEYS[code as keyof typeof OAUTH_ERROR_KEYS] ?? "oauthFallback";
}

/**
 * Full-page navigation to the API's `/api/auth/google/login` endpoint, which
 * sets the OAuth `state`/PKCE cookies and 302-redirects to Google's consent
 * screen. We deliberately use `window.location.assign` (not `fetch`) because:
 *
 *   1. The OAuth dance involves cross-origin redirects — Google → API
 *      callback → SPA — that the fetch transport cannot follow without
 *      losing the session cookie that the API's callback writes.
 *   2. The state/PKCE cookies are httpOnly: the browser must own them, not
 *      JS, and `fetch` would never expose them anyway. A top-level nav is
 *      the only transport that lets the cookies survive the round-trip.
 *
 * The button is rendered identically in both "login" and "signup" tabs
 * because the API's callback already handles upsert-or-link semantics: a
 * Google identity that we've never seen before becomes a brand-new user
 * row, and one that matches an existing email gets linked to that account.
 * Splitting the affordance into "Sign up with Google" vs "Sign in with
 * Google" would imply a behavioural difference that isn't there.
 */
export function GoogleSignInButton({
  disabled = false,
  locale = readStoredLocale(),
  returnTo = DEFAULT_REDIRECT,
}: {
  disabled?: boolean;
  locale?: SupportedLocale;
  returnTo?: string;
}): JSX.Element {
  const [pending, setPending] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isMobileBuild) return;
    let stopped = false;
    const update = () => { void import('../lib/platform/google-sign-in').then(module => module.hasNativeGoogleSignIn())
      .then(value => { if (!stopped) setPending(value); }).catch(() => {});
    };
    update(); window.addEventListener('waka:authorization-changed', update);
    return () => { stopped = true; window.removeEventListener('waka:authorization-changed', update); };
  }, []);
  function handleClick(): void {
    if (disabled || starting) return;
    if (isMobileBuild) {
      setStarting(true); setError(null);
      void import('../lib/platform/google-sign-in').then(module => module.startNativeGoogleSignIn(returnTo))
        .then(() => setPending(true)).catch(() => setError(t(locale, 'oauthFallback'))).finally(() => setStarting(false));
      return;
    }
    // assign() (vs href= or replace()) keeps the /login entry in browser
    // history so the user can hit "Back" from Google's consent page and
    // land where they were. replace() would silently swallow that history
    // entry, which is hostile to users who change their mind.
    window.location.assign(googleLoginUrl(returnTo));
  }

  return <>
    <button
      type="button"
      className="btn-google"
      onClick={handleClick}
      disabled={disabled || starting}
      aria-label={t(locale, "loginGoogleContinue")}
    >
      {/*
        Inline SVG (rather than an <img>) so the icon ships with the JS
        bundle, has zero extra network requests, and inherits the button's
        focus/hover state via currentColor where helpful. The four-color
        Google "G" is not recolored — Google's brand guidelines require
        the original palette on the official sign-in mark.
      */}
      <svg
        className="btn-google__icon"
        width="18"
        height="18"
        viewBox="0 0 18 18"
        aria-hidden="true"
        focusable="false"
      >
        <path
          fill="#4285F4"
          d="M17.64 9.2045c0-.6381-.0573-1.2518-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0782-1.7959 2.7164v2.2581h2.9087c1.7018-1.5668 2.6836-3.8741 2.6836-6.615z"
        />
        <path
          fill="#34A853"
          d="M9 18c2.43 0 4.4673-.806 5.9564-2.1805l-2.9087-2.2581c-.8059.54-1.8368.8595-3.0477.8595-2.344 0-4.3282-1.5831-5.0359-3.7104H.9573v2.3318C2.4382 15.9831 5.4818 18 9 18z"
        />
        <path
          fill="#FBBC05"
          d="M3.9641 10.71c-.18-.54-.2823-1.1168-.2823-1.71s.1023-1.17.2823-1.71V4.9582H.9573A8.9965 8.9965 0 0 0 0 9c0 1.4523.3477 2.8268.9573 4.0418L3.9641 10.71z"
        />
        <path
          fill="#EA4335"
          d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.346l2.5813-2.5814C13.4632.8918 11.426 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9582L3.9641 7.29C4.6718 5.1627 6.656 3.5795 9 3.5795z"
        />
      </svg>
      <span>{t(locale, "loginGoogleContinue")}</span>
    </button>
    {isMobileBuild && pending && <button type="button" className="btn-google" onClick={() => {
      void import('../lib/platform/google-sign-in').then(module => module.cancelNativeGoogleSignIn())
        .then(() => setPending(false)).catch(() => setError(t(locale, 'oauthFallback')));
    }}>{t(locale, 'nativeCancelSignIn')}</button>}
    {error && <p role="alert">{error}</p>}
  </>;
}
