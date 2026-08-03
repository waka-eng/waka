/**
 * The room's life, along the bottom edge of its wall.
 *
 * Every surface in this product is present tense: the wall says what the room
 * reads now. This is the one that says what it read then. Drag left and the
 * board becomes what it was; let go at the right-hand end and you are back in
 * the present.
 *
 * Three decisions carry it.
 *
 * **Horizontal, at the bottom.** Travel between rooms is vertical (`RoomRail`
 * moves the wall up and down). Time has to be the other axis or the two
 * gestures fight, and a diagonal drag would do both at once. The first
 * movement of a drag locks the axis for exactly that reason.
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
    sinceLabel: (count: number, when: string) => string;
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
  return marks;
}

/** Nearest mark to a fraction along the rail. */
function markAtFraction(marks: TimeMark[], fraction: number): TimeMark | null {
  if (marks.length === 0) return null;
  const index = Math.round(fraction * (marks.length - 1));
  return marks[Math.max(0, Math.min(marks.length - 1, index))] ?? null;
}

export function TimeRail({
  timeline,
  position,
  onScrub,
  copy,
}: TimeRailProps): JSX.Element | null {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState<number | null>(null);

  const marks = useMemo(
    () => (timeline ? marksFromTimeline(timeline, copy) : []),
    [timeline, copy],
  );

  /**
   * The present is a real place on the rail, not the absence of one.
   *
   * Without a mark for it there is nothing to drag back TO, and letting go
   * anywhere near the right-hand end would leave the wall subtly in the past.
   */
  const all = useMemo<TimeMark[]>(
    () => [...marks, { at: "", kind: "now", label: copy.now }],
    [marks, copy.now],
  );

  const currentIndex = position === null
    ? all.length - 1
    : Math.max(0, all.findIndex((m) => m.at === position));

  const scrubToClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track || all.length === 0) return;
      const rect = track.getBoundingClientRect();
      const fraction = (clientX - rect.left) / Math.max(1, rect.width);
      const mark = markAtFraction(all, Math.max(0, Math.min(1, fraction)));
      if (!mark) return;
      onScrub(mark.kind === "now" ? null : mark.at);
    },
    [all, onScrub],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => scrubToClientX(event.clientX);
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, scrubToClientX]);

  /**
   * Keyboard travel, not an afterthought.
   *
   * The rail is the only way to reach the room's past, so it cannot be a
   * drag-only surface — that would make a whole dimension of the product
   * unreachable without a pointer.
   */
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (all.length === 0) return;
      let next = currentIndex;
      if (event.key === "ArrowLeft") next = currentIndex - 1;
      else if (event.key === "ArrowRight") next = currentIndex + 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = all.length - 1;
      else return;
      event.preventDefault();
      const mark = all[Math.max(0, Math.min(all.length - 1, next))];
      if (mark) onScrub(mark.kind === "now" ? null : mark.at);
    },
    [all, currentIndex, onScrub],
  );

  // A room with nothing but its own formation has no journey to offer, and an
  // empty rail reads as a broken control rather than as an honest young room.
  if (!timeline || marks.length < 2) return null;

  const fill = all.length <= 1 ? 1 : currentIndex / (all.length - 1);

  return (
    <div
      className={`nc-timerail${dragging ? " nc-timerail--dragging" : ""}`}
      aria-label={copy.regionLabel}
    >
      <div
        ref={trackRef}
        className="nc-timerail-track"
        role="slider"
        tabIndex={0}
        aria-valuemin={0}
        aria-valuemax={all.length - 1}
        aria-valuenow={currentIndex}
        aria-valuetext={all[currentIndex]?.label ?? copy.now}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          event.preventDefault();
          setDragging(true);
          scrubToClientX(event.clientX);
        }}
      >
        <span className="nc-timerail-line" aria-hidden="true" />
        <span
          className="nc-timerail-line nc-timerail-line--travelled"
          style={{ width: `${fill * 100}%` }}
          aria-hidden="true"
        />
        {all.map((mark, index) => (
          <button
            key={`${mark.at}-${index}`}
            type="button"
            className={
              `nc-timerail-mark nc-timerail-mark--${mark.kind}` +
              (index === currentIndex ? " nc-timerail-mark--current" : "") +
              (index <= currentIndex ? " nc-timerail-mark--past" : "")
            }
            style={{ left: `${(index / Math.max(1, all.length - 1)) * 100}%` }}
            title={mark.label}
            aria-label={mark.label}
            onPointerEnter={() => setHovered(index)}
            onPointerLeave={() => setHovered((h) => (h === index ? null : h))}
            onClick={(event) => {
              event.stopPropagation();
              onScrub(mark.kind === "now" ? null : mark.at);
            }}
          />
        ))}
      </div>
      <p className="nc-timerail-caption" aria-live="polite">
        {all[hovered ?? currentIndex]?.label ?? copy.now}
      </p>
    </div>
  );
}
