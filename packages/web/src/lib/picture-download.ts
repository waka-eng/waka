/**
 * ═══ THE ORIGINAL, ONE PRESS AWAY (founder, 2026-11-27) ═══════════════════
 * A saved picture is shown trimmed and its "Open original image ↗" link left
 * the page; a saved inspiration's ⋯ downloads the file as it was saved. The
 * bytes come through the owner-checked presigned read, as every view of
 * them does. The bucket answers CORS reads, so the file is fetched and saved
 * under its own name; if that read is refused, the original opens in a new
 * tab instead, where the browser's own save applies.
 */
import { fetchAttachmentUrl } from './api';

export async function downloadOriginal(id: string, name: string, deps: {
  read?: typeof fetchAttachmentUrl; fetchFn?: typeof fetch; open?: (url: string) => void;
} = {}): Promise<void> {
  const url = await (deps.read ?? fetchAttachmentUrl)(id);
  try {
    const response = await (deps.fetchFn ?? fetch)(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = href; link.download = name || 'picture'; link.rel = 'noopener';
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 30_000);
  } catch {
    (deps.open ?? ((href: string) => { window.open(href, '_blank', 'noopener'); }))(url);
  }
}
