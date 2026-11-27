/**
 * ═══ YOUR WEEK, IN ONE LINE (insight goal, phase 5) ═══
 *
 * The picture is the first principle's reveal, exactly (founder, 2026-11-26):
 * the night with the real creature glowing in the middle, and the reveal's
 * own words (`RevealWords`): a small muted "This week you came back to", the
 * week's line in the same large light type, "From n inspirations", and,
 * where the reveal's That's me / Not quite sit, "My week · November 20 to 26"
 * with a tiny WAKA under it. No box, no rule, no buttons in the picture.
 *
 * The sheet holds that picture scaled to fit, drawn at the phone's own 390
 * wide so it is the reveal's measure, and one word under it: Share, which
 * sends the same picture drawn as a file (`lib/week-artifact.ts`), the line
 * alone and never the saves' words. The grabber, a tap on the dim and Escape
 * put it down.
 *
 * NOT A `DialogSurface`: it holds no page and no header, only a picture and
 * one word, so it is a small dialog that takes focus on its grabber and
 * gives it back on the way out, the way the reading's action sheet does.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Companion } from './Companion';
import { RevealWords } from './PrinciplesOverlay';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';
import { SHARE_NOTICE_KEY, useShareImage } from '../lib/use-share-image';
import { renderWeekCard, WEEK_PICTURE } from '../lib/week-artifact';
import { weekWords } from '../lib/words';

/** "Nov 20 to 26" from the server's ISO bounds; `long` says "November". */
export function weekRange(fromIso: string, toIso: string, locale: SupportedLocale, month: 'short' | 'long' = 'short'): string {
  return weekWords(Date.parse(fromIso), Date.parse(toIso), locale, month);
}

/** The picture's words, the same in the sheet and in the shared file. */
function weekPictureWords(locale: SupportedLocale, week: { line: string; from: string; to: string; saves: number }) {
  return {
    label: t(locale, 'worldWeekLabel'),
    statement: week.line,
    from: formatMessage(locale, 'worldReadingFromCount', { count: week.saves }),
    foot: formatMessage(locale, 'worldWeekFoot', { range: weekRange(week.from, week.to, locale, 'long') }),
  };
}

export function WeeklyCard({ locale, line, from, to, saves, onClose }: {
  locale: SupportedLocale; line: string; from: string; to: string; saves: number; onClose: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  const words = weekPictureWords(locale, { line, from, to, saves });
  const grab = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    grab.current?.focus();
    return () => { before?.focus?.(); };
  }, []);
  /* The picture is laid out at 390 wide and scaled to the frame it is in. */
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const node = frame.current; if (!node) return undefined;
    const fit = () => setScale((node.clientWidth || WEEK_PICTURE.width) / WEEK_PICTURE.width);
    fit();
    const watch = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    watch?.observe(node);
    return () => watch?.disconnect();
  }, []);
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    let live = true;
    renderWeekCard(words).then(made => { if (live) setBlob(made); }, () => undefined);
    return () => { live = false; };
  }, [words.label, words.statement, words.from, words.foot]);
  const share = useShareImage(blob, { download: 'waka-my-week.png', share: 'waka-my-week.png' }, { fallback: 'copy' });

  return createPortal(<div className="waka-week" role="dialog" aria-modal="true" aria-label={say('worldWeekOffer')}
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }}>
    <button type="button" className="waka-week-scrim" tabIndex={-1} aria-hidden="true" onClick={onClose} />
    <div className="waka-week-sheet">
      <button ref={grab} type="button" className="waka-week-grab" aria-label={say('worldClose')} onClick={onClose} />
      <div ref={frame} className="waka-week-frame">
        <div className="waka-week-picture" style={{ width: WEEK_PICTURE.width, height: WEEK_PICTURE.height, transform: `scale(${scale})` }}>
          <span className="waka-week-being" aria-hidden="true"><Companion size={WEEK_PICTURE.being} pressable={false} /></span>
          <RevealWords label={words.label} statement={words.statement} from={words.from}>
            <span className="waka-week-foot">{words.foot}</span>
            <span className="waka-week-mark" aria-hidden="true">WAKA</span>
          </RevealWords>
        </div>
      </div>
      <button type="button" className="waka-week-share" disabled={!blob || share.busy} onClick={() => { void share.share(); }}>{say('worldShare')}</button>
      {share.notice ? <p className="waka-week-notice" role="status">{say(SHARE_NOTICE_KEY[share.notice])}</p> : null}
    </div>
  </div>, document.body);
}
