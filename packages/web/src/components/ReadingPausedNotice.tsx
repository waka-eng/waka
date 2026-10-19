/**
 * "READING IS PAUSED — YOUR SAVES ARE SAFE", AND THE ONE THING TO DO ABOUT IT.
 *
 * One component for the three pages that show it (home, principles, claims)
 * so the sentence, the order of its two facts and the verb under it cannot
 * drift between them. The facts are chosen for the fear a stalled reading
 * raises: the first worry is that what was kept is gone, so it says it is
 * not; the second is whether to wait or act, so there is a Retry that
 * re-enqueues the reading rather than a "check back later".
 *
 * The class names are the reading status line's own, so on home it sits in
 * the same place and wears the same face as every other reading state.
 */
import { t, type SupportedLocale } from '../lib/locales';
import type { useReadingPaused } from '../lib/use-reading-paused';

export function ReadingPausedNotice({ state, locale, className = 'jar-board-acts jar-reading-status', besidePrincipleRead = false, canRetry = true }: {
  state: ReturnType<typeof useReadingPaused>; locale: SupportedLocale; className?: string;
  /** On a page that also shows `PrincipleRead`: when that line is already
      saying "could not be updated" with its own Try again, this one stays
      down, so the person meets one failure and one button, not two. */
  besidePrincipleRead?: boolean;
  /** Restarting a reading spends model calls on the account — a person's
      decision. An agent session sees the notice, without the Retry. */
  canRetry?: boolean;
}): JSX.Element | null {
  if (!state.paused || (besidePrincipleRead && state.principlesFailed)) return null;
  return (
    <p className={className} role="status" data-jar-chrome="1">
      <span>{t(locale, state.retryFailed ?'readingPausedRetryFailed' : 'readingPausedNotice')}</span>
      {canRetry ? <>
        {' '}
        <button className="jar-board-act" type="button" disabled={state.retrying} onClick={state.retry}>
          {t(locale, state.stillTrying ? 'worldStillTrying' : state.retrying ? 'readingPausedRetrying' : 'readingPausedRetry')}
        </button>
      </> : null}
    </p>
  );
}
