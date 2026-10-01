/** Settle only the submitted draft. Throw on storage failure: removing its
 * pending identity before the draft clears could duplicate it after reload. */
export function settleInspirationDraft(key: string | null, submitted: string, current: string): string {
  const matches = (value: string) => value.trim() === submitted.trim();
  if (!key) throw new Error('No owned draft storage');
  const stored = localStorage.getItem(key) ?? '';
  const next = !matches(current) ? current : !matches(stored) ? stored : '';
  // Do not overwrite another tab's newer draft just because this save finished.
  if (!stored || matches(stored)) {
    if (next) localStorage.setItem(key, next); else localStorage.removeItem(key);
  }
  return next;
}
export interface ReflectionDraft { afterId: string | null; question?: string; answer: string }
export function readReflectionDraft(key: string | null): ReflectionDraft | null {
  if (!key) return null;
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as ReflectionDraft | null;
    return value && typeof value.answer === 'string' && (value.afterId === null || typeof value.afterId === 'string') ? value : null;
  } catch { return null; }
}
export function settleReflectionDraft(key: string | null, submitted: ReflectionDraft, current: ReflectionDraft): ReflectionDraft | null {
  if (!key) throw new Error('No owned draft storage');
  const matches = (value: ReflectionDraft | null) => Boolean(value && value.afterId === submitted.afterId && value.answer.trim() === submitted.answer.trim() &&
    (!value.question || value.question === submitted.question));
  const raw = localStorage.getItem(key);
  const stored = raw ? JSON.parse(raw) as ReflectionDraft : null;
  if (stored && typeof stored.answer !== 'string') throw new Error('Unreadable owned draft');
  const next = current.answer.trim() && !matches(current) ? current : stored?.answer.trim() && !matches(stored) ? stored : null;
  if (!stored || matches(stored)) {
    if (next) localStorage.setItem(key, JSON.stringify(next)); else localStorage.removeItem(key);
  }
  return next;
}

export function restoreInspirationDraft(key: string | null, original: string, current: string): string {
  if (!key) throw new Error('No owned draft storage');
  const next = current || localStorage.getItem(key) || original;
  localStorage.setItem(key, next);
  return next;
}
export function restoreReflectionDraft(key: string | null, original: ReflectionDraft, current: ReflectionDraft): ReflectionDraft {
  if (!key) throw new Error('No owned draft storage');
  const next = current.answer ? current : readReflectionDraft(key) ?? original;
  localStorage.setItem(key, JSON.stringify(next));
  return next;
}
