import { publicWebOrigin } from '../lib/public-origins';
import { mcpKeyConfig, mcpSetupCommands, mcpClientName, type McpClient } from '../lib/mcp-setup';
import { useCallback, useEffect, useRef, useState } from 'react';
import { McpCopyBlock } from './McpCopyBlock';
import { McpInstallPrompt } from './McpInstallPrompt';

import { createProfileKey, fetchProfileKeys, revokeProfileKey, type ApiProfileKey, type KeyProfile } from '../lib/api/profile-keys';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';

/** Mounted with the profile ID as its key. Secrets live only in this view. */
export function ProfileApiKeys({ profile, locale }: {
  profile: KeyProfile & { name: string };
  locale: SupportedLocale;
}): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const [client, setClient] = useState<McpClient>('claude');
  const personal = profile.type === 'human';
  const [keys, setKeys] = useState<ApiProfileKey[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<(ApiProfileKey & { secret: string }) | null>(null);
  const [copy, setCopy] = useState<'copied' | 'failed' | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const alive = useRef(true);
  const secretField = useRef<HTMLInputElement>(null);
  const setupDetails = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    secretField.current?.focus();
    if (fresh && setupDetails.current) setupDetails.current.open = true;
  }, [fresh]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const rows = await fetchProfileKeys(profile);
      if (alive.current) setKeys(rows);
    } catch { if (alive.current) setError(say('profileApiKeysLoadError')); }
    finally { if (alive.current) setLoading(false); }
  }, [profile.id, profile.type, say]);
  useEffect(() => {
    alive.current = true; void load();
    return () => { alive.current = false; };
  }, [load]);
  const create = async () => {
    if (!label.trim() || busy) return;
    setBusy('create'); setError(''); setCopy(null);
    try {
      const key = await createProfileKey(profile, label.trim());
      if (!alive.current) return;
      const { secret: _secret, ...summary } = key;
      setKeys(rows => [summary, ...(rows ?? [])]); setFresh(key); setLabel('');
    } catch { if (alive.current) setError(say('profileApiKeysCreateError')); }
    finally { if (alive.current) setBusy(null); }
  };
  const revoke = async (id: string) => {
    setBusy(id); setError('');
    try {
      await revokeProfileKey(profile, id);
      if (!alive.current) return;
      setKeys(rows => rows?.filter(key => key.id !== id) ?? null);
      if (fresh?.id === id) setFresh(null);
      setConfirm(null);
    } catch { if (alive.current) setError(say('profileApiKeysRevokeError')); }
    finally { if (alive.current) setBusy(null); }
  };
  const apiUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');
  const packageOrigin = publicWebOrigin();
  const config = mcpKeyConfig(client, profile.id, apiUrl, packageOrigin);
  const install = mcpSetupCommands({ profile, apiUrl, packageOrigin, installed: false, client, scope: 'user' })[0]!;
  return <>
    <div className="waka-session-list-heading">
      <h3>{personal ? say('profilePersonalMcpHeading') : formatMessage(locale, 'profileApiKeysForProfile', { name: profile.name })}</h3>
      <button type="button" className="waka-settings-erase" disabled={loading || busy !== null} onClick={() => void load()}>{say('profileConnectionsRefresh')}</button>
    </div>
    <p className="waka-settings-note">{say(personal ? 'profilePersonalMcpHint' : 'profileApiKeysHint')}</p>
    <h4 className="waka-mcp-instruction-title">{say('profileApiKeysCreateStep')}</h4>
    <p className="waka-settings-note">{say('profileApiKeysCreateHint')}</p>
    {error ? <p className="waka-account-failed" role="alert">{error}</p> : null}
    {loading ? <p className="waka-settings-note" role="status">{say('worldInspirationsLoad')}</p> : null}
    {fresh ? <div className="waka-session-confirm">
      <p className="waka-settings-note">{say('profileApiKeysCopyOnce')}</p>
      <label className="waka-account-field"><span>{say('profileApiKeysSecret')}</span>
        <input ref={secretField} readOnly autoComplete="off" spellCheck={false} value={fresh.secret} onFocus={event => event.currentTarget.select()} />
      </label>
      <div className="waka-session-actions">
        <button type="button" className="waka-settings-erase" onClick={() => {
          if (!navigator.clipboard?.writeText) { setCopy('failed'); return; }
          void navigator.clipboard.writeText(fresh.secret).then(() => setCopy('copied'), () => setCopy('failed'));
        }}>{say('profileApiKeysCopy')}</button>
        <button type="button" className="waka-settings-erase" onClick={() => { setFresh(null); setCopy(null); }}>{say('profileApiKeysSaved')}</button>
      </div>
      {copy ? <p className="waka-settings-note" role="status">{say(copy === 'copied' ? 'profileConnectionCopied' : 'profileConnectionCopyError')}</p> : null}
    </div> : keys !== null ? <div className="waka-settings-add">
      <input aria-label={say('profileApiKeysName')} placeholder={say('profileApiKeysName')} maxLength={80} value={label}
        disabled={busy !== null || keys.length >= 5} onChange={event => setLabel(event.currentTarget.value)} />
      <button type="button" disabled={loading || busy !== null || !label.trim() || keys.length >= 5} onClick={() => void create()}>{say('profileApiKeysCreate')}</button>
    </div> : null}
    {keys && keys.length >= 5 ? <p className="waka-settings-note">{say('profileApiKeysLimit')}</p> : null}
    {keys?.length === 0 ? <p className="waka-settings-note">{say('profileApiKeysEmpty')}</p> : null}
    <details ref={setupDetails} className="waka-mcp-key-setup">
      <summary>{say('profileApiKeysConfigTitle')}</summary>
      <label className="waka-mcp-choice"><span>{say('profileMcpClient')}</span><select value={client} onChange={event => setClient(event.target.value as McpClient)}>
        <option value="claude">Claude Code / JSON</option><option value="codex">Codex</option>
      </select></label>
      <h4 className="waka-mcp-instruction-title">{say('profileMcpPromptTitle')}</h4>
      <McpInstallPrompt locale={locale} profile={profile} apiUrl={apiUrl} packageOrigin={packageOrigin} client={client} scope="project" authMethod="key" />
      <details className="waka-mcp-key-setup">
        <summary>{say('profileMcpManualInstall')}</summary>
        <ol className="waka-mcp-key-steps">
          <li>
            <h4 className="waka-mcp-instruction-title">{say('profileApiKeysPrepareTitle')}</h4>
            <p className="waka-settings-note">{say('profileMcpRequirements')}</p>
            <p className="waka-settings-note">{say('profileConnectionInstallHint')}</p>
            <McpCopyBlock locale={locale} text={install} copyLabel={say('profileMcpCopyInstall')} />
          </li>
          <li>
            <h4 className="waka-mcp-instruction-title">{say('profileApiKeysConfigStep')}</h4>
            <p className="waka-settings-note">{say(client === 'codex' ? 'profileMcpCodexProjectConfigHint' : 'profileMcpClaudeConfigHint')}</p>
            <p className="waka-settings-note">{say('profileApiKeysConfigHint')}</p>
            <McpCopyBlock locale={locale} text={config} copyLabel={say('profileApiKeysCopyConfig')} />
          </li>
          <li>
            <h4 className="waka-mcp-instruction-title">{say('profileApiKeysVerifyTitle')}</h4>
            <p className="waka-settings-note">{formatMessage(locale, 'profileConnectionVerifyHint', { client: mcpClientName(client) })}</p>
            <McpCopyBlock locale={locale} prompt copyLabel={say('profileMcpCopyTest')}
              text={formatMessage(locale, 'profileConnectionTestPrompt', { name: profile.name, id: profile.id })} />
            <p className="waka-settings-note">{formatMessage(locale, 'profileApiKeysTestHint', { name: profile.name, id: profile.id })}</p>
          </li>
        </ol>
      </details>
      {personal ? <>
        <h4 className="waka-mcp-instruction-title">{say('profilePersonalMcpSaveTitle')}</h4>
        <McpCopyBlock locale={locale} prompt copyLabel={say('profilePersonalMcpCopySave')}
          text={formatMessage(locale, 'profilePersonalMcpSavePrompt', { name: profile.name, id: profile.id })} />
      </> : null}
    </details>
    {keys && keys.length > 0 ? <>
      <h4 className="waka-mcp-instruction-title">{say('profileApiKeysActive')}</h4>
      <p className="waka-settings-note">{say('profileApiKeysRotateHint')}</p>
    </> : null}
    <ul className="waka-session-list" aria-busy={loading}>
      {keys?.map(key => <li key={key.id} className="waka-session-card">
        <div className="waka-session-card-heading"><strong>{key.label || say('profileApiKeysSecret')}</strong><span>{key.prefix}…</span></div>
        <p className="waka-settings-note">{say('profileConnectionLastUsed')}: {key.lastUsedAt
          ? new Date(key.lastUsedAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : say('profileApiKeysNeverUsed')}</p>
        {confirm === key.id ? <div className="waka-session-confirm">
          <p className="waka-settings-note">{formatMessage(locale, 'profileApiKeysRevokeHint', { name: key.label || key.prefix })}</p>
          <div className="waka-session-actions">
            <button type="button" className="waka-settings-erase" disabled={busy !== null} onClick={() => setConfirm(null)}>{say('profileConnectionCancel')}</button>
            <button type="button" className="waka-settings-erase" disabled={busy !== null} onClick={() => void revoke(key.id)}>{say('profileApiKeysRevokeConfirm')}</button>
          </div>
        </div> : <button type="button" className="waka-settings-erase" disabled={busy !== null || loading} onClick={() => setConfirm(key.id)}>{say('profileApiKeysRevoke')}</button>}
      </li>)}
    </ul>

  </>;
}
