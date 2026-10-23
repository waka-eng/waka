import { profileStorageKey, type ProfileStorageScope } from './profile-storage';

export interface NoteEditDraft { base: string; text: string; revision: string }

function key(scope: ProfileStorageScope | null, id: string) {
  return profileStorageKey(scope, `noteEdit:${id}`);
}

export function readNoteEdit(scope: ProfileStorageScope | null, id: string): NoteEditDraft | null {
  const name = key(scope, id);
  if (!name) return null;
  try {
    const row = JSON.parse(localStorage.getItem(name) ?? 'null');
    return row && typeof row.base === 'string' && typeof row.text === 'string' && typeof row.revision === 'string' ? row : null;
  } catch { return null; }
}

/** Synchronous on each edit: pagehide is too late on mobile. Never overwrite
 * another tab's draft, or let an older save acknowledgement clear newer words. */
export function writeNoteEdit(scope: ProfileStorageScope | null, id: string, base: string, text: string, previous: string | null): NoteEditDraft | null {
  const name = key(scope, id);
  if (!name) return null;
  if ((readNoteEdit(scope, id)?.revision ?? null) !== previous) throw new Error('Draft changed in another tab');
  const row = { base, text, revision: crypto.randomUUID() };
  localStorage.setItem(name, JSON.stringify(row));
  return row;
}

export function clearNoteEdit(scope: ProfileStorageScope | null, id: string, revision: string | null): void {
  const name = key(scope, id);
  if (name && readNoteEdit(scope, id)?.revision === revision) localStorage.removeItem(name);
}
