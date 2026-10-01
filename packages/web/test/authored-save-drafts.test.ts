// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY: nothing in the application. Real localStorage and
 * settlement helpers prove newer words survive; one case injects a failed
 * browser storage read to verify that cleanup stops rather than deleting data. */
import { beforeEach, expect, it, vi } from 'vitest';
import { restoreInspirationDraft, restoreReflectionDraft, settleInspirationDraft, settleReflectionDraft } from '../src/lib/authored-save-drafts';

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
it('retains a later reflection even when its words happen to match an earlier answer', () => {
  const submitted = { afterId: null, question: 'Why?', answer: 'An answer' };
  const newer = { ...submitted, afterId: 'a-later-turn' };
  localStorage.setItem('draft', JSON.stringify(newer));
  expect(settleReflectionDraft('draft', submitted, submitted)).toEqual(newer);
  expect(JSON.parse(localStorage.getItem('draft')!)).toEqual(newer);
});
it('does not clear a reflection draft if ownership of its stored state cannot be read', () => {
  const draft = { afterId: null, question: 'Why?', answer: 'A thought' };
  localStorage.setItem('draft', JSON.stringify(draft));
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
  try { expect(() => settleReflectionDraft('draft', draft, draft)).toThrow(); }
  finally { read.mockRestore(); }
  expect(JSON.parse(localStorage.getItem('draft')!)).toEqual(draft);
});
it('restores rejected input without replacing a newer draft', () => {
  expect(restoreInspirationDraft('draft', 'Rejected', '')).toBe('Rejected');
  localStorage.setItem('draft', 'Newer');
  expect(restoreInspirationDraft('draft', 'Rejected', '')).toBe('Newer');
  const original = { afterId: null, question: 'Why?', answer: 'Rejected' };
  expect(restoreReflectionDraft('reflection', original, { ...original, answer: '' })).toEqual(original);
  const newer = { afterId: 'later', question: 'What next?', answer: 'A newer answer' };
  localStorage.setItem('reflection', JSON.stringify(newer));
  expect(restoreReflectionDraft('reflection', original, { ...original, answer: '' })).toEqual(newer);
});
