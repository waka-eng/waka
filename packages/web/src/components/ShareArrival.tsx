/**
 * ═══ SOMETHING SHARED TO WAKA ARRIVES HERE (waka-design-brief.md §4) ═══
 *
 * "Mindless means capturing from where the user already is." Two doors open
 * onto this address, and both say the same three things in its query:
 *
 *   - the phone's share sheet, through the web manifest's `share_target`
 *     (`/share?title=…&text=…&url=…`);
 *   - the bookmarklet in Settings, from any page on a desktop
 *     (`/share?…&via=bookmarklet`, opened as a small window).
 *
 * The brief: "a shared URL or text saves on arrival with no screen shown
 * except the 'Saved' toast". So this page shows nothing. It hands what was
 * shared to the home — in this tab's session storage, because it must
 * survive the step through sign-in when the visitor is signed out — and
 * steps to the home with `replace`, so Back does not return to it. The home
 * saves it through the same outbox the bar uses (offline queueing,
 * de-duplication on the request id) and says "Saved".
 */
import { Navigate, useLocation } from 'react-router-dom';

/** Where a share waits for the home to pick it up. One tab, one share. */
export const SHARED_KEY = 'waka:shared';
/** A share older than this is not acted on: it was not this arrival's. */
export const SHARED_MAX_AGE_MS = 10 * 60 * 1000;

export interface SharedPayload { title: string; text: string; url: string; via: 'share' | 'bookmarklet'; at: number }

/** What is kept: the words, then the address — said once each. */
export function sharedText(payload: Pick<SharedPayload, 'title' | 'text' | 'url'>): { text: string; url: string | null } {
  const url = /^https?:\/\//i.test(payload.url.trim()) ? payload.url.trim() : null;
  /* Android puts the page's address in `text` when the app has no `url`. */
  const textUrl = !url && /^https?:\/\/\S+$/i.test(payload.text.trim()) ? payload.text.trim() : null;
  const link = url ?? textUrl;
  const words = (textUrl ? '' : payload.text.trim()) || (link ? payload.title.trim() : '');
  const lines = [words, link].filter((line): line is string => Boolean(line));
  return { text: [...new Set(lines)].join('\n'), url: link };
}

export function ShareArrival(): JSX.Element {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const payload: SharedPayload = {
    title: (params.get('title') ?? '').slice(0, 2000),
    text: (params.get('text') ?? '').slice(0, 20000),
    url: (params.get('url') ?? '').slice(0, 4000),
    via: params.get('via') === 'bookmarklet' ? 'bookmarklet' : 'share',
    at: Date.now(),
  };
  if (sharedText(payload).text) {
    try { sessionStorage.setItem(SHARED_KEY, JSON.stringify(payload)); } catch { /* nothing to hand over */ }
  }
  return <Navigate to="/" replace />;
}
