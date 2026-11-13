// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` and `lib/api` supply the
 * world's layers (`helpers/render-home`'s fixtures), `lib/auth-context` the
 * session, and `lib/api/conversations` one committed conversation, listed and
 * readable. `helpers/render-home` and `helpers/canvas-stub` replace canvas,
 * viewport and clock; the real world, Past chats and the chat page render, and
 * React Router history runs.
 *
 * A CHAT'S "<" CLOSES IT, AND SO DOES PAST CHATS', home both times, however
 * the two were reached from each other (founder, 2026-11-12). */
import { act } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, pressHomeBar, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { createConversation, fetchConversation, listConversations, type ApiConversation } from '../src/lib/api/conversations';

const FACTS = vi.hoisted(() => ({ inspirations: [{ id: 'loaded', text: 'Current inspiration', daysAgo: 1 }] }));
/* A reading on home, so the creature's bubble carries its "Chat about this". */
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS),
  loadTopOfMind: async () => ({ id: 'tom', version: 1, reason: 'initial', createdMs: 0, entries: [{ id: 'lead', type: 'hypothesis', body: 'You guard your quiet hours.',
    belief: null, prompt: null, locked: false, pinned: true, dismissed: false, sortOrder: 0, createdMs: 0, citedSignals: [] }] }) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS) }));
vi.mock('../src/lib/api/conversations', async (original) => ({
  ...await original<typeof import('../src/lib/api/conversations')>(), fetchConversation: vi.fn(), listConversations: vi.fn(), createConversation: vi.fn(),
}));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

const CHAT = '22222222-2222-4222-8222-222222222222';
let world: MountedWorld | undefined, location: ReturnType<typeof useLocation>;
let go: ReturnType<typeof useNavigate>;
function RouterTools() { location = useLocation(); go = useNavigate(); return null; }
const open = () => new URLSearchParams(location.search).get('open');
beforeAll(() => { installCanvasStub(); setViewport(390, 844); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const row: ApiConversation = { id: CHAT, profileId: VIEWER_ID, revision: 1, generationEnabled: true, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z',
    messages: [{ id: '33333333-3333-4333-8333-333333333333', profileId: VIEWER_ID, conversationId: CHAT, position: 1, role: 'user', content: 'An earlier chat', createdAt: '2026-10-15T00:00:00Z' }] };
  vi.mocked(listConversations).mockImplementation(async (profile) => ({ profileId: profile, generationEnabled: true,
    /* Two, so a chat open from the list still has another to go to (a chat
       with no other offers no Past chats). */
    conversations: [{ id: CHAT, profileId: profile, revision: 1, updatedAt: '2026-10-15T00:00:00Z', preview: 'An earlier chat' },
      { id: '44444444-4444-4444-8444-444444444444', profileId: profile, revision: 1, updatedAt: '2026-10-14T00:00:00Z', preview: 'Another chat' }] } as Awaited<ReturnType<typeof listConversations>>));
  vi.mocked(fetchConversation).mockImplementation(async (_profile, id) => structuredClone(id === CHAT ? row : { ...row, id }));
  vi.mocked(createConversation).mockImplementation(async (profile, id) => ({ ...structuredClone(row), id, profileId: profile }));
});
afterEach(() => { world?.unmount(); world = undefined; vi.clearAllMocks(); vi.useRealTimers(); });
async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world!.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
const back = () => world!.container.querySelector<HTMLButtonElement>('.waka-surface-back');
/* Its accessible name: the "<" is drawn alone and says its word to a screen reader. */
const backName = () => back()?.getAttribute('aria-label') ?? back()?.textContent?.trim();

/* "<" IS ALWAYS HOME (founder, 2026-11-12): "if the user clicked on new
   chat, past chat, and then new chat, past chat ... regardless how many
   times you do that the back button should always go back to home." A chat
   opened from Past chats, and Past chats opened from a chat, both close
   home; neither is a "Back" to the other. */
it('closes home from a chat and from Past chats, however many times they were swapped', async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await pressHomeBar(world.container, 'Chat'); await settle();
  for (let round = 0; round < 2; round += 1) {
    await act(async () => world!.container.querySelector<HTMLButtonElement>('.waka-surface-right .waka-surface-act')!.click()); await settle();
    expect(open()).toBe('conversations');
    expect(backName(), 'Past chats from a chat is not named for closing').toBe('Close');
    const earlier = [...world.container.querySelectorAll<HTMLButtonElement>('.waka-list-row')].find(b => b.textContent?.includes('An earlier chat'));
    expect(earlier, 'Past chats lists no earlier chat').toBeTruthy();
    await act(async () => earlier!.click()); await settle();
    expect(location.pathname).toBe(`/chat/${CHAT}`);
    expect(backName(), 'a chat from Past chats is not named for closing').toBe('Close');
  }
  await act(async () => back()!.click()); await settle();
  expect(location.pathname, 'the "<" left the chat up').not.toContain('/chat/');
  expect(open(), 'the "<" went somewhere other than home').toBeNull();
});

/* WHAT YOU CHAT ABOUT COMES FROM WAKA'S SIDE (founder, 2026-11-12): the
   read's "Chat about this" opens a chat whose first turn is WAKA saying the
   read, on the left; nothing is sent as you, and no chat is made until you
   reply. */
it('opens a read\'s chat on WAKA saying it, not on you sending it', async () => {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  const talk = [...world.container.querySelectorAll<HTMLButtonElement>('.jar-char-bubble-act')].find(b => b.textContent?.trim() === 'Chat about this');
  expect(talk, 'the bubble offers no Chat about this').toBeTruthy();
  await act(async () => talk!.click()); await settle();
  expect(location.pathname).toBe('/chat/new');
  const first = world.container.querySelector('.chat-message');
  expect(first?.getAttribute('data-role'), 'the read came from your side').toBe('assistant');
  expect(first?.textContent).toContain('You guard your quiet hours.');
  expect(createConversation, 'a chat was made before you replied').not.toHaveBeenCalled();
});
