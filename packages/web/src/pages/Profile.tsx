import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  ApiError,
  createProfile,
  endConnection,
  fetchConnections,
  deleteProfile,
  fetchProfiles,
  renameProfile,
  type ApiConnection,
  type ApiOwnedProfile,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { whenShort } from "../lib/when";
import {
  normalizeSupportedLocale,
  supportedLocales,
  t,
  writeStoredLocale,
} from "../lib/locales";
import type { SupportedLocale } from "../lib/locales";

const DELETE_CONFIRMATION = "DELETE";
const PUBLIC_HANDLE_PATTERN = /^[a-z0-9_-]{3,24}$/;

type ProfileTab = "you" | "access";

/** Keyed to the catalog, so a renamed message is a type error, not a blank tab. */
type MessageKey = Parameters<typeof t>[1];

const PROFILE_TABS: ReadonlyArray<{ id: ProfileTab; labelKey: MessageKey }> = [
  { id: "you", labelKey: "profileTabYou" },
  { id: "access", labelKey: "profileTabAccess" },
];

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

  // The account's memories. Loaded here rather than from auth context because
  // this is the only screen that administers them, and a stale list is worse
  // than a brief spinner when the next click deletes one.
  const [memories, setMemories] = useState<ApiOwnedProfile[] | null>(null);
  const [newMemoryName, setNewMemoryName] = useState("");
  const [creatingMemory, setCreatingMemory] = useState(false);
  /** The id currently being renamed or removed, so only its own row is busy. */
  const [busyMemoryId, setBusyMemoryId] = useState<string | null>(null);
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});

  const loadMemories = useCallback(async (): Promise<void> => {
    try {
      const rows = await fetchProfiles();
      setMemories(rows);
      setMemoryDrafts(Object.fromEntries(rows.map((row) => [row.id, row.name])));
    } catch {
      setMemories([]);
      setError(t(locale, "profileMemoriesError"));
    }
  }, [locale]);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  async function handleCreateMemory(): Promise<void> {
    const name = newMemoryName.trim();
    if (!name) {
      setError(t(locale, "profileMemoryNameRequired"));
      return;
    }
    setCreatingMemory(true);
    setStatus(null);
    setError(null);
    try {
      const created = await createProfile(name);
      setMemories((current) => [...(current ?? []), created]);
      setMemoryDrafts((current) => ({ ...current, [created.id]: created.name }));
      setNewMemoryName("");
      setStatus(t(locale, "profileMemoryCreated"));
    } catch (err) {
      // The server's own words carry information this page cannot invent —
      // the per-account ceiling, above all.
      setError(err instanceof ApiError ? err.message : t(locale, "profileMemoriesError"));
    } finally {
      setCreatingMemory(false);
    }
  }

  async function handleRenameMemory(memory: ApiOwnedProfile): Promise<void> {
    const name = (memoryDrafts[memory.id] ?? "").trim();
    if (!name) {
      setError(t(locale, "profileMemoryNameRequired"));
      return;
    }
    if (name === memory.name) return;
    setBusyMemoryId(memory.id);
    setStatus(null);
    setError(null);
    try {
      const updated = await renameProfile(memory.id, name);
      setMemories((current) =>
        (current ?? []).map((row) => (row.id === updated.id ? updated : row)),
      );
      setStatus(t(locale, "profileMemoryRenamed"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileMemoriesError"));
    } finally {
      setBusyMemoryId(null);
    }
  }

  async function handleRemoveMemory(memory: ApiOwnedProfile): Promise<void> {
    // Deleting a memory takes its whole stack by cascade, so it asks first.
    if (!window.confirm(t(locale, "profileMemoryRemoveConfirm"))) return;
    setBusyMemoryId(memory.id);
    setStatus(null);
    setError(null);
    try {
      await deleteProfile(memory.id);
      setMemories((current) => (current ?? []).filter((row) => row.id !== memory.id));
      setStatus(t(locale, "profileMemoryRemoved"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileMemoriesError"));
    } finally {
      setBusyMemoryId(null);
    }
  }

  /**
   * One page, four rooms. Everything used to arrive at once — identity,
   * sharing, memories, connections, and account deletion in a single column —
   * which made the page a wall rather than a place. Tabs hide nothing; they
   * decide what you are looking at now.
   */
  const [tab, setTab] = useState<ProfileTab>("you");
  const tabRefs = useRef<Partial<Record<ProfileTab, HTMLButtonElement | null>>>({});

  const [connections, setConnections] = useState<ApiConnection[] | null>(null);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);

  const loadConnections = useCallback(async (): Promise<void> => {
    try {
      setConnections(await fetchConnections());
    } catch {
      setConnections([]);
      setError(t(locale, "profileConnectionsError"));
    }
  }, [locale]);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  async function handleEndConnection(connection: ApiConnection): Promise<void> {
    // Ending the device you are holding logs you out of it, which is a
    // different promise from ending some other machine — so it asks a
    // different question.
    const question = connection.current
      ? t(locale, "profileConnectionEndCurrentConfirm")
      : t(locale, "profileConnectionEndConfirm");
    if (!window.confirm(question)) return;

    setBusyConnectionId(connection.id);
    setStatus(null);
    setError(null);
    try {
      await endConnection(connection.id);
      if (connection.current) {
        // The credential this page is using is gone; anything else it tried
        // to render would 401. Leave deliberately rather than let the app
        // discover it.
        navigate("/login", { replace: true });
        return;
      }
      setConnections((current) => (current ?? []).filter((row) => row.id !== connection.id));
      setStatus(t(locale, "profileConnectionEnded"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileConnectionsError"));
    } finally {
      setBusyConnectionId(null);
    }
  }

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

        {/*
          A segmented control built as a tray holding one moving pill: the
          indicator slides on `transform` alone, so switching rooms costs no
          layout. Arrow keys move between tabs because a tablist that only
          answers to a mouse is a tablist half-built.
        */}
        <div className="profile-tabs" role="tablist" aria-label={t(locale, "profileTabsLabel")}>
          <span
            className="profile-tabs-indicator"
            aria-hidden="true"
            style={{
              transform: `translateX(${PROFILE_TABS.findIndex((entry) => entry.id === tab) * 100}%)`,
            }}
          />
          {PROFILE_TABS.map((entry) => (
            <button
              key={entry.id}
              ref={(node) => {
                tabRefs.current[entry.id] = node;
              }}
              className={`profile-tab${entry.id === tab ? " is-active" : ""}`}
              type="button"
              role="tab"
              id={`profile-tab-${entry.id}`}
              aria-selected={entry.id === tab}
              aria-controls={`profile-panel-${entry.id}`}
              tabIndex={entry.id === tab ? 0 : -1}
              onClick={() => setTab(entry.id)}
              onKeyDown={(event) => {
                const step =
                  event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (step === 0) return;
                event.preventDefault();
                const index = PROFILE_TABS.findIndex((row) => row.id === tab);
                const next =
                  PROFILE_TABS[(index + step + PROFILE_TABS.length) % PROFILE_TABS.length]!;
                setTab(next.id);
                tabRefs.current[next.id]?.focus();
              }}
            >
              {t(locale, entry.labelKey)}
            </button>
          ))}
        </div>
        <form
          className="login-form profile-panel"
          onSubmit={handleSubmit}
          noValidate
          role="tabpanel"
          id="profile-panel-you"
          aria-labelledby="profile-tab-you"
          hidden={tab !== "you"}
        >
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
        <div
          className="profile-panel profile-room"
          role="tabpanel"
          id="profile-panel-access"
          aria-labelledby="profile-tab-access"
          hidden={tab !== "access"}
        >
        <section className="profile-memories-panel" aria-labelledby="profile-memories-title">
          <div className="profile-memories-heading">
            <p className="login-eyebrow" id="profile-memories-title">
              {t(locale, "profileMemoriesTitle")}
            </p>
            <p className="login-subtitle">{t(locale, "profileMemoriesHint")}</p>
          </div>

          <ul className="profile-list">
            {(memories ?? []).map((memory) => {
              const isHuman = memory.type === "human";
              const busy = busyMemoryId === memory.id;
              const draft = memoryDrafts[memory.id] ?? memory.name;
              const dirty = draft.trim().length > 0 && draft.trim() !== memory.name;
              return (
                <li key={memory.id} className="profile-list-row profile-memory-row">
                  <span className="profile-memory-badge">
                    {t(locale, isHuman ? "profileMemoryHuman" : "profileMemoryAgent")}
                  </span>
                  <input
                    className="profile-row-name"
                    type="text"
                    value={draft}
                    disabled={busy}
                    aria-label={memory.name}
                    onChange={(event) => {
                      // Read the value here, not inside the updater: React
                      // runs that callback after the handler returns, and by
                      // then `currentTarget` is null.
                      const value = event.currentTarget.value;
                      setMemoryDrafts((current) => ({ ...current, [memory.id]: value }));
                    }}
                  />
                  <span className="profile-row-actions">
                    {/* Rename earns its place only once the name has changed —
                        a permanently disabled button on every row is noise
                        pretending to be affordance. */}
                    {dirty || busy ? (
                      <button
                        className="profile-memory-action"
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRenameMemory(memory)}
                      >
                        {busy
                          ? t(locale, "profileMemoryRenameSaving")
                          : t(locale, "profileMemoryRename")}
                      </button>
                    ) : null}
                    {/* The human memory is the account's own and has no remove
                        button at all — a disabled one would imply it is merely
                        not allowed right now. */}
                    {isHuman ? null : (
                      <button
                        className="profile-memory-action is-destructive"
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRemoveMemory(memory)}
                      >
                        {busy
                          ? t(locale, "profileMemoryRemoving")
                          : t(locale, "profileMemoryRemove")}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
            <li className="profile-list-row profile-memory-new">
              <span className="profile-memory-badge" aria-hidden="true">
                +
              </span>
              <input
                className="profile-row-name"
                type="text"
                value={newMemoryName}
                placeholder={t(locale, "profileMemoryNewLabel")}
                disabled={creatingMemory}
                onChange={(event) => setNewMemoryName(event.currentTarget.value)}
              />
              <span className="profile-row-actions">
                {newMemoryName.trim() || creatingMemory ? (
                  <button
                    className="profile-memory-action profile-memory-create"
                    type="button"
                    disabled={creatingMemory}
                    onClick={() => void handleCreateMemory()}
                  >
                    {creatingMemory
                      ? t(locale, "profileMemoryCreating")
                      : t(locale, "profileMemoryCreate")}
                  </button>
                ) : null}
              </span>
            </li>
          </ul>
        </section>
        <section className="profile-memories-panel" aria-labelledby="profile-connections-title">
          <div className="profile-memories-heading">
            <p className="login-eyebrow" id="profile-connections-title">
              {t(locale, "profileConnectionsTitle")}
            </p>
            <p className="login-subtitle">{t(locale, "profileConnectionsHint")}</p>
          </div>

          <ul className="profile-list">
            {(connections ?? []).map((connection) => {
              const busy = busyConnectionId === connection.id;
              return (
                <li key={connection.id} className="profile-list-row profile-connection-row">
                  <div className="profile-row-main">
                    <span className="profile-row-title">
                      {connection.deviceLabel ?? t(locale, "profileConnectionUnlabelled")}
                      {connection.current ? (
                        <span className="profile-row-tag">
                          {t(locale, "profileConnectionThisDevice")}
                        </span>
                      ) : null}
                    </span>
                    <span className="profile-row-meta">
                      {connection.profile.name} · {t(locale, "profileConnectionLastSeen")}{" "}
                      {whenShort(connection.lastSeenAt)}
                    </span>
                  </div>
                  <span className="profile-row-actions">
                    <button
                      className="profile-memory-action is-destructive"
                      type="button"
                      disabled={busy}
                      onClick={() => void handleEndConnection(connection)}
                    >
                      {busy
                        ? t(locale, "profileConnectionEnding")
                        : t(locale, "profileConnectionEnd")}
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
          {connections !== null && connections.length === 0 ? (
            <p className="login-subtitle">{t(locale, "profileConnectionsEmpty")}</p>
          ) : null}
        </section>
        </div>
        <section
          className="profile-danger-panel profile-panel"
          aria-labelledby="profile-danger-title"
          hidden={tab !== "you"}
        >
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
