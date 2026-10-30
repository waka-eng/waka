import { McpCopyBlock } from './McpCopyBlock';
import { ProfileMcpSetup } from './ProfileMcpSetup';
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
 *   Personal MCP keys live under My profile; agent keys live beside their
 *   connections. Creation is explicit, secrets are shown once, and every
 *   active key can be revoked. Historical read grants remain unexposed.
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
import { ProfileApiKeys } from './ProfileApiKeys';

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
  onBeforeLeave?: (guard: (() => Promise<boolean>) | null) => void;
  activeProfileId?: string;
  initialAgentId?: string;
  onAgentProfilesChange?: (profiles: ApiOwnedProfile[]) => void;
  /** Called after any press that should put the panel away. */
  onClose: () => void;
}

/** The current Settings subpage; null is the overview. */
type Open = null | "personal" | "agents" | "sessions" | "danger";

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(props.locale, key), [props.locale]);
  const [open, setOpen] = useState<Open>(props.initialAgentId ? "agents" : null);
  const [connectionProfile, setConnectionProfile] = useState<ApiOwnedProfile | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef<Open>(null);
  const previousAgent = useRef<string | null>(null);
  useEffect(() => {
    if (open === "agents" && previous.current === "sessions") {
      const row = panel.current?.querySelector<HTMLButtonElement>(`[data-agent-id="${previousAgent.current}"]`);
      (row ?? heading.current)?.focus();
    } else if (open !== null) heading.current?.focus();
    else if (previous.current !== null) panel.current?.querySelector<HTMLButtonElement>(`[data-settings-target="${previous.current}"]`)?.focus();
    previous.current = open;
    previousAgent.current = connectionProfile?.id ?? null;
  }, [open, connectionProfile?.id]);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  /* ═══ THE AGENTS, LOADED ONLY IF SOMEBODY OPENS THEM ═══════════════════
     Most people have one agent and never touch this. Fetching the roster
     every time the gear is pressed would put a round trip behind a press
     whose usual purpose is to read an email address or sign out. */
  const [agents, setAgents] = useState<ApiOwnedProfile[] | null>(null);
  const [personalProfile, setPersonalProfile] = useState<ApiOwnedProfile | null>(null);
  useEffect(() => {
    if (agents !== null) props.onAgentProfilesChange?.(agents);
  }, [agents, props.onAgentProfilesChange]);
  const openedInitialAgent = useRef(false);
  useEffect(() => {
    if (openedInitialAgent.current || !props.initialAgentId || !agents) return;
    openedInitialAgent.current = true;
    const profile = agents.find(profile => profile.id === props.initialAgentId);
    if (profile) { setConnectionProfile(profile); setOpen('sessions'); }
  }, [props.initialAgentId, agents]);
  const [agentTrouble, setAgentTrouble] = useState("");
  const [agentLoadFailed, setAgentLoadFailed] = useState(false);
  const [agentAttempt, setAgentAttempt] = useState(0);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [agentNames, setAgentNames] = useState<Record<string, string>>({});
  const [nameStates, setNameStates] = useState<Record<string, 'dirty' | 'invalid' | 'failed' | 'saved'>>({});
  const [eraseAgent, setEraseAgent] = useState<string | null>(null);
  const erasePrompt = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (eraseAgent) erasePrompt.current?.focus(); }, [eraseAgent]);
  const [newAgent, setNewAgent] = useState("");
  useEffect(() => {
    if (open !== "agents" && open !== "personal") return;
    if (open === "agents" ? agents !== null : personalProfile !== null) return;
    let current = true;
    setAgentLoadFailed(false);
    fetchProfiles()
      /* AGENTS ONLY. `GET /profiles` returns every profile the account owns,
         and that includes the person's OWN human profile — which this list
         offered to rename as a memory and to delete as one (audit f2afcbe2,
         desk/51). Deleting yourself is the account card's job, behind its
         own typed confirmation, not a two-press row here. */
      .then((rows) => {
        if (!current) return;
        const human = rows.find(row => row.type === 'human');
        if (open === 'personal' && !human) throw new Error('Personal profile missing');
        setPersonalProfile(human ?? null);
        setAgents(rows.filter(row => row.type === 'agent'));
      })
      .catch(() => { if (current) setAgentLoadFailed(true); });
    return () => { current = false; };
  }, [open, personalProfile, agents, agentAttempt]);

  const renameFlight = useRef<Promise<boolean> | null>(null);
  const saveAgentName = async (agent: ApiOwnedProfile, value = agentNames[agent.id] ?? agent.name) => {
    if (renameFlight.current) return renameFlight.current;
    if (busyAgent) return false;
    const next = value.trim();
    if (!next) { setNameStates(states => ({ ...states, [agent.id]: 'invalid' })); return false; }
    if (next === agent.name) { setNameStates(states => ({ ...states, [agent.id]: 'saved' })); return true; }
    setBusyAgent(`rename:${agent.id}`);
    const saving = (async () => {
    try {
      const row = await renameProfile(agent.id, next);
      if (!alive.current) return false;
      setAgents(rows => (rows ?? []).map(item => item.id === row.id ? { ...item, ...row } : item));
      setConnectionProfile(current => current?.id === row.id ? { ...current, ...row } : current);
      setAgentNames(names => ({ ...names, [agent.id]: row.name }));
      setNameStates(states => ({ ...states, [agent.id]: 'saved' }));
      return true;
    } catch {
      if (alive.current) setNameStates(states => ({ ...states, [agent.id]: 'failed' }));
      return false;
    } finally { renameFlight.current = null; if (alive.current) setBusyAgent(null); }
    })();
    renameFlight.current = saving;
    return saving;
  };

  const beforeLeave = async () => {
    if (renameFlight.current) return renameFlight.current;
    if (!connectionProfile) return true;
    const value = agentNames[connectionProfile.id];
    return value === undefined || value === connectionProfile.name ? true : saveAgentName(connectionProfile, value);
  };
  useEffect(() => {
    props.onBeforeLeave?.(beforeLeave);
    return () => props.onBeforeLeave?.(null);
  });

  const cancelAgentDelete = (id: string) => {
    setEraseAgent(null);
    panel.current?.querySelector<HTMLButtonElement>(`[data-agent-delete="${id}"]`)?.focus();
  };

  const addAgent = async () => {
    const name = newAgent.trim();
    if (!name) return;
    setBusyAgent("new"); setAgentTrouble("");
    try {
      const made = await createProfile(name);
      // Creating a profile never creates a credential. Keys are issued only
      // from that agent's Connections & API keys page, with a visible secret.
      if (!alive.current) return;
      setAgents((rows) => [...(rows ?? []), { ...made, hasInspirations: false }]);
      setNewAgent("");
      setConnectionProfile({ ...made, hasInspirations: false });
      setOpen("sessions");
    } catch (err) {
      if (alive.current) setAgentTrouble(err instanceof ApiError ? err.message : say("profileAgentProfilesError"));
    } finally {
      if (alive.current) setBusyAgent(null);
    }
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const agent = connectionProfile;

  return (
    <div ref={panel} className="waka-settings" role="group" aria-label={say("worldSettingsOpen")}>
      <header className="waka-settings-heading">
        {open !== null ? <button type="button" aria-label={say(connectionProfile ? 'profileAgentAccessBack' : "profileSettingsBack")}
          onClick={async () => {
            if (!await beforeLeave() || !alive.current) return;
            setConfirmDelete(false);
            setEraseAgent(null);
            setOpen(connectionProfile ? 'agents' : null);
            setConnectionProfile(null);
          }}><span aria-hidden="true">←</span></button> : null}
        <h2 ref={heading} tabIndex={-1}>{connectionProfile?.name ?? say(open === "agents" ? "profileAgentProfilesTitle"
          : open === "personal" ? "profilePersonalTitle" : open === "sessions" ? "profileSessionsTitle" : open === "danger" ? "profileDelete" : "worldSettingsOpen")}</h2>
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
        <small>{say("profileLanguageScope")}</small>
        <select aria-label={say("profileLanguageLabel")} value={props.locale} disabled={props.localeBusy}
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

      <Group id="personal" open={open} setOpen={setOpen} label={say('profilePersonalMcpTitle')}>
        {personalProfile ? <PersonalConnections key={personalProfile.id} locale={props.locale} profile={personalProfile} />
          : agentLoadFailed || agents !== null ? <>
            <p className="waka-account-failed" role="alert">{say('profilePersonalMcpLoadError')}</p>
            <button type="button" className="waka-settings-erase" onClick={() => setAgentAttempt(attempt => attempt + 1)}>{say('worldRetry')}</button>
          </> : <p className="waka-settings-note" role="status">{say('worldInspirationsLoad')}</p>}
      </Group>

      <Group id="agents" open={open} setOpen={setOpen} label={say("profileAgentProfilesTitle")}>
        <p className="waka-settings-note">{say("profileAgentProfilesHint")}</p>
        {agentTrouble ? <span className="waka-account-failed" role="alert">{agentTrouble}</span> : null}
        {agents === null && agentLoadFailed ? <>
          <p className="waka-account-failed" role="alert">{say('profileAgentProfilesError')}</p>
          <button type="button" className="waka-settings-erase" onClick={() => setAgentAttempt(attempt => attempt + 1)}>{say('worldRetry')}</button>
        </> : agents === null ? (
          <p className="waka-settings-note" role="status">{say("worldInspirationsLoad")}</p>
        ) : (
          <>
          {agents.length === 0 ? <p className="waka-settings-note">{say("profileAgentProfilesEmpty")}</p> : null}
          <ul className="waka-settings-rows">
            {agents.map((agent) => (
              <li key={agent.id} className="waka-agent-profile">
                <button type="button" className="waka-session-profile-row" data-agent-id={agent.id}
                  aria-label={formatMessage(props.locale, 'profileAgentSettingsLabel', { name: agent.name })}
                  onClick={() => { setConnectionProfile(agent); setAgentTrouble(''); setOpen('sessions'); }}>
                  <ProfilePortrait agentId={agent.id} size={32} />
                  <span className="waka-session-profile-copy"><strong>{agent.name}</strong></span>
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
          </>
        )}
        <div className="waka-settings-add">
          <input type="text" value={newAgent} placeholder={say("profileAgentProfileName")} maxLength={80}
            aria-label={say("profileAgentProfileName")} disabled={agents === null || busyAgent !== null}
            onChange={(event) => setNewAgent(event.currentTarget.value)} />
          <button type="button" disabled={agents === null || busyAgent !== null || !newAgent.trim()} onClick={() => void addAgent()}>
            {say("profileAgentProfileCreate")}
          </button>
        </div>
      </Group>

      <Group id="sessions" open={open} setOpen={setOpen} label={say("profileSessionsTitle")}>
        {agent ? <div className="waka-agent-details">
          <label className="waka-account-field">
          <span>{say("profileAgentProfileName")}</span>
          <div className="waka-agent-profile-fields">
          <ProfilePortrait agentId={agent.id} size={32} />
          <input type="text" value={agentNames[agent.id] ?? agent.name} maxLength={80} disabled={busyAgent !== null}
            aria-label={say("profileAgentProfileName")}
            aria-invalid={nameStates[agent.id] === 'invalid'} aria-describedby={`agent-name-state-${agent.id}`}
            onChange={event => {
              setAgentNames(names => ({ ...names, [agent.id]: event.target.value }));
              setNameStates(states => ({ ...states, [agent.id]: 'dirty' }));
            }}
            onBlur={event => { if (event.currentTarget.value !== agent.name || nameStates[agent.id] === 'dirty') void saveAgentName(agent, event.currentTarget.value); }}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } }} />

          </div>
          </label>
          <div className="waka-agent-name-state" id={`agent-name-state-${agent.id}`}>
            {busyAgent === `rename:${agent.id}` ? <span className="waka-settings-note" role="status">{say('worldSaving')}</span>
              : nameStates[agent.id] ? <span className="waka-settings-note" role={['invalid', 'failed'].includes(nameStates[agent.id]) ? 'alert' : 'status'}>
                {say(nameStates[agent.id] === 'invalid' ? 'profileAgentNameRequired' : nameStates[agent.id] === 'failed' ? 'profileAgentNameNotSaved' : nameStates[agent.id] === 'saved' ? 'worldSavedWord' : 'profileAgentNameUnsaved')}
              </span> : null}
            {['invalid', 'failed'].includes(nameStates[agent.id]) ? <button type="button" className="waka-settings-erase" onClick={() => {
              setAgentNames(names => ({ ...names, [agent.id]: agent.name }));
              setNameStates(states => { const next = { ...states }; delete next[agent.id]; return next; });
            }}>{say('profileAgentNameDiscard')}</button> : null}
            {nameStates[agent.id] === 'failed' ? <button type="button" className="waka-settings-erase" disabled={busyAgent !== null} onClick={() => void saveAgentName(agent)}>{say('worldRetry')}</button> : null}
          </div>

        </div> : null}
        {agent && agentTrouble ? <p className="waka-account-failed" role="alert">{agentTrouble}</p> : null}
        <ProfileConnections key={connectionProfile?.id ?? 'account'} locale={props.locale} profile={connectionProfile ?? undefined} />
        {agent ? <div className="waka-settings-danger">
          <button type="button" className="waka-settings-erase" disabled={busyAgent !== null} data-agent-delete={agent.id}
            onClick={() => { setEraseAgent(agent.id); setAgentTrouble(''); }}>
            {say("profileAgentProfileDelete")}
          </button>
          {eraseAgent === agent.id ? <div className="waka-session-confirm">
            <p ref={erasePrompt} tabIndex={-1}>{formatMessage(props.locale, 'profileAgentDeleteNamed', { name: agent.name })}</p>
            <div className="waka-session-actions">
              <button type="button" className="waka-settings-erase" disabled={busyAgent !== null} onClick={() => cancelAgentDelete(agent.id)}>{say('profileConnectionCancel')}</button>
              <button type="button" className="waka-settings-erase" disabled={busyAgent !== null} onClick={() => {
                setBusyAgent(`delete:${agent.id}`); setAgentTrouble('');
                void deleteProfile(agent.id)
                  .then(() => { if (alive.current) { setAgents(rows => (rows ?? []).filter(row => row.id !== agent.id)); setEraseAgent(null); setConnectionProfile(null); setOpen("agents"); } })
                  .catch(() => { if (alive.current) setAgentTrouble(say('profileAgentProfileDeleteError')); })
                  .finally(() => { if (alive.current) setBusyAgent(null); });
              }}>{say(busyAgent === `delete:${agent.id}` ? 'profileRemoving' : 'profileAgentProfileDeleteConfirm')}</button>
            </div>
          </div> : null}

        </div> : null}
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

/** Both destinations use the same setup prompt; keys load only when their tab opens. */
function PersonalConnections({ locale, profile }: { locale: SupportedLocale; profile: ApiOwnedProfile }): JSX.Element {
  const [view, setView] = useState<'setup' | 'keys'>('setup');
  return <>
    <div className="waka-session-tabs" role="group" aria-label={t(locale, 'profileConnectionViews')}>
      <button type="button" aria-pressed={view === 'setup'} onClick={() => setView('setup')}>{t(locale, 'profileMcpSetupTab')}</button>
      <button type="button" aria-pressed={view === 'keys'} onClick={() => setView('keys')}>{t(locale, 'profileApiKeysTitle')}</button>
    </div>
    {view === 'keys' ? <ProfileApiKeys locale={locale} profile={profile} /> : <ProfileMcpSetup locale={locale} profile={profile} />}
  </>;
}

/** Agent access stays under its profile; the account page shows personal sign-ins only. */
function ProfileConnections({ locale, profile }: { locale: SupportedLocale; profile?: ApiOwnedProfile }): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const [sessions, setSessions] = useState<ApiSession[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [view, setView] = useState<"connections" | "setup" | "keys" | "verify">("connections");
  const [testSession, setTestSession] = useState<ApiSession | undefined>();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const list = useRef<HTMLUListElement>(null);
  const confirmation = useRef<HTMLParagraphElement>(null);
  const previousConfirmation = useRef<string | null>(null);
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
        setNotice(formatMessage(locale, "profileConnectionDisconnected", { name: session.deviceLabel || say("profileConnectionUnnamed") }));
      }
    } catch {
      if (alive.current) setError(say("profileConnectionDisconnectError"));
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  // The current browser already has Sign out. Never offer to disconnect it here.
  const others = sessions?.filter(row => !row.current && new Date(row.expiresAt).getTime() > Date.now() &&
    (profile ? row.profile.id === profile.id : row.profile.type === 'human'));
  const date = (value: string) => new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return <>
    {profile ? <div className="waka-session-tabs" role="group" aria-label={say("profileConnectionViews")}>
      <button type="button" aria-pressed={view !== 'keys'} onClick={() => { setView('connections'); setConfirm(null); }}>{say('profileMcpConnections')}</button>
      <button type="button" aria-pressed={view === 'keys'} onClick={() => { setView('keys'); setConfirm(null); }}>{say('profileApiKeysTitle')}</button>
    </div> : null}
    {error ? <span className="waka-account-failed" role="alert">{error}</span> : null}
    {view === 'keys' && profile ? <ProfileApiKeys key={profile.id} locale={locale} profile={profile} />
      : view === 'setup' && profile ? <ProfileMcpSetup locale={locale} profile={profile} />
      : view === 'verify' && profile && testSession ? <SessionVerification key={testSession.id} locale={locale} profile={profile}
        connection={testSession}
        onDone={() => { setView('connections'); void load(); }} /> : <>
    <div className="waka-session-list-heading">
      <h3>{say('profileConnectionsLive')}</h3>
      <button type="button" className="waka-settings-erase" disabled={loading || busy !== null} onClick={() => void load()}>
        {say("profileConnectionsRefresh")}
      </button>
    </div>
    <p className="waka-settings-note">{say(profile ? 'profileConnectionAgentAccess' : 'profileAccountConnectionsHint')}</p>
    {profile ? <button type="button" className="waka-settings-row" onClick={() => { setView('setup'); setConfirm(null); }}>
      {say('profileConnectionSetup')}<span aria-hidden="true">›</span>
    </button> : null}
    {notice ? <p className="waka-settings-note" role="status">{notice}</p> : null}
    {loading ? <p className="waka-settings-note" role="status">{say("worldInspirationsLoad")}</p> : null}
    {others?.length === 0 && !loading ? <p className="waka-settings-note">
      {profile ? formatMessage(locale, 'profileConnectionsAgentEmpty', { name: profile.name }) : say('profileAccountConnectionsEmpty')}
    </p> : null}
    <ul ref={list} className="waka-session-list" aria-busy={loading}>
      {others?.map((session) => {
        const name = session.deviceLabel || say("profileConnectionUnnamed");
        return <li key={session.id} className="waka-session-card">
          <div className="waka-session-card-heading">
            <strong>{name}</strong>
            <span>{say(profile ? session.verifiedAt ? 'profileMcpVerified' : 'profileMcpUnverified' : 'profileConnectionSignedIn')}</span>
          </div>
          <dl className="waka-session-info">
            {profile && session.verifiedAt ? <><dt>{say('profileMcpLastVerified')}</dt><dd>{date(session.verifiedAt)}</dd></> : null}
            <dt>{say("profileConnectionLastUsed")}</dt><dd>{date(session.lastSeenAt)}</dd>
            <dt>{say("profileConnectionExpires")}</dt><dd>{date(session.expiresAt)}</dd>
          </dl>
          {profile ? <button type="button" className="waka-settings-erase" disabled={loading || busy !== null}
            aria-label={formatMessage(locale, 'profileMcpTestDevice', { name })}
            onClick={() => { setTestSession(session); setConfirm(null); setView('verify'); }}>{say('profileMcpTest')}</button> : null}
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

/** Retest an existing connection without installing or creating another session. */
function SessionVerification({ locale, onDone, profile, connection }: {
  locale: SupportedLocale; onDone: () => void; profile: ApiOwnedProfile; connection: ApiSession;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [verification, setVerification] = useState<'idle' | 'checking' | 'waiting' | 'error' | 'verified'>('idle');
  const verificationStarted = useRef(Date.now());
  const verificationRequest = useRef(0);
  useEffect(() => () => { verificationRequest.current += 1; }, []);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const device = connection.deviceLabel || say('profileConnectionUnnamed');
  const checkConnection = async () => {
    const request = ++verificationRequest.current;
    setVerification('checking');
    try {
      const rows = await fetchSessions();
      if (request !== verificationRequest.current) return;
      const verified = rows.some(row => !row.current && row.profile.id === profile.id && row.id === connection.id &&
        new Date(row.expiresAt).getTime() > Date.now() && row.verifiedAt && new Date(row.verifiedAt).getTime() >= verificationStarted.current);
      setVerification(verified ? 'verified' : 'waiting');
    } catch { if (request === verificationRequest.current) setVerification('error'); }
  };
  return <section className="waka-mcp-setup" aria-labelledby="waka-mcp-test-title">
    <h3 id="waka-mcp-test-title" ref={heading} tabIndex={-1}>{say('profileMcpTest')}</h3>
    <div>
      <p>{formatMessage(locale, 'profileMcpTestHint', { name: profile.name, device })}</p>
      <McpCopyBlock locale={locale} prompt copyLabel={say('profileMcpCopyTest')}
        text={formatMessage(locale, 'profileConnectionTestPrompt', { name: profile.name, id: profile.id })} />
      <p className="waka-settings-note">{say('profileMcpTestResult')}</p>
    </div>
    {verification !== 'idle' && verification !== 'checking' ? <p className="waka-settings-note" role={verification === 'error' ? 'alert' : 'status'}>
      {verification === 'verified' ? formatMessage(locale, 'profileConnectionVerified', { name: profile.name, device })
        : verification === 'waiting' ? formatMessage(locale, 'profileMcpTestWaiting', { device }) : say('profileConnectionCheckFailed')}
    </p> : null}
    <div className="waka-session-actions">
      <button type="button" className="waka-settings-erase" onClick={onDone}>{say('profileConnectionCancel')}</button>
      <button type="button" className="waka-settings-erase" disabled={verification === 'checking'}
        onClick={() => verification === 'verified' ? onDone() : void checkConnection()}>
        {say(verification === 'verified' ? 'profileConnectionViewDevices' : verification === 'checking' ? 'profileConnectionChecking' : 'profileConnectionCheck')}
      </button>
    </div>
  </section>;
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
  if (id === 'danger') return <button type="button" className="waka-settings-erase waka-settings-delete"
    data-settings-target={id} onClick={() => setOpen(id)}>{label}</button>;
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
