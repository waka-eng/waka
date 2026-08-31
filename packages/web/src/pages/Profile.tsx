import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import {
  ApiError,
  createAgentGrant,
  createAgentKey,
  createKeeperKey,
  createProfile,
  endConnection,
  fetchAgentGrants,
  fetchAgentKeys,
  fetchConnections,
  fetchConsultations,
  fetchKeeperKeys,
  deleteProfile,
  fetchProfiles,
  renameProfile,
  revokeAgentGrant,
  revokeAgentKey,
  revokeKeeperKey,
  type ApiAgentGrant,
  type ApiAgentKey,
  type ApiConnection,
  type ApiConsultation,
  type ApiKeeperKey,
  type ApiMintedKeeperKey,
  type ApiMintedKey,
  type ApiOwnedProfile,
} from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { whenShort } from "../lib/when";
import {
  normalizeSupportedLocale,
  t,
  writeStoredLocale,
  supportedLocales,
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
  const { account, profile, logout, updateProfile, updatePreferredLocale, deleteAccount } = useAuth();
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
  const [savingLocale, setSavingLocale] = useState(false);
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
  /**
   * A MEMORY AND ITS MACHINE KEY ARE ONE ACT (founder, 2026-08-29:
   * "shouldn't they go together?"). Nobody makes an agent memory except
   * because a machine is about to use it, so creation mints the first key
   * and opens the one-time secret box right here. Later keys are additions
   * — the wall and the folded audit keep those deliberate.
   */
  const [mintedAgentKey, setMintedAgentKey] = useState<ApiMintedKey | null>(null);

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
      try {
        const minted = await createAgentKey(created.id);
        setMintedAgentKey(minted);
        setAgentKeys((current) => [
          { ...minted, lastUsedAt: null, revokedAt: null },
          ...(current ?? []),
        ]);
      } catch {
        // The memory stands; only its key is missing, and the wall can
        // issue one. Saying so beats a box with nothing to show.
        setError(t(locale, "profileMemoryKeyFailed"));
      }
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

  /** The memory's own language (founder, 2026-08-31, reversing 2026-08-22):
      saved immediately — a language choice deferred behind a save button is
      a choice that looks ignored — and the server enqueues the top-of-mind
      rewrite itself. */
  async function handleLocaleChange(next: SupportedLocale): Promise<void> {
    if (next === preferredLocale) return;
    const before = preferredLocale;
    setPreferredLocale(next);
    setSavingLocale(true);
    setStatus(null);
    setError(null);
    try {
      await updatePreferredLocale(next);
      setStatus(t(next, "profileLanguageSaved"));
    } catch (err) {
      setPreferredLocale(before);
      setError(err instanceof ApiError ? err.message : t(before, "profileLanguageError"));
    } finally {
      setSavingLocale(false);
    }
  }

  /**
   * One page, four rooms. Everything used to arrive at once — identity,
   * sharing, memories, connections, and account deletion in a single column —
   * which made the page a wall rather than a place. Tabs hide nothing; they
   * decide what you are looking at now.
   */
  const [tab, setTab] = useState<ProfileTab>("you");
  /**
   * PROGRESSIVE DISCLOSURE, THE WAY THE WORLD DOES IT.
   *
   * This screen showed everything at once — name, language, a paragraph about
   * public pages, a handle, two checkboxes, another paragraph, and a delete
   * confirmation — so the two things anyone actually came to change were
   * buried among settings most people touch once and never again.
   *
   * The world never does this. The poster is one sentence until you press it;
   * the memory panel is a memory until you press `more`. Same grammar here:
   * what is true right now is visible, and everything else is one quiet word
   * away. Nothing is hidden that you cannot reach in a single press, and
   * nothing shouts that you did not ask about.
   */
  const [open, setOpen] = useState<"public" | "danger" | null>(null);
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

  /**
   * The keeper's standing keys (2026-08-29). A key is the way the person's
   * OWN tools — an MCP, a CLI — keep and recall without the login dance,
   * scoped server-side to exactly that. The secret exists in one response:
   * `mintedKey` holds it until the person says they have it, and nothing
   * here ever stores it anywhere else.
   */
  const [keeperKeys, setKeeperKeys] = useState<ApiKeeperKey[] | null>(null);
  const [mintedKey, setMintedKey] = useState<ApiMintedKeeperKey | null>(null);
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [mintingKey, setMintingKey] = useState(false);
  const [busyKeyId, setBusyKeyId] = useState<string | null>(null);

  const loadKeeperKeys = useCallback(async (): Promise<void> => {
    try {
      setKeeperKeys(await fetchKeeperKeys());
    } catch {
      setKeeperKeys([]);
      setError(t(locale, "profileKeysError"));
    }
  }, [locale]);

  useEffect(() => {
    void loadKeeperKeys();
  }, [loadKeeperKeys]);

  async function handleMintKey(): Promise<void> {
    setMintingKey(true);
    setStatus(null);
    setError(null);
    try {
      const minted = await createKeeperKey(newKeyLabel.trim() || undefined);
      setMintedKey(minted);
      setNewKeyLabel("");
      setKeeperKeys((current) => [
        { ...minted, lastUsedAt: null, revokedAt: null },
        ...(current ?? []),
      ]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileKeysError"));
    } finally {
      setMintingKey(false);
    }
  }

  async function handleRevokeKey(key: ApiKeeperKey): Promise<void> {
    if (!window.confirm(t(locale, "profileKeyRevokeConfirm"))) return;
    setBusyKeyId(key.id);
    setStatus(null);
    setError(null);
    try {
      await revokeKeeperKey(key.id);
      setKeeperKeys((current) => (current ?? []).filter((row) => row.id !== key.id));
      // Revoking the key whose secret is still on screen withdraws the
      // secret too — showing a credential that no longer opens anything
      // would be the screen lying.
      setMintedKey((current) => (current?.id === key.id ? null : current));
      setStatus(t(locale, "profileKeyRevoked"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileKeysError"));
    } finally {
      setBusyKeyId(null);
    }
  }

  /**
   * The rest of the account's doors (2026-08-29): every agent key in one
   * list, the sibling-read grants the canon promised "beside credentials",
   * and the read record — the reads those rules permit, actually happening.
   */
  const [agentKeys, setAgentKeys] = useState<ApiAgentKey[] | null>(null);
  const [busyAgentKeyId, setBusyAgentKeyId] = useState<string | null>(null);
  /** Reissue, for the forgotten key: a new secret for an EXISTING agent,
      right where the old keys are listed — recreation is never the answer. */
  const [reissueAgentId, setReissueAgentId] = useState("");
  const [reissuing, setReissuing] = useState(false);
  const [reissuedKey, setReissuedKey] = useState<ApiMintedKey | null>(null);
  const [grants, setGrants] = useState<ApiAgentGrant[] | null>(null);
  const [busyGrantId, setBusyGrantId] = useState<string | null>(null);
  const [grantReader, setGrantReader] = useState("");
  const [grantTarget, setGrantTarget] = useState("");
  const [givingGrant, setGivingGrant] = useState(false);
  const [readRecord, setReadRecord] = useState<ApiConsultation[] | null>(null);
  /**
   * FOLDED BY DEFAULT (founder, 2026-08-29: "leave only the necessary
   * ones"). The tab's daily work is memories, connections, and your own
   * keys; the audit surfaces — agent keys, grants, the read record — are
   * the screen's quiet corner, one word away, same grammar as "make a
   * public page". Nothing is removed; it is simply not shouting.
   */
  const [showDoors, setShowDoors] = useState(false);
  /** Connections and the read record: the tab's ACTIVITY, at the bottom,
      collapsed (founder, 2026-08-29) — consulted, not read every visit. */
  const [showActivity, setShowActivity] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setAgentKeys(await fetchAgentKeys());
      } catch {
        setAgentKeys([]);
      }
      try {
        setGrants(await fetchAgentGrants());
      } catch {
        setGrants([]);
        setError(t(locale, "profileGrantsError"));
      }
      try {
        setReadRecord(await fetchConsultations(8));
      } catch {
        setReadRecord([]);
        setError(t(locale, "profileReadRecordError"));
      }
    })();
  }, [locale]);

  /** A profile's name, for rows that carry only an id. */
  const memoryName = (id: string): string =>
    (memories ?? []).find((m) => m.id === id)?.name ?? t(locale, "profileReadRecordSomeone");

  const agentMemories = (memories ?? []).filter((m) => m.type === "agent");

  async function handleRevokeAgentKey(key: ApiAgentKey): Promise<void> {
    if (!window.confirm(t(locale, "profileKeyRevokeConfirm"))) return;
    setBusyAgentKeyId(key.id);
    setStatus(null);
    setError(null);
    try {
      await revokeAgentKey(key.id);
      setAgentKeys((current) => (current ?? []).filter((row) => row.id !== key.id));
      setStatus(t(locale, "profileKeyRevoked"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileKeysError"));
    } finally {
      setBusyAgentKeyId(null);
    }
  }

  async function handleReissueKey(): Promise<void> {
    if (!reissueAgentId) return;
    setReissuing(true);
    setStatus(null);
    setError(null);
    try {
      const minted = await createAgentKey(reissueAgentId);
      setReissuedKey(minted);
      setAgentKeys((current) => [
        { ...minted, lastUsedAt: null, revokedAt: null },
        ...(current ?? []),
      ]);
      setReissueAgentId("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileKeysError"));
    } finally {
      setReissuing(false);
    }
  }

  async function handleGiveGrant(): Promise<void> {
    if (!grantReader || !grantTarget || grantReader === grantTarget) return;
    setGivingGrant(true);
    setStatus(null);
    setError(null);
    try {
      const grant = await createAgentGrant(grantReader, grantTarget);
      setGrants((current) => {
        const rest = (current ?? []).filter((row) => row.id !== grant.id);
        return [...rest, grant];
      });
      setGrantReader("");
      setGrantTarget("");
      setStatus(t(locale, "profileGrantGiven"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileGrantsError"));
    } finally {
      setGivingGrant(false);
    }
  }

  async function handleRevokeGrant(grant: ApiAgentGrant): Promise<void> {
    // No confirm, deliberately: a revoked grant is restored by granting
    // again, so the way back exists and the door can close in one press.
    setBusyGrantId(grant.id);
    setStatus(null);
    setError(null);
    try {
      await revokeAgentGrant(grant.id);
      setGrants((current) => (current ?? []).filter((row) => row.id !== grant.id));
      setStatus(t(locale, "profileGrantRevoked"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t(locale, "profileGrantsError"));
    } finally {
      setBusyGrantId(null);
    }
  }

  const surfaceWord = (surface: ApiConsultation["surface"]): string =>
    t(
      locale,
      (
        {
          signals: "profileSurfaceSignals",
          top_of_mind: "profileSurfaceTopOfMind",
          principles: "profileSurfacePrinciples",
          weather: "profileSurfaceWeather",
          export: "profileSurfaceExport",
        } as const
      )[surface],
    );

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
            <span className="field-label">{t(locale, "profileLanguageLabel")}</span>
            <select
              className="field-input"
              name="preferredLocale"
              value={preferredLocale}
              disabled={submitting || deleting || savingLocale}
              aria-describedby="profile-language-hint"
              onChange={(event) =>
                void handleLocaleChange(event.currentTarget.value as SupportedLocale)
              }
            >
              {supportedLocales.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.nativeLabel}
                </option>
              ))}
            </select>
            <span id="profile-language-hint" className="field-hint">
              {t(locale, "profileLanguageHint")}
            </span>
          </label>
          {open !== "public" ? (
            <p className="profile-disclose">
              <button type="button" onClick={() => setOpen("public")}>
                {publicProfileEnabled
                  ? "your page is public — change it"
                  : "make a public page"}
              </button>
            </p>
          ) : null}
          <section
            className="profile-public-panel"
            aria-labelledby="profile-public-title"
            hidden={open !== "public"}
          >
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
            {mintedAgentKey ? null : (
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
            )}
          </ul>
          {mintedAgentKey ? (
            <div className="profile-minted">
              <p className="login-eyebrow">{t(locale, "profileKeyCopyNow")}</p>
              <p className="login-subtitle">
                {t(locale, "profileMemoryKeyFor")} {memoryName(mintedAgentKey.profileId)}.
              </p>
              <code className="profile-secret">{mintedAgentKey.secret}</code>
              <p className="login-subtitle">{t(locale, "profileKeyShownOnce")}</p>
              <p className="login-subtitle">{t(locale, "profileKeyConfigHint")}</p>
              <code className="profile-secret">
                {`WAKA_API_KEY=${mintedAgentKey.secret}\nWAKA_API_URL=${window.location.origin}`}
              </code>
              <button
                className="profile-memory-action"
                type="button"
                onClick={() => setMintedAgentKey(null)}
              >
                {t(locale, "profileKeyHaveIt")}
              </button>
            </div>
          ) : null}
        </section>
        <section className="profile-memories-panel" aria-labelledby="profile-keys-title">
          <div className="profile-memories-heading">
            <p className="login-eyebrow" id="profile-keys-title">
              {t(locale, "profileKeysTitle")}
            </p>
            <p className="login-subtitle">{t(locale, "profileKeysHint")}</p>
          </div>

          <ul className="profile-list">
            {/* Live keys only. A revoked key opens nothing and names nothing
                current — it is history, and history's place is the audit
                trail, not the list of what can act. */}
            {(keeperKeys ?? [])
              .filter((key) => key.revokedAt === null)
              .map((key) => {
                const busy = busyKeyId === key.id;
                return (
                  <li key={key.id} className="profile-list-row profile-connection-row">
                    <div className="profile-row-main">
                      <span className="profile-row-title">
                        {key.label ?? t(locale, "profileKeyUnlabelled")}
                      </span>
                      <span className="profile-row-meta">
                        {key.prefix}… · {t(locale, "profileKeyMintedOn")} {whenShort(key.createdAt)} ·{" "}
                        {key.lastUsedAt
                          ? `${t(locale, "profileKeyLastUsed")} ${whenShort(key.lastUsedAt)}`
                          : t(locale, "profileKeyNeverUsed")}
                      </span>
                    </div>
                    <span className="profile-row-actions">
                      <button
                        className="profile-memory-action is-destructive"
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRevokeKey(key)}
                      >
                        {busy ? t(locale, "profileKeyRevoking") : t(locale, "profileKeyRevoke")}
                      </button>
                    </span>
                  </li>
                );
              })}
          </ul>
          {keeperKeys !== null && keeperKeys.every((key) => key.revokedAt !== null) ? (
            <p className="login-subtitle">{t(locale, "profileKeysEmpty")}</p>
          ) : null}

          {mintedKey ? (
            /* The secret's one appearance. The mint control stays hidden
               until the person says they have it — two uncopied secrets on
               one screen is one too many. */
            <div className="profile-minted">
              <p className="login-eyebrow">{t(locale, "profileKeyCopyNow")}</p>
              <code className="profile-secret">{mintedKey.secret}</code>
              <p className="login-subtitle">{t(locale, "profileKeyShownOnce")}</p>
              <p className="login-subtitle">{t(locale, "profileKeyConfigHint")}</p>
              <code className="profile-secret">
                {`WAKA_API_KEY=${mintedKey.secret}\nWAKA_API_URL=${window.location.origin}`}
              </code>
              <button
                className="profile-memory-action"
                type="button"
                onClick={() => setMintedKey(null)}
              >
                {t(locale, "profileKeyHaveIt")}
              </button>
            </div>
          ) : (
            <ul className="profile-list">
              <li className="profile-list-row profile-memory-new">
                <input
                  className="profile-row-name"
                  type="text"
                  value={newKeyLabel}
                  placeholder={t(locale, "profileKeyNewLabel")}
                  disabled={mintingKey}
                  onChange={(event) => setNewKeyLabel(event.currentTarget.value)}
                />
                <span className="profile-row-actions">
                  <button
                    className="profile-memory-action profile-memory-create"
                    type="button"
                    disabled={mintingKey}
                    onClick={() => void handleMintKey()}
                  >
                    {mintingKey ? t(locale, "profileKeyMinting") : t(locale, "profileKeyMint")}
                  </button>
                </span>
              </li>
            </ul>
          )}
        </section>
        {!showDoors ? (
          <p className="profile-disclose">
            <button type="button" onClick={() => setShowDoors(true)}>
              {t(locale, "profileMoreAccess")}
            </button>
          </p>
        ) : (
          <>
        <section className="profile-memories-panel" aria-labelledby="profile-agent-keys-title">
          <div className="profile-memories-heading">
            <p className="login-eyebrow" id="profile-agent-keys-title">
              {t(locale, "profileAgentKeysTitle")}
            </p>
            <p className="login-subtitle">{t(locale, "profileAgentKeysHint")}</p>
          </div>

          <ul className="profile-list">
            {(agentKeys ?? [])
              .filter((key) => key.revokedAt === null)
              .map((key) => {
                const busy = busyAgentKeyId === key.id;
                return (
                  <li key={key.id} className="profile-list-row profile-connection-row">
                    <div className="profile-row-main">
                      <span className="profile-row-title">{memoryName(key.profileId)}</span>
                      <span className="profile-row-meta">
                        {key.label ? `${key.label} · ` : ""}
                        {key.prefix}… · {t(locale, "profileKeyMintedOn")} {whenShort(key.createdAt)} ·{" "}
                        {key.lastUsedAt
                          ? `${t(locale, "profileKeyLastUsed")} ${whenShort(key.lastUsedAt)}`
                          : t(locale, "profileKeyNeverUsed")}
                      </span>
                    </div>
                    <span className="profile-row-actions">
                      <button
                        className="profile-memory-action is-destructive"
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRevokeAgentKey(key)}
                      >
                        {busy ? t(locale, "profileKeyRevoking") : t(locale, "profileKeyRevoke")}
                      </button>
                    </span>
                  </li>
                );
              })}
          </ul>
          {agentKeys !== null && agentKeys.every((key) => key.revokedAt !== null) ? (
            <p className="login-subtitle">{t(locale, "profileAgentKeysEmpty")}</p>
          ) : null}

          {reissuedKey ? (
            <div className="profile-minted">
              <p className="login-eyebrow">{t(locale, "profileKeyCopyNow")}</p>
              <p className="login-subtitle">
                {t(locale, "profileMemoryKeyFor")} {memoryName(reissuedKey.profileId)}.
              </p>
              <code className="profile-secret">{reissuedKey.secret}</code>
              <p className="login-subtitle">{t(locale, "profileKeyShownOnce")}</p>
              <p className="login-subtitle">{t(locale, "profileKeyConfigHint")}</p>
              <code className="profile-secret">
                {`WAKA_API_KEY=${reissuedKey.secret}\nWAKA_API_URL=${window.location.origin}`}
              </code>
              <button
                className="profile-memory-action"
                type="button"
                onClick={() => setReissuedKey(null)}
              >
                {t(locale, "profileKeyHaveIt")}
              </button>
            </div>
          ) : agentMemories.length > 0 ? (
            <ul className="profile-list">
              <li className="profile-list-row profile-memory-new">
                <select
                  className="profile-row-name"
                  value={reissueAgentId}
                  aria-label={t(locale, "profileAgentKeyWhich")}
                  disabled={reissuing}
                  onChange={(event) => setReissueAgentId(event.currentTarget.value)}
                >
                  <option value="">{t(locale, "profileAgentKeyWhich")}</option>
                  {agentMemories.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <span className="profile-row-actions">
                  {reissueAgentId ? (
                    <button
                      className="profile-memory-action profile-memory-create"
                      type="button"
                      disabled={reissuing}
                      onClick={() => void handleReissueKey()}
                    >
                      {reissuing
                        ? t(locale, "profileAgentKeyIssuing")
                        : t(locale, "profileAgentKeyIssue")}
                    </button>
                  ) : null}
                </span>
              </li>
            </ul>
          ) : null}
        </section>
        <section className="profile-memories-panel" aria-labelledby="profile-grants-title">
          <div className="profile-memories-heading">
            <p className="login-eyebrow" id="profile-grants-title">
              {t(locale, "profileGrantsTitle")}
            </p>
            <p className="login-subtitle">{t(locale, "profileGrantsHint")}</p>
          </div>

          <ul className="profile-list">
            {(grants ?? [])
              .filter((grant) => grant.revokedAt === null)
              .map((grant) => {
                const busy = busyGrantId === grant.id;
                return (
                  <li key={grant.id} className="profile-list-row profile-connection-row">
                    <div className="profile-row-main">
                      <span className="profile-row-title">
                        {memoryName(grant.granteeProfileId)} {t(locale, "profileGrantReads")}{" "}
                        {memoryName(grant.targetProfileId)}
                      </span>
                      <span className="profile-row-meta">
                        {t(locale, "profileGrantGrantedOn")} {whenShort(grant.createdAt)}
                      </span>
                    </div>
                    <span className="profile-row-actions">
                      <button
                        className="profile-memory-action is-destructive"
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRevokeGrant(grant)}
                      >
                        {busy
                          ? t(locale, "profileGrantRevoking")
                          : t(locale, "profileGrantRevoke")}
                      </button>
                    </span>
                  </li>
                );
              })}
          </ul>
          {grants !== null &&
          grants.every((grant) => grant.revokedAt !== null) &&
          agentMemories.length >= 2 ? (
            <p className="login-subtitle">{t(locale, "profileGrantsEmpty")}</p>
          ) : null}

          {agentMemories.length < 2 ? (
            <p className="login-subtitle">{t(locale, "profileGrantsNeedTwo")}</p>
          ) : (
            <ul className="profile-list">
              <li className="profile-list-row profile-memory-new">
                <select
                  className="profile-row-name"
                  value={grantReader}
                  aria-label={t(locale, "profileGrantReader")}
                  disabled={givingGrant}
                  onChange={(event) => setGrantReader(event.currentTarget.value)}
                >
                  <option value="">{t(locale, "profileGrantReader")}</option>
                  {agentMemories.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                <select
                  className="profile-row-name"
                  value={grantTarget}
                  aria-label={t(locale, "profileGrantTarget")}
                  disabled={givingGrant}
                  onChange={(event) => setGrantTarget(event.currentTarget.value)}
                >
                  <option value="">{t(locale, "profileGrantTarget")}</option>
                  {agentMemories
                    .filter((m) => m.id !== grantReader)
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
                <span className="profile-row-actions">
                  {grantReader && grantTarget ? (
                    <button
                      className="profile-memory-action profile-memory-create"
                      type="button"
                      disabled={givingGrant}
                      onClick={() => void handleGiveGrant()}
                    >
                      {givingGrant
                        ? t(locale, "profileGrantGiving")
                        : t(locale, "profileGrantGive")}
                    </button>
                  ) : null}
                </span>
              </li>
            </ul>
          )}
        </section>
          </>
        )}
        {!showActivity ? (
          <p className="profile-disclose">
            <button type="button" onClick={() => setShowActivity(true)}>
              {t(locale, "profileMoreActivity")}
            </button>
          </p>
        ) : (
          <>
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
        <section className="profile-memories-panel" aria-labelledby="profile-read-record-title">
          <div className="profile-memories-heading">
            <p className="login-eyebrow" id="profile-read-record-title">
              {t(locale, "profileReadRecordTitle")}
            </p>
            <p className="login-subtitle">{t(locale, "profileReadRecordHint")}</p>
          </div>

          <ul className="profile-list">
            {(readRecord ?? []).map((row) => (
              <li key={row.id} className="profile-list-row profile-connection-row">
                <div className="profile-row-main">
                  <span className="profile-row-title">
                    {row.reader?.name ?? t(locale, "profileReadRecordSomeone")}{" "}
                    {t(locale, "profileReadRecordRead")} {row.profile.name}
                    {t(locale, "profileReadRecordOwnSuffix")} {surfaceWord(row.surface)}
                  </span>
                  <span className="profile-row-meta">{whenShort(row.servedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
          {readRecord !== null && readRecord.length === 0 ? (
            <p className="login-subtitle">{t(locale, "profileReadRecordEmpty")}</p>
          ) : null}
        </section>
          </>
        )}
        </div>

        <section
          className="profile-danger-panel profile-panel"
          aria-labelledby="profile-danger-title"
          /* both gates in one attribute: the tab it lives on, and the word
             that reveals it */
          hidden={tab !== "you" || open !== "danger"}
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
        {/* ONE PLACE FOR THINGS YOU CAN DO, ORDERED BY CONSEQUENCE.
            These were scattered — sign out top-right, delete mid-page, back
            home centred underneath — so there was no way to learn where an
            action lives. Everything that LEAVES or DESTROYS is one row at the
            foot, harmless first and irreversible last, which is both the
            consistency heuristic and simple proximity. `save` stays with the
            form it saves, because that is the one action that belongs to the
            fields rather than to the account. */}
        <div className="profile-foot">
        <p className="login-footer">
          <Link className="login-link" to="/">{t(locale, "profileBackHome")}</Link>
        </p>
          {tab === "you" && open !== "danger" ? (
            <button
              type="button"
              className="profile-disclose-inline"
              onClick={() => setOpen("danger")}
            >
              delete this account
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
