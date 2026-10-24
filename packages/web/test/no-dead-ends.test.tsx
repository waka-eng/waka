// @vitest-environment jsdom
/**
 * EVERY STATE A LIST CAN BE IN HAS A WAY ON.
 *
 * An audit at f2afcbe2 walked the chat list into its unlucky states and found
 * two that were sentences with nothing under them: the list that could not
 * load ("Couldn't load your conversation list." — and only leaving could
 * change it), and the empty list asking "What would you like to explore?"
 * over a page with nowhere to type. A state with no control in it is a dead
 * end however true its sentence is.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 *   `lib/api/conversations` — the one list read the overlay makes on mount,
 *   and the delete it can make from a row. It is the layer directly beneath
 *   this component: the overlay calls its read and renders what comes back,
 *   with no fixture fallback in between, so a wrong mock renders the wrong
 *   state and a red test rather than a green one describing something else.
 *
 * The real `DialogSurface`, the real catalogs and the real class contract run.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConversationsOverlay } from "../src/components/ConversationsOverlay";
import { deleteConversation, listConversations } from "../src/lib/api/conversations";

vi.mock("../src/lib/api/conversations", () => ({ listConversations: vi.fn(), deleteConversation: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function show(node: JSX.Element): Promise<void> {
  await act(async () => root.render(node));
  await act(async () => undefined);
}

const press = async (label: string): Promise<void> => {
  const button = [...host.querySelectorAll("button")].find((node) => node.textContent === label);
  if (!button) throw new Error(`no "${label}" on screen: ${host.textContent}`);
  await act(async () => button.click());
  await act(async () => undefined);
};

describe("the chat list", () => {
  it("offers Try again when the list could not load, and reads it again", async () => {
    vi.mocked(listConversations).mockRejectedValueOnce(new Error("down"))
      .mockResolvedValue({ conversations: [] } as never);
    await show(
      <ConversationsOverlay locale="en-US" profileId="profile-1" title="Chats"
        onClose={() => undefined} onOpen={() => undefined} />,
    );
    expect(host.textContent).toContain("Couldn’t load your conversation list.");
    await press("Try again");
    expect(listConversations).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("Couldn’t load your conversation list.");
  });

  it("makes the empty list's question a door into a new chat", async () => {
    vi.mocked(listConversations).mockResolvedValue({ conversations: [] } as never);
    const open = vi.fn();
    await show(
      <ConversationsOverlay locale="en-US" profileId="profile-1" title="Chats"
        onClose={() => undefined} onOpen={open} />,
    );
    expect(host.textContent).toContain("What would you like to explore?");
    await press("New chat");
    expect(open).toHaveBeenCalledWith(null);
  });
});


it('offers a new chat from a populated list and explains deletion before sending it', async () => {
  vi.mocked(listConversations).mockResolvedValue({ conversations: [{
    id: 'chat-1', profileId: 'profile-1', revision: 1,
    updatedAt: '2026-10-23T12:00:00Z', preview: 'A question worth keeping',
  }] } as never);
  const open = vi.fn();
  await show(<ConversationsOverlay locale="en-US" profileId="profile-1" title="Chats" onClose={() => undefined} onOpen={open} />);
  await press('New chat');
  expect(open).toHaveBeenCalledWith(null);
  await press('Delete');
  expect(host.textContent).toContain('Delete this chat? You won’t be able to reopen it.');
  expect(deleteConversation).not.toHaveBeenCalled();
  await press('Not now');
  expect(host.textContent).not.toContain('Delete this chat?');
  expect(host.textContent).toContain('A question worth keeping');
  vi.mocked(deleteConversation).mockRejectedValueOnce(new Error('offline'));
  await press('Delete');
  await press('Delete chat');
  expect(deleteConversation).toHaveBeenCalledWith('profile-1', 'chat-1');
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('it is still here');
  expect(host.textContent).toContain('A question worth keeping');
  vi.mocked(deleteConversation).mockResolvedValueOnce(undefined);
  await press('Delete chat');
  expect(host.textContent).not.toContain('A question worth keeping');
  expect(host.querySelectorAll('.waka-over-new')).toHaveLength(1);
});
