import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ApiError } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import {
  normalizeSupportedLocale,
  supportedLocales,
  t,
  writeStoredLocale,
} from "../lib/locales";
import type { SupportedLocale } from "../lib/locales";

const DELETE_CONFIRMATION = "DELETE";

export default function ProfilePage(): JSX.Element {
  const { user, logout, updateProfile, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(user?.name ?? "");
  const [preferredLocale, setPreferredLocale] = useState<SupportedLocale>(() =>
    normalizeSupportedLocale(user?.preferredLocale),
  );
  const [deleteText, setDeleteText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const locale = preferredLocale;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const nickname = name.trim();
    if (!nickname) {
      setError(t(locale, "profileNicknameRequired"));
      return;
    }
    setSubmitting(true);
    setStatus(null);
    setError(null);
    try {
      await updateProfile({
        name: nickname,
        preferredLocale,
        completeOnboarding: true,
      });
      writeStoredLocale(preferredLocale);
      setStatus(t(locale, "profileSaved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileSaveError"));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (deleteText !== DELETE_CONFIRMATION || deleting) return;
    setDeleting(true);
    setStatus(null);
    setError(null);
    try {
      await deleteAccount();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileDeleteError"));
      setDeleting(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    setStatus(null);
    setError(null);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileSignOutError"));
    }
  }

  return (
    <main className="login-shell profile-shell">
      <section className="login-card profile-card" aria-labelledby="profile-title">
        <header className="profile-header">
          <div>
            <p className="login-eyebrow">{t(locale, "profileEyebrow")}</p>
            <h1 id="profile-title" className="login-title">
              {t(locale, "profileTitle")}
            </h1>
            <p className="login-subtitle profile-email">{user?.email}</p>
          </div>
          <button
            className="profile-signout-button"
            type="button"
            disabled={submitting || deleting}
            onClick={handleSignOut}
          >
            {t(locale, "signOut")}
          </button>
        </header>
        {status ? <div className="form-success" role="status">{status}</div> : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <form className="login-form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field-label">{t(locale, "profileNickname")}</span>
            <input
              className="field-input"
              type="text"
              name="name"
              autoComplete="nickname"
              value={name}
              disabled={submitting || deleting}
              required
              onChange={(event) => setName(event.currentTarget.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">{t(locale, "languageLabel")}</span>
            <select
              className="field-input"
              value={preferredLocale}
              disabled={submitting || deleting}
              onChange={(event) => {
                const next = normalizeSupportedLocale(event.currentTarget.value);
                setPreferredLocale(next);
                writeStoredLocale(next);
              }}
            >
              {supportedLocales.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.nativeLabel}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-primary" type="submit" disabled={submitting || deleting}>
            {submitting ? t(locale, "profileSaving") : t(locale, "profileSave")}
          </button>
        </form>
        <section className="profile-danger-panel" aria-labelledby="profile-danger-title">
          <div className="profile-danger-heading">
            <p className="login-eyebrow" id="profile-danger-title">
              {t(locale, "profileDangerZone")}
            </p>
            <p className="login-subtitle">{t(locale, "profileDeleteHint")}</p>
          </div>
          <label className="field">
            <span className="field-label">{t(locale, "profileDeleteConfirmLabel")}</span>
            <input
              className="field-input"
              type="text"
              value={deleteText}
              disabled={deleting}
              onChange={(event) => setDeleteText(event.currentTarget.value)}
            />
          </label>
          <button
            className="btn-destructive"
            type="button"
            disabled={deleteText !== DELETE_CONFIRMATION || deleting}
            onClick={handleDelete}
          >
            {deleting ? t(locale, "profileDeleting") : t(locale, "profileDelete")}
          </button>
        </section>
        <p className="login-footer">
          <Link className="login-link" to="/">{t(locale, "profileBackHome")}</Link>
        </p>
      </section>
    </main>
  );
}
