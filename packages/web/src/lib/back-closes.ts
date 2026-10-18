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
 *
 * ═══ THE THREE WAYS AN ENTRY OUTLIVES ITS LAYER, AND WHAT HAPPENS TO EACH ══
 *
 *   A ROUTER `replace` WHILE THE LAYER IS OPEN wrote the router's state over
 *   ours and took the tag with it, so closing found nothing to pop and left
 *   a same-address step behind. `replaceState` carries the tag across now
 *   while a layer is open — the entry is still the layer's entry. If the
 *   replace changed the address, the page entry BENEATH the layer still holds
 *   the old one, and Back from there would restore the address the replace
 *   meant to erase. So the layer's entry is popped (silently — nothing else
 *   hears that pop), the page entry is rewritten to the new address, and the
 *   layer's entry is pushed again on top of it.
 *
 *   A NAVIGATION WHILE THE LAYER IS OPEN leaves the tagged entry under the
 *   new one, where closing cannot reach it. Walking onto such an entry later
 *   (no layer of that name open) skips it in the direction of travel, read
 *   from the router's `idx`, so Back never lands on a step that does nothing.
 *
 *   A RELOAD leaves the tag in `history.state` with no layer open. Any tag
 *   present when this module first runs is stale by definition — nothing has
 *   rendered yet — so it is stripped IN PLACE. Stepping back over it is not
 *   an option: the entry beneath belongs to the document from before the
 *   reload, so going there would be a second full page load.
 */
import { useEffect, useRef } from 'react';

const TAG = 'wakaLayer';
const BASE = 'wakaLayerBase';
/* A close that is about to pop its entry, by layer. Deferred one task so a
   remount in the same tick (StrictMode's double effect, a key change) can
   take the entry over instead of popping it out from under itself. */
const leaving = new Map<string, number>();
/** Layers open right now. A tagged entry whose layer is not here is stale. */
const openLayers = new Set<string>();

type HistoryState = Record<string, unknown> | null;
const state = (): HistoryState => window.history.state as HistoryState;
function tagged(layer: string): boolean {
  return state()?.[TAG] === layer;
}
function strip(value: HistoryState): HistoryState {
  if (!value) return value;
  const { [TAG]: _layer, [BASE]: _base, ...rest } = value;
  return rest;
}
const idxOf = (value: HistoryState): number => (typeof value?.idx === 'number' ? value.idx : 0);

let installed = false;
/* A replace under an open layer, waiting for its pop onto the page entry. */
let rebase: { page: object; top: object; href: string } | null = null;
let lastIdx = 0;
function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  /* A reload: whatever layer this entry belonged to is not open. */
  if (state()?.[TAG]) {
    window.history.replaceState(strip(state()), '', window.location.href);
  }
  lastIdx = idxOf(state());
  /* The tag survives a router replace while its layer is open, and every
     push or replace moves the position the next pop is measured from. */
  const replace = window.history.replaceState.bind(window.history);
  const push = window.history.pushState.bind(window.history);
  window.history.replaceState = (data: unknown, unused: string, url?: string | URL | null) => {
    const layer = state()?.[TAG];
    const keep = typeof layer === 'string' && openLayers.has(layer) && data && typeof data === 'object' && !(TAG in data);
    if (!keep) {
      replace(data, unused, url);
      lastIdx = idxOf(state());
      return;
    }
    const base = state()?.[BASE];
    const href = new URL(url ?? window.location.href, window.location.href).href;
    const top = { ...(data as object), [TAG]: layer, [BASE]: href };
    replace(top, unused, url);
    lastIdx = idxOf(state());
    /* The address changed: the page entry beneath must change with it. */
    if (href !== base && !rebase) {
      rebase = { page: data as object, top, href };
      window.history.back();
    }
  };
  window.history.pushState = (data: unknown, unused: string, url?: string | URL | null) => {
    push(data, unused, url);
    lastIdx = idxOf(state());
  };
  /* Stepping onto a tag whose layer is closed: keep going the same way. */
  window.addEventListener('popstate', (event) => {
    if (rebase) {
      /* our own pop onto the page entry: nobody else should hear it */
      event.stopImmediatePropagation();
      const { page, top, href } = rebase;
      rebase = null;
      replace(page, '', href);
      push(top, '', href);
      lastIdx = idxOf(state());
      return;
    }
    const now = state();
    const idx = idxOf(now);
    const layer = now?.[TAG];
    /* our entry copies the router's idx, so a tie is a step forward onto it */
    const forward = idx >= lastIdx;
    lastIdx = idx;
    if (typeof layer === 'string' && !openLayers.has(layer)) {
      window.history.replaceState(strip(now), '', window.location.href);
      if (forward) window.history.forward(); else window.history.back();
    }
  });
}

/* At import, before anything renders: any tag in history is a reload's. */
install();

export function useBackCloses(open: boolean, close: () => void, layer: string): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    openLayers.add(layer);
    const pending = leaving.get(layer);
    if (pending !== undefined) { window.clearTimeout(pending); leaving.delete(layer); }
    if (!tagged(layer)) {
      window.history.pushState({ ...(state() ?? {}), [TAG]: layer, [BASE]: window.location.href }, '', window.location.href);
    }
    let popped = false;
    const onPop = () => {
      if (tagged(layer)) return;
      popped = true;
      openLayers.delete(layer);
      closeRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (popped) return;
      /* closed by something other than Back: take our entry with us, but
         only if it is still the one on top — a navigation since then owns
         the history now, and stepping back would undo it. */
      leaving.set(layer, window.setTimeout(() => {
        leaving.delete(layer);
        openLayers.delete(layer);
        if (!tagged(layer)) return;
        if (state()?.[BASE] === window.location.href) window.history.back();
        else window.history.replaceState(strip(state()), '', window.location.href);
      }, 0));
    };
  }, [open, layer]);
}
