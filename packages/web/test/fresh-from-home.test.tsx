// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/api` and `lib/data` supply an
 * empty owned archive; `lib/auth-context` identifies the viewer;
 * `lib/inspiration-photo` keeps the real photo check but makes it slow
 * (150ms), which is the window the race needs. fake-indexeddb replaces
 * `indexedDB`; `Blob` uses cloneable Node bytes. `helpers/canvas-stub` and
 * `helpers/render-home` replace drawing and time, not the draft store.
 *
 * A SCREENSHOT FROM HOME IS A FRESH NOTE, EVEN WHEN THE CHECK IS SLOW (code
 * review, 2026-11-09). The press sets the waiting draft aside and starts a
 * blank one, but the notepad opens a commit later; in that gap the blank
 * draft read as "nothing on the page" and `resumeLatest` brought the old
 * draft back, so the screenshot was appended to yesterday's words. */
import { act } from 'react';
import { Blob } from 'node:buffer';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { apiMockFrom, dataMockFrom, mountWorld, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { newInspirationDraft, writeInspirationDraft } from '../src/lib/inspiration-draft-store';

const facts = vi.hoisted(() => ({ inspirations: [] }));
vi.mock('../src/lib/data', async original => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(facts) }));
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(facts) }));
vi.mock('../src/lib/auth-context', async original => {
  const session = { status: 'authenticated', account: { id: 'fresh-owner', email: 'fresh@example.test' },
    profile: { id: VIEWER_ID, name: 'Owner', type: 'human' }, profiles: [], refresh: async () => {}, signOut: async () => {} };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});
vi.mock('../src/lib/inspiration-photo', async original => {
  const actual = await original<typeof import('../src/lib/inspiration-photo')>();
  return { ...actual, inspectInspirationPhoto: async (file: File) => { await new Promise(resolve => setTimeout(resolve, 150)); return file; } };
});

const scope = { accountId: 'fresh-owner', profileId: VIEWER_ID };
let world: MountedWorld | undefined;
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('Blob', Blob); localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { world?.unmount(); world = undefined; vi.unstubAllGlobals(); });

it('keeps a screenshot from home on a blank note, never in the draft set aside, however slow its check', async () => {
  await writeInspirationDraft(scope, { ...newInspirationDraft(), revision: 1, text: 'Yesterday\'s half thought.' }, 0);
  world = await mountWorld(facts);
  const picker = () => world!.container.querySelector<HTMLInputElement>('.waka-home-bar input[type="file"]');
  await vi.waitFor(async () => { await act(async () => {}); expect(picker()).toBeTruthy(); });
  /* let home take up the waiting draft first, as it does on arrival */
  for (let turn = 0; turn < 10; turn += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const shot = new File([new Uint8Array([137, 80, 78, 71])], 'shot.png', { type: 'image/png' });
  await act(async () => {
    Object.defineProperty(picker()!, 'files', { configurable: true, value: [shot] });
    picker()!.dispatchEvent(new Event('change', { bubbles: true }));
  });
  for (let turn = 0; turn < 40; turn += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  const field = world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text');
  expect(field, 'the notepad did not open for the screenshot').toBeTruthy();
  expect(world.container.querySelector('.waka-note-hero, .jar-composer-tile, img'), 'the screenshot did not reach the note').toBeTruthy();
  expect(field!.value, 'the screenshot landed in the draft that was set aside').toBe('');
});
