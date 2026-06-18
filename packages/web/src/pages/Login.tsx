/**
 * /login page.
 *
 * Hosts two forms behind a tab toggle:
 *   - <SignupForm />  → POST /auth/signup (create account)
 *   - <LoginForm />   → POST /auth/login  (sign in to existing account)
 *
 * Both forms route their success path through the AuthContext rather than
 * the bare API helpers, so that:
 *   - the in-memory `user` state and the localStorage cache are updated
 *     atomically the moment the server confirms the session,
 *   - the route guard on `/` sees a logged-in user on the very next render
 *     instead of bouncing the visitor back to /login because the context
 *     hadn't refreshed yet.
 *
 * Post-auth redirect logic respects `location.state.from` (set by future
 * route-guard redirects, e.g. when an anonymous visitor hits a protected
 * URL and gets bounced here). When absent we default to "/".
 */

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { Location } from "react-router-dom";

import { ApiError, apiPath } from "../lib/api";
import type { LoginFieldErrors, SignupFieldErrors } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { formatMessage, readStoredLocale, t } from "../lib/locales";

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/**
 * Mirror of the server's password policy so the UI can fail fast without a
 * round-trip. Keeping the constant here (instead of importing it across
 * package boundaries) is a deliberate trade-off — the server remains the
 * source of truth via its zod schema, and any drift just means the user
 * gets a server-side error instead of a client-side one. That's safe; the
 * inverse (loose client, strict server) would be the dangerous direction.
 */
const MIN_PASSWORD_LENGTH = 8;

const DEFAULT_REDIRECT = "/";

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
function googleLoginUrl(): string {
  return apiPath("/auth/google/login");
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
} as const;

function describeOAuthError(code: string | null): string | null {
  if (!code) return null;
  const locale = readStoredLocale();
  return t(locale, OAUTH_ERROR_KEYS[code as keyof typeof OAUTH_ERROR_KEYS] ?? "oauthFallback");
}

/**
 * Resolve the post-auth destination. Honours `location.state.from` if it
 * looks like an in-app path the route-guard set when bouncing the user to
 * /login; otherwise falls back to the home route. We refuse anything that
 * doesn't start with "/" so a malicious referrer cannot steer the user to
 * an external site after they sign in.
 */
function resolveRedirect(location: Location): string {
  const state = location.state as { from?: unknown } | null;
  const from = state?.from;
  if (typeof from === "string" && from.startsWith("/") && from !== "/login") {
    return from;
  }
  return DEFAULT_REDIRECT;
}

// ---------------------------------------------------------------------------
// Signup form
// ---------------------------------------------------------------------------

interface SignupValues {
  email: string;
  password: string;
  name: string;
}

const EMPTY_SIGNUP: SignupValues = { email: "", password: "", name: "" };

export function SignupForm(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { signup } = useAuth();
  const locale = readStoredLocale();

  const [values, setValues] = useState<SignupValues>(EMPTY_SIGNUP);
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleChange<K extends keyof SignupValues>(
    key: K,
    value: SignupValues[K],
  ): void {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key as keyof SignupFieldErrors]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key as keyof SignupFieldErrors];
        return next;
      });
    }
    if (formError) setFormError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;

    // Cheap pre-flight validation so common typos don't even hit the network.
    const local: SignupFieldErrors = {};
    const email = values.email.trim();
    if (!email) {
      local.email = [t(locale, "loginEmailRequired")];
    }
    if (!values.password) {
      local.password = [t(locale, "loginPasswordRequired")];
    } else if (values.password.length < MIN_PASSWORD_LENGTH) {
      local.password = [
        formatMessage(locale, "loginPasswordMin", { count: MIN_PASSWORD_LENGTH }),
      ];
    }
    if (Object.keys(local).length > 0) {
      setFieldErrors(local);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    try {
      await signup({
        email,
        password: values.password,
        name: values.name.trim() || undefined,
      });
      // AuthContext has already cached the user; the route guard on `/`
      // (or the user's pre-redirect destination) will see them as
      // authenticated on the very next render.
      navigate(resolveRedirect(location), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.fieldErrors) {
          setFieldErrors(err.fieldErrors as SignupFieldErrors);
        }
        if (!err.fieldErrors || err.status === 409) {
          setFormError(err.message);
        }
      } else {
        setFormError(
          t(locale, "loginNetworkError"),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  const emailError = fieldErrors.email?.[0];
  const passwordError = fieldErrors.password?.[0];
  const nameError = fieldErrors.name?.[0];

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate>
      {formError ? (
        <div className="form-error" role="alert">
          {formError}
        </div>
      ) : null}

      <label className="field">
        <span className="field-label">{t(locale, "loginEmail")}</span>
        <input
          className="field-input"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          disabled={submitting}
          value={values.email}
          onChange={(e) => handleChange("email", e.target.value)}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "signup-email-error" : undefined}
        />
        {emailError ? (
          <span id="signup-email-error" className="field-error">
            {emailError}
          </span>
        ) : null}
      </label>

      <label className="field">
        <span className="field-label">{t(locale, "loginPassword")}</span>
        <input
          className="field-input"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          disabled={submitting}
          value={values.password}
          onChange={(e) => handleChange("password", e.target.value)}
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={
            passwordError ? "signup-password-error" : undefined
          }
        />
        {passwordError ? (
          <span id="signup-password-error" className="field-error">
            {passwordError}
          </span>
        ) : null}
      </label>

      <label className="field">
        <span className="field-label">{t(locale, "loginNameOptional")}</span>
        <input
          className="field-input"
          type="text"
          name="name"
          autoComplete="name"
          disabled={submitting}
          value={values.name}
          onChange={(e) => handleChange("name", e.target.value)}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? "signup-name-error" : undefined}
        />
        {nameError ? (
          <span id="signup-name-error" className="field-error">
            {nameError}
          </span>
        ) : null}
      </label>

      <button className="btn-primary" type="submit" disabled={submitting}>
        {submitting ? t(locale, "loginCreatingAccount") : t(locale, "loginCreateAccount")}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Login form
// ---------------------------------------------------------------------------

interface LoginValues {
  email: string;
  password: string;
}

const EMPTY_LOGIN: LoginValues = { email: "", password: "" };

export function LoginForm(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const locale = readStoredLocale();

  const [values, setValues] = useState<LoginValues>(EMPTY_LOGIN);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function handleChange<K extends keyof LoginValues>(
    key: K,
    value: LoginValues[K],
  ): void {
    setValues((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key as keyof LoginFieldErrors]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[key as keyof LoginFieldErrors];
        return next;
      });
    }
    if (formError) setFormError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting) return;

    // Pre-flight: presence only. We deliberately do NOT enforce the password
    // length floor on the login form — existing accounts created before any
    // future policy change must still be able to sign in. The server is the
    // single arbiter of "is this credential valid".
    const local: LoginFieldErrors = {};
    const email = values.email.trim();
    if (!email) local.email = [t(locale, "loginEmailRequired")];
    if (!values.password) local.password = [t(locale, "loginPasswordRequired")];
    if (Object.keys(local).length > 0) {
      setFieldErrors(local);
      return;
    }

    setSubmitting(true);
    setFormError(null);
    setFieldErrors({});
    try {
      await login({ email, password: values.password });
      navigate(resolveRedirect(location), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        // Treat 401 (bad credentials) as a form-level message rather than a
        // field-level one — pinning the error to "password" would imply the
        // email is correct, which is an information leak we'd rather avoid.
        if (err.status === 401) {
          setFormError(t(locale, "loginInvalidCredentials"));
        } else if (err.status === 404) {
          // Endpoint not yet wired on the backend (earlier sub-ACs). Surface
          // a useful, non-scary message rather than letting the raw "HTTP
          // 404" bubble through.
          setFormError(
            t(locale, "loginUnavailable"),
          );
        } else {
          if (err.fieldErrors) {
            setFieldErrors(err.fieldErrors as LoginFieldErrors);
          }
          if (!err.fieldErrors) {
            setFormError(err.message);
          }
        }
      } else {
        setFormError(
          t(locale, "loginNetworkError"),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  const emailError = fieldErrors.email?.[0];
  const passwordError = fieldErrors.password?.[0];

  return (
    <form className="login-form" onSubmit={handleSubmit} noValidate>
      {formError ? (
        <div className="form-error" role="alert">
          {formError}
        </div>
      ) : null}

      <label className="field">
        <span className="field-label">{t(locale, "loginEmail")}</span>
        <input
          className="field-input"
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          disabled={submitting}
          value={values.email}
          onChange={(e) => handleChange("email", e.target.value)}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "login-email-error" : undefined}
        />
        {emailError ? (
          <span id="login-email-error" className="field-error">
            {emailError}
          </span>
        ) : null}
      </label>

      <label className="field">
        <span className="field-label">{t(locale, "loginPassword")}</span>
        <input
          className="field-input"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          disabled={submitting}
          value={values.password}
          onChange={(e) => handleChange("password", e.target.value)}
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? "login-password-error" : undefined}
        />
        {passwordError ? (
          <span id="login-password-error" className="field-error">
            {passwordError}
          </span>
        ) : null}
      </label>

      <button className="btn-primary" type="submit" disabled={submitting}>
        {submitting ? t(locale, "loginSigningIn") : t(locale, "loginTab")}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Google sign-in button
// ---------------------------------------------------------------------------

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
function GoogleSignInButton({
  disabled = false,
}: {
  disabled?: boolean;
}): JSX.Element {
  const locale = readStoredLocale();

  function handleClick(): void {
    if (disabled) return;
    // assign() (vs href= or replace()) keeps the /login entry in browser
    // history so the user can hit "Back" from Google's consent page and
    // land where they were. replace() would silently swallow that history
    // entry, which is hostile to users who change their mind.
    window.location.assign(googleLoginUrl());
  }

  return (
    <button
      type="button"
      className="btn-google"
      onClick={handleClick}
      disabled={disabled}
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
  );
}

/**
 * Visual divider between the OAuth button and the email/password form. A
 * pair of horizontal rules with centered "or" text — keeps the eye moving
 * between the two equally-valid paths instead of biasing toward one.
 */
function OrDivider(): JSX.Element {
  const locale = readStoredLocale();

  return (
    <div className="login-divider" role="separator" aria-orientation="horizontal">
      <span className="login-divider__line" aria-hidden="true" />
      <span className="login-divider__label">{t(locale, "loginOr")}</span>
      <span className="login-divider__line" aria-hidden="true" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page shell
// ---------------------------------------------------------------------------

type Mode = "login" | "signup";

/**
 * Wraps the active form in the WAKA visual chrome. The mode toggle is a
 * pair of buttons (not a radio group) so keyboard activation matches the
 * "this swaps the visible form" affordance — the underlying state is a
 * single string, not a multi-value selection.
 *
 * Mode defaults to "login" because returning users outnumber new ones in
 * steady-state; new visitors flip the toggle once and the choice is sticky
 * for the lifetime of the page render.
 */
export default function LoginPage(): JSX.Element {
  const [mode, setMode] = useState<Mode>("login");
  const locale = readStoredLocale();
  const location = useLocation();
  const navigate = useNavigate();

  /**
   * Surface the OAuth error code (if any) the API redirected us back with
   * via `?error=...`. We strip the param off the URL once we've captured it
   * so a refresh doesn't keep showing a stale banner — the read-once
   * semantics match how form-level errors elsewhere in this page behave.
   *
   * State, not derived-from-search-params, so the banner persists across the
   * URL cleanup. `useState` initializer reads search params lazily on mount.
   */
  // Read-only: the banner persists for this page lifetime, then disappears
  // naturally on the next navigation (form sign-in, retried Google flow,
  // or anchor click). No setter is needed because there is no in-page
  // dismiss affordance — re-trying is the dismiss action.
  const [oauthError] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return describeOAuthError(params.get("error"));
  });

  useEffect(() => {
    // Only clean up if we actually picked up an error param. Avoids a
    // history.replaceState on every mount for normal /login visits.
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("error")) return;
    params.delete("error");
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace: true, state: location.state },
    );
    // We intentionally only run this once on mount — depending on
    // navigate/location would create a feedback loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const headline = t(locale, mode === "login" ? "loginWelcome" : "loginBegin");
  const subtitle = t(locale, mode === "login" ? "loginSubtitle" : "signupSubtitle");

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="login-title">
        <p className="login-eyebrow">{t(locale, "loginEyebrow")}</p>
        <h1 id="login-title" className="login-title">
          {headline}
        </h1>
        <p className="login-subtitle">{subtitle}</p>

        {oauthError ? (
          <div
            className="form-error"
            role="alert"
            // Dismiss button is intentionally omitted — re-attempting the
            // OAuth flow (or successfully signing in via the form below)
            // both clear the banner naturally. Adding an "x" would imply
            // the error is incidental rather than actionable.
          >
            {oauthError}
          </div>
        ) : null}

        <GoogleSignInButton />

        <OrDivider />

        <div
          className="login-tabs"
          role="tablist"
          aria-label={t(locale, "loginTabAria")}
        >
          <button
            type="button"
            role="tab"
            id="login-tab-login"
            aria-selected={mode === "login"}
            aria-controls="login-tabpanel"
            className={
              "login-tab" + (mode === "login" ? " login-tab--active" : "")
            }
            onClick={() => setMode("login")}
          >
            {t(locale, "loginTab")}
          </button>
          <button
            type="button"
            role="tab"
            id="login-tab-signup"
            aria-selected={mode === "signup"}
            aria-controls="login-tabpanel"
            className={
              "login-tab" + (mode === "signup" ? " login-tab--active" : "")
            }
            onClick={() => setMode("signup")}
          >
            {t(locale, "signupTab")}
          </button>
        </div>

        <div
          id="login-tabpanel"
          role="tabpanel"
          aria-labelledby={
            mode === "login" ? "login-tab-login" : "login-tab-signup"
          }
        >
          {mode === "login" ? <LoginForm /> : <SignupForm />}
        </div>

        <p className="login-footer">
          {mode === "login" ? (
            <>
              {t(locale, "loginNewPrompt")} {" "}
              <button
                type="button"
                className="login-link"
                onClick={() => setMode("signup")}
              >
                {t(locale, "loginCreateAccount")}
              </button>
              .
            </>
          ) : (
            <>
              {t(locale, "loginExistingPrompt")} {" "}
              <button
                type="button"
                className="login-link"
                onClick={() => setMode("login")}
              >
                {t(locale, "loginTab")}
              </button>
              .
            </>
          )}
        </p>
      </section>
    </main>
  );
}
