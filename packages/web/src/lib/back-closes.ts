/**
 * BACK CLOSES WHAT IS OPEN, INSTEAD OF LEAVING THE APP UNDER IT.
 *
 * Review mode, the settings panel and the info panel are states of the page
 * rather than addresses, so they never wrote a history entry. On a phone the
 * edge swipe is Back, and Back on a page with no entry of its own leaves the
 * page: a person who swiped to put the settings sheet away found themselves
 * on whatever site they came from, with the sheet — and WAKA — gone.
 *
 * So opening one of these pushes ONE entry for the same address, tagged, and
 * Back pops it: the listener sees the tag gone and closes the layer. Closing
 * it any other way (its own control, Escape, an empty queue) pops the entry
 * it pushed, so the history a person walks with Back never collects dead
 * steps that do nothing.
 *
 * WHY RAW `history` AND NOT THE ROUTER. A router navigation mints a new
 * location key, and Home re-applies the whole view whenever the key changes
 * (`appliedViewKey`) — the camera would travel to where it already is. The
 * pushed entry copies the router's own state, `idx` and `key` included, so
 * React Router reads the pop as a move to the location it is already on and
 * does nothing; only this listener acts on it.
 */
import { useEffect, useRef } from 'react';

const TAG = 'wakaLayer';
/* A close that is about to pop its entry, by layer. Deferred one task so a
   remount in the same tick (StrictMode's double effect, a key change) can
   take the entry over instead of popping it out from under itself. */
const leaving = new Map<string, number>();

function tagged(layer: string): boolean {
  const state = window.history.state as Record<string, unknown> | null;
  return state?.[TAG] === layer;
}

export function useBackCloses(open: boolean, close: () => void, layer: string): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const pending = leaving.get(layer);
    if (pending !== undefined) { window.clearTimeout(pending); leaving.delete(layer); }
    if (!tagged(layer)) {
      window.history.pushState({ ...(window.history.state as object | null), [TAG]: layer }, '', window.location.href);
    }
    let popped = false;
    const onPop = () => {
      if (tagged(layer)) return;
      popped = true;
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      /* closed by something other than Back: take our entry with us, but
         only if it is still the one on top — a navigation since then owns
         the history now, and stepping back would undo it. */
      if (popped) return;
      leaving.set(layer, window.setTimeout(() => {
        leaving.delete(layer);
        if (tagged(layer)) window.history.back();
      }, 0));
    };
  }, [open, layer]);
}
