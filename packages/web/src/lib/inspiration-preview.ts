import type { ApiAttachmentSummary } from './api';

/** A readable label when the author saved media without a note. Never turn
 * filenames, object keys or model descriptions into the person's own words. */
export function inspirationPreview(text: string, attachments: Pick<ApiAttachmentSummary, 'type' | 'label'>[] = []) {
  if (text.trim()) return text;
  const counts = {image:0,audio:0,link:0,file:0};
  for (const item of attachments) counts[item.type] += 1;
  if (attachments.length === 1 && attachments[0]?.type === 'link') {
    const label = attachments[0].label;
    if (/^https?:\/\//i.test(label)) {
      try { return new URL(label).hostname; } catch { return 'Saved link'; }
    }
    return label.trim() || 'Saved link';
  }
  return [counts.image ? `${counts.image === 1 ? 'Photo' : `${counts.image} photos`}` : '',
    counts.audio ? `${counts.audio === 1 ? 'Recording' : `${counts.audio} recordings`}` : '',
    counts.link ? `${counts.link === 1 ? 'Link' : `${counts.link} links`}` : '',
    counts.file ? `${counts.file === 1 ? 'File' : `${counts.file} files`}` : ''].filter(Boolean).join(' · ') || 'Saved inspiration';
}
