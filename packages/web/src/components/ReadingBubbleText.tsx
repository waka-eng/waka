import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DialogSurface } from './DialogSurface';
import { t, type SupportedLocale } from '../lib/locales';

/** Keep the home reading compact, with an explicit way to read every word. */
export function ReadingBubbleText({ text, locale, onShare, onChat, chatDisabled }: {
  text: string; locale: SupportedLocale; onShare?: () => void; onChat?: () => void; chatDisabled?: boolean;
}) {
  const reading = useRef<HTMLSpanElement>(null);
  const [overflow, setOverflow] = useState(false);
  const [expanded, setExpanded] = useState<{ text: string; onShare?: () => void } | null>(null);
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
    {overflow || onShare || expanded || onChat ? <span className="jar-char-bubble-acts">
      {overflow || onShare || expanded ? <button type="button" className="jar-char-bubble-act" onClick={() => setExpanded({ text, onShare })}>
        {t(locale, overflow ? 'worldReadFullReading' : 'worldViewReading')}
      </button> : null}
      {onChat ? <button type="button" className="jar-char-bubble-act" disabled={chatDisabled} onClick={onChat}>
        {t(locale, 'worldTalkAboutThis')}
      </button> : null}
    </span> : null}
    {expanded ? createPortal(<div className="waka-reading-sheet">
      <DialogSurface className="waka-reading-full" aria-label={t(locale, 'worldNowTitle')} onClose={() => setExpanded(null)}>
        <header><h2>{t(locale, 'worldNowTitle')}</h2>
          <button type="button" onClick={() => setExpanded(null)}>{t(locale, 'worldClose')}</button></header>
        <div className="waka-reading-full-body" tabIndex={0}><p>{expanded.text}</p></div>
        {expanded.onShare ? <footer><button type="button" onClick={() => { setExpanded(null); expanded.onShare?.(); }}>{t(locale, 'worldBubbleActShare')}</button></footer> : null}
      </DialogSurface>
    </div>, document.body) : null}
  </>;
}
