// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` and `lib/api` supply the
 * world's layers (`helpers/render-home`'s fixtures), `lib/auth-context` the
 * session, and `lib/api/conversations` returns committed records the way
 * `chat-first-send.test.tsx` does — a created conversation echoing the first
 * message, a reply still pending. `helpers/render-home` and
 * `helpers/canvas-stub` replace canvas/viewport/clock/randomness, but the
 * real world simulation runs. The real world, the real dock and the real
 * `ConversationPanel` render; React Router history runs. No server, provider
 * or account data is used. Appearance is not claimed. */
import { act } from 'react';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, barShape, chatField, pressChatCorner, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { createConversation, fetchConversation, fetchConversationReply, listConversations, type ApiConversation } from '../src/lib/api/conversations';

/**
 * ═══ A CHAT'S BAR IS ITS DOOR, ITS TOOLS AND ITS CLOSE (2026-10-16) ═══
 *
 * Founder, 2026-10-16: "bar becomes All chats │ dictate · ＋ │ Close. The
 * dictate button and ＋ move OUT of the chat box INTO the bar's middle group
 * (the box keeps the text field and Send)." So the bar lends the panel an
 * empty group (`CHAT_TOOLS_SLOT`) and the panel portals its mic and its ＋
 * into it; the field and Send stay on the page. The 2026-10-15 ruling below
 * still holds for the field — the composer did not come back into the bar.
 *
 * The chat-in-the-bar composer was tried and reverted the same day. Founder:
 * "lets just make the bottom be All chats | close and bring back the chat box
 * that used to be there." So on a chat the bar is exactly All chats │ Close —
 * no field, no mic, no Send in it — and the page writes through its own
 * footer composer again, the one the standalone panel always had. What is
 * held here: the bar's exact shape, that the page has its one field with its
 * invitation, that typing there and pressing the page's Send really sends,
 * and that the bar's two words go where they say.
 */
const FACTS = vi.hoisted(() => ({ inspirations: [{ id: 'loaded', text: 'Current inspiration', daysAgo: 1 }], groups: [] }));
const committed = vi.hoisted(() => ({ row: null as ApiConversation | null }));
vi.mock('../src/lib/data', async (original) => ({ ...await original<typeof import('../src/lib/data')>(), ...dataMockFrom(FACTS) }));
vi.mock('../src/lib/api', async (original) => ({ ...await original<typeof import('../src/lib/api')>(), ...apiMockFrom(FACTS) }));
vi.mock('../src/lib/api/conversations', async (original) => ({
  ...await original<typeof import('../src/lib/api/conversations')>(),
  createConversation: vi.fn(), fetchConversation: vi.fn(), fetchConversationReply: vi.fn(), listConversations: vi.fn(),
}));
vi.mock('../src/lib/auth-context', async (original) => {
  const session = { status: 'authenticated', account: { id: 'account-1', email: 'you@example.test' },
    profile: { id: VIEWER_ID, name: 'You', type: 'human' }, profiles: [], refresh: async () => undefined, signOut: async () => undefined };
  return { ...await original<typeof import('../src/lib/auth-context')>(), useOptionalAuth: () => session, useAuth: () => session };
});

let world: MountedWorld | undefined, location: ReturnType<typeof useLocation>;
function RouterTools() { location = useLocation(); return null; }
const open = () => new URLSearchParams(location.search).get('open');

beforeAll(() => { installCanvasStub(); setViewport(1280, 900); (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); committed.row = null;
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.mocked(listConversations).mockImplementation(async (profile) => ({ profileId: profile, conversations: [], generationEnabled: true }));
  vi.mocked(createConversation).mockImplementation(async (profile, id, _signal, _principle, first) => {
    committed.row = { id, profileId: profile, revision: 1, generationEnabled: true, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z',
      messages: [{ id: first!.id, profileId: profile, conversationId: id, position: 1, role: 'user', content: first!.content, createdAt: '2026-10-15T00:00:00Z' }] };
    return structuredClone(committed.row);
  });
  vi.mocked(fetchConversation).mockImplementation(async () => {
    if (!committed.row) throw new Error('no conversation to read');
    return structuredClone(committed.row);
  });
  vi.mocked(fetchConversationReply).mockImplementation(async (profile, id) => ({ profileId: profile, conversationId: id, revision: 1,
    messageId: committed.row!.messages[0]!.id, requestId: '11111111-1111-4111-8111-111111111111', phase: 'pending', canRetry: false,
    retryAfter: null, runAfter: null, failureCode: null, generationEnabled: true }));
});
afterEach(() => { world?.unmount(); world = undefined; vi.clearAllMocks(); vi.useRealTimers(); });

async function settle() {
  for (let turn = 0; turn < 8; turn += 1) { await world!.step(100); await act(async () => { await vi.advanceTimersByTimeAsync(100); }); }
}
const row = (name: string) => [...world!.container.querySelectorAll<HTMLButtonElement>('.waka-dock .waka-dock-item, .waka-page-back, .waka-primary-capture, .waka-over-new')]
  .find((node) => node.textContent?.trim() === name);

/* The home bar (waka-design-brief.md §3c): one field, and no tabs. */
const homeBar = () => world!.container.querySelector<HTMLFormElement>('form.waka-bar[data-primary="true"]');

/** A new chat, opened the way a person opens one: Actions → Past chats → New chat. */
async function aNewChat(): Promise<void> {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  await pressChatCorner(world.container); await settle();
  const chat = row('New chat');
  expect(chat, 'Now offers no Chat in the bar').toBeTruthy();
  await act(async () => chat!.click()); await settle();
  expect(location.pathname, 'Chat on Now did not open a new chat').toBe('/chat/new');
  await chatField(world.container);
}

describe('a chat\'s bar is All chats │ dictate · ＋ │ Close, and the page keeps its own field and Send', () => {
  it('gives a chat the bar All chats │ ＋ │ Close, with nothing to type into in it', async () => {
    await aNewChat();
    expect(barShape(world!.container), 'a chat\'s bar is not its door, its tools, Close').toEqual(['Add photo or file', '│', 'Close']);
    expect(world!.container.querySelectorAll('nav.waka-dock span.waka-dock-sep[aria-hidden="true"]'),
      'the two rules are not hidden from a screen reader').toHaveLength(1);
    const bar = world!.container.querySelector('nav.waka-dock')!;
    expect(bar.querySelector('textarea, .chat-send'), 'the chat\'s field or Send is in the bar again').toBeNull();
    expect(bar.querySelector('#waka-chat-tools.waka-dock-making[role="group"] button.waka-dock-tool[aria-haspopup="menu"]'),
      'the ＋ is not in the bar\'s lent group').toBeTruthy();
    expect(world!.container.querySelector('footer.chat-composer button[aria-haspopup="menu"], footer.chat-composer .chat-dictate'),
      'the ＋ or the mic is still in the page\'s box as well').toBeNull();
    expect(world!.container.querySelector('#waka-chat-composer, .waka-dock-chat'), 'the chat-in-the-bar slot came back').toBeNull();
    expect(world!.container.querySelector('.waka-dock .waka-dock-item[aria-current="page"]'), 'a chat lights a bar row, as if it were the list').toBeNull();
    /* AND NOTHING IN THE CORNER. */
    expect(world!.container.querySelector('header.jar-chat-top, .jar-chat-see-all'), 'the All chats header came back above the chat').toBeNull();
  });

  it('gives the page its own composer, with its invitation and exactly one message field', async () => {
    await aNewChat();
    const field = await chatField(world!.container);
    expect(field.closest('nav.waka-dock'), 'the page\'s field is inside the bar').toBeNull();
    expect(field.placeholder, 'the page\'s field lost its invitation').toBe('What would you like to explore?');
    const footer = world!.container.querySelector('footer.chat-composer');
    expect(footer?.querySelector('button.chat-send')?.getAttribute('aria-label'), 'the page\'s composer has no Send').toBe('Send');
    const named = field.getAttribute('aria-label');
    expect(named, 'the page\'s field has no name to be found by').toBeTruthy();
    expect([...world!.container.querySelectorAll('textarea')].filter((node) => node.getAttribute('aria-label') === named),
      'two message fields on one chat').toHaveLength(1);
    expect(world!.container.textContent, 'the bar\'s old invitation is still on screen').not.toContain('Let’s chat');
  });

  it('offers the mic in the bar, not the page\'s box, where the browser can listen', async () => {
    class StubRecognition { start(): void {} stop(): void {} abort(): void {} }
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = StubRecognition;
    try {
      await aNewChat();
      expect(world!.container.querySelector('nav.waka-dock button.waka-dock-tool.chat-dictate'), 'the bar has no mic').toBeTruthy();
      expect(world!.container.querySelector('footer.chat-composer .chat-dictate'), 'the mic is still in the page\'s box').toBeNull();
      expect(barShape(world!.container)).toEqual(['Speak', 'Add photo or file', '│', 'Close']);
    } finally {
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    }
  });

  it('sends what is typed in the page\'s field when the page\'s Send is pressed', async () => {
    await aNewChat();
    const field = await chatField(world!.container);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'What has changed in how I think?');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const send = world!.container.querySelector<HTMLButtonElement>('footer.chat-composer button.chat-send');
    expect(send, 'the page has no Send').toBeTruthy();
    expect(send!.disabled, 'Send is dim with words in the field').toBe(false);
    await act(async () => send!.click()); await settle();
    expect(createConversation, 'pressing the page\'s Send sent nothing').toHaveBeenCalledOnce();
    expect(vi.mocked(createConversation).mock.calls[0]![4]).toMatchObject({ content: 'What has changed in how I think?' });
    expect(world!.container.querySelector('.chat-message[data-role="user"]')?.textContent).toContain('What has changed in how I think?');
    expect(location.pathname, 'the chat did not take its id once it was created').toMatch(/^\/chat\/(?!new$)/);
    expect((await chatField(world!.container)).value, 'the page\'s field kept what was sent').toBe('');
    expect(barShape(world!.container), 'the bar changed shape once the chat had an id').toEqual(['Add photo or file', '│', 'Close']);
  });

  it('opens the ＋ in the bar as a menu of Add photos and Add file', async () => {
    await aNewChat();
    const plus = world!.container.querySelector<HTMLButtonElement>('nav.waka-dock button[aria-haspopup="menu"]')!;
    await act(async () => plus.click());
    const menu = world!.container.querySelector('nav.waka-dock [role="menu"]');
    expect(menu, 'the ＋ in the bar opened no menu').toBeTruthy();
    expect([...menu!.querySelectorAll('[role="menuitem"]')].map((row) => row.textContent?.trim())).toEqual(['Add photos', 'Add file']);
    expect(document.activeElement, 'the first row did not take focus').toBe(menu!.querySelector('[role="menuitem"]'));
    await act(async () => { menu!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }); await settle();
    expect(world!.container.querySelector('nav.waka-dock [role="menu"]'), 'Escape left the menu open').toBeNull();
    expect(location.pathname, 'Escape on the menu closed the chat under it').toBe('/chat/new');
  });

  it('goes home from a chat on Close, and to the chats list on All chats', async () => {
    await aNewChat();
    const close = world!.container.querySelector<HTMLButtonElement>('nav.waka-dock button.waka-dock-item.waka-dock-item--close');
    expect(close?.textContent?.trim(), 'a chat\'s bar does not end in Close').toBe('Close');
    await act(async () => close!.click()); await settle();
    expect(location.pathname, 'Close left the chat up').not.toContain('/chat/');
    expect(open(), 'Close on a chat went somewhere other than home').toBeNull();
    expect(homeBar(), 'home is not back to its one field').toBeTruthy();
    expect(world!.container.querySelector('nav.waka-dock'), 'home grew a tab bar again').toBeNull();
    expect(world!.container.querySelector('.chat-composer'), 'the chat\'s composer outlived the chat').toBeNull();

    await pressChatCorner(world!.container); await settle();
    await act(async () => row('New chat')!.click()); await settle();
    const allChats = row('All chats');
    expect(allChats, 'a chat offers no way to the chats list').toBeTruthy();
    await act(async () => allChats!.click()); await settle();
    expect(location.pathname, 'All chats left the chat up').not.toContain('/chat/');
    expect(open(), 'All chats did not open the chats list').toBe('conversations');
    /* On the list there are no tabs any more (§3c); the way out is the
       page's own back control, and reached from a chat it leads back there. */
    expect(world!.container.querySelector('nav.waka-dock'), 'the list grew a tab bar again').toBeNull();
    expect(world!.container.querySelector('button.waka-page-back')?.textContent?.trim()).toBe('Back to chat');
  });

  it('returns from history to the same principle-started draft', async () => {
    const principleId='11111111-1111-4111-8111-111111111111';
    world=await mountWorld(FACTS,{initialEntries:[`/chat/new?principle=${principleId}`],routerTools:<RouterTools/>});await settle();
    const field=await chatField(world.container);
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,'Keep this question with its starting point.');
      field.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await act(async()=>row('All chats')!.click());await settle();
    expect(open()).toBe('conversations');
    await act(async()=>world!.container.querySelector<HTMLButtonElement>('button.waka-page-back')!.click());await settle();
    expect(new URLSearchParams(location.search).get('principle')).toBe(principleId);
    expect((await chatField(world.container)).value).toBe('Keep this question with its starting point.');
  });

  /* THE TABS AND THE PILL ARE GONE (waka-design-brief.md §3c). The glyphs
     in front of "Inspiration" and "Chat" (founder, 2026-10-18) went with the
     words they stood in front of. What remains to hold: home's one control is
     the field, its ＋ carries the one hidden plus glyph and is named by its
     label, and the chats list is still reached — from the corner — and still
     answers "All chats" from inside a chat. */
  it('replaces the tabs and the pill with one field, and still reaches the chats', async () => {
    world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
    expect(world!.container.querySelectorAll('[data-primary="true"]'), 'home has more or less than one primary control').toHaveLength(1);
    expect(homeBar(), 'the one primary control is not the home bar').toBeTruthy();
    expect(world!.container.querySelector('nav.waka-dock, .waka-primary-capture, .waka-primary-navigation'), 'a tab or the pill came back').toBeNull();
    const plus = homeBar()!.querySelector<HTMLButtonElement>('button.waka-bar-tool[aria-haspopup="menu"]');
    expect(plus?.getAttribute('aria-label')).toBe('Add a photo, file, or voice');
    const glyphs = plus!.querySelectorAll('svg');
    expect(glyphs).toHaveLength(1);
    expect(glyphs[0]!.getAttribute('data-home-action-icon')).toBe('plus');
    expect(glyphs[0]!.getAttribute('aria-hidden')).toBe('true');
    await pressChatCorner(world!.container); await settle();
    await act(async () => row('New chat')!.click()); await settle();
    expect(row('All chats')?.textContent).toBe('All chats');
  });
});
