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
  /* One earlier chat, so a chat has somewhere for Past chats to go; a first
     chat has none (see "offers no Past chats on a first chat"). */
  vi.mocked(listConversations).mockImplementation(async (profile) => ({ profileId: profile, conversations: [{ id: 'earlier', profileId: profile, revision: 1, preview: 'An earlier chat', updatedAt: '2026-11-01T00:00:00Z' } as never], generationEnabled: true }));
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
const row = (name: string) => [...world!.container.querySelectorAll<HTMLButtonElement>('.waka-dock .waka-dock-item, .waka-surface-back, .waka-home-bar button, .waka-over-new')]
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
  it('offers no Past chats on a first chat (founder, 2026-11-10)', async () => {
    vi.mocked(listConversations).mockImplementation(async (profile) => ({ profileId: profile, conversations: [], generationEnabled: true }));
    await aNewChat(); await settle();
    expect(world!.container.querySelector('.waka-surface-right .waka-surface-act'), 'a first chat offers Past chats').toBeNull();
  });

  it('gives a chat the shared note bar: the words, then photo and file on the left and Send on the right, and no dock', async () => {
    await aNewChat();
    const bar = world!.container.querySelector('footer.chat-composer [data-note-bar="1"]');
    expect(bar, 'the chat does not write into the note bar').toBeTruthy();
    /* TWO LINES (founder, 2026-11-10: "put the logos at the second line"):
       the words across the top, then a row of tools and Send under them. */
    expect(bar!.querySelector(':scope > .waka-note-bar-field > .chat-input-label textarea'), 'the words are not the first line').toBeTruthy();
    const row = [...bar!.querySelector('.waka-note-bar-row')!.children].map(node => node.className);
    expect(row, 'the second line is not tools, then Send').toEqual(['waka-note-bar-tools', expect.stringContaining('waka-note-bar-action')]);
    expect(noteBarShape()).toEqual(['Add photo', 'Add file', 'Send']);
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
      expect(noteBarShape()).toEqual(['Your voice', 'Add photo', 'Add file', 'Send']);
    } finally {
      delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
    }
  });

  /* FOCUS FOLLOWS THE LISTENING VIEW, ON A PHONE TOO (review, 2026-11-09):
     the mic is gone while listening, so Done holds focus; after, the mic has
     it again (a phone's field does not autofocus, so nothing else will). */
  it('hands focus to Done while listening and back to the mic after, on a phone', async () => {
    class StubRecognition { onend: (() => void) | null = null; start(): void {} stop(): void { this.onend?.(); } abort(): void {} }
    (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = StubRecognition;
    const wide = window.matchMedia;
    const phone = (query: string) => ({ matches: query.includes('max-width'), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false });
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: phone });
    try {
      await aNewChat();
      const mic = () => world!.container.querySelector<HTMLButtonElement>('button.chat-dictate')!;
      await act(async () => { mic().focus(); mic().click(); }); await settle();
      const done = world!.container.querySelector<HTMLButtonElement>('.waka-listening-done');
      expect(document.activeElement, 'focus fell out of the listening view').toBe(done);
      await act(async () => done!.click()); await settle();
      expect(document.activeElement, 'focus did not come back to the mic').toBe(mic());
    } finally {
      Object.defineProperty(window, 'matchMedia', { configurable: true, value: wide });
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
    const back = world!.container.querySelector<HTMLButtonElement>('.waka-surface-back');
    expect(back?.textContent?.trim(), 'the chat\'s "<" is not named for closing').toBe('Close');
    await act(async () => back!.click()); await settle();
    expect(location.pathname, 'the "<" left the chat up').not.toContain('/chat/');
    expect(open(), 'the "<" on a chat went somewhere other than home').toBeNull();
    expect(homeBarShape(world!.container), 'home is not back to the home bar').toEqual(['Save an inspiration', 'Save a screenshot', 'Save your voice', 'Chat']);
    expect(world!.container.querySelector('.chat-composer'), 'the chat\'s composer outlived the chat').toBeNull();

    await pressHomeBar(world!.container, 'Chat'); await settle();
    const past = world!.container.querySelector<HTMLButtonElement>('.waka-surface-right .waka-surface-act');
    expect(past?.textContent?.trim(), 'a chat offers no Past chats').toBe('Past chats');
    await act(async () => past!.click()); await settle();
    expect(location.pathname, 'Past chats left the chat up').not.toContain('/chat/');
    expect(open(), 'Past chats did not open the chats list').toBe('conversations');
    /* The same header and the same bar (founder, 2026-11-10): Past chats has
       the chat's bar at its foot, it does not fade in from the chat, and a
       press on the bar's field starts a new chat. */
    const list = world!.container.querySelector<HTMLElement>('.waka-over--chats')!;
    expect(list.getAttribute('data-motion'), 'Past chats faded in from a chat').toBeNull();
    const field = list.querySelector<HTMLButtonElement>('.waka-over-foot [data-note-bar] .waka-over-foot-field');
    expect(field?.textContent).toBe('What’s on your mind?');
    await act(async () => field!.click()); await settle();
    expect(location.pathname, 'the bar did not start a new chat').toContain('/chat/new');
  });

  it('returns from history to the same principle-started draft', async () => {
    const principleId='11111111-1111-4111-8111-111111111111';
    world=await mountWorld(FACTS,{initialEntries:[`/chat/new?principle=${principleId}`],routerTools:<RouterTools/>});await settle();
    const field=await chatField(world.container);
    await act(async()=>{
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(field,'Keep this question with its starting point.');
      field.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await act(async()=>world!.container.querySelector<HTMLButtonElement>('.waka-surface-right .waka-surface-act')!.click());await settle();
    expect(open()).toBe('conversations');
    await act(async()=>world!.container.querySelector<HTMLButtonElement>('.waka-surface-back')!.click());await settle();
    expect(new URLSearchParams(location.search).get('principle')).toBe(principleId);
    expect((await chatField(world.container)).value).toBe('Keep this question with its starting point.');
  });

  /* THE HOME BAR'S PILL (2026-11-09): "Save an inspiration…" is words alone,
     the picture and the mic are glyphs alone, decorative and hidden, so each
     is named by its whole act (and titled with it, for a pointer). The round
     Chat is a glyph with a name. */
  it('reads "Save an inspiration" then a hidden picture and mic glyph, and names the round Chat', async () => {
    world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
    expect(homeBarShape(world!.container)).toEqual(['Save an inspiration', 'Save a screenshot', 'Save your voice', 'Chat']);
    const named = (name: string) => [...world!.container.querySelectorAll<HTMLButtonElement>('.waka-home-bar-row button')]
      .find(node => (node.getAttribute('aria-label') || node.textContent?.trim()) === name);
    /* The visible words begin with the name, so speech input by the
       visible words still lands. */
    const thought = named('Save an inspiration');
    expect(thought, 'no home bar button reads Save an inspiration').toBeTruthy();
    expect(thought!.textContent!.trim()).toBe('Save an inspiration');
    expect(thought!.querySelector('svg'), 'Save an inspiration carries a glyph').toBeNull();
    for (const [name, kind] of [['Save a screenshot', 'photo'], ['Save your voice', 'record'], ['Chat', 'bubble']] as const) {
      const button = named(name);
      expect(button, `no home bar button reads ${name}`).toBeTruthy();
      const glyphs = button!.querySelectorAll('svg');
      expect(glyphs.length, `${name} carries no single glyph`).toBe(1);
      const glyph = glyphs[0]!;
      expect(glyph.getAttribute('data-home-action-icon')).toBe(kind);
      expect(glyph.getAttribute('aria-hidden')).toBe('true');
      expect(button!.textContent!.trim(), `${name} shows words beside its glyph`).toBe('');
      if (name !== 'Chat') expect(button!.getAttribute('title'), `${name} has no tooltip`).toBe(name);
    }
    await pressHomeBar(world!.container, 'Chat'); await settle();
    expect(world!.container.querySelector('.waka-surface-right .waka-surface-act')?.textContent).toBe('Past chats');
  });
});
