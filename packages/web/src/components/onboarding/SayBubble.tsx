/**
 * ═══ WHAT THE CREATURE SAYS, IN HOME'S OWN BUBBLE ═══════════════════════
 *
 * Founder, of onboarding's first bubble: "is this speech bubble and font
 * style truly the most high craft and aesthetical way?" It was not: it was a
 * second bubble — flat paper, a hard CSS triangle for a tail — beside the one
 * home already had. So every onboarding bubble is HOME'S bubble
 * (`.jar-char-bubble-body` in `claims.css`): the creature's own light as a
 * fill, the same grain as its body (`--jar-grain`, published by
 * `CreatureStage`), the same halo, the same soft tail that is a corner of the
 * bubble rather than a triangle beside it. Onboarding only says how big its
 * words are.
 *
 * AND IT CHANGES SIZE SMOOTHLY. Founder, of the "Kept" moment: the bubble
 * must SHRINK to hug the word, then GROW into the next question — width and
 * height eased, the tail staying where it is. So when what it says changes
 * (`say`), the box animates from the size it was to the size it now is, and
 * the new words fade in once there is room for them. Under reduced motion it
 * simply is the new size.
 */
import { useLayoutEffect, useRef, type ReactNode } from "react";

/** How long the bubble takes to change size. */
const RESIZE_MS = 300;

const reducedMotion = () =>
  typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function SayBubble({ say, children, className = "", label }: {
  /** What it is saying: a change of this is a change of words, and of size. */
  say: string;
  children: ReactNode;
  className?: string;
  label?: string;
}): JSX.Element {
  const box = useRef<HTMLDivElement>(null);
  const was = useRef<{ width: number; height: number; say: string } | null>(null);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const now = node.getBoundingClientRect();
    const before = was.current;
    was.current = { width: now.width, height: now.height, say };
    if (!before || before.say === say || !before.width || !now.width || reducedMotion() || typeof node.animate !== "function") return;
    node.animate(
      [{ width: `${before.width}px`, height: `${before.height}px` }, { width: `${now.width}px`, height: `${now.height}px` }],
      { duration: RESIZE_MS, easing: "cubic-bezier(0.3, 0, 0.2, 1)" },
    );
  }, [say]);
  return (
    <div ref={box} className={`jar-char-bubble-body onb-say ${className}`.trim()} aria-label={label}>
      <div key={say} className="onb-say-words">{children}</div>
    </div>
  );
}
