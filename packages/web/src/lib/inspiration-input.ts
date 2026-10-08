import type { InspirationDraftMedia } from './inspiration-draft-store';

const LINK_TOKEN = /https?:\/\/[^\s<>"']+/gi;
function parseToken(raw: string) {
  let written = raw.replace(/[.,!?:;]+$/, '');
  for (const [open, close] of [['(', ')'], ['[', ']']] as const) {
    while (written.endsWith(close) && written.split(close).length > written.split(open).length) written = written.slice(0, -1);
  }
  try { const parsed = new URL(written); return { written, canonical: parsed.toString(), name: parsed.hostname }; }
  catch { return null; }
}
function canonicalLink(url?: string) { try { return new URL(url ?? '').toString(); } catch { return url; } }

/** Link cards are a view of the authored URL; their labels never become
 * invented inspiration text. The same list supplies the save manifest. */
export function inspirationLinks(text: string): InspirationDraftMedia[] {
  const seen = new Set<string>();
  return (text.match(LINK_TOKEN) ?? []).flatMap(raw => {
    const parsed = parseToken(raw);
    if (!parsed || seen.has(parsed.canonical)) return []; seen.add(parsed.canonical);
    return [{ id: `text-link:${parsed.written}`, type: 'link' as const, url: parsed.canonical, name: parsed.name }];
  });
}
/** A separate URL draft joins the authored text only on an explicit save. */
export function inspirationWithPendingLink(text:string,pending:string){
  if(!pending.trim())return text.trim();
  let url:URL;
  try{url=new URL(pending.trim());}catch{throw new Error('invalid_link');}
  if(!['http:','https:'].includes(url.protocol)||url.toString().length>2048)throw new Error('invalid_link');
  const normalized=url.toString();
  return inspirationLinks(text).some(item=>item.url===normalized)?text.trim():[text.trim(),normalized].filter(Boolean).join('\n');
}
export function inspirationInputMedia(text: string, media: InspirationDraftMedia[]) {
  const seen = new Set<string>();
  return [...media, ...inspirationLinks(text)].filter(item => {
    if (item.type !== 'link' || !item.url) return true;
    const key = canonicalLink(item.url)!;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
}
export function removeInspirationLink(text: string, url: string) {
  const target = canonicalLink(url);
  return text.replace(LINK_TOKEN, raw => {
    const parsed = parseToken(raw);
    return parsed && parsed.canonical === target ? raw.slice(parsed.written.length) : raw;
  });
}
