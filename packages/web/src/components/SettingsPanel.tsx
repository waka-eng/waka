/**
 * Settings stays behind the gear. Its sections now replace the overview
 * within one fixed-size frame, with Back returning to the overview.
 *
 * Founder: "I don't like this 'all settings' because it's first skewed
 * towards the left, and it says 'your top of mind'. I want all
 * setting-related stuff to be only accessible through the drop down and
 * not be its own thing. Also look at what's under You and what's under
 * Memories & connections and remove anything that is not absolutely
 * necessary."
 *
 * Two instructions: ONE DOOR, and a prune. This is both.
 *
 * ── WHY THE PAGE WAS WRONG BEFORE IT WAS UGLY ────────────────────────────
 *
 * `/profile` rendered inside the world's layout, so it inherited the
 * corner switcher and the chevron that says "YOUR TOP OF MIND" — a page
 * about your account, wearing the furniture of a page about your material,
 * with its own column hard against the left edge while the thing it was
 * nested in centres. The founder read both symptoms in one glance. Neither
 * is fixable by moving the column: a settings page is not a destination in
 * a product whose destinations are what you kept, what it is thinking, and
 * what has endured.
 *
 * ── WHAT WAS REMOVED, AND WHY EACH ──────────────────────────────────────
 *
 * The page had eleven sections. Five are gone, and they are listed here
 * rather than in a commit nobody reads, because removing a feature's only
 * door is the kind of decision that should stay arguable:
 *
 *   KEYS and AGENT KEYS — tables of API credentials with mint, copy and
 *   revoke. A developer surface on a consumer product's settings screen.
 *   `createAgentKey` NO LONGER RUNS either — see the note where it used to
 *   be called. The UI for reading and revoking went first, which left a
 *   credential nobody could hold, see or revoke; the minting followed.
 *
 *   WHAT AGENTS MAY READ — grants, which govern the keys above. With no
 *   key listing there is nothing to grant against.
 *
 *   CONNECTIONS and THE READ RECORD — who you are connected to and who has
 *   read you. Both are about people-to-people reading, and the product has
 *   no people-to-people surface since rooms were removed. A control for a
 *   model the product no longer has teaches that model.
 *   Device sessions are now exposed separately below for MCP setup and
 *   disconnect; this does not restore people-to-people connections.
 *
 *   HOW WAKA WORKS — three doors onto the machinery (how it reads you, the
 *   antechamber, the gardener's asks). These are the one removal worth
 *   arguing with: they SHOW what the product is doing on your behalf,
 *   which is its actual promise. They are not settings, though, and they
 *   were on that page because "a gear was the nearest unlocked door". They
 *   want a home next to the top of mind rather than next to a language
 *   picker, and that is its own piece of work.
 *
 * ── WHAT STAYED ─────────────────────────────────────────────────────────
 *
 * The things a person changes about themselves, in the order they change
 * them: what they are called, what language they are read in, the agents
 * they keep, how to leave, and how to erase the account. Five, where there
 * were eleven.
 *
 * ── AND THE PUBLIC PAGE WENT TOO (2026-10-12) ───────────────────────────
 *
 * Founder: "everything regarding public and private should also not be a
 * thing in this new experience."
 *
 * A handle field and two checkboxes stood here — "Enable public profile"
 * and "Show top-of-mind notes publicly" — and they were the ONLY way in the
 * product to switch either flag on. They are gone, which closes the door
 * without touching what is behind it: `profiles.public_handle` and the two
 * booleans still hold what anybody already chose, `PATCH /auth/me/profile`
 * still MERGES all three rather than replacing them (so a rename still
 * cannot clear a handle, which a security review tested by name), and
 * `/@handle` still answers for a profile whose flag is already true.
 *
 * SO THIS IS REVERSIBLE AND THE NEXT STEP IS NOT. Deleting the columns
 * would destroy a handle somebody picked; removing the control only means
 * nobody can pick a new one. If the decision is ever that the public page
 * itself goes, that is a separate change to `pages/PublicProfile.tsx`, the
 * `/:handle` route, and `routes/public-profiles.ts` — and it should be
 * made deliberately, because links to those pages are already in the world.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ProfilePortrait } from './ProfilePortrait';

import { ApiError } from "../lib/api";
import {
  createProfile,
  deleteProfile,
  fetchProfiles,
  renameProfile,
  type ApiOwnedProfile,
} from "../lib/api/profiles";
import { fetchSessions, revokeSession, type ApiSession } from "../lib/api/sessions";
import { supportedLocales } from "../lib/i18n";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";

export interface SettingsPanelProps {
  locale: SupportedLocale;
  /** Who is signed in. The address identifies the account and is not editable. */
  email: string | null;
  name: string;
  onName: (value: string) => void;
  onLocale: (value: SupportedLocale) => void;
  /** True while a name write is in flight. Announced, never locking: the
      write fires while the person may still be typing. */
  nameBusy: boolean;
  /** True while a language write is in flight; locks only the language. */
  localeBusy: boolean;
  /** True when the last write was refused; silence is the success state. */
  failed: boolean;
  onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
  activeProfileId?: string;
  onAgentProfilesChange?: (profiles: ApiOwnedProfile[]) => void;
  /** Called after any press that should put the panel away. */
  onClose: () => void;
}

/** The current Settings subpage; null is the overview. */
type Open = null | "agents" | "sessions" | "danger";

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(props.locale, key), [props.locale]);
  const [open, setOpen] = useState<Open>(null);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef<Open>(null);
  useEffect(() => {
    if (open !== null) heading.current?.focus();
    else if (previous.current !== null) panel.current?.querySelector<HTMLButtonElement>(`[data-settings-target="${previous.current}"]`)?.focus();
    previous.current = open;
  }, [open]);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  /* ═══ THE AGENTS, LOADED ONLY IF SOMEBODY OPENS THEM ═══════════════════
     Most people have one agent and never touch this. Fetching the roster
     every time the gear is pressed would put a round trip behind a press
     whose usual purpose is to read an email address or sign out. */
  const [agents, setAgents] = useState<ApiOwnedProfile[] | null>(null);
  useEffect(() => {
    if (agents !== null) props.onAgentProfilesChange?.(agents);
  }, [agents, props.onAgentProfilesChange]);
  const [agentTrouble, setAgentTrouble] = useState("");
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [newAgent, setNewAgent] = useState("");
  useEffect(() => {
    if (open !== "agents" || agents !== null) return;
    fetchProfiles()
      /* AGENTS ONLY. `GET /profiles` returns every profile the account owns,
         and that includes the person's OWN human profile — which this list
         offered to rename as a memory and to delete as one (audit f2afcbe2,
         desk/51). Deleting yourself is the account card's job, behind its
         own typed confirmation, not a two-press row here. */
      .then((rows) => { if (alive.current) setAgents(rows.filter((row) => row.type === "agent")); })
      .catch(() => { if (alive.current) setAgentTrouble(say("profileAgentProfilesError")); });
  }, [open, agents, say]);

  const addAgent = async () => {
    const name = newAgent.trim();
    if (!name) return;
    setBusyAgent("new"); setAgentTrouble("");
    try {
      const made = await createProfile(name);
      /* ═══ NO KEY IS MINTED, AND THAT IS THE SECURE ANSWER ══════════════
         This said "an agent without a key cannot be reached, so one is
         minted with it — the key listing is gone; the key is not." The
         reasoning was sound when the listing was the only thing that had
         been removed. It is not sound now, and an audit worked out why.

         THE KEY WAS A CREDENTIAL NOBODY COULD HOLD, SEE OR REVOKE. It is
         minted here and the returned secret is thrown away by this very
         line — `.catch(() => undefined)` and no use of the result — so it
         was never shown to anyone. Listing and revoking live on
         `SpaceSettings`, whose only opener was deleted on 2026-10-09, so
         that panel can never mount: `setSettingsFor` has three call sites
         and all three pass `null`. Meanwhile `lib/middleware.ts` really
         does accept these keys, so each one is live API access.

         A SECRET NOBODY HOLDS, NOBODY CAN LIST, AND NOBODY CAN REVOKE, that
         grants real access, is liability with no function. Asked whether
         keys should be revocable, the honest answer was to stop creating
         the thing that needs revoking rather than build a panel onto a
         feature with no floor.

         THE API IS UNTOUCHED — `POST`, `GET` and `DELETE /agent-keys` all
         stand, and `mintAgentKey` with them. If agents are reachable from
         outside again, minting comes back WITH a surface that shows the
         secret once and can take it away, on the same day. Rows already in
         the table are not deleted here; their secrets were never displayed,
         so nobody holds one. */
      if (!alive.current) return;
      setAgents((rows) => [...(rows ?? []), made]);
      setNewAgent("");
    } catch (err) {
      if (alive.current) setAgentTrouble(err instanceof ApiError ? err.message : say("profileAgentProfilesError"));
    } finally {
      if (alive.current) setBusyAgent(null);
    }
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div ref={panel} className="waka-settings" role="group" aria-label={say("worldSettingsOpen")}>
      <header className="waka-settings-heading">
        {open !== null ? <button type="button" aria-label={say("profileSettingsBack")}
          onClick={() => {
            setConfirmDelete(false);
            setBusyAgent((value) => value?.startsWith("erase:") ? null : value);
            setOpen(null);
          }}><span aria-hidden="true">←</span></button> : null}
        <h2 ref={heading} tabIndex={-1}>{say(open === "agents" ? "profileAgentProfilesTitle"
          : open === "sessions" ? "profileSessionsTitle" : open === "danger" ? "profileDelete" : "worldSettingsOpen")}</h2>
      </header>
      <div className="waka-settings-content" key={open ?? "overview"}>
      {open === null ? <>
      {/* WHO THIS IS. Not editable, and not a field: the address identifies
          the account and changing it is a different act with its own
          verification. */}
      {props.email ? <p className="waka-settings-who">{props.email}</p> : null}

      <label className="waka-account-field">
        <span>{say("profileNickname")}</span>
        <input type="text" value={props.name} aria-busy={props.nameBusy} autoComplete="name"
          onChange={(event) => props.onName(event.currentTarget.value)} />
      </label>

      <label className="waka-account-field">
        <span>{say("profileLanguageLabel")}</span>
        <select value={props.locale} disabled={props.localeBusy}
          onChange={(event) => props.onLocale(event.currentTarget.value as SupportedLocale)}>
          {supportedLocales.map((option) => (
            <option key={option.code} value={option.code}>{option.nativeLabel}</option>
          ))}
        </select>
      </label>

      {props.failed ? (
        <span className="waka-account-failed" role="alert">{say("profileSaveError")}</span>
      ) : null}
      </> : null}

      <Group id="agents" open={open} setOpen={setOpen} label={say("profileAgentProfilesTitle")}>
        <p className="waka-settings-note">{say("profileAgentProfilesHint")}</p>
        {agentTrouble ? <span className="waka-account-failed" role="alert">{agentTrouble}</span> : null}
        {agents === null ? (
          <p className="waka-settings-note" role="status">{say("worldInspirationsLoad")}</p>
        ) : (
          <>
          {agents.length === 0 ? <p className="waka-settings-note">{say("profileAgentProfilesEmpty")}</p> : null}
          <ul className="waka-settings-rows">
            {agents.map((agent) => (
              <li key={agent.id} className="waka-agent-profile">
                <div className="waka-agent-profile-fields">
                <ProfilePortrait agentId={agent.id} size={32} />
                <input type="text" defaultValue={agent.name} disabled={busyAgent === agent.id}
                  aria-label={say("profileAgentProfileName")}
                  onBlur={(event) => {
                    const next = event.currentTarget.value.trim();
                    if (!next || next === agent.name) return;
                    setBusyAgent(agent.id);
                    void renameProfile(agent.id, next)
                      .then((row) => { if (alive.current) setAgents((rows) => (rows ?? []).map((r) => r.id === row.id ? row : r)); })
                      .catch(() => { if (alive.current) setAgentTrouble(say("profileAgentProfileRenameError")); })
                      .finally(() => { if (alive.current) setBusyAgent(null); });
                  }} />
                {/* ERASING AN AGENT TAKES ITS WHOLE ARCHIVE BY CASCADE, so
                    it asks — in the product's own two-press shape rather
                    than in a `window.confirm`, which the page it replaces
                    used and which is the one dialog this product cannot
                    style, cannot translate and cannot test. */}
                <button type="button" className="waka-settings-erase" disabled={busyAgent === agent.id}
                  onClick={() => {
                    if (busyAgent !== `erase:${agent.id}`) { setBusyAgent(`erase:${agent.id}`); return; }
                    setBusyAgent(agent.id);
                    void deleteProfile(agent.id)
                      .then(() => { if (alive.current) setAgents((rows) => (rows ?? []).filter((r) => r.id !== agent.id)); })
                      /* Not "could not be loaded": the list loaded; it was
                         the delete that failed, and the row is still here. */
                      .catch(() => { if (alive.current) setAgentTrouble(say("profileAgentProfileDeleteError")); })
                      .finally(() => { if (alive.current) setBusyAgent(null); });
                  }}>
                  {busyAgent === `erase:${agent.id}` ? say("profileAgentProfileDeleteConfirm") : say("profileAgentProfileDelete")}
                </button>
                </div>
                <p className="waka-settings-note">{formatMessage(props.locale, "profileAgentProfileMemory", { name: agent.name })}</p>
                {busyAgent === `erase:${agent.id}` ? <p className="waka-settings-note" role="status">{say("profileAgentProfileDeleteHint")}</p> : null}
              </li>
            ))}
          </ul>
          </>
        )}
        <div className="waka-settings-add">
          <input type="text" value={newAgent} placeholder={say("profileAgentProfileName")}
            aria-label={say("profileAgentProfileName")} disabled={busyAgent === "new"}
            onChange={(event) => setNewAgent(event.currentTarget.value)} />
          <button type="button" disabled={busyAgent === "new" || !newAgent.trim()} onClick={() => void addAgent()}>
            {say("profileAgentProfileCreate")}
          </button>
        </div>
      </Group>

      <Group id="sessions" open={open} setOpen={setOpen} label={say("profileSessionsTitle")}>
        <AgentConnections locale={props.locale} activeProfileId={props.activeProfileId} />
      </Group>

      {open === null ? <button type="button" className="waka-account-out" onClick={() => { props.onClose(); props.onSignOut(); }}>
        {say("worldSignOutLower")}
      </button> : null}

      {/* ═══ THE ONE IRREVERSIBLE ACT, LAST AND TWICE-PRESSED ═════════════
          At the foot, behind a disclosure, behind a second press. The page
          this replaces had it behind a disclosure too and that part was
          right. */}
      <Group id="danger" open={open} setOpen={setOpen} label={say("profileDelete")}>
        <p className="waka-settings-note">{say("profileDeleteHint")}</p>
        <button type="button" className="waka-settings-erase" disabled={deleting}
          onClick={() => {
            if (!confirmDelete) { setConfirmDelete(true); return; }
            setDeleting(true);
            void props.onDeleteAccount().finally(() => { if (alive.current) setDeleting(false); });
          }}>
          {say(deleting ? "profileRemoving" : confirmDelete ? "worldDeleteItAnyway" : "profileDelete")}
        </button>
      </Group>
      </div>
    </div>
  );
}

/** Mounted only on the Sessions subpage, so opening Settings stays local. */
function AgentConnections({ locale, activeProfileId }: { locale: SupportedLocale; activeProfileId?: string }): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const [sessions, setSessions] = useState<ApiSession[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"manage" | "setup">("manage");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const confirmation = useRef<HTMLParagraphElement>(null);
  const previousConfirmation = useRef<string | null>(null);
  const profileHeading = useRef<HTMLHeadingElement>(null);
  const previousProfile = useRef<string | null>(null);
  useEffect(() => {
    if (selectedProfileId !== null) profileHeading.current?.focus();
    else if (previousProfile.current !== null) {
      const row = list.current?.querySelector<HTMLButtonElement>(`[data-profile-id="${previousProfile.current}"]`);
      (row ?? profileHeading.current)?.focus();
    }
    previousProfile.current = selectedProfileId;
  }, [selectedProfileId]);
  useEffect(() => {
    if (confirm !== null) confirmation.current?.focus();
    else if (previousConfirmation.current !== null) list.current?.querySelector<HTMLButtonElement>(`[data-session-id="${previousConfirmation.current}"]`)?.focus();
    previousConfirmation.current = confirm;
  }, [confirm]);
  const alive = useRef(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const rows = await fetchSessions();
      if (alive.current) setSessions(rows);
    } catch {
      if (alive.current) setError(say("profileConnectionsError"));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [say]);
  useEffect(() => {
    alive.current = true;
    void load();
    return () => { alive.current = false; };
  }, [load]);

  const disconnect = async (session: ApiSession) => {
    setBusy(session.id);
    setError("");
    setNotice("");
    try {
      await revokeSession(session.id);
      if (alive.current) {
        setSessions((rows) => rows?.filter((row) => row.id !== session.id) ?? null);
        setConfirm(null);
        if (!sessions?.some(row => !row.current && row.id !== session.id && row.profile.id === session.profile.id)) setSelectedProfileId(null);
        setNotice(formatMessage(locale, "profileConnectionDisconnected", { name: session.deviceLabel || say("profileConnectionUnnamed") }));
      }
    } catch {
      if (alive.current) setError(say("profileConnectionDisconnectError"));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  // The current browser already has Sign out. Never offer to disconnect it here.
  const others = sessions?.filter((row) => !row.current && new Date(row.expiresAt).getTime() > Date.now());
  const groups = new Map<string, { profile: ApiSession['profile']; sessions: ApiSession[] }>();
  for (const session of others ?? []) {
    const group = groups.get(session.profile.id) ?? { profile: session.profile, sessions: [] };
    group.sessions.push(session);
    groups.set(session.profile.id, group);
  }
  const selected = selectedProfileId ? groups.get(selectedProfileId) : undefined;
  const date = (value: string) => new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return <>
    <div className="waka-session-tabs" role="group" aria-label={say("profileConnectionViews")}>
      <button type="button" aria-pressed={view === "manage"} onClick={() => { setView("manage"); setConfirm(null); setSelectedProfileId(null); }}>{say("profileConnectionsManage")}</button>
      <button type="button" aria-pressed={view === "setup"} onClick={() => { setView("setup"); setConfirm(null); }}>{say("profileConnectionSetup")}</button>
    </div>
    {error ? <span className="waka-account-failed" role="alert">{error}</span> : null}
    {view === "setup" ? <SessionSetup locale={locale} activeProfileId={activeProfileId} onDone={() => { setView("manage"); void load(); }} /> : <>
    <div className="waka-session-list-heading">
      {selected ? <button type="button" className="waka-settings-erase" aria-label={say('profileConnectionsBack')}
        onClick={() => { setSelectedProfileId(null); setConfirm(null); }}>←</button> : null}
      <h3 ref={profileHeading} tabIndex={-1}>{selected?.profile.name ?? say("profileConnectionsDevices")}</h3>
      <button type="button" className="waka-settings-erase" disabled={loading || busy !== null} onClick={() => void load()}>
        {say("profileConnectionsRefresh")}
      </button>
    </div>
    <p className="waka-settings-note">{selected
      ? say(selected.profile.type === 'agent' ? 'profileConnectionAgentAccess' : 'profileConnectionHumanAccess')
      : say("profileConnectionsHint")}</p>
    {notice ? <p className="waka-settings-note" role="status">{notice}</p> : null}
    {loading ? <p className="waka-settings-note" role="status">{say("worldInspirationsLoad")}</p> : null}
    {others?.length === 0 && !loading ? <div className="waka-session-empty">
      <p>{say("profileConnectionsEmpty")}</p>
      <button type="button" className="waka-settings-erase" onClick={() => setView("setup")}>{say("profileConnectionConnect")}</button>
    </div> : null}
    <ul ref={list} className="waka-session-list" aria-busy={loading}>
      {!selected ? [...groups.values()].map(({ profile, sessions: connections }) => <li key={profile.id}>
        <button type="button" className="waka-session-profile-row" data-profile-id={profile.id}
          aria-label={formatMessage(locale, 'profileConnectionsForProfile', { name: profile.name })}
          onClick={() => setSelectedProfileId(profile.id)}>
          <ProfilePortrait agentId={profile.type === 'agent' ? profile.id : undefined} />
          <span className="waka-session-profile-copy">
            <strong>{profile.name}</strong>
            <span>{say(profile.type === 'agent' ? 'profileConnectionAgentProfile' : 'profileConnectionPersonalProfile')} · {formatMessage(locale,
              connections.length === 1 ? 'profileConnectionsCountOne' : 'profileConnectionsCount', { count: connections.length })}</span>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      </li>) : selected.sessions.map((session) => {
        const expired = new Date(session.expiresAt).getTime() <= Date.now();
        const name = session.deviceLabel || say("profileConnectionUnnamed");
        return <li key={session.id} className="waka-session-card">
          <div className="waka-session-card-heading">
            <strong>{name}</strong>
            <span>{say(expired ? "profileConnectionExpired" : "profileConnectionSignedIn")}</span>
          </div>
          <dl className="waka-session-info">
            <dt>{say("profileConnectionLastUsed")}</dt><dd>{date(session.lastSeenAt)}</dd>
            <dt>{say("profileConnectionExpires")}</dt><dd>{date(session.expiresAt)}</dd>
          </dl>
          {confirm === session.id ? <div className="waka-session-confirm">
            <p ref={confirmation} tabIndex={-1}>{formatMessage(locale, "profileConnectionDisconnectHint", { name })}</p>
            <div className="waka-session-actions">
              <button type="button" className="waka-settings-erase" disabled={busy !== null} onClick={() => setConfirm(null)}>{say("profileConnectionCancel")}</button>
              <button type="button" className="waka-settings-erase" disabled={busy !== null} onClick={() => void disconnect(session)}
                aria-label={formatMessage(locale, "profileConnectionDisconnectLabel", { name })}>{say(busy === session.id ? "profileConnectionDisconnecting" : "profileConnectionDisconnect")}</button>
            </div>
          </div> : <button type="button" className="waka-settings-erase" disabled={loading || busy !== null} onClick={() => { setConfirm(session.id); setNotice(""); }}
            data-session-id={session.id}
            aria-label={formatMessage(locale, "profileConnectionDisconnectLabel", { name })}>
            {say("profileConnectionDisconnect")}
          </button>}
        </li>;
      })}
    </ul>
    </>}
  </>;
}

function SessionSetup({ locale, onDone, activeProfileId }: { locale: SupportedLocale; onDone: () => void; activeProfileId?: string }): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [step, setStep] = useState(0);
  const [installed, setInstalled] = useState(false);
  const [profiles, setProfiles] = useState<ApiOwnedProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  const [profileError, setProfileError] = useState(false);
  const [verification, setVerification] = useState<'idle' | 'checking' | 'waiting' | 'error' | 'verified'>('idle');
  const [verifiedDevice, setVerifiedDevice] = useState('');
  const verificationStarted = useRef(Date.now());
  const verificationRequest = useRef(0);
  useEffect(() => () => { verificationRequest.current += 1; }, []);
  useEffect(() => {
    verificationRequest.current += 1;
    verificationStarted.current = Date.now();
    setVerification('idle'); setVerifiedDevice('');
  }, [profileId]);
  useEffect(() => {
    let live = true;
    void fetchProfiles().then(rows => {
      if (!live) return;
      setProfiles(rows); setProfileId((rows.find(row => row.id === activeProfileId) ?? rows.find(row => row.type === 'agent') ?? rows[0])?.id ?? '');
    }).catch(() => { if (live) setProfileError(true); });
    return () => { live = false; };
  }, [activeProfileId]);
  const selected = profiles.find(row => row.id === profileId);
  const quote = (value: string) => "'" + value.replace(/'/g, "'\\''") + "'";
  const profileHome = selected ? `"$HOME/.waka/profiles/${encodeURIComponent(selected.id)}"` : '';

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [step]);
  const apiUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, "");
  const hostname = new URL(apiUrl).hostname;
  const mcpBranch = ['localhost', '127.0.0.1', '[::1]', 'dev.waka.im'].includes(hostname) ? 'dev' : 'main';
  const commands = [
    `git clone --branch ${mcpBranch} https://github.com/waka-eng/waka-mcp.git\ncd waka-mcp\npnpm install`,
    selected ? `${installed ? 'git pull --ff-only\npnpm install\n' : ''}pnpm run build\nWAKA_HOME=${profileHome} WAKA_PROFILE_ID=${quote(selected.id)} pnpm run login -- ${quote(apiUrl)} --profile ${quote(selected.id)} --device ${quote(`Claude Code · ${selected.name}`)}` : '',
    selected ? `${installed ? `claude mcp remove --scope user ${quote(`waka-${selected.id}`)} 2>/dev/null || true\n` : ''}claude mcp add --scope user ${quote(`waka-${selected.id}`)} -- env WAKA_HOME=${profileHome} WAKA_PROFILE_ID=${quote(selected.id)} WAKA_API_KEY='' node "$PWD/dist/src/server.js"` : '',
  ];
  const checkConnection = async () => {
    if (!selected) return;
    const request = ++verificationRequest.current;
    setVerification('checking');
    try {
      const rows = await fetchSessions();
      if (request !== verificationRequest.current) return;
      const connection = rows.find(row => !row.current && row.profile.id === selected.id &&
        row.deviceLabel === `Claude Code · ${selected.name}` && new Date(row.expiresAt).getTime() > Date.now() &&
        row.verifiedAt && new Date(row.verifiedAt).getTime() >= verificationStarted.current);
      setVerifiedDevice(connection?.deviceLabel ?? '');
      setVerification(connection ? 'verified' : 'waiting');
    } catch { if (request === verificationRequest.current) setVerification('error'); }
  };
  return <section className="waka-mcp-setup" aria-labelledby="waka-mcp-step">
    <p className="waka-settings-note">{formatMessage(locale, "profileConnectionStep", { step: step + 1 - Number(installed), total: installed ? 2 : 3 })}</p>
    <h3 id="waka-mcp-step" ref={heading} tabIndex={-1}>{say(step === 0 ? "profileConnectionInstallTitle" : step === 1 ? "profileConnectionLoginTitle" : "profileConnectionVerifyTitle")}</h3>
    <div key={step}>
      {step === 0 ? <>
        <p>{say("profileConnectionInstallHint")}</p>
        <CommandBlock locale={locale} command={commands[0]!} />
        <p className="waka-settings-note">{say("profileConnectionCreateProfileHint")}</p>
        <button type="button" className="waka-settings-erase" onClick={() => { setInstalled(true); setStep(1); }}>{say("profileConnectionAlreadyInstalled")}</button>
      </> : step === 1 ? <>
        <p>{say("profileConnectionLoginHint")}</p>
        <label className="waka-account-field">
          <span>{say('profileConnectionChooseProfile')}</span>
          <select value={profileId} onChange={event => setProfileId(event.target.value)}>
            {profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {say(profile.type === 'agent' ? 'profileConnectionAgentProfile' : 'profileConnectionPersonalProfile')}</option>)}
          </select>
        </label>
        {profileError ? <p role="alert">{say('profileAgentProfilesError')}</p> : null}
        {selected ? <CommandBlock locale={locale} command={commands[1]!} /> : null}
        <dl className="waka-session-info">
          <dt>{selected?.name}</dt><dd>{selected ? say(selected.type === 'agent' ? 'profileConnectionAgentAccess' : 'profileConnectionHumanAccess') : ''}</dd>
        </dl>
        <p className="waka-settings-note">{say("profileConnectionApprove")}</p>
        <p className="waka-settings-note">{say("profileConnectionSharedLogin")}</p>
      </> : <>
        <p>{say("profileConnectionRegisterHint")}</p>{selected ? <CommandBlock locale={locale} command={commands[2]!} /> : null}
        <p>{say("profileConnectionVerifyHint")}</p>
        <blockquote className="waka-session-prompt">{formatMessage(locale, selected?.type === 'human' ? "profileConnectionTestPromptHuman" : "profileConnectionTestPrompt", { name: selected?.name ?? "", id: selected?.id ?? "" })}</blockquote>
        <p className="waka-settings-note">{say(selected?.type === 'human' ? "profileConnectionVerifyResultHuman" : "profileConnectionVerifyResult")}</p>
      </>}
    </div>
    {step === 2 && verification !== 'idle' && verification !== 'checking' ? <p className="waka-settings-note" role={verification === 'error' ? 'alert' : 'status'}>
      {verification === 'verified' ? formatMessage(locale, 'profileConnectionVerified', { name: selected?.name ?? '', device: verifiedDevice })
        : say(verification === 'error' ? 'profileConnectionCheckFailed' : 'profileConnectionNotVerified')}
    </p> : null}
    <div className="waka-session-actions">
      {step > 0 ? <button type="button" className="waka-settings-erase" onClick={() => { if (step === 1) setInstalled(false); setStep(step - 1); }}>{say("profileConnectionPrevious")}</button> : null}
      <button type="button" className="waka-settings-erase" disabled={(step > 0 && !selected) || verification === 'checking'}
        onClick={() => step === 2 ? verification === 'verified' ? onDone() : void checkConnection() : setStep(step + 1)}>
        {say(step === 0 ? "profileConnectionNextLogin" : step === 1 ? "profileConnectionNextVerify"
          : verification === 'verified' ? "profileConnectionViewDevices" : verification === 'checking' ? 'profileConnectionChecking' : 'profileConnectionCheck')}
      </button>
    </div>
  </section>;
}

function CommandBlock({ locale, command }: { locale: SupportedLocale; command: string }): JSX.Element {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  return <div className="waka-session-command">
    <button type="button" className="waka-settings-erase" onClick={() => {
      void (async () => {
        try { await navigator.clipboard.writeText(command); setResult("copied"); }
        catch { setResult("failed"); }
      })();
    }}>{t(locale, "profileConnectionCopy")}</button>
    {result ? <span role="status" className="waka-settings-note">{t(locale, result === "copied" ? "profileConnectionCopied" : "profileConnectionCopyError")}</span> : null}
    <pre className="waka-mcp-commands"><code>{command}</code></pre>
  </div>;
}

/** Overview rows navigate; only the selected section's content is mounted. */
function Group({ id, open, setOpen, label, children }: {
  id: Exclude<Open, null>;
  open: Open;
  setOpen: (next: Open) => void;
  label: string;
  children: React.ReactNode;
}): JSX.Element | null {
  if (open !== null) return open === id ? <div className="waka-settings-body">{children}</div> : null;
  return (
    <div className="waka-settings-group">
      <button type="button" className="waka-settings-row" data-settings-target={id}
        onClick={() => setOpen(id)}>
        {label}
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
