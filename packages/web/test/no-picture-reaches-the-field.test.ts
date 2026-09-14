/**
 * NO PICTURE COMES DOWN WITH A MEMORY.
 *
 * Founder, 2026-09-08: "What is this LinkedIn logo? It's weird. Remove it.
 * The balls should never have those logos or anything." And again on
 * 2026-09-14, still looking at it: "debug root cause of this circle being
 * linkedin logo and fix it."
 *
 * WHAT DREW IT. The field fetched each memory's picture — an attached image,
 * or the `og:image` a linked page declares — circle-clipped it into two
 * offscreen sprites, and drew the photograph INSTEAD of the disc. A link to a
 * company page declares that company's logo, so the world quietly filled with
 * other people's brands, over the one channel that carries meaning here:
 * light is aliveness, hue is whose it is, resolution is what kind of mind
 * kept it.
 *
 * WHAT WAS FIXED FIRST, AND WHAT IT MISSED. #318 deleted the DRAWING — the
 * sprite bake, `Ball.img`, and the image branch in `field-paint`. It left the
 * PIPE: `lib/data.ts` went on computing `imageUrl` for every memory out of
 * `previewImageUrl`, carried it to the client, and nothing read it. Four days
 * later the founder asked for the root cause and that is what was still
 * there — not drawing anything, and one line of code away from drawing again.
 * A field named `imageUrl` on every row is an invitation.
 *
 * SO THE RULE IS UPSTREAM OF THE CANVAS. It is not "the field must not draw a
 * picture" — that is the symptom, and the symptom is what the last fix
 * addressed. It is that a memory does not carry a picture to the browser at
 * all. Nothing downstream can draw what it was never handed.
 *
 * WHAT THIS DOES NOT SAY. Attachments still exist, still upload, and their
 * enrichment TEXT still comes down — that is machine-derived reading, which
 * the panel labels and which has nothing to do with a logo on an orb. And
 * whether a picture should ever be SHOWN, somewhere a picture belongs, is an
 * open product question and not this gate's business: it holds only that one
 * does not arrive unasked, on the layer that feeds the ground.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads the source off disk
 * as text, the way `verb-pairs.test.ts` and `earned-not-declared.test.ts` do.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");

function everyFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) everyFile(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** comments blanked: a note may name the thing it says is gone */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, (b) => b.replace(/[^\n]/g, " ")).replace(/^\s*\/\/.*$/gm, "");

const sources = new Map(
  everyFile(SRC).map((f) => [f.slice(SRC.length + 1), code(readFileSync(f, "utf8"))]),
);

/**
 * The API's own name for the picture a linked page declares. Named exactly,
 * because this is the value that became a LinkedIn logo on an orb.
 */
const THE_PICTURE = "previewImageUrl";

describe("no picture comes down with a memory", () => {
  it("never reads the preview a linked page declared", () => {
    /* `lib/api` may TYPE the field — it mirrors the server's shape, and
       deleting it there would be lying about what the route returns. What may
       not happen is the app reaching in and taking the value. */
    const taking: string[] = [];
    for (const [name, text] of sources) {
      if (name.startsWith("lib/api/")) continue;
      if (text.includes(THE_PICTURE)) taking.push(name);
    }
    expect(
      taking,
      `these take the picture a linked page declared and carry it into the app. ` +
        `That value is a company's logo on a company's page, and the last time it ` +
        `reached the client it was drawn on an orb. See this file's header.`,
    ).toEqual([]);
  });

  it("hands no memory an image url of its own", () => {
    /* the field that held it. Bare `imageUrl` on a memory is the shape that
       fed the sprite bake; the fixture server's own `imageUrl` is a test
       address and lives in `tools/`, outside this scan. */
    const carrying: string[] = [];
    for (const [name, text] of sources) {
      if (name.startsWith("lib/api/")) continue;
      if (/\bimageUrl\b/.test(text)) carrying.push(name);
    }
    expect(
      carrying,
      "these give a memory an image url. Nothing downstream can draw a picture " +
        "it was never handed, which is the whole of this rule.",
    ).toEqual([]);
  });

  it("draws nothing on the ground but the palette's own discs", () => {
    /* THE SYMPTOM, still held. Every `drawImage` in the field must take its
       source from the baked palette or the orb sheet — never from a thing
       fetched off the network. */
    const paint = sources.get("space/inspiration/field-paint.ts");
    expect(paint, "field-paint.ts is not where this thinks it is").toBeDefined();
    const sources_drawn = [...(paint ?? "").matchAll(/drawImage\(\s*([A-Za-z_$][\w.$[\]]*)/g)].map(
      (m) => m[1]!,
    );
    expect(sources_drawn.length, "no drawImage found — the scan is looking at the wrong file").
      toBeGreaterThan(2);
    for (const s of sources_drawn) {
      expect(
        /^(pal\.|sheet\b)/.test(s),
        `field-paint draws from \`${s}\`, which is neither the palette nor the orb sheet`,
      ).toBe(true);
    }
  });

  it("reads a source tree that really contains the layer this is about", () => {
    /* the tripwire: a scan that finds nothing agrees with everything */
    expect(sources.has("lib/data.ts")).toBe(true);
    expect(sources.get("lib/data.ts")).toMatch(/attachmentSummary/);
    expect(sources.size).toBeGreaterThan(50);
  });
});
