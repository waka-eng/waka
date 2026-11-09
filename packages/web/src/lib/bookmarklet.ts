/**
 * THE BOOKMARKLET — SAVE THE PAGE YOU ARE ON
 *
 * It needs nothing from the server: it opens this app's own `/share` in a
 * small window with the page's address, its title and whatever is selected.
 * That window is signed in as you (it is this app, on its own origin), opens
 * the notepad with the page in it, and closes itself once Save lands. No API
 * key, no extension store, no cross-origin request.
 *
 * The selection is capped so a selected novel does not become a URL longer
 * than browsers will open; the server applies its own limits after that.
 */
export const BOOKMARKLET_SELECTION_CAP = 4000;

export function bookmarkletHref(origin: string): string {
  const base = new URL('/share', origin).toString();
  const body =
    `(()=>{const s=String(getSelection()||'').slice(0,${BOOKMARKLET_SELECTION_CAP});` +
    `window.open(${JSON.stringify(`${base}?via=bookmarklet`)}` +
    `+'&url='+encodeURIComponent(location.href)` +
    `+'&title='+encodeURIComponent(document.title)` +
    `+'&text='+encodeURIComponent(s),'waka-save','width=420,height=560')})()`;
  return `javascript:${body}`;
}
