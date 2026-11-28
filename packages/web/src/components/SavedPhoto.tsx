/**
 * ═══ A SAVED PICTURE, SMALL, WHERE A LIST WOULD HAVE SAID "PHOTO" ═════════
 * Founder, 2026-11-12, on "Because you saved these" listing “Photo” and
 * “Photo”, and on the same word down a whole list: "this is so bad". A save
 * that is a picture is shown as that picture. Its bytes come through the
 * owner-checked presigned read (`fetchAttachmentUrl`), as a chat's do; until
 * then, or if the read fails, a quiet tile of the same size holds the place,
 * so a row never jumps when the picture lands.
 */
import { useEffect, useRef, useState } from 'react';
import { type ApiAttachmentSummary } from '../lib/api';
import {useThumbnailStore} from '../lib/thumbnail-reads';
import { inspirationPreview } from '../lib/inspiration-preview';

/** The first picture of a save, if it has one. */
export function firstPhoto(attachments: readonly ApiAttachmentSummary[]): string | null {
  return attachments.find(item => item.type === 'image')?.id ?? null;
}

/** The picture a list row leads with, and the line read off THAT picture
    (code review, 2026-11-28: never a thumbnail beside another picture's
    words). The first picture the list carried a read line for, else the
    first picture with no line. */
export function leadPicture(attachments: readonly ApiAttachmentSummary[]): { id: string; line: string | null } | null {
  const pictures = attachments.filter(item => item.type === 'image');
  const read = pictures.find(item => item.readLine?.trim());
  if (read) return { id: read.id, line: read.readLine!.trim() };
  return pictures[0] ? { id: pictures[0].id, line: null } : null;
}

/** True when a save's preview is only the name of what is attached ("Photo",
    "2 photos"): there are no words of the person's to quote. */
export function onlyAttachments(preview: string, attachments: readonly ApiAttachmentSummary[]): boolean {
  return attachments.length > 0 && preview === inspirationPreview('', [...attachments]);
}

export function SavedPhoto({ id, className }: { id: string; className?: string }): JSX.Element {
  const store=useThumbnailStore(),node=useRef<HTMLSpanElement>(null);
  const [shown,setShown]=useState<{store:typeof store;id:string;url:string|null}|null>(null);
  useEffect(() => {
    if(!store||!node.current)return;
    return store.observe(node.current,id,url=>setShown({store,id,url}));
  }, [id,store]);
  const url=shown?.store===store&&shown.id===id?shown.url:null;
  return <span ref={node} className={`waka-saved-photo${className ? ` ${className}` : ''}`} aria-hidden="true">
    {url ? <img src={url} alt="" loading="lazy" decoding="async" onError={()=>store?.invalidate(id)} /> : null}
  </span>;
}
