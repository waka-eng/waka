import type { useInspirationProcessing } from '../lib/use-inspiration-processing';
import { t, type SupportedLocale } from '../lib/i18n';

export function InspirationProcessingNotice({ processing, locale, onView, displayedVersion = 0, quiet = false, introducePrinciples = false }: {
  processing: ReturnType<typeof useInspirationProcessing>; locale: SupportedLocale; onView: () => void; displayedVersion?: number;
  quiet?: boolean; introducePrinciples?: boolean;
}) {
  if (!processing.active || processing.phase === 'idle') return null;
  const { status, phase, busy } = processing;
  const ready = phase === 'ready';
  const hasNewReading = ready && status?.result?.topOfMindId && status.result.version > displayedVersion;
  const due = status?.runAfter ? Date.parse(status.runAfter) : NaN;
  const when = Number.isFinite(due) ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(due) : '';
  const scheduled = Boolean(when && status?.phase === 'waiting' && (phase === 'waiting' || phase === 'checking'));
  const text = phase === 'checking' ? t(locale, 'worldSourceChecking') : phase === 'error' ? t(locale, 'worldSourceCheckFailed')
    : phase === 'delayed' ? t(locale, 'worldSourceDelayed') : phase === 'waiting' && when ? t(locale, status?.stage === 'reading' ? 'worldSourceWaiting' : 'worldSourceScheduled').replace('{time}', when)
    : phase === 'failed' ? t(locale, 'worldSourceFailed') : phase === 'unknown' ? t(locale, 'worldSourceUnknown')
    : hasNewReading ? t(locale, 'worldSourceReady') : ready && status?.unavailableAttachments ? t(locale, 'worldSourcePartial')
    : ready ? t(locale, status?.result?.outcome === 'empty' ? 'worldSourceEmpty' : 'worldSourceUnchanged')
    : t(locale, quiet && (phase === 'queued' || phase === 'processing') ? 'worldSourceForming' : phase === 'queued' || phase === 'waiting' ? 'worldSourceQueued' : 'worldSourceReading');
  return <div className={`jar-source-status${quiet ? ' jar-source-status--quiet' : ''}`} role="status" data-jar-chrome="1" data-jar-interactive="1">
    {quiet ? <svg className="jar-source-mark" data-processing={phase === 'processing' || undefined} width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
      <path d="m5 16 7-9 7 9" stroke="currentColor" strokeWidth="1" opacity=".3" />
      <circle cx="5" cy="16" r="2" fill="currentColor" /><circle cx="12" cy="7" r="2" fill="currentColor" /><circle cx="19" cy="16" r="2" fill="currentColor" />
    </svg> : null}
    <span className={quiet ? 'jar-source-copy' : undefined}><span>{text}</span>
      {quiet && introducePrinciples ? <span className="jar-source-hint">{t(locale, 'worldSourcePrinciplesHint')}</span> : null}
    </span>
    {/* Keep the action focused as status changes. Native disabled blurs a
        pressed control and can strand Escape outside its surrounding dialog. */}
    {hasNewReading ? <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) onView(); }}>{t(locale, 'worldSourceView')}</button>
      : ready ? <button type="button" aria-label={t(locale, 'worldSourceDismiss')} aria-disabled={busy || undefined} onClick={() => { if (!busy) processing.clear(); }}>×</button>
      : scheduled ? <details className="jar-source-details"><summary>{t(locale, 'worldSourceDetails')}</summary><button type="button" aria-disabled={busy || undefined} onClick={()=>{if(!busy)void processing.check();}}>{t(locale,'worldSourceCheck')}</button></details>
      : <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) void ((phase === 'failed' || phase === 'unknown') && status?.canRetry ? processing.retry() : processing.check()); }}>
        {t(locale, (phase === 'failed' || phase === 'unknown') && status?.canRetry ? 'worldSourceRetry' : 'worldSourceCheck')}
      </button>}
  </div>;
}
