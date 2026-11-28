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
 *   back. Escape is that "<", as everywhere (nav system). The whole view's
 *   other corner downloads this picture's original.
 *
 *   NOTHING IS SAID ABOUT IT. No link, no caption, no scene description. The
 *   words read from it are `SavedImageWords`, drawn under it by the page;
 *   a one-picture inspiration's ⋯ downloads the original too (`NoteTools`).
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';

import { t, type SupportedLocale } from '../lib/locales';
import { downloadOriginal, freshPictureUrl, noteStoreCors, storeAnswersCors } from '../lib/picture-download';
import { NO_TRIM, readTrim, type Trim } from '../lib/picture-trim';
import { HomeActionIcon } from './HomeActionIcon';
import { SurfaceHeader } from './SurfaceHeader';

export function NotePicture({ id, label, locale }: { id: string; label: string; locale: SupportedLocale }): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const [url, setUrl] = useState(''), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  /* READ WITH CORS FIRST, so the trim may look at the pixels; a store that
     will not answer a CORS read still shows the picture, whole. */
  const [cors, setCors] = useState(storeAnswersCors);
  const [shape, setShape] = useState<{ width: number; height: number; trim: Trim } | null>(null);
  const [whole, setWhole] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController(); setUrl(''); setFailed(false); setShape(null); setCors(storeAnswersCors());
    void freshPictureUrl(id, controller.signal).then(value => { if (!controller.signal.aborted) setUrl(value); })
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
          /* with CORS: the store answers it; without, after a CORS read
             failed: it does not, and the rest of the session knows */
          noteStoreCors(cors);
          setShape({ width: image.naturalWidth || 1, height: image.naturalHeight || 1, trim: cors ? readTrim(image) : NO_TRIM });
        }}
        onError={() => { if (cors) setCors(false); else setFailed(true); }} /> : null}
    </button>
    {whole && url ? <PictureWhole id={id} url={url} cors={cors} label={label} locale={locale}
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
 *
 * THE VIEW HOLDS FOCUS (code review, 2026-11-28): its root takes focus when
 * it opens and on every press on the picture, so Escape always reaches it
 * (and only it: the page under it stays open) and Tab walks its own two
 * controls, never the page behind.
 */
function PictureWhole({ id, url: first, cors: firstCors, label, locale, onClose }: {
  id: string; url: string; cors: boolean; label: string; locale: SupportedLocale; onClose: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const surface = useRef<HTMLDivElement>(null), stage = useRef<HTMLDivElement>(null), image = useRef<HTMLImageElement>(null);
  const [view, setView] = useState<View>(REST);
  /* THE PAGE'S URL FIRST, AND ONE FRESH ONE IF IT HAS LAPSED (code review,
     2026-11-28): a presigned read lives five minutes and the page may have
     been open longer. Read the way the page read it, CORS first. */
  const [source, setSource] = useState({ url: first, cors: firstCors, renewed: false });
  const [lost, setLost] = useState(false);
  /* a touch's last tap, for a double tap a phone never sends as dblclick */
  const lastTap = useRef<{ at: number; x: number; y: number } | null>(null);
  const travelled = useRef(false);
  const touchZoomAt = useRef(0);
  const [downloadFailed, setDownloadFailed] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ distance: number; mid: { x: number; y: number }; from: View } | null>(null);
  useEffect(() => { surface.current?.focus({ preventScroll: true }); }, []);
  const fit = (next: View) => bound(next, stage.current, image.current);
  /* A TRACKPAD PINCH ARRIVES AS A CTRL-WHEEL; a page zoom must not take it. */
  useEffect(() => {
    const node = stage.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setView(current => bound(about(current, clampScale(current.scale * Math.exp(-event.deltaY / 100)), centre(node, event.clientX, event.clientY)), node, image.current));
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);
  const toggleAt = (x: number, y: number) => {
    const node = stage.current;
    if (!node) return;
    const at = centre(node, x, y);
    setView(current => current.scale > 1 ? REST : bound(about(current, 2, at), node, image.current));
  };
  const down = (event: ReactPointerEvent<HTMLDivElement>) => {
    surface.current?.focus({ preventScroll: true });
    if (pointers.current.size === 0) travelled.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [a, b] = [...pointers.current.values()];
    gesture.current = a && b ? { distance: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, from: view }
      : a ? { distance: 0, mid: a, from: view } : null;
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    const g0 = gesture.current.mid;
    if (Math.hypot(event.clientX - g0.x, event.clientY - g0.y) > 24 || pointers.current.size > 1) travelled.current = true;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const [a, b] = [...pointers.current.values()];
    const g = gesture.current;
    if (a && b && g.distance > 0) {
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const scale = clampScale(g.from.scale * Math.hypot(a.x - b.x, a.y - b.y) / g.distance);
      const at = about(g.from, scale, centre(stage.current!, g.mid.x, g.mid.y));
      setView(fit({ scale, x: at.x + mid.x - g.mid.x, y: at.y + mid.y - g.mid.y }));
    } else if (a && g.from.scale > 1) {
      setView(fit({ ...g.from, x: g.from.x + a.x - g.mid.x, y: g.from.y + a.y - g.mid.y }));
    }
  };
  const up = (event: ReactPointerEvent<HTMLDivElement>) => {
    const alone = pointers.current.size === 1;
    pointers.current.delete(event.pointerId);
    /* ═══ A DOUBLE TAP, BY POINTER (code review, 2026-11-28): an iPhone
       never sends dblclick here, so two taps within 300ms and 24px of each
       other are one. A mouse keeps dblclick below. */
    if (event.pointerType !== 'mouse' && alone && event.type === 'pointerup') {
      const tap = { at: Date.now(), x: event.clientX, y: event.clientY };
      const prev = lastTap.current;
      if (travelled.current) lastTap.current = null;
      else if (prev && tap.at - prev.at <= 300 && Math.hypot(tap.x - prev.x, tap.y - prev.y) <= 24) {
        lastTap.current = null; touchZoomAt.current = Date.now(); toggleAt(tap.x, tap.y);
      } else lastTap.current = tap;
    }
    const [a] = [...pointers.current.values()];
    /* one finger left after a pinch carries on as a move from where it is */
    gesture.current = a ? { distance: 0, mid: a, from: view } : null;
  };
  /* LAPSED, OR REFUSED: one fresh URL, read as the page reads; then, with
     CORS, once without it; then the page's own "Couldn't open" with Try
     again, inside the view (code review, 2026-11-28). */
  const renew = () => {
    setLost(false);
    void freshPictureUrl(id).then(url => setSource({ url, cors: storeAnswersCors(), renewed: true }), () => setLost(true));
  };
  const lapsed = () => {
    if (!source.renewed) { renew(); return; }
    if (source.cors) { setSource(current => ({ ...current, cors: false })); return; }
    setLost(true);
  };
  return createPortal(
    <div ref={surface} className="waka-picture-whole" role="dialog" aria-modal="true" aria-label={label} data-jar-surface="1" tabIndex={-1}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); return; }
        if (event.key !== 'Tab') return;
        /* its own controls, round and round */
        event.preventDefault(); event.stopPropagation();
        const controls = [...(surface.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (!controls.length) return;
        const at = controls.indexOf(document.activeElement as HTMLButtonElement);
        const next = at < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
        controls[next]!.focus();
      }}>
      <SurfaceHeader locale={locale} back={{ kind: 'back', onBack: onClose }} srTitle={label}
        right={<button type="button" className="waka-picture-whole-download" aria-label={say('worldPictureDownload')}
          onClick={() => { setDownloadFailed(false); void downloadOriginal(id, label).then(ok => setDownloadFailed(!ok)); }}>
          <HomeActionIcon kind="download" />
        </button>} />
      <div ref={stage} className="waka-picture-whole-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onDoubleClick={event => { if (Date.now() - touchZoomAt.current > 500) toggleAt(event.clientX, event.clientY); }}>
        {lost ? null : <img ref={image} key={`${source.url}:${source.cors}`} src={source.url} alt={label} draggable={false}
          crossOrigin={source.cors ? 'anonymous' : undefined} onError={lapsed}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />}
        {lost ? <p role="alert" className="waka-note-picture-failed waka-picture-whole-lost">{say('worldAttachmentOpenFailed')} <button type="button" onClick={() => { setSource(current => ({ ...current, renewed: false })); renew(); }}>{say('worldRoomHistoryRetry')}</button></p> : null}
      </div>
      {downloadFailed ? <p className="waka-picture-whole-said" role="alert">{say('worldPictureDownloadFailed')}</p> : null}
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
/**
 * A zoomed picture cannot be pushed past its own edge. Measured against the
 * picture as it is drawn, contained in the stage (code review, 2026-11-28):
 * a tall screenshot is narrower than the stage, so the stage's box let it
 * slide off sideways into the dark.
 */
function bound(view: View, node: HTMLElement | null, picture: HTMLImageElement | null): View {
  if (!node || view.scale <= 1) return REST;
  const box = node.getBoundingClientRect();
  /* not laid out (yet): nothing to measure against, so nothing to hold */
  if (!box.width || !box.height) return view;
  const ratio = picture?.naturalWidth && picture.naturalHeight ? picture.naturalWidth / picture.naturalHeight : box.width / box.height;
  const drawn = box.width / box.height > ratio
    ? { width: box.height * ratio, height: box.height } : { width: box.width, height: box.width / ratio };
  const sx = Math.max(0, (drawn.width * view.scale - box.width) / 2), sy = Math.max(0, (drawn.height * view.scale - box.height) / 2);
  return { scale: view.scale, x: Math.max(-sx, Math.min(sx, view.x)), y: Math.max(-sy, Math.min(sy, view.y)) };
}
