/* THE DRAFTS THIS TAB FORKED, AND WHAT EACH ONE REPLACED (L10).
 *
 * Chat drafts are stamped with a writer minted per mount, and
 * an edit to a draft another writer stored is forked under a new key so two
 * tabs never overwrite each other. A reload, reopening or switching back is a
 * new mount, so the restored draft O forks to F; sending F
 * used to clear F alone and O came back on the next mount.
 *
 * So each fork is written down here: "F replaced O, whose bytes were these"
 * — but ONLY when this tab itself stored O. Every key this tab stores is
 * kept in a per-tab set (like `OWN_SAVES`' own request ids), which a reload
 * of this tab keeps, so the reload chain is linked. A draft another tab
 * wrote is never linked, so sending here never deletes it: that tab may
 * still be showing it, and would lose it on its next reload.
 * When a send is confirmed, the current draft's
 * recorded line is cleared with it — O, and whatever O replaced in turn — but
 * only by compare-and-delete on the bytes this tab saw when it forked, so a
 * draft another tab has written since is kept. A draft with no recorded link
 * to the one being cleared (any draft another tab wrote) is never touched.
 *
 * Modelled on `OWN_SAVES` (`use-authored-save.ts`): per tab, in
 * sessionStorage, which survives a reload of this tab only. Known residuals:
 * a duplicated tab copies this list, and a closed tab's list is gone, so a
 * fork made there leaves its original behind. No tombstones, no storage
 * events, no leases. See docs/plans/drafts-after-reload.md. */
const OWN_FORKS = 'waka:draftLineage:own';
const OWN_DRAFTS = 'waka:draftLineage:mine';
const LIMIT = 50, OWN_LIMIT = 100;
interface Fork { key: string; from: string; raw: string }
const valid = (row: unknown): row is Fork => Boolean(row) && typeof (row as Fork).key === 'string' && typeof (row as Fork).from === 'string' && typeof (row as Fork).raw === 'string';
function readForks(): Fork[] {
  try { const rows = JSON.parse(sessionStorage.getItem(OWN_FORKS) ?? '[]'); return Array.isArray(rows) ? rows.filter(valid) : []; }
  catch { return []; }
}
function writeForks(rows: Fork[]) {
  try { if (rows.length) sessionStorage.setItem(OWN_FORKS, JSON.stringify(rows.slice(-LIMIT))); else sessionStorage.removeItem(OWN_FORKS); }
  catch { /* clearing a replaced draft is a convenience; the draft itself is safe */ }
}
function readOwn(): Set<string> {
  try { const keys = JSON.parse(sessionStorage.getItem(OWN_DRAFTS) ?? '[]'); return new Set(Array.isArray(keys) ? keys.filter((key) => typeof key === 'string') : []); }
  catch { return new Set(); }
}
function writeOwn(keys: Set<string>) {
  try { if (keys.size) sessionStorage.setItem(OWN_DRAFTS, JSON.stringify([...keys].slice(-OWN_LIMIT))); else sessionStorage.removeItem(OWN_DRAFTS); }
  catch { /* as above */ }
}
/* A draft key is its place's prefix plus the draft's uuid; a link is kept
   only between two drafts of one place (one chat). Share cards do not use
   this: a forked card's original stays a choice in the Drafts picker. */
const place = (key: string) => key.slice(0, -36);

/** This tab stored a draft at `key`; `previous` is the stored row it was
 * editing. A new key over a row THIS tab stored is a fork, and is linked. */
export function recordDraftStored(key: string, previous: { key: string; raw: string } | null | undefined) {
  const own = readOwn();
  if (previous?.key && previous.key !== key && own.has(previous.key) && place(previous.key) === place(key))
    writeForks([...readForks().filter((row) => row.key !== key), { key, from: previous.key, raw: previous.raw }]);
  own.delete(key); own.add(key); writeOwn(own);
}

/** The draft at `key` was sent: clear every draft this tab
 * recorded it as replacing, each only if its bytes are still the ones seen
 * at the fork. The caller clears `key` itself. */
export function clearDraftLineage(key: string) {
  if (!key) return;
  const rows = readForks(), seen = new Set<string>(), queue = [key];
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const row of rows) if (row.key === next) {
      try { if (localStorage.getItem(row.from) === row.raw) localStorage.removeItem(row.from); } catch { /* kept */ }
      queue.push(row.from);
    }
  }
  writeForks(rows.filter((row) => !seen.has(row.key)));
  const own = readOwn(); for (const done of seen) own.delete(done); writeOwn(own);
}
