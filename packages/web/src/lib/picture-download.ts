/**
 * ═══ THE ORIGINAL, ONE PRESS AWAY (founder, 2026-11-27) ═══════════════════
 * A saved picture is shown trimmed and its "Open original image ↗" link left
 * the page; the original downloads from the page's ⋯ (one picture) and from
 * the whole view of each picture. The bytes come through the owner-checked
 * presigned read, as every view of them does.
 *
 * WHAT THIS MODULE KNOWS (code review, 2026-11-28):
 *
 *   EACH PICTURE'S URL, stamped with the moment it was READ from the API
 *   (`freshPictureUrl`), never the moment an image happened to load: a
 *   presigned read lives five minutes from its signing, so a page left open
 *   cannot make an old URL look new.
 *
 *   WHETHER THE STORE ANSWERS CORS, once per session (`storeAnswersCors`).
 *   The first picture that loads with CORS says yes; one that fails with
 *   CORS and then loads without says no, and from then on pictures load
 *   without it (one download each, no console errors) and a download opens
 *   the original instead of fetching its bytes.
 *
 * DECIDED INSIDE THE PRESS. A tab opened after an `await` is a popup the
 * browser blocks, so where a tab is the answer it is opened in the press: at
 * once with a fresh URL, or empty and then pointed at the fresh URL when it
 * arrives (closed if it never does). In the installed app the original
 * opens in the in-app browser, where it is saved. A failure resolves false
 * and the caller says so; nothing reports success when nothing happened.
 */
import { fetchAttachmentUrl } from './api';
import { isMobileBuild, platformServices } from './platform';
import { saveBlob } from './use-share-image';

/** A presigned read lives five minutes; one older than this is not used. */
const FRESH_MS = 4 * 60_000;
const urls = new Map<string, { url: string; at: number }>();
let cors: boolean | null = null;

/** A picture's presigned URL, read now, and remembered with that moment. */
export async function freshPictureUrl(id: string, signal?: AbortSignal, read: typeof fetchAttachmentUrl = fetchAttachmentUrl): Promise<string> {
  const at = Date.now();
  const url = await read(id, signal);
  urls.set(id, { url, at });
  return url;
}
function knownUrl(id: string, now: number): string | null {
  const known = urls.get(id);
  return known && now - known.at < FRESH_MS ? known.url : null;
}

/** False once the store has been seen not to answer a CORS read. */
export function storeAnswersCors(): boolean { return cors !== false; }
/** What a picture's load just showed about the store. */
export function noteStoreCors(answers: boolean): void {
  if (!answers) cors = false;
  else if (cors === null) cors = true;
}

const TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/heic': 'heic', 'image/heif': 'heif', 'image/avif': 'avif' };

/**
 * The file's own name when the list carried it whole; a label the list cut
 * ("…") or one with no extension is not a filename, so then "waka-picture"
 * with the extension its bytes say.
 */
export function pictureFilename(label: string, contentType: string | null | undefined): string {
  const ext = TYPES[(contentType ?? '').split(';')[0]!.trim().toLowerCase()];
  const name = label.trim();
  if (name && !name.endsWith('…') && /\.[a-z0-9]{2,5}$/i.test(name) && !/[\\/]/.test(name)) return name;
  return `waka-picture${ext ? `.${ext}` : ''}`;
}

function openInTab(url: string) {
  const link = document.createElement('a');
  link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  document.body.append(link); link.click(); link.remove();
}

type Deps = {
  read?: typeof fetchAttachmentUrl; fetchFn?: typeof fetch; now?: number;
  native?: boolean; openFile?: (url: string) => Promise<void>;
  openWindow?: () => Window | null;
};

/**
 * Download one picture's original. Call it straight from the press. Resolves
 * true when the file was saved or opened, false when it could not be.
 */
export function downloadOriginal(id: string, label: string, deps: Deps = {}): Promise<boolean> {
  const read = deps.read ?? fetchAttachmentUrl;
  const now = deps.now ?? Date.now();
  const known = knownUrl(id, now);
  const fresh = () => freshPictureUrl(id, undefined, read);

  /* THE INSTALLED APP: the in-app browser, where the person saves it. */
  if (deps.native ?? isMobileBuild) {
    return (async () => {
      try {
        const open = deps.openFile ?? (await platformServices()).openFile;
        if (!open) return false;
        await open(known ?? await fresh());
        return true;
      } catch { return false; }
    })();
  }

  /* A STORE WITH NO CORS: never fetch bytes; open the original, in the press. */
  if (!storeAnswersCors()) {
    if (known) { openInTab(known); return Promise.resolve(true); }
    const tab = (deps.openWindow ?? (() => window.open('', '_blank')))();
    if (!tab) return Promise.resolve(false);
    try { tab.opener = null; } catch { /* a cross-origin window may refuse */ }
    return fresh().then(url => { tab.location.href = url; return true; }, () => { tab.close(); return false; });
  }

  /* CORS: the bytes, saved under the file's name; one fresh URL on a 403. */
  const bytes = async (url: string): Promise<Response> => (deps.fetchFn ?? fetch)(url);
  return (async () => {
    try {
      let response = await bytes(known ?? await fresh());
      if (response.status === 403) response = await bytes(await fresh());
      if (!response.ok) return false;
      const blob = await response.blob();
      return saveBlob(blob, pictureFilename(label, blob.type));
    } catch {
      return false;
    }
  })();
}

/** Tests only: forget what this session learned. */
export function forgetPictureStore(): void { urls.clear(); cors = null; }
