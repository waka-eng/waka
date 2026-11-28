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
import { createInspiration, presignAttachment, uploadToPresignedUrl } from '../src/lib/api';

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
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
});
afterEach(() => { world?.unmount(); world = undefined; vi.useRealTimers(); });
async function settle(ms = 100) { for (let turn = 0; turn < 8; turn += 1) { await world!.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); } }
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
  expect(bubble()).toContain('A few didn’t come in. The photo button can add them again.');
  expect(world.container.querySelector('.waka-home-bar-pull')?.textContent).toContain('2 inspirations');
});
