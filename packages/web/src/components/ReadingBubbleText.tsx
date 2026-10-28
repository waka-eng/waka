import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DialogSurface } from './DialogSurface';
import { t, type SupportedLocale } from '../lib/locales';

import type { ReadingDetailActions } from './ReadingDetails';
const ReadingDetails = lazy(() => import('./ReadingDetails'));

/** Keep the home reading compact, with an explicit way to read every word. */
export function ReadingBubbleText({ text, locale, onShare, onChat, chatDisabled, details }: {
  text: string; locale: SupportedLocale; onShare?: () => void; onChat?: () => void; chatDisabled?: boolean; details?: ReadingDetailActions;
}) {
  const reading = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [expanded, setExpanded] = useState<{ text: string; onShare?: () => void; details?: ReadingDetailActions } | null>(null);
  const [editState, setEditState] = useState({ dirty: false, busy: false });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const close = () => { if (editState.busy) return; if (editState.dirty) setConfirmDiscard(true); else setExpanded(null); };
  useEffect(() => {
    const node = reading.current;
    if (!node) return;
    let frame = 0;
    const measure = () => setOverflow(node.scrollHeight > node.clientHeight + 1);
    // React may change the preview's layout. Commit outside the observer's
    // delivery cycle so resizing cannot cause a ResizeObserver feedback loop.
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(node);
    window.addEventListener('resize', schedule);
    return () => { observer?.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('resize', schedule); };
  }, [text]);
  return <>
    <span className="waka-reading-preview">
      <span ref={reading} className="jar-char-bubble-reading">{text}</span>
    </span>
    {details || overflow || onShare || expanded || onChat ? <span className="jar-char-bubble-acts">
      {details || overflow || onShare || expanded ? <button type="button" className="jar-char-bubble-act" onClick={() => { setEditState({ dirty: false, busy: false }); setConfirmDiscard(false); setExpanded({ text, onShare, details }); }}>
        {t(locale, overflow ? 'worldReadFullReading' : 'worldViewReading')}
      </button> : null}
      {onChat ? <button type="button" className="jar-char-bubble-act" disabled={chatDisabled} onClick={onChat}>
        {t(locale, 'worldTalkAboutThis')}
      </button> : null}
    </span> : null}
    {expanded ? createPortal(<div className="waka-reading-sheet">
      <DialogSurface className="waka-reading-full" aria-label={t(locale, 'worldNowTitle')} onClose={close}>
        <header><h2>{t(locale, 'worldNowTitle')}</h2>
          <button type="button" disabled={editState.busy} onClick={close}>{t(locale, 'worldClose')}</button></header>
        <div className="waka-reading-full-body" tabIndex={0}>{confirmDiscard ? <div role="alert"><p>{t(locale, 'worldReadingDiscardConfirm')}</p><button onClick={() => setConfirmDiscard(false)}>{t(locale, 'worldReadingKeepEditing')}</button><button onClick={() => setExpanded(null)}>{t(locale, 'worldReadingDiscard')}</button></div> : null}<p>{expanded.text}</p>{expanded.details ? <Suspense fallback={<p role="status">{t(locale, 'worldSourceChecking')}</p>}><ReadingDetails text={expanded.text} locale={locale} actions={expanded.details} onEditState={setEditState} onClose={() => setExpanded(null)} /></Suspense> : null}</div>
        {expanded.onShare && !editState.dirty && !editState.busy ? <footer><button type="button" onClick={() => { setExpanded(null); expanded.onShare?.(); }}>{t(locale, 'worldBubbleActShare')}</button></footer> : null}
      </DialogSurface>
    </div>, document.body) : null}
  </>;
}
