/**
 * THE ELEMENTS THE CANVAS SIDE TOUCHES — one object instead of twelve refs.
 *
 * `docs/architecture.md` names `SimApi` as the boundary between React and the
 * canvas: React calls in, the canvas never reaches back. That is true of every
 * VALUE the two exchange, and it was never true of the DOM. Twelve elements are
 * created and owned by React and then measured, transformed and written into by
 * the frame loop sixty times a second — headquarters' transform, the whisper's
 * top, each candidate's sentence, the volume's height, the root's CSS custom
 * properties. That traffic is legitimate: the canvas carries the light and the
 * DOM carries the words, and the words have to be told where the light went.
 *
 * WHAT THIS FIXES, WHICH IS NOT ITSELF A PERFORMANCE OR A CORRECTNESS PROBLEM.
 *
 * `docs/goals/close-the-two-gaps.md` measured five JSX blocks in `Home.tsx` as
 * extraction candidates. Two came out and hold no refs. The other three — the
 * ready field at 463 lines, the reading panel at 277, the sky at 216 — each own
 * elements the loop dereferences, and the moment such a block becomes a child
 * component every one of those refs becomes a prop. The measurement in that
 * document is the argument against doing it: a 44-prop component is not more
 * readable than the block it replaced, and threading a shared mutable channel
 * through a props list RELOCATES the entanglement rather than resolving it.
 *
 * So the refs are collected here first. A block that needs three of them now
 * needs one prop, and that prop is a named, documented seam rather than three
 * anonymous handles whose reader has to go find who else holds them.
 *
 * THE RULE FOR MEMBERSHIP, WHICH HAS NO EXCEPTIONS.
 *
 * An element belongs in `Measured` if and only if something on the CANVAS side
 * dereferences it — the frame effect, or the palette pass that feeds it. That
 * is a mechanical test, not a judgement, and it is why some refs that look like
 * obvious neighbours are not here:
 *
 *   - `panelRef` and `panelTextRef` — the reading panel's own. The panel's
 *     placement does cross the seam, but it crosses as NUMBERS through
 *     `SimApi.place()`; the element itself is only ever read by two React
 *     layout effects. It can keep private refs wherever it ends up living.
 *   - the four dial refs — read by `scrubClient`, a React callback. The dial
 *     talks to the sim through `SimApi.scrubTo()`, again as numbers.
 *   - `mouthFieldRef` — the textarea. Autosize and focus, both React layout
 *     effects. `mouthSpot` IS here, because a newborn memory leaves from the
 *     middle of the sentence that made it and the loop measures that.
 *
 * Adding a ref here that the canvas never reads would make this object a
 * grab-bag of "refs in Home.tsx", which answers no question. The membership
 * rule is the whole value of the file.
 *
 * WHY THESE ARE REF OBJECTS AND NOT VALUES, WHICH IS THE TRAP.
 *
 * Every field is a ref, so `.current` is read AT USE TIME, in the frame that
 * uses it. Collecting the elements themselves — `{ hq: hqRef.current }` — is
 * the obvious shape and it is silently wrong: the object is built while the
 * first render's DOM is whatever it is, the frame effect closes over it once,
 * and every element that mounts, unmounts or is replaced afterwards is frozen
 * at whatever was true when the loop started. Nothing throws. The sky
 * extraction hit exactly this and solved it the same way, passing `viewerId:
 * () => viewerIdRef.current` rather than a captured string; a ref object is the
 * same discipline with less ceremony, since `.current` already IS the accessor.
 *
 * The object identity is stable for the page's life for the same reason: the
 * frame effect and the palette effect both close over it, and neither re-runs
 * when React re-renders.
 */
import { useRef, type MutableRefObject, type RefObject } from "react";

/**
 * The DOM the canvas side of `SimApi` reads and writes.
 *
 * Grouped by which of the page's blocks owns the element, because that grouping
 * is the point: it is the list of what a block would have had to take as props.
 */
export interface Measured {
  /* ---- the frame itself: owned by the page, not by any one block ---- */
  /** The layout's root. Measured for the pointer's origin, and the one place
      `--jar-vw`, `--jar-vh` and `--jar-seam` are written from. */
  readonly root: RefObject<HTMLDivElement>;
  /** The one surface. Everything with light on it is drawn here. */
  readonly canvas: RefObject<HTMLCanvasElement>;
  /** The volume: a layout-tall gradient the camera descends through. The loop
      writes its top, its height and its vertical transform. */
  readonly atmos: RefObject<HTMLDivElement>;
  /** The emulsion: one DOM layer over the whole frame, blended, never redrawn.
      The palette pass lays the film on it once; the loop leaves it alone. */
  readonly grain: RefObject<HTMLDivElement>;

  /* ---- the ready field (463 lines): headquarters and the companion ---- */
  /** Headquarters' camera-riding layer — it rides BOTH axes, because rooms are
      columns of the same page. */
  readonly hq: RefObject<HTMLDivElement>;
  /** The CONTENT block inside headquarters, not `.jar-hq` itself: its height is
      what the companion's slot is solved against, and observing the outer
      element instead would be a resize feedback loop. */
  readonly hqInner: RefObject<HTMLDivElement>;
  /** The companion's whisper. Screen-anchored, so the loop writes both its top
      and a transform that cancels the horizontal camera. */
  readonly charSay: RefObject<HTMLDivElement>;

  /* ---- the mouth (59 lines): where a memory is said ---- */
  /** The mouth's camera-riding layer. It stands on the seam and is a sibling of
      headquarters rather than a child, because you cannot type into words that
      have orbs drawn over them. */
  readonly mouth: RefObject<HTMLDivElement>;
  /** The element a memory is BORN from, measured on the keep so a newborn
      leaves from the middle of the sentence that made it however many lines
      that had wrapped to. Assigned by a callback ref, hence mutable. */
  readonly mouthSpot: MutableRefObject<HTMLElement | null>;

  /* ---- the sky (216 lines): layer two's words ---- */
  /** One sentence per candidate, keyed by candidate id, positioned on its cloud
      every frame. The map is mutated by callback refs as candidates mount and
      unmount; `.current` itself is never replaced. */
  readonly nebEls: MutableRefObject<Map<string, HTMLDivElement>>;
  /** One line per cluster, keyed by the joined ids, placed under the lowest
      cloud in the cluster. Same lifecycle as `nebEls`. */
  readonly clusterEls: MutableRefObject<Map<string, HTMLDivElement>>;
  /** The one whisper the orbits carry: whose memory the pointer is on. The loop
      writes both its words and its place. */
  readonly satSay: RefObject<HTMLDivElement>;
  /**
   * The axis of walls, along the bottom — measured, not guessed.
   *
   * The chrome at the bottom edge is two stacked bands now (the timeline
   * underneath, the names of the walls above it), and the field has to stop
   * clear of BOTH. A constant would be wrong on the first phone with a home
   * indicator; the distance from the viewport's bottom to this element's top
   * is the whole reserve, stated by the chrome itself.
   */
  readonly axis: RefObject<HTMLElement>;
}

/**
 * One `Measured` for the life of the component.
 *
 * Built lazily inside a single ref rather than assembled from twelve `useRef`
 * calls, so there is exactly one object identity and no way for a future render
 * to hand the loop a different one. React writes each `current` when it attaches
 * the element; nothing here writes it.
 */
export function useMeasured(): Measured {
  const held = useRef<Measured | null>(null);
  if (held.current === null) {
    held.current = {
      root: { current: null },
      canvas: { current: null },
      atmos: { current: null },
      grain: { current: null },
      hq: { current: null },
      hqInner: { current: null },
      charSay: { current: null },
      mouth: { current: null },
      mouthSpot: { current: null },
      nebEls: { current: new Map() },
      clusterEls: { current: new Map() },
      satSay: { current: null },
      axis: { current: null },
    };
  }
  return held.current;
}
