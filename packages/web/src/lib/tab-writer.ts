/**
 * WHO IS WRITING A DRAFT: THIS TAB, ACROSS RELOADS.
 *
 * The chat composer and the share card both stamp each draft with a writer
 * id, and an edit to a draft some OTHER writer left is forked under a new key
 * rather than written over it — so two tabs never clobber each other's words.
 *
 * The id used to be minted per mount. A reload is a new mount, so the tab
 * that wrote a draft became a stranger to it a second later: the next
 * keystroke forked, the original stayed on disk, and once the fork was sent
 * (or discarded) the next reload restored the original — words already sent,
 * back in the box. Clearing "the drafts a fork came from" fixed that and broke
 * something worse: the draft it came from may belong to another tab that is
 * still open, and deleting it takes that tab's words.
 *
 * So the writer is the TAB. `sessionStorage` is per tab and survives a reload,
 * which is exactly the lifetime of "the same person in the same window": a
 * reload keeps writing its own draft in place, and another tab — a different
 * `sessionStorage` — still forks. When storage is unavailable this falls back
 * to a fresh id per call, which is the old per-mount behaviour and errs
 * toward keeping drafts rather than losing them.
 *
 * A DUPLICATED TAB copies `sessionStorage`, so it starts as the same writer.
 * Both then write the same key, and the compare-and-set in each draft store
 * refuses the second write ("changed in another tab") rather than overwriting
 * — the same visible, recoverable state any other conflict reaches.
 */
const KEY = "waka:draftWriter";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function tabWriterId(): string {
  try {
    const held = sessionStorage.getItem(KEY);
    if (held && UUID.test(held)) return held;
    const made = crypto.randomUUID();
    sessionStorage.setItem(KEY, made);
    return made;
  } catch {
    return crypto.randomUUID();
  }
}
