/**
 * THE NAME-ASK — the first minute of the product, and the only thing it wants.
 *
 * This was a settings card: "Set up your archive. Choose the name and language
 * WAKA should use with you." Two of those words were already false — the
 * language field left with the second language (founder ruling, 2026-08-22)
 * and the sentence kept promising a choice that was no longer on the screen —
 * and the third, "set up", is what you do to a router.
 *
 * What is actually happening here is the oldest scene in games: somebody asks
 * your name before you start. So the screen asks it, in the world's own dark,
 * with the being that is about to be your companion standing there, and
 * nothing else on it. One question, one field, one way through.
 *
 * NO STEP COUNTER, and that is a rule rather than an omission: `states render,
 * numerals never`. "Step 1 of 2" is a number standing in for a feeling, and
 * there is only one step here anyway — the door was the other one, and it is
 * behind them.
 *
 * It keeps `.login-card`'s composition (shared with `/login`, `/profile` and
 * the surface error) and takes two things from the door: `.door-being`, and
 * the `btn-doorway` submit lit by whether the question has been answered.
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { Companion, LOOKING_AHEAD } from "../components/Companion";
import type { CompanionGaze } from "../components/Companion";
import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import {
  normalizeSupportedLocale,
  readStoredLocale,
  t,
  writeStoredLocale,
} from "../lib/locales";
import type { SupportedLocale } from "../lib/locales";

/** Where the being looks while the one question on the screen is being answered. */
const AT_THE_ANSWER: CompanionGaze = { x: 0, y: 0.8 };

function safeRedirect(from: unknown): string {
  return typeof from === "string" && from.startsWith("/") && from !== "/login"
    ? from
    : "/";
}

export default function OnboardingPage(): JSX.Element {
  const { profile, updateProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: unknown } | null;
  const [name, setName] = useState(profile?.name ?? "");
  const [preferredLocale] = useState<SupportedLocale>(() =>
    normalizeSupportedLocale(profile?.preferredLocale ?? readStoredLocale()),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const locale = preferredLocale;
  /* The being looks down at the field while it is being answered — the same
     rhythm the door has, and the only channel `character/body.ts` leaves an
     individual to spend. One question, so one gaze; the door needs a map from
     fields to angles and this does not. */
  const [answering, setAnswering] = useState(false);
  const answered = name.trim().length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const displayName = name.trim();
    if (!displayName) {
      setError(t(locale, "profileNicknameRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await updateProfile({
        name: displayName,
        preferredLocale,
        completeOnboarding: true,
      });
      writeStoredLocale(preferredLocale);
      navigate(safeRedirect(state?.from), { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileSaveError"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-shell">
      <section className="login-card" aria-labelledby="onboarding-title">
        <div className="door-being">
          <Companion scale={0.5} gaze={answering ? AT_THE_ANSWER : LOOKING_AHEAD} />
        </div>
        <p className="login-eyebrow">{t(locale, "onboardingEyebrow")}</p>
        <h1 id="onboarding-title" className="login-title">
          {t(locale, "onboardingTitle")}
        </h1>
        <p className="login-subtitle">{t(locale, "onboardingSubtitle")}</p>
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field-label">{t(locale, "profileNickname")}</span>
            <input
              className="field-input"
              type="text"
              name="name"
              autoComplete="name"
              value={name}
              disabled={submitting}
              required
              /* The only question on the screen, so it is where the cursor
                 belongs on arrival — nothing is being skipped past. */
              autoFocus
              onFocus={() => setAnswering(true)}
              onBlur={() => setAnswering(false)}
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          {/* The language field left with the second language (founder
              ruling, 2026-08-22: the product speaks English only). */}
          {/* `btn-doorway` for the same reason `/login`'s submit wears it: this
              is a threshold, not a settings save, and it is the only thing on
              the screen to press. It lights when the question has an answer —
              and, exactly as at the door, it is never DISABLED by being dim,
              so pressing it while empty still says which field is missing. */}
          <button
            className="btn-primary btn-doorway"
            type="submit"
            data-lit={answered ? "lit" : "dim"}
            disabled={submitting}
          >
            {submitting ? t(locale, "profileSaving") : t(locale, "onboardingContinue")}
          </button>
        </form>
      </section>
    </main>
  );
}
