import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { fetchAttachmentUrl, type ApiMessageAttachment } from '../lib/api';
import { formatMessage, t, type SupportedLocale } from '../lib/locales';
import { HomeActionIcon } from './HomeActionIcon';

/* A PHOTO OR FILE UNDER WHAT WAS SAID. A message attachment carries no URL:
   its bytes are read through `fetchAttachmentUrl`, a presigned read that
   lives five minutes. So each tile asks for its own on mount, and a click
   after the read has gone stale asks again before opening, rather than
   sending the person to an expired signature's error page. */
const STALE_AFTER_MS = 4 * 60_000;

function openInNewTab(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

/* "240 KB", "3.1 MB". Binary steps, because that is what the picker that
   chose the file showed; one decimal only while it still says something. */
function sizeWords(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  const shown = unit === 0 || value >= 100 ? String(Math.max(1, Math.round(value))) : String(Number(value.toFixed(1)));
  return `${shown} ${units[unit]}`;
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
     it failed, or after it went stale. Nothing opens if the tile unmounted. */
  const openFresh = useCallback(async () => {
    click.current?.abort();
    const controller = new AbortController();
    click.current = controller;
    try {
      const url = await fetchAttachmentUrl(id, controller.signal);
      if (controller.signal.aborted) return;
      readAt.current = Date.now();
      setState({ url, failed: false });
      openInNewTab(url);
    } catch {
      if (!controller.signal.aborted) setState({ url: null, failed: true });
    }
  }, [id]);
  const onLinkClick = useCallback((event: MouseEvent<HTMLAnchorElement>) => {
    if (Date.now() - readAt.current < STALE_AFTER_MS) return;
    event.preventDefault();
    void openFresh();
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
  const size = sizeWords(item.size);
  const body = <>
    <HomeActionIcon kind="file" className="chat-attachment-file-icon" />
    <span className="chat-attachment-file-name">{name}</span>
    {failed ? <span className="chat-attachment-note">{t(locale, 'worldChatAttachmentFailed')}</span>
      : size ? <span className="chat-attachment-file-size">{size}</span> : null}
  </>;
  if (url) {
    return <a className="chat-attachment-file" data-state="ready" href={url} target="_blank" rel="noopener noreferrer" title={name} onClick={onLinkClick}>{body}</a>;
  }
  return <button type="button" className="chat-attachment-file" data-state={failed ? 'failed' : 'waiting'} aria-disabled="true" title={name}
    onClick={() => void openFresh()}>{body}</button>;
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
