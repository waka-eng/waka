/**
 * THE BEING, WHEREVER IT HAS TO STAND BEFORE THE WORLD EXISTS.
 *
 * `character/body.ts` says what a companion IS — one silhouette, one key, one
 * ramp, two eyes, two nubs — and `canvas/` bakes it into sprites the frame loop
 * draws. None of that is reachable outside the world: it needs a canvas, a
 * palette subtree and a running loop. So the three screens a person meets
 * BEFORE the loop exists — the door, the name-ask and the loading frame — had
 * no way to show the creature they are about to meet.
 *
 * The loading frame answered that on 2026-08-27 by hand-drawing the being out
 * of four divs and a radial gradient (founder: "can we have the character
 * already there in the loading screen?"). This file is that drawing, lifted
 * out of `LoadingHome` unchanged, so that the door and the name-ask show the
 * SAME being rather than a second sketch of it. Two hand-drawn companions in
 * one product is exactly the drift `body.ts` exists to prevent, one layer down.
 *
 * INLINE STYLES, DELIBERATELY. Inherited from `LoadingHome` and kept for its
 * reason: this face renders outside `.jar`, the subtree that defines every
 * `--jar-*` token, so `var()` would resolve to nothing. The values mirror the
 * world's — the ground is `--jar-atmos`'s value, the glow is the warm note's,
 * the body is the being's ivory as the bake renders it.
 *
 * WHAT THIS IS NOT. It is not the bake and must never grow toward it: no hue,
 * no aliveness ramp, no rank. `body.ts` spends light on aliveness and nothing
 * else, and a being standing at the door has no memories yet to be alive
 * about. It has FORM, and it has where it is looking.
 */

/** The being's ivory, its nubs and its eyes, as the bake renders them. */
const IVORY_HIGH = "#ece7db";
const IVORY_LOW = "#d9d3c5";
const NUB = "#d9d4c8";
const EYE = "#141412";

/**
 * WHERE IT IS LOOKING, and the one channel a door is allowed to spend.
 *
 * `body.ts` grants an individual two channels — FORM, which is baked, and
 * RHYTHM, which is per-frame — and forbids hue and temperature outright
 * because those mean identity and aliveness. Gaze is rhythm: it says where
 * the person is, and it says it only because the person moved there.
 *
 * Both eyes carry the same offset, so the pair stays symmetric about the
 * meridian the way the law requires. Range is -1..1 in each axis; anything
 * outside is clamped, because a gaze that leaves the face is a bug that would
 * render as a second creature.
 */
export interface CompanionGaze {
  /** negative looks left, positive right */
  x: number;
  /** negative looks up, positive down */
  y: number;
}

/**
 * Not looking at anything — the resting gaze, and the one every screen starts
 * from. Exported because it is a VALUE of this channel rather than a number
 * any caller is free to guess at: two screens writing their own `{x: 0, y: 0}`
 * is two definitions of "ahead", and the second one to be edited would quietly
 * become a squint.
 */
export const LOOKING_AHEAD: CompanionGaze = { x: 0, y: 0 };

/**
 * How far an eye travels at full gaze, in base-scale pixels — about two
 * thirds of an eye's own 13px width, which is what makes the glance legible
 * at the size the door draws this being (`scale: 0.5`).
 *
 * It was 7 and 5, chosen on the page rather than on the screen, and at door
 * scale that came to two and a half pixels: the unit test proved the eyes
 * moved and the screenshot showed a being that never looked at anything. A
 * channel nobody can see is not a channel. The ceiling is the face itself —
 * at full reach the eyes stay well inside the dome, because a pupil that
 * leaves its head reads as a second creature rather than as attention.
 */
const GAZE_REACH_X = 9;
const GAZE_REACH_Y = 8;

const clampGaze = (n: number): number => (n < -1 ? -1 : n > 1 ? 1 : n);

export interface CompanionProps {
  /**
   * 1 is the loading frame's size (240x190). The door and the name-ask stand
   * it smaller; every part scales together, because `body.ts`'s fifth
   * invariant is that mass is constant at a given size — a being drawn wide
   * or tall would read as a different KIND of being.
   */
  scale?: number;
  /** Where it is looking. Defaults to straight ahead. */
  gaze?: CompanionGaze;
}

export function Companion({
  scale = 1,
  gaze = LOOKING_AHEAD,
}: CompanionProps = {}): JSX.Element {
  const px = (n: number): number => Math.round(n * scale);
  const eyeShift = `translate(${clampGaze(gaze.x) * GAZE_REACH_X * scale}px, ${
    clampGaze(gaze.y) * GAZE_REACH_Y * scale
  }px)`;
  const eye = {
    position: "absolute" as const,
    top: "39%",
    width: px(13),
    height: px(13),
    borderRadius: "50%",
    background: EYE,
    transform: eyeShift,
  };

  return (
    <div
      aria-hidden="true"
      style={{ position: "relative", width: px(240), height: px(190) }}
    >
      {/* the same warm halo the bake gives the resting being */}
      <div
        style={{
          position: "absolute",
          inset: px(-110),
          background:
            "radial-gradient(circle at 50% 46%, rgba(255,242,220,0.14), rgba(255,242,220,0) 62%)",
        }}
      />
      {/* the hands, tucked at the cheeks the way the bake rests them */}
      <div
        style={{
          position: "absolute",
          left: px(-4),
          bottom: px(26),
          width: px(46),
          height: px(46),
          borderRadius: "50%",
          background: NUB,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: px(-4),
          bottom: px(26),
          width: px(46),
          height: px(46),
          borderRadius: "50%",
          background: NUB,
        }}
      />
      {/* the dome, lit from above the way the world lights it */}
      <div
        style={{
          position: "absolute",
          left: px(10),
          right: px(10),
          top: 0,
          bottom: 0,
          borderRadius: "52% 52% 46% 46% / 62% 62% 40% 40%",
          background: `radial-gradient(ellipse at 50% 26%, ${IVORY_HIGH}, ${IVORY_LOW} 78%)`,
        }}
      >
        {/* `companion-eye` carries ONLY the travel time, from chrome.css,
            where a reduced-motion rule can take it away. The position itself
            is inline and always correct, so an eye still looks where it is
            looking if that sheet never arrives — the state renders, the
            journey between states is the part motion owns. */}
        <div className="companion-eye" style={{ ...eye, left: "33%" }} />
        <div className="companion-eye" style={{ ...eye, right: "33%" }} />
      </div>
    </div>
  );
}

export default Companion;
