import { profileStorageKey, readProfileText, writeProfileText, type ProfileStorageScope } from './profile-storage';

/** Remember spoken updates per profile, including across reloads. Keep a small
 * in-memory copy too so blocked browser storage does not bring repetition back. */
export function createCompanionUpdates() {
  const remembered = new Map<string, string[]>();
  return (scope: ProfileStorageScope | null, day: string, lines: string[]): string => {
    const key = profileStorageKey(scope, 'companion-updates') ?? 'anonymous';
    let stored: string[] = [];
    try {
      const value: unknown = JSON.parse(readProfileText(scope, 'companion-updates'));
      if (Array.isArray(value)) stored = value.filter((item): item is string => typeof item === 'string').slice(-32);
    } catch { /* Missing or invalid history starts with unseen updates. */ }
    const seen = [...new Set([...stored, ...(remembered.get(key) ?? [])])].slice(-32);
    const line = lines.find(candidate => candidate && !seen.includes(`${day}:${candidate}`));
    if (!line) return '';
    const next = [...seen, `${day}:${line}`].slice(-32);
    remembered.set(key, next);
    writeProfileText(scope, 'companion-updates', JSON.stringify(next));
    return line;
  };
}
