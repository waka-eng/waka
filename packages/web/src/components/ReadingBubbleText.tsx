import { lazy, Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { DialogSurface } from './DialogSurface';
import { HomeActionIcon } from './HomeActionIcon';
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
export function ReadingBubbleText({ text, locale, onShare, onChat, chatDisabled, details, why, onWhy }: {
  text: string; locale: SupportedLocale;
  onShare?: () => void; onChat?: () => void; chatDisabled?: boolean; details?: ReadingDetailActions;
  /** The saves the read rests on, by their own words. */
  why?: ReadonlyArray<{ id: string; preview: string; photoId?: string | null; wordless?: boolean }>;
  /** Why?, answered in a chat: WAKA says the read and the saves it came
      from (founder, 2026-11-12: "when clicking on why, open chat and tell
      user how this was formed"). */
  onWhy?: () => void;
}) {
  const [editing, setEditing] = useState<{ text: string; details: ReadingDetailActions } | null>(null);
  const [editState, setEditState] = useState({ dirty: false, busy: false });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const close = () => { if (editState.busy) return; if (editState.dirty) setConfirmDiscard(true); else setEditing(null); };
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const hasWhy = Boolean(why && why.length && onWhy);
  const edit = details ? () => { setEditState({ dirty: false, busy: false }); setConfirmDiscard(false); setEditing({ text, details }); } : null;
  return <>
    <span className="waka-reading-preview">
      {/* A LONG READ SCROLLS INSIDE THE BUBBLE, so it takes focus: a keyboard
          reaches its end too (code review, 2026-11-13). */}
      <span className="jar-char-bubble-reading" tabIndex={0} role="region" aria-label={say('worldNowTitle')}>{text}</span>
    </span>
    {hasWhy || onChat || onShare || edit ? <span className="jar-char-bubble-acts">
      {hasWhy && onWhy ? <button type="button" className="jar-char-bubble-act" onClick={onWhy}>{say('worldReadingWhy')}</button> : null}
      {onChat ? <button type="button" className="jar-char-bubble-act" disabled={chatDisabled} onClick={onChat}>
        {say('worldTalkAboutThis')}
      </button> : null}
      {onShare ? <button type="button" className="jar-char-bubble-act jar-char-bubble-act--icon" aria-label={say('worldShare')} title={say('worldShare')} onClick={onShare}>
        <HomeActionIcon kind="share" />
      </button> : null}
      {edit ? <button type="button" className="jar-char-bubble-act jar-char-bubble-act--icon" aria-label={say('worldEditWording')} title={say('worldEditWording')} aria-haspopup="dialog" onClick={edit}>
        <HomeActionIcon kind="edit" />
      </button> : null}
    </span> : null}
    {editing ? createPortal(<div className="waka-reading-sheet">
      <DialogSurface className="waka-reading-full" aria-label={say('worldNowTitle')} onClose={close}>
        <SurfaceHeader locale={locale} back={{ kind: 'close', onBack: close, disabled: editState.busy }} title={say('worldNowTitle')} />
        <div className="waka-reading-full-body" tabIndex={0}>{confirmDiscard ? <div role="alert"><p>{say('worldReadingDiscardConfirm')}</p><button onClick={() => setConfirmDiscard(false)}>{say('worldReadingKeepEditing')}</button><button onClick={() => setEditing(null)}>{say('worldReadingDiscard')}</button></div> : null}<Suspense fallback={<p role="status">{say('worldSourceChecking')}</p>}><ReadingDetails text={editing.text} locale={locale} actions={editing.details} onEditState={setEditState} onClose={() => setEditing(null)} /></Suspense></div>
      </DialogSurface>
    </div>, document.body) : null}
  </>;
}
