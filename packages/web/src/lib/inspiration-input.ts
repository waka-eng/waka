import type { InspirationDraftMedia } from './inspiration-draft-store';

/** Link cards are a view of the authored URL; their labels never become
 * invented inspiration text. The same list supplies the save manifest. */
export function inspirationLinks(text: string): InspirationDraftMedia[] {
  const urls = [...new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? [])];
  return urls.flatMap(url => {
    try { return [{ id: `text-link:${url}`, type: 'link' as const, url, name: new URL(url).hostname }]; }
    catch { return []; }
  });
}
export function inspirationInputMedia(text: string, media: InspirationDraftMedia[]) {
  return [...media, ...inspirationLinks(text).filter(link => !media.some(item => item.type === 'link' && item.url === link.url))];
}
