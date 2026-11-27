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
 * older policy can still sign in.
 *
 * That asymmetry is the thing a split would endanger, and it is worth being
 * precise about why, because the obvious argument is false: the two rules are
 * NOT near each other. They sit 196 lines apart, and nobody is noticing the
 * difference by reading them side by side. What actually protects it is the
 * explicit comment at `LoginForm`'s pre-flight check saying the omission is
 * deliberate. So the rule is: if these forms are ever split, THAT COMMENT
 * TRAVELS WITH THE FUNCTION. Separate files would strand it and invite the
 * next reader to "de-duplicate" two shapes that are alike by coincidence and
 * different on purpose.
 */

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SurfaceHeader } from "../components/SurfaceHeader";
import { LegalLinks } from "../components/LegalLinks";

import { Companion } from "../components/Companion";
import {NativePasswordSignup,SignupAdmission} from "../components/SignupAdmission";
import {isMobileBuild} from "../lib/platform";
import { GoogleSignInButton, oauthErrorMessageKey } from "../components/GoogleSignIn";
import { ApiError } from "../lib/api";
import type { LoginFieldErrors, SignupFieldErrors } from "../lib/api";
import { hasSignedInHere, useAuth } from "../lib/auth-context";
import { applyDocumentLocale, formatMessage, isSupportedLocale, readStoredLocale, t, writeStoredLocale } from "../lib/locales";
import type { SupportedLocale } from "../lib/locales";
import { resolveRedirect, safeInAppPath } from "../lib/sign-in-destination";

/**
 * THE ONE WAY BACK OUT OF THE DOOR, and why there is exactly one.
 *
 * Law 2 of `docs/six-laws.md`: every surface you can enter has a visible way
 * out, and it costs one press. The door is the hardest case in the product,
 * because for most people arriving here there is genuinely nowhere behind
 * them — and a control offering to return a person to a protected URL they
 * were just bounced off would bounce them straight back. A way out that
 * returns you to where you were refused is not a way out, it is a loop.
 *
 * There is one real case, and it is the only one this returns a path for: a
 * stranger reading somebody's PUBLIC page who presses "Create your WAKA".
 * `PublicProfile` sends them here with `state.from` set to `/@handle`, and
 * that page is readable signed out — so going back works, and today nothing
 * offers it. They were reading something, they pressed a button to find out
 * what this is, and the page they were reading is gone with no control
 * anywhere that returns it.
 *
 * SO THE TEST IS "CAN THEY ACTUALLY GET BACK", not "did they come from
 * somewhere". A public handle path is the whole answer to that question while
 * signed out, which is why this matches the shape rather than trusting
 * `from`. It runs `safeInAppPath` first regardless: `from` is visitor-
 * influenced, and `sign-in-destination.ts` is where this product keeps the
 * rule about that.
 */
export function wayBackFrom(from: unknown): string | null {
  const path = safeInAppPath(from);
  if (!path) return null;
  return /^\/@[^/]+$/.test(path) ? path : null;
}

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
  preferredLocale: SupportedLocale;
}

const EMPTY_SIGNUP: SignupValues = {
  email: "",
  password: "",
  preferredLocale: readStoredLocale(),
};

interface SignupFormProps {
  locale?: SupportedLocale;
  /** the page around the form follows the choice — picking 한국어 must flip
      the whole surface, not just the fields inside the border */
  onLocaleChange?: (locale: SupportedLocale) => void;
}

export function SignupForm(props:SignupFormProps = {}):JSX.Element{
 return isMobileBuild?<NativePasswordSignup locale={props.locale??readStoredLocale()}><PasswordForm {...props} admissionOff/></NativePasswordSignup>:<PasswordForm {...props}/>;
}
function PasswordForm({
  locale: shellLocale = readStoredLocale(),
  admissionOff=false,
}: SignupFormProps&{admissionOff?:boolean}): JSX.Element {
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
  const [admissionReady,setAdmissionReady]=useState(admissionOff);
  const [uncertain,setUncertain]=useState(false);
  const [admissionRevision,setAdmissionRevision]=useState(0);

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
    if (formError&&!uncertain) setFormError(null);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (submitting||!admissionReady||uncertain) return;

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
      const created = await signup({
        email,
        password: values.password,
        preferredLocale: values.preferredLocale,
      });
      /* EMAIL AND PASSWORD ONLY (founder, 2026-11-26, from the iOS and
         simplicity audit: "do all 6"): the name and language are asked by
         onboarding's "Let's get you set up", which shows because no `named`
         marker is written here. The language sent is the page's own, which
         that step then confirms. */
      // AuthContext has already cached the user; the route guard on `/`
      // (or the user's pre-redirect destination) will see them as
      // authenticated on the very next render.
      navigate(resolveRedirect(location, created.account.id), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        /* STATUS 0 IS A DEAD CONNECTION, NOT AN ANSWER — and this branch is
           new because the door lost its own words to a fix made elsewhere.

           `writeJson` did not wrap its fetch, so a dead network threw a raw
           `TypeError` and landed in the `else` below, which says
           `loginNetworkError`: "We couldn't reach the server. Check your
           connection and try again." Wrapping it (2026-08-26, so the world
           would stop showing people the browser's `Failed to fetch`) turned
           that TypeError into an `ApiError { status: 0 }` — which no longer
           matches `else`, and fell through to `err.message`:

               "Login failed: network unreachable"

           The API client's voice, on the product's first surface. The fix for
           the world quietly regressed the door, and only pressing the door's
           submit with the network dead showed it. */
        if (err.status === 0) {
          setUncertain(true);setFormError(t(locale,"signupOutcomeUnknown"));
        } else if(err.code === "signup_capacity"){
          if(!admissionOff){setAdmissionReady(false);setAdmissionRevision(v=>v+1);}
          setFormError(t(locale,"signupCapacity"));
        } else if(err.code?.startsWith("signup_")&&err.code!=="signup_outcome_unknown"){
          setAdmissionReady(false);setAdmissionRevision(v=>v+1);setFormError(t(locale,"signupVerificationUnavailable"));
        } else if(err.status>=500){
          setUncertain(true);setFormError(t(locale,"signupOutcomeUnknown"));

        } else {
          // OFF has no widget to restore readiness. Ordinary correctable
          // errors keep the legacy native form usable; policy/unknown paths
          // above still hold new attempts.
          if(!admissionOff){setAdmissionReady(false);setAdmissionRevision(v=>v+1);}
          const fields: SignupFieldErrors = {};
          if (err.fieldErrors?.email?.length) fields.email = [t(locale, "loginEmailCheck")];
          if (err.fieldErrors?.password?.length) fields.password = [t(locale, "loginPasswordCheck")];
          if (err.fieldErrors?.name?.length) fields.name = [t(locale, "loginNameTooLong")];
          setFieldErrors(fields);
          if (err.status === 409) setFormError(t(locale, "signupEmailTaken"));
          else if (!Object.keys(fields).length) setFormError(t(locale, "signupInputInvalid"));
        }
      } else {
        setUncertain(true);setFormError(
          t(locale, "signupOutcomeUnknown"),
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
          enterKeyHint="next"
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.form?.querySelector<HTMLInputElement>('input[name="password"]')?.focus(); } }}
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
          enterKeyHint="go"
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

      {/* `btn-doorway`: the login page's own submit, and NOT `.profile-card`'s
          save or onboarding's. `.login-card` is shared by four screens, so
          the weight this control needs had to be asked for by name rather
          than inherited by ancestor. */}
      {!uncertain&&!admissionOff&&<SignupAdmission key={admissionRevision} flow="password" locale={locale} onReady={setAdmissionReady}/>}
      <button className="btn-primary btn-doorway" type="submit" disabled={submitting||!admissionReady||uncertain}>
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

export function LoginForm({ locale = readStoredLocale() }: { locale?: SupportedLocale } = {}): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();

  const [values, setValues] = useState<LoginValues>(EMPTY_LOGIN);
  const [fieldErrors, setFieldErrors] = useState<LoginFieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  /**
   * WHY THE KIND IS TRACKED AND NOT INFERRED FROM THE MESSAGE.
   *
   * The recovery line under a failed sign-in used to be rendered on
   * `formError === t(locale, "loginInvalidCredentials")` — comparing a
   * RENDERED SENTENCE to decide what to show. Reword that string and the line
   * silently stops appearing, with nothing failing anywhere: the exact hazard
   * this codebase has spent a week removing from its stylesheets, written
   * fresh into a page the same week. A state flag set where the 401 is
   * actually handled cannot drift from the copy, because it does not read it.
   */
  const [wrongCredentials, setWrongCredentials] = useState(false);
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
    setWrongCredentials(false);
    setFieldErrors({});
    try {
      const signedIn = await login({ email, password: values.password });
      navigate(resolveRedirect(location, signedIn.account.id), { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        // A dead connection is not an answer from the server — see the same
        // branch in SignupForm above for why this exists and what it is
        // repairing. Measured: "Login failed: network unreachable" where the
        // catalogue already had the product's own sentence for it.
        if (err.status === 0) {
          setFormError(t(locale, "loginNetworkError"));
        } else if (err.status === 401) {
          setFormError(t(locale, "loginInvalidCredentials"));
          setWrongCredentials(true);
        } else if (err.status === 404) {
          // Endpoint not yet wired on the backend (earlier sub-ACs). Surface
          // a useful, non-scary message rather than letting the raw "HTTP
          // 404" bubble through.
          setFormError(
            t(locale, "loginUnavailable"),
          );
        } else if (err.status === 429) {
          setFormError(t(locale, "profilePasswordWait"));
        } else {
          const fields: LoginFieldErrors = {};
          if (err.fieldErrors?.email?.length) fields.email = [t(locale, "loginEmailCheck")];
          if (err.fieldErrors?.password?.length) fields.password = [t(locale, "loginPasswordCheck")];
          setFieldErrors(fields);
          if (!Object.keys(fields).length) setFormError(t(locale, "loginFailed"));
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
          {/* THE WAY BACK IN, SAID WHERE THE PERSON IS STUCK.
              Found in the heuristic pass, 2026-08-26: there is no password
              reset anywhere in this product — `auth-password.ts` has exactly
              `signup` and `login` — so someone who forgets one is locked out
              of everything they kept, on a door that says "return to what you
              kept". The message said "Incorrect email or password." and
              stopped there, and a person would go looking for the reset link
              that is not there.

              What IS true is that `auth-google.ts` links an existing account
              by VERIFIED email, so Continue with Google below really does open
              the same archive — and it refuses to link an unverified claim,
              which is why saying this is safe rather than an invitation. The
              missing reset is stated plainly rather than left to be
              discovered: this product's whole posture is that it does not have
              quiet corners, and "there is no way to do this" is exactly the
              kind of thing a quiet corner hides.

              Only under the credentials failure. A network error or an
              unavailable endpoint is not a person who has forgotten
              something, and offering them a way back in would be noise. */}
          {wrongCredentials ? (
            <span className="login-recover">{t(locale, "loginNoResetYet")}</span>
          ) : null}
        </div>
      ) : null}

      <label className="field">
        <span className="field-label">{t(locale, "loginEmail")}</span>
        <input
          className="field-input"
          type="email"
          name="email"
          autoComplete="email"
          enterKeyHint="next"
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.form?.querySelector<HTMLInputElement>('input[name="password"]')?.focus(); } }}
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
          enterKeyHint="go"
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

      {/* `btn-doorway`: the login page's own submit, and NOT `.profile-card`'s
          save or onboarding's. `.login-card` is shared by four screens, so
          the weight this control needs had to be asked for by name rather
          than inherited by ancestor. */}
      <button className="btn-primary btn-doorway" type="submit" disabled={submitting}>
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
  const location = useLocation();
  // A browser handoff chooses the visible tab only; it carries no proof.
  const [mode, setMode] = useState<Mode>(()=>new URLSearchParams(location.search).get('signup')==='1'?'signup':'login');
  const loginTabRef = useRef<HTMLButtonElement>(null);
  const signupTabRef = useRef<HTMLButtonElement>(null);
  const [locale, setLocale] = useState<SupportedLocale>(() => {
    const params = new URLSearchParams(location.search);
    const hint = params.get("preferredLocale");
    if ((params.get("mobile") === "1" || params.get("signup") === "1") && isSupportedLocale(hint)) return hint;
    return readStoredLocale();
  });
  useEffect(() => applyDocumentLocale(locale), [locale]);
  const navigate = useNavigate();
  /* Why the door is standing here, when the reason is "we could not ask" —
     see `AuthContextValue.serverUnreachable`. It never decides access. */
  const { serverUnreachable } = useAuth();
  const wayBack = wayBackFrom((location.state as { from?: unknown } | null)?.from);

  /**
   * Surface the OAuth error code (if any) the API redirected us back with
   * via `?error=...`. We strip the param off the URL once we've captured it
   * so a refresh doesn't keep showing a stale banner — the read-once
   * semantics match how form-level errors elsewhere in this page behave.
   *
   * State, not derived-from-search-params, so the banner persists across the
   * URL cleanup. `useState` initializer reads search params lazily on mount.
   */
  const [oauthErrorCode, setOAuthErrorCode] = useState(() => new URLSearchParams(location.search).get("error"));
  const oauthErrorKey = oauthErrorMessageKey(oauthErrorCode);
  const oauthError = oauthErrorKey ? t(locale, oauthErrorKey) : null;

  useEffect(() => {
    // Native deep links can deliver an error after the login page mounted.
    const params = new URLSearchParams(location.search);
    const error = params.get("error");
    if (!error) return;
    setOAuthErrorCode(error);
    params.delete("error");
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "" },
      { replace: true, state: location.state },
    );
  }, [location.pathname, location.search, location.state, navigate]);

  /* "Welcome back." only to a browser that has been signed in before; a
     first visit is greeted without the claim that it is a return. */
  const [returning] = useState(hasSignedInHere);
  const headline = t(locale, mode === "login" ? (returning ? "loginWelcome" : "loginWelcomeFirst") : "loginBegin");

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
      {/* BACK TO WHAT THEY WERE READING, as the shared header's "<" (nav
          system): see `wayBackFrom` for why this is the only arrival this
          page can honestly offer a way out of, and why most visitors
          correctly see nothing here. */}
      {wayBack ? <SurfaceHeader locale={locale} className="login-head" back={{ kind: "back", onBack: () => navigate(wayBack) }} /> : null}
      <section className="login-card" aria-labelledby="login-title">
        {/* ═══ THE COMPANION IS ON THE DOOR ══════════════════════════════
            Founder, of the home screen: "this is my only favorite screen of
            the experience", and of an empty chat: "nothing here feels
            몽글몽글." The finding behind `Companion` was that this product
            IS a companion and most of its surfaces had sent it away — and
            the one surface that had never had it is the FIRST one anybody
            sees. A person's first impression of WAKA was a form.

            IT ALSO REPLACES SOMETHING FAKE. This page painted a radial
            gradient at the top of the shell — a lamp with nothing holding
            it, which read as a smudge on the ground rather than as light.
            The creature's aura is the same shape made honest: there is a
            thing here, and it is lit. See `.waka-companion`, which is sized
            to its own falloff precisely so it can be dropped into a page
            like this one. */}
        <Companion size={88} />
        {/* ONE THING SAID ONCE (craft audit, 2026-11-26). The door said
            "WAKA" over the title, then the title, then a subtitle restating
            the title's promise. The eyebrow went (the creature and the tab's
            name already say where you are), and the subtitle stays only
            under "Welcome.", where it is the one line saying what this is;
            "Start saving what moves you." is that line already. */}
        <h1 id="login-title" className="login-title">
          {headline}
        </h1>
        {!returning && mode === "login" && <p className="login-subtitle">{t(locale, "loginProductDescription")}</p>}

        {/* THE DOOR SAYS WHY IT IS THE DOOR.
            A person whose network is down is bounced here by `RequireAuth`
            with a valid session and greeted "Welcome back. Sign in to return
            to what you kept." — which asserts they are signed out, in the one
            situation where somebody is already afraid their archive is gone.
            Measured by killing every /api/ request and reloading: the door
            appears; restore the network and they are straight back in.

            The greeting stays (it is right when the door is right). This says
            what is actually known, above it, in the banner slot the OAuth
            error already uses. Suppressed when an OAuth error is showing —
            that one is about a specific attempt and outranks a condition. */}
        {serverUnreachable && !oauthError ? (
          <div className="form-error" role="alert">
            {t(locale, "loginNetworkError")}
          </div>
        ) : null}

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
            <LoginForm locale={locale} />
          ) : (
            <SignupForm
              locale={locale}
              onLocaleChange={(next) => {
                setLocale(next);
                /* remembered, so the sign-in tab and the next visit speak it
                   too — the account's own setting takes over after signup */
                writeStoredLocale(next);
              }}
            />
          )}
        </div>

        {/* THE ALTERNATIVE COMES AFTER THE THING IT IS AN ALTERNATIVE TO.
            Google used to sit above the tabs, so the first and heaviest thing
            on the screen was a full-width white pill handing the account to
            somebody else, and the submit for the form a person had just
            filled in was a 40x16 lowercase footnote at the bottom-left,
            ranked below both tabs and the field labels.

            Reading order now says what the product means: this is an
            email-and-password product, and Google is one other way in. The
            divider says so out loud in between. Nothing was removed — the
            button is the same button, in the place an alternative goes. */}
        <OrDivider locale={locale} />

        <GoogleSignInButton locale={locale} returnTo={resolveRedirect(location)} needsVerification={oauthErrorCode === "signup_verification_required" || oauthErrorCode === "signup_admission_used" || oauthErrorCode === "signup_busy" || oauthErrorCode === "signup_closed"} />
        {(!returning || mode === "signup") && <p className="field-hint login-google-hint">{t(locale, "loginGoogleDataUse")}</p>}
        <LegalLinks locale={locale} />

        {/* BACK TO WHAT THEY WERE READING — see `wayBackFrom` for why this is
            the only arrival this page can honestly offer a way out of, and
            why most visitors correctly see nothing here. */}

      </section>
    </main>
  );
}
