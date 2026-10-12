/**
 * /onboarding — the one thing WAKA needs before it can address you.
 *
 * WHAT A CRAFT PASS FOUND HERE, because this page had never had one.
 *
 * NO WAY OUT (Law 2, `docs/six-laws.md`). This route sits behind `RequireAuth`
 * and behind NOTHING ELSE — there is no check anywhere that the person has not
 * already finished onboarding. So a signed-in person who types `/onboarding`,
 * or follows an old link, lands on a form with one field, one submit, and no
 * control of any kind that leaves. Founder: "after I click on it, I feel like
 * I'm lost how to go back to the previous screen." This is that, in its purest
 * form, on the one surface where it is reached by accident rather than on
 * purpose.
 *
 * The exit says two different true things depending on who is standing here,
 * and that is the whole reason it is not one button:
 *
 *   ALREADY SET UP — `account.onboardingCompletedAt` is written. Nothing is
 *   being asked of this person; they are here by address. The way out is the
 *   world, which is where they were.
 *
 *   NOT SET UP YET — there is no world to go back to, because they have not
 *   finished arriving. The only honest exit is to leave the account, and
 *   saying so beats a control that pretends there is somewhere else to be.
 *   Law 1: a control names exactly what it does.
 *
 * THE LANGUAGE FIELD IS BACK, and its absence was Law 3 rather than a choice.
 * The comment that stood here cited the founder's 2026-08-22 ruling that the
 * product speaks English only — which was REVERSED on 2026-08-31, and the
 * reversal landed on `Login`'s signup form with its own note: "the choice
 * drives what language the memory itself is written in — signals, the top of
 * mind, principles — so it belongs at the door, before the first keep."
 *
 * It landed on ONE door. This is the other one, and it is the only door a
 * person who signs in with Google ever passes through — they never see the
 * signup form, so until now they could not choose the language their memory
 * is written in at all, and the first thing WAKA wrote for them was written in
 * a guess. The plumbing was already here: `preferredLocale` was held in state
 * and sent to `updateProfile` with nothing on screen able to change it. The
 * page's own subtitle has been promising this field the whole time — "Choose
 * the name and language WAKA should use with you."
 */
import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "../lib/api";
import { Companion } from "../components/Companion";
import { useAuth } from "../lib/auth-context";
import {
  normalizeSupportedLocale,
  readStoredLocale,
  supportedLocales,
  t,
  writeStoredLocale,
} from "../lib/locales";
import type { SupportedLocale } from "../lib/locales";
import { safeInAppPath } from '../lib/sign-in-destination';

function safeRedirect(from: unknown): string {
  return safeInAppPath(from) ?? '/';
}

export default function OnboardingPage(): JSX.Element {
  const { account, profile, logout, updateProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { from?: unknown } | null;
  const [name, setName] = useState(profile?.name ?? "");
  const [preferredLocale, setPreferredLocale] = useState<SupportedLocale>(() =>
    normalizeSupportedLocale(profile?.preferredLocale ?? readStoredLocale()),
  );
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const locale = preferredLocale;
  /* Written already, so this person is not being asked anything — see the
     note at the top of the file on which exit they are owed. */
  const alreadySetUp = Boolean(account?.onboardingCompletedAt);

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
        {/* THE SAME COMPANION THE DOOR HAS. These two screens are one
            sequence — you sign up and land here — and the creature
            appearing on the first and not the second would read as the
            product losing interest the moment you are through. See the
            long note at the same line in `Login.tsx`. */}
        <Companion size={88} />
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
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          {/* The language the memory itself gets written in — see the note at
              the top of the file for why it is here and why it was not.
              It changes the page under the hand that changed it: `locale` IS
              this value, so the labels, the subtitle and the submit all speak
              the choice immediately. A language control that leaves the screen
              it is on in the old language is a control you have to trust
              rather than see. */}
          <label className="field">
            <span className="field-label">{t(locale, "profileLanguageLabel")}</span>
            <select
              className="field-input"
              name="preferredLocale"
              value={preferredLocale}
              disabled={submitting}
              onChange={(event) =>
                setPreferredLocale(event.currentTarget.value as SupportedLocale)
              }
            >
              {supportedLocales.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.nativeLabel}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary btn-doorway" type="submit" disabled={submitting}>
            {submitting ? t(locale, "profileSaving") : t(locale, "onboardingContinue")}
          </button>
        </form>
        {/* THE WAY OUT, one press, named for what it actually does. */}
        <p className="login-footer">
          {alreadySetUp ? (
            <Link className="login-link" to="/">
              {t(locale, "profileBackHome")}
            </Link>
          ) : (
            <button
              type="button"
              className="login-link"
              disabled={submitting}
              onClick={() => {
                void logout();
              }}
            >
              {t(locale, "signOut")}
            </button>
          )}
        </p>
      </section>
    </main>
  );
}
