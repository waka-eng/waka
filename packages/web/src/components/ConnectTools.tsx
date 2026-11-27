/**
 * ═══ LET YOUR AI TOOLS KNOW YOU (founder, 2026-11-27: "not everyone knows
 * what MCP and API is ... how do we make it more clear ... the two tabs are
 * just super confusing ... simplify and make this intuitive for a
 * non-technical user") ═══
 *
 * One card per tool, Claude Code and Codex, saying in plain words whether it
 * is connected (a lit dot) or not (a dim one). Connect opens three steps in
 * place: make a key, copy a message, paste it into the tool. A connected
 * tool opens to what it read and Disconnect. The words MCP and API key appear
 * only under "Keys and details", for whoever wants them.
 *
 * A tool is connected when a live key carries its name: the key made in
 * step 1 is named after the tool, so the card and the key agree.
 */
import { useCallback, useEffect, useState } from 'react';

import { createProfileKey, fetchProfileKeys, revokeProfileKey, type ApiProfileKey } from '../lib/api/profile-keys';
import { fetchMcpReads, type ApiMcpRead } from '../lib/api/sessions';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';
import { mcpClientName, mcpSetupPrompt, type McpClient } from '../lib/mcp-setup';
import { publicWebOrigin } from '../lib/public-origins';
import { dateWords } from '../lib/words';
import { McpCopyBlock } from './McpCopyBlock';

const TOOLS: McpClient[] = ['claude', 'codex'];

export function ConnectTools({ locale, profile }: {
  locale: SupportedLocale;
  profile: { id: string; name: string; type: 'human' | 'agent' };
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [keys, setKeys] = useState<ApiProfileKey[] | null>(null);
  const [reads, setReads] = useState<ApiMcpRead[]>([]);
  const [failed, setFailed] = useState(false);
  const [openTool, setOpenTool] = useState<McpClient | null>(null);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [rows, recent] = await Promise.all([fetchProfileKeys(profile), fetchMcpReads(profile.id).catch(() => [])]);
      setKeys(rows.filter(row => !row.revokedAt)); setReads(recent);
    } catch { setFailed(true); }
  }, [profile]);
  useEffect(() => { void load(); }, [load]);
  if (failed) return <p className="waka-account-failed" role="alert">{say('profilePersonalMcpLoadError')}{' '}
    <button type="button" className="waka-over-clear" onClick={() => void load()}>{say('worldRetry')}</button></p>;
  if (!keys) return <p className="waka-settings-note" role="status">{say('worldInspirationsLoad')}</p>;
  return (
    <div className="waka-connect-tools">
      {TOOLS.map(tool => {
        const name = mcpClientName(tool);
        const key = keys.find(row => row.label === name) ?? null;
        return <ToolCard key={tool} locale={locale} profile={profile} tool={tool} name={name} live={key}
          reads={reads.filter(read => read.key.label === name && !read.key.revoked)}
          open={openTool === tool} onToggle={() => setOpenTool(was => was === tool ? null : tool)}
          onChanged={() => void load()} />;
      })}
    </div>
  );
}

function ToolCard({ locale, profile, tool, name, live, reads, open, onToggle, onChanged }: {
  locale: SupportedLocale; profile: { id: string; name: string; type: 'human' | 'agent' };
  tool: McpClient; name: string; live: ApiProfileKey | null; reads: ApiMcpRead[];
  open: boolean; onToggle: () => void; onChanged: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const now = Date.now();
  const lastRead = reads[0] ? Date.parse(reads[0].readAt) : live?.lastUsedAt ? Date.parse(live.lastUsedAt) : null;
  const status = live
    ? lastRead ? formatMessage(locale, 'connectLastRead', { when: dateWords(lastRead, now, locale) }) : say('connectNotUsedYet')
    : say('connectNotConnected');
  return (
    <section className={`waka-connect-tool${live ? ' waka-connect-tool--on' : ''}`} aria-label={name}>
      <button type="button" className="waka-connect-tool-head" aria-expanded={open} onClick={onToggle}>
        <span className="waka-connect-dot" aria-hidden="true" />
        <span className="waka-connect-tool-name">
          <span>{name}</span>
          <span className="waka-connect-tool-status">{status}</span>
        </span>
        <span className="waka-connect-tool-act">{live ? '' : say('connectAction')}<span className="waka-settings-chevron" aria-hidden="true">{open ? '⌄' : '›'}</span></span>
      </button>
      {open ? live ? <Connected locale={locale} profile={profile} live={live} reads={reads} onChanged={onChanged} />
        : <Steps locale={locale} profile={profile} tool={tool} name={name} onChanged={onChanged} /> : null}
    </section>
  );
}

/** Three steps, in plain words, in place. */
function Steps({ locale, profile, tool, name, onChanged }: {
  locale: SupportedLocale; profile: { id: string; name: string; type: 'human' | 'agent' };
  tool: McpClient; name: string; onChanged: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [secret, setSecret] = useState<string | null>(null);
  const [allowSave, setAllowSave] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const prompt = mcpSetupPrompt({
    locale, profile, client: tool, scope: 'project',
    apiUrl: (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, ''),
    packageOrigin: publicWebOrigin(), authMethod: 'key',
  });
  const make = async () => {
    if (busy) return;
    setBusy(true); setError(false);
    try { const key = await createProfileKey(profile, name, allowSave ? 'read_capture' : 'read_only'); setSecret(key.secret); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  return (
    <ol className="waka-connect-steps">
      <li>
        <span className="waka-connect-step-title">{formatMessage(locale, 'connectStepKey', { tool: name })}</span>
        {secret ? <>
          <p className="waka-settings-note">{say('connectKeyShownOnce')}</p>
          <McpCopyBlock locale={locale} mode="full" text={secret} copyLabel={say('connectCopyKey')} />
        </> : <>
          <label className="waka-connect-allow">
            <input type="checkbox" checked={allowSave} onChange={event => setAllowSave(event.currentTarget.checked)} />
            <span>{say('connectAllowSave')}</span>
          </label>
          <button type="button" className="waka-connect-button" disabled={busy} onClick={() => void make()}>{say('connectMakeKey')}</button>
          {error ? <p className="waka-account-failed" role="alert">{say('profilePersonalMcpLoadError')}</p> : null}
        </>}
      </li>
      <li>
        <span className="waka-connect-step-title">{say('connectStepCopy')}</span>
        <McpCopyBlock locale={locale} mode="button" text={prompt} copyLabel={say('connectCopyMessage')} />
      </li>
      <li>
        <span className="waka-connect-step-title">{formatMessage(locale, 'connectStepPaste', { tool: name })}</span>
        {secret ? <button type="button" className="waka-connect-button" onClick={onChanged}>{say('connectDone')}</button> : null}
      </li>
    </ol>
  );
}

/** A connected tool: what it read, and the way to cut it off. */
function Connected({ locale, profile, live, reads, onChanged }: {
  locale: SupportedLocale; profile: { id: string; type: 'human' | 'agent' };
  live: ApiProfileKey; reads: ApiMcpRead[]; onChanged: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [busy, setBusy] = useState(false);
  const now = Date.now();
  return (
    <div className="waka-connect-connected">
      <span className="waka-connect-step-title">{say('connectWhatItRead')}</span>
      {reads.length ? <ul className="waka-connect-reads">
        {reads.slice(0, 5).map(read => <li key={read.id}>
          <span>{readWords(locale, read)}</span>
          <span className="waka-connect-tool-status">{dateWords(Date.parse(read.readAt), now, locale)}</span>
        </li>)}
      </ul> : <p className="waka-settings-note">{say('connectNothingRead')}</p>}
      <button type="button" className="waka-connect-button waka-connect-button--quiet" disabled={busy}
        onClick={() => { setBusy(true); void revokeProfileKey(profile, live.id).then(onChanged).finally(() => setBusy(false)); }}>
        {say('connectDisconnect')}
      </button>
    </div>
  );
}

function readWords(locale: SupportedLocale, read: ApiMcpRead): string {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  switch (read.tool) {
    case 'principles': return read.detail && read.detail !== '0' ? formatMessage(locale, 'mcpReadPrinciplesCount', { count: Number(read.detail) }) : say('mcpReadPrinciples');
    case 'recall': return read.detail ? formatMessage(locale, 'mcpReadSearched', { words: read.detail }) : say('mcpReadSearchedPlain');
    case 'inspirations': return say('mcpReadInspirations');
    case 'inspiration': return say('mcpReadInspiration');
    case 'signals': return say('mcpReadPatterns');
    case 'top_of_mind': return say('mcpReadOnYourMind');
    case 'profiles': return say('mcpReadProfile');
    case 'other': return say('mcpReadOther');
  }
}
