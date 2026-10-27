import { useEffect, useState } from 'react';
import { t, type SupportedLocale } from '../lib/locales';

/** Copy instructions as displayed; configuration examples never contain a real key. */
export function McpCopyBlock({ locale, text, copyLabel, prompt = false, scrollable = false, mode = 'full', onCopied, onCopyFailed }: {
  locale: SupportedLocale;
  text: string;
  copyLabel?: string;
  prompt?: boolean;
  scrollable?: boolean;
  mode?: 'full' | 'text' | 'button';
  onCopied?: () => void;
  onCopyFailed?: () => void;
}): JSX.Element {
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);
  useEffect(() => setResult(null), [text]);
  const controls = <>
    <button type="button" className="waka-settings-erase" onClick={() => {
      void (async () => {
        try { await navigator.clipboard.writeText(text); setResult('copied'); onCopied?.(); }
        catch { setResult('failed'); onCopyFailed?.(); }
      })();
    }}>{copyLabel ?? t(locale, 'profileConnectionCopy')}</button>
    {result ? <span role="status" className="waka-settings-note">
      {t(locale, result === 'copied' ? 'profileConnectionCopied' : 'profileConnectionCopyError')}
    </span> : null}
  </>;
  if (mode === 'button') return controls;
  return <div className="waka-session-command">
    {mode === 'full' ? controls : null}
    {prompt ? <blockquote className={`waka-mcp-commands${scrollable ? ' waka-mcp-prompt-scroll' : ''}`} tabIndex={scrollable ? 0 : undefined}>{text}</blockquote>
      : <pre className="waka-mcp-commands"><code>{text}</code></pre>}
  </div>;
}
