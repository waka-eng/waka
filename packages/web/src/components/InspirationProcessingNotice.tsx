import type { useInspirationProcessing } from '../lib/use-inspiration-processing';
import { t, type SupportedLocale } from '../lib/i18n';

export function InspirationProcessingNotice({ processing, locale, onView, displayedVersion = 0 }: {
  processing: ReturnType<typeof useInspirationProcessing>; locale: SupportedLocale; onView: () => void; displayedVersion?: number;
}) {
  if (!processing.active || processing.phase === 'idle') return null;
  const { status, phase, busy } = processing;
  const ready = phase === 'ready';
  const hasNewReading = ready && status?.result?.topOfMindId && status.result.version > displayedVersion;
  const due = status?.runAfter ? Date.parse(status.runAfter) : NaN;
  const when = Number.isFinite(due) ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(due) : '';
  const text = phase === 'checking' ? t(locale, 'worldSourceChecking') : phase === 'error' ? t(locale, 'worldSourceCheckFailed')
    : phase === 'delayed' ? t(locale, 'worldSourceDelayed') : phase === 'waiting' && when ? t(locale, 'worldSourceWaiting').replace('{time}', when)
    : phase === 'failed' ? t(locale, 'worldSourceFailed') : phase === 'unknown' ? t(locale, 'worldSourceUnknown')
    : hasNewReading ? t(locale, 'worldSourceReady') : ready && status?.unavailableAttachments ? t(locale, 'worldSourcePartial')
    : ready ? t(locale, status?.result?.outcome === 'empty' ? 'worldSourceEmpty' : 'worldSourceUnchanged')
    : t(locale, phase === 'queued' ? 'worldSourceQueued' : 'worldSourceReading');
  return <div className="jar-source-status" role="status" data-jar-chrome="1">
    <span>{text}</span>
    {/* Keep the action focused as status changes. Native disabled blurs a
        pressed control and can strand Escape outside its surrounding dialog. */}
    {hasNewReading ? <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) onView(); }}>{t(locale, 'worldSourceView')}</button>
      : ready ? <button type="button" aria-label={t(locale, 'worldSourceDismiss')} aria-disabled={busy || undefined} onClick={() => { if (!busy) processing.clear(); }}>×</button>
      : <button type="button" aria-disabled={busy || undefined} onClick={() => { if (!busy) void ((phase === 'failed' || phase === 'unknown') && status?.canRetry ? processing.retry() : processing.check()); }}>
        {t(locale, (phase === 'failed' || phase === 'unknown') && status?.canRetry ? 'worldSourceRetry' : 'worldSourceCheck')}
      </button>}
  </div>;
}
