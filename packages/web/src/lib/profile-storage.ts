export interface ProfileStorageScope {
  accountId: string;
  profileId: string;
}

/** Legacy unscoped drafts have no provable owner and are never auto-imported. */
export function profileStorageKey(scope: ProfileStorageScope | null, name: string): string | null {
  if (!scope?.accountId || !scope.profileId) return null;
  return `waka.profile:${encodeURIComponent(scope.accountId)}:${encodeURIComponent(scope.profileId)}:${name}`;
}

export function readProfileText(scope: ProfileStorageScope | null, name: string): string {
  const key = profileStorageKey(scope, name);
  if (!key) return "";
  try { return window.localStorage.getItem(key) ?? ""; }
  catch { return ""; }
}

export function writeProfileText(scope: ProfileStorageScope | null, name: string, value: string): void {
  const key = profileStorageKey(scope, name);
  if (!key) return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch { /* unavailable storage does not discard the open in-memory draft */ }
}
