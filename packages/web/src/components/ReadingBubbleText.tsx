import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DialogSurface } from './DialogSurface';
import { SheetBack } from './PageBack';
import { t, type SupportedLocale } from '../lib/locales';

import type { ReadingDetailActions } from './ReadingDetails';
const ReadingDetails = lazy(() => import('./ReadingDetails'));

/**
 * ═══ THE READ, IN THREE LINES — AND WHY (design F1, F2) ════════════════════
 *
 * "On your mind lately", the sentence clamped to THREE lines, and two acts
 * under a hairline: "Why?" and "Talk about this". Three lines because the
 * bubble is the reward for saving, not the place to read an essay; the rest
 * is carried by the two acts (and by pressing the sentence itself, which
 * opens it in full — with editing and removing, the founder's ruling for a
 * top of mind — on the sheet it always opened).
 *
 * "WHY?" ANSWERS IN PLACE (F2, from #463). The question "what made you say
 * that" is answered by the person's own words, so the bubble turns over:
 * "Because you kept these", the saves behind the read quoted one per row,
 * and Back / See all saves. No page — the person is still looking at the
 * creature that said it. Its saves come from the cited signals' own
 * evidence (`whyFor` in `Home.tsx`); with none to show, "Why?" is not
 * offered, because a question with no answer behind it is a dead control.
 */
export function ReadingBubbleText({ text, locale, label, onShare, onChat, chatDisabled, details, why, onSeeAll }: {
  text: string; locale: SupportedLocale;
  /** The small line over the read ("On your mind lately"). */
  label?: string;
  onShare?: () => void; onChat?: () => void; chatDisabled?: boolean; details?: ReadingDetailActions;
  /** The saves the read rests on, by their own words. */
  why?: ReadonlyArray<{ id: string; preview: string }>;
  /** "See all saves" — the saves, patterns and principles in one scroll. */
  onSeeAll?: () => void;
}) {
  const reading = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [expanded, setExpanded] = useState<{ text: string; onShare?: () => void; details?: ReadingDetailActions } | null>(null);
  const [editState, setEditState] = useState({ dirty: false, busy: false });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const close = () => { if (editState.busy) return; if (editState.dirty) setConfirmDiscard(true); else setExpanded(null); };
  useEffect(() => { setWhyOpen(false); }, [text]);
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
  }, [text, whyOpen]);
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const opensInFull = Boolean(details || overflow || onShare);
  const openSheet = () => { setEditState({ dirty: false, busy: false }); setConfirmDiscard(false); setExpanded({ text, onShare, details }); };
  const hasWhy = Boolean(why && why.length);
  return <>
    {whyOpen && hasWhy ? <>
      <span className="jar-char-bubble-of">{say('worldReadingWhyLabel')}</span>
      <span className="waka-says-why" role="list" aria-label={say('worldReadingWhyLabel')}>
        {why!.map(row => <span key={row.id} role="listitem" className="waka-says-why-row">“{row.preview}”</span>)}
      </span>
      <span className="jar-char-bubble-acts">
        <button type="button" className="jar-char-bubble-act" onClick={() => setWhyOpen(false)}>{say('worldBack')}</button>
        {onSeeAll ? <button type="button" className="jar-char-bubble-act" onClick={() => { setWhyOpen(false); onSeeAll(); }}>{say('worldBubbleSeeAll')}</button> : null}
      </span>
    </> : <>
      {label ? <span className="jar-char-bubble-of">{label}</span> : null}
      <span className="waka-reading-preview">
        {opensInFull
          /* THE SENTENCE IS ITS OWN "READ IN FULL": three lines are all the
             bubble shows, and pressing them shows the rest. */
          ? <button type="button" className="waka-reading-open" aria-haspopup="dialog" onClick={openSheet}>
              <span ref={reading} className="jar-char-bubble-reading">{text}</span>
            </button>
          : <span ref={reading} className="jar-char-bubble-reading">{text}</span>}
      </span>
      {hasWhy || onChat ? <span className="jar-char-bubble-acts">
        {/* NO "READ IN FULL": the sentence is its own way in (above). */}
        {hasWhy ? <button type="button" className="jar-char-bubble-act" aria-expanded={false} onClick={() => setWhyOpen(true)}>{say('worldReadingWhy')}</button> : null}
        {onChat ? <button type="button" className="jar-char-bubble-act" disabled={chatDisabled} onClick={onChat}>
          {say('worldTalkAboutThis')}
        </button> : null}
      </span> : null}
    </>}
    {expanded ? createPortal(<div className="waka-reading-sheet">
      <DialogSurface className="waka-reading-full" aria-label={say('worldNowTitle')} onClose={close}>
        <header><SheetBack label={say('worldBack')} disabled={editState.busy} onBack={close} /><h2>{say('worldNowTitle')}</h2></header>
        <div className="waka-reading-full-body" tabIndex={0}>{confirmDiscard ? <div role="alert"><p>{say('worldReadingDiscardConfirm')}</p><button onClick={() => setConfirmDiscard(false)}>{say('worldReadingKeepEditing')}</button><button onClick={() => setExpanded(null)}>{say('worldReadingDiscard')}</button></div> : null}<p>{expanded.text}</p>{expanded.details ? <Suspense fallback={<p role="status">{say('worldSourceChecking')}</p>}><ReadingDetails text={expanded.text} locale={locale} actions={expanded.details} onEditState={setEditState} onClose={() => setExpanded(null)} /></Suspense> : null}</div>
        {expanded.onShare && !editState.dirty && !editState.busy ? <footer><button type="button" onClick={() => { setExpanded(null); expanded.onShare?.(); }}>{say('worldShare')}</button></footer> : null}
      </DialogSurface>
    </div>, document.body) : null}
  </>;
}
