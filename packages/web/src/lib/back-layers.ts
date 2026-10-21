/**
 * BACK CLOSES THE TOPMOST LAYER, AND HISTORY NEVER HEARS ABOUT IT.
 *
 * A layer (a saved note open inside the archive) is a state with no address.
 * Every earlier attempt gave it a history entry of its own, and each entry had
 * to be kept honest through replaces, reloads and stacking — and was not. See
 * `docs/plans/back-from-layers.md` for the cases.
 *
 * So a layer adds NO entry. When the person presses Back with a layer open, the
 * pop is caught before the router hears it: the entry we were on is written
 * back exactly (router state, key and idx included, so nothing re-renders) and
 * the topmost layer is asked to close. History keeps the shape it would have
 * had with no layer at all.
 *
 * Caught only when the pop is ONE step back by the router's `idx` and the app
 * did not ask for it itself (`expectAppPop`). Never calls `back`, `go` or
 * `replaceState`.
 */
import { useEffect, useRef } from 'react';

type Layer = { close: () => void };
const layers: Layer[] = [];
let entry: { state: unknown; href: string } | null = null;
let appPop = false;

const idxOf = (state: unknown): number | null => {
  const idx = state && typeof state === 'object' ? (state as { idx?: unknown }).idx : undefined;
  return typeof idx === 'number' ? idx : null;
};

/** The entry the person is on now; called after every router commit. */
export function noteEntry(): void {
  entry = { state: window.history.state, href: window.location.href };
}

/** The app is about to step back itself: the next pop is not the person's Back. */
export function expectAppPop(): void {
  appPop = true;
}

function popped(event: PopStateEvent): void {
  if (appPop) { appPop = false; return; }
  const top = layers[layers.length - 1];
  if (!top || !entry) return;
  const from = idxOf(entry.state), to = idxOf(window.history.state);
  if (from === null || to === null || to !== from - 1) return;
  event.stopImmediatePropagation();
  window.history.pushState(entry.state, '', entry.href);
  top.close();
}

/* Before the router mounts, so this listener is heard first. */
if (typeof window !== 'undefined') window.addEventListener('popstate', popped);

/** While `open`, the person's Back closes this layer (if it is the topmost) instead of leaving. */
export function useBackLayer(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const layer: Layer = { close: () => closeRef.current() };
    layers.push(layer);
    return () => {
      const at = layers.indexOf(layer);
      if (at >= 0) layers.splice(at, 1);
    };
  }, [open]);
}
