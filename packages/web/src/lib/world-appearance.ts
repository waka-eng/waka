/**
 * WHOSE MEMORY THIS IS — the per-member hue system.
 *
 * Extracted from World.tsx because none of it touches React or the frame
 * loop: given a ramp and a member's slot it returns colours, and that is all.
 * It is the kind of thing `docs/architecture.md` means by a seam — a fact the
 * world needs, decided somewhere you can read in a minute.
 *
 * The `Ramp` type comes back in from World.tsx rather than moving with these
 * functions, because the palette is still the sim's to own. When `world/sim/`
 * is extracted (step 4 of docs/codebase.md), Ramp goes there and this module
 * imports it from its new home — one import line changes.
 */
import type { Ramp } from "../pages/World";

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
 *    has always used, so your own ground looks the same in a room as it does
 *    at home, and the hues read as "other people" rather than as a palette.
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
export const MEMBER_HUES: Array<{ name: string; rgb: [number, number, number] }> = [
  { name: "blue", rgb: [126, 168, 224] },
  { name: "amber", rgb: [224, 176, 108] },
  { name: "green", rgb: [128, 200, 166] },
  { name: "violet", rgb: [176, 154, 224] },
  { name: "rose", rgb: [226, 148, 164] },
];

/** css for the legend's dot — the same value the sprite is tinted with. */
export function hueCss(i: number): string {
  const h = MEMBER_HUES[i % MEMBER_HUES.length]!.rgb;
  return `rgb(${h[0]}, ${h[1]}, ${h[2]})`;
}

/**
 * A member's ramp: the live end pulled toward their hue, the dormant end left
 * exactly as it was. `k` is deliberately partial — a fully replaced colour
 * would make the orb read as a coloured dot rather than as this world's light
 * with somebody's name on it.
 */
export function tintRamp(ramp: Ramp, i: number): Ramp {
  const h = MEMBER_HUES[i % MEMBER_HUES.length]!.rgb;
  const mixOne = (c: [number, number, number], k: number): [number, number, number] => [
    Math.round(c[0] + (h[0] - c[0]) * k),
    Math.round(c[1] + (h[1] - c[1]) * k),
    Math.round(c[2] + (h[2] - c[2]) * k),
  ];
  return {
    ...ramp,
    live: mixOne(ramp.live, 0.5),
    liveEdge: mixOne(ramp.liveEdge, 0.5),
    liveBloom: mixOne(ramp.liveBloom, 0.42),
    /* half as much at the midpoint: the hue fades out as the memory does */
    fade: mixOne(ramp.fade, 0.26),
    /* and `dorm` is untouched — see the note above */
  };
}

