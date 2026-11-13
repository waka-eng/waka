// @vitest-environment jsdom
/**
 * SAVES PAST THE LOADED WINDOW ARE NOT DROPPED (code review, 2026-11-08).
 *
 * The field loads the newest saves; the archive holds the rest. "See all
 * saves" listed only what was loaded (the notepad said "200 inspirations",
 * the list showed 60), and "Why?" dropped a cited save it had not loaded.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` — the three layers, with a
 * read whose cited signal rests on a save outside the loaded window and an
 * archive that says it holds more than it sent — plus the boot verbs of
 * `lib/api` and the canvas (`helpers/canvas-stub`), as `helpers/render-home`
 * does. The page itself is the shipped one.
 */
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, type MountedWorld } from './helpers/render-home';

const FACTS = vi.hoisted(() => ({ inspirations: [{ id: 'near', text: 'A save in the window', daysAgo: 1 }] }));
const ASKED = vi.hoisted(() => ({ far: 0, further: 0 }));
vi.mock('../src/lib/data', async original => {
  const base = dataMockFrom(FACTS);
  return { ...await original<typeof import('../src/lib/data')>(), ...base,
    loadInspirations: async () => ({ ...await base.loadInspirations(), total: 200, short: true }),
    loadInspiration: async (id: string) => {
      if (id !== 'far' && id !== 'further') return base.loadInspiration(id);
      ASKED[id] += 1;
      /* The two land at different times, so the first changes what is
         missing while the second is still in flight. */
      await new Promise(resolve => setTimeout(resolve, id === 'far' ? 5 : 40));
      const text = id === 'far' ? 'An older save, outside the window' : 'Another, older still';
      return { id, preview: text, text, isPublic: false, kind: 'note', source: 'app', category: null,
        capturedMs: 0, updatedMs: 0, attachments: [], reflectionCount: 0, reflections: [], conversationOrigin: null };
    },
    loadSignals: async () => [{ id: 'sig', statement: 'You keep the quiet hours.', status: 'active', inspirationIds: ['near', 'far', 'further'], lastEvidenceMs: 0 }],
    loadTopOfMind: async () => ({ id: 'tom', version: 1, reason: 'initial', createdMs: 0, entries: [{ id: 'lead', type: 'hypothesis', body: 'You guard your quiet hours.',
      belief: null, prompt: null, locked: false, pinned: true, dismissed: false, sortOrder: 0, createdMs: 0,
      citedSignals: [{ id: 'sig', statement: 'You keep the quiet hours.', answered: false, locked: false, contested: false }] }] }),
  };
});
vi.mock('../src/lib/api', async original => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS) }));

let world: MountedWorld | undefined;
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { localStorage.clear(); });
afterEach(() => { world?.unmount(); world = undefined; });
async function settle() { for (let turn = 0; turn < 6; turn += 1) { await world!.step(20); await act(async () => { await Promise.resolve(); }); } }

it('answers Why? with a cited save the field had not loaded', async () => {
  world = await mountWorld(FACTS); await settle();
  const why = [...world.container.querySelectorAll<HTMLButtonElement>('.jar-char-bubble-act')].find(b => b.textContent === 'Why?');
  expect(why, 'the read offers no Why?').toBeTruthy();
  await act(async () => why!.click());
  for (let turn = 0; turn < 6; turn += 1) { await settle(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
  expect([...world.container.querySelectorAll('.waka-says-why-row')].map(row => row.textContent))
    .toEqual(['“A save in the window”', '“An older save, outside the window”', '“Another, older still”']);
});

it('reads each cited save outside the window once, however the answers land', async () => {
  ASKED.far = 0; ASKED.further = 0;
  world = await mountWorld(FACTS);
  for (let turn = 0; turn < 10; turn += 1) { await settle(); await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
  expect(ASKED, 'a read was asked for again while another was in flight').toEqual({ far: 1, further: 1 });
});

it('counts the whole archive on the handle, and opens the archive that pages it in', async () => {
  world = await mountWorld(FACTS); await settle();
  expect(world.container.querySelector('.waka-home-bar-pull')?.textContent?.trim(), 'the pull counts only what was loaded').toBe('200 inspirations');
  await act(async () => world!.container.querySelector<HTMLButtonElement>('.waka-home-bar-pull')!.click()); await settle();
  /* One Saved page (founder, 2026-11-10): the handle goes straight to the
     archive, its labelled way home up and the home bar gone. */
  expect(world.container.querySelector('.waka-stream'), 'a second Saved sheet came up').toBeNull();
  expect(world.container.querySelector('.waka-surface-back')?.getAttribute('aria-label'), 'it did not open the archive').toBe('Close');
  expect(world.container.querySelector('.waka-home-bar'), 'the home bar left the sheet pulled up from it').not.toBeNull();
});
