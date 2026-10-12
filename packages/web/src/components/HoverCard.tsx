/**
 * A HOVER CARD — the explanation that is not on the screen until it is wanted.
 *
 * The home page holds three things, so anything that explains a fourth cannot
 * take permanent room on it. A hover card is how a one-line label carries a
 * paragraph without printing one: the line stays a line, and the paragraph
 * exists only while someone is actually asking.
 *
 * WHY THIS IS NOT ONLY A HOVER. A card that opens on pointer-over and nothing
 * else is unreachable by keyboard and unreachable on a phone, which would make
 * the explanation decorative — available exactly to the people who least need
 * it. So it opens on hover, on focus, and on press, and it closes on Escape,
 * on blur, and on a pointer that has left both the trigger and the card.
 *
 * THE DELAY IS ON OPEN, NOT ON CLOSE. A pointer crossing a line on its way
 * somewhere else should not spawn a card behind it; a pointer travelling from
 * the trigger INTO the card must not lose it on the way. So opening waits, and
 * closing waits a little longer than the gap between the two elements.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";

const OPEN_DELAY_MS = 180;
const CLOSE_DELAY_MS = 220;

export interface HoverCardProps {
  /** The line a person reads. Carries the trigger semantics. */
  label: string;
  /** What the line could not say. Rendered only while open. */
  children: React.ReactNode;
  className?: string;
}

export function HoverCard({ label, children, className }: HoverCardProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const cardId = useId();
  const timer = useRef<number | undefined>(undefined);
  const host = useRef<HTMLSpanElement | null>(null);

  const cancel = useCallback(() => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  }, []);

  const schedule = useCallback(
    (next: boolean) => {
      cancel();
      timer.current = window.setTimeout(
        () => setOpen(next),
        next ? OPEN_DELAY_MS : CLOSE_DELAY_MS,
      );
    },
    [cancel],
  );

  useEffect(() => cancel, [cancel]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancel();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, cancel]);

  return (
    <span
      ref={host}
      className={`waka-hovercard${className ? ` ${className}` : ""}`}
      onPointerEnter={() => schedule(true)}
      onPointerLeave={() => schedule(false)}
      /* Focus moving anywhere outside the trigger AND the card closes it; a
         card you tabbed into must survive the trigger losing focus. */
      onBlur={(event) => {
        if (!host.current?.contains(event.relatedTarget as Node | null)) {
          cancel();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="waka-hovercard-trigger"
        aria-expanded={open}
        aria-describedby={open ? cardId : undefined}
        onFocus={() => schedule(true)}
        onClick={() => {
          cancel();
          setOpen((value) => !value);
        }}
      >
        {label}
      </button>
      {open ? (
        <span id={cardId} role="note" className="waka-hovercard-card">
          {children}
        </span>
      ) : null}
    </span>
  );
}
