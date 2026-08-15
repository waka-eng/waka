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
const PUBLIC_HANDLE_PATTERN = /^[a-z0-9_-]{3,24}$/;

export default function ProfilePage(): JSX.Element {
  const { account, profile, logout, updateProfile, deleteAccount } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState(profile?.name ?? "");
  const [publicHandle, setPublicHandle] = useState(profile?.publicHandle ?? "");
  const [publicProfileEnabled, setPublicProfileEnabled] = useState(
    profile?.publicProfileEnabled === true,
  );
  const [publicTopOfMindEnabled, setPublicTopOfMindEnabled] = useState(
    profile?.publicTopOfMindEnabled === true,
  );
  const [preferredLocale, setPreferredLocale] = useState<SupportedLocale>(() =>
    normalizeSupportedLocale(profile?.preferredLocale),
  );
  const [deleteText, setDeleteText] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const locale = preferredLocale;
  const normalizedPublicHandle = publicHandle.trim().replace(/^@+/, "").toLowerCase();
  const trimmedDisplayName = name.trim();
  const handleError =
    normalizedPublicHandle.length > 0 && !PUBLIC_HANDLE_PATTERN.test(normalizedPublicHandle)
      ? t(locale, "profilePublicHandleInvalid")
      : null;
  const publicProfileUrl =
    normalizedPublicHandle.length > 0
      ? `${typeof window === "undefined" ? "" : window.location.origin}/@${normalizedPublicHandle}`
      : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const handle = normalizedPublicHandle || null;
    if (!trimmedDisplayName) {
      setError(t(locale, "profileNicknameRequired"));
      return;
    }
    if ((publicProfileEnabled || publicTopOfMindEnabled) && !handle) {
      setError(t(locale, "profilePublicHandleRequired"));
      return;
    }
    if (handleError) {
      setError(handleError);
      return;
    }
    setSubmitting(true);
    setStatus(null);
    setError(null);
    try {
      await updateProfile({
        name: trimmedDisplayName,
        preferredLocale,
        completeOnboarding: true,
        publicHandle: handle,
        publicProfileEnabled,
        publicTopOfMindEnabled,
      });
      writeStoredLocale(preferredLocale);
      setStatus(t(locale, "profileSaved"));
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.fieldErrors?.publicHandle?.[0] ?? err.message);
      } else {
        setError(t(locale, "profileSaveError"));
      }
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
            <p className="login-subtitle profile-email">{account?.email}</p>
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
              autoComplete="name"
              value={name}
              disabled={submitting || deleting}
              required
              aria-describedby="profile-nickname-hint"
              aria-invalid={!trimmedDisplayName || undefined}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <span id="profile-nickname-hint" className="field-hint">
              {t(locale, "profileNicknameNoSpacesHint")}
            </span>
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
          <section className="profile-public-panel" aria-labelledby="profile-public-title">
            <div className="profile-public-heading">
              <p className="login-eyebrow" id="profile-public-title">
                {t(locale, "profilePublicTitle")}
              </p>
              <p className="login-subtitle">{t(locale, "profilePublicHint")}</p>
            </div>
            <label className="field">
              <span className="field-label">{t(locale, "profilePublicHandle")}</span>
              <div className="profile-handle-row">
                <span className="profile-handle-prefix" aria-hidden="true">@</span>
                <input
                  className="field-input profile-handle-input"
                  type="text"
                  name="publicHandle"
                  autoComplete="off"
                  value={publicHandle}
                  disabled={submitting || deleting}
                  aria-describedby="profile-public-handle-hint"
                  aria-invalid={handleError ? true : undefined}
                  onChange={(event) => setPublicHandle(event.currentTarget.value)}
                />
              </div>
              <span
                id="profile-public-handle-hint"
                className={handleError ? "field-error" : "field-hint"}
              >
                {handleError ?? t(locale, "profilePublicHandleHint")}
              </span>
            </label>
            <p className="login-subtitle">{t(locale, "profilePublicPrivacyHint")}</p>
            <label className="profile-toggle-row">
              <input
                type="checkbox"
                checked={publicProfileEnabled}
                disabled={submitting || deleting}
                aria-describedby="profile-public-profile-description"
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setPublicProfileEnabled(checked);
                  if (!checked) setPublicTopOfMindEnabled(false);
                }}
              />
              <span>{t(locale, "profilePublicEnabled")}</span>
              <span id="profile-public-profile-description" className="sr-only">
                {t(locale, "profilePublicPrivacyHint")}
              </span>
            </label>
            <label className="profile-toggle-row">
              <input
                type="checkbox"
                checked={publicTopOfMindEnabled}
                disabled={submitting || deleting || !publicProfileEnabled}
                aria-describedby="profile-public-top-of-mind-description"
                onChange={(event) => setPublicTopOfMindEnabled(event.currentTarget.checked)}
              />
              <span>{t(locale, "profilePublicTopOfMindEnabled")}</span>
              <span id="profile-public-top-of-mind-description" className="sr-only">
                {t(locale, "profilePublicHint")}
              </span>
            </label>
            {publicProfileUrl ? (
              <a className="profile-public-link" href={`/@${normalizedPublicHandle}`}>
                {publicProfileUrl}
              </a>
            ) : null}
          </section>
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
              aria-describedby="profile-delete-description"
              onChange={(event) => setDeleteText(event.currentTarget.value)}
            />
          </label>
          <button
            className="btn-destructive"
            type="button"
            disabled={deleteText !== DELETE_CONFIRMATION || deleting}
            onClick={handleDelete}
            aria-describedby="profile-delete-description"
          >
            {deleting ? t(locale, "profileDeleting") : t(locale, "profileDelete")}
          </button>
          <span id="profile-delete-description" className="sr-only">
            {t(locale, "profileDeleteHint")}
          </span>
        </section>
        <p className="login-footer">
          <Link className="login-link" to="/">{t(locale, "profileBackHome")}</Link>
        </p>
      </section>
    </main>
  );
}
