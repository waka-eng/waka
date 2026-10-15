/**
 * WHOSE MEMORY THIS IS — the per-member hue system, and the ramp it works on.
 *
 * None of this touches React or the frame loop: given a ramp and a member's
 * slot it returns colours, and that is all. It is the kind of thing
 * `docs/architecture.md` means by a seam — a fact the world needs, decided
 * somewhere you can read in a minute.
 *
 * `Ramp` NOW LIVES HERE, and that is the point of this change. It was declared
 * in the page and imported back with a note saying it would follow the sim out
 * later — which left a live `lib/ -> pages/` import: the leaf of the tree
 * reaching up into the 13,000-line page it is supposed to be independent of.
 * Every module that touches colour would have inherited that edge.
 *
 * It belongs here rather than in `canvas/` because it is a DESCRIPTION OF
 * LIGHT, not a rendering technique: what live, fading and dormant look like,
 * on luminance and colour temperature. `canvas/` bakes sprites FROM a ramp;
 * `space/inspiration` decides how alive a memory is; both read this, and
 * neither owns it.
 */

/**
 * THE ALIVENESS RAMP — the whole colour model, and all of it.
 *
 * There is no longer a hue per theme. Six hash-picked pastels carried NO
 * meaning while the page's one law says light is the only meaning channel, and
 * six meaningless hues is exactly what read as noise. What an orb looks like is
 * now a function of its ALIVENESS alone, on two channels: LUMINANCE and COLOUR
 * TEMPERATURE. Two memories about different things look identical at the same
 * aliveness — which is the truth, because their themes were never what the
 * light was about.
 */
export interface Ramp {
  /** Fully alive: the brightest, warmest end. */
  live: [number, number, number];
  /** The far side of the disc's own gradient at that end. */
  liveEdge: [number, number, number];
  /** What its bloom is made of. */
  liveBloom: [number, number, number];
  /** Half-way: dimmer and cooler. */
  fade: [number, number, number];
  /** Dormant: dim, cold and nearly colourless. It never disappears. */
  dorm: [number, number, number];
  /** The air: motes and the deep background's sparkle. */
  dust: [number, number, number];
  /** The companion's own matte body, lit and shaded. */
  bodyLit: [number, number, number];
  bodyShade: [number, number, number];
}

/**
 * WHOSE MEMORY THIS IS, ON A WALL THAT HOLDS SEVERAL PEOPLE'S.
 *
 * Every other fact in this world is carried by light, because light is the
 * only meaning channel — but light is already spoken for: how bright an orb
 * is says how alive it is, and nothing may take that back. A room needs a
 * second fact ("who kept this") that cannot borrow the first one's channel.
 *
 * So identity is HUE and aliveness stays LUMINANCE. They are orthogonal:
 * tinting the warm end of a member's ramp leaves every brightness step
 * exactly where it was, so a dim orb of Sora's and a dim orb of Minho's are
 * equally dim and still distinguishable.
 *
 * Two disciplines keep this from becoming decoration:
 *
 *  - Your own memories are NEVER tinted. You are the warm white this world
 *    has always used, so your own ground looked the same in a room as it did
 *    at home, and the hues read as "other people" rather than as a palette.
 *    (Rooms went on 2026-10-12. Nothing asks for a hue now; `tintRamp` is
 *    reached only through `canvas/sprites.ts`, which is owned by a change in
 *    flight and still offers the parameter.)
 *
 *  - The DORMANT end is never tinted either. A memory nobody has touched in
 *    months goes colourless whoever kept it — because at that point the true
 *    thing about it is that it is fading, not who wrote it. Identity is worth
 *    saying while a memory is alive and worth nothing once it is not.
 *
 * These are low-saturation and close in luminance to each other on purpose:
 * they must survive being 12px wide on a dark ground, and none of them may
 * read as brighter than another, which would be luminance lying about
 * aliveness. They are also picked to stay apart under the common forms of
 * colour blindness — no red/green pair carries a distinction alone.
 */

/* `hueCss` IS GONE. It returned the css for the LEGEND'S DOT — "the same
   value the sprite is tinted with", which was the point: one function so a
   name in the room's ground-switcher and the orbs it switched to could not
   disagree about whose colour was whose. The switcher went with rooms. */

/* `tintRamp` AND `MEMBER_HUES` WENT on 2026-10-15. They tinted an orb by
   which member kept it, inside a room. `Ball.hue` was their only route in and
   it lost its last writer when rooms came out, so `orbsForHue`'s `hue >= 0`
   arm became unreachable and these two were never called again. The palette
   mixing weights (0.5 live, 0.42 bloom, 0.26 fade, `dorm` untouched) are in
   the history if a per-owner tint is ever wanted again. */

