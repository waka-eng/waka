import { useEffect, useRef, useState } from 'react';
import { t, type SupportedLocale } from '../lib/locales';

export function HomeActions({ locale, onPrinciples, onReview }: {
  locale: SupportedLocale; onPrinciples: () => void; onReview?: () => void;
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
      <button onClick={() => { setOpen(false); onPrinciples(); }}>{t(locale, 'worldViewPrinciples')}</button>
      {onReview ? <button onClick={() => { setOpen(false); onReview(); }}>{t(locale, 'worldActionsReview')}</button> : <span>{t(locale, 'worldActionsNoReview')}</span>}
    </div>
  </div>;
}
