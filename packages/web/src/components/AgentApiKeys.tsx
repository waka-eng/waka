import { useCallback, useEffect, useRef, useState } from 'react';

import { createAgentKey, fetchAgentKeys, revokeAgentKey, type ApiAgentKey } from '../lib/api/agent-keys';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';

/** Mounted with the profile ID as its key. Secrets live only in this view. */
export function AgentApiKeys({ profile, locale }: {
  profile: { id: string; name: string };
  locale: SupportedLocale;
}): JSX.Element {
  const say = useCallback((key: Parameters<typeof t>[1]) => t(locale, key), [locale]);
  const [keys, setKeys] = useState<ApiAgentKey[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [label, setLabel] = useState('');
  const [fresh, setFresh] = useState<(ApiAgentKey & { secret: string }) | null>(null);
  const [copy, setCopy] = useState<'copied' | 'failed' | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const alive = useRef(true);
  const secretField = useRef<HTMLInputElement>(null);
  useEffect(() => { secretField.current?.focus(); }, [fresh]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const rows = await fetchAgentKeys(profile.id);
      if (alive.current) setKeys(rows);
    } catch { if (alive.current) setError(say('profileApiKeysLoadError')); }
    finally { if (alive.current) setLoading(false); }
  }, [profile.id, say]);
  useEffect(() => {
    alive.current = true; void load();
    return () => { alive.current = false; };
  }, [load]);
  const create = async () => {
    if (!label.trim() || busy) return;
    setBusy('create'); setError(''); setCopy(null);
    try {
      const key = await createAgentKey(profile.id, label.trim());
      if (!alive.current) return;
      const { secret: _secret, ...summary } = key;
      setKeys(rows => [summary, ...(rows ?? [])]); setFresh(key); setLabel('');
    } catch { if (alive.current) setError(say('profileApiKeysCreateError')); }
    finally { if (alive.current) setBusy(null); }
  };
  const revoke = async (id: string) => {
    setBusy(id); setError('');
    try {
      await revokeAgentKey(id);
      if (!alive.current) return;
      setKeys(rows => rows?.filter(key => key.id !== id) ?? null);
      if (fresh?.id === id) setFresh(null);
      setConfirm(null);
    } catch { if (alive.current) setError(say('profileApiKeysRevokeError')); }
    finally { if (alive.current) setBusy(null); }
  };
  const apiUrl = (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, '');
  const config = JSON.stringify({
    mcpServers: { [`waka-${profile.id}`]: {
      command: 'node', args: ['/absolute/path/to/waka-mcp/dist/src/server.js'],
      env: { WAKA_API_URL: apiUrl, WAKA_PROFILE_ID: profile.id, WAKA_API_KEY: 'YOUR_API_KEY' },
    } },
  }, null, 2);
  return <>
    <div className="waka-session-list-heading">
      <h3>{formatMessage(locale, 'profileApiKeysForAgent', { name: profile.name })}</h3>
      <button type="button" className="waka-settings-erase" disabled={loading || busy !== null} onClick={() => void load()}>{say('profileConnectionsRefresh')}</button>
    </div>
    <p className="waka-settings-note">{say('profileApiKeysHint')}</p>
    <p className="waka-settings-note">{say('profileConnectionAgentAccess')}</p>
    {error ? <p className="waka-account-failed" role="alert">{error}</p> : null}
    {loading ? <p className="waka-settings-note" role="status">{say('worldInspirationsLoad')}</p> : null}
    {fresh ? <div className="waka-session-confirm">
      <p className="waka-settings-note">{say('profileApiKeysCopyOnce')}</p>
      <label className="waka-account-field"><span>{say('profileApiKeysSecret')}</span>
        <input ref={secretField} readOnly autoComplete="off" spellCheck={false} value={fresh.secret} onFocus={event => event.currentTarget.select()} />
      </label>
      <div className="waka-session-actions">
        <button type="button" className="waka-settings-erase" onClick={() => {
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
    <details>
      <summary>{say('profileApiKeysConfigTitle')}</summary>
      <p className="waka-settings-note">{say('profileApiKeysConfigHint')}</p>
      <pre className="waka-mcp-commands"><code>{config}</code></pre>
      <p className="waka-settings-note">{formatMessage(locale, 'profileApiKeysTestHint', { name: profile.name, id: profile.id })}</p>
    </details>
  </>;
}
