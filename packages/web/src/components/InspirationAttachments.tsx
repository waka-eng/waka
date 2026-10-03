import { useEffect, useState } from 'react';
import { fetchAttachmentUrl, type ApiAttachmentSummary } from '../lib/api';
import { t, type SupportedLocale } from '../lib/locales';
import { AttachmentTranscript } from './AttachmentTranscript';
import { AttachmentPreview } from './AttachmentPreview';

function Attachment({ item, locale }: { item: ApiAttachmentSummary; locale: SupportedLocale }) {
  const [url, setUrl] = useState(''), [failed, setFailed] = useState(false), [retry, setRetry] = useState(0);
  useEffect(() => {
    if (item.type === 'link') return;
    const controller = new AbortController(); setUrl(''); setFailed(false);
    void fetchAttachmentUrl(item.id, controller.signal).then(value => { if (!controller.signal.aborted) setUrl(value); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [item.id, item.type, retry]);
  if (item.type === 'link') return <div className="jar-saved-attachment"><AttachmentPreview item={item} /></div>;
  return <div className="jar-saved-attachment">
    {url && item.type === 'image' && !failed ? <img src={url} alt={item.label} onError={() => setFailed(true)} /> : null}
    {url && item.type === 'image' ? <a href={url} target="_blank" rel="noreferrer">Open original image ↗</a> : null}
    {item.type === 'image' ? <AttachmentPreview item={item} /> : null}
    {url && item.type === 'audio' ? <audio controls preload="metadata" src={url} aria-label={item.label} onError={() => setFailed(true)} /> : null}
    {item.type === 'audio' ? <AttachmentTranscript key={item.id} id={item.id} /> : null}
    {failed ? <p role="alert">{t(locale, 'worldAttachmentOpenFailed')} <button type="button" onClick={() => setRetry(value => value + 1)}>{t(locale, 'worldRoomHistoryRetry')}</button></p> : null}
    {!url && !failed ? <p role="status">{t(locale, 'worldOpeningAttachment')}</p> : null}
  </div>;
}
export function InspirationAttachments({ items, locale }: { items: ApiAttachmentSummary[]; locale: SupportedLocale }) {
  return <div className="jar-saved-attachments">{items.filter(item => item.type !== 'file').map(item => <Attachment key={item.id} item={item} locale={locale} />)}</div>;
}
