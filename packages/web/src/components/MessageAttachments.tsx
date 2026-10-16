import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { fetchAttachmentUrl, type ApiMessageAttachment } from '../lib/api';
import { fileSizeWords } from '../lib/api/file-accept';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';
import { HomeActionIcon } from './HomeActionIcon';

/* A PHOTO OR FILE UNDER WHAT WAS SAID. A message attachment carries no URL:
   its bytes are read through `fetchAttachmentUrl`, a presigned read that
   lives five minutes. So each tile asks for its own on mount, and a click
   after the read has gone stale asks again before opening, rather than
   sending the person to an expired signature's error page. */
const STALE_AFTER_MS = 4 * 60_000;

/* THE TAB IS OPENED IN THE CLICK, THE ADDRESS ARRIVES AFTER. A browser lets
   a page open a window only while it is handling the press; one opened after
   an `await` is a popup, and blocked. So the blank tab is opened at once and
   cut loose from this page (`opener = null` — the noopener half of what the
   ready link's `rel` says), and it is pointed at the signed read when that
   lands, or closed if it does not. */
function openBlankTab(): Window | null {
  const tab = window.open('', '_blank');
  if (tab) { try { tab.opener = null; } catch { /* Some browsers refuse; the tab still opens. */ } }
  return tab;
}

/* AND IT ARRIVES WITH NO REFERER — the other half of the ready link's `rel`.
   Setting `tab.location.href` from here is this page navigating that tab,
   so the bucket would be told this page's address (its origin, at the
   default policy). Instead the blank tab follows a link of its own that says
   `noreferrer`: the navigation is the tab's, from a document with no
   address worth sending, and Chrome, Safari and Firefox all send it with no
   Referer. If the tab's document is out of reach, the address is set
   directly — the file still opens. */
function sendTab(tab: Window, url: string) {
  try {
    const doc = tab.document, link = doc.createElement('a');
    link.href = url; link.rel = 'noreferrer';
    (doc.body ?? doc.documentElement).appendChild(link);
    link.click();
  } catch { tab.location.href = url; }
}

function useAttachmentUrl(id: string) {
  const [state, setState] = useState<{ url: string | null; failed: boolean }>({ url: null, failed: false });
  const readAt = useRef(0), click = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setState({ url: null, failed: false });
    void fetchAttachmentUrl(id, controller.signal)
      .then(url => { if (controller.signal.aborted) return; readAt.current = Date.now(); setState({ url, failed: false }); })
      .catch(() => { if (!controller.signal.aborted) setState({ url: null, failed: true }); });
    return () => { controller.abort(); click.current?.abort(); };
  }, [id]);
  /* Read again, then open — for a click before the first read landed, after
     it failed, or after it went stale. Synchronous up to `openBlankTab`, so
     it must be called from the click itself; the tab it opened closes again
     if the read fails, if a second click replaces this one, or if the tile
     unmounted. */
  const openFresh = useCallback(() => {
    click.current?.abort();
    const controller = new AbortController();
    click.current = controller;
    const tab = openBlankTab();
    void fetchAttachmentUrl(id, controller.signal).then(url => {
      if (controller.signal.aborted) { tab?.close(); return; }
      readAt.current = Date.now();
      setState({ url, failed: false });
      if (tab) sendTab(tab, url);
    }).catch(() => {
      tab?.close();
      if (!controller.signal.aborted) setState({ url: null, failed: true });
    });
  }, [id]);
  const onLinkClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (Date.now() - readAt.current < STALE_AFTER_MS) return;
    event.preventDefault();
    openFresh();
  }, [openFresh]);
  const markFailed = useCallback(() => setState({ url: null, failed: true }), []);
  return { ...state, openFresh, onLinkClick, markFailed };
}

function PhotoTile({ item, locale }: { item: ApiMessageAttachment; locale: SupportedLocale }) {
  const { url, failed, onLinkClick, markFailed } = useAttachmentUrl(item.id);
  const [shown, setShown] = useState(false);
  const label = item.name ? formatMessage(locale, 'worldChatAttachmentPhoto', { name: item.name }) : t(locale, 'worldChatAttachmentPhotoUnnamed');
  if (failed) {
    return <span className="chat-attachment-photo" data-state="failed" role="img" aria-label={label}>
      <span className="chat-attachment-note">{t(locale, 'worldChatAttachmentFailed')}</span>
    </span>;
  }
  if (!url) return <span className="chat-attachment-photo" data-state="waiting" role="img" aria-label={label} aria-busy="true" />;
  return <a className="chat-attachment-photo" data-state={shown ? 'ready' : 'waiting'} href={url} target="_blank" rel="noopener noreferrer"
    aria-label={label} onClick={onLinkClick}>
    <img className="chat-attachment-image" src={url} alt="" loading="lazy" decoding="async" onLoad={() => setShown(true)} onError={markFailed} />
  </a>;
}

function FileTile({ item, locale }: { item: ApiMessageAttachment; locale: SupportedLocale }) {
  const { url, failed, openFresh, onLinkClick } = useAttachmentUrl(item.id);
  const name = item.name || t(locale, 'worldChatAttachmentFileUnnamed');
  /* The chip's words for the same file (`fileSizeWords`), so a size does not
     change on the way from the box into the transcript. */
  const size = fileSizeWords(item.size);
  const body = <>
    <HomeActionIcon kind="file" className="chat-attachment-file-icon" />
    <span className="chat-attachment-file-name">{name}</span>
    {failed ? <span className="chat-attachment-note">{t(locale, 'worldChatAttachmentFailed')}</span>
      : size ? <span className="chat-attachment-file-size">{size}</span> : null}
  </>;
  if (url) {
    return <a className="chat-attachment-file" data-state="ready" href={url} target="_blank" rel="noopener noreferrer" title={name} onClick={onLinkClick}>{body}</a>;
  }
  /* A BUTTON THAT WORKS, AND SAYS IT DOES. It used to be `aria-disabled` and
     open the file anyway — a control telling a screen reader it cannot be
     pressed while doing something when pressed. Pressing it reads the link
     and opens it, while waiting or after a failed read alike; `data-state`
     dims the fill, not the control. */
  return <button type="button" className="chat-attachment-file" data-state={failed ? 'failed' : 'waiting'} title={name}
    onClick={openFresh}>{body}</button>;
}

export function MessageAttachments({ attachments, locale }: { attachments: ApiMessageAttachment[]; locale: SupportedLocale }): JSX.Element | null {
  if (attachments.length === 0) return null;
  const photos = attachments.filter(item => item.type === 'image');
  const files = attachments.filter(item => item.type === 'file');
  const cols = photos.length === 1 ? 1 : photos.length === 2 || photos.length === 4 ? 2 : 3;
  return <div className="chat-attachments" role="group" aria-label={t(locale, 'worldChatAttachmentList')}>
    {photos.length ? <div className="chat-attachment-photos" data-cols={cols}>
      {photos.map(item => <PhotoTile key={item.id} item={item} locale={locale} />)}
    </div> : null}
    {files.length ? <div className="chat-attachment-files">
      {files.map(item => <FileTile key={item.id} item={item} locale={locale} />)}
    </div> : null}
  </div>;
}
