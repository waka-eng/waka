/**
 * ═══ SOMETHING SHARED TO WAKA ARRIVES HERE ═══
 *
 * "Mindless means capturing from where the user already is." Two doors open
 * onto this address, and both say the same three things in its query:
 *
 *   - the phone's share sheet, through the web manifest's `share_target`
 *     (`/share?title=…&text=…&url=…`);
 *   - the bookmarklet in Settings, from any page on a desktop
 *     (`/share?…&via=bookmarklet`, opened as a small window).
 *
 * This page shows nothing. It hands what was shared to the home — in this
 * tab's session storage, because it must survive the step through sign-in
 * when the visitor is signed out — and steps to the home with `replace`, so
 * Back does not return to it. The home puts it in the notepad and waits for
 * Save: any site can open this address, so nothing is kept without a press.
 *
 * IT STANDS IN FRONT OF THE SIGN-IN GATE, NOT BEHIND IT. Behind it, a
 * signed-out visitor's share was carried only as the address to come back
 * to — and the way back drops an address past 2048 characters, which a
 * bookmarklet's selection (Korean especially) easily is. So the share is put
 * down here first, and the visitor goes to `/`, which signs them in and
 * onboards them as usual. Writing to this tab's storage is all it does, so
 * there is nothing here a signed-out visitor could not already do.
 */
import { useEffect, useState } from 'react';
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

export function ShareArrival(): JSX.Element | null {
  const location = useLocation();
  const [handed, setHanded] = useState(false);
  useEffect(() => {
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
    setHanded(true);
  }, [location.search]);
  return handed ? <Navigate to="/" replace /> : null;
}

/**
 * A SHARE STILL WAITING WHILE ONBOARDING RUNS. Onboarding can outlast the
 * ten minutes a share waits, and a share that arrived before it was meant for
 * the person who is about to reach home. So onboarding takes it up while it
 * is fresh and puts it back, freshly stamped, as it hands over to home.
 */
export function pendingShare(): SharedPayload | null {
  try {
    const raw = sessionStorage.getItem(SHARED_KEY);
    const payload = raw ? JSON.parse(raw) as SharedPayload : null;
    return payload && typeof payload.at === 'number' && Date.now() - payload.at <= SHARED_MAX_AGE_MS ? payload : null;
  } catch { return null; }
}
export function renewShare(payload: SharedPayload): void {
  try { sessionStorage.setItem(SHARED_KEY, JSON.stringify({ ...payload, at: Date.now() })); } catch { /* it simply was not carried */ }
}
