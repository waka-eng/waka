/**
 * The room's life, seen edge-on down the right.
 *
 * Every surface in this product is present tense: the wall says what the room
 * reads now. This is the one that says what it read then. Drag up and the board
 * becomes what it was; the bottom of the rail is the present.
 *
 * Three decisions carry it.
 *
 * **Right edge, mirroring the rooms on the left.** Rooms are a place you move
 * between; time is a place you move within — one on each side, and neither can
 * be mistaken for the other. It sat along the bottom of the wall first, where
 * it jumped every time the number of post-its changed, because it was riding
 * on content whose height it did not control.
 *
 * **Oldest at the top, now at the bottom.** The same direction a conversation
 * runs: you scroll down toward the present.
 *
 * **Marks, not a continuum.** A room's history is a handful of moments — a
 * board that turned, a person arriving — not a smooth quantity. Measured on
 * real rooms: under ~30 marks, show every one. So the rail snaps to what
 * happened rather than letting you land between two facts.
 *
 * **Arrivals are hinges and look different.** A reading turning is the room
 * changing its mind; someone arriving is the reason it could. That is the
 * whole thesis on the time axis — the same signals, read differently because
 * another heart is in the room — so it gets the emphasis budget.
 *
 * Deliberately not a dial. The wheel with arcs spaced by elapsed time is a
 * later upgrade that has to be earned by evidence that people travel at all.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ApiRoomTimeline, ApiTimelineEvent } from "../lib/api";

/**
 * Writes this close together are one event, not several.
 *
 * A synthesis pass stamps its notes with one instant now, but older rows landed
 * seconds apart as each was written. Waka's board carries six timestamps inside
 * seventy seconds — one pass, rendered as six separate times the room changed
 * its mind. Anything inside this window collapses to the moment it began.
 *
 * **It cannot hide a real turn.** Synthesis is gated by a 15-minute cooldown
 * (`SYNTHESIS_COOLDOWN_MS`), so two genuine turns are never closer together
 * than that. This window is deliberately shorter, which makes "collapses the
 * writes of one pass" and "never collapses two passes" the same rule rather
 * than a lucky choice of number. Raising it past the cooldown would start
 * hiding history, so it must stay below.
 */
const SAME_EVENT_WINDOW_MS = 10 * 60 * 1000;

/** How far each step from the current moment recedes — the rooms' own rate. */
const DEPTH_STEP = 0.16;
/** Drag distance, in px, that commits to the neighbouring moment. */
const COMMIT_DISTANCE = 56;

/** What a position on the rail stands for. */
export interface TimeMark {
  at: string;
  kind: "formed" | "turn" | "arrival" | "departure" | "now";
  /** What to say about this moment, in one line. */
  label: string;
}

export interface TimeRailProps {
  timeline: ApiRoomTimeline | null;
  /** ISO instant currently shown, or null for the present. */
  position: string | null;
  onScrub: (at: string | null) => void;
  /** Copy, so the rail carries no English of its own. */
  copy: {
    regionLabel: string;
    now: string;
    formed: string;
    turned: string;
    arrived: (name: string) => string;
    departed: (name: string) => string;
    backToNow: string;
  };
}

/**
 * Collapse the raw event list into the moments worth stopping at.
 *
 * A pass writes several notes at one instant, so `note_written` events arrive
 * in clusters that are all one turn of the board. Grouping by instant is what
 * makes a mark mean "the room changed its mind" rather than "a row was
 * inserted".
 *
 * Replacements are deliberately NOT their own marks: a note being retired is
 * the other half of the note that replaced it, and both share an instant.
 * Showing them separately would double every turn.
 */
export function marksFromTimeline(
  timeline: ApiRoomTimeline,
  copy: TimeRailProps["copy"],
): TimeMark[] {
  const byInstant = new Map<string, ApiTimelineEvent[]>();
  for (const event of timeline.events) {
    const bucket = byInstant.get(event.at) ?? [];
    bucket.push(event);
    byInstant.set(event.at, bucket);
  }

  const marks: TimeMark[] = [];
  for (const [at, events] of byInstant) {
    // An arrival wins its instant: when someone joins and the board turns in
    // the same breath, the arrival is the reason and the turn is the effect.
    const member = events.find((e) => e.kind === "member");
    if (member && member.kind === "member") {
      marks.push({
        at,
        kind: member.event === "joined" ? "arrival" : "departure",
        label:
          member.event === "joined"
            ? copy.arrived(member.name)
            : copy.departed(member.name),
      });
      continue;
    }
    if (events.some((e) => e.kind === "formed")) {
      marks.push({ at, kind: "formed", label: copy.formed });
      continue;
    }
    const written = events.filter((e) => e.kind === "note_written");
    if (written.length > 0) {
      marks.push({ at, kind: "turn", label: copy.turned });
    }
  }

  marks.sort((a, b) => a.at.localeCompare(b.at));

  /**
   * Collapse writes that were really one event.
   *
   * An arrival always survives — it is a fact about a person, and folding it
   * into a neighbouring turn would erase the reason the reading changed. Only
   * consecutive turns merge, and they merge into the first, because a pass
   * belongs to the moment it began.
   */
  const collapsed: TimeMark[] = [];
  for (const mark of marks) {
    const previous = collapsed[collapsed.length - 1];
    const mergeable =
      previous &&
      previous.kind === "turn" &&
      mark.kind === "turn" &&
      new Date(mark.at).getTime() - new Date(previous.at).getTime() < SAME_EVENT_WINDOW_MS;
    if (mergeable) continue;
    collapsed.push(mark);
  }
  return collapsed;
}

/**
 * When a moment was, said the way a person would say it.
 *
 * Same-year moments drop the year — a room's history is mostly months, and
 * "Aug 1" reads faster than "1 Aug 2026" on a control you are dragging.
 */
function whenLabel(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

export function TimeRail({
  timeline,
  position,
  onScrub,
  copy,
}: TimeRailProps): JSX.Element | null {
  const marks = useMemo(
    () => (timeline ? marksFromTimeline(timeline, copy) : []),
    [timeline, copy],
  );

  /**
   * The present is a place on the rail, not the absence of one — otherwise
   * "now" is the only moment you cannot point at.
   */
  const all = useMemo<TimeMark[]>(
    () => [...marks, { at: "", kind: "now", label: copy.now }],
    [marks, copy.now],
  );

  const activeIndex = position === null
    ? all.length - 1
    : Math.max(0, all.findIndex((m) => m.at === position));

  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(0);
  const startRef = useRef<{ startY: number } | null>(null);

  const commit = useCallback(
    (delta: number) => {
      const next = all[activeIndex + delta];
      if (next) onScrub(next.kind === "now" ? null : next.at);
    },
    [all, activeIndex, onScrub],
  );

  /**
   * Dragging moves the rail with your finger and settles where it lands, the
   * same weight the room rail has. Kept in STATE rather than a ref so React
   * knows when the listeners should be bound, and committed OUTSIDE any state
   * updater — the room rail did both the other way and could leave a drag armed
   * forever, which turned every later click into a navigation.
   */
  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const start = startRef.current;
      if (!start) return;
      const distance = event.clientY - start.startY;
      dragRef.current = distance;
      setDrag(distance);
    };
    const onUp = () => {
      const distance = dragRef.current;
      startRef.current = null;
      dragRef.current = 0;
      setDragging(false);
      setDrag(0);
      // Down the rail is forward in time, the direction the list is ordered.
      if (distance <= -COMMIT_DISTANCE) commit(-1);
      else if (distance >= COMMIT_DISTANCE) commit(1);
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [commit, dragging]);

  /**
   * Alt+← / Alt+→ travels in time, mirroring the rooms' Alt+↑ / Alt+↓.
   * Same modifier, the other axis — the shortcut says what the two surfaces are
   * without a legend.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement) {
        const tag = event.target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || event.target.isContentEditable) return;
      }
      if (!event.altKey) return;
      if (event.key === "ArrowLeft") commit(-1);
      if (event.key === "ArrowRight") commit(1);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [commit]);

  // A room with nothing but its own formation has no journey to offer, and an
  // empty rail reads as a broken control rather than an honest young room.
  if (!timeline || marks.length < 2) return null;

  return (
    <nav
      className="nc-timerail"
      aria-label={copy.regionLabel}
      style={{ ["--rail-drag" as string]: `${drag * 0.35}px` }}
    >
      {all.map((mark, index) => {
        const distance = Math.abs(index - activeIndex);
        const isHere = index === activeIndex;
        return (
          <button
            key={`${mark.at}-${index}`}
            type="button"
            className={
              `nc-timerail-moment nc-timerail-moment--${mark.kind}` +
              (isHere ? " nc-timerail-moment--here" : "")
            }
            aria-current={isHere ? "true" : undefined}
            style={{
              // Depth: each step back is smaller, dimmer and cooler — the room
              // rail's own rate, mirrored so this recedes toward the right edge.
              ["--depth" as string]: String(Math.min(1, distance * DEPTH_STEP)),
            }}
            onPointerDown={(event) => {
              startRef.current = { startY: event.clientY };
              dragRef.current = 0;
              setDrag(0);
              setDragging(true);
            }}
            onClick={() => onScrub(mark.kind === "now" ? null : mark.at)}
            title={mark.label}
          >
            <span className="nc-timerail-moment-label">{mark.label}</span>
            <span className="nc-timerail-moment-when">
              {mark.kind === "now" ? copy.now : whenLabel(mark.at)}
            </span>
            <span className="nc-timerail-moment-edge" aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}
