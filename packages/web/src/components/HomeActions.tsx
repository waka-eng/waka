import { useEffect, useRef, useState } from 'react';
import { t, type SupportedLocale } from '../lib/locales';

/* SEARCH AND PAST CHATS LIVE HERE (design F, from #463). They were the
   bar's Inspirations and Chats tabs; the bar is for starting something now,
   and these are doors you take sometimes, which is what this menu holds. */
export function HomeActions({ locale, onPrinciples, onReview, onRetryReview, onSearch, onChats }: {
  locale: SupportedLocale; onPrinciples: () => void; onReview?: () => void; onRetryReview?: () => void;
  onSearch?: () => void; onChats?: () => void;
}) {
  const [open, setOpen] = useState(false), root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if ((event.target as Element).closest?.('[role="dialog"]')) return;
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <div className="waka-home-actions" ref={root} onKeyDown={event => {
    if (event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
  }}>
    <button ref={trigger} type="button" className="waka-corner" aria-expanded={open} onClick={() => setOpen(value => !value)}>{t(locale, 'worldReadingActions')}</button>
    <div className="waka-home-actions-list" hidden={!open}>
      {onSearch ? <button onClick={() => { setOpen(false); onSearch(); }}>{t(locale, 'worldActionsSearch')}</button> : null}
      {onChats ? <button onClick={() => { setOpen(false); onChats(); }}>{t(locale, 'worldActionsChats')}</button> : null}
      <button onClick={() => { setOpen(false); onPrinciples(); }}>{t(locale, 'worldViewPrinciples')}</button>
      {onRetryReview?<button onClick={()=>{setOpen(false);onRetryReview();}}>{t(locale,'worldReviewLoadRetry')}</button>:null}
      {onReview ? <button onClick={() => { setOpen(false); onReview(); }}>{t(locale, 'worldActionsReview')}</button> : !onRetryReview ? <span>{t(locale, 'worldActionsNoReview')}</span> : null}
    </div>
  </div>;
}
