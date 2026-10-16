/**
 * A CLAIM ON A SLIP: KEEP IT, OR NOT. Both kinds of claim use it.
 *
 * Founder, 2026-10-15, on the agent's pick: "let's have this design for
 * 'keep it or not it' for the first type of claim too. I think this is
 * better than the drag upward, drag down." So a reading and a pick share
 * this slip and its gestures — sideways to answer, with the two answers
 * named under it, and, where the caller offers a chat, a downward pull to
 * talk about it instead ("add Chat about it at the center and let user drag
 * to bottom as well").
 *
 * WHAT STILL TELLS THEM APART. Founder, 2026-10-15: "claim type one and
 * claim type two should have a completely different experience, so the
 * user knows clearly that type two is more like: these are what the MCP
 * thought was important for you. Is it true or not? It needs a very clear
 * distinction." Two things carry it now:
 *
 *   THE MATERIAL. A reading is WAKA's sentence about you on a warm,
 *   rounded slip (`--reading` in claims.css). A pick is your own sentence,
 *   in italic, on a cool slip whose corners are stepped at the pixel step
 *   your agent's body is drawn at — the agent's identity in the slip's
 *   shape, since its body is not drawn beside it.
 *
 *   THE HEADER LINE. A pick says above the slip that your agent noticed
 *   this; a reading has none, because the big creature above is already
 *   the one asking.
 *
 * The buttons do the same as the gestures, and are named, for anyone who
 * does not drag. ArrowLeft and ArrowRight answer on the focused slip. There
 * is no third way out: the chat door and its pull-down came off the card
 * (founder, 2026-10-15: "remove chat about it under the claim").
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { DRAG_SLOP_PX, decideSwipe, swipeProgress } from "../lib/claim-swipe";
import { prefersStillness } from "../lib/motion";

export const SLIP_LEAVE_MS = 240;
/* ONE ANSWER PER PRESS, ACROSS CARDS. Under reduced motion the slip leaves in
   the same click it is answered in, and the next claim's slip mounts under
   the pointer — so a double-click answered two claims (found in review). A
   card is a new component, so the guard lives here, shared by all of them. */
const ANSWER_GAP_MS = 300;
let lastAnsweredAt = 0;
/* FOCUS GOES TO WHAT COMES NEXT. Each card is keyed by its claim, so the one
   that had focus unmounts after its answer and focus fell to the page. When
   the answer came from a focused card, the next card — or the "why not" list
   that follows a let-go — takes focus instead (review, 2026-10-15). */
let carryFocus = false;
/** For whatever mounts after a card was answered from the keyboard. */
export function takeCarriedFocus(): boolean {
  const carried = carryFocus;
  carryFocus = false;
  return carried;
}
/** Kept for the agent's pick, whose callers and tests speak of keeping. */
export type PickAnswer = "keep" | "not";

/* Sideways is the only way out: the pull-down into a chat went with the
   chat button (founder, 2026-10-15: "remove chat about it under the claim"). */
interface Drag { pointerId: number; startX: number; startY: number; lastX: number; lastAt: number; velocity: number; moved: boolean }

export function ClaimSlip({ id, tone, label, labelKeep, labelNot, header, more, children, onAnswer, onLeft, onOpen }: {
  id: string;
  /** A reading WAKA made of you (warm, plain) or a sentence your agent picked (cool, quoted). */
  tone: "reading" | "pick";
  /** What the slip says, for assistive technology. */
  label: string;
  labelKeep: string;
  labelNot: string;
  /** Who is presenting it, above the slip. Nothing for a reading: the big
      creature above is already the one asking. */
  header?: ReactNode;
  /**
   * WHETHER ANOTHER ONE WAITS BEHIND THIS ONE. Founder, 2026-10-15, first:
   * "only show the back card if there are more than one claim"; then, of the
   * preview that showed the next claim's words: "we just want to show that
   * there is something more behind ... a very very slight indication that
   * there's another card in the back is more than enough." So it is an edge
   * and nothing else — no words, and absent when nothing is waiting.
   */
  more?: boolean;
  /** A tap (no drag) or Enter on the slip: go deeper into what it says. */
  onOpen?: () => void;
  /** The slip's contents. */
  children: ReactNode;
  onAnswer: (answer: PickAnswer) => void;
  onLeft: (answer: PickAnswer) => void;
}) {
  const slip = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (takeCarriedFocus()) slip.current?.focus({ preventScroll: true });
  }, []);
  const drag = useRef<Drag | null>(null);
  const [dx, setDx] = useState(0);
  const [held, setHeld] = useState(false);
  const [leaving, setLeaving] = useState<PickAnswer | null>(null);
  const timer = useRef<number | null>(null);
  const still = prefersStillness();

  useEffect(() => {
    drag.current = null;
    setDx(0);
    setHeld(false);
    setLeaving(null);
  }, [id]);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  const commit = useCallback((answer: PickAnswer) => {
    if (leaving) return;
    /* Only when the slip leaves in the same click; otherwise its own trip
       (`leaving`) already holds the next press off. */
    carryFocus = Boolean(root.current?.contains(document.activeElement));
    if (still) {
      const at = performance.now();
      if (at - lastAnsweredAt < ANSWER_GAP_MS) return;
      lastAnsweredAt = at;
    }
    onAnswer(answer);
    if (still) { onLeft(answer); return; }
    setLeaving(answer);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onLeft(answer);
      setLeaving(null);
      setDx(0);
    }, SLIP_LEAVE_MS);
  }, [leaving, onAnswer, onLeft, still]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (leaving || drag.current || event.button !== 0) return;
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastAt: event.timeStamp, velocity: 0, moved: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const travel = event.clientX - current.startX;
    const fall = event.clientY - current.startY;
    if (!current.moved && Math.hypot(travel, fall) < DRAG_SLOP_PX) return;
    if (!current.moved) {
      current.moved = true;
      setHeld(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    const elapsed = Math.max(1, event.timeStamp - current.lastAt);
    current.velocity = current.velocity * 0.5 + ((event.clientX - current.lastX) / elapsed) * 0.5;
    current.lastX = event.clientX;
    current.lastAt = event.timeStamp;
    setDx(travel);
    event.preventDefault();
  };
  const release = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setHeld(false);
    /* A pause before letting go is not a flick: speed is only measured on
       moves, so a still finger would otherwise keep its last fast one. */
    if (event.timeStamp - current.lastAt > 80) current.velocity = 0;
    /* A PRESS THAT NEVER MOVED IS A TAP, and a tap opens the claim. Founder,
       2026-10-15: "user should be able to click on the card to dive deeper."
       A press that began on a control inside the slip is that control's. */
    if (!current.moved) {
      if (onOpen && !(event.target as HTMLElement).closest("button, a")) onOpen();
      return;
    }
    try { event.currentTarget.releasePointerCapture?.(event.pointerId); } catch { /* never captured */ }
    const height = slip.current?.getBoundingClientRect().height ?? 0;
    /* Measured in the slip's height. Fed sideways travel, `decideSwipe`
       calls leftward "up" and rightward "down". */
    const direction = decideSwipe({ dy: event.clientX - current.startX, height, velocity: current.velocity });
    if (direction) commit(direction === "down" ? "keep" : "not");
    else setDx(0);
  };
  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setHeld(false);
    setDx(0);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" && onOpen) { event.preventDefault(); onOpen(); }
    else if (event.key === "ArrowRight") { event.preventDefault(); commit("keep"); }
    else if (event.key === "ArrowLeft") { event.preventDefault(); commit("not"); }
  };

  const height = slip.current?.getBoundingClientRect().height ?? 0;
  const progress = held ? swipeProgress(dx, height) : 0;
  const leaning: PickAnswer | null = held && dx !== 0 ? (dx > 0 ? "keep" : "not") : null;
  const style = held ? ({ transform: `translateX(${dx}px) rotate(${dx * 0.03}deg)` } as CSSProperties) : undefined;

  return (
    /* THE ANSWER FORMS IN LIGHT, AND IN A TAG ON THE EDGE. Founder,
       2026-10-15, on an outlined "STILL TRUE" stamp landing on the words
       mid-drag: "the tag on the card is kind of ugly", then "I did like the
       tag, but the tag itself was ugly." So the tag is back as a soft pill
       on the slip's edge (below), and the light stays: toward keeping the
       slip warms, toward letting go it dims, and the answer underneath that
       you are moving toward lights up and leans out. */
    <div
      ref={root}
      className={`${tone === "reading" ? "jar-pick jar-pick--reading" : "jar-pick"}${(leaving ?? leaning) === "keep" ? " jar-pick--toward-keep" : (leaving ?? leaning) === "not" ? " jar-pick--toward-not" : ""}`}
      data-moving={held || leaving ? "1" : undefined}
      style={{ "--near": leaving ? 1 : progress } as CSSProperties}
    >
      {header}
      <div className="jar-pick-pile">
        {more ? <div className="jar-pick-behind" aria-hidden="true" /> : null}
        <div
          ref={slip}
          className={`jar-pick-slip${onOpen ? " jar-pick-slip--opens" : ""}${held ? " jar-pick-slip--held" : ""}${leaving === "keep" ? " jar-pick-slip--leaving-keep" : leaving === "not" ? " jar-pick-slip--leaving-not" : ""}`}
          style={style}
          role="group"
          aria-label={label}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={release}
          onPointerCancel={cancel}
          onKeyDown={onKeyDown}
        >
          {/* THE WORLD'S FILM, BARELY. Founder, 2026-10-15: "a little bit of
              texture on this card like this speech bubble but not too much
              ... it just feels too solid and flat." */}
          <span className="jar-pick-grain" aria-hidden="true" />
          {children}
          {/* THE TAG, REDESIGNED. Founder, 2026-10-15: "I did like the tag,
              but the tag itself was ugly." The idea stays — the answer you
              are giving appears ON the slip as you move it — and the object
              changes: a soft pill in the bubble's own material, in Jost at
              normal case, sitting on the slip's top edge so it never covers
              the words, leaning a little the way the slip leans. */}
          {leaning || leaving ? (
            <span
              className={(leaving ?? leaning) === "keep" ? "jar-pick-tag jar-pick-tag--keep" : "jar-pick-tag jar-pick-tag--not"}
              aria-hidden="true"
            >
              {(leaving ?? leaning) === "keep" ? labelKeep : labelNot}
            </span>
          ) : null}
        </div>
      </div>
      <p className="jar-pick-acts">
        <button type="button" className="jar-pick-act jar-pick-act--not" disabled={leaving !== null} onClick={() => commit("not")}>
          <svg viewBox="0 0 7 12" width="7" height="12" aria-hidden="true"><path d="M6 1 1 6l5 5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{labelNot}</span>
        </button>
        <button type="button" className="jar-pick-act jar-pick-act--keep" disabled={leaving !== null} onClick={() => commit("keep")}>
          <span>{labelKeep}</span>
          <svg viewBox="0 0 7 12" width="7" height="12" aria-hidden="true"><path d="M1 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </p>
    </div>
  );
}
