// @vitest-environment jsdom
/** WHAT THIS MOCKS, AND WHY (gate G6): `lib/data` and `lib/api` supply the
 * world's layers (`helpers/render-home`'s fixtures), `lib/auth-context` the
 * session, and `lib/api/conversations` returns committed records the way
 * `chat-first-send.test.tsx` does — a created conversation echoing the first
 * message, a reply still pending. `helpers/render-home` and
 * `helpers/canvas-stub` replace canvas/viewport/clock/randomness, but the
 * real world simulation runs. The real world, the real dock, the real
 * `ConversationPanel` and the real portal into the bar render; React Router
 * history runs. No server, provider or account data is used. Appearance is
 * not claimed (the field's width is a stylesheet fact). */
import { act } from 'react';
import { useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { installCanvasStub, setViewport } from './helpers/canvas-stub';
import { mountWorld, dataMockFrom, apiMockFrom, barShape, dockChatField, VIEWER_ID, type MountedWorld } from './helpers/render-home';
import { createConversation, fetchConversation, fetchConversationReply, listConversations, type ApiConversation } from '../src/lib/api/conversations';

/**
 * ═══ A CHAT'S BAR IS THE CHAT'S OWN (2026-10-15) ═══════════════════════
 *
 * Founder: on a chat the bottom bar is "all chats and then the same format
 * but then in the middle would be where the user can ... type something or
 * dictate and then send and then end it with the same | and close." And,
 * of the corners: "never put something on any corners."
 *
 * So inside the world a chat lends its field, its mic and its send to the
 * bar's middle group, and the panel's own footer composer is not drawn. The
 * standalone panel (no bar to lend to) keeps its footer — that is
 * `conversation-panel.test.tsx` and `chat-first-send.test.tsx`, untouched.
 * What is held here is the world's half: the row's exact order, the field's
 * invitation, that typing there and pressing that Send really sends, and
 * that the row's two ends go where they say.
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
const row = (name: string) => [...world!.container.querySelectorAll<HTMLButtonElement>('.waka-dock .waka-dock-item')]
  .find((node) => node.textContent?.trim() === name);

/** A new chat, opened the way a person opens one: the bar's Chat on Now. */
async function aNewChat(): Promise<void> {
  world = await mountWorld(FACTS, { routerTools: <RouterTools /> }); await settle();
  const chat = row('Chat');
  expect(chat, 'Now offers no Chat in the bar').toBeTruthy();
  await act(async () => chat!.click()); await settle();
  expect(location.pathname, 'Chat on Now did not open a new chat').toBe('/chat/new');
  /* The portal target is found after paint; wait for the field to land. */
  await dockChatField(world.container);
}

it('gives a chat the bar All chats │ its field and Send │ Close, with no Inspiration in it', async () => {
  await aNewChat();
  const shape = barShape(world!.container);
  const seps = shape.flatMap((part, at) => (part === '│' ? [at] : []));
  expect(seps, 'a chat\'s bar is not three groups with a rule between each').toHaveLength(2);
  expect(world!.container.querySelectorAll('nav.waka-dock span.waka-dock-sep[aria-hidden="true"]'),
    'the rules are not hidden from a screen reader').toHaveLength(2);
  expect(shape.slice(0, seps[0]), 'the first group is not the chats list\'s door alone').toEqual(['All chats']);
  expect(shape.slice(seps[1]! + 1), 'the last group is not Close alone').toEqual(['Close']);
  /* No dictation in jsdom (no `SpeechRecognition`), so the mic is honestly
     absent here; the field and Send are the middle group. */
  expect(shape.slice(seps[0]! + 1, seps[1]), 'the middle group is not the field and Send').toEqual(['field', 'Send']);
  expect(shape, 'Inspiration is still in the bar on a chat').not.toContain('Inspiration');
  expect(shape, 'the bar still says Chat on a chat').not.toContain('Chat');
  expect(world!.container.querySelector('.waka-dock .waka-dock-item[aria-current="page"]'), 'a chat lights a bar row, as if it were the list').toBeNull();

  /* THE FIELD IS IN THE BAR'S MIDDLE GROUP, AND ONLY THERE. */
  const slot = world!.container.querySelector('nav.waka-dock span#waka-chat-composer.waka-dock-making.waka-dock-chat');
  expect(slot, 'the chat\'s middle group is not the lent slot').toBeTruthy();
  const field = await dockChatField(world!.container);
  expect(field.placeholder, 'the bar\'s field lost its invitation').toBe('Let’s chat');
  expect(slot!.querySelector('button.waka-dock-tool.chat-send')?.getAttribute('aria-label')).toBe('Send');
  expect(world!.container.querySelector('.chat-composer-body'), 'the panel drew its own composer as well as lending one to the bar').toBeNull();
  const named = field.getAttribute('aria-label');
  expect(named, 'the bar\'s field has no name to be found by').toBeTruthy();
  expect([...world!.container.querySelectorAll('textarea')].filter((node) => node.getAttribute('aria-label') === named),
    'two message fields on one chat').toHaveLength(1);
  /* AND NOTHING IN THE CORNER. */
  expect(world!.container.querySelector('header.jar-chat-top, .jar-chat-see-all'), 'the All chats header came back above the chat').toBeNull();
});

it('offers the mic between the field and Send where the browser can listen', async () => {
  class StubRecognition { start(): void {} stop(): void {} abort(): void {} }
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition = StubRecognition;
  try {
    await aNewChat();
    const shape = barShape(world!.container);
    const seps = shape.flatMap((part, at) => (part === '│' ? [at] : []));
    const middle = shape.slice(seps[0]! + 1, seps[1]);
    expect(middle, 'the middle group is not field, mic, Send').toHaveLength(3);
    expect([middle[0], middle[2]]).toEqual(['field', 'Send']);
    expect(world!.container.querySelector('#waka-chat-composer button.waka-dock-tool.chat-dictate [data-home-action-icon="record"]'),
      'the chat\'s mic is not in the bar').toBeTruthy();
  } finally {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  }
});

it('sends what is typed in the bar\'s field when the bar\'s Send is pressed', async () => {
  await aNewChat();
  const field = await dockChatField(world!.container);
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'What has changed in how I think?');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const send = world!.container.querySelector<HTMLButtonElement>('nav.waka-dock #waka-chat-composer button.chat-send');
  expect(send, 'the bar has no Send').toBeTruthy();
  expect(send!.disabled, 'Send is dim with words in the field').toBe(false);
  await act(async () => send!.click()); await settle();
  expect(createConversation, 'pressing the bar\'s Send sent nothing').toHaveBeenCalledOnce();
  expect(vi.mocked(createConversation).mock.calls[0]![4]).toMatchObject({ content: 'What has changed in how I think?' });
  /* The message lands on the page, above the bar — the panel still owns it. */
  expect(world!.container.querySelector('.chat-message[data-role="user"]')?.textContent).toContain('What has changed in how I think?');
  expect(location.pathname, 'the chat did not take its id once it was created').toMatch(/^\/chat\/(?!new$)/);
  expect((await dockChatField(world!.container)).value, 'the bar\'s field kept what was sent').toBe('');
});

it('goes home from a chat on Close, and to the chats list on All chats', async () => {
  await aNewChat();
  const close = world!.container.querySelector<HTMLButtonElement>('nav.waka-dock button.waka-dock-item.waka-dock-item--close');
  expect(close?.textContent?.trim(), 'a chat\'s bar does not end in Close').toBe('Close');
  await act(async () => close!.click()); await settle();
  expect(location.pathname, 'Close left the chat up').not.toContain('/chat/');
  expect(open(), 'Close on a chat went somewhere other than home').toBeNull();
  expect(barShape(world!.container), 'home is not back to the two words').toEqual(['Inspiration', 'Chat']);
  expect(world!.container.querySelector('#waka-chat-composer'), 'the chat\'s slot outlived the chat').toBeNull();

  await act(async () => row('Chat')!.click()); await settle();
  const allChats = row('All chats');
  expect(allChats, 'a chat offers no way to the chats list').toBeTruthy();
  await act(async () => allChats!.click()); await settle();
  expect(location.pathname, 'All chats left the chat up').not.toContain('/chat/');
  expect(open(), 'All chats did not open the chats list').toBe('conversations');
  /* On the list the bar is the two words again, and Chat is lit there. */
  expect(barShape(world!.container)).toEqual(['Inspiration', 'Chat']);
  expect(world!.container.querySelector('.waka-dock .waka-dock-item[aria-current="page"]')?.textContent?.trim()).toBe('Chat');
});
