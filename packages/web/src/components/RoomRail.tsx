/**
 * The rooms, seen edge-on.
 *
 * Nobody found the room switcher, because nothing on screen said there were
 * other rooms — the title looked like a title. This says so by existing: a
 * permanent strip at the edge of the wall showing the rooms you are not in,
 * stacked behind the one you are.
 *
 * Two ideas carry it.
 *
 * Depth. Rooms recede: the current one is nearest and widest, the rest fall
 * back and cool. Position is stable, so after a week you reach for a place
 * rather than reading a label.
 *
 * Travel. Committing does not swap one list for another. The wall moves: this
 * room's notes leave upward while the next room's arrive from below, staggered
 * by depth. Cross-fading would say the content changed; travelling says you did.
 *
 * Deliberately not a badge. "Three unread" turns a room you like into a chore,
 * so recency reads as warmth in the rail's light instead.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { ApiGroupSummary } from "../lib/api";
import { MINE_BOARD_ID } from "./rooms";

export { MINE_BOARD_ID };

/** How far a room falls back per step away from the current one. */
const DEPTH_STEP = 0.16;
/** Drag distance, in px, that commits to the neighbouring room. */
const COMMIT_DISTANCE = 56;

export interface RoomRailProps {
  rooms: ApiGroupSummary[];
  activeRoom: string;
  onSelect: (roomId: string) => void;
  /**
   * Hours since anything was saved in each room, by id. Drives warmth. Absent
   * means cold, which is also what a room with no activity should look like.
   */
  recencyHours?: Record<string, number>;
}

/** Warmth from recency: today is warm, last month is not. */
function warmth(hours: number | undefined): number {
  if (hours === undefined) return 0;
  if (hours <= 24) return 1;
  if (hours >= 24 * 30) return 0;
  return 1 - (hours - 24) / (24 * 29);
}

export function RoomRail({
  rooms,
  activeRoom,
  onSelect,
  recencyHours,
}: RoomRailProps): JSX.Element | null {
  const [drag, setDrag] = useState(0);
  const draggingRef = useRef<{ startY: number } | null>(null);
  /**
   * Whether a drag is actually in progress, as STATE rather than only a ref.
   *
   * The listeners below used to be attached from a ref, which React cannot see
   * — so whether they were bound depended on some unrelated render happening
   * to re-run the effect. If a pointerup landed before that render, the ref was
   * never cleared, the listeners stayed attached forever, and from then on
   * every click anywhere on the page ran the drag-commit path and switched
   * rooms. The first room in the list is your own wall, so the app appeared to
   * throw you out of every room you opened.
   */
  const [dragging, setDragging] = useState(false);
  /** The live drag distance, readable from a listener without a stale closure. */
  const dragRef = useRef(0);
  const activeIndex = Math.max(
    0,
    rooms.findIndex((room) => room.id === activeRoom),
  );

  const commit = useCallback(
    (delta: number) => {
      const next = rooms[activeIndex + delta];
      if (next) onSelect(next.id);
    },
    [rooms, activeIndex, onSelect],
  );

  // Dragging the rail moves the wall with your finger and settles where it
  // lands. A button that plays an animation is not the same thing as an object
  // with weight, and the difference is the whole point of the surface.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const start = draggingRef.current;
      if (!start) return;
      const distance = event.clientY - start.startY;
      dragRef.current = distance;
      setDrag(distance);
    };
    /**
     * Commit OUTSIDE the state updater.
     *
     * `commit` navigates, and it used to be called from inside `setDrag`'s
     * updater — React may run an updater more than once, and running it at all
     * is supposed to be free of side effects. That is why the room change
     * appeared in stack traces with no click in them at all.
     */
    const onUp = () => {
      const distance = dragRef.current;
      draggingRef.current = null;
      dragRef.current = 0;
      setDragging(false);
      setDrag(0);
      if (distance <= -COMMIT_DISTANCE) commit(1);
      else if (distance >= COMMIT_DISTANCE) commit(-1);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    // `pointercancel` too: a gesture the browser takes over (scroll, back-swipe)
    // never sends pointerup, and without this the drag stayed armed for good.
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [commit, dragging]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || event.target.isContentEditable) return;
      }
      if (event.altKey && event.key === "ArrowDown") commit(1);
      if (event.altKey && event.key === "ArrowUp") commit(-1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [commit]);

  // Nowhere else to go, nothing to show. Making a room lives in settings, so
  // this surface can simply be absent rather than standing in as an empty menu.
  if (rooms.length <= 1) return null;

  return (
    <nav
        className="nc-rail"
        aria-label="Rooms"
        style={{ ["--rail-drag" as string]: `${drag * 0.35}px` }}
      >
        {rooms.map((room, index) => {
          const distance = Math.abs(index - activeIndex);
          const isActive = room.id === activeRoom;
          return (
            <button
              key={room.id}
              type="button"
              className={`nc-rail-room${isActive ? " nc-rail-room--here" : ""}`}
              aria-current={isActive ? "true" : undefined}
              style={{
                // Depth: each step back is smaller, dimmer and cooler.
                ["--depth" as string]: String(Math.min(1, distance * DEPTH_STEP)),
                ["--warmth" as string]: String(warmth(recencyHours?.[room.id])),
              }}
              onPointerDown={(event) => {
                draggingRef.current = { startY: event.clientY };
                dragRef.current = 0;
                setDrag(0);
                setDragging(true);
              }}
              onClick={() => onSelect(room.id)}
            >
              <span className="nc-rail-room-edge" aria-hidden="true" />
              <span className="nc-rail-room-name">{room.name}</span>
              {room.memberCount > 1 ? (
                <span className="nc-rail-room-count">{room.memberCount}</span>
              ) : null}
            </button>
          );
        })}
    </nav>
  );
}
