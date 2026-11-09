// @vitest-environment jsdom
/**
 * "KEPT" STAYS LONG ENOUGH TO USE (design E4; code review, 2026-11-08).
 *
 * The bubble's longer stay was keyed to "I'm inspired!", a line nothing says
 * any more, so "Kept" — with Talk about it, See all and a screenshot's words —
 * went after the four seconds every whisper gets, and the words' read was
 * abandoned before the server could land it.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` (the three layers, the seam
 * `render-home` names), `lib/api`'s save and the verbs a mounted world asks
 * for on boot, principles and the conversation list — the world outside the
 * page. The page, its timers and the save pipeline are the shipped ones.
 */
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, pressHomeBar, type MountedWorld } from './helpers/render-home';
import { bubbleStayMs, KEPT_STAY_MS, KEPT_WORDS_CAP_MS, LINE_STAY_MS } from '../src/lib/kept-bubble';
import { ApiError } from '../src/lib/api';
import { IDBFactory } from 'fake-indexeddb';

const FACTS = vi.hoisted(() => ({ inspirations: [{ id: 'kept', text: 'Something I kept', daysAgo: 1 }] }));
vi.mock('../src/lib/data', async original => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async original => ({
  ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS),
  createInspiration: vi.fn(async (input: { text: string }) => ({ id: 'new-save', profileId: 'profile-viewer', text: input.text, kind: 'note', source: 'app',
    visibility: 'private', attachments: [], reflections: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })),
  fetchInspirationSaveRequest: vi.fn(async () => { const { ApiError: E } = await import('../src/lib/api/http'); throw new E({ status: 404, code: 'save_not_found', message: 'Not saved yet' }); }),
  fetchPrinciples: vi.fn(async () => []),
  fetchTheWeather: vi.fn(async () => ({ told: null, antechamber: [], days: [] })),
}));
vi.mock('../src/lib/auth-context', async original => {
  const session = { status: 'authenticated', account: { id: 'kept-owner', email: 'kept@example.test' },
    profile: { id: 'profile-viewer', name: 'Owner', type: 'human' }, profiles: [], refresh: async () => {}, signOut: async () => {} };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});
vi.mock('../src/lib/api/principles', async original => ({ ...await original<typeof import('../src/lib/api/principles')>(),
  fetchPrincipleRead: vi.fn(async () => ({ principles: [], status: { phase: 'ready', eligible: false } })) }));
vi.mock('../src/lib/api/conversations', async original => ({ ...await original<typeof import('../src/lib/api/conversations')>(),
  listConversations: vi.fn(async (profileId: string) => ({ profileId, conversations: [], generationEnabled: false })) }));

void ApiError;
let world: MountedWorld | undefined;
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); localStorage.clear(); sessionStorage.clear(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { world?.unmount(); world = undefined; vi.useRealTimers(); vi.unstubAllGlobals(); });
async function settle(ms = 100, turns = 8) { for (let turn = 0; turn < turns; turn += 1) { await world!.step(4); await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); } }
const bubble = () => [...world!.container.querySelectorAll('.jar-char-bubble .jar-char-bubble-reading')].map(n => n.textContent?.trim()).join(' | ');

describe('how long the bubble stays', () => {
  it('gives a whisper four seconds and "Kept" eight', () => {
    expect(bubbleStayMs({ kept: false, waitingForWords: false, elapsedMs: 0 })).toBe(LINE_STAY_MS);
    expect(bubbleStayMs({ kept: true, waitingForWords: false, elapsedMs: 0 })).toBe(KEPT_STAY_MS);
  });
  it('waits for a screenshot\'s words up to the cap, then gives them four seconds', () => {
    expect(bubbleStayMs({ kept: true, waitingForWords: true, elapsedMs: 5_000 })).toBe(KEPT_WORDS_CAP_MS - 5_000);
    expect(bubbleStayMs({ kept: true, waitingForWords: true, elapsedMs: KEPT_WORDS_CAP_MS + 1 })).toBe(0);
    expect(bubbleStayMs({ kept: true, waitingForWords: false, elapsedMs: 20_000 })).toBe(LINE_STAY_MS);
  });
});

it('keeps "Kept" up past the four seconds a whisper gets, and lets it go after its own stay', async () => {
  world = await mountWorld(FACTS); await settle();
  await pressHomeBar(world.container, 'Write'); await settle();
  const field = world.container.querySelector<HTMLTextAreaElement>('textarea.jar-composer-text')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'Glued the chair myself.');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle();
  await act(async () => world!.container.querySelector<HTMLButtonElement>('.waka-dock-save')!.click());
  await settle(50, 6);
  expect(bubble(), 'the save did not answer with Kept').toContain('Kept');
  await settle(500, 10); // five seconds on
  expect(bubble(), '"Kept" went with the whispers, at four seconds').toContain('Kept');
  await settle(500, 8); // nine seconds on
  expect(bubble(), '"Kept" never left').not.toContain('Kept');
});
