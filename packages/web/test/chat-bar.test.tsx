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
import { mountWorld, dataMockFrom, apiMockFrom, barShape, chatField, homeBarShape, pressHomeBar, VIEWER_ID, type MountedWorld } from './helpers/render-home';
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
const row = (name: string) => [...world!.container.querySelectorAll<HTMLButtonElement>('.waka-dock .waka-dock-item, .waka-page-back, .waka-home-bar button, .waka-over-new')]
  .find((node) => node.textContent?.trim() === name);

/** A new chat, opened the way a person opens one: the bar's Chat on Now. */
async function aNewChat(): Promise<void> {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  /* The round Chat beside the home bar's pill (design E1) opens a new chat. */
  expect(homeBarShape(world.container), 'Now offers no Chat beside the bar').toContain('Chat');
  await pressHomeBar(world.container, 'Chat'); await settle();
  expect(location.pathname, 'Chat on Now did not open a new chat').toBe('/chat/new');
  await chatField(world.container);
}

/** The chat's note bar, in the order a person meets it: tools, then the act. */
const noteBarShape = () => [...world!.container.querySelectorAll<HTMLElement>('footer.chat-composer [data-note-bar="1"] .waka-note-bar-row button')]
  .map(node => node.getAttribute('aria-label') ?? node.textContent?.trim());

describe('a chat writes into the notepad\'s note bar, and leaves by its "<"', () => {
  /* Founder, 2026-11-08: "make this bottom for chatting feel EXACTLY like
     [the notepad's note bar]. use the same code so it looks identical" —
     and "< on top left should be closing this like how it does for the
     saving. put Past Chats in top right corner instead." */
  it('gives a chat the shared note bar: the words, then photo and file on the left and Send on the right, and no dock', async () => {
    await aNewChat();
    const bar = world!.container.querySelector('footer.chat-composer [data-note-bar="1"]');
    expect(bar, 'the chat does not write into the note bar').toBeTruthy();
    expect(bar!.querySelector(':scope > .chat-input-label textarea'), 'the words are not across the bar').toBeTruthy();
    expect(noteBarShape()).toEqual(['Add photos', 'Add file', 'Send']);
    expect(world!.container.querySelectorAll('.chat-page textarea'), 'more than one message field').toHaveLength(1);
    expect(world!.container.querySelector('nav.waka-dock'), 'a dock stands under the chat').toBeNull();
    expect(bar!.querySelector('[aria-haspopup="menu"]'), 'a ＋ menu came back').toBeNull();
    expect(world!.container.querySelector('header.jar-chat-top, .jar-chat-see-all'), 'the All chats header came back above the chat').toBeNull();
  });

  it('offers the mic in the note bar where the browser can listen', async () => {
    class StubRecognition { start(): void {} stop(): void {} abort(): void {} }
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = StubRecognition;
    try {
      await aNewChat();
      expect(world!.container.querySelector('footer.chat-composer [data-note-bar="1"] button.waka-dock-tool.chat-dictate'), 'the bar has no mic').toBeTruthy();
      expect(noteBarShape()).toEqual(['Speak', 'Add photos', 'Add file', 'Send']);
    } finally {
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    }
  });

  it('sends what is typed when Send is pressed, and Send is a quiet word', async () => {
    await aNewChat();
    const field = await chatField(world!.container);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'What has changed in how I think?');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const send = world!.container.querySelector<HTMLButtonElement>('footer.chat-composer button.chat-send');
    expect(send?.textContent, 'Send is not a word').toBe('Send');
    expect(send!.classList.contains('waka-note-bar-action'), 'Send is not the bar\'s quiet act').toBe(true);
    expect(send!.disabled, 'Send is dim with words in the field').toBe(false);
    await act(async () => send!.click()); await settle();
    expect(createConversation, 'pressing Send sent nothing').toHaveBeenCalledOnce();
    expect(vi.mocked(createConversation).mock.calls[0]![4]).toMatchObject({ content: 'What has changed in how I think?' });
    expect(world!.container.querySelector('.chat-message[data-role="user"]')?.textContent).toContain('What has changed in how I think?');
    expect(location.pathname, 'the chat did not take its id once it was created').toMatch(/^\/chat\/(?!new$)/);
    expect((await chatField(world!.container)).value, 'the field kept what was sent').toBe('');
  });

  it('closes the chat by its "<" and opens the chats list by Past chats, top-right', async () => {
    await aNewChat();
    const back = world!.container.querySelector<HTMLButtonElement>('button.waka-page-back');
    expect(back?.textContent?.trim(), 'the chat\'s "<" is not named for closing').toBe('Close');
    await act(async () => back!.click()); await settle();
    expect(location.pathname, 'the "<" left the chat up').not.toContain('/chat/');
    expect(open(), 'the "<" on a chat went somewhere other than home').toBeNull();
    expect(homeBarShape(world!.container), 'home is not back to the home bar').toEqual(['Write', 'Photo', 'Say it', 'Chat']);
    expect(world!.container.querySelector('.chat-composer'), 'the chat\'s composer outlived the chat').toBeNull();

    await pressHomeBar(world!.container, 'Chat'); await settle();
    const past = world!.container.querySelector<HTMLButtonElement>('button.waka-page-aside');
    expect(past?.textContent?.trim(), 'a chat offers no Past chats').toBe('Past chats');
    await act(async () => past!.click()); await settle();
    expect(location.pathname, 'Past chats left the chat up').not.toContain('/chat/');
    expect(open(), 'Past chats did not open the chats list').toBe('conversations');
  });

  it('returns from history to the same principle-started draft', async () => {
    const principleId='11111111-1111-4111-8111-111111111111';
    world=await mountWorld(FACTS,{initialEntries:[`/chat/new?principle=${principleId}`],routerTools:<RouterTools/>});await settle();
    const field=await chatField(world.container);
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,'Keep this question with its starting point.');
      field.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await act(async()=>world!.container.querySelector<HTMLButtonElement>('button.waka-page-aside')!.click());await settle();
    expect(open()).toBe('conversations');
    await act(async()=>world!.container.querySelector<HTMLButtonElement>('button.waka-page-back')!.click());await settle();
    expect(new URLSearchParams(location.search).get('principle')).toBe(principleId);
    expect((await chatField(world.container)).value).toBe('Keep this question with its starting point.');
  });

  /* THE HOME BAR'S GLYPHS (design E1): each door carries one glyph over its
     word — lines for Write, a picture for Photo, a microphone for Say it —
     decorative and hidden, so each name is still the word alone. The round
     Chat is a glyph with a name, since it has no word beside it. */
  it('draws one hidden glyph over each door\'s word, and names the round Chat', async () => {
    world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
    expect(homeBarShape(world!.container)).toEqual(['Write', 'Photo', 'Say it', 'Chat']);
    for (const [name, kind] of [['Write', 'write'], ['Photo', 'photo'], ['Say it', 'record'], ['Chat', 'bubble']] as const) {
      const button = [...world!.container.querySelectorAll<HTMLButtonElement>('.waka-home-bar-row button')]
        .find(node => (node.textContent?.trim() || node.getAttribute('aria-label')) === name);
      expect(button, `no home bar button reads ${name}`).toBeTruthy();
      const glyphs = button!.querySelectorAll('svg');
      expect(glyphs.length, `${name} carries no single glyph`).toBe(1);
      const glyph = glyphs[0]!;
      expect(glyph.getAttribute('data-home-action-icon')).toBe(kind);
      expect(glyph.getAttribute('aria-hidden')).toBe('true');
      expect(button!.firstElementChild, `the ${kind} glyph is not in front of ${name}`).toBe(glyph);
      if (name !== 'Chat') expect(button!.hasAttribute('aria-label'), `${name} gained an aria-label over its word`).toBe(false);
    }
    await pressHomeBar(world!.container, 'Chat'); await settle();
    expect(world!.container.querySelector('button.waka-page-aside')?.textContent).toBe('Past chats');
  });
});
