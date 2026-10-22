/* THE DRAFTS THIS TAB FORKED, AND WHAT EACH ONE REPLACED (L10).
 *
 * Chat drafts are stamped with a writer minted per mount, and
 * an edit to a draft another writer stored is forked under a new key so two
 * tabs never overwrite each other. A reload, reopening or switching back is a
 * new mount, so the restored draft O forks to F; sending F
 * used to clear F alone and O came back on the next mount.
 *
 * So each fork is written down here: "F replaced O, whose bytes were these"
 * — but ONLY when O's bytes are still the ones this tab last wrote there.
 * Every store this tab makes is kept in a per-tab map, key to the bytes
 * written (like `OWN_SAVES`' own request ids), which a reload of this tab
 * keeps, so the reload chain is linked. A draft another tab wrote is never
 * linked — including one it rewrote under a key this tab made (a draft with
 * photos keeps its key when another tab edits it) — so sending here never
 * deletes it: that tab may still be showing it.
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
 * events, no leases. See docs/plans/drafts-after-reload.md.
 *
 * NO WORDS ARE KEPT HERE (security review on 00a2c1d6). Only draft keys and
 * a fingerprint of each draft's bytes, under this account and profile's
 * scope, and sign-out (`clearUnsentDrafts`) removes both records, so the
 * next person in this tab finds neither words nor a trace of them. */

import {profileStorageKey,type ProfileStorageScope} from './profile-storage';

const LIMIT = 50, OWN_LIMIT = 100;
const forksKey = (scope: ProfileStorageScope) => profileStorageKey(scope, 'draftLineage:forks');
const ownKey = (scope: ProfileStorageScope) => profileStorageKey(scope, 'draftLineage:mine');
/** A stable 53-bit fingerprint of a draft's bytes (cyrb53), with its length:
    enough to tell "unchanged" from "rewritten" without keeping the words. */
export function draftFingerprint(raw: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < raw.length; i += 1) { const c = raw.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return `${raw.length}:${(4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16)}`;
}
interface Fork { key: string; from: string; print: string }
const valid = (row: unknown): row is Fork => Boolean(row) && typeof (row as Fork).key === 'string' && typeof (row as Fork).from === 'string' && typeof (row as Fork).print === 'string';
function readJson(key: string | null): unknown[] {
  if (!key) return [];
  try { const rows = JSON.parse(sessionStorage.getItem(key) ?? '[]'); return Array.isArray(rows) ? rows : []; }
  catch { return []; }
}
function writeJson(key: string | null, rows: unknown[], limit: number) {
  if (!key) return;
  try { if (rows.length) sessionStorage.setItem(key, JSON.stringify(rows.slice(-limit))); else sessionStorage.removeItem(key); }
  catch { /* clearing a replaced draft is a convenience; the draft itself is safe */ }
}
const readForks = (scope: ProfileStorageScope) => readJson(forksKey(scope)).filter(valid);
const writeForks = (scope: ProfileStorageScope, rows: Fork[]) => writeJson(forksKey(scope), rows, LIMIT);
const readOwn = (scope: ProfileStorageScope) => new Map(readJson(ownKey(scope)).filter((row): row is [string, string] => Array.isArray(row) && row.length === 2 && typeof row[0] === 'string' && typeof row[1] === 'string'));
const writeOwn = (scope: ProfileStorageScope, rows: Map<string, string>) => writeJson(ownKey(scope), [...rows], OWN_LIMIT);
/* A draft key is its place's prefix plus the draft's uuid; a link is kept
   only between two drafts of one place (one chat). Share cards do not use
   this: a forked card's original stays a choice in the Drafts picker. */
const place = (key: string) => key.slice(0, -36);

/** This tab stored `saved`; `previous` is the stored row it was editing. A
 * new key over a row whose bytes are exactly what THIS tab last wrote there
 * is a fork, and is linked. */
export function recordDraftStored(scope: ProfileStorageScope, saved: { key: string; raw: string }, previous: { key: string; raw: string } | null | undefined) {
  const own = readOwn(scope), key = saved.key;
  if (previous?.key && previous.key !== key && own.get(previous.key) === draftFingerprint(previous.raw) && place(previous.key) === place(key))
    writeForks(scope, [...readForks(scope).filter((row) => row.key !== key), { key, from: previous.key, print: draftFingerprint(previous.raw) }]);
  own.delete(key); own.set(key, draftFingerprint(saved.raw)); writeOwn(scope, own);
}

/** The draft at `key` was sent: clear every draft this tab
 * recorded it as replacing, each only if its bytes are still the ones seen
 * at the fork. The caller clears `key` itself. */
export function clearDraftLineage(scope: ProfileStorageScope, key: string) {
  if (!key) return;
  const rows = readForks(scope), seen = new Set<string>(), queue = [key];
  while (queue.length) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    for (const row of rows) if (row.key === next) {
      try { const now = localStorage.getItem(row.from); if (now !== null && draftFingerprint(now) === row.print) localStorage.removeItem(row.from); } catch { /* kept */ }
      queue.push(row.from);
    }
  }
  writeForks(scope, rows.filter((row) => !seen.has(row.key)));
  const own = readOwn(scope); for (const done of seen) own.delete(done); writeOwn(scope, own);
}

/** Sign-out: this account and profile's records go with its drafts. */
export function clearDraftLineageRecords(scope: ProfileStorageScope | null) {
  if (!scope?.accountId || !scope.profileId) return;
  for (const key of [forksKey(scope), ownKey(scope)]) if (key) { try { sessionStorage.removeItem(key); } catch { /* best effort */ } }
}
