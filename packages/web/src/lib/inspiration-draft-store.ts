import { profileStorageKey, type ProfileStorageScope } from './profile-storage';

export interface InspirationDraftMedia {
  id: string;
  type: 'image' | 'audio' | 'link';
  name: string;
  url?: string;
  blob?: Blob;
  uploadError?: string;
  validationError?: string;
  uploaded?: { key: string; contentType: string; size: number };
}
export interface InspirationDraft {
  id: string;
  revision: number;
  text: string;
  linkText?: string;
  media: InspirationDraftMedia[];
  /** A replacement waits here until chosen; it is never uploaded as a second recording. */
  recordingCandidate?: InspirationDraftMedia | null;
  updatedAt: number;
}
interface StoredDraft extends InspirationDraft {
  key: string;
  owner: string;
  savedInspirationId?: string;
}
export class InspirationDraftConflict extends Error {}
const DATABASE = 'waka-inspiration-drafts';
const STORE = 'drafts';
function ownerKey(scope: ProfileStorageScope) {
  const key = profileStorageKey(scope, 'inspirationDraft');
  if (!key) throw new Error('A draft needs an authenticated owner');
  return key;
}
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => {
      const store = opening.result.createObjectStore(STORE, { keyPath: 'key' });
      store.createIndex('owner', 'owner');
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error('Draft storage unavailable'));
    opening.onblocked = () => reject(new Error('Draft storage is open in an older tab'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let result: T, error: Error | null = null;
    const tx = db.transaction(STORE, mode);
    tx.oncomplete = () => { db.close(); resolve(result); };
    tx.onabort = () => { db.close(); reject(error ?? tx.error ?? new Error('Draft storage failed')); };
    tx.onerror = () => { /* abort owns the rejected result */ };
    try { work(tx.objectStore(STORE), value => { result = value; }, reason => { error = reason; tx.abort(); }); }
    catch (reason) { error = reason instanceof Error ? reason : new Error('Draft storage failed'); tx.abort(); }
  });
}
function readStored(value: unknown, owner: string): StoredDraft | null {
  if (value === undefined) return null;
  const row = value as StoredDraft;
  if (row.owner !== owner || typeof row.id !== 'string' || row.key !== `${owner}:${row.id}` || !Number.isSafeInteger(row.revision) ||
    typeof row.text !== 'string' || (row.linkText !== undefined && typeof row.linkText !== 'string') || !Array.isArray(row.media) || !Number.isFinite(row.updatedAt)) throw new Error('Unverifiable draft');
  if (row.recordingCandidate && (row.recordingCandidate.type !== 'audio' || typeof row.recordingCandidate.id !== 'string' ||
    typeof row.recordingCandidate.name !== 'string' || !(row.recordingCandidate.blob instanceof Blob))) throw new Error('Unverifiable recording draft');
  return row;
}
export function newInspirationDraft(text = ''): InspirationDraft {
  return { id: crypto.randomUUID(), revision: 0, text, media: [], updatedAt: Date.now() };
}
export async function loadInspirationDraft(scope: ProfileStorageScope, id?: string): Promise<InspirationDraft | null> {
  const owner = ownerKey(scope);
  return transaction('readonly', (store, done, fail) => {
    const request = id ? store.get(`${owner}:${id}`) : store.index('owner').getAll(owner);
    request.onsuccess = () => {
      try {
        const rows = (id ? [request.result] : request.result as unknown[]).map(value => readStored(value, owner))
          .filter((row): row is StoredDraft => Boolean(row && !row.savedInspirationId && (id || row.text.trim() || row.linkText?.trim() || row.media.length || row.recordingCandidate)));
        rows.sort((a, b) => b.updatedAt - a.updatedAt);
        const row = rows[0];
        done(row ? { id: row.id, revision: row.revision, text: row.text, linkText:row.linkText ?? '', media: row.media, updatedAt: row.updatedAt,
          ...(row.recordingCandidate ? { recordingCandidate: row.recordingCandidate } : {}) } : null);
      } catch (reason) { fail(reason instanceof Error ? reason : new Error('Unverifiable draft')); }
    };
  });
}
/** Compare-and-swap prevents another tab's newer words/files being overwritten. */
export async function writeInspirationDraft(scope: ProfileStorageScope, draft: InspirationDraft, previousRevision: number): Promise<void> {
  const owner = ownerKey(scope);
  return transaction('readwrite', (store, done, fail) => {
    const request = store.get(`${owner}:${draft.id}`);
    request.onsuccess = () => {
      try {
        const prior = readStored(request.result, owner);
        if (prior?.savedInspirationId || (prior?.revision ?? 0) !== previousRevision || draft.revision !== previousRevision + 1) {
          fail(new InspirationDraftConflict('This draft changed in another tab. Your input is still here.')); return;
        }
        store.put({ ...draft, owner, key: `${owner}:${draft.id}` } satisfies StoredDraft);
        done(undefined);
      } catch (reason) { fail(reason instanceof Error ? reason : new Error('Draft storage failed')); }
    };
  });
}
/**
 * EVERYTHING THIS OWNER LEFT UNSENT, FOR LOGOUT.
 *
 * The save box keeps its words here and ALSO its pasted links, its photos and
 * its voice recordings — the only store in the product that holds a person's
 * actual media before they have decided to keep it. Signing out on a shared
 * machine left all of it for the next person; `lib/draft-eviction.ts` is the
 * one caller and its header carries the full reasoning.
 *
 * A SETTLED ROW IS A RECEIPT, NOT A DRAFT, so it stays. `settleInspirationMediaDraft`
 * empties a row's text and media when it stamps `savedInspirationId` on it, so
 * a row carrying that id holds no words — what it holds is the fact that this
 * draft was already submitted, which is how an old tab is stopped from
 * submitting it a second time. Deleting it would buy no privacy and cost that
 * guarantee, which is the same trade `pendingSave:` is kept for.
 *
 * Anything unreadable goes. A row this module's own verifier rejects is still
 * a row someone typed into, and there is no recovery backup here to move it to.
 *
 * Deleting a row that a save is in flight for costs nothing either: the
 * submitted payload lives in the `pendingSave:` intent, which survives logout,
 * and `settleInspirationMediaDraft` treats an absent row as already settled.
 */
export async function clearInspirationDrafts(scope: ProfileStorageScope): Promise<void> {
  const owner = ownerKey(scope);
  return transaction('readwrite', (store, done) => {
    /* A bare key, not an `IDBKeyRange`: the range object is a separate global
       and not every environment this module is exercised in exposes one. */
    const request = store.index('owner').openCursor(owner);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { done(undefined); return; }
      const row = cursor.value as Partial<StoredDraft> | undefined;
      if (typeof row?.savedInspirationId !== 'string' || !row.savedInspirationId) cursor.delete();
      cursor.continue();
    };
  });
}

/** Remove the submitted bytes only if the exact draft revision was saved.
 * Keep a small tombstone so an old tab cannot submit that cleared draft again. */
export async function settleInspirationMediaDraft(scope: ProfileStorageScope, id: string, revision: number, inspirationId: string): Promise<boolean> {
  const owner = ownerKey(scope);
  return transaction('readwrite', (store, done, fail) => {
    const request = store.get(`${owner}:${id}`);
    request.onsuccess = () => {
      try {
        const prior = readStored(request.result, owner);
        if (!prior || prior.savedInspirationId) { done(true); return; }
        if (prior.revision !== revision) { done(false); return; }
        store.put({ ...prior, text: '', linkText:'', media: [], recordingCandidate: null, savedInspirationId: inspirationId, revision: revision + 1, updatedAt: Date.now() } satisfies StoredDraft);
        done(true);
      } catch (reason) { fail(reason instanceof Error ? reason : new Error('Draft settlement failed')); }
    };
  });
}
