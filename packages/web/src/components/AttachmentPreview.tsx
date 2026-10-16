/**
 * WHAT A SAVED LINK OR PHOTO SAYS ABOUT ITSELF — in the reader's language.
 *
 * This file rendered seventeen English sentences to every reader, in both
 * languages, from the day it was written until 2026-10-11. It imported
 * nothing from `lib/i18n` and took no locale, so there was no catalogue row
 * to be missing and no gate that could notice: `copy.test.ts` asks whether
 * every catalogue key is rendered, never whether every rendered sentence is
 * in the catalogue, and `i18n.test.ts` asks for key parity between the two
 * files. A string that was never in either file is invisible to all of it.
 *
 * WHY IT MATTERS MORE NOW THAN WHEN IT WAS INTRODUCED. Attachments used to
 * be a line under a note. The redesign made them a grid shelf, so a Korean
 * reader's archive now shows these sentences repeated once per saved link
 * and once per photo — the most-repeated English on the surface.
 *
 * THE LOCALE IS A REQUIRED PROP, not one defaulting to `en-US`. The same
 * argument as `lib/why-failed.ts`: a default makes the omission compile, and
 * the omission is the bug. `InspirationAttachments` already holds the locale
 * — it was passing it to its OWN strings while handing these children none,
 * which is how the gap survived a reading of that file.
 */
import { useEffect, useRef, useState } from 'react';
import { attachmentPreviewImageUrl, fetchAttachmentDetails, retryAttachmentAnalysis, type ApiAttachmentDetails, type ApiAttachmentSummary } from '../lib/api';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';
import { timeOf } from '../lib/words';

function httpUrl(value?: string | null) {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
}
/* QUIET IS FOR A PAGE WHOSE STATES LIVE ELSEWHERE. The opened note has one
   rule for states — "states should show and disappear in the bottom bar
   only" — so there this card says nothing about itself: it is absent until
   its details have been read once, then it is only the card (thumbnail,
   title ↗, site, description). No status or alert lines, no buttons, and
   no "Page text" disclosure either: that is the machine's reading of the
   page behind a press, not something you kept. It still re-reads while the
   analysis is pending (the same bounded loop), silently, so the card fills
   in when the title arrives. And if the read FAILS it falls back to a bare
   card built from the row alone — the note must never lose its link. */
export function AttachmentPreview({ item, locale, readOnly=false, quiet=false }: { item: ApiAttachmentSummary; locale: SupportedLocale; readOnly?:boolean; quiet?: boolean }) {
  return <Preview key={item.id} item={item} locale={locale} readOnly={readOnly || quiet} quiet={quiet} />;
}

function Preview({ item,locale,readOnly,quiet }: { item: ApiAttachmentSummary;locale:SupportedLocale;readOnly:boolean;quiet:boolean }) {
  const [data, setData] = useState<ApiAttachmentDetails | null>(null), [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState(false), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [waiting, setWaiting] = useState(false), [imageFailed, setImageFailed] = useState(false);
  const mutation = useRef<AbortController | null>(null);
  const say = (key: Parameters<typeof t>[1]) => t(locale, key);
  useEffect(() => () => mutation.current?.abort(), [item.id]);
  useEffect(() => {
    if (busy) return;
    const controller = new AbortController(); let timer = 0, checks = 0;
    setWaiting(false);
    /* A HIDDEN TAB PAUSES THE RE-READ. The loud card resumes it with its
       "Check preview" press; the quiet one has no press, so it resumes the
       moment the tab is visible again — silently, and still under the cap. */
    const onVisible = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onVisible);
      void read();
    };
    const read = async () => {
      try {
        const value = await fetchAttachmentDetails(item.id, controller.signal);
        if (controller.signal.aborted) return;
        setData(value); setLoadError(false);
        if (value.analysis.status === 'pending') {
          if (++checks < 20) timer = window.setTimeout(() => {
            if (!document.hidden) void read();
            else if (quiet) document.addEventListener('visibilitychange', onVisible);
            else setWaiting(true);
          }, 3000);
          else setWaiting(true);
        }
      } catch { if (!controller.signal.aborted) { setData(null); setLoadError(true); } }
    };
    void read();
    return () => { controller.abort(); window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
    /* `quiet` is fixed for a Preview's life, so it is not a reason to re-read. */
  }, [item.id, refresh, busy]);
  const retry = async () => {
    const controller = new AbortController(); mutation.current?.abort(); mutation.current = controller;
    setBusy(true); setActionError(false);
    try { const value = await retryAttachmentAnalysis(item.id, controller.signal); if (!controller.signal.aborted) { setData(value); setImageFailed(false); } }
    catch { if (!controller.signal.aborted) setActionError(true); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  /* THE TWO ERROR FLAGS ARE BOOLEANS NOW, AND THAT IS THE POINT.
     They held the finished English sentence, so the words were decided in the
     handler — at `catch` time, where no re-render happens if the locale later
     changes, and where the only thing to hand a translator is a `catch`
     block. A flag says WHICH STATE this is and lets the render decide what
     that state says, which is also how every other surface in this product is
     written (`say(...)` at the point of render, never in the callback). */
  const row = data?.attachment, link = row?.enrichment.link;
  const original = httpUrl(row?.url ?? item.url ?? (item.type === 'link' ? item.label : null));
  const hostname = original ? new URL(original).hostname : '';
  const title = link?.title || (item.label && item.label !== original && !/^https?:/i.test(item.label) ? item.label : hostname) || say('worldAttachmentSavedLink');
  const status = data?.analysis.status, reason = row?.enrichment.errorReason ?? '';
  const unavailable = /401|403|auth|login/i.test(reason) ? say('worldAttachmentNeedsAccess')
    : item.type === 'link' ? say('worldAttachmentNoLinkPreview') : say('worldAttachmentNoImageDescription');
  const card = item.type === 'link' ? <>
    {data?.previewImageAvailable && !imageFailed ? <img className="jar-link-thumbnail" src={attachmentPreviewImageUrl(item.id)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : null}
    <h3>{original ? <a href={original} target="_blank" rel="noreferrer">{title} <span aria-hidden="true">↗</span></a> : title}</h3>
    {hostname && hostname !== title ? <p className="jar-link-site">{link?.siteName || hostname}</p> : null}
    {link?.description ? <p className="jar-link-description">{link.description}</p> : null}
  </> : null;
  const label = say(item.type === 'link' ? 'worldAttachmentLinkPreview' : 'worldAttachmentImageDescription');
  if (quiet) return data || (loadError && item.type === 'link') ? <section className="jar-attachment-preview" aria-label={label}>{card}</section> : null;
  return <section className="jar-attachment-preview" aria-label={label}>
    {card}
    {!data && !loadError ? <p role="status">{say('worldAttachmentPreviewLoading')}</p> : null}
    {status === 'pending' ? <p role="status">{say(item.type === 'link' ? 'worldAttachmentReadingLink' : 'worldAttachmentReadingPhoto')}</p> : null}
    {status === 'failed' ? <p>{say('worldAttachmentPreviewFailed')}</p> : null}
    {status === 'unavailable' ? <p>{unavailable}</p> : null}
    {status === 'ready' && row?.enrichment.text ? <details><summary>{say(item.type === 'link' ? 'worldAttachmentPageText' : 'worldAttachmentImageDescription')}</summary><p className="jar-attachment-excerpt">{row.enrichment.text}</p></details> : null}
    {/* THE CLOCK READS IN THE READER'S LOCALE TOO. `toLocaleTimeString([])`
        takes the BROWSER's language, which is a different setting from the
        one this person chose in WAKA — so a Korean sentence could carry an
        English-formatted time and vice versa. That fix passed the chosen
        locale and kept the option bag here, which was the second half of the
        same bug: `lib/words.ts` already owns how this world says a time, in
        `timeOf`, and it hand-builds the Korean (`오전 7:05`) rather than
        trusting `Intl` for it. The two agreed character for character on the
        day this changed — and `Intl` output moves with ICU versions and
        platforms, so that agreement was a coincidence, not a property. One
        function now, so the retry clock here, the retry clock on a
        transcript and the timestamp under a chat turn are the same string by
        construction. */}
    {data?.analysis.retryAfter ? <p>{formatMessage(locale, 'worldAttachmentRetryAfter', { time: timeOf(new Date(data.analysis.retryAfter).getTime(), locale) })}</p> : null}
    {data?.analysis.canRetry && !readOnly ? <button type="button" disabled={busy} onClick={() => void retry()}>{say('worldAttachmentRetryPreview')}</button> : null}
    {loadError ? <p role="alert">{say('worldAttachmentPreviewLoadFailed')}</p> : null}
    {actionError ? <p role="alert">{say('worldAttachmentRetryFailed')}</p> : null}
    {loadError || waiting || data?.analysis.retryAfter ? <button type="button" disabled={busy} onClick={() => { setImageFailed(false); setRefresh(value => value + 1); }}>{say('worldAttachmentCheckPreview')}</button> : null}
  </section>;
}
