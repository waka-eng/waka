import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { publicWebOrigin, publicApiOrigin } from '../lib/public-origins';

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
  fetchSignalDuplicates,
  fetchTheReading,
  fetchTheWeather,
  renameProfile,
  resolveSignalDuplicate,
  restoreSignal,
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
  type ApiAntechamberRow,
  type ApiReading,
  type ApiSignalDuplicate,
} from "../lib/api";
import { AntechamberPanel } from "../components/AntechamberPanel";
import { Menu } from "../components/Menu";
import { usePageMenu } from "../lib/page-menu";
import { useAgent } from "../lib/use-agent";
import { HoverCard } from "../components/HoverCard";
import { DuplicatesPanel } from "../components/DuplicatesPanel";
import { ReadingPanel } from "../components/ReadingPanel";
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
  const agent = useAgent();
  const menu = usePageMenu(normalizeSupportedLocale(profile?.preferredLocale), account?.id, agent);
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
  /**
   * WHAT IT READS YOU BY, WHAT IT REFUSED, AND WHAT IT THINKS IS DOUBLED.
   *
   * These three opened from a sheet behind the gear on the home screen — the
   * same gear that navigated here from every other page. One corner cannot
   * mean two things, so the gear navigates now, and these came to where it
   * navigates to. They were never settings, but they are the right kind of
   * thing for the page settings lives on: facts about the machinery, for the
   * person who wants to look at it, nowhere near the screen you keep things
   * on.
   *
   * The reading is fetched once and held — the rules do not change under a
   * person mid-visit. The other two are fetched on every open, because
   * refusals and duplicate asks accrue while the panel is closed and a stale
   * list would claim the ground refused less than it has.
   */
  const [readingOpen, setReadingOpen] = useState(false);
  const [theReading, setTheReading] = useState<ApiReading | null>(null);
  const [antechamberOpen, setAntechamberOpen] = useState(false);
  const [antechamber, setAntechamber] = useState<ApiAntechamberRow[] | null>(null);
  const [restoredAnchors, setRestoredAnchors] = useState<ReadonlySet<string>>(() => new Set());
  const [duplicatesOpen, setDuplicatesOpen] = useState(false);
  const [duplicates, setDuplicates] = useState<ApiSignalDuplicate[] | null>(null);
  const [resolvedDuplicates, setResolvedDuplicates] = useState<ReadonlySet<string>>(() => new Set());
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
      ? `${publicWebOrigin()}/@${normalizedPublicHandle}`
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
    /**
     * SETTINGS WEARS THE PRODUCT'S OWN CLOTHES NOW.
     *
     * Founder, pointing at the gear: "doesn't look like settings." Half of
     * that was the glyph, which became a cog. The other half was here: this
     * page was built on `login-shell` and `login-card` — the SIGN-IN page's
     * language, a centred card with an eyebrow and a title, which is right
     * for a door and wrong for the room behind it. Nothing about it said you
     * were still inside the product.
     *
     * It is a `waka-page` like the archive and the principles, and it carries
     * the same chrome as every other screen — which also fixes the thing
     * nobody had reported: the cog brought you here and there was no way back
     * except the browser's own button. The switcher names the page, so the
     * card's eyebrow and title are gone rather than repeated.
     *
     * AND THE NAMES SAY SO NOW, which that pass did not finish. Looking the
     * same was the visible half; the markup still said `login-` thirty-nine
     * times — `login-eyebrow` twelve, `login-subtitle` twenty-four,
     * `login-form`, `login-footer`, `login-link` — so every rule dressing
     * this page had to be written as "the sign-in page's eyebrow, except on
     * the profile page", and four of them literally were
     * (`.profile-public-heading > .login-eyebrow` and its siblings). A name
     * borrowed from another screen does not stay a harmless alias: it makes
     * every later rule about THIS screen an exception to that one, and the
     * exceptions are where the two screens drift apart.
     *
     * So the five are `profile-eyebrow`, `-subtitle`, `-form`, `-footer`,
     * `-link`. The door keeps its own names and its own rules; where a rule
     * genuinely dresses both, both names are on it, which is the honest way
     * to say "these two screens agree here" instead of one wearing the
     * other's clothes.
     */
    <main className="waka-page profile-page">
      {/* THE WAY OUT, WHICH HAD NEVER WORKED HERE. The cog on every screen
          navigates to this page, and `Menu`'s one-press exit — the control
          the founder asked for three times, "one click to go back to top of
          mind" — looked its row up by a string suffix that no row had
          carried since the switcher became a list of owners. So the chevron
          at the top of the settings page rendered, read "Your top of mind",
          and did nothing, which is worse than no control at all: it answers
          the question and then does not. It presses `items[0]` now, and
          `test/page-exit.test.tsx` presses it from this page for real.
          The foot of the page keeps its own `Back home` link as well, and
          that is not a duplicate worth removing: this page is long enough
          that somebody at the bottom of it should not have to travel back to
          the chrome to leave. */}
      <Menu
        locale={locale}
        items={menu.items}
        current={menu.current}
        label="profileTitle"
        onSettings={() => navigate("/profile")}
      />
      <section className="profile-card" aria-labelledby="profile-title">
        <header className="profile-header">
          <div>
            <h1 id="profile-title" className="sr-only">
              {t(locale, "profileTitle")}
            </h1>
            <p className="profile-email">{account?.email}</p>
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
          className="profile-form profile-panel"
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
              aria-invalid={!trimmedDisplayName || undefined}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            {/* NO HINT. It said "This is how WAKA addresses and shows you.
                Spaces are okay." — the first half restates the label
                "Display name", and the second half prints the ABSENCE of a
                constraint, which is the purest form of Law 4: a person who
                has not tried to type a space is being told about a rule that
                does not exist. Founder, pointing at "Enter to keep": "remove
                things not 100% necessary." */}
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
              {/* TWO ENGLISH SENTENCES WERE WRITTEN STRAIGHT INTO THIS FILE,
                  and one of them was not a control's name.
                  "your page is public — change it" is a STATE and an ACT
                  crammed into one label, which is Law 1 both ways round: read
                  aloud, it is a status line you cannot predict the effect of
                  pressing. The act is all a control may say. Whether the page
                  is already public is answered by the panel the press opens —
                  the checkbox and the live URL are both in there — rather
                  than by a button narrating itself.
                  They were also the only two strings on this page not in the
                  catalogue, so the Korean settings page said them in English
                  and nothing anywhere could notice. */}
              <button type="button" onClick={() => setOpen("public")}>
                {t(locale, publicProfileEnabled ? "profilePublicChange" : "profilePublicMake")}
              </button>
            </p>
          ) : null}
          <section
            className="profile-public-panel"
            aria-labelledby="profile-public-title"
            hidden={open !== "public"}
          >
            <div className="profile-public-heading">
              <p className="profile-eyebrow" id="profile-public-title">
                {t(locale, "profilePublicTitle")}
              </p>
              <p className="profile-subtitle">{t(locale, "profilePublicHint")}</p>
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
                  aria-describedby={handleError ? "profile-public-handle-hint" : undefined}
                  aria-invalid={handleError ? true : undefined}
                  onChange={(event) => setPublicHandle(event.currentTarget.value)}
                />
              </div>
              {/* THE RULE ARRIVES WHEN IT IS BROKEN, AND NOT BEFORE.
                  This slot printed `profilePublicHandleHint` at rest —
                  "Used only for your public URL, like waka.im/@your-handle.
                  Use 3–24 letters, numbers, hyphens, or underscores; no
                  spaces." Its first sentence is the panel's own subtitle two
                  elements up, and its second is `profilePublicHandleInvalid`
                  verbatim, which is what appears the moment the handle is
                  actually wrong. So the page said the same thing three times
                  and one of them was a specification to memorise before
                  typing. Founder: "so crowded!" */}
              {handleError ? (
                <span id="profile-public-handle-hint" className="field-error">
                  {handleError}
                </span>
              ) : null}
            </label>
            {/* WHAT SHARING ACTUALLY SHARES — said ONCE, and pointed at.
                Each of these two checkboxes carried an `sr-only` span
                repeating a paragraph that is already on this screen: the
                first repeated the privacy paragraph directly above it, the
                second repeated the panel's own subtitle. So a person using a
                screen reader heard the same disclosure three times in one
                panel while a sighted person read it once. Law 4 names this
                case exactly — "aria-labels that duplicate visible text".
                The association is what was worth keeping, not the copy, so
                both boxes now describe themselves with the VISIBLE paragraph
                and the clones are gone. */}
            <p className="profile-subtitle" id="profile-public-privacy">
              {t(locale, "profilePublicPrivacyHint")}
            </p>
            <label className="profile-toggle-row">
              <input
                type="checkbox"
                checked={publicProfileEnabled}
                disabled={submitting || deleting}
                aria-describedby="profile-public-privacy"
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setPublicProfileEnabled(checked);
                  if (!checked) setPublicTopOfMindEnabled(false);
                }}
              />
              <span>{t(locale, "profilePublicEnabled")}</span>
            </label>
            <label className="profile-toggle-row">
              <input
                type="checkbox"
                checked={publicTopOfMindEnabled}
                disabled={submitting || deleting || !publicProfileEnabled}
                aria-describedby="profile-public-privacy"
                onChange={(event) => setPublicTopOfMindEnabled(event.currentTarget.checked)}
              />
              <span>{t(locale, "profilePublicTopOfMindEnabled")}</span>
            </label>
            {publicProfileUrl ? (
              /* IT OPENS BESIDE THE SETTINGS PAGE, NOT INSTEAD OF IT.
                 This was a plain in-app link, so pressing it unmounted
                 settings and landed the owner on their own public page —
                 which has no chrome, no switcher and no cog, because it is
                 built for strangers. The only control there says "Open WAKA"
                 and goes to the world. So the owner checking their public
                 page lost the page they were configuring and could not get
                 back to it in one press: Law 2's own example, "reaching it
                 unmounted the world".
                 A new tab is the one fix that leaves nothing to go back TO,
                 because settings never left. And because a tab opening is a
                 side effect a link must declare — Law 1 — the control says so
                 instead of printing the URL. The URL was the label before,
                 which named a destination and hid the act; it is still the
                 href, which is where a URL belongs. */
              <a
                className="profile-public-link"
                href={`/@${normalizedPublicHandle}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t(locale, "profilePublicOpenInNewTab")}
              </a>
            ) : null}
          </section>
          <button className="btn-primary" type="submit" disabled={submitting || deleting}>
            {submitting ? t(locale, "profileSaving") : t(locale, "profileSave")}
          </button>
        </form>

        {/* THE MACHINERY, FOR WHOEVER WANTS TO LOOK AT IT.
            Three doors that used to be behind the gear on the home screen,
            in a sheet only that screen had. They are not settings and they
            are not part of the loop; they are how you check what the product
            is doing on your behalf, which is a thing to find on the page
            about your account rather than on the page you keep things on. */}
        <section
          className="profile-memories-panel"
          aria-labelledby="profile-machinery-title"
          hidden={tab !== "you"}
        >
          <div className="profile-memories-heading">
            <p className="profile-eyebrow" id="profile-machinery-title">
              {t(locale, "profileMachineryTitle")}
            </p>
            <p className="profile-subtitle">{t(locale, "profileMachineryHint")}</p>
          </div>

          {/* ═══ THE FOUR PARAGRAPHS ARE GONE ════════════════════════
              Founder, with this page on screen: "this is so ugly too."

              What stood here was a definition list — inspirations, top of
              mind, principles, each with a sentence — and a fifth paragraph
              under it about what the loop promises. Four hundred-odd words
              of prose explaining the data model, on the page somebody opens
              to change their name.

              IT WAS RE-HOMED HERE RATHER THAN DELETED once already, under
              "most things I want to find a new home in the experience rather
              than completely removed", and that was the right instinct
              applied to the wrong content. Re-homing is for things a person
              goes looking for. Nobody has ever gone looking for a
              description of three layers; it is read once by whoever is new
              and stepped over forever after by everybody — which is the rule
              that cleared the permanent explainers off the archive, the
              principles, the claims and the chat.

              WHAT STAYS IS THE PART THAT IS CHECKABLE. The three doors below
              do not describe the machinery, they SHOW it: what it reads you
              by, what it set aside, what it thinks it is hearing twice. That
              is this product's actual promise — that its account of you can
              be inspected — and it is worth a section heading. A paragraph
              saying "patterns shape a reading" is not. */}
          <p className="profile-machinery-row">
            <button
              type="button"
              onClick={() => {
                setReadingOpen(true);
                /* fetched once and held — the rules do not change mid-visit */
                if (!theReading) fetchTheReading().then(setTheReading).catch(() => undefined);
              }}
            >
              {t(locale, "worldHowItReadsYou")}
            </button>
            <button
              type="button"
              onClick={() => {
                setAntechamberOpen(true);
                setAntechamber(null);
                fetchTheWeather()
                  .then((weather) => setAntechamber(weather.antechamber))
                  .catch(() => setAntechamber([]));
              }}
            >
              {t(locale, "worldTheAntechamber")}
            </button>
            <button
              type="button"
              onClick={() => {
                setDuplicatesOpen(true);
                setDuplicates(null);
                fetchSignalDuplicates().then(setDuplicates).catch(() => setDuplicates([]));
              }}
            >
              {t(locale, "worldGardenerAsks")}
            </button>
          </p>
        </section>

        {readingOpen ? (
          <ReadingPanel reading={theReading} onClose={() => setReadingOpen(false)} />
        ) : null}

        {antechamberOpen ? (
          <AntechamberPanel
            rows={antechamber}
            onClose={() => setAntechamberOpen(false)}
            /* Answer in the same beat rather than waiting for a refetch; the
               row only comes back if the server refused. */
            onRestoreAnchor={(anchorSignalId) => {
              setRestoredAnchors((prev) => new Set(prev).add(anchorSignalId));
              restoreSignal(anchorSignalId).catch(() => {
                setRestoredAnchors((prev) => {
                  const next = new Set(prev);
                  next.delete(anchorSignalId);
                  return next;
                });
              });
            }}
            restoredAnchorIds={restoredAnchors}
          />
        ) : null}

        {duplicatesOpen ? (
          <DuplicatesPanel
            rows={duplicates}
            onClose={() => setDuplicatesOpen(false)}
            onResolve={(duplicateId, act) => {
              setResolvedDuplicates((prev) => new Set(prev).add(duplicateId));
              resolveSignalDuplicate(duplicateId, act).catch(() => {
                setResolvedDuplicates((prev) => {
                  const next = new Set(prev);
                  next.delete(duplicateId);
                  return next;
                });
              });
            }}
            resolvedIds={resolvedDuplicates}
          />
        ) : null}
        <div
          className="profile-panel profile-room"
          role="tabpanel"
          id="profile-panel-access"
          aria-labelledby="profile-tab-access"
          hidden={tab !== "access"}
        >
        <section className="profile-memories-panel" aria-labelledby="profile-memories-title">
          <div className="profile-memories-heading">
            <p className="profile-eyebrow" id="profile-memories-title">
              {t(locale, "profileMemoriesTitle")}
            </p>
            <p className="profile-subtitle">{t(locale, "profileMemoriesHint")}</p>
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
                    /* THE LABEL NAMES THE FIELD, NOT THE VALUE IN IT. This
                       was `aria-label={memory.name}` — the field's own
                       contents announced as the field's name, so a screen
                       reader said "claude, edit text, claude", and it said
                       the SERVER's name while the box held an unsaved draft.
                       Law 4: do not say what the person can already read.
                       `profileMemoryRename` is what this box is for, and it
                       is the word on the control that commits it. */
                    aria-label={t(locale, "profileMemoryRename")}
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
              <p className="profile-eyebrow">{t(locale, "profileKeyCopyNow")}</p>
              <p className="profile-subtitle">
                {t(locale, "profileMemoryKeyFor")} {memoryName(mintedAgentKey.profileId)}.
              </p>
              <code className="profile-secret">{mintedAgentKey.secret}</code>
              <p className="profile-subtitle">{t(locale, "profileKeyShownOnce")}</p>
              <p className="profile-subtitle">{t(locale, "profileKeyConfigHint")}</p>
              <code className="profile-secret">
                {`WAKA_API_KEY=${mintedAgentKey.secret}\nWAKA_API_URL=${publicApiOrigin()}`}
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
            <p className="profile-eyebrow" id="profile-keys-title">
              {t(locale, "profileKeysTitle")}
            </p>
            <p className="profile-subtitle">{t(locale, "profileKeysHint")}</p>
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
            <p className="profile-subtitle">{t(locale, "profileKeysEmpty")}</p>
          ) : null}

          {mintedKey ? (
            /* The secret's one appearance. The mint control stays hidden
               until the person says they have it — two uncopied secrets on
               one screen is one too many. */
            <div className="profile-minted">
              <p className="profile-eyebrow">{t(locale, "profileKeyCopyNow")}</p>
              <code className="profile-secret">{mintedKey.secret}</code>
              <p className="profile-subtitle">{t(locale, "profileKeyShownOnce")}</p>
              <p className="profile-subtitle">{t(locale, "profileKeyConfigHint")}</p>
              <code className="profile-secret">
                {`WAKA_API_KEY=${mintedKey.secret}\nWAKA_API_URL=${publicApiOrigin()}`}
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
            <p className="profile-eyebrow" id="profile-agent-keys-title">
              {t(locale, "profileAgentKeysTitle")}
            </p>
            <p className="profile-subtitle">{t(locale, "profileAgentKeysHint")}</p>
            {/* HOW AN AGENT ACTUALLY SAVES, BESIDE THE KEYS IT NEEDS TO.
                This line stood under the box on the home screen, where it was
                a setup instruction printed beneath the thing you use every
                day. Connecting an agent is a once-ever act and the keys for
                it are in this section, so it reads here and takes up no room
                on the screen the product opens on. */}
            <p className="profile-machinery-row">
              {/* ONE PARAGRAPH, NOT THREE SENTENCES IN THREE SPANS. Founder:
                  "for the text that shows up when I click the info icon, make
                  it a single paragraph. Don't split it into separate
                  sentences."

                  That was ruled on the switcher's three cards and applied
                  only there — `page-menu.ts` carries the same note — while
                  this card, the last `HoverCard` left anywhere in the tree,
                  went on stacking `worldKeepMcpWhat`, `-Tools` and `-Where`
                  as siblings. Three stacked clauses read as a specification
                  to retain when the question was only "what is this", and
                  the `gap` between the spans made them look like three
                  settings rather than one explanation.

                  It is ONE KEY, not three joined at the call site: joining
                  them here would still be three sentences, just without the
                  line breaks, and the Korean cannot be assembled from
                  English-ordered fragments at all. `worldFieldWhatIs` and
                  `worldPrinciplesWhatIs` are each a single flowing sentence
                  for exactly this reason, and this now matches them.
                  The link below stays its own element — it is a destination,
                  not a clause. */}
              <HoverCard label={t(locale, "worldKeepViaAgent")} className="jar-keep-via">
                <span>{t(locale, "worldKeepMcpWhatIs")}</span>
                <a href="https://github.com/waka-eng/waka-mcp" target="_blank" rel="noreferrer noopener">
                  {t(locale, "worldKeepMcpOpen")}
                </a>
              </HoverCard>
            </p>
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
            <p className="profile-subtitle">{t(locale, "profileAgentKeysEmpty")}</p>
          ) : null}

          {reissuedKey ? (
            <div className="profile-minted">
              <p className="profile-eyebrow">{t(locale, "profileKeyCopyNow")}</p>
              <p className="profile-subtitle">
                {t(locale, "profileMemoryKeyFor")} {memoryName(reissuedKey.profileId)}.
              </p>
              <code className="profile-secret">{reissuedKey.secret}</code>
              <p className="profile-subtitle">{t(locale, "profileKeyShownOnce")}</p>
              <p className="profile-subtitle">{t(locale, "profileKeyConfigHint")}</p>
              <code className="profile-secret">
                {`WAKA_API_KEY=${reissuedKey.secret}\nWAKA_API_URL=${publicApiOrigin()}`}
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
            <p className="profile-eyebrow" id="profile-grants-title">
              {t(locale, "profileGrantsTitle")}
            </p>
            <p className="profile-subtitle">{t(locale, "profileGrantsHint")}</p>
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
            <p className="profile-subtitle">{t(locale, "profileGrantsEmpty")}</p>
          ) : null}

          {agentMemories.length < 2 ? (
            <p className="profile-subtitle">{t(locale, "profileGrantsNeedTwo")}</p>
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
            <p className="profile-eyebrow" id="profile-connections-title">
              {t(locale, "profileConnectionsTitle")}
            </p>
            <p className="profile-subtitle">{t(locale, "profileConnectionsHint")}</p>
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
            <p className="profile-subtitle">{t(locale, "profileConnectionsEmpty")}</p>
          ) : null}
        </section>
        <section className="profile-memories-panel" aria-labelledby="profile-read-record-title">
          <div className="profile-memories-heading">
            <p className="profile-eyebrow" id="profile-read-record-title">
              {t(locale, "profileReadRecordTitle")}
            </p>
            <p className="profile-subtitle">{t(locale, "profileReadRecordHint")}</p>
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
            <p className="profile-subtitle">{t(locale, "profileReadRecordEmpty")}</p>
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
            <p className="profile-eyebrow" id="profile-danger-title">
              {t(locale, "profileDangerZone")}
            </p>
            {/* The consequence, said where it is visible, and referenced by
                both controls below rather than cloned into an `sr-only` span
                that said it a second time. */}
            <p className="profile-subtitle" id="profile-delete-description">
              {t(locale, "profileDeleteHint")}
            </p>
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
        <p className="profile-footer">
          <Link className="profile-link" to="/">{t(locale, "profileBackHome")}</Link>
        </p>
          {tab === "you" && open !== "danger" ? (
            /* NAMED FOR WHAT IT REVEALS, NOT FOR WHAT IT WOULD DO. This read
               "delete this account" — hardcoded English, and a lie: it opens
               a confirmation, it does not delete anything. Two controls on
               one page both reading "Delete account", one of which deletes,
               is the exact shape of "so many different buttons that I have no
               idea what its supposed to do". The two folds above it already
               name their contents the same quiet way ("keys your agents hold
               & grants"), so this one does too. */
            <button
              type="button"
              className="profile-disclose-inline"
              onClick={() => setOpen("danger")}
            >
              {t(locale, "profileDeleteSection")}
            </button>
          ) : null}
        </div>
      </section>
    </main>
  );
}
