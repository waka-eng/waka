import { useState } from "react";
import type { FormEvent } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import {
  normalizeSupportedLocale,
  readStoredLocale,
  t,
  writeStoredLocale,
} from "../lib/locales";
import type { SupportedLocale } from "../lib/locales";

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
          {/* The language field left with the second language (founder
              ruling, 2026-08-22: the product speaks English only). */}
          <button className="btn-primary" type="submit" disabled={submitting}>
            {submitting ? t(locale, "profileSaving") : t(locale, "onboardingContinue")}
          </button>
        </form>
      </section>
    </main>
  );
}
