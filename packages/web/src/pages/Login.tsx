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
 *
 * TWO THINGS THIS PAGE NO LONGER HOLDS, and where to find them.
 *
 *   - `components/GoogleSignIn.tsx` — the other way in. It is a departure
 *     rather than a form: the browser leaves for Google and comes back with
 *     a session or an error code, so the URL that starts it, the button, and
 *     the table of what can come back broken live together there.
 *   - `lib/sign-in-destination.ts` — where a visitor lands afterwards, and
 *     why some answers to that question are refused. It moved because it is
 *     the one rule on this page with security consequences and it needs to
 *     be somewhere a test can execute it.
 *
 * WHAT STAYED, AND WHY IT IS ONE THING. The two forms and the tab toggle
 * read as one flow: the footer link flips the tab, the tab swaps the form,
 * and the two forms deliberately validate DIFFERENTLY — signup enforces the
 * password floor, login refuses to, so that an account created under an
 * older policy can still sign in. That asymmetry is the kind a reader only
 * notices when both rules are twenty lines apart. Splitting the forms into
 * separate files would hide it and invite someone to "de-duplicate" two
 * shapes that are alike by coincidence and different on purpose.
 */

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { GoogleSignInButton, oauthErrorMessageKey } from "../components/GoogleSignIn";
import { ApiError } from "../lib/api";
import type { LoginFieldErrors, SignupFieldErrors } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { formatMessage, normalizeSupportedLocale, readStoredLocale, supportedLocales, t, writeStoredLocale } from "../lib/locales";
import type { SupportedLocale } from "../lib/locales";
import { resolveRedirect } from "../lib/sign-in-destination";

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

// ---------------------------------------------------------------------------
// Signup form
// ---------------------------------------------------------------------------

interface SignupValues {
  email: string;
  password: string;
  name: string;
  preferredLocale: SupportedLocale;
}

const EMPTY_SIGNUP: SignupValues = {
  email: "",
  password: "",
  name: "",
  preferredLocale: readStoredLocale(),
};

interface SignupFormProps {
  locale?: SupportedLocale;
  onLocaleChange?: (locale: SupportedLocale) => void;
}

export function SignupForm({
  locale: shellLocale = readStoredLocale(),
  onLocaleChange,
}: SignupFormProps = {}): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { signup } = useAuth();

  const [values, setValues] = useState<SignupValues>(() => ({
    ...EMPTY_SIGNUP,
    preferredLocale: shellLocale,
  }));
  const locale = values.preferredLocale;
  const [fieldErrors, setFieldErrors] = useState<SignupFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setValues((prev) => {
      if (prev.preferredLocale === shellLocale) return prev;
      return { ...prev, preferredLocale: shellLocale };
    });
  }, [shellLocale]);

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
    if (!values.name.trim()) {
      local.name = [t(locale, "profileNicknameRequired")];
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
        name: values.name.trim(),
        preferredLocale: values.preferredLocale,
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
        <span className="field-label">{t(locale, "profileNickname")}</span>
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


      <label className="field">
        <span className="field-label">{t(locale, "languageLabel")}</span>
        <select
          className="field-input"
          value={values.preferredLocale}
          disabled={submitting}
          onChange={(e) => {
            const next = normalizeSupportedLocale(e.target.value);
            handleChange("preferredLocale", next);
            if (onLocaleChange) {
              onLocaleChange(next);
            } else {
              writeStoredLocale(next);
            }
          }}
        >
          {supportedLocales.map((option) => (
            <option key={option.code} value={option.code}>
              {option.nativeLabel}
            </option>
          ))}
        </select>
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
// The seam between the two ways in
// ---------------------------------------------------------------------------

/**
 * Visual divider between the OAuth button and the email/password form. A
 * pair of horizontal rules with centered "or" text — keeps the eye moving
 * between the two equally-valid paths instead of biasing toward one.
 */
function OrDivider({ locale = readStoredLocale() }: { locale?: SupportedLocale } = {}): JSX.Element {
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
  const loginTabRef = useRef<HTMLButtonElement>(null);
  const signupTabRef = useRef<HTMLButtonElement>(null);
  const [locale, setLocale] = useState<SupportedLocale>(() => readStoredLocale());
  const location = useLocation();
  const navigate = useNavigate();

  const handleLocaleChange = (next: SupportedLocale): void => {
    setLocale(next);
    writeStoredLocale(next);
  };

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
  const [oauthErrorCode] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("error");
  });
  const oauthErrorKey = oauthErrorMessageKey(oauthErrorCode);
  const oauthError = oauthErrorKey ? t(locale, oauthErrorKey) : null;

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

  const activateLoginTab = (): void => {
    setMode("login");
    loginTabRef.current?.focus();
  };

  const activateSignupTab = (): void => {
    setMode("signup");
    signupTabRef.current?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();

    if (event.key === "Home") {
      activateLoginTab();
    } else if (event.key === "End") {
      activateSignupTab();
    } else if (event.key === "ArrowLeft") {
      if (event.currentTarget.id === "login-tab-login") {
        activateSignupTab();
      } else {
        activateLoginTab();
      }
    } else if (event.currentTarget.id === "login-tab-signup") {
      activateLoginTab();
    } else {
      activateSignupTab();
    }
  };

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

        <GoogleSignInButton locale={locale} returnTo={resolveRedirect(location)} />

        <OrDivider locale={locale} />

        <div
          className="login-tabs"
          role="tablist"
          aria-label={t(locale, "loginTabAria")}
        >
          <button
            ref={loginTabRef}
            type="button"
            role="tab"
            id="login-tab-login"
            aria-selected={mode === "login"}
            aria-controls="login-tabpanel"
            tabIndex={mode === "login" ? 0 : -1}
            className={
              "login-tab" + (mode === "login" ? " login-tab--active" : "")
            }
            onClick={() => setMode("login")}
            onKeyDown={handleTabKeyDown}
          >
            {t(locale, "loginTab")}
          </button>
          <button
            ref={signupTabRef}
            type="button"
            role="tab"
            id="login-tab-signup"
            aria-selected={mode === "signup"}
            aria-controls="login-tabpanel"
            tabIndex={mode === "signup" ? 0 : -1}
            className={
              "login-tab" + (mode === "signup" ? " login-tab--active" : "")
            }
            onClick={() => setMode("signup")}
            onKeyDown={handleTabKeyDown}
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
          {mode === "login" ? (
            <LoginForm />
          ) : (
            <SignupForm locale={locale} onLocaleChange={handleLocaleChange} />
          )}
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
