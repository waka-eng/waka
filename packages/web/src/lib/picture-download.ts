/**
 * ═══ THE ORIGINAL, ONE PRESS AWAY (founder, 2026-11-27) ═══════════════════
 * A saved picture is shown trimmed and its "Open original image ↗" link left
 * the page; the original downloads from the page's ⋯ (one picture) and from
 * the whole view of each picture. The bytes come through the owner-checked
 * presigned read, as every view of them does.
 *
 * DECIDED INSIDE THE PRESS, NOT AFTER IT (code review, 2026-11-28). A tab
 * opened after an `await` is a popup the browser blocks. So the picture on
 * screen tells this module, as it loads, which URL it holds and whether the
 * store answered it with CORS (`rememberPicture`). Pressed with a fresh URL
 * the store will not read cross-origin, the original opens in a new tab
 * right there, in the gesture. With CORS, its bytes are fetched and saved
 * under its own name. Anything else (no fresh URL, a failed read) reads a
 * new URL and tries the bytes; a failure is said, never silent.
 */
import { fetchAttachmentUrl } from './api';

/** A presigned read lives five minutes; one older than this is not used. */
const FRESH_MS = 4 * 60_000;
type Source = { url: string; cors: boolean; at: number };
const sources = new Map<string, Source>();

/** What the picture on screen loaded, and how. */
export function rememberPicture(id: string, url: string, cors: boolean, now = Date.now()): void {
  sources.set(id, { url, cors, at: now });
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

function save(blob: Blob, label: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href; link.download = pictureFilename(label, blob.type); link.rel = 'noopener';
  document.body.append(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
}
function openInTab(url: string) {
  const link = document.createElement('a');
  link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  document.body.append(link); link.click(); link.remove();
}

/**
 * Download one picture's original. Call it straight from the press. Resolves
 * true when the file was saved or opened, false when it could not be.
 */
export function downloadOriginal(id: string, label: string, deps: {
  read?: typeof fetchAttachmentUrl; fetchFn?: typeof fetch; now?: number;
} = {}): Promise<boolean> {
  const known = sources.get(id);
  const fresh = known && (deps.now ?? Date.now()) - known.at < FRESH_MS ? known : null;
  /* No CORS: the bytes cannot be read here, so the original opens, now. */
  if (fresh && !fresh.cors) { openInTab(fresh.url); return Promise.resolve(true); }
  const bytes = async (url: string) => {
    const response = await (deps.fetchFn ?? fetch)(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    save(await response.blob(), label);
  };
  return (async () => {
    try {
      await bytes(fresh ? fresh.url : await (deps.read ?? fetchAttachmentUrl)(id));
      return true;
    } catch {
      return false;
    }
  })();
}
