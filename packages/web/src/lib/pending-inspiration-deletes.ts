import { profileStorageKey, type ProfileStorageScope } from './profile-storage';

type Pending = Record<string, number>;
const MAX_AGE_MS = 120_000;

function read(scope: ProfileStorageScope | null): Pending {
  const key = profileStorageKey(scope, 'pending-inspiration-deletes');
  if (!key) return {};
  try {
    const value: unknown = JSON.parse(window.sessionStorage.getItem(key) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter(([, at]) =>
      typeof at === 'number' && at <= Date.now() && Date.now() - at < MAX_AGE_MS));
  } catch { return {}; }
}

function write(scope: ProfileStorageScope | null, pending: Pending): void {
  const key = profileStorageKey(scope, 'pending-inspiration-deletes');
  if (!key) return;
  try {
    if (Object.keys(pending).length) window.sessionStorage.setItem(key, JSON.stringify(pending));
    else window.sessionStorage.removeItem(key);
  } catch { /* Storage can be unavailable; the original delete still runs. */ }
}

/** Only an already-dispatched delete is recorded; this never replays a write. */
export function trackInspirationDelete(scope: ProfileStorageScope | null, id: string): void {
  write(scope, { ...read(scope), [id]: Date.now() });
}

export function finishInspirationDelete(scope: ProfileStorageScope | null, id: string): void {
  const pending = read(scope);
  delete pending[id];
  write(scope, pending);
}

/** A pagehide keepalive can finish after the next page's first archive read.
 * Keep that stale read off screen and confirm the result, bounded to 20s. */
export async function readAfterInspirationDeletes<T extends { inspirations: { id: string }[] }>(
  scope: ProfileStorageScope | null, load: () => Promise<T>, active: () => boolean, partial = false,
): Promise<{ field: T; reconciled: boolean }> {
  const ids = Object.keys(read(scope));
  const deadline = Date.now() + 20_000;
  const seen = new Set<string>();
  while (true) {
    if (!active()) throw new DOMException('Archive closed', 'AbortError');
    const field = await load();
    for (const id of ids) if (field.inspirations.some(row => row.id === id)) seen.add(id);
    if (!ids.some(id => field.inspirations.some(row => row.id === id))) {
      for (const id of ids) if (!partial || seen.has(id)) finishInspirationDelete(scope, id);
      return { field, reconciled: ids.length > 0 };
    }
    if (Date.now() >= deadline) {
      for (const id of ids) finishInspirationDelete(scope, id);
      throw new Error('Could not confirm the pending deletion');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
}
