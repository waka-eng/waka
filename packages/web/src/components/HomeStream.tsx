/**
 * ═══ THE STREAM UNDER THE COMPANION (waka-design-brief.md §3d) ═══════════
 *
 * The home had no stream: what you had saved lived behind an "Inspirations"
 * tab, your patterns and principles behind other doors, and the loop the
 * product is about — save, notice, become principles — was never on one
 * screen. Here it is one scrollable page under the companion, in the loop's
 * own order: the bubble (Top of Mind) → what you saved → patterns →
 * principles, each under a sticky label. No tabs.
 *
 * WHAT A CARD SAYS: the date, the words, and where it came from when that
 * was not you typing here (an agent's own note). Nothing else — no count,
 * no score, no confidence (brief §8).
 *
 * WHAT A CARD OPENS: a sheet with, at most, the content, "What this
 * supports" (the signals this save is evidence for) and delete. Editing and
 * the archive's other acts are still one press away under Search; the
 * stream is for seeing the loop, not for administering it.
 *
 * EMPTY IS EMPTY. A section with nothing in it is not drawn — no
 * placeholder, no illustration, no "nothing here yet" (brief §6, and Law 4:
 * don't print what the person can already see).
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { ApiPrinciple } from '../lib/api/principles';
import type { Inspiration, Signal } from '../lib/data';
import { t, type SupportedLocale } from '../lib/locales';
import { dateStamp } from '../lib/words';
import { DialogSurface } from './DialogSurface';

/** A signal the stream may show: still standing, and not thrown out. */
export function streamSignals(signals: readonly Signal[] | null): Signal[] {
  return (signals ?? [])
    .filter((row) => row.status === 'active' || row.status === 'emerging')
    .sort((a, b) => b.lastEvidenceMs - a.lastEvidenceMs);
}

export function HomeStream(props: {
  locale: SupportedLocale;
  inspirations: readonly Inspiration[];
  /** Saves kept on this device that the server has not acknowledged yet. */
  pendingIds?: ReadonlySet<string>;
  /** Saves drawn before the server has answered (brief §6, "optimistic").
      They have no server id yet, so they cannot be opened or deleted. */
  optimisticIds?: ReadonlySet<string>;
  signals: readonly Signal[];
  principles: readonly ApiPrinciple[];
  /** The full words of a save, when they are loaded; the preview otherwise. */
  textOf: (id: string) => string | undefined;
  onDelete: (id: string) => Promise<void>;
}): JSX.Element | null {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  const [openId, setOpenId] = useState<string | null>(null);
  const saves = [...props.inspirations].sort((a, b) => b.capturedMs - a.capturedMs);
  const open = openId ? saves.find((row) => row.id === openId) ?? null : null;

  /* A save deleted elsewhere while its sheet is up closes the sheet rather
     than leaving it pointing at nothing. */
  useEffect(() => { if (openId && !open) setOpenId(null); }, [openId, open]);

  if (!saves.length && !props.signals.length && !props.principles.length) return null;
  return (
    <div className="waka-stream" aria-label={say('worldStreamLabel')} role="region">
      {saves.length ? (
        <section className="waka-stream-section" aria-labelledby="waka-stream-saves">
          <h2 id="waka-stream-saves" className="waka-stream-label">{say('worldStreamSaves')}</h2>
          <ul className="waka-stream-list">
            {saves.map((row) => (
              <li key={row.id}>
                {props.optimisticIds?.has(row.id) ? (
                  <div className="waka-stream-card" data-pending={props.pendingIds?.has(row.id) ? '1' : undefined}>
                    <SaveFace row={row} pending={props.pendingIds?.has(row.id)} locale={props.locale} />
                  </div>
                ) : (
                  <button type="button" className="waka-stream-card" onClick={() => setOpenId(row.id)}>
                    <SaveFace row={row} locale={props.locale} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {props.signals.length ? (
        <section className="waka-stream-section" aria-labelledby="waka-stream-signals">
          <h2 id="waka-stream-signals" className="waka-stream-label">{say('worldStreamSignals')}</h2>
          <ul className="waka-stream-list">
            {props.signals.map((row) => (
              /* A tentative one is said in words, not only in light: "Still
                 forming" reads the same with the colour taken away (§9.6). */
              <li key={row.id} className="waka-stream-statement" data-forming={row.status === 'emerging' ? '1' : undefined}>
                {row.status === 'emerging' ? <span className="waka-stream-meta">{say('worldStreamForming')}</span> : null}
                <p>{row.statement}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {props.principles.length ? (
        <section className="waka-stream-section" aria-labelledby="waka-stream-principles">
          <h2 id="waka-stream-principles" className="waka-stream-label">{say('worldStreamPrinciples')}</h2>
          <ul className="waka-stream-list">
            {[...props.principles].sort((a, b) => a.rank - b.rank).map((row) => (
              <li key={row.id} className="waka-stream-statement"><p>{row.statement}</p></li>
            ))}
          </ul>
        </section>
      ) : null}
      {open ? (
        <SaveSheet key={open.id} locale={props.locale} row={open} text={props.textOf(open.id) ?? open.preview}
          supports={props.signals.filter((signal) => signal.inspirationIds?.includes(open.id))}
          onClose={() => setOpenId(null)}
          onDelete={async () => { await props.onDelete(open.id); setOpenId(null); }} />
      ) : null}
    </div>
  );
}

function SaveFace({ row, pending, locale }: { row: Inspiration; pending?: boolean; locale: SupportedLocale }): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  return <>
    <span className="waka-stream-meta">
      <time dateTime={new Date(row.capturedMs).toISOString()}>{dateStamp(row.capturedMs, locale)}</time>
      {row.source === 'agent' ? <span className="waka-stream-chip">{say('worldStreamFromAgent')}</span> : null}
      {pending ? <span className="waka-stream-chip">{say('worldStreamPending')}</span> : null}
    </span>
    <span className="waka-stream-preview">{row.preview || say('worldSavedWord')}</span>
  </>;
}

function SaveSheet(props: {
  locale: SupportedLocale;
  row: Inspiration;
  text: string;
  supports: Signal[];
  onClose: () => void;
  onDelete: () => Promise<void>;
}): JSX.Element {
  const say = (key: Parameters<typeof t>[1]) => t(props.locale, key);
  /* DELETE ASKS ONCE, IN PLACE. The first press turns the row into the
     question; nothing leaves until the second. */
  const [step, setStep] = useState<'rest' | 'confirm' | 'deleting' | 'failed'>('rest');
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const remove = async () => {
    setStep('deleting');
    try { await props.onDelete(); }
    catch { if (alive.current) setStep('failed'); }
  };
  /* AT THE DOCUMENT'S ROOT, NOT IN THE STREAM. The stream lives in a
     scroller with its own stacking order, so a sheet drawn inside it could
     never rise above the home bar — measured: the bar sat across the
     sheet's Close and Delete. A modal is over everything, so it is mounted
     where everything is under it. */
  return createPortal(
    <div className="waka-sheet-scrim" data-jar-surface="1">
      <DialogSurface className="waka-sheet" motion="modal" onClose={props.onClose}
        aria-labelledby={`waka-sheet-${props.row.id}`}>
        <p className="waka-stream-meta" id={`waka-sheet-${props.row.id}`}>
          <time dateTime={new Date(props.row.capturedMs).toISOString()}>{dateStamp(props.row.capturedMs, props.locale)}</time>
          {props.row.source === 'agent' ? <span className="waka-stream-chip">{say('worldStreamFromAgent')}</span> : null}
        </p>
        <p className="waka-sheet-text">{props.text || say('worldSavedWord')}</p>
        <h3 className="waka-sheet-heading">{say('worldStreamSupports')}</h3>
        {props.supports.length ? (
          <ul className="waka-stream-list">
            {props.supports.map((signal) => (
              <li key={signal.id} className="waka-stream-statement" data-forming={signal.status === 'emerging' ? '1' : undefined}>
                {signal.status === 'emerging' ? <span className="waka-stream-meta">{say('worldStreamForming')}</span> : null}
                <p>{signal.statement}</p>
              </li>
            ))}
          </ul>
        ) : <p className="waka-sheet-quiet">{say('worldStreamSupportsNone')}</p>}
        <div className="waka-sheet-actions">
          {step === 'confirm' ? (
            <>
              <button type="button" className="waka-sheet-action" autoFocus onClick={() => setStep('rest')}>{say('worldStreamDeleteKeep')}</button>
              <button type="button" className="waka-sheet-action" onClick={() => { void remove(); }}>{say('worldStreamDeleteConfirm')}</button>
            </>
          ) : (
            <>
              <button type="button" className="waka-sheet-action" onClick={props.onClose}>{say('worldStreamClose')}</button>
              <button type="button" className="waka-sheet-action" disabled={step === 'deleting'}
                onClick={() => setStep('confirm')}>{say(step === 'deleting' ? 'worldStreamDeleting' : 'worldDelete')}</button>
            </>
          )}
        </div>
        {step === 'failed' ? <p className="waka-bar-error" role="alert">{say('worldStreamDeleteFailed')}</p> : null}
      </DialogSurface>
    </div>,
    document.body,
  );
}
