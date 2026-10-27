// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): nothing in the application is replaced.
 * Browser Storage throws in the
 * unavailable-storage case to exercise the real in-memory fallback. The
 * profile keys, persistence and update selection run unchanged in jsdom. */
import { beforeEach, expect, it, vi } from 'vitest';
import { createCompanionUpdates } from '../src/lib/companion-updates';

const noah = { accountId: 'one', profileId: 'noah' };
const another = { accountId: 'one', profileId: 'anotherone' };
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

it('remembers updates after reload without suppressing another profile or a new day', () => {
  const next = createCompanionUpdates();
  expect(next(noah, '2026-10-26', ['Top of mind changed.', 'One save.'])).toBe('Top of mind changed.');
  expect(next(noah, '2026-10-26', ['Top of mind changed.', 'One save.'])).toBe('One save.');
  expect(createCompanionUpdates()(noah, '2026-10-26', ['Top of mind changed.', 'One save.'])).toBe('');
  expect(next(noah, '2026-10-26', ['Top of mind changed.', 'Two saves.'])).toBe('Two saves.');
  expect(next(another, '2026-10-26', ['Top of mind changed.'])).toBe('Top of mind changed.');
  expect(next(noah, '2026-10-27', ['Top of mind changed.'])).toBe('Top of mind changed.');
});

it('still avoids repetition when browser storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable'); });
  const next = createCompanionUpdates();
  expect(next(noah, 'today', ['One save.'])).toBe('One save.');
  expect(next(noah, 'today', ['One save.'])).toBe('');
});
