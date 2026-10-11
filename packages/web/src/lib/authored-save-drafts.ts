/* THE REFLECTION HALF OF THIS MODULE IS GONE (2026-10-10):
   `ReflectionDraft`, `readReflectionDraft`, `settleReflectionDraft` and
   `restoreReflectionDraft`. Four functions whose whole job was to keep ONE
   half-written answer safe across a reload, a second tab, a rejected edit and
   a storage quota — and whose only callers were `components/ReflectionFlow.tsx`
   and `components/ReviewPanel.tsx`, folded on the founder's instruction:
   *"Collapse all five into 'correct a claim' — one text field, reached only
   after 'not quite'."* The draft lifecycle was named explicitly as part of
   what the fold removes.

   THE KEYS THEY WROTE ARE STILL SWEPT. `lib/draft-eviction.ts` keeps
   `reflectionDraft:` on its logout list and says why: an eviction list is
   about what a device HAS, not what this build can produce.

   The inspiration half below is unchanged and live — it is the one box, and
   the one box still keeps your words when a save goes wrong. */

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
export function restoreInspirationDraft(key: string | null, original: string, current: string): string {
  if (!key) throw new Error('No owned draft storage');
  const next = current || localStorage.getItem(key) || original;
  localStorage.setItem(key, next);
  return next;
}
