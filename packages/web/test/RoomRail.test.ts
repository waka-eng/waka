// @vitest-environment jsdom

/**
 * The rooms seen edge-on.
 *
 * What is worth pinning is not that a rail renders but what it exists to do:
 * say that other rooms exist without being clicked, place them stably by
 * depth, and get you into one — while putting nothing of its own on the wall.
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RoomRail, type RoomRailProps } from "../src/components/RoomRail";
import { MINE_BOARD_ID } from "../src/components/rooms";
import type { ApiGroupSummary } from "../src/lib/api";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

/**
 * React derives `onPointerEnter`/`onPointerLeave` from delegated
 * `pointerover`/`pointerout` at the root, so dispatching a literal
 * `pointerenter` reaches nothing.
 */
const hover = (el: Element) => el.dispatchEvent(new Event("pointerover", { bubbles: true }));

const room = (id: string, name: string, memberCount = 1): ApiGroupSummary => ({
  id,
  name,
  role: "owner",
  joinCode: "",
  memberCount,
  createdAt: "",
});

const mine = room(MINE_BOARD_ID, "Mine");
const waka = room("11111111-1111-4111-8111-111111111111", "Waka", 6);
const builders = room("22222222-2222-4222-8222-222222222222", "builders", 2);

async function renderRail(overrides: Partial<RoomRailProps> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const props: RoomRailProps = {
    rooms: [mine, waka, builders],
    activeRoom: MINE_BOARD_ID,
    onSelect: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root?.render(createElement(RoomRail, props));
  });
  return container!;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("RoomRail", () => {
  it("says other rooms exist without being opened", async () => {
    // The whole reason this surface exists: the title looked like a title, so
    // nobody learned there was anywhere else to go.
    const el = await renderRail();
    const names = [...el.querySelectorAll(".nc-rail-room-name")].map((n) => n.textContent);
    expect(names).toEqual(["Mine", "Waka", "builders"]);
  });

  it("is absent when there is nowhere else to go", async () => {
    // Making a room lives in settings, so with one room this surface has
    // nothing to say and says nothing, rather than standing in as an empty menu.
    const el = await renderRail({ rooms: [mine] });
    expect(el.querySelector(".nc-rail")).toBeNull();
    expect(el.querySelector(".nc-rail-add")).toBeNull();
  });

  it("recedes rooms by distance from the one you are in", async () => {
    const el = await renderRail({ activeRoom: waka.id });
    const depths = [...el.querySelectorAll<HTMLElement>(".nc-rail-room")].map((n) =>
      n.style.getPropertyValue("--depth"),
    );
    // Waka is current, so its neighbours sit one step back each.
    expect(depths[1]).toBe("0");
    expect(Number(depths[0])).toBeGreaterThan(0);
    expect(Number(depths[2])).toBeGreaterThan(0);
  });

  it("reads recency as warmth, not as a count", async () => {
    const el = await renderRail({
      recencyHours: { [waka.id]: 2, [builders.id]: 24 * 60 },
    });
    const rooms = [...el.querySelectorAll<HTMLElement>(".nc-rail-room")];
    expect(rooms[1]!.style.getPropertyValue("--warmth")).toBe("1");
    expect(rooms[2]!.style.getPropertyValue("--warmth")).toBe("0");
    // Member counts are shown, but nothing is badged as unread.
    expect(el.textContent).not.toMatch(/unread|new\b/i);
  });

  /**
   * The rail names rooms; it does not preview them. Hovering used to ghost two
   * of a room's notes onto the wall, which put another room's top-of-mind text
   * on top of the board you were reading. The name and its depth are the whole
   * affordance now, so nothing appears on hover at all.
   */
  it("shows nothing but the rooms when a room is hovered", async () => {
    const el = await renderRail();
    const target = el.querySelectorAll<HTMLElement>(".nc-rail-room")[1]!;
    const before = el.textContent;

    await act(async () => hover(target));

    expect(el.textContent).toBe(before);
    expect(el.textContent).not.toMatch(/looking in/i);
  });

  it("moves rooms with the keyboard", async () => {
    const onSelect = vi.fn();
    await renderRail({ activeRoom: waka.id, onSelect });

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", altKey: true, bubbles: true }),
      );
    });
    expect(onSelect).toHaveBeenCalledWith(builders.id);

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowUp", altKey: true, bubbles: true }),
      );
    });
    expect(onSelect).toHaveBeenCalledWith(MINE_BOARD_ID);
  });

  it("selects the room you click", async () => {
    const onSelect = vi.fn();
    const el = await renderRail({ onSelect });
    await act(async () => {
      el.querySelectorAll<HTMLButtonElement>(".nc-rail-room")[2]!.click();
    });
    expect(onSelect).toHaveBeenCalledWith(builders.id);
  });
});
