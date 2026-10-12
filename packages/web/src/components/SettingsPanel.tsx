/**
 * ═══ SETTINGS, AND NOWHERE ELSE ═════════════════════════════════════════
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
 *   `createAgentKey` STAYS and is still called when an agent is made; what
 *   went is the UI for reading and revoking them by hand.
 *
 *   WHAT AGENTS MAY READ — grants, which govern the keys above. With no
 *   key listing there is nothing to grant against.
 *
 *   CONNECTIONS and THE READ RECORD — who you are connected to and who has
 *   read you. Both are about people-to-people reading, and the product has
 *   no people-to-people surface since rooms were removed. A control for a
 *   model the product no longer has teaches that model.
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
 * they keep, whether there is a public page, how to leave, and how to
 * erase the account. Six, where there were eleven.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../lib/api";
import { createAgentKey } from "../lib/api/agents";
import {
  createProfile,
  deleteProfile,
  fetchProfiles,
  renameProfile,
  type ApiOwnedProfile,
} from "../lib/api/profiles";
import { supportedLocales } from "../lib/i18n";
import { t, type SupportedLocale } from "../lib/locales";

export interface SettingsPanelProps {
  locale: SupportedLocale;
  /** Who is signed in. The address identifies the account and is not editable. */
  email: string | null;
  name: string;
  onName: (value: string) => void;
  onLocale: (value: SupportedLocale) => void;
  /** True while a name or language write is in flight. */
  busy: boolean;
  /** True when the last write was refused; silence is the success state. */
  failed: boolean;
  /** The public page's current settings, and a way to change them. */
  publicPage: {
    handle: string;
    profileEnabled: boolean;
    topOfMindEnabled: boolean;
    save: (next: { handle: string; profileEnabled: boolean; topOfMindEnabled: boolean }) => Promise<void>;
  };
  onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
  /** Called after any press that should put the panel away. */
  onClose: () => void;
}

/** Which group is expanded. One at a time: this is a panel, not a page. */
type Open = null | "agents" | "public" | "danger";

export function SettingsPanel(props: SettingsPanelProps): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(props.locale, key), [props.locale]);
  const [open, setOpen] = useState<Open>(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  /* ═══ THE AGENTS, LOADED ONLY IF SOMEBODY OPENS THEM ═══════════════════
     Most people have one agent and never touch this. Fetching the roster
     every time the gear is pressed would put a round trip behind a press
     whose usual purpose is to read an email address or sign out. */
  const [agents, setAgents] = useState<ApiOwnedProfile[] | null>(null);
  const [agentTrouble, setAgentTrouble] = useState("");
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [newAgent, setNewAgent] = useState("");
  useEffect(() => {
    if (open !== "agents" || agents !== null) return;
    fetchProfiles()
      .then((rows) => { if (alive.current) setAgents(rows); })
      .catch(() => { if (alive.current) setAgentTrouble(say("profileMemoriesError")); });
  }, [open, agents, say]);

  const addAgent = async () => {
    const name = newAgent.trim();
    if (!name) return;
    setBusyAgent("new"); setAgentTrouble("");
    try {
      const made = await createProfile(name);
      /* AN AGENT WITHOUT A KEY CANNOT BE REACHED, so one is minted with it
         — the same pairing the page it replaces made. The key listing is
         gone; the key is not. */
      await createAgentKey(made.id).catch(() => undefined);
      if (!alive.current) return;
      setAgents((rows) => [...(rows ?? []), made]);
      setNewAgent("");
    } catch (err) {
      if (alive.current) setAgentTrouble(err instanceof ApiError ? err.message : say("profileMemoriesError"));
    } finally {
      if (alive.current) setBusyAgent(null);
    }
  };

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [handle, setHandle] = useState(props.publicPage.handle);
  const [onPage, setOnPage] = useState(props.publicPage.profileEnabled);
  const [onReading, setOnReading] = useState(props.publicPage.topOfMindEnabled);
  const [publicBusy, setPublicBusy] = useState(false);

  return (
    <div className="waka-settings" role="group" aria-label={say("worldSettingsOpen")}>
      {/* WHO THIS IS. Not editable, and not a field: the address identifies
          the account and changing it is a different act with its own
          verification. */}
      {props.email ? <p className="waka-settings-who">{props.email}</p> : null}

      <label className="waka-account-field">
        <span>{say("profileNickname")}</span>
        <input type="text" value={props.name} disabled={props.busy} autoComplete="name"
          onChange={(event) => props.onName(event.currentTarget.value)} />
      </label>

      <label className="waka-account-field">
        <span>{say("profileLanguageLabel")}</span>
        <select value={props.locale} disabled={props.busy}
          onChange={(event) => props.onLocale(event.currentTarget.value as SupportedLocale)}>
          {supportedLocales.map((option) => (
            <option key={option.code} value={option.code}>{option.nativeLabel}</option>
          ))}
        </select>
      </label>

      {props.failed ? (
        <span className="waka-account-failed" role="alert">{say("profileSaveError")}</span>
      ) : null}

      {/* ═══ THREE DISCLOSURES, ONE OPEN AT A TIME ════════════════════════
          Everything below is something a person does rarely and reads
          carefully. Laying all three out would make this panel a page
          again, which is the thing being removed. */}
      <Group id="agents" open={open} setOpen={setOpen} label={say("profileMemoriesTitle")}>
        {agentTrouble ? <span className="waka-account-failed" role="alert">{agentTrouble}</span> : null}
        {agents === null ? (
          <p className="waka-settings-note" role="status">{say("worldInspirationsLoad")}</p>
        ) : (
          <ul className="waka-settings-rows">
            {agents.map((agent) => (
              <li key={agent.id}>
                <input type="text" defaultValue={agent.name} disabled={busyAgent === agent.id}
                  aria-label={say("profileNickname")}
                  onBlur={(event) => {
                    const next = event.currentTarget.value.trim();
                    if (!next || next === agent.name) return;
                    setBusyAgent(agent.id);
                    void renameProfile(agent.id, next)
                      .then((row) => { if (alive.current) setAgents((rows) => (rows ?? []).map((r) => r.id === row.id ? row : r)); })
                      .catch(() => { if (alive.current) setAgentTrouble(say("profileMemoriesError")); })
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
                      .catch(() => { if (alive.current) setAgentTrouble(say("profileMemoriesError")); })
                      .finally(() => { if (alive.current) setBusyAgent(null); });
                  }}>
                  {busyAgent === `erase:${agent.id}` ? say("worldDeleteItAnyway") : say("worldDelete")}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="waka-settings-add">
          <input type="text" value={newAgent} placeholder={say("profileMemoryNewLabel")}
            aria-label={say("profileMemoryNewLabel")} disabled={busyAgent === "new"}
            onChange={(event) => setNewAgent(event.currentTarget.value)} />
          <button type="button" disabled={busyAgent === "new" || !newAgent.trim()} onClick={() => void addAgent()}>
            {say("profileMemoryCreate")}
          </button>
        </div>
      </Group>

      <Group id="public" open={open} setOpen={setOpen} label={say("profilePublicTitle")}>
        <p className="waka-settings-note">{say("profilePublicPrivacyHint")}</p>
        <label className="waka-account-field">
          <span>{say("profilePublicHandle")}</span>
          <input type="text" value={handle} disabled={publicBusy} autoComplete="off"
            onChange={(event) => setHandle(event.currentTarget.value)} />
        </label>
        <label className="waka-settings-toggle">
          <input type="checkbox" checked={onPage} disabled={publicBusy}
            onChange={(event) => setOnPage(event.currentTarget.checked)} />
          <span>{say("profilePublicEnabled")}</span>
        </label>
        <label className="waka-settings-toggle">
          <input type="checkbox" checked={onReading} disabled={publicBusy}
            onChange={(event) => setOnReading(event.currentTarget.checked)} />
          <span>{say("profilePublicTopOfMindEnabled")}</span>
        </label>
        <button type="button" className="waka-settings-keep" disabled={publicBusy}
          onClick={() => {
            setPublicBusy(true);
            void props.publicPage
              .save({ handle: handle.trim(), profileEnabled: onPage, topOfMindEnabled: onReading })
              .finally(() => { if (alive.current) setPublicBusy(false); });
          }}>
          {say(publicBusy ? "profileSaving" : "worldSave")}
        </button>
      </Group>

      <button type="button" className="waka-account-out" onClick={() => { props.onClose(); props.onSignOut(); }}>
        {say("worldSignOutLower")}
      </button>

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
          {say(deleting ? "profileMemoryRemoving" : confirmDelete ? "worldDeleteItAnyway" : "profileDelete")}
        </button>
      </Group>
    </div>
  );
}

/** A labelled disclosure. The row is the control; the content is its panel. */
function Group({ id, open, setOpen, label, children }: {
  id: Exclude<Open, null>;
  open: Open;
  setOpen: (next: Open) => void;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  const showing = open === id;
  return (
    <div className="waka-settings-group">
      <button type="button" className="waka-settings-row" aria-expanded={showing}
        onClick={() => setOpen(showing ? null : id)}>
        {label}
        <span aria-hidden="true">{showing ? "–" : "+"}</span>
      </button>
      {showing ? <div className="waka-settings-body">{children}</div> : null}
    </div>
  );
}
