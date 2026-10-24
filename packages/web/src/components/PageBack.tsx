import { useEffect, useRef, useState } from 'react';
import { isMobileBuild } from '../lib/platform';

function openSheet(): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="menu"], .waka-account')]
    .filter(node => !node.closest('[hidden], [aria-hidden="true"]')).at(-1) ?? null;
}

/** The visible control and native gestures share the page's owned exit. */
export function PageBack({ label, onBack, navigationKey, belowCorners = false, visible = true }: {
  label: string; onBack: () => void; navigationKey: string; belowCorners?: boolean; visible?: boolean;
}) {
  const action = useRef(onBack); action.current = onBack;
  const [distance, setDistance] = useState(0);
  useEffect(() => {
    if (!isMobileBuild) return;
    let disposed = false, remove: (() => void) | undefined;
    void import('@capacitor/core').then(async ({ Capacitor }) => {
      if (disposed) return;
      if (Capacitor.getPlatform() === 'android') {
        const { App } = await import('@capacitor/app');
        if (disposed) return;
        const listener = await App.addListener('backButton', () => {
          if (disposed) return;
          const sheet = openSheet();
          if (sheet) {
            const target = sheet.contains(document.activeElement) ? document.activeElement! : sheet;
            target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
          } else action.current();
        });
        if (disposed) void listener.remove();
        else remove = () => { void listener.remove(); };
      } else if (Capacitor.getPlatform() === 'ios') {
        let start: { x: number; y: number } | null = null;
        const reset = () => { start = null; setDistance(0); };
        const begin = (event: TouchEvent) => {
          reset();
          const touch = event.touches[0];
          if (event.touches.length !== 1 || !touch || touch.clientX > 24 || openSheet() ||
            (event.target instanceof Element && event.target.closest('input, textarea, select, button, a, [contenteditable="true"]'))) return;
          start = { x: touch.clientX, y: touch.clientY };
        };
        const move = (event: TouchEvent) => {
          if (!start) return;
          if (event.touches.length !== 1 || openSheet()) { reset(); return; }
          const dx = event.touches[0]!.clientX - start.x, dy = Math.abs(event.touches[0]!.clientY - start.y);
          if (dx < -8 || dy > 40 || (dy > 12 && dy > dx)) { reset(); return; }
          if (dx > 12 && dx > dy * 1.5) { event.preventDefault(); setDistance(Math.min(dx, 100)); }
        };
        const end = (event: TouchEvent) => {
          const touch = event.changedTouches[0];
          const go = start && touch && touch.clientX - start.x >= 72 &&
            Math.abs(touch.clientY - start.y) < 40 && !openSheet();
          reset();
          if (go) action.current();
        };
        window.addEventListener('touchstart', begin, { capture: true, passive: true });
        window.addEventListener('touchmove', move, { capture: true, passive: false });
        window.addEventListener('touchend', end, true);
        window.addEventListener('touchcancel', reset, true);
        remove = () => {
          window.removeEventListener('touchstart', begin, true);
          window.removeEventListener('touchmove', move, true);
          window.removeEventListener('touchend', end, true);
          window.removeEventListener('touchcancel', reset, true);
        };
      }
    }).catch(() => { /* The visible Back control remains available. */ });
    return () => { disposed = true; remove?.(); setDistance(0); };
  }, [navigationKey]);
  return <>
    {visible ? <button type="button" className="waka-page-back" data-below-corners={belowCorners || undefined}
      data-jar-chrome="1" data-jar-interactive="1" onClick={onBack}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m14 5-7 7 7 7"/></svg>
      <span>{label}</span>
    </button> : null}
    {distance > 0 ? <span className="waka-back-swipe" aria-hidden="true" style={{ opacity: distance / 100, transform: `translateX(${distance / 3}px)` }}>‹</span> : null}
  </>;
}
