// @vitest-environment jsdom

/**
 * The room's settings, and telling a room name from a join code.
 *
 * Two things worth pinning. Settings act on the room you are standing in, so
 * they live on the wall rather than in the switcher — changing rooms should
 * never mean passing over a control that destroys one. And destroying a board
 * other people read takes two deliberate acts, while a member who does not own
 * the room is never offered the option at all.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoomTitle, type RoomTitleProps } from "../src/components/RoomTitle";
import { MINE_BOARD_ID, looksLikeInvite } from "../src/components/rooms";
import type { ApiGroupSummary } from "../src/lib/api";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const mine: ApiGroupSummary = {
  id: MINE_BOARD_ID,
  name: "Mine",
  role: "owner",
  joinCode: "",
  memberCount: 1,
  createdAt: "",
};

const ownedRoom: ApiGroupSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "studio",
  role: "owner",
  joinCode: "ABCD2345",
  memberCount: 3,
  createdAt: "2026-07-01T00:00:00.000Z",
};

const joinedRoom: ApiGroupSummary = {
  ...ownedRoom,
  id: "22222222-2222-4222-8222-222222222222",
  name: "salon",
  role: "member",
};

async function renderRoomTitle(overrides: Partial<RoomTitleProps> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const props: RoomTitleProps = {
    title: "studio",
    members: [],
    faceColor: () => "#000",
    faceInitials: (n) => n.slice(0, 1),
    ...overrides,
  };
  await act(async () => {
    root?.render(createElement(RoomTitle, props));
  });
  return container!;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("room settings", () => {
  const openSettings = async (el: HTMLDivElement) => {
    await act(async () => {
      el.querySelector<HTMLButtonElement>(".nc-room-settings-open")?.click();
    });
  };

  it("leaves switching to the rail", async () => {
    // The title is a title again: it cannot be clicked to reveal a list, and
    // carries no destructive control to pass over.
    const el = await renderRoomTitle({
      activeRoomSummary: ownedRoom,
      onDeleteRoom: vi.fn(async () => {}),
    });
    expect(el.querySelector(".nc-room-panel[role='menu']")).toBeNull();
    expect(el.querySelector(".nc-room-item")).toBeNull();
    expect(el.querySelector(".nc-room-settings-danger")).toBeNull();
  });

  it("still opens on your own wall, showing only the way to make a room", async () => {
    // The rail is absent when you have nowhere to go, which is exactly when
    // you most need a way to make your first room. So the panel opens here
    // too — with the field and none of the room-scoped controls.
    const el = await renderRoomTitle({
      activeRoomSummary: null,
      onCreateRoom: vi.fn(async () => {}),
    });
    await act(async () => {
      el.querySelector<HTMLButtonElement>(".nc-room-settings-open")?.click();
    });
    expect(el.querySelector(".nc-room-new-input")).not.toBeNull();
    expect(el.querySelector("#nc-room-name")).toBeNull();
    expect(el.querySelector(".nc-room-settings-danger")).toBeNull();
  });

  it("has nothing to open when it can neither settle nor make a room", async () => {
    const el = await renderRoomTitle({ activeRoomSummary: null });
    expect(el.querySelector(".nc-room-settings-open")).toBeNull();
  });

  it("makes a room from the settings field", async () => {
    const onCreateRoom = vi.fn(async () => {});
    const onJoinRoom = vi.fn(async () => {});
    const el = await renderRoomTitle({ activeRoomSummary: null, onCreateRoom, onJoinRoom });
    await act(async () => {
      el.querySelector<HTMLButtonElement>(".nc-room-settings-open")?.click();
    });

    const input = el.querySelector<HTMLInputElement>(".nc-room-new-input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(
        input,
        "builders",
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.closest("form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });

    // `builders` is a name, not a code.
    expect(onCreateRoom).toHaveBeenCalledWith("builders");
    expect(onJoinRoom).not.toHaveBeenCalled();
  });

  it("renames the room from the settings panel", async () => {
    const onRenameRoom = vi.fn(async () => {});
    const el = await renderRoomTitle({ activeRoomSummary: ownedRoom, onRenameRoom });
    await openSettings(el);

    const input = el.querySelector<HTMLInputElement>("#nc-room-name")!;
    expect(input.value).toBe("studio");
    // React tracks the previous value on the DOM node, so assigning `.value`
    // directly is swallowed as a no-op change. Go through the native setter.
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "workshop");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      el.querySelector<HTMLFormElement>(".nc-room-settings-name")?.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
    expect(onRenameRoom).toHaveBeenCalledWith(ownedRoom.id, "workshop");
  });

  it("lets an owner remove someone else but never themselves", async () => {
    const onRemoveMember = vi.fn(async () => {});
    const el = await renderRoomTitle({
      activeRoomSummary: ownedRoom,
      members: [
        { userId: "me", name: "Yunji" },
        { userId: "them", name: "agikee" },
      ],
      currentUserId: "me",
      onRemoveMember,
    });
    await openSettings(el);

    const removes = el.querySelectorAll<HTMLButtonElement>(".nc-room-settings-remove");
    expect(removes).toHaveLength(1);
    expect(removes[0]!.getAttribute("aria-label")).toBe("Remove agikee");
    await act(async () => removes[0]!.click());
    expect(onRemoveMember).toHaveBeenCalledWith(ownedRoom.id, "them");
  });

  it("hides owner-only controls from a member", async () => {
    const el = await renderRoomTitle({
      activeRoomSummary: joinedRoom,
      members: [
        { userId: "me", name: "agikee" },
        { userId: "them", name: "Yunji" },
      ],
      currentUserId: "me",
      onRenameRoom: vi.fn(async () => {}),
      onRemoveMember: vi.fn(async () => {}),
      onDeleteRoom: vi.fn(async () => {}),
      onLeaveRoom: vi.fn(async () => {}),
    });
    await openSettings(el);

    expect(el.querySelector<HTMLInputElement>("#nc-room-name")?.disabled).toBe(true);
    expect(el.querySelector(".nc-room-settings-remove")).toBeNull();
    // A member gets the exit, not the demolition.
    expect(el.querySelector(".nc-room-settings-danger-open")?.textContent).toBe("Leave room");
  });

  it("asks twice before deleting", async () => {
    const onDeleteRoom = vi.fn(async () => {});
    const el = await renderRoomTitle({ activeRoomSummary: ownedRoom, onDeleteRoom });
    await openSettings(el);

    await act(async () => {
      el.querySelector<HTMLButtonElement>(".nc-room-settings-danger-open")?.click();
    });
    expect(onDeleteRoom).not.toHaveBeenCalled();
    expect(el.querySelector(".nc-room-settings-danger-q")?.textContent).toContain(
      "Delete this room for everyone?",
    );

    await act(async () => {
      el.querySelector<HTMLButtonElement>(".nc-room-item-confirm-yes")?.click();
    });
    expect(onDeleteRoom).toHaveBeenCalledWith(ownedRoom.id);
  });

  it("cancelling the delete leaves the room alone", async () => {
    const onDeleteRoom = vi.fn(async () => {});
    const el = await renderRoomTitle({ activeRoomSummary: ownedRoom, onDeleteRoom });
    await openSettings(el);
    await act(async () => {
      el.querySelector<HTMLButtonElement>(".nc-room-settings-danger-open")?.click();
    });
    await act(async () => {
      el.querySelector<HTMLButtonElement>(".nc-room-item-confirm-no")?.click();
    });
    expect(onDeleteRoom).not.toHaveBeenCalled();
    expect(el.querySelector(".nc-room-settings-danger-open")).not.toBeNull();
  });
});

describe("telling a room name from a join code", () => {
  it("treats ordinary one-word names as names", () => {
    // The old rule read any word of six or more characters as a code, so
    // naming a room `builders` looked up a join code that did not exist and
    // failed with no way to say "I meant a name". One-word names are the
    // common case.
    for (const name of ["builders", "studio", "agikee", "salon", "waka", "team-alpha"]) {
      expect(looksLikeInvite(name), name).toBe(false);
    }
  });

  it("still recognises a real code and a full invite link", () => {
    // Eight characters from the generator's alphabet — no I, O, 0 or 1.
    expect(looksLikeInvite("ABCD2345")).toBe(true);
    expect(looksLikeInvite("abcd2345")).toBe(true);
    expect(looksLikeInvite("https://waka.im/?join=ABCD2345")).toBe(true);
  });

  it("does not mistake a name for a code on length alone", () => {
    // Eight characters, but `o` and `i` never appear in a join code.
    expect(looksLikeInvite("notacode")).toBe(false);
  });
});
