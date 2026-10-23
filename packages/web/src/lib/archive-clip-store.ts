import type { ClipTarget } from './archive-recorder';
import { profileStorageKey, type ProfileStorageScope } from './profile-storage';

export interface StoredClip { id: string; target: ClipTarget; file: File; uploadedKey?: string }
type Row = Omit<StoredClip, 'file'> & { owner: string; bytes: ArrayBuffer; name: string; type: string };
const DATABASE = 'waka-archive-clips';

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let db: IDBDatabase | undefined, tx: IDBTransaction | undefined, result: T, expired = false;
    const timer = setTimeout(() => { expired = true; tx?.abort(); db?.close(); reject(new Error('Recording storage unavailable')); }, 2000);
    const fail = (error: unknown) => { clearTimeout(timer); db?.close(); reject(error); };
    const opening = indexedDB.open(DATABASE, 1);
    opening.onupgradeneeded = () => { opening.result.createObjectStore('clips', { keyPath: ['owner', 'id'] }).createIndex('owner', 'owner'); };
    opening.onerror = () => fail(opening.error);
    opening.onblocked = () => { expired = true; fail(new Error('Recording storage blocked')); };
    opening.onsuccess = () => {
      db = opening.result;
      if (expired) { db.close(); return; }
      tx = db.transaction('clips', mode);
      tx.oncomplete = () => { clearTimeout(timer); db?.close(); resolve(result); };
      tx.onabort = () => fail(tx?.error ?? new Error('Recording storage failed'));
      tx.onerror = () => { /* abort rejects */ };
      try { run(tx.objectStore('clips'), value => { result = value; }); }
      catch (error) { tx.abort(); fail(error); }
    };
  });
}
function owner(scope: ProfileStorageScope) {
  const key = profileStorageKey(scope, 'archiveClips');
  if (!key) throw new Error('Recording needs an owner');
  return key;
}
export async function putArchiveClip(scope: ProfileStorageScope, clip: StoredClip): Promise<void> {
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(clip.file);
  });
  await transaction<void>('readwrite', store => {
    store.put({ owner: owner(scope), id: clip.id, target: clip.target, bytes, name: clip.file.name, type: clip.file.type, uploadedKey: clip.uploadedKey } satisfies Row);
  });
}
export function loadArchiveClips(scope: ProfileStorageScope): Promise<StoredClip[]> {
  const owned = owner(scope);
  return transaction('readonly', (store, done) => {
    const request = store.index('owner').getAll(owned);
    request.onsuccess = () => done((request.result as Row[]).filter(row => row.owner === owned).map(row => ({
      id: row.id, target: row.target, uploadedKey: row.uploadedKey, file: new File([row.bytes], row.name, { type: row.type }),
    })));
  });
}
export function removeArchiveClip(scope: ProfileStorageScope, id: string): Promise<void> {
  return transaction('readwrite', store => { store.delete([owner(scope), id]); });
}
