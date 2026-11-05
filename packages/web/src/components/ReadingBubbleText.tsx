import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DialogSurface } from './DialogSurface';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';

import type { ReadingDetailActions } from './ReadingDetails';
const ReadingDetails = lazy(() => import('./ReadingDetails'));

/**
 * THE READING, IN FULL, IN THE BUBBLE (waka-design-brief.md §3b).
 *
 * It used to be a teaser: the sentence clamped to a few lines with "Read in
 * full" opening a sheet, so the reward for saving was one press away and
 * looked like a preview of itself. The brief: "It shows the current reading,
 * not a teaser … No truncation with '…'." So every word is here, and the
 * footer is two acts, text only — "Why?" and "Talk about this".
 *
 * "WHY?" OPENS IN PLACE. It lists the saves the entry rests on, inside the
 * bubble, because the question "what made you say that" is answered by the
 * person's own words and needs no page.
 *
 * EDIT AND REMOVE ARE KEPT, ONE LEVEL DOWN. The founder's ruling on this
 * surface (docs/six-laws.md, Law 11's exception) is that a top of mind can be
 * edited or removed. Those acts are administration, and Law 11 says they may
 * not sit in the same row as the response; so they live inside "Why?", as
 * "Edit or remove", which opens the same sheet "Read in full" used to.
 *
 * A READING WITH SEVERAL ENTRIES PAGES, one entry per page, by dots under the
 * text. The dots are states, not numbers (a page's position is spoken to a
 * screen reader, never printed).
 */
export function ReadingBubbleText({ text, locale, onShare, onChat, chatDisabled, details, why, pager }: {
  text: string; locale: SupportedLocale; onShare?: () => void; onChat?: () => void; chatDisabled?: boolean; details?: ReadingDetailActions;
  /** What the entry rests on: the saves behind its cited signals. */
  why?: ReadonlyArray<{ id: string; preview: string }>;
  pager?: { count: number; at: number; onGo: (index: number) => void };
}) {
  const [whyOpen, setWhyOpen] = useState(false);
  /* The reading and "Why?" scroll together, in one region over the act row,
     so opening "Why?" can neither squeeze the reading to nothing nor push
     the acts out of the paper; and opening it brings the list into view. */
  const whyRef = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (whyOpen) whyRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [whyOpen]);
  const [expanded, setExpanded] = useState<{ text: string; onShare?: () => void; details?: ReadingDetailActions } | null>(null);
  const [editState, setEditState] = useState({ dirty: false, busy: false });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const close = () => { if (editState.busy) return; if (editState.dirty) setConfirmDiscard(true); else setExpanded(null); };
  /* The dots sit in the act row, between "Why?" and "Talk about this": the
     paper over the companion is the scarcest room on the screen, and a row
     of its own cost a line of the reading on a phone. */
  const pages = pager && pager.count > 1 ? <span className="waka-says-pager" role="group" aria-label={t(locale, 'worldReadingPages')}>
      {Array.from({ length: pager.count }, (_, index) => (
        <button key={index} type="button" className="waka-says-dot" aria-current={index === pager.at ? 'true' : undefined}
          aria-label={formatMessage(locale, 'worldReadingPage', { at: index + 1, count: pager.count })}
          onClick={() => { setWhyOpen(false); pager.onGo(index); }} />
      ))}
    </span> : null;
  const openSheet = () => { setEditState({ dirty: false, busy: false }); setConfirmDiscard(false); setExpanded({ text, onShare, details }); };
  return <>
    <span className="waka-says-scroll">
    <span className="waka-reading-preview">
      <span className="jar-char-bubble-reading">{text}</span>
    </span>
    {whyOpen ? <span ref={whyRef} className="waka-says-why" role="region" aria-label={t(locale, 'worldReadingWhy')}>
      {why && why.length ? <span className="waka-says-why-list">{why.map(row => <span key={row.id} className="waka-says-why-row">{row.preview}</span>)}</span>
        : <span className="waka-says-why-row">{t(locale, 'worldReadingWhyNone')}</span>}
      {details || onShare ? <button type="button" className="jar-char-bubble-act waka-says-edit" onClick={openSheet}>{t(locale, 'worldReadingEditOrRemove')}</button> : null}
    </span> : null}
    </span>
    {why || details || onShare || onChat ? <span className="jar-char-bubble-acts">
      {why || details || onShare ? <button type="button" className="jar-char-bubble-act" aria-expanded={whyOpen} onClick={() => setWhyOpen(open => !open)}>
        {t(locale, 'worldReadingWhy')}
      </button> : null}
      {pages}
      {onChat ? <button type="button" className="jar-char-bubble-act" disabled={chatDisabled} onClick={onChat}>
        {t(locale, 'worldTalkAboutThis')}
      </button> : null}
    </span> : pages}
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
