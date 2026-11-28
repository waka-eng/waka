/**
 * ═══ THE PICTURE IS THE PAGE (founder, 2026-11-27, approving "A picture
 * save is the save" on the picture-saves board) ═══════════════════════════
 *
 * Screenshots will be how most people save, and a saved one opened as a
 * 320px-tall thumbnail with "Open original image ↗" under it: a file beside
 * the page instead of the thing you read. Now:
 *
 *   THE PICTURE FILLS THE COLUMN, trimmed of the other phone's status bar,
 *   header and tab bar (`lib/picture-trim.ts`) so the words it was saved for
 *   are what shows. On a desk a tall screenshot is held to the window's
 *   height, so its words, quoted under it, show without scrolling.
 *
 *   A TAP OPENS IT WHOLE: full screen, untrimmed, pinch to zoom (or a
 *   trackpad pinch, or a double tap), and the same "<" every page has goes
 *   back. Escape is that "<", as everywhere (nav system).
 *
 *   NOTHING IS SAID ABOUT IT. No link, no caption, no scene description. The
 *   words read from it are `SavedImageWords`, drawn under it by the page;
 *   the original's download lives in the page's ⋯ (`NoteTools`).
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

import { fetchAttachmentUrl } from '../lib/api';
import { t, type SupportedLocale } from '../lib/locales';
import { NO_TRIM, readTrim, type Trim } from '../lib/picture-trim';
import { SurfaceHeader } from './SurfaceHeader';

export function NotePicture({ id, label, locale }: { id: string; label: string; locale: SupportedLocale }): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [url, setUrl] = useState(''), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  /* READ WITH CORS FIRST, so the trim may look at the pixels; a store that
     will not answer a CORS read still shows the picture, whole. */
  const [cors, setCors] = useState(true);
  const [shape, setShape] = useState<{ width: number; height: number; trim: Trim } | null>(null);
  const [whole, setWhole] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setUrl(''); setFailed(false); setShape(null); setCors(true);
    void fetchAttachmentUrl(id, controller.signal).then(value => { if (!controller.signal.aborted) setUrl(value); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [id, retry]);
  if (failed) return <div className="waka-note-picture">
    <p role="alert" className="waka-note-picture-failed">{say('worldAttachmentOpenFailed')} <button type="button" onClick={() => setRetry(value => value + 1)}>{say('worldRoomHistoryRetry')}</button></p>
  </div>;
  const trim = shape?.trim ?? NO_TRIM;
  const shown = shape ? shape.height * (1 - trim.top - trim.bottom) : 0;
  const frame: CSSProperties | undefined = shape ? {
    aspectRatio: `${shape.width} / ${shown}`,
    ['--pic-ratio' as string]: String(shape.width / shown),
  } : undefined;
  return <figure className={`waka-note-picture${shape ? '' : ' waka-note-picture--loading'}`} data-trimmed={trim.top || trim.bottom ? '' : undefined}>
    <button ref={opener} type="button" className="waka-note-picture-open" style={frame} aria-label={say('worldPictureWhole')}
      disabled={!shape} onClick={() => setWhole(true)}>
      {url ? <img key={cors ? 'cors' : 'plain'} src={url} alt={label} crossOrigin={cors ? 'anonymous' : undefined} decoding="async"
        style={shape ? { marginTop: `${-(trim.top * shape.height / shape.width) * 100}%` } : undefined}
        onLoad={event => {
          const image = event.currentTarget;
          setShape({ width: image.naturalWidth || 1, height: image.naturalHeight || 1, trim: cors ? readTrim(image) : NO_TRIM });
        }}
        onError={() => { if (cors) setCors(false); else setFailed(true); }} /> : null}
    </button>
    {whole && url ? <PictureWhole url={url} label={label} locale={locale}
      onClose={() => { setWhole(false); opener.current?.focus({ preventScroll: true }); }} /> : null}
  </figure>;
}

const MAX_ZOOM = 4;
type View = { scale: number; x: number; y: number };
const REST: View = { scale: 1, x: 0, y: 0 };
const clampScale = (scale: number) => Math.min(MAX_ZOOM, Math.max(1, scale));

/**
 * The picture whole, over everything: the page's own "<" at the top, the
 * picture fitted edge to edge under it. Two fingers zoom about their middle
 * and one finger moves a zoomed picture; a double tap goes to 2x and back.
 */
function PictureWhole({ url, label, locale, onClose }: { url: string; label: string; locale: SupportedLocale; onClose: () => void }): JSX.Element {
  const surface = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(REST);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; mid: { x: number; y: number }; from: View } | null>(null);
  useEffect(() => { surface.current?.querySelector<HTMLButtonElement>('.waka-surface-back')?.focus({ preventScroll: true }); }, []);
  /* A TRACKPAD PINCH ARRIVES AS A CTRL-WHEEL; a page zoom must not take it. */
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setView(current => about(current, clampScale(current.scale * Math.exp(-event.deltaY / 100)), centre(node, event.clientX, event.clientY)));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [a, b] = [...pointers.current.values()];
    gesture.current = a && b ? { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, from: view }
      : a ? { distance: 0, mid: a, from: view } : null;
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [a, b] = [...pointers.current.values()];
    const g = gesture.current;
    if (a && b && g.distance > 0) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = clampScale(g.from.scale * Math.hypot(a.x - b.x, a.y - b.y) / g.distance);
      const at = about(g.from, scale, centre(stage.current!, g.mid.x, g.mid.y));
      setView(bound({ scale, x: at.x + mid.x - g.mid.x, y: at.y + mid.y - g.mid.y }, stage.current));
    } else if (a && g.from.scale > 1) {
      setView(bound({ ...g.from, x: g.from.x + a.x - g.mid.x, y: g.from.y + a.y - g.mid.y }, stage.current));
    }
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const [a] = [...pointers.current.values()];
    /* one finger left after a pinch carries on as a move from where it is */
    gesture.current = a ? { distance: 0, mid: a, from: view } : null;
  };
  return createPortal(
    <div ref={surface} className="waka-picture-whole" role="dialog" aria-modal="true" aria-label={label} data-jar-surface="1"
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        /* one control on this surface: Tab stays on it */
        else if (event.key === 'Tab') { event.preventDefault(); surface.current?.querySelector<HTMLButtonElement>('.waka-surface-back')?.focus(); }
      }}>
      <SurfaceHeader locale={locale} back={{ kind: 'back', onBack: onClose }} srTitle={label} />
      <div ref={stage} className="waka-picture-whole-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={event => setView(current => current.scale > 1 ? REST : about(current, 2, centre(event.currentTarget, event.clientX, event.clientY)))}>
        <img src={url} alt={label} draggable={false}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
      </div>
    </div>,
    document.body,
  );
}

/** A point on the stage, measured from its centre (where scale is about). */
function centre(node: HTMLElement, x: number, y: number) {
  const box = node.getBoundingClientRect();
  return { x: x - box.left - box.width / 2, y: y - box.top - box.height / 2 };
}
/** Zoom to `scale` keeping the picture's point under `at` where it is. */
function about(view: View, scale: number, at: { x: number; y: number }): View {
  if (scale === 1) return REST;
  const k = scale / view.scale;
  return { scale, x: at.x - (at.x - view.x) * k, y: at.y - (at.y - view.y) * k };
}
/** A zoomed picture cannot be pushed further than its own edge. */
function bound(view: View, node: HTMLElement | null): View {
  if (!node || view.scale <= 1) return { ...view, x: 0, y: 0, scale: Math.max(1, view.scale) };
  const box = node.getBoundingClientRect();
  const sx = box.width * (view.scale - 1) / 2, sy = box.height * (view.scale - 1) / 2;
  return { scale: view.scale, x: Math.max(-sx, Math.min(sx, view.x)), y: Math.max(-sy, Math.min(sy, view.y)) };
}
