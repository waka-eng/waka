/**
 * ═══ ONE HEADER FOR EVERY SURFACE THAT IS NOT HOME (nav system, 2026-11-09) ═══
 *
 * Founder: "still inconsistencies like some parts just use < but some are
 * < back and like certain headers and things appear in certain places vs
 * disappear in certain". There were four ways out (a floating "<", a "< Home"
 * with a word, a sheet's inline "<", a "⌄ Home"), each placed by its own rule.
 * This is the one that replaced all of them.
 *
 * THE RULES IT ENFORCES, so no caller can drift:
 *   R1  One 44px row, in the surface's own flow (never fixed or floating),
 *       three slots: [44px left] [centred title] [≤1 right item].
 *   R2  The left is always the "<" glyph alone. Its name is "Back" when it
 *       returns to a surface that is not home, "Close" when it dismisses to
 *       home or closes a sheet. No word beside it, ever.
 *   R3  Escape, Android back and the iOS edge swipe call the SAME handler
 *       (`back.onBack`). A `DialogSurface` passes it as `onClose`; a page
 *       also turns on the native gestures here (`gesture`).
 *   R4  The title is short, plain, meta size, muted, one line. Empty only
 *       where something on the surface is already the heading (a review's
 *       question, a principle), and then `srTitle` names it for a reader.
 *   R5  The right holds one plain word or one "⋯", never filled or boxed.
 */
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';

import { isMobileBuild } from '../lib/platform';
import { t, type SupportedLocale } from '../lib/locales';

/** What the "<" does: back to a surface that is not home, or close to home / close a sheet. */
export type BackKind = 'back' | 'close';

export interface SurfaceBack {
  kind: BackKind;
  /** May be async (a settings page that asks before it leaves); not awaited. */
  onBack: () => void | Promise<unknown>;
  disabled?: boolean;
}

/** The accessible name of the "<", decided by what it does and nothing else. */
function backLabel(locale: SupportedLocale, kind: BackKind): string {
  return t(locale, kind === 'back' ? 'worldBack' : 'worldClose');
}

function openSheet(): HTMLElement | null {
  /* `.waka-listening` IS A LAYER TOO (code review, 2026-11-09): the full-screen
     listening view covers the page, so a native back is its Escape (Done),
     never the page's "<" opening a question under it. */
  return [...document.querySelectorAll<HTMLElement>('[aria-modal="true"], [role="menu"], .waka-account, .waka-listening')]
    .filter(node => !node.closest('[hidden], [aria-hidden="true"], [inert]')).at(-1) ?? null;
}

/**
 * ANDROID'S BACK AND THE iOS LEFT-EDGE SWIPE, for a page. An open sheet over
 * the page gets an Escape instead (which its own header's handler answers),
 * so a native back never skips a layer. Returns how far a swipe has travelled,
 * for the "‹" hint.
 */
function useNativeBack(onBack: () => void | Promise<unknown>, navigationKey: string | null): number {
  const action = useRef(onBack); action.current = onBack;
  const [distance, setDistance] = useState(0);
  useEffect(() => {
    if (!isMobileBuild || navigationKey === null) return;
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
          } else void action.current();
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
          if (go) void action.current();
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
    }).catch(() => { /* The visible "<" remains available. */ });
    return () => { disposed = true; remove?.(); setDistance(0); };
  }, [navigationKey]);
  return distance;
}

export function SurfaceHeader({ locale, back, title, srTitle, right, gesture = null, className, titleRef }: {
  locale: SupportedLocale;
  back: SurfaceBack;
  /** The visible centred title. Absent: the row's middle is empty. */
  title?: ReactNode;
  /** A heading for a screen reader when nothing visible is the title. */
  srTitle?: string;
  /** At most one plain word or one "⋯". */
  right?: ReactNode;
  /** A page's address: turns on Android back and the iOS edge swipe for it. */
  gesture?: string | null;
  className?: string;
  /** The title's heading, for a surface that moves focus to it (a settings sub-page). */
  titleRef?: Ref<HTMLHeadingElement>;
}): JSX.Element {
  const distance = useNativeBack(back.onBack, gesture);
  const label = backLabel(locale, back.kind);
  return (
    <header className={`waka-surface-head${className ? ` ${className}` : ''}`} data-surface-head="1" data-jar-chrome="1" data-jar-interactive="1">
      <button type="button" className="waka-surface-back" aria-label={label} data-back={back.kind}
        disabled={back.disabled} onClick={() => { void back.onBack(); }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m14 5-7 7 7 7" /></svg>
        {/* Said to a screen reader only; nothing is ever written beside the "<". */}
        <span className="sr-only">{label}</span>
      </button>
      {title !== undefined && title !== null && title !== '' ? (
        <h2 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="waka-surface-title">{title}</h2>
      ) : srTitle ? <h2 className="waka-surface-title sr-only">{srTitle}</h2> : <span className="waka-surface-title" aria-hidden="true" />}
      <span className="waka-surface-right">{right}</span>
      {distance > 0 ? <span className="waka-back-swipe" aria-hidden="true" style={{ opacity: distance / 100, transform: `translateX(${distance / 3}px)` }}>‹</span> : null}
    </header>
  );
}
