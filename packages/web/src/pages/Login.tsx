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
 *
 * ── THE DOOR IS MADE OF THE WORLD NOW ──────────────────────────────────────
 *
 * The founder ruled once already on this exact failure, one screen along: the
 * loading page was "the product changing clothes twice on the way in", and the
 * answer was to make it the world's own early face — the world's ground, the
 * companion already home. The door was the last costume change left. Inside,
 * the product is lowercase verbs and light on `#06080d`; the door was Title
 * Case tabs reading `Sign in` / `Create account` over a form, with no sign
 * that anything lives here.
 *
 * Four things carry the change, and each is a corollary of "the door should be
 * rendered by the world" rather than a decoration:
 *
 *   THE COMPANION STANDS HERE. The same being, from the same module, as the
 *   loading frame and — a moment later — the world. It looks at the field you
 *   are in, because gaze is the one channel `character/body.ts` leaves an
 *   individual, and because the world never moves unless you moved it.
 *
 *   THE MENU SPEAKS THE PRODUCT'S VERBS. `continue` and `begin`, which is what
 *   the two tabs always meant — the subtitle under them has said "return to
 *   what you kept" all along. The ids do not change: `#login-tab-signup` is
 *   how every e2e walk in `tools/` gets into the product.
 *
 *   THE DOORWAY LIGHTS AS THE FORM FILLS. Light is this product's only meaning
 *   channel, so the submit starts dim and reaches full ink when the form has
 *   what it needs. It is NEVER disabled by that state — see `Doorway`.
 *
 *   THE DOOR REMEMBERS WHO WAS LAST HERE, the way a save file does, and greets
 *   them by name with the address already filled. `lib/door-memory` holds that
 *   record and says why it is not the auth cache.
 */

import { useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Companion, LOOKING_AHEAD } from "../components/Companion";
import type { CompanionGaze } from "../components/Companion";
import { GoogleSignInButton, oauthErrorMessageKey } from "../components/GoogleSignIn";
import { ApiError } from "../lib/api";
import type { LoginFieldErrors, SignupFieldErrors } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { forgetAtDoor, readDoorMemory } from "../lib/door-memory";
import type { DoorMemory } from "../lib/door-memory";
import {
  formatMessage,
  readStoredLocale,
  supportedLocales,
  t,
  writeStoredLocale,
} from "../lib/locales";
import type { SupportedLocale } from "../lib/locales";
import { resolveRedirect } from "../lib/sign-in-destination";
import { whenShort } from "../lib/when";

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
// What the being is looking at
// ---------------------------------------------------------------------------

/**
 * Which field has the person's hands, or nothing.
 *
 * The forms report the NAME of the field rather than a gaze, and the page
 * turns that into where the eyes go. Two reasons, both learned from the way
 * this file already keeps its rules: the mapping is a fact about the LAYOUT —
 * where that field sits under the being — so it belongs with the layout, in
 * one place, rather than copied into two forms that would drift apart the
 * first time a field moved. And a form that knew about eye geometry would be
 * a form nobody could render on its own, which is exactly what `SignupForm`'s
 * standalone use forbids.
 */
export type DoorLook = "email" | "password" | "name" | null;

/**
 * DOWN THE COLUMN, AS THE HANDS GO DOWN IT.
 *
 * The three fields are stacked, full-width, in this order, so the only axis
 * that carries any truth here is the vertical one — the being looks further
 * down as you move further down the form, and back up when you leave it. The
 * horizontal channel `CompanionGaze` offers is deliberately left unspent:
 * nothing on this screen sits to one side of anything else, and a sideways
 * glance would be motion that decorates rather than explains.
 */
const GAZE_BY_LOOK: Record<Exclude<DoorLook, null>, CompanionGaze> = {
  email: { x: 0, y: 0.55 },
  password: { x: 0, y: 0.8 },
  name: { x: 0, y: 1 },
};

function gazeFor(look: DoorLook): CompanionGaze {
  return look ? GAZE_BY_LOOK[look] : LOOKING_AHEAD;
}

/**
 * Which of this form's fields the event came from, or null for anything else.
 *
 * It reads the NATIVE event's target rather than the React one. React types
 * `event.target` as the element the handler is attached to — the form — which
 * is exactly wrong for a delegated handler: focus bubbles, so the element that
 * actually took focus is the native target, and asking React's type for it
 * would require a cast asserting something untrue. A real `instanceof` also
 * makes this honest about anything that is not an input at all.
 */
function fieldLookOf(target: EventTarget | null): DoorLook {
  const name = target instanceof HTMLInputElement ? target.name : "";
  return name === "email" || name === "password" || name === "name" ? name : null;
}

// ---------------------------------------------------------------------------
// The doorway
// ---------------------------------------------------------------------------

interface DoorwayProps {
  /** the form holds everything it needs — nothing is missing yet */
  ready: boolean;
  submitting: boolean;
  label: string;
  busyLabel: string;
}

/**
 * THE SUBMIT, LIT BY HOW FAR THE FORM HAS GOT.
 *
 * It used to be full ink from the first frame: on a near-black page the
 * brightest, largest object on screen was the button for the form nobody had
 * filled in yet. Everywhere else in this product light means *something is
 * here* — an orb's brightness is how much rests on it, a wall's ink is where
 * you are standing — and the door was the one surface spending it on nothing.
 *
 * So the doorway arrives dim and reaches full ink when the form has what it
 * needs. That is the same channel the world uses, applied to the only state a
 * door has.
 *
 * AND IT IS NEVER DISABLED BY THAT STATE. This matters more than the look. A
 * dimmed control that also refuses the press is a dead end: the person cannot
 * find out WHY it will not open, because the field errors only exist once
 * something has been submitted. Dim is a hint about what is missing; pressing
 * it still submits, still runs the pre-flight, and still says which field is
 * empty in words. `disabled` is spent on the one state where a press really
 * has nothing left to do — a request already in flight.
 */
function Doorway({ ready, submitting, label, busyLabel }: DoorwayProps): JSX.Element {
  return (
    /* `btn-doorway`: the login page's own submit, and NOT `.profile-card`'s
       save or onboarding's. `.login-card` is shared by four screens, so the
       weight this control needs had to be asked for by name rather than
       inherited by ancestor. */
    <button
      className="btn-primary btn-doorway"
      type="submit"
      data-lit={ready ? "lit" : "dim"}
      disabled={submitting}
    >
      {submitting ? busyLabel : label}
    </button>
  );
}

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
  /**
   * Where the hands are, for the being above the form. Optional and defaulted
   * to a no-op: this form is rendered on its own — in `auth-boundary.test.ts`,
   * and by anything that wants the signup form without the door around it —
   * and it must not require a companion to exist.
   */
  onLookAt?: (look: DoorLook) => void;
  /** the page around the form follows the choice — picking 한국어 must flip
      the whole surface, not just the fields inside the border */
  onLocaleChange?: (locale: SupportedLocale) => void;
}

export function SignupForm({
  locale: shellLocale = readStoredLocale(),
  onLookAt = () => undefined,
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
          setFormError(t(locale, "loginNetworkError"));
        } else {
          if (err.fieldErrors) {
            setFieldErrors(err.fieldErrors as SignupFieldErrors);
          }
          if (!err.fieldErrors || err.status === 409) {
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
  const nameError = fieldErrors.name?.[0];
  /* What the doorway's light is reading. The same three conditions the
     pre-flight above checks, and deliberately not a second opinion about
     them: if these two ever disagree, the light is lying about what the
     press will do. */
  const ready =
    values.email.trim().length > 0 &&
    values.password.length >= MIN_PASSWORD_LENGTH &&
    values.name.trim().length > 0;

  return (
    <form
      className="login-form"
      onSubmit={handleSubmit}
      noValidate
      /* One pair of handlers for the whole form rather than three: focus and
         blur both bubble (unlike the events they are named after on other
         platforms), so the form can watch its own fields. `relatedTarget`
         staying inside the form means the hands only moved between fields —
         the being should follow, not look away and back. */
      onFocus={(event) => onLookAt(fieldLookOf(event.nativeEvent.target))}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        onLookAt(null);
      }}
    >
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


      {/* The language field is BACK (founder, 2026-08-31, reversing
          2026-08-22): the choice drives what language the memory itself is
          written in — signals, the top of mind, principles — so it belongs
          at the door, before the first keep. */}
      <label className="field">
        <span className="field-label">{t(locale, "profileLanguageLabel")}</span>
        <select
          className="field-input"
          name="preferredLocale"
          disabled={submitting}
          value={values.preferredLocale}
          onChange={(e) => {
            const next = e.target.value as SupportedLocale;
            handleChange("preferredLocale", next);
            onLocaleChange?.(next);
          }}
        >
          {supportedLocales.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeLabel}
            </option>
          ))}
        </select>
      </label>

      {/* THE LIGHT DOES NOT READ THE LANGUAGE FIELD, and that is deliberate
          rather than an oversight of the merge that brought the two together:
          a `<select>` always holds a value, so it is never one of the things
          that can still be missing. `ready` names exactly what the pre-flight
          below refuses on, or the doorway would be lying about what the press
          will do. */}
      <Doorway
        ready={ready}
        submitting={submitting}
        label={t(locale, "loginCreateAccount")}
        busyLabel={t(locale, "loginCreatingAccount")}
      />
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

interface LoginFormProps {
  /** see `SignupFormProps.onLookAt` — optional for the same reason */
  onLookAt?: (look: DoorLook) => void;
  /**
   * Who the door remembers, or null for a stranger. Only the ADDRESS is used
   * here — it starts in the email field so a returning person types one thing
   * instead of two. The name is the page's to say, in the greeting.
   *
   * The page remounts this form when the memory is forgotten (see its `key`),
   * so a cleared memory really does empty the field rather than leaving the
   * address of somebody who just said "not me" sitting in it.
   */
  remembered?: DoorMemory | null;
}

export function LoginForm({
  onLookAt = () => undefined,
  remembered = null,
}: LoginFormProps = {}): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const locale = readStoredLocale();

  const [values, setValues] = useState<LoginValues>(() =>
    remembered ? { ...EMPTY_LOGIN, email: remembered.email } : EMPTY_LOGIN,
  );
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
      await login({ email, password: values.password });
      navigate(resolveRedirect(location), { replace: true });
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
  /* Presence only, mirroring this form's pre-flight exactly — including its
     deliberate refusal to check the password length. A door that stayed dim
     for an account created under an older policy would be telling that person
     their own password is wrong before they had pressed anything. */
  const ready = values.email.trim().length > 0 && values.password.length > 0;

  return (
    <form
      className="login-form"
      onSubmit={handleSubmit}
      noValidate
      onFocus={(event) => onLookAt(fieldLookOf(event.nativeEvent.target))}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        onLookAt(null);
      }}
    >
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
          /* The one field a remembered person still has to fill. Autofocused
             only for them: on an empty door the first field is the right
             place to land, and stealing focus past it would be the page
             deciding something the visitor had not. */
          autoFocus={remembered !== null}
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

      <Doorway
        ready={ready}
        submitting={submitting}
        label={t(locale, "loginTab")}
        busyLabel={t(locale, "loginSigningIn")}
      />
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
  /**
   * WHICH SIDE THE DOOR OPENS ON.
   *
   * `login` by default, because returning people outnumber new ones in
   * steady state — and `?begin` for the one caller that knows better. The
   * landing page's whole purpose is to send strangers here, and dropping them
   * on the sign-in side would ask them for a password to an account the page
   * had just finished persuading them to create.
   *
   * A query rather than router state, so the link survives being copied,
   * shared and bookmarked. Read once, on mount: after that the tabs are the
   * person's to move, and re-reading the URL would take that back.
   *
   * FROM THE ROUTER'S LOCATION, NOT `window.location`. The first version read
   * the window and passed every test that did not click a link — the landing
   * page's `begin` navigates in-app, so the address the router knows about is
   * the only one that has `?begin` in it at the moment this runs. Reading the
   * window would have shipped a funnel that worked when the URL was typed and
   * silently failed for everybody who arrived by pressing the button the page
   * is built around. (The OAuth banner below still reads the window, and that
   * is correct for it: it is recovering a param from a FULL-PAGE return from
   * Google, which the router never saw.)
   */
  const [mode, setMode] = useState<Mode>(() =>
    new URLSearchParams(location.search).has("begin") ? "signup" : "login",
  );
  const loginTabRef = useRef<HTMLButtonElement>(null);
  const signupTabRef = useRef<HTMLButtonElement>(null);
  const [locale, setLocale] = useState<SupportedLocale>(() => readStoredLocale());
  const navigate = useNavigate();
  /* Why the door is standing here, when the reason is "we could not ask" —
     see `AuthContextValue.serverUnreachable`. It never decides access. */
  const { serverUnreachable } = useAuth();

  /** Where the being is looking. Nothing but a focused field moves it. */
  const [look, setLook] = useState<DoorLook>(null);

  /**
   * WHO THE DOOR REMEMBERS. Read once, on mount: this is a display hint and
   * re-reading it would let another tab's sign-out change the greeting under
   * a person mid-sentence.
   *
   * It is only spent on the `continue` side. On `begin` the visitor is
   * declaring they are somebody new, and greeting them by the last person's
   * name there would be the door arguing with them.
   */
  const [remembered, setRemembered] = useState<DoorMemory | null>(() => readDoorMemory());
  const greeted = mode === "login" ? remembered : null;

  const forget = (): void => {
    forgetAtDoor();
    setRemembered(null);
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

  /* The greeting says the name when there is one to say. `loginWelcome` is
     the same sentence without it, so the two never drift into two different
     welcomes — one carries a name, the other does not. */
  const headline = greeted
    ? formatMessage(locale, "loginWelcomeNamed", { name: greeted.name })
    : t(locale, mode === "login" ? "loginWelcome" : "loginBegin");
  const subtitle = t(locale, mode === "login" ? "loginSubtitle" : "signupSubtitle");
  /* `whenShort` answers "" for a date it cannot read, and a memory written by
     an older version may have no date at all. Either way the line is dropped
     rather than rendered half-written: "last here" on its own says nothing. */
  const lastHere = greeted ? whenShort(greeted.at, locale) : "";

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
        {/* THE BEING IS AT THE DOOR, and it is the same one that will be
            standing in the world a moment later — `LoadingHome` draws it
            between the two. What made this screen read as a generic form was
            never the fields: it was that nothing lived here. A title screen
            with a character on it is a game; a column of inputs is a form.

            `aria-hidden` comes with the component: it is a picture of the
            product's inhabitant, and it says nothing a person needs read
            aloud that the words below it do not already say. */}
        <div className="door-being">
          <Companion scale={0.5} gaze={gazeFor(look)} />
        </div>
        <p className="login-eyebrow">{t(locale, "loginEyebrow")}</p>
        <h1 id="login-title" className="login-title">
          {headline}
        </h1>
        <p className="login-subtitle">{subtitle}</p>

        {/* WHAT A SAVE FILE SHOWS: whose it is, and when it was last put down.
            The name is in the greeting above; this is the rest of it, plus the
            one press that removes it. A machine can be shared, and a person
            who does not recognise this name must be able to clear it without
            signing in as somebody they are not. */}
        {greeted ? (
          <p className="door-save">
            {lastHere ? (
              <span className="door-save-when">
                {formatMessage(locale, "loginLastHere", { when: lastHere })}
              </span>
            ) : null}
            <button type="button" className="door-forget" onClick={forget}>
              {formatMessage(locale, "loginNotYou", { name: greeted.name })}
            </button>
          </p>
        ) : null}

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
            /* THE VISIBLE WORD IS INSIDE THE SPOKEN ONE. A title screen's menu
               says `continue`, and on its own that is thin for somebody who
               cannot see the form under it. WCAG's label-in-name rule settles
               how to fix that without weakening either: the accessible name
               must CONTAIN the visible text, so the label opens with the same
               word and then says what it opens. Speech control still reaches
               it by "continue". */
            aria-label={t(locale, "loginTabContinueAria")}
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
            /* see the sibling above */
            aria-label={t(locale, "loginTabBeginAria")}
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
            /* THE KEY IS WHAT MAKES "not you?" ACTUALLY EMPTY THE FIELD. The
               form seeds its email from the memory once, in a state
               initialiser, which is right — a person editing that address must
               not have it overwritten on the next render. The cost is that
               clearing the memory cannot reach the value any more, so
               forgetting somebody would leave their address sitting in the
               form they had just been removed from. Changing the key remounts
               the form, and a remount re-runs the initialiser against a memory
               that is now null. */
            <LoginForm
              key={remembered ? "remembered" : "stranger"}
              onLookAt={setLook}
              remembered={remembered}
            />
          ) : (
            <SignupForm
              locale={locale}
              onLookAt={setLook}
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

        <GoogleSignInButton locale={locale} returnTo={resolveRedirect(location)} />
      </section>
    </main>
  );
}
