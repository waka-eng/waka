// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` and `lib/api` supply the
 * world's layers (`helpers/render-home`'s fixtures), `lib/auth-context` the
 * session, and `lib/api/conversations` one committed conversation, listed and
 * readable. `helpers/render-home` and `helpers/canvas-stub` replace canvas,
 * viewport and clock; the real world, Past chats and the chat page render, and
 * React Router history runs.
 *
 * A CHAT'S "<" CLOSES IT, AND A CHAT OPENED FROM PAST CHATS CLOSES BACK TO
 * PAST CHATS (code review, 2026-11-09). Founder: "< on top left should be
 * closing this like how it does for the saving": the notepad's "<" on a note
 * opened from the list returns to the list, so a chat's does the same; a chat
 * opened any other way closes to home. */
import { act } from 'react';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, pressHomeBar, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { fetchConversation, listConversations, type ApiConversation } from '../src/lib/api/conversations';

const FACTS = vi.hoisted(() => ({ inspirations: [{ id: 'loaded', text: 'Current inspiration', daysAgo: 1 }] }));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS) }));
vi.mock('../src/lib/api/conversations', async (original) => ({
  ...await original<typeof import('../src/lib/api/conversations')>(), fetchConversation: vi.fn(), listConversations: vi.fn(),
}));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

const CHAT = '22222222-2222-4222-8222-222222222222';
let world: MountedWorld | undefined, location: ReturnType<typeof useLocation>;
function RouterTools() { location = useLocation(); return null; }
const open = () => new URLSearchParams(location.search).get('open');
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const row: ApiConversation = { id: CHAT, profileId: VIEWER_ID, revision: 1, generationEnabled: true, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z',
    messages: [{ id: '33333333-3333-4333-8333-333333333333', profileId: VIEWER_ID, conversationId: CHAT, position: 1, role: 'user', content: 'An earlier chat', createdAt: '2026-10-15T00:00:00Z' }] };
  vi.mocked(listConversations).mockImplementation(async (profile) => ({ profileId: profile, generationEnabled: true,
    conversations: [{ id: CHAT, profileId: profile, revision: 1, updatedAt: '2026-10-15T00:00:00Z', preview: 'An earlier chat' }] } as Awaited<ReturnType<typeof listConversations>>));
  vi.mocked(fetchConversation).mockImplementation(async () => structuredClone(row));
});
afterEach(() => { world?.unmount(); world = undefined; vi.clearAllMocks(); vi.useRealTimers(); });
async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world!.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
const back = () => world!.container.querySelector<HTMLButtonElement>('button.waka-page-back');

it('closes a chat opened from Past chats back to Past chats, and one opened from home to home', async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await pressHomeBar(world.container, 'Chat'); await settle();
  await act(async () => world!.container.querySelector<HTMLButtonElement>('button.waka-page-aside')!.click()); await settle();
  expect(open()).toBe('conversations');
  const earlier = [...world.container.querySelectorAll<HTMLButtonElement>('.waka-list-row')].find(b => b.textContent?.includes('An earlier chat'));
  expect(earlier, 'Past chats lists no earlier chat').toBeTruthy();
  await act(async () => earlier!.click()); await settle();
  expect(location.pathname).toBe(`/chat/${CHAT}`);

  await act(async () => back()!.click()); await settle();
  expect(location.pathname, 'the "<" left the chat up').not.toContain('/chat/');
  expect(open(), 'a chat opened from Past chats did not close back to it').toBe('conversations');

  /* Home from the list, then a chat from home: its "<" goes home. */
  await act(async () => back()!.click()); await settle();
  expect(open()).toBeNull();
  await pressHomeBar(world.container, 'Chat'); await settle();
  await act(async () => back()!.click()); await settle();
  expect(location.pathname).not.toContain('/chat/');
  expect(open(), 'a chat opened from home did not close to home').toBeNull();
});
