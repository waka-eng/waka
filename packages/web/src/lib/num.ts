/**
 * NUMBERS, AND NOTHING THAT KNOWS WHAT THEY ARE FOR.
 *
 * Nine declarations with well over a hundred call sites between them, spread
 * across the canvas loop, the companion's motion, the sky and travel. When the
 * split was mapped, every module DISCLAIMED them — each one correctly said
 * "these are not mine, they belong in lib/" — and no module then claimed them.
 * They were the largest entry on the orphan list: symbols nobody owned, which
 * is exactly how a 13,000-line page keeps its size through a refactor.
 *
 * The rule for this file is that it must never learn the product. `lerp` does
 * not know it is easing a camera, `hashStr` does not know it is seeding an
 * orb's scatter, and `kd` does not know the frame rate it is correcting for.
 * Anything that needs a WAKA noun to explain itself belongs somewhere else.
 */

export const DAY_MS = 86_400_000;

export const TAU = Math.PI * 2;

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export const clamp01 = (v: number) => clamp(v, 0, 1);

/**
 * The page's one easing curve in numbers: cubic-bezier(0.22, 1, 0.36, 1),
 * which every CSS transition in jar.css already rides. A cubic ease-out sits
 * on it to within a pixel at these durations, so the canvas and the DOM
 * genuinely move on the same curve rather than on two that look alike.
 */
export const easeOut = (u: number) => 1 - Math.pow(1 - u, 3);

/**
 * A RATE, NOT A PER-FRAME STEP.
 *
 * `lerp(x, target, 0.14)` is not a speed — it is a speed per FRAME, so the
 * same line runs at double speed on a 120Hz phone as on a 60Hz one, and slows
 * down again as a phone thermally throttles. A world whose motion rate is a
 * function of the display it landed on, and of how long you have been looking
 * at it, is telling you something untrue about itself.
 *
 * `rps` is the fraction of the remaining distance still left after one full
 * second, so the ease is the same ease at any frame rate. (The file already
 * used this idiom correctly in the drift and the nest; the input path is
 * simply where it never got applied.)
 */
export const kd = (rps: number, dt: number) => 1 - Math.pow(rps, dt);

export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * FNV-1a's low bits are correlated across near-identical inputs — `agent-01`
 * and `agent-02` land in the same slot on roughly half the axes under a bare
 * modulo, which is exactly the input shape a family of agent ids has. This is
 * the avalanche finaliser that makes `hashStr(x) % k` an honest draw.
 */
export function mix32(h: number): number {
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}