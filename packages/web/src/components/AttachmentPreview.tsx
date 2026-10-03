import { useEffect, useRef, useState } from 'react';
import { attachmentPreviewImageUrl, fetchAttachmentDetails, retryAttachmentAnalysis, type ApiAttachmentDetails, type ApiAttachmentSummary } from '../lib/api';

function httpUrl(value?: string | null) {
  try { const url = new URL(value ?? ''); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.toString() : null; }
  catch { return null; }
}
export function AttachmentPreview({ item }: { item: ApiAttachmentSummary }) {
  return <Preview key={item.id} item={item} />;
}

function Preview({ item }: { item: ApiAttachmentSummary }) {
  const [data, setData] = useState<ApiAttachmentDetails | null>(null), [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0);
  const [waiting, setWaiting] = useState(false), [imageFailed, setImageFailed] = useState(false);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), [item.id]);
  useEffect(() => {
    if (busy) return;
    const controller = new AbortController(); let timer = 0, checks = 0;
    setWaiting(false);
    const read = async () => {
      try {
        const value = await fetchAttachmentDetails(item.id, controller.signal);
        if (controller.signal.aborted) return;
        setData(value); setLoadError('');
        if (value.analysis.status === 'pending') {
          if (++checks < 20) timer = window.setTimeout(() => { if (!document.hidden) void read(); else setWaiting(true); }, 3000);
          else setWaiting(true);
        }
      } catch { if (!controller.signal.aborted) { setData(null); setLoadError('The preview couldn’t be loaded. Your original is kept.'); } }
    };
    void read(); return () => { controller.abort(); window.clearTimeout(timer); };
  }, [item.id, refresh, busy]);
  const retry = async () => {
    const controller = new AbortController(); mutation.current?.abort(); mutation.current = controller;
    setBusy(true); setActionError('');
    try { const value = await retryAttachmentAnalysis(item.id, controller.signal); if (!controller.signal.aborted) { setData(value); setImageFailed(false); } }
    catch { if (!controller.signal.aborted) setActionError('Couldn’t retry yet. Your original is kept.'); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const row = data?.attachment, link = row?.enrichment.link;
  const original = httpUrl(row?.url ?? item.url ?? (item.type === 'link' ? item.label : null));
  const hostname = original ? new URL(original).hostname : '';
  const title = link?.title || (item.label && item.label !== original && !/^https?:/i.test(item.label) ? item.label : hostname) || 'Saved link';
  const status = data?.analysis.status, reason = row?.enrichment.errorReason ?? '';
  const unavailable = /401|403|auth|login/i.test(reason) ? 'This page needs access WAKA doesn’t have. You can open the original.'
    : item.type === 'link' ? 'No readable preview was available. The link is kept.' : 'No image description was available. The photo is kept.';
  return <section className="jar-attachment-preview" aria-label={item.type === 'link' ? 'Link preview' : 'Image description'}>
    {item.type === 'link' ? <>
      {data?.previewImageAvailable && !imageFailed ? <img className="jar-link-thumbnail" src={attachmentPreviewImageUrl(item.id)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : null}
      <h3>{original ? <a href={original} target="_blank" rel="noreferrer">{title} <span aria-hidden="true">↗</span></a> : title}</h3>
      {hostname && hostname !== title ? <p className="jar-link-site">{link?.siteName || hostname}</p> : null}
      {link?.description ? <p className="jar-link-description">{link.description}</p> : null}
    </> : null}
    {!data && !loadError ? <p role="status">Loading preview…</p> : null}
    {status === 'pending' ? <p role="status">{item.type === 'link' ? 'Reading this link…' : 'Reading this photo…'}</p> : null}
    {status === 'failed' ? <p>The preview couldn’t be read. Your original is kept.</p> : null}
    {status === 'unavailable' ? <p>{unavailable}</p> : null}
    {status === 'ready' && row?.enrichment.text ? <details><summary>{item.type === 'link' ? 'Page text' : 'Image description'}</summary><p className="jar-attachment-excerpt">{row.enrichment.text}</p></details> : null}
    {data?.analysis.retryAfter ? <p>You can retry after {new Date(data.analysis.retryAfter).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.</p> : null}
    {data?.analysis.canRetry ? <button type="button" disabled={busy} onClick={() => void retry()}>Retry preview</button> : null}
    {loadError ? <p role="alert">{loadError}</p> : null}
    {actionError ? <p role="alert">{actionError}</p> : null}
    {loadError || waiting || data?.analysis.retryAfter ? <button type="button" disabled={busy} onClick={() => { setImageFailed(false); setRefresh(value => value + 1); }}>Check preview</button> : null}
  </section>;
}
