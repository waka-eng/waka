// @vitest-environment jsdom
/**
 * BRING THEM IN ON DAY ONE (founder, 2026-11-27, "Day 1 import", flow A).
 *
 * A new person is asked once, in the creature's bubble, for what they
 * already saved in other apps: Photos, Files, Not now. Not now is remembered
 * per profile. Each picked item becomes its own save through the usual
 * upload and save, and as it lands it is born on the field. An item that
 * fails is tried once more, quietly, then left out, and the bubble says a few
 * did not come in and where the door is. Never a count on screen.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): through `helpers/render-home`,
 * `lib/data` (an empty archive, no reading), `lib/api` (the boot verbs, and
 * the three upload steps: `presignAttachment`, `uploadToPresignedUrl`,
 * `createInspiration`; `fetchHunch` answers nothing), `lib/auth-context` (a
 * signed-in owner), `lib/inspiration-photo` (the sniffer passes a file
 * through, so the test needs no real image bytes) and the canvas
 * (`helpers/canvas-stub`). The page, the bubble and the queue are the
 * shipped ones.
 */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { createInspiration, fetchHunch, presignAttachment, uploadToPresignedUrl } from '../src/lib/api';

const FACTS = vi.hoisted(() => ({ inspirations: [] as Array<{ id: string; text: string; daysAgo: number }> }));
vi.mock('../src/lib/data', async original => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  fetchHunch: vi.fn(async () => null),
  presignAttachment: vi.fn(async (input: { filename: string }) => ({ profileId: 'profile-viewer', uploadUrl: `https://bucket.test/${input.filename}`,
    key: `uploads/${input.filename}`, expiresAt: new Date(Date.now() + 60_000).toISOString(), headers: { 'Content-Type': 'image/png', 'Content-Length': '8' } })),
  uploadToPresignedUrl: vi.fn(async () => undefined),
  createInspiration: vi.fn(async (input: { text: string; kind: string; attachments: Array<{ key: string }> }) => ({
    id: `saved-${input.attachments[0]!.key}`, profileId: 'profile-viewer', text: input.text, kind: input.kind, source: 'app', visibility: 'private',
    attachments: [], reflections: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })),
}));
vi.mock('../src/lib/auth-context', async original => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});
vi.mock('../src/lib/inspiration-photo', async original => {
  const actual = await original<typeof import('../src/lib/inspiration-photo')>();
  return { ...actual, inspectInspirationPhoto: async (file: File) => file };
});

let world: MountedWorld | undefined;
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear();
  vi.mocked(createInspiration).mockClear(); vi.mocked(presignAttachment).mockClear(); vi.mocked(uploadToPresignedUrl).mockClear();
  vi.mocked(uploadToPresignedUrl).mockImplementation(async () => undefined);
  vi.mocked(fetchHunch).mockReset().mockImplementation(async () => null);
  FACTS.inspirations = [];
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { world?.unmount(); world = undefined; vi.useRealTimers(); });
async function settle(ms = 100) { for (let turn = 0; turn < 8; turn += 1) { await world!.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); } }
const notice = () => world!.container.querySelector('.waka-home-bar-notice')?.textContent ?? '';
const bubble = () => world!.container.querySelector('.jar-char-bubble')?.textContent ?? '';
const act_ = (label: string) => [...world!.container.querySelectorAll<HTMLButtonElement>('.jar-char-bubble-act')].find(b => b.textContent === label);
const photo = (name: string) => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });
async function pick(door: 'photos' | 'files', files: File[]) {
  const input = world!.container.querySelector<HTMLInputElement>(`input[data-import-door="${door}"]`)!;
  expect(input.multiple, 'the picker takes one at a time').toBe(true);
  await act(async () => {
    Object.defineProperty(input, 'files', { configurable: true, value: files });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('asks a new person once, and Not now is remembered for this profile', async () => {
  world = await mountWorld(FACTS); await settle();
  expect(bubble()).toContain('Saved things in other apps?');
  expect(act_('Photos') && act_('Files') && act_('Not now'), 'the ask has no Photos, Files and Not now').toBeTruthy();
  /* One line only (founder: strip descriptive text; Photos and Files already say what comes in). */
  expect(world.container.querySelector('.jar-char-bubble .jar-char-bubble-of'), 'a second line came back under the ask').toBeNull();
  expect(world.container.querySelector('.waka-home-bar-glyph--lit'), 'the bar\'s photo door is not lit beside the ask').not.toBeNull();
  await act(async () => act_('Not now')!.click()); await settle();
  expect(bubble()).not.toContain('Saved things in other apps?');
  expect(world.container.querySelector('.waka-home-bar-glyph--lit')).toBeNull();
  world.unmount();
  world = await mountWorld(FACTS); await settle();
  expect(bubble(), 'Not now was forgotten on the next visit').not.toContain('Saved things in other apps?');
});

it('makes one save per picked photo, each with its own upload, and lands them all', async () => {
  world = await mountWorld(FACTS); await settle();
  await pick('photos', [photo('a.png'), photo('b.png'), photo('c.png')]);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(bubble()).toContain('Bringing them in');
  await settle(400);
  const saves = vi.mocked(createInspiration).mock.calls;
  expect(saves, 'not one save per photo').toHaveLength(3);
  for (const [input, options] of saves) {
    expect(input.attachments, 'a save carried more than its own photo').toHaveLength(1);
    expect(input).toMatchObject({ text: '', kind: 'image', source: 'app' });
    expect(options).toMatchObject({ profile: VIEWER_ID });
  }
  expect(new Set(saves.map(([input]) => input.attachments![0]!.type === 'image' && input.attachments![0]!.key))).toEqual(new Set(['uploads/a.png', 'uploads/b.png', 'uploads/c.png']));
  expect(vi.mocked(uploadToPresignedUrl)).toHaveBeenCalledTimes(3);
  expect(bubble()).toContain('Reading them now');
  expect(bubble(), 'a count reached the bubble').not.toMatch(/\d/);
  expect(world.container.querySelector('.waka-home-bar-pull')?.textContent, 'the saves did not reach the field').toContain('3 inspirations');
  expect(bubble()).not.toContain('Saved things in other apps?');
});

it('tries a failed upload once more, quietly, then leaves it out and says where the door is', async () => {
  const tries = new Map<string, number>();
  vi.mocked(uploadToPresignedUrl).mockImplementation(async (url: string) => {
    const n = (tries.get(url) ?? 0) + 1; tries.set(url, n);
    if (url.endsWith('broken.png')) throw new Error('Network unreachable while uploading attachment');
    if (url.endsWith('flaky.png') && n === 1) throw new Error('Network unreachable while uploading attachment');
  });
  world = await mountWorld(FACTS); await settle();
  await pick('photos', [photo('fine.png'), photo('broken.png'), photo('flaky.png')]);
  await settle(400);
  expect(tries.get('https://bucket.test/broken.png'), 'the broken one was not tried exactly twice').toBe(2);
  expect(tries.get('https://bucket.test/flaky.png')).toBe(2);
  const kept = vi.mocked(createInspiration).mock.calls.map(([input]) => input.attachments![0]!.type === 'image' && input.attachments![0]!.key);
  expect(kept.sort()).toEqual(['uploads/fine.png', 'uploads/flaky.png']);
  expect(notice(), 'what did not come in was not said').toBe('A few didn’t come in. The photo button can add them again.');
  await act(async () => world!.container.querySelector<HTMLButtonElement>('.waka-home-bar-notice')!.click()); // the notice stands in the pull's place
  expect(world.container.querySelector('.waka-home-bar-pull')?.textContent).toContain('2 inspirations');
});

/* CODE REVIEW, 2026-11-27: with nothing landed the bubble said "Reading them
   now…" over nothing. It goes straight back to its own line, and the bar says
   plainly that none came in, with the door that works. */
it('says plainly that none came in, and never that it is reading them', async () => {
  vi.mocked(uploadToPresignedUrl).mockImplementation(async () => { throw new Error('Network unreachable while uploading attachment'); });
  world = await mountWorld(FACTS); await settle();
  await pick('photos', [photo('one.png'), photo('two.png')]);
  await settle(400);
  expect(vi.mocked(createInspiration)).not.toHaveBeenCalled();
  expect(bubble()).not.toContain('Reading them now');
  expect(notice()).toBe('None of them came in. The photo button can add them again.');
});

it('does not send files to the photo button', async () => {
  vi.mocked(uploadToPresignedUrl).mockImplementation(async () => { throw new Error('Network unreachable while uploading attachment'); });
  world = await mountWorld(FACTS); await settle();
  await pick('files', [new File([new Uint8Array(8)], 'letter.pdf', { type: 'application/pdf' })]);
  await settle(400);
  expect(notice()).toBe('None of them came in.');
});

it('keeps the notice when a hunch takes the bubble, until it is pressed', async () => {
  vi.mocked(uploadToPresignedUrl).mockImplementation(async (url: string) => { if (url.endsWith('broken.png')) throw new Error('Network unreachable'); });
  vi.mocked(fetchHunch).mockImplementation(async () => vi.mocked(createInspiration).mock.calls.length
    ? { id: 'h1', body: 'You keep saving quiet rooms. Am I close?', inspirationIds: [], status: 'pending' as const } : null);
  world = await mountWorld(FACTS); await settle();
  await pick('photos', [photo('fine.png'), photo('broken.png')]);
  await settle(1000);
  expect(bubble(), 'the hunch did not come').toContain('Am I close?');
  expect(notice(), 'the hunch took the notice away').toBe('A few didn’t come in. The photo button can add them again.');
  await act(async () => world!.container.querySelector<HTMLButtonElement>('.waka-home-bar-notice')!.click());
  expect(world.container.querySelector('.waka-home-bar-notice')).toBeNull();
});

/* CODE REVIEW, 2026-11-27: the inputs lived inside the ask, so a pick that
   came back after the ask had gone was lost. They live with the page now. */
it('lands a pick that comes back after the ask has gone', async () => {
  world = await mountWorld(FACTS); await settle();
  expect(world.container.querySelector('.jar-char-bubble input[type="file"]'), 'a picker still lives in the bubble').toBeNull();
  await act(async () => act_('Not now')!.click()); await settle();
  await pick('photos', [photo('late.png')]);
  await settle(400);
  expect(vi.mocked(createInspiration)).toHaveBeenCalledTimes(1);
});

it('waits for the first ask for a hunch before asking for imports', async () => {
  FACTS.inspirations = [{ id: 'river', text: 'Walked home the long way to hear the river.', daysAgo: 1 }];
  let answer!: (value: null) => void;
  vi.mocked(fetchHunch).mockImplementation(() => new Promise(resolve => { answer = resolve; }));
  world = await mountWorld(FACTS); await settle();
  expect(bubble(), 'the ask stood before the hunch was asked for').not.toContain('Saved things in other apps?');
  await act(async () => answer(null)); await settle();
  expect(bubble()).toContain('Saved things in other apps?');
});
