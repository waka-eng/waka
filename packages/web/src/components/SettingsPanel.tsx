import { ProfileMcpSetup } from './ProfileMcpSetup';
import { useCallback, useEffect, useRef, useState } from "react";
import { bookmarkletHref } from "../lib/bookmarklet";
import { ProfileApiKeys } from './ProfileApiKeys';

import { fetchProfiles, type ApiOwnedProfile } from "../lib/api/profiles";
import { fetchSessions, revokeSession, type ApiSession } from "../lib/api/sessions";
import { supportedLocales } from "../lib/i18n";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";
import { SurfaceHeader } from "./SurfaceHeader";

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
  /** Receives this panel's "<" handler (one level up, or close at the root),
      so the card's Escape does exactly what the "<" does. */
  onBackHandler?: (handler: (() => void) | null) => void;
  activeProfileId?: string;
  /** Called after any press that should put the panel away. */
  onClose: () => void;
}

/** The current Settings subpage; null is the overview. */
type Open = null | "personal" | "sessions" | "danger";

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  /* React will not render a `javascript:` href, by design; the bookmarklet's
     one is set on the element after it mounts. */
  const bookmarklet = useRef<HTMLAnchorElement>(null);
  useEffect(() => { bookmarklet.current?.setAttribute('href', bookmarkletHref(window.location.origin)); });
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
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [personalProfile, setPersonalProfile] = useState<ApiOwnedProfile | null>(null);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [profileAttempt, setProfileAttempt] = useState(0);
  useEffect(() => {
    if (open !== 'personal' || personalProfile) return;
    const controller = new AbortController();
    setProfileLoadFailed(false);
    fetchProfiles(controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      const human = rows.find(row => row.type === 'human');
      if (!human) throw new Error('Personal profile missing');
      setPersonalProfile(human);
    }).catch(() => { if (!controller.signal.aborted) setProfileLoadFailed(true); });
    return () => controller.abort();
  }, [open, personalProfile, profileAttempt]);
  const stepUp = () => {
    if (open === null) props.onClose();
    else { setConfirmDelete(false); setOpen(null); }
  };
  const stepUpRef = useRef(stepUp); stepUpRef.current = stepUp;
  useEffect(() => {
    props.onBackHandler?.(() => stepUpRef.current());
    return () => props.onBackHandler?.(null);
  }, []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <div ref={panel} className="waka-settings" role="group" aria-label={say("worldSettingsOpen")}>
      <SurfaceHeader locale={props.locale}
        back={{ kind: open === null ? "close" : "back", onBack: stepUp }}
        titleRef={heading}
        title={say(open === "personal" ? "profilePersonalTitle" : open === "sessions" ? "profileSessionsTitle" : open === "danger" ? "profileDelete" : "worldSettingsOpen")} />
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

      {/* SAVE FROM ANYWHERE: the bookmarklet opens this app's /share with
          the page it was pressed on (see lib/bookmarklet.ts). */}
      {/* ONE ROW PER PLACE YOU MIGHT BE (design F6). Only the doors that
          exist today are listed: the iPhone share extension and dropping
          onto the home are drawn in the frame but not built yet, and a row
          promising them would be a control that lies (Law 1). */}
      <div className="waka-account-field waka-save-anywhere" role="group" aria-labelledby="waka-save-anywhere-title">
        <span id="waka-save-anywhere-title">{say("profileSaveAnywhere")}</span>
        <div className="waka-save-anywhere-row">
          <strong>{say("profileSaveAnywhereShareTitle")}</strong>
          <small>{say("profileSaveAnywhereShareHint")}</small>
        </div>
        <div className="waka-save-anywhere-row">
          <strong>{say("profileSaveAnywhereBrowserTitle")}</strong>
          <small>{say("profileBookmarkletHint")}</small>
          <a ref={bookmarklet} className="waka-bookmarklet" draggable
            onClick={(event) => event.preventDefault()}>{say("profileBookmarkletName")}</a>
        </div>
      </div>
      </> : null}

      <Group id="personal" open={open} setOpen={setOpen} label={say('profilePersonalMcpTitle')}>
        {personalProfile ? <PersonalConnections key={personalProfile.id} locale={props.locale} profile={personalProfile} />
          : profileLoadFailed ? <>
            <p className="waka-account-failed" role="alert">{say('profilePersonalMcpLoadError')}</p>
            <button type="button" className="waka-settings-erase" onClick={() => setProfileAttempt(attempt => attempt + 1)}>{say('worldRetry')}</button>
          </> : <p className="waka-settings-note" role="status">{say('worldInspirationsLoad')}</p>}
      </Group>

      <Group id="sessions" open={open} setOpen={setOpen} label={say("profileSessionsTitle")}>
        <ProfileConnections locale={props.locale} />
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
        {/* A DESTRUCTIVE CONFIRM ALWAYS OFFERS CANCEL (nav system R8), as
            every other confirm in the product does. */}
        <div className="waka-session-actions">
          {confirmDelete && !deleting ? <button type="button" className="waka-settings-erase"
            onClick={() => setConfirmDelete(false)}>{say("profileConnectionCancel")}</button> : null}
          <button type="button" className="waka-settings-erase" disabled={deleting}
            onClick={() => {
              if (!confirmDelete) { setConfirmDelete(true); return; }
              setDeleting(true);
              void props.onDeleteAccount().finally(() => { if (alive.current) setDeleting(false); });
            }}>
            {say(deleting ? "profileRemoving" : confirmDelete ? "worldDeleteItAnyway" : "profileDelete")}
          </button>
        </div>
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

/** Device access can be revoked without selecting or deleting a memory owner. */
function ProfileConnections({ locale }: { locale: SupportedLocale }): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const [sessions, setSessions] = useState<ApiSession[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
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
  const others = sessions?.filter(row => !row.current && new Date(row.expiresAt).getTime() > Date.now());
  const date = (value: string) => new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  return <>
    {error ? <span className="waka-account-failed" role="alert">{error}</span> : null}
    <div className="waka-session-list-heading">
      <h3>{say('profileConnectionsLive')}</h3>
      <button type="button" className="waka-settings-erase" disabled={loading || busy !== null} onClick={() => void load()}>
        {say("profileConnectionsRefresh")}
      </button>
    </div>
    <p className="waka-settings-note">{say('profileAccountConnectionsHint')}</p>
    {notice ? <p className="waka-settings-note" role="status">{notice}</p> : null}
    {loading ? <p className="waka-settings-note" role="status">{say("worldInspirationsLoad")}</p> : null}
    {others?.length === 0 && !loading ? <p className="waka-settings-note">
      {say('profileAccountConnectionsEmpty')}
    </p> : null}
    <ul ref={list} className="waka-session-list" aria-busy={loading}>
      {others?.map((session) => {
        const name = session.deviceLabel || say("profileConnectionUnnamed");
        return <li key={session.id} className="waka-session-card">
          <div className="waka-session-card-heading">
            <strong>{name}</strong>
            <span>{say('profileConnectionSignedIn')}</span>
          </div>
          <dl className="waka-session-info">
            {session.verifiedAt ? <><dt>{say('profileMcpLastVerified')}</dt><dd>{date(session.verifiedAt)}</dd></> : null}
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
  </>;
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
