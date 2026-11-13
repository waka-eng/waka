/**
 * ═══ A SAVED PICTURE, SMALL, WHERE A LIST WOULD HAVE SAID "PHOTO" ═════════
 * Founder, 2026-11-12, on "Because you saved these" listing “Photo” and
 * “Photo”, and on the same word down a whole list: "this is so bad". A save
 * that is a picture is shown as that picture. Its bytes come through the
 * owner-checked presigned read (`fetchAttachmentUrl`), as a chat's do; until
 * then, or if the read fails, a quiet tile of the same size holds the place,
 * so a row never jumps when the picture lands.
 */
import { useEffect, useState } from 'react';
import { fetchAttachmentUrl, type ApiAttachmentSummary } from '../lib/api';
import { inspirationPreview } from '../lib/inspiration-preview';

/** The first picture of a save, if it has one. */
export function firstPhoto(attachments: readonly ApiAttachmentSummary[]): string | null {
  return attachments.find(item => item.type === 'image')?.id ?? null;
}

/** True when a save's preview is only the name of what is attached ("Photo",
    "2 photos"): there are no words of the person's to quote. */
export function onlyAttachments(preview: string, attachments: readonly ApiAttachmentSummary[]): boolean {
  return attachments.length > 0 && preview === inspirationPreview('', [...attachments]);
}

export function SavedPhoto({ id, className }: { id: string; className?: string }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setUrl(null);
    void fetchAttachmentUrl(id, controller.signal)
      .then(next => { if (!controller.signal.aborted) setUrl(next); })
      .catch(() => undefined);
    return () => controller.abort();
  }, [id]);
  return <span className={`waka-saved-photo${className ? ` ${className}` : ''}`} aria-hidden="true">
    {url ? <img src={url} alt="" loading="lazy" decoding="async" /> : null}
  </span>;
}
