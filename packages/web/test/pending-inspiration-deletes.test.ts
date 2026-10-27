// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): the archive reader supplies a stale
 * response followed by the committed deletion, and fake timers control the
 * race and timeout. Real sessionStorage exercises persistence across reads;
 * nothing is replaced at the module boundary (API routes, storage helpers,
 * and profile boundaries stay real). */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { finishInspirationDelete, readAfterInspirationDeletes, trackInspirationDelete } from '../src/lib/pending-inspiration-deletes';

const noah = { accountId: 'account', profileId: 'noah' };
const another = { accountId: 'account', profileId: 'another' };
const stale = { inspirations: [{ id: 'deleted-note' }], total: 1 };
const settled = { inspirations: [], total: 0 };

beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

it('does not expose a stale archive when reload beats the keepalive delete', async () => {
  trackInspirationDelete(noah, 'deleted-note');
  // A new page sees the persisted receipt, with no in-memory request to await.
  const load = vi.fn().mockResolvedValueOnce(stale).mockResolvedValue(settled);
  let published = false;
  const reading = readAfterInspirationDeletes(noah, load, () => true).then(result => { published = true; return result; });
  await vi.advanceTimersByTimeAsync(0);
  expect(published).toBe(false);
  await vi.advanceTimersByTimeAsync(300);
  expect(await reading).toEqual({ field: settled, reconciled: true });
  expect(load).toHaveBeenCalledTimes(2);
  expect(await readAfterInspirationDeletes(noah, load, () => true)).toEqual({ field: settled, reconciled: false });
});

it('waits for a fresh read even if the old page confirms while its stale read is in flight', async () => {
  trackInspirationDelete(noah, 'deleted-note');
  const load = vi.fn().mockImplementationOnce(async () => {
    finishInspirationDelete(noah, 'deleted-note');
    return stale;
  }).mockResolvedValue(settled);
  const reading = readAfterInspirationDeletes(noah, load, () => true);
  await vi.advanceTimersByTimeAsync(300);
  expect((await reading).field).toEqual(settled);
});

it('never blocks another profile or another account on a pending deletion', async () => {
  trackInspirationDelete(noah, 'deleted-note');
  for (const scope of [another, { accountId: 'other-account', profileId: 'noah' }]) {
    expect(await readAfterInspirationDeletes(scope, async () => stale, () => true)).toEqual({ field: stale, reconciled: false });
  }
});

it('turns a delete that never settles into a retryable read failure, not an endless spinner', async () => {
  trackInspirationDelete(noah, 'deleted-note');
  const reading = readAfterInspirationDeletes(noah, async () => stale, () => true);
  const failure = expect(reading).rejects.toThrow('Could not confirm');
  await vi.advanceTimersByTimeAsync(20_100);
  await failure;
  expect(await readAfterInspirationDeletes(noah, async () => stale, () => true)).toEqual({ field: stale, reconciled: false });
});

it('stops polling when the archive closes', async () => {
  trackInspirationDelete(noah, 'deleted-note');
  let active = true;
  const load = vi.fn().mockResolvedValue(stale);
  const reading = readAfterInspirationDeletes(noah, load, () => active);
  const failure = expect(reading).rejects.toThrow('Archive closed');
  await vi.advanceTimersByTimeAsync(0);
  active = false;
  await vi.advanceTimersByTimeAsync(300);
  await failure;
  expect(load).toHaveBeenCalledTimes(1);
});

it('does not retain a failed delete or stale receipt indefinitely', async () => {
  trackInspirationDelete(noah, 'deleted-note');
  finishInspirationDelete(noah, 'deleted-note');
  expect((await readAfterInspirationDeletes(noah, async () => stale, () => true)).reconciled).toBe(false);
  trackInspirationDelete(noah, 'deleted-note');
  await vi.advanceTimersByTimeAsync(120_000);
  expect((await readAfterInspirationDeletes(noah, async () => stale, () => true)).reconciled).toBe(false);
});


it('does not treat absence from a partial page as confirmation of an older deletion', async () => {
  trackInspirationDelete(noah, 'deleted-note');
  await readAfterInspirationDeletes(noah, async () => ({ inspirations: [{ id: 'newer' }] }), () => true, true);
  const load = vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(settled);
  const reading = readAfterInspirationDeletes(noah, load, () => true, true);
  await vi.advanceTimersByTimeAsync(301);
  expect((await reading).reconciled).toBe(true);
  expect(load).toHaveBeenCalledTimes(2);
});
