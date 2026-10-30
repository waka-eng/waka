import { useEffect, useRef, useState } from 'react';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';
import { mcpClientName, mcpSetupPrompt, type McpClient } from '../lib/mcp-setup';
import { publicWebOrigin } from '../lib/public-origins';
import { McpCopyBlock } from './McpCopyBlock';

/** Setup instructions contain no credentials and never create a connection themselves. */
export function ProfileMcpSetup({ locale, profile }: {
  locale: SupportedLocale;
  profile: { id: string; name: string; type: 'human' | 'agent' };
}): JSX.Element {
  const [client, setClient] = useState<McpClient>('claude');
  const [copyFailed, setCopyFailed] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const prompt = mcpSetupPrompt({
    locale, profile, client, scope: 'project',
    apiUrl: (import.meta.env.VITE_API_URL || window.location.origin).replace(/\/$/, ''),
    packageOrigin: publicWebOrigin(), authMethod: profile.type === 'human' ? 'key' : 'browser',
  });
  return <section className="waka-mcp-setup waka-mcp-setup--compact" aria-labelledby="waka-mcp-setup-title">
    <h3 id="waka-mcp-setup-title" ref={heading} tabIndex={-1}>{formatMessage(locale,
      profile.type === 'human' ? 'profileMcpPersonalTarget' : 'profileMcpAgentTarget', { name: profile.name })}</h3>
    <div>
      <p className="waka-settings-note">{say('profileMcpExplanation')}</p>
      <label className="waka-mcp-choice"><span>{say('profileMcpClient')}</span>
        <select value={client} onChange={event => { setClient(event.target.value as McpClient); setCopyFailed(false); }}>
          <option value="claude">Claude Code</option><option value="codex">Codex</option>
        </select>
      </label>
      <p className="waka-settings-note">{formatMessage(locale, 'profileMcpSimpleHint', { client: mcpClientName(client) })}</p>
      {copyFailed ? <McpCopyBlock locale={locale} prompt scrollable mode="text" text={prompt} /> : null}
    </div>
    <div className="waka-session-actions">
      <McpCopyBlock locale={locale} mode="button" text={prompt} copyLabel={say('profileMcpCopySetupPrompt')}
        onCopied={() => setCopyFailed(false)} onCopyFailed={() => setCopyFailed(true)} />
    </div>
  </section>;
}
