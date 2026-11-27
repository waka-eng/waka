import { lazy, Suspense, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DialogSurface } from './DialogSurface';
import { SurfaceHeader } from './SurfaceHeader';
import { t, type SupportedLocale } from '../lib/locales';

import type { ReadingDetailActions } from './ReadingDetails';
const ReadingDetails = lazy(() => import('./ReadingDetails'));

/**
 * ═══ THE READ, WHOLE, AND EVERYTHING IT DOES UNDER IT (2026-11-12) ════════
 *
 * The bubble holds the whole read (it is never cut off), so there is no
 * "read in full" to open: founder, of the page that did it, "sooo big and
 * ugly". Chosen from six ("bubble grows in place"): the read stays with the
 * creature that said it, and its acts are one row at its foot. Why? and
 * Chat about this in words, Share and Edit as icons after them.
 *
 * EDIT IS THE ONE PAGE. Rewriting needs a field and room to type, so Edit
 * opens the quiet page with the words already in the field; leaving it with
 * unsaved words asks first.
 */
export function ReadingBubbleText({ text, locale, onShare, onChat, chatDisabled, details, why, whyLabel, onWhy, onNotQuite }: {
  text: string; locale: SupportedLocale;
  onShare?: () => void; onChat?: () => void; chatDisabled?: boolean; details?: ReadingDetailActions;
  /** The saves the read rests on, by their own words. */
  why?: ReadonlyArray<{ id: string; preview: string; photoId?: string | null; wordless?: boolean }>;
  /** Why?, answered in a chat: WAKA says the read and the saves it came
      from (founder, 2026-11-12: "when clicking on why, open chat and tell
      user how this was formed"). */
  onWhy?: () => void;
  /** What the Why? act says: "From 3 inspirations" on home. */
  whyLabel?: string;
  /** "Not quite": the person says the read is off, and says what is closer. */
  onNotQuite?: () => void;
}) {
  const [editing, setEditing] = useState<{ text: string; details: ReadingDetailActions } | null>(null);
  const [editState, setEditState] = useState({ dirty: false, busy: false });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const close = () => { if (editState.busy) return; if (editState.dirty) setConfirmDiscard(true); else setEditing(null); };
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const hasWhy = Boolean(why && why.length && onWhy);
  /* ═══ TWO ACTS ON THE BUBBLE; THE REST ON A LONG PRESS (audit, 2026-11-26:
     four acts ran past the bubble's edge, and the founder: "so many action
     buttons in a small space") ═══ Share and Edit wording open from a long
     press (or a right click) on the words, as an action sheet from the
     foot of the screen, the way iOS offers an item's other actions. */
  const [more, setMore] = useState(false);
  const held = useRef(0);
  /* The words, where focus goes back to once the sheet's choice is done. */
  const words = useRef<HTMLSpanElement>(null);
  const hold = () => { window.clearTimeout(held.current); held.current = window.setTimeout(() => setMore(true), 500); };
  const letGo = () => window.clearTimeout(held.current);
  const edit = details ? () => { setEditState({ dirty: false, busy: false }); setConfirmDiscard(false); setEditing({ text, details }); } : null;
  return <>
    <span className="waka-reading-preview">
      {/* A LONG READ SCROLLS INSIDE THE BUBBLE, so it takes focus: a keyboard
          reaches its end too (code review, 2026-11-13). */}
      <span ref={words} className="jar-char-bubble-reading" tabIndex={0} role="region" aria-label={say('worldNowTitle')}
        onContextMenu={onShare || edit || onNotQuite ? event => { event.preventDefault(); setMore(true); } : undefined}
        onPointerDown={onShare || edit || onNotQuite ? hold : undefined} onPointerUp={letGo} onPointerLeave={letGo} onPointerCancel={letGo}>{text}</span>
    </span>
    {hasWhy || onChat || onShare || edit || onNotQuite ? <span className="jar-char-bubble-acts">
      {hasWhy && onWhy ? <button type="button" className="jar-char-bubble-act" onClick={onWhy}>{whyLabel ?? say('worldReadingWhy')}</button> : null}
      {onChat ? <button type="button" className="jar-char-bubble-act" disabled={chatDisabled} onClick={onChat}>
        {say('worldTalkAboutThis')}
      </button> : null}
    </span> : null}
    {more ? createPortal(<div className="waka-action-sheet" role="dialog" aria-modal="true" aria-label={say('worldNowTitle')}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setMore(false); } }}>
      <button type="button" className="waka-action-sheet-scrim" aria-label={say('worldCancel')} tabIndex={-1} onClick={() => setMore(false)} />
      <div className="waka-action-sheet-card">
        <div className="waka-action-sheet-group">
          {onNotQuite ? <button type="button" autoFocus onClick={() => { setMore(false); onNotQuite(); }}>{say('worldReadingNotQuite')}</button> : null}
          {edit ? <button type="button" autoFocus={!onNotQuite} onClick={() => { setMore(false); words.current?.focus(); edit(); }}>{say('worldEditWording')}</button> : null}
          {onShare ? <button type="button" autoFocus={!edit && !onNotQuite} onClick={() => { setMore(false); onShare(); }}>{say('worldShare')}</button> : null}
        </div>
        <button type="button" className="waka-action-sheet-cancel" onClick={() => setMore(false)}>{say('worldCancel')}</button>
      </div>
    </div>, document.body) : null}
    {editing ? createPortal(<div className="waka-reading-sheet">
      <DialogSurface className="waka-reading-full" aria-label={say('worldNowTitle')} onClose={close}>
        <SurfaceHeader locale={locale} back={{ kind: 'close', onBack: close, disabled: editState.busy }} title={say('worldNowTitle')} />
        <div className="waka-reading-full-body" tabIndex={0}>{confirmDiscard ? <div role="alert"><p>{say('worldReadingDiscardConfirm')}</p><button onClick={() => setConfirmDiscard(false)}>{say('worldReadingKeepEditing')}</button><button onClick={() => setEditing(null)}>{say('worldReadingDiscard')}</button></div> : null}<Suspense fallback={<p role="status">{say('worldSourceChecking')}</p>}><ReadingDetails text={editing.text} locale={locale} actions={editing.details} onEditState={setEditState} onClose={() => setEditing(null)} /></Suspense></div>
      </DialogSurface>
    </div>, document.body) : null}
  </>;
}
