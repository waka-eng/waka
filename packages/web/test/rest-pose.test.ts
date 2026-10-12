/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads two source files off
 * disk and asserts a relationship between them. No component mounts, no
 * module is imported for its behaviour, and there is no DOM, clock, server or
 * account data involved — which is the point: a rule about two drawings
 * agreeing must not depend on anyone remembering to render either of them. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * ═══ ONE CREATURE, DRAWN IN TWO PLACES ═════════════════════════════════
 *
 * Founder: "do the rest pose so the creature can be on every screen."
 *
 * Doing that means a second drawer of the product's most important object —
 * the frame loop, which draws it live sixty times a second, and `restPose`,
 * which draws it standing still on a page. That is a genuine risk and it is
 * the reason this file exists. The codebase already states the principle for
 * the body sprite, in `canvas/palette.ts`: one baker, so the two can never
 * become different creatures. Faces and nubs had no such rule, because until
 * now there was only one place that drew them.
 *
 * THE RULE IS NOT "the two functions are identical" — they must not be. The
 * loop applies yaw, pitch, blink, gaze, a bob and a machine-cell grid; the
 * rest pose is that same arithmetic with every one of those set to zero. What
 * has to hold is that both read the ANATOMY from one place, so that moving an
 * eye moves it in both.
 *
 * So: the numbers live in `character/raster.ts`, and `Home.tsx` may not
 * declare its own. A `const FACE_R = 0.34` growing back there is exactly how
 * this decays — it would compile, it would render, the world would look
 * right, and a page's creature would quietly be a slightly different animal.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const RASTER = resolve(HERE, "../src/character/raster.ts");
const HOME = resolve(HERE, "../src/pages/Home.tsx");

/** The anatomy, and where each number has to come from. */
const ANATOMY = [
  "EYE_LON",
  "FACE_R",
  "EYE_R",
  "EYE_INK",
  "NUB_LON",
  "NUB_X",
  "NUB_Y",
  "NUB_R_DIM",
  "NUB_R_LIT",
  "NUB_DIM",
  "NUB_LIT",
] as const;

describe("the creature is drawn from one anatomy", () => {
  it("declares every part of it in raster.ts", () => {
    const raster = readFileSync(RASTER, "utf8");
    const missing = ANATOMY.filter((name) => !new RegExp(`export const ${name}\\b`).test(raster));
    expect(
      missing,
      "the rest pose and the frame loop both read these out of " +
        "`character/raster.ts`. One that is not exported there is one each " +
        "of them is free to invent.",
    ).toEqual([]);
  });

  it("lets Home.tsx use them but never declare them", () => {
    const home = readFileSync(HOME, "utf8");
    const redeclared = ANATOMY.filter((name) => new RegExp(`\\bconst ${name}\\s*[:=]`).test(home));
    expect(
      redeclared,
      "the frame loop has grown its own copy of part of the creature's " +
        "anatomy. It would compile, it would render, and the world would " +
        "look right while a page's creature became a slightly different " +
        "animal. Import it from `character/raster.ts` instead.",
    ).toEqual([]);
    /* AND IT MUST ACTUALLY IMPORT THEM — a loop that stopped referring to the
       shared names at all would pass the check above by having no creature
       in it, which is the vacuous-green failure every gate here guards. */
    expect(
      /from "\.\.\/character\/raster"/.test(home),
      "Home.tsx no longer imports the creature's anatomy at all",
    ).toBe(true);
    const unused = ANATOMY.filter((name) => !new RegExp(`\\b${name}\\b`).test(home));
    expect(
      unused,
      "these are exported for two callers and the frame loop is not one of " +
        "them any more — either it stopped drawing part of the creature, or " +
        "it went back to a literal.",
    ).toEqual([]);
  });

  it("keeps the rest pose free of the loop's behaviour", () => {
    const raster = readFileSync(RASTER, "utf8");
    /* CODE, NOT PROSE. The first run of this flagged the word "yaw" in
       `restPose`'s own header, which is there to explain that yaw is set to
       zero — a comment naming the behaviour it excludes is the comment doing
       its job. Stripping comments first is the difference between a gate
       that reads the program and one that reads the writing about it. */
    const pose = raster
      .slice(raster.indexOf("export function restPose"))
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    /* THE REST POSE IS THE ZEROS. If it ever reads a live value it has
       stopped being a rest pose and has become a second simulation — which
       is the thing that cannot be kept in step with the first. */
    const live = ["yaw", "pitch", "blink", "companion.", "flare", "bobPh"].filter((term) =>
      pose.includes(term),
    );
    expect(
      live,
      "`restPose` is reading something that only exists while the world is " +
        "running. It draws the creature with every behaviour at zero; a live " +
        "term in it is a second simulation nobody can keep in step.",
    ).toEqual([]);
  });
});
