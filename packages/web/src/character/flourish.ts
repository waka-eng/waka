/**
 * ═══ A DIFFERENT MOVE FOR EVERY LINE ═════════════════════════════════════
 *
 * Founder, 2026-11-20, of the dots under the creature: "every time we move a
 * thought maybe the character should kind of like animate, jump up, spin,
 * like the animation should also be different every time", and then "go
 * super creative with all the ways that the character can react when you
 * click on it ... build even more variations." So a tap that steps to the
 * next line plays one of these, never the one it played last. Each is a pure
 * function of time through it, read by the world's loop.
 */
import { clamp01 } from "../lib/num";
import { hopLift } from "./hop";

export const FLOURISHES = [
  "hop", "twirl", "wiggle", "squish", "double", "backflip", "jelly",
  "pop", "nod", "shiver", "float", "stretch", "curious", "dance", "triple", "dizzy", "bow",
] as const;
export type Flourish = (typeof FLOURISHES)[number];

/** How long each move takes. */
export const FLOURISH_MS: Record<Flourish, number> = {
  hop: 560, twirl: 760, wiggle: 620, squish: 560, double: 720, backflip: 820, jelly: 760,
  pop: 460, nod: 640, shiver: 520, float: 1100, stretch: 900, curious: 1000, dance: 1100, triple: 780, dizzy: 1000, bow: 900,
};

/** What the move adds to the body at `t` (0…1): lift (negative is up), a
    sideways shift, a turn in radians, a squash (positive is wider) and a
    width and height scale. */
export interface FlourishPose { lift: number; dx: number; rot: number; sq: number; sx: number; sy: number }

const REST: FlourishPose = { lift: 0, dx: 0, rot: 0, sq: 0, sx: 1, sy: 1 };
const pose = (part: Partial<FlourishPose>): FlourishPose => ({ ...REST, ...part });
const easeInOut = (u: number) => (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2);
const arc = (u: number) => Math.sin(Math.PI * clamp01(u));

export function flourishPose(kind: Flourish, t: number, size: number): FlourishPose {
  const u = clamp01(t);
  if (u <= 0 || u >= 1) return REST;
  const fade = 1 - u;
  switch (kind) {
    case "hop": {
      /* one tall hop, landing with a little squash */
      const up = u < 0.8 ? arc(u / 0.8) : 0;
      const land = u >= 0.8 ? arc((u - 0.8) / 0.2) * 0.08 : 0;
      return pose({ lift: -up * size * 0.26, sq: land - up * 0.05 });
    }
    case "twirl":
      /* rises a little and turns once all the way round */
      return pose({ lift: -arc(u) * size * 0.12, rot: easeInOut(u) * Math.PI * 2 });
    case "wiggle":
      /* side to side, three times, dying away */
      return pose({ dx: Math.sin(u * Math.PI * 6) * size * 0.07 * fade, rot: Math.sin(u * Math.PI * 6) * 0.14 * fade });
    case "squish": {
      /* squashes down, then pops up tall and settles */
      const sq = u < 0.35 ? Math.sin((Math.PI * (u / 0.35)) / 2) * 0.16 : 0.16 * Math.cos(Math.PI * ((u - 0.35) / 0.65) * 1.5) * (1 - (u - 0.35) / 0.65);
      return pose({ lift: u > 0.35 ? -arc((u - 0.35) / 0.65) * size * 0.08 : 0, sq });
    }
    case "double":
      /* the keep's two happy bounces */
      return pose({ lift: hopLift(u, size) });
    case "backflip": {
      /* crouch, leap high, flip over backwards, land */
      const crouch = u < 0.15 ? arc(u / 0.3) * 0.1 : 0;
      const air = u >= 0.15 ? (u - 0.15) / 0.85 : 0;
      return pose({ lift: -arc(air) * size * 0.4, rot: -easeInOut(air) * Math.PI * 2, sq: crouch - arc(air) * 0.04 });
    }
    case "jelly": {
      /* wobbles wide and tall, settling */
      const w = Math.sin(u * Math.PI * 5) * 0.16 * fade;
      return pose({ sx: 1 + w, sy: 1 - w });
    }
    case "pop":
      /* swells up big for a beat and comes back */
      return pose({ sx: 1 + arc(u) * 0.22, sy: 1 + arc(u) * 0.22 });
    case "nod":
      /* dips twice, a yes */
      return pose({ lift: Math.abs(Math.sin(u * Math.PI * 2)) * size * 0.06, rot: Math.sin(u * Math.PI * 2) * 0.05 });
    case "shiver":
      /* a quick excited shiver */
      return pose({ dx: Math.sin(u * Math.PI * 16) * size * 0.025 * fade, sq: Math.sin(u * Math.PI * 16) * 0.02 * fade });
    case "float":
      /* drifts up slowly, holds, and sinks back like a balloon let go */
      return pose({ lift: -Math.pow(arc(u), 0.6) * size * 0.3, rot: Math.sin(u * Math.PI * 2) * 0.06 });
    case "stretch": {
      /* a long sleepy stretch up, then a relaxed squish */
      const up = u < 0.55 ? arc(u / 1.1) : arc(0.5) * (1 - (u - 0.55) / 0.45);
      const relax = u > 0.6 ? arc((u - 0.6) / 0.4) * 0.08 : 0;
      return pose({ sx: 1 - up * 0.14 + relax, sy: 1 + up * 0.22 - relax });
    }
    case "curious":
      /* tilts its head one way, then the other, wondering */
      return pose({ rot: Math.sin(u * Math.PI * 2) * 0.32 * arc(u), dx: Math.sin(u * Math.PI * 2) * size * 0.03 });
    case "dance": {
      /* sways left and right with a hop on each beat */
      const beat = Math.abs(Math.sin(u * Math.PI * 4));
      return pose({ dx: Math.sin(u * Math.PI * 2) * size * 0.12 * arc(u), rot: Math.sin(u * Math.PI * 2) * 0.18 * arc(u), lift: -beat * size * 0.07 });
    }
    case "triple": {
      /* three quick small hops */
      const b = Math.abs(Math.sin(u * Math.PI * 3));
      return pose({ lift: -b * size * 0.1 * (1 - u * 0.3), sq: -b * 0.03 });
    }
    case "dizzy":
      /* circles round on the spot, a little dizzy */
      return pose({ dx: Math.sin(u * Math.PI * 4) * size * 0.08 * arc(u), lift: -Math.cos(u * Math.PI * 4) * size * 0.04 * arc(u) + size * 0.04 * arc(u), rot: Math.sin(u * Math.PI * 4) * 0.12 * arc(u) });
    case "bow":
      /* a small bow forward, then back up */
      return pose({ rot: arc(u) * 0.4, lift: arc(u) * size * 0.06, dx: arc(u) * size * 0.04 });
  }
}

/** Any move but the last one played. */
export function nextFlourish(last: Flourish | null, random: () => number = Math.random): Flourish {
  const choices = FLOURISHES.filter(kind => kind !== last);
  return choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!;
}
