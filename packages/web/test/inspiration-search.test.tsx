// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` supplies scripted archive pages
 * to test the search UI, including late/error responses. No field simulation
 * or real SQL is claimed by these tests. */
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InspirationSearch } from '../src/components/InspirationSearch';
import { fetchInspirationPage, type ApiInspirationSummary } from '../src/lib/api';

vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), fetchInspirationPage: vi.fn() }));
let host: HTMLDivElement, root: Root;
const pick = vi.fn();
const row = (id: string): ApiInspirationSummary => ({ id, textPreview: `Thought ${id}`, source: 'app', kind: 'note',
  createdAt: '2026-01-04T12:00:00Z', updatedAt: '2026-01-04T12:00:00Z', attachmentSummary: [], reflectionCount: 1 });
function Search({ profile = 'profile-1' }: { profile?: string }) {
  const [query, setQuery] = useState('garden');
  return <InspirationSearch profileId={profile} query={query} onQuery={setQuery} onPick={pick} onClose={() => undefined} locale="en-US" />;
}
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(230); }); }
function button(text: string) { return [...host.querySelectorAll('button')].find((node) => node.textContent?.includes(text))!; }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it('opens an archive result directly, with a recognizable preview, date and reflection cue', async () => {
  vi.mocked(fetchInspirationPage).mockResolvedValue({ inspirations: [row('older-than-field')], total: 5001 });
  await act(async () => root.render(<Search />));
  expect(host.querySelector('[role="status"]')?.textContent).toContain('Searching');
  await tick();
  expect(fetchInspirationPage).toHaveBeenCalledWith({ profile: 'profile-1', q: 'garden', limit: 50 }, expect.any(AbortSignal));
  expect(host.textContent).toContain('Jan 4, 2026'); expect(host.textContent).toContain('reflected');
  await act(async () => button('Thought older-than-field').click());
  expect(pick).toHaveBeenCalledWith(row('older-than-field'));
});
it('does not call an error no matches, and can retry the first page', async () => {
  vi.mocked(fetchInspirationPage).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ inspirations: [] });
  await act(async () => root.render(<Search />)); await tick();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.textContent).not.toContain('Nothing says that');
  await act(async () => button('Try again').click()); await tick();
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.querySelector('[role="status"]')?.textContent?.toLowerCase()).toContain('nothing');
});
it('keeps the first page through a failed next page, retries and deduplicates results', async () => {
  vi.mocked(fetchInspirationPage).mockResolvedValueOnce({ inspirations: [row('one')], nextCursor: 'page-2' })
    .mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ inspirations: [row('one'), row('two')] });
  await act(async () => root.render(<Search />)); await tick();
  await act(async () => button('More results').click());
  expect(host.textContent).toContain('Thought one'); expect(host.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => button('Try again').click());
  expect(host.querySelectorAll('.jar-search-results li')).toHaveLength(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(vi.mocked(fetchInspirationPage).mock.calls[2]?.[0]).toMatchObject({ cursor: 'page-2' });
});
it('ignores a late result from an old query', async () => {
  let resolve!: (value: { inspirations: ApiInspirationSummary[] }) => void;
  vi.mocked(fetchInspirationPage).mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
    .mockResolvedValueOnce({ inspirations: [row('new')] });
  await act(async () => root.render(<Search />)); await tick();
  const input = host.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'walk');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }); await tick();
  await act(async () => resolve({ inspirations: [row('stale')] }));
  expect(host.textContent).toContain('Thought new'); expect(host.textContent).not.toContain('Thought stale');
  expect(vi.mocked(fetchInspirationPage).mock.calls[0]?.[1]?.aborted).toBe(true);
});
it('removes an old profile result before the next profile read arrives', async () => {
  vi.mocked(fetchInspirationPage).mockResolvedValueOnce({ inspirations: [row('private-old')] })
    .mockImplementationOnce(() => new Promise(() => undefined));
  await act(async () => root.render(<Search />)); await tick();
  await act(async () => root.render(<Search profile="profile-2" />));
  expect(host.textContent).not.toContain('private-old'); await tick();
  expect(vi.mocked(fetchInspirationPage).mock.calls[1]?.[0]).toMatchObject({ profile: 'profile-2' });
});
