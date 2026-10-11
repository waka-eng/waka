// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: nothing in the application. Real localStorage and
 * settlement helpers prove newer words survive; one case injects a failed
 * browser storage read to verify that cleanup stops rather than deleting data. */
import { beforeEach, expect, it, vi } from 'vitest';
import { restoreInspirationDraft, settleInspirationDraft } from '../src/lib/authored-save-drafts';

/*
 * THREE REFLECTION CASES WERE DELETED FROM HERE (2026-10-10), and one of them
 * is worth reporting rather than just removing.
 *
 * `settleReflectionDraft`, `restoreReflectionDraft` and `ReflectionDraft` went
 * with `components/ReflectionFlow.tsx` when the founder folded the writing
 * flow into the claim queue's one correction field. Two of the three cases
 * failed loudly when the functions disappeared, which is what should happen.
 *
 * THE THIRD KEPT PASSING, AND WAS A LIE. It read:
 *
 *     expect(() => settleReflectionDraft('draft', draft, draft)).toThrow();
 *
 * with `getItem` stubbed to throw — so once the function was gone, the
 * `TypeError: settleReflectionDraft is not a function` satisfied `toThrow()`
 * and the suite reported a property of a function that no longer existed. A
 * bare `toThrow()` cannot tell "refused for the right reason" from "was never
 * called at all", which is the same failure shape as `docs/six-laws.md` Law 8
 * one level up: green, and about nothing.
 *
 * The property it was holding — a storage read that FAILS must stop the
 * cleanup rather than delete the person's words — belongs to both halves of
 * this module equally, and the surviving half is the one box. It is asserted
 * below, on `settleInspirationDraft`, and asserted by its message rather than
 * by the mere fact of a throw.
 */

beforeEach(() => localStorage.clear());
it('clears only the submitted capture, retaining newer memory or stored drafts', () => {
  localStorage.setItem('draft', 'Original');
  expect(settleInspirationDraft('draft', 'Original', 'Original')).toBe('');
  expect(localStorage.getItem('draft')).toBeNull();
  localStorage.setItem('draft', 'Newer from another tab');
  expect(settleInspirationDraft('draft', 'Original', 'Original')).toBe('Newer from another tab');
  expect(localStorage.getItem('draft')).toBe('Newer from another tab');
  expect(settleInspirationDraft('draft', 'Original', 'My newer in-memory words')).toBe('My newer in-memory words');
  expect(localStorage.getItem('draft')).toBe('Newer from another tab');
});
it('persists newly typed words before clearing the old submitted draft', () => {
  localStorage.setItem('draft', 'Original');
  expect(settleInspirationDraft('draft', 'Original', 'Newer')).toBe('Newer');
  expect(localStorage.getItem('draft')).toBe('Newer');
});
it('does not clear a draft if ownership of its stored state cannot be read', () => {
  localStorage.setItem('draft', 'A thought');
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
  try { expect(() => settleInspirationDraft('draft', 'A thought', 'A thought')).toThrow('Unavailable'); }
  finally { read.mockRestore(); }
  expect(localStorage.getItem('draft')).toBe('A thought');
});
it('refuses to settle without owned storage rather than silently keeping nothing', () => {
  /* The `null` key is a profile scope that could not be built — a signed-out
     or half-restored viewer. Throwing is the point: a save whose pending
     identity is cleared while its words are not is a save that can duplicate
     itself on the next reload. */
  expect(() => settleInspirationDraft(null, 'A thought', 'A thought')).toThrow('No owned draft storage');
  expect(() => restoreInspirationDraft(null, 'Rejected', '')).toThrow('No owned draft storage');
});
it('restores rejected input without replacing a newer draft', () => {
  expect(restoreInspirationDraft('draft', 'Rejected', '')).toBe('Rejected');
  localStorage.setItem('draft', 'Newer');
  expect(restoreInspirationDraft('draft', 'Rejected', '')).toBe('Newer');
  expect(restoreInspirationDraft('draft', 'Rejected', 'My newer in-memory words')).toBe('My newer in-memory words');
});
