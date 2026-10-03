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
    typeof row.text !== 'string' || !Array.isArray(row.media) || !Number.isFinite(row.updatedAt)) throw new Error('Unverifiable draft');
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
          .filter((row): row is StoredDraft => Boolean(row && !row.savedInspirationId && (id || row.text.trim() || row.media.length || row.recordingCandidate)));
        rows.sort((a, b) => b.updatedAt - a.updatedAt);
        const row = rows[0];
        done(row ? { id: row.id, revision: row.revision, text: row.text, media: row.media, updatedAt: row.updatedAt,
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
        store.put({ ...prior, text: '', media: [], recordingCandidate: null, savedInspirationId: inspirationId, revision: revision + 1, updatedAt: Date.now() } satisfies StoredDraft);
        done(true);
      } catch (reason) { fail(reason instanceof Error ? reason : new Error('Draft settlement failed')); }
    };
  });
}
