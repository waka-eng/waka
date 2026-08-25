/**
 * The agents screen — the meeting's "MCP 관리 탭", grown into what it is for.
 *
 * 2026-08-17: each agent gets its own name and its own key. This screen is
 * where the account owner does both: mint an agent, mint its keys, revoke
 * them, and step through to the graph of what the agent has come to hold.
 *
 * The one delicate moment is the key's birth: the secret exists in exactly
 * one response and is shown in exactly one block, with the words that say
 * so. It is deliberately NOT auto-copied — putting a credential on the
 * clipboard unasked means putting it wherever the clipboard goes next.
 */
import { useCallback, useEffect, useState } from "react";

import {
  createAgentKey,
  createProfile,
  fetchAgentKeys,
  fetchProfiles,
  revokeAgentKey,
  type ApiAgentKey,
  type ApiMintedKey,
  type ApiOwnedProfile,
} from "../lib/api";
import { t, type SupportedLocale } from "../lib/locales";

export interface AgentsScreenProps {
  locale: SupportedLocale;
  active: boolean;
  onBack: () => void;
  onSeeMind: (profileId: string) => void;
}

export function AgentsScreen({ locale, active, onBack, onSeeMind }: AgentsScreenProps): JSX.Element {
  const [agents, setAgents] = useState<ApiOwnedProfile[]>([]);
  const [keys, setKeys] = useState<ApiAgentKey[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  /** The one showing of the one secret, keyed by the key's id. */
  const [minted, setMinted] = useState<ApiMintedKey | null>(null);

  const reload = useCallback(async () => {
    const [profiles, keyRows] = await Promise.all([fetchProfiles(), fetchAgentKeys()]);
    setAgents(profiles.filter((profile) => profile.type === "agent"));
    setKeys(keyRows);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!active) return;
    reload().catch(() => setNotice(t(locale, "agentsError")));
  }, [active, reload, locale]);

  const createAgent = useCallback(() => {
    const name = nameDraft.trim();
    if (name === "" || busy) return;
    setBusy(true);
    createProfile(name)
      .then(() => {
        setNameDraft("");
        return reload();
      })
      .catch((err) => setNotice(err instanceof Error ? err.message : t(locale, "agentsError")))
      .finally(() => setBusy(false));
  }, [nameDraft, busy, reload, locale]);

  const mintKey = useCallback(
    (profileId: string) => {
      if (busy) return;
      setBusy(true);
      createAgentKey(profileId)
        .then((key) => {
          setMinted(key);
          return reload();
        })
        .catch((err) => setNotice(err instanceof Error ? err.message : t(locale, "agentsError")))
        .finally(() => setBusy(false));
    },
    [busy, reload, locale],
  );

  const revoke = useCallback(
    (keyId: string) => {
      if (busy) return;
      setBusy(true);
      revokeAgentKey(keyId)
        .then(() => {
          setMinted((current) => (current?.id === keyId ? null : current));
          return reload();
        })
        .catch(() => setNotice(t(locale, "agentsError")))
        .finally(() => setBusy(false));
    },
    [busy, reload, locale],
  );

  return (
    <div className="sf-column">
      <button type="button" className="sf-back" onClick={onBack}>
        ← back
      </button>
      <div className="pr-head">
        <div>
          <div className="pr-eyebrow">{t(locale, "agentsEyebrow")}</div>
          <h2 className="pr-title">{t(locale, "agentsTitle")}</h2>
        </div>
        <div className="pr-meta-right">{loaded ? agents.length : "…"}</div>
      </div>
      {notice !== "" ? <p className="sf-empty">{notice}</p> : null}
      {loaded && agents.length === 0 ? (
        <p className="pr-empty">{t(locale, "agentsEmpty")}</p>
      ) : null}

      <div className="gr-list">
        {agents.map((agent) => {
          const agentKeys = keys.filter((key) => key.profileId === agent.id);
          return (
            <div key={agent.id} className="ag-card">
              <div className="ag-head">
                <span className="gr-door-name">{agent.name}</span>
                <button
                  type="button"
                  className="pr-action"
                  onClick={() => onSeeMind(agent.id)}
                >
                  {t(locale, "agentsSeeMind")}
                </button>
              </div>
              <div className="ag-keys">
                <span className="pr-eyebrow">{t(locale, "agentsKeys")}</span>
                {agentKeys.length === 0 ? (
                  <p className="sf-empty">{t(locale, "agentsNoKeys")}</p>
                ) : (
                  agentKeys.map((key) => (
                    <div key={key.id} className="ag-key-row">
                      <code className="ag-key-prefix">{key.prefix}…</code>
                      {key.label ? <span className="ag-key-label">{key.label}</span> : null}
                      {key.revokedAt !== null ? (
                        <span className="ag-key-dead">{t(locale, "agentsKeyRevoked")}</span>
                      ) : (
                        <button
                          type="button"
                          className="pr-action"
                          onClick={() => revoke(key.id)}
                        >
                          {t(locale, "agentsKeyRevoke")}
                        </button>
                      )}
                    </div>
                  ))
                )}
                {minted !== null && minted.profileId === agent.id ? (
                  <div className="ag-secret">
                    <code>{minted.secret}</code>
                    <p className="sf-empty">{t(locale, "agentsKeyOnce")}</p>
                  </div>
                ) : null}
                <button
                  type="button"
                  className="pr-action"
                  disabled={busy}
                  onClick={() => mintKey(agent.id)}
                >
                  {t(locale, "agentsNewKey")}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="gr-new">
        <input
          type="text"
          className="gr-input"
          value={nameDraft}
          placeholder={t(locale, "agentsCreatePlaceholder")}
          disabled={busy}
          onChange={(event) => setNameDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") createAgent();
          }}
        />
        {nameDraft.trim() !== "" ? (
          <button type="button" className="pr-action" disabled={busy} onClick={createAgent}>
            {t(locale, "agentsCreate")}
          </button>
        ) : null}
      </div>
    </div>
  );
}
