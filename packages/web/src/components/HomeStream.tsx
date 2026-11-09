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
 * EMPTY IS EMPTY. A section with nothing in it is not drawn, except Saves,
 * whose heading is the door to the archive and its Deleted shelf.
 *
 * ═══ SEARCH AND THE PRINCIPLES DOOR LIVE HERE NOW (2026-11-08) ═══════════
 * Founder, on the home's Actions menu: "i hate this. better position these
 * 4 actions in current experience." Search is a field at the top of this
 * sheet (it finds what you kept, which is what this sheet is), and it runs
 * the archive's own server search (`useArchiveSearch`) rather than a second
 * matcher. "View principles" became the Principles heading itself, and the
 * Saves heading is the same kind of door to the full archive: a heading
 * that names a place you can go goes there (Law 7, the class, not the one).
 *
 * THE WAY DOWN IS NOT IN HERE. "⌄ Home" stands in the top bar's row while
 * this is up (founder: "the down caret and Home feels awkward position
 * relative to the top right buttons"), so it is drawn by the page.
 */
import { useState } from 'react';

import type { ApiPrinciple } from '../lib/api/principles';
import type { Inspiration, Signal } from '../lib/data';
import { createListViewState } from '../lib/list-view-state';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';
import { useArchiveSearch } from '../lib/use-archive-search';
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
  /** A save's own page; the query on at the press, so "<" can come back to it. */
  onOpenSave: (id: string, query: string) => void;
  /** The field's words, owned by the page: kept only across "open a result →
      its <", dropped by every other way off the sheet (code review, 2026-11-09). */
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  /** Whose archive the field searches; null searches the signed-in default. */
  profileId: string | null;
  /** The Saves heading's door: the whole archive, where editing lives. */
  onOpenArchive: () => void;
  /** The Principles heading's door: the same walk the creature takes. */
  onOpenPrinciples: () => void;
  /** Older saves past the loaded window: the full archive pages them in. */
  more?: { onSeeAll: () => void };
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const saves = [...props.inspirations].sort((a, b) => b.capturedMs - a.capturedMs);
  const principles = [...props.principles].sort((a, b) => a.rank - b.rank);
  const query = props.query, setQuery = props.onQueryChange;
  const [memory] = useState(createListViewState);
  const needle = query.trim();
  const search = useArchiveSearch(props.profileId, needle ? needle : null, null, memory);
  const saveRow = (row: Inspiration) => {
    const source = sourceKey(row);
    return <li key={row.id}>
      <button type="button" className="waka-stream-save" onClick={() => props.onOpenSave(row.id, query)}>
        <time className="waka-stream-meta" dateTime={new Date(row.capturedMs).toISOString()}>
          {source ? formatMessage(props.locale, source, { date: dayWords(row.capturedMs, props.locale) }) : dayWords(row.capturedMs, props.locale)}
        </time>
        <span className="waka-stream-words">{row.preview || say('worldBubbleKept')}</span>
      </button>
    </li>;
  };
  /* A HEADING THAT NAMES A PLACE IS THE DOOR TO IT: the word, then ›. */
  const door = (id: string, label: string, onOpen: () => void) => (
    <h2 id={id} className="waka-stream-label">
      <button type="button" className="waka-stream-door" onClick={onOpen}>
        {label}<span aria-hidden="true">›</span>
      </button>
    </h2>
  );
  return (
    <DialogSurface className="waka-stream" modal={false} motion="modal" aria-label={say('worldBarSaves')} onClose={props.onClose}
      data-jar-chrome="1" data-jar-interactive="1">
      {/* THE ARCHIVE'S FIELD, SAME ANATOMY: the drawn glyph, the input, and a
          clear that exists only while there is something to clear. */}
      <div className="waka-stream-find">
        <div className="waka-over-find">
          <span className="waka-over-find-glyph" aria-hidden="true" />
          <input type="search" className="waka-over-search" value={query}
            placeholder={say('worldInspirationsSearch')} aria-label={say('worldInspirationsSearch')}
            onChange={(event) => setQuery(event.target.value)} />
          {query ? <button type="button" className="waka-over-find-clear" aria-label={say('worldInspirationsSearchClear')}
            onClick={(event) => { setQuery(''); (event.currentTarget.previousElementSibling as HTMLInputElement | null)?.focus(); }} /> : null}
        </div>
      </div>
      <div className="waka-stream-scroll" tabIndex={0}>
        {needle ? (
          /* WHILE A SEARCH IS ON, ITS RESULTS ARE THE PAGE. Patterns and
             principles are not matched; they come back when the field is
             cleared. */
          <section aria-labelledby="waka-stream-found" aria-busy={search.phase === 'loading'}>
            <h2 id="waka-stream-found" className="sr-only">{say('worldInspirationsSearch')}</h2>
            {search.phase === 'loading' ? <p className="waka-stream-meta" role="status">{say('worldSearchingInspirations')}</p>
              : search.phase === 'failed' ? <p className="waka-stream-meta" role="alert">{say('worldSearchFailed')}{' '}
                <button type="button" className="waka-stream-more" onClick={search.refresh}>{say('worldRetry')}</button></p>
              : search.rows.length === 0 ? <p className="waka-stream-meta" role="status">{say('worldInspirationsNoHits')}</p>
              : <ul className="waka-stream-list">{search.rows.map(saveRow)}</ul>}
            {search.phase === 'ready' && search.cursor ? <button type="button" className="waka-stream-more" disabled={search.moreBusy || search.refreshing}
              onClick={() => void search.more()}>{say(search.moreBusy ? 'worldSearchingInspirations' : search.moreFailed ? 'worldRetry' : 'worldMoreResults')}</button> : null}
          </section>
        ) : <>
        {/* THE SAVES DOOR STANDS EVEN WITH NOTHING KEPT. It is the only way
            to the archive from home since the Actions menu went, and the
            archive holds the Deleted shelf: someone who deleted their last
            save must still be able to bring it back. Empty, it is the door
            and one line, never a list. */}
        <section aria-labelledby="waka-stream-saves">
          {door('waka-stream-saves', say('worldBarSaves'), props.onOpenArchive)}
          {saves.length ? <ul className="waka-stream-list">
            {saves.map(saveRow)}
          </ul> : <p className="waka-stream-meta">{say('worldPersonalReadingEmpty')}</p>}
          {/* THE REST ARE NOT DROPPED (code review, 2026-11-08): this page
              shows the saves already loaded, and the archive pages in every
              one, so when there are more it says so and goes there. */}
          {props.more ? <button type="button" className="waka-stream-more" onClick={props.more.onSeeAll}>{say('worldBubbleSeeAll')}</button> : null}
        </section>
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
          {door('waka-stream-principles', say('worldStreamPrinciples'), props.onOpenPrinciples)}
          <ul className="waka-stream-list">
            {principles.map((row) => (
              <li key={row.id} className="waka-stream-statement"><span className="waka-stream-words">{row.statement}</span></li>
            ))}
          </ul>
        </section> : null}
        </>}
      </div>
    </DialogSurface>
  );
}
