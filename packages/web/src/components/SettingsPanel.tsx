import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { bookmarkletHref } from "../lib/bookmarklet";

import { changePassword } from "../lib/api/auth";
import { apiPath, ApiError, getJson } from "../lib/api/http";
import { isMobileBuild, platformServices } from "../lib/platform";
import { checkedNativeApiOrigin } from "../lib/platform/api-origin";
import { fetchProfiles, type ApiOwnedProfile } from "../lib/api/profiles";
import { fetchSessions, revokeSession, type ApiSession } from "../lib/api/sessions";
import { fetchIntroductions, setIntroductionConsent } from "../lib/api/introductions";
import { INTRODUCTIONS_CHANGED } from "../lib/introductions";
import { supportedLocales } from "../lib/i18n";
import { formatMessage, t, type SupportedLocale } from "../lib/locales";
import { SurfaceHeader } from "./SurfaceHeader";
const LegalArticle = lazy(() => import("../pages/LegalDocument").then(module => ({ default: module.LegalArticle })));
import { HowItWorksBody } from "./HowItWorksPanel";
import { ConnectTools } from "./ConnectTools";

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
  /** Opens Trash, where deleted inspirations wait 30 days (founder,
      2026-11-26: "put trash in profile or sth"). */
  onOpenTrash?: () => void;
}

/** The current Settings subpage; null is the overview. */
type Open = null | "account" | "sessions" | "password" | "danger" | "info" | "terms" | "privacy";
/* PROGRESSIVE DISCLOSURE (founder, 2026-11-27: "use more progressive
   disclosure"): everything about you sits behind one Account row, and its
   own pages step back to it, not to the overview. */
const PARENT: Record<Exclude<Open, null>, Open> = { account: null, info: null, terms: null, privacy: null, password: "account", sessions: "account", danger: "account" };

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
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const stepUp = () => {
    if (open === null) props.onClose();
    else { setConfirmDelete(false); setOpen(PARENT[open]); }
  };
  const stepUpRef = useRef(stepUp); stepUpRef.current = stepUp;
  useEffect(() => {
    props.onBackHandler?.(() => stepUpRef.current());
    return () => props.onBackHandler?.(null);
  }, []);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  /* The same elements are rows in the overview and pages when one is open. */
  const groups = <SettingsGroups open={open} setOpen={setOpen} say={say} locale={props.locale} />;
  const danger = <DangerGroup open={open} setOpen={setOpen} say={say}
    confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} deleting={deleting}
    onDelete={() => {
      setDeleting(true);
      void props.onDeleteAccount().finally(() => { if (alive.current) setDeleting(false); });
    }} />;

  return (
    <div ref={panel} className="waka-settings" role="group" aria-label={say("worldSettingsOpen")}>
      <SurfaceHeader locale={props.locale}
        back={{ kind: open === null ? "close" : "back", onBack: stepUp }}
        titleRef={heading}
        title={say(open === "account" ? "settingsGroupAccount" : open === "sessions" ? "profileSessionsTitle" : open === "password" ? "profileChangePassword" : open === "danger" ? "profileDelete" : open === "info" ? "worldHowItWorksTitle" : open === "terms" ? "legalTermsLink" : open === "privacy" ? "legalPrivacyLink" : "worldSettingsOpen")} />
      <div className="waka-settings-content" key={open ?? "overview"}>
      {/* ═══ FOUR GROUPS, ONE HEADING STYLE (craft audit, 2026-11-26) ══════
          Founder: "spacing padding can be better ... the workflow
          categorization design padding Text". The overview was a loose
          address line, two fields, a label that was really a heading, a bare
          line of text that was really a row, three rows, underlined links
          bigger than everything and two bare buttons, each on its own gap.
          Now: Account, Save from anywhere, Data and connections, About; one
          small muted heading each, one left edge, 24px between groups. */}
      {/* ═══ FOUR BLOCKS, AND EVERYTHING ABOUT YOU BEHIND ONE ROW (founder,
          2026-11-27: "dividers between sections ... a section for sign out
          and delete account ... more progressive disclosure") ═══ The
          overview is Account (one row), Your data, About and Sign out, each
          its own block. Connecting Claude Code or Codex and Save from
          anywhere left Settings for Connect, a door of its own on home. */}
      {open === null ? <>
      <section className="waka-settings-section waka-settings-block" aria-labelledby="waka-settings-account">
        <h3 id="waka-settings-account" className="waka-settings-heading">{say("settingsGroupAccount")}</h3>
        <div className="waka-settings-list">
          <button type="button" className="waka-settings-row waka-settings-me" data-settings-target="account" onClick={() => setOpen("account")}>
            <span className="waka-settings-me-text">
              <span>{props.name || say("settingsGroupAccount")}</span>
              {props.email ? <span className="waka-settings-me-email">{props.email}</span> : null}
            </span>
            <span className="waka-settings-chevron" aria-hidden="true">›</span>
          </button>
        </div>
      </section>

      <section className="waka-settings-section waka-settings-block" aria-labelledby="waka-settings-data">
        <h3 id="waka-settings-data" className="waka-settings-heading">{say("settingsGroupData")}</h3>
        <div className="waka-settings-list">
          <ProfileExportControl locale={props.locale} />
          <IntroductionsControl locale={props.locale} />
          {props.onOpenTrash ? <button type="button" className="waka-settings-row" onClick={() => { props.onClose(); props.onOpenTrash?.(); }}>
            {say("worldDeletedShelf")}
            {/* IT LEAVES SETTINGS FOR A PAGE OF ITS OWN (founder, 2026-11-27:
                "make clear it's gonna open a separate page"), so it ends in
                the arrow that goes out, not the ">" that steps within. */}
            <svg className="waka-settings-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M8 16 16 8M9 8h7v7" /></svg>
          </button> : null}
        </div>
      </section>

      <section className="waka-settings-section waka-settings-block" aria-labelledby="waka-settings-about">
        <h3 id="waka-settings-about" className="waka-settings-heading">{say("settingsGroupAbout")}</h3>
        <div className="waka-settings-list">
          <Group id="info" open={open} setOpen={setOpen} label={say("worldHowItWorksTitle")}><HowItWorksBody locale={props.locale} /></Group>
          {/* In Settings, as pages with "<" back (no dead end). */}
          <Group id="terms" open={open} setOpen={setOpen} label={say("legalTermsLink")}><Suspense fallback={null}><LegalArticle kind="terms" /></Suspense></Group>
          <Group id="privacy" open={open} setOpen={setOpen} label={say("legalPrivacyLink")}><Suspense fallback={null}><LegalArticle kind="privacy" /></Suspense></Group>
        </div>
      </section>

      <section className="waka-settings-section waka-settings-block waka-settings-leave" aria-label={say("worldSignOutLower")}>
        <div className="waka-settings-list">
          <button type="button" className="waka-settings-row waka-account-out" onClick={() => { props.onClose(); props.onSignOut(); }}>
            {say("worldSignOutLower")}
          </button>
        </div>
      </section>
      </> : open === "account" ? <>
      <section className="waka-settings-section" aria-label={say("settingsGroupAccount")}>
        {/* WHO THIS IS. Not editable: the address identifies the account
            and changing it is a different act with its own verification.
            Shown as a read-only value under its own label, like the fields. */}
        {props.email ? <div className="waka-account-field waka-settings-fact">
          <span>{say("settingsEmailLabel")}</span>
          <p className="waka-settings-who">{props.email}</p>
        </div> : null}

        <label className="waka-account-field">
          <span>{say("profileNickname")}</span>
          <input type="text" value={props.name} aria-busy={props.nameBusy} autoComplete="name"
            onChange={(event) => props.onName(event.currentTarget.value)} />
        </label>

        <label className="waka-account-field">
          <span>{say("profileLanguageLabel")}</span>
          {/* STRIPPED: "The language WAKA uses with you." under the label.
              Founder, 2026-11-12: "strip all unnecessary descriptive text across the experience". */}
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
      </section>
      <section className="waka-settings-section waka-settings-block" aria-label={say("profileChangePassword")}>
        <div className="waka-settings-list">{groups}</div>
      </section>
      {/* DELETE ACCOUNT AT THE VERY BOTTOM OF ACCOUNT, as iOS keeps it: never
          on the overview, one page and two presses away. */}
      <section className="waka-settings-section waka-settings-block waka-settings-leave" aria-label={say("profileDelete")}>
        <div className="waka-settings-list">{danger}</div>
      </section>
      </> : <>{groups}{danger}<Group id="info" open={open} setOpen={setOpen} label={say("worldHowItWorksTitle")}><HowItWorksBody locale={props.locale} /></Group>
        <Group id="terms" open={open} setOpen={setOpen} label={say("legalTermsLink")}><Suspense fallback={null}><LegalArticle kind="terms" /></Suspense></Group>
        <Group id="privacy" open={open} setOpen={setOpen} label={say("legalPrivacyLink")}><Suspense fallback={null}><LegalArticle kind="privacy" /></Suspense></Group></>}
      </div>
    </div>
  );
}

function SettingsGroups({ open, setOpen, say, locale }: {
  open: Open;
  setOpen: (next: Open) => void;
  say: (key: Parameters<typeof t>[1]) => string;
  locale: SupportedLocale;
}): JSX.Element {
  return <>
      <Group id="sessions" open={open} setOpen={setOpen} label={say("profileSessionsTitle")}>
        <ProfileConnections locale={locale} />
      </Group>

      <Group id="password" open={open} setOpen={setOpen} label={say("profileChangePassword")}>
        <PasswordChangeForm locale={locale} />
      </Group>
  </>;
}

function DangerGroup({ open, setOpen, say, confirmDelete, setConfirmDelete, deleting, onDelete }: {
  open: Open;
  setOpen: (next: Open) => void;
  say: (key: Parameters<typeof t>[1]) => string;
  confirmDelete: boolean;
  setConfirmDelete: (value: boolean) => void;
  deleting: boolean;
  onDelete: () => void;
}): JSX.Element | null {
  return (
      /* ═══ THE ONE IRREVERSIBLE ACT, LAST AND TWICE-PRESSED ═════════════
          At the foot, behind a disclosure, behind a second press. The page
          this replaces had it behind a disclosure too and that part was
          right. */
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
              onDelete();
            }}>
            {say(deleting ? "profileRemoving" : confirmDelete ? "worldDeleteItAnyway" : "profileDelete")}
          </button>
        </div>
      </Group>
  );
}

function PasswordChangeForm({ locale }: { locale: SupportedLocale }): JSX.Element {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [notice, setNotice] = useState<Parameters<typeof t>[1]>();
  const busy = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);

  const submit = async () => {
    if (busy.current) return;
    busy.current = true;
    setSubmitting(true);
    setNotice(undefined);
    try {
      await changePassword({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setNotice("profilePasswordChanged");
    } catch (error) {
      if (error instanceof ApiError && error.code === "incorrect_current_password") setNotice("profilePasswordIncorrect");
      else if (error instanceof ApiError && error.code === "password_not_set") setNotice("profilePasswordNotSet");
      else if (error instanceof ApiError && error.status === 400) setNotice("profilePasswordInvalid");
      else if (error instanceof ApiError && error.status === 429) setNotice("profilePasswordWait");
      else if (error instanceof ApiError && error.status === 401) setNotice("profilePasswordSignIn");
      else setNotice("profilePasswordUnconfirmed");
    } finally {
      busy.current = false;
      setSubmitting(false);
    }
  };

  return <form className="waka-settings-body" aria-busy={submitting}
    onSubmit={event => { event.preventDefault(); void submit(); }}>
    <label className="waka-account-field">
      <span>{say("profileCurrentPassword")}</span>
      <input type="password" autoComplete="current-password" required maxLength={200}
        value={currentPassword} disabled={submitting} onChange={event => setCurrentPassword(event.currentTarget.value)} />
    </label>
    <label className="waka-account-field">
      <span>{say("profileNewPassword")}</span>
      <input type="password" autoComplete="new-password" required minLength={8} maxLength={200}
        value={newPassword} disabled={submitting} onChange={event => setNewPassword(event.currentTarget.value)} />
    </label>
    <p className="waka-settings-note">{say("profilePasswordRevokesSessions")}</p>
    {notice ? <p className="waka-settings-note" role={notice === "profilePasswordChanged" ? "status" : "alert"}>{say(notice)}</p> : null}
    <div className="waka-session-actions">
      <button type="submit" className="waka-settings-erase" disabled={submitting}>{say("profileChangePassword")}</button>
    </div>
  </form>;
}

/** How long Download my data waits before it says it failed. */
const EXPORT_DEADLINE_MS = 60_000;

function ProfileExportControl({ locale }: { locale: SupportedLocale }) {
  const pending = useRef<AbortController | null>(null);
  const objectUrl = useRef<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<"profileExportTooLarge" | "profileExportFailed">();
  useEffect(() => () => {
    pending.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);

  async function prepare() {
    if (pending.current || objectUrl.current) return;
    const request = new AbortController();
    pending.current = request;
    setError(undefined);
    setBusy(true);
    /* NEVER STUCK (founder, 2026-11-27: "it's just like stuck here"): a read
       that has not answered in a minute is called failed, with its retry. */
    let timedOut = false;
    const deadline = window.setTimeout(() => { timedOut = true; request.abort(); }, EXPORT_DEADLINE_MS);
    try {
      if (isMobileBuild) {
        await (await platformServices()).openBrowser(checkedNativeApiOrigin());
      } else {
        const bundle = await getJson<{ export: unknown }>(apiPath("/export"), "Could not prepare export", request.signal);
        if (request.signal.aborted) return;
        if (!bundle?.export || typeof bundle.export !== "object") throw new Error("Invalid profile export");
        const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
        objectUrl.current = URL.createObjectURL(blob);
        setUrl(objectUrl.current);
        /* ONE PRESS: the file starts downloading as soon as it is ready; the
           row then offers it again by its own link. */
        const link = document.createElement("a");
        link.href = objectUrl.current; link.download = "waka-profile.json";
        document.body.append(link); link.click(); link.remove();
      }
    } catch (failure) {
      if (timedOut) setError("profileExportFailed");
      else if (!request.signal.aborted) {
        setError(failure instanceof ApiError && failure.code === "export_too_large"
          ? "profileExportTooLarge" : "profileExportFailed");
      }
    } finally {
      window.clearTimeout(deadline);
      pending.current = null;
      if (!request.signal.aborted || timedOut) setBusy(false);
    }
  }

  /* A ROW LIKE ITS NEIGHBOURS (craft audit, 2026-11-26: it was a bare line
     of text with 44px of nothing above and below). It ends in a download
     glyph rather than a chevron because it does not open a page. */
  const glyph = <svg className="waka-settings-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14" /></svg>;
  return (
    <div className="waka-settings-export">
      {url ? (
        <a className="waka-settings-row" href={url} download="waka-profile.json">{t(locale, "profileExportDownload")}{glyph}</a>
      ) : (
        <button type="button" className="waka-settings-row" disabled={busy} onClick={() => void prepare()}>
          {/* GETTING READY IS THE ROW'S OWN WORDS (founder, 2026-11-27: a
              line under it sat outside the panel's padding), not a line below. */}
          <span role={busy ? "status" : undefined}>{t(locale, busy ? "profileExportPreparing" : isMobileBuild ? "profileExportInBrowser" : "profileExportPrepare")}</span>{glyph}
        </button>
      )}
      {isMobileBuild && <p className="waka-settings-note">{t(locale, "profileExportBrowserHint")}</p>}
      {error && <p className="waka-account-failed" role="alert">{t(locale, error)}</p>}
    </div>
  );
}

/**
 * INTRODUCTIONS, WHERE THE OTHER PRIVACY CONTROLS LIVE (design "Agent
 * introductions", approved 2026-11-27). One row that names its act: turn
 * on, or turn off. Shown where the feature is offered, and always while it
 * is on, so withdrawing never depends on the feature being offered.
 */
function IntroductionsControl({ locale }: { locale: SupportedLocale }): JSX.Element | null {
  const [state, setState] = useState<{ available: boolean; enabled: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  /* Read on open, and again whenever home's bubble flips the switch, so the
     row never offers the act that was just done. */
  useEffect(() => {
    let live = true;
    const read = (event?: Event) => (event as CustomEvent<{ source?: string }> | undefined)?.detail?.source === "settings" ? undefined : void fetchIntroductions()
      .then((next) => { if (live) setState({ available: next.available, enabled: next.consent.enabled }); }).catch(() => undefined);
    read();
    window.addEventListener(INTRODUCTIONS_CHANGED, read);
    return () => { live = false; window.removeEventListener(INTRODUCTIONS_CHANGED, read); };
  }, []);
  if (!state || (!state.available && !state.enabled)) return null;
  const flip = () => {
    const enabled = !state.enabled;
    setBusy(true); setFailed(false);
    /* Home hears it too, so its bubble never speaks for the old switch. */
    void setIntroductionConsent(enabled).then(() => {
      setState({ ...state, enabled });
      window.dispatchEvent(new CustomEvent(INTRODUCTIONS_CHANGED, { detail: { enabled, source: "settings" } }));
    })
      .catch(() => setFailed(true)).finally(() => setBusy(false));
  };
  return (
    <div className="waka-settings-introductions">
      <button type="button" className="waka-settings-row" disabled={busy} aria-pressed={state.enabled} onClick={flip}>
        {t(locale, state.enabled ? "introTurnOff" : "introTurnOn")}
      </button>
      <p className="waka-settings-note">{t(locale, "introSettingsFine")}</p>
      {failed ? <p className="waka-account-failed" role="alert">{t(locale, "introChangeFailed")}</p> : null}
    </div>
  );
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
  const live = sessions?.filter(row => new Date(row.expiresAt).getTime() > Date.now());
  const current = live?.find(row => row.current);
  const others = live?.filter(row => !row.current);
  const date = (value: string) => new Date(value).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" });

  /* ONE PRESS FOR EVERY OTHER DEVICE (craft audit, 2026-11-26: thirty
     identical cards and no way out of them but thirty presses). The API
     revokes one session at a time, so this asks once and then revokes each
     in turn; any that fail stay on screen with the error. */
  const disconnectOthers = async () => {
    if (!others?.length) return;
    setBusy("others");
    setError("");
    setNotice("");
    const ended: string[] = [];
    for (const session of others) {
      try { await revokeSession(session.id); ended.push(session.id); } catch { /* reported below */ }
      if (!alive.current) return;
    }
    setSessions(rows => rows?.filter(row => !ended.includes(row.id)) ?? null);
    setConfirm(null);
    setBusy(null);
    if (ended.length === others.length) setNotice(say("profileConnectionSignOutOthersDone"));
    else setError(say("profileConnectionDisconnectError"));
  };

  return <>
    {error ? <span className="waka-account-failed" role="alert">{error}</span> : null}
    {notice ? <p className="waka-settings-note" role="status">{notice}</p> : null}
    {loading ? <p className="waka-settings-note" role="status">{say("worldInspirationsLoad")}</p> : null}
    {/* THIS DEVICE FIRST, so the list starts from the one you are holding. */}
    {current ? <div className="waka-session-current">
      <span className="waka-session-name">{current.deviceLabel || say("profileConnectionUnnamed")}</span>
      <span className="waka-session-meta">{say("profileConnectionThisDevice")}</span>
    </div> : null}
    {others?.length === 0 && !loading ? <p className="waka-settings-note">
      {say('profileAccountConnectionsEmpty')}
    </p> : null}
    {/* THE ACTS COME BEFORE THE LIST, so "Sign out everywhere else" is not
        under eighty rows (the look account had 82). */}
    <div className="waka-session-foot">
      {others && others.length > 1 ? (confirm === "others" ? <div className="waka-session-confirm">
        <p ref={confirmation} tabIndex={-1}>{say("profileConnectionSignOutOthersHint")}</p>
        <div className="waka-session-actions">
          <button type="button" className="waka-settings-erase" disabled={busy !== null} onClick={() => setConfirm(null)}>{say("profileConnectionCancel")}</button>
          <button type="button" className="waka-settings-erase" disabled={busy !== null} onClick={() => void disconnectOthers()}>
            {say(busy === "others" ? "profileConnectionDisconnecting" : "profileConnectionSignOutOthersConfirm")}</button>
        </div>
      </div> : <button type="button" className="waka-settings-erase" data-session-id="others" disabled={loading || busy !== null}
        onClick={() => { setConfirm("others"); setNotice(""); }}>{say("profileConnectionSignOutOthers")}</button>) : null}
      <button type="button" className="waka-settings-erase" disabled={loading || busy !== null} onClick={() => void load()}>
        {say("profileConnectionsRefresh")}
      </button>
    </div>
    <ul ref={list} className="waka-session-list" aria-busy={loading}>
      {others?.map((session) => {
        const name = session.deviceLabel || say("profileConnectionUnnamed");
        return <li key={session.id} className="waka-session-card">
          <div className="waka-session-line">
            <span className="waka-session-text">
              <span className="waka-session-name">{name}</span>
              <span className="waka-session-meta">{say("profileConnectionLastUsed")} {date(session.verifiedAt ?? session.lastSeenAt)}</span>
            </span>
            {confirm === session.id ? null : <button type="button" className="waka-settings-erase" disabled={loading || busy !== null} onClick={() => { setConfirm(session.id); setNotice(""); }}
              data-session-id={session.id}
              aria-label={formatMessage(locale, "profileConnectionDisconnectLabel", { name })}>
              {say("profileConnectionDisconnect")}
            </button>}
          </div>
          {confirm === session.id ? <div className="waka-session-confirm">
            <p ref={confirmation} tabIndex={-1}>{formatMessage(locale, "profileConnectionDisconnectHint", { name })}</p>
            <div className="waka-session-actions">
              <button type="button" className="waka-settings-erase" disabled={busy !== null} onClick={() => setConfirm(null)}>{say("profileConnectionCancel")}</button>
              <button type="button" className="waka-settings-erase" disabled={busy !== null} onClick={() => void disconnect(session)}
                aria-label={formatMessage(locale, "profileConnectionDisconnectLabel", { name })}>{say(busy === session.id ? "profileConnectionDisconnecting" : "profileConnectionDisconnect")}</button>
            </div>
          </div> : null}
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
  if (open === id) return <div className="waka-settings-body">{children}</div>;
  /* Its row stands only on the page above it. */
  if (open !== PARENT[id]) return null;
  if (id === 'danger') return <button type="button" className="waka-settings-row waka-settings-delete"
    data-settings-target={id} onClick={() => setOpen(id)}>{label}</button>;
  return (
    <button type="button" className="waka-settings-row" data-settings-target={id}
      onClick={() => setOpen(id)}>
      {label}
      <span className="waka-settings-chevron" aria-hidden="true">›</span>
    </button>
  );
}

/**
 * ═══ CONNECT (founder, 2026-11-27: "workflows that we want people to do such
 * as use WAKA in Claude Code or Codex ... should be a lot more prominent ...
 * a separate button outside of settings with a connector icon") ═══
 * The doors in and out of WAKA, together: your AI tools reading what WAKA
 * knows about you (Claude Code, Codex, their keys and what they read), and
 * the browser button that brings a page in.
 */
export function ConnectPanel({ locale, onClose }: { locale: SupportedLocale; onClose: () => void }): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  /* React will not render a `javascript:` href, by design; the bookmarklet's
     one is set on the element after it mounts. */
  const bookmarklet = useRef<HTMLAnchorElement>(null);
  useEffect(() => { bookmarklet.current?.setAttribute('href', bookmarkletHref(window.location.origin)); });
  const [dragHint, setDragHint] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [profile, setProfile] = useState<ApiOwnedProfile | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setFailed(false);
    fetchProfiles(controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      const human = rows.find(row => row.type === 'human');
      if (!human) throw new Error('Personal profile missing');
      setProfile(human);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [attempt]);
  return (
    <div className="waka-settings waka-connect" role="group" aria-label={say("connectTitle")}>
      <SurfaceHeader locale={locale} back={{ kind: "close", onBack: onClose }} title={say("connectTitle")} />
      <div className="waka-settings-content">
        <section className="waka-settings-section" aria-labelledby="waka-connect-tools">
          <h3 id="waka-connect-tools" className="waka-settings-heading">{say("connectToolsHeading")}</h3>
          {profile ? <ConnectTools key={profile.id} locale={locale} profile={profile} />
            : failed ? <>
              <p className="waka-account-failed" role="alert">{say('profilePersonalMcpLoadError')}</p>
              <button type="button" className="waka-settings-erase" onClick={() => setAttempt(n => n + 1)}>{say('worldRetry')}</button>
            </> : <p className="waka-settings-note" role="status">{say('worldInspirationsLoad')}</p>}
        </section>
        {isMobileBuild ? null : <section className="waka-settings-section waka-save-anywhere" aria-labelledby="waka-connect-in">
          <h3 id="waka-connect-in" className="waka-settings-heading">{say("connectBringIn")}</h3>
          {/* SAVE FROM ANYWHERE, behind its own row: the bookmarklet opens this
              app's /share with the page it was pressed on (lib/bookmarklet.ts). */}
          <section className="waka-connect-tool" aria-label={say("connectBrowserButton")}>
            <button type="button" className="waka-connect-tool-head" aria-expanded={browserOpen} onClick={() => setBrowserOpen(was => !was)}>
              <span className="waka-connect-tool-name"><span>{say("connectBrowserButton")}</span>
                <span className="waka-connect-tool-status">{say("connectBrowserStatus")}</span></span>
              <span className="waka-connect-tool-act"><span className="waka-settings-chevron" aria-hidden="true">{browserOpen ? '⌄' : '›'}</span></span>
            </button>
            {/* THREE STEPS, BECAUSE IT DID NOT WORK AS ONE LINE (founder,
                2026-11-27: "how is this supposed to work? it doesn't work at
                all"): the bookmarks bar is hidden by default, so a drag had
                nowhere to land, and a press here can do nothing. */}
            {browserOpen ? <ol className="waka-connect-steps">
              <li><span className="waka-connect-step-title">{say("connectBrowserStepBar")}</span></li>
              <li><span className="waka-connect-step-title">{say("connectBrowserStepDrag")}</span>
                <a ref={bookmarklet} className="waka-bookmarklet" draggable
                  onClick={(event) => { event.preventDefault(); setDragHint(true); }}>{say("profileBookmarkletName")}</a>
                {dragHint ? <p className="waka-settings-note" role="status">{say("profileBookmarkletDragHint")}</p> : null}</li>
              <li><span className="waka-connect-step-title">{say("connectBrowserStepUse")}</span></li>
            </ol> : null}
          </section>
        </section>}
      </div>
    </div>
  );
}
