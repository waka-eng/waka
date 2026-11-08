/**
 * ═══ SAVES → PATTERNS → PRINCIPLES, ONE SCROLL (design F4, from #463) ═════
 *
 * Pulled up from "Saves ⌃" above the home bar, and from "See all saves"
 * under a read. The loop the product is about — you save, it notices, what
 * keeps coming back becomes a principle — on one page, in that order, each
 * under a small label. No tabs.
 *
 * WHAT A SAVE SAYS: when, where it came from when that was not you typing
 * ("from a screenshot", "from a photo", "from your agent"), and its words.
 * Nothing else — no count, no score, no confidence. Pressing one opens it
 * on its own page in the archive, where editing and deleting already live.
 *
 * A PATTERN STILL FORMING IS SAID IN WORDS, NOT ONLY IN LIGHT: a dashed
 * edge and "Still forming", so it reads the same with the colour taken away.
 *
 * EMPTY IS EMPTY. A section with nothing in it is not drawn.
 */
import type { ApiPrinciple } from '../lib/api/principles';
import type { Inspiration, Signal } from '../lib/data';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';
import { dateWords } from '../lib/words';
import { DialogSurface } from './DialogSurface';

/** A signal the stream may show: still standing, and not thrown out. */
export function streamSignals(signals: readonly Signal[] | null): Signal[] {
  return (signals ?? [])
    .filter((row) => row.status === 'active' || row.status === 'emerging')
    .sort((a, b) => b.lastEvidenceMs - a.lastEvidenceMs);
}

/** Where a save came from, when it was not words typed here. */
function sourceKey(row: Inspiration): Parameters<typeof t>[1] | null {
  const image = row.attachments.find((item) => item.type === 'image');
  if (image) return /screen ?shot|스크린샷|화면 캡처/i.test(image.label) ? 'worldStreamFromScreenshot' : 'worldStreamFromPhoto';
  if (row.source === 'agent') return 'worldStreamFromAgent';
  return null;
}

/** "Today", "Yesterday", else the date as a person writes it down. */
function dayWords(ms: number, locale: SupportedLocale): string {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  if (ms >= start.getTime()) return t(locale, 'worldStreamToday');
  if (ms >= start.getTime() - 86_400_000) return t(locale, 'worldStreamYesterday');
  return dateWords(ms, Date.now(), locale);
}

export function HomeStream(props: {
  locale: SupportedLocale;
  inspirations: readonly Inspiration[];
  signals: readonly Signal[];
  principles: readonly ApiPrinciple[];
  onOpenSave: (id: string) => void;
  onClose: () => void;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const saves = [...props.inspirations].sort((a, b) => b.capturedMs - a.capturedMs);
  const principles = [...props.principles].sort((a, b) => a.rank - b.rank);
  return (
    <DialogSurface className="waka-stream" modal={false} motion="modal" aria-label={say('worldBarSaves')} onClose={props.onClose}
      data-jar-chrome="1" data-jar-interactive="1">
      {/* THE SAME CONTROL THAT PULLED IT UP PUTS IT DOWN — the chevron
          turned over, in the place the eye already is. */}
      <button type="button" className="waka-stream-close" aria-expanded="true" onClick={props.onClose}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M6 9l6 6 6-6" /></svg>
        <span>{say('worldBackHome')}</span>
      </button>
      <div className="waka-stream-scroll" tabIndex={0}>
        {saves.length ? <section aria-labelledby="waka-stream-saves">
          <h2 id="waka-stream-saves" className="waka-stream-label">{say('worldBarSaves')}</h2>
          <ul className="waka-stream-list">
            {saves.map((row) => {
              const source = sourceKey(row);
              return <li key={row.id}>
                <button type="button" className="waka-stream-save" onClick={() => props.onOpenSave(row.id)}>
                  <time className="waka-stream-meta" dateTime={new Date(row.capturedMs).toISOString()}>
                    {source ? formatMessage(props.locale, source, { date: dayWords(row.capturedMs, props.locale) }) : dayWords(row.capturedMs, props.locale)}
                  </time>
                  <span className="waka-stream-words">{row.preview || say('worldSavedWord')}</span>
                </button>
              </li>;
            })}
          </ul>
        </section> : null}
        {props.signals.length ? <section aria-labelledby="waka-stream-patterns">
          <h2 id="waka-stream-patterns" className="waka-stream-label">{say('worldStreamPatterns')}</h2>
          <ul className="waka-stream-list">
            {props.signals.map((row) => (
              <li key={row.id} className="waka-stream-statement" data-forming={row.status === 'emerging' ? '1' : undefined}>
                {row.status === 'emerging' ? <span className="waka-stream-meta">{say('worldStreamForming')}</span> : null}
                <span className="waka-stream-words">{row.statement}</span>
              </li>
            ))}
          </ul>
        </section> : null}
        {principles.length ? <section aria-labelledby="waka-stream-principles">
          <h2 id="waka-stream-principles" className="waka-stream-label">{say('worldStreamPrinciples')}</h2>
          <ul className="waka-stream-list">
            {principles.map((row) => (
              <li key={row.id} className="waka-stream-statement"><span className="waka-stream-words">{row.statement}</span></li>
            ))}
          </ul>
        </section> : null}
      </div>
    </DialogSurface>
  );
}
