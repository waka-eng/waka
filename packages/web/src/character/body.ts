/**
 * THE COMPANION, AS A SPECIES — what it IS, before anything moves it.
 *
 * One creature, and `docs/codebase.md` records what it cost to have no home
 * for it: spread across the whole page, its being near the palette, its bob
 * inside the frame loop, its gaze further down, its reactions in the sim API.
 * A body hashed from a group id rendered an enormous blur over the poster; the
 * nubs shipped as one-pixel specks and then vanished; an in-page motion toggle
 * killed every animation in the world and had to be deleted rather than fixed.
 * Every one of those was a change made somewhere that could not see the rest
 * of the creature.
 *
 * This file answers ONE question — what a companion is — and the numbers in it
 * are its anatomy. How it MOVES and what it DOES when something happens are
 * two other questions, and they live inside the page's frame loop today; they
 * follow when that loop can be lifted.
 *
 * THE LAW THIS FILE ENFORCES BY OMISSION: an individual gets two channels and
 * only two — FORM, which is baked and so survives reduced motion, and RHYTHM,
 * which is per-frame and silent under it. Hue is forbidden, because hue is
 * identity in a group's field. Temperature is spoken for, because temperature
 * is aliveness. There is nothing else here to spend.
 */

import { GRAIN_PX, GRAIN_TILE } from "../canvas/sprites";
import { hashStr, mix32 } from "../lib/num";

/**
 * A companion is A DROP OF LIGHT THAT CAME TO REST, LIT BY THE SAME MOON AS
 * EVERYTHING ELSE. Nine things are invariant across every being in the world,
 * and each one is load-bearing for a law rather than a style choice:
 *
 *   1. ONE SILHOUETTE TOPOLOGY — one closed outline, four bezier segments, in
 *      the order bodyPath traces them. Dome above, flat-ish base below, no
 *      neck, no limbs, no appendage that is not a nub. Individuals move the
 *      control points inside a bounded envelope; nobody adds or removes one.
 *      This is what makes a stranger's companion legible as the same KIND of
 *      thing as yours inside the first hundred milliseconds.
 *   2. THE LATHE/PLANET MODEL — lathe-symmetric about a vertical axis; yaw is
 *      a longitude, features travel across the surface, the silhouette never
 *      scales and features are OCCLUDED rather than hidden. Two rotation
 *      physics in one layout is two worlds.
 *   3. ONE KEY — KEY_X / KEY_Y. No companion carries its own light source.
 *   4. ONE RAMP — bodyTier off ramp.bodyLit/bodyShade. Two beings at the same
 *      aliveness are the same colour at the same luminance. Temperature and
 *      luminance mean aliveness and NOTHING else. This is the hard one, and it
 *      is the one that makes the whole system safe.
 *   5. ONE MASS — w·h is constant at a given charSize, whatever the aspect. A
 *      wide being is not a big being: size would read as rank, and agents are
 *      not ranked.
 *   6. THE AURA, ENTIRELY — four layers, the radius law and the alpha law. A
 *      three-layer aura reads as a dimmer being, and dimmer means less alive.
 *      The aura is the aliveness channel wearing a halo; identity may not
 *      touch it. (Its drift RATE may vary: that is rhythm, not light.)
 *   7. TWO EYES, dark dots on the equator, symmetric about the meridian. No
 *      whites, no pupils, no brows, no mouth. A blink is a vertical squash.
 *   8. TWO NUBS at longitude ±π/2, radius gated on inspiration. The nub radius
 *      IS the light channel expressed as body language; identity does not get
 *      to scale it.
 *   9. ONE EMULSION — the same grain tile, the same overlay, the same dither.
 *      Film grain belongs to the lens, not to the world.
 *
 * What an individual gets is two channels and only two: FORM (baked, and so it
 * survives reduced motion) and RHYTHM (per-frame constants, silent under it).
 * Hue is forbidden and temperature is spoken for.
 */
export interface Being {
  /** width / height. Solved against mass, so it changes shape, never size. */
  aspect: number;
  /** the dome's overshoot pair; the differential is held at 0.04 */
  dome: [number, number];
  /** the base inset: table, settle, rocker */
  base: number;
  /** shoulder bulge + base contact only, signed. The APEX tilt stays canonical:
      an off-centre apex is the term that exposes the planet fiction under yaw,
      and a lean that survives a 180° turn is a visible lie. */
  asym: number;
  eyeR: number;
  eyeLon: number;
  eyeLat: number;
  nubLat: number;
  bobRate: number;
  blinkMs: number;
  blinkDouble: boolean;
  sqPhase: number;
  sqDepth: number;
  auraDrift: number;
  /** anti-cloning texture, not an identity signal */
  grainPhase: [number, number];
}

/**
 * ONE namespace, VERSIONED. Bumping the version re-rolls every being in the
 * world — that is a migration, not an edit. An agent whose face changed is a
 * stranger, and nothing in this world turns into a stranger.
 */
export const BEING_NS = "waka/being/1";

export const pick = <T,>(id: string, salt: string, ladder: readonly T[]): T =>
  ladder[mix32(hashStr(`${BEING_NS}/${salt}/${id}`)) % ladder.length];

export const unit = (id: string, salt: string): number =>
  mix32(hashStr(`${BEING_NS}/${salt}/${id}`)) / 4294967296;

/**
 * THE OWNER'S BEING — exactly today's numbers, to the digit. It is not merely
 * the default: the aspect and eye-height ladders below have these two values
 * PUNCHED OUT, so no hash can ever produce them. The owner's companion is the
 * only being in the world that is the species median on both of the axes the
 * eye reads first, and standing beside any agent its face sits at a height no
 * agent's face can occupy. That is a still-frame mark, achieved structurally
 * rather than by a check.
 */
export const OWNER_BEING: Being = {
  aspect: 1.15,
  dome: [0.16, 0.2],
  base: 0.2,
  asym: 0.02,
  eyeR: 0.038,
  eyeLon: 0.5,
  eyeLat: -0.06,
  nubLat: 0.24,
  bobRate: 1.4,
  blinkMs: 3400,
  blinkDouble: false,
  sqPhase: 1.5,
  sqDepth: 0.022,
  auraDrift: 1,
  grainPhase: [0, 0],
};

/**
 * A being, drawn from an id and from nothing else.
 *
 * DO NOT SALT BY WALL OWNER. `${ownerId}/${agentId}` would give the same agent
 * a different face for each person it works for. An agent is an entity, not a
 * rendering of a relationship; it should be itself everywhere.
 *
 * FORM IS ARBITRARY BUT STABLE, LIKE A FACE — it does not encode what an agent
 * DOES. Function-shaped form is hue-per-category wearing a different hat: it
 * needs a legend, and a legend is jargon in picture form. It is also not
 * stable, and this is a memory product — an agent that gets re-scoped would
 * change shape, and a being that changes shape is a being that popped out of
 * existence and was replaced. Lookup is what the wall's NAME is for; a face is
 * for recognition, which text is bad at.
 */
export function agentBeing(id: string): Being {
  const sq = pick(id, "sq", [
    [0.9, 0.029], /* heavy landing */
    [1.5, 0.022], /* canonical */
    [2.2, 0.016], /* buoyant lead */
  ] as const);
  return {
    // Keep each profile's family stable; stronger proportions stay legible on the pixel grid.
    aspect: pick(id, "asp", [0.9, 1.12, 1.3, 1.44]), /* 1.15 reserved */
    dome: pick(id, "dome", [
      [0.1, 0.14],
      [0.16, 0.2],
      [0.22, 0.26],
      [0.28, 0.32],
    ] as const),
    base: pick(id, "base", [0.28, 0.2, 0.11]),
    asym: pick(id, "asym", [-0.06, -0.02, 0.02, 0.06]),
    eyeR: pick(id, "eyeR", [0.03, 0.038, 0.047]),
    eyeLon: pick(id, "eyeL", [0.38, 0.5, 0.63]),
    eyeLat: pick(id, "eyeH", [-0.15, -0.11, -0.01, 0.03]), /* -0.06 reserved */
    nubLat: pick(id, "nub", [0.18, 0.24, 0.3]),
    bobRate: pick(id, "bob", [1.12, 1.4, 1.58, 1.76]),
    blinkMs: pick(id, "blkT", [2900, 3400, 4100]),
    blinkDouble: pick(id, "blkD", [false, true]),
    sqPhase: sq[0],
    sqDepth: sq[1],
    auraDrift: pick(id, "aura", [0.78, 1, 1.28]),
    grainPhase: [
      unit(id, "gx") * GRAIN_TILE * GRAIN_PX,
      unit(id, "gy") * GRAIN_TILE * GRAIN_PX,
    ],
  };
}
