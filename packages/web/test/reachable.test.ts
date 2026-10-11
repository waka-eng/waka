/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads the source tree off
 * disk and asks a question about references between files. No module is
 * imported for its behaviour and there is no DOM, clock, server or account
 * data involved. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * ═══ AN EXPORT NOBODY IMPORTS IS A SURFACE NOBODY ASKED FOR ════════════
 *
 * Founder: "conduct a very extensive audit of all the dead code or features
 * that we don't need anymore and delete them."
 *
 * The sweep that answered it found less than expected, and the shape of
 * what it found is the reason this file exists. Two runtime exports were
 * referenced by NOTHING — `bulbGlow`, the creature's brightness from a
 * clock, replaced by brightness from the field; and `ordWords`, spelled-out
 * ordinals, which the one ordinal still printed deliberately does not use.
 * Both deleted. Twenty-seven more were exported and used only inside their
 * own file: not dead, but public for no reason, and every one of them is a
 * thing the next person has to decide whether they may change.
 *
 * WHY A RATCHET AND NOT A BAN. Some of those twenty-seven are legitimately
 * about to have a second caller, and a few are exported so a gate can reach
 * them. A hard rule would be argued with and then exempted into
 * uselessness — the failure `capitalized.test.ts` records about itself. A
 * ceiling that only goes down costs nothing to live with and cannot drift
 * upward quietly, which is the behaviour this codebase already uses for its
 * type scale and its palette.
 *
 * TYPES ARE NOT COUNTED. An exported interface is the vocabulary of an API
 * surface; a consumer may name it even when this repository does not, and
 * deleting one because no file here says its name is how a client library
 * loses the ability to describe its own arguments. The rule is about
 * RUNTIME exports, which are code that ships.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const TEST = resolve(dirname(fileURLToPath(import.meta.url)), "..", "test");
const TOOLS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../tools");

/**
 * THE CEILING, AND IT IS A NUMBER TO BE LOWERED.
 *
 * 27 on 2026-10-11, measured right after the two genuinely dead ones went.
 */
const PRIVATE_ENOUGH = 27;

function sources(dir: string, found: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return found; }
  for (const name of entries) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/** Every runtime export that no other file in the repository names. */
function inwardOnly(): string[] {
  const src = sources(SRC);
  /* Tests and the browser gates count as callers: a symbol exported so a
     gate can reach it is doing a job, and calling it dead would push people
     to delete the gate instead. */
  const everywhere = new Map<string, string>();
  for (const path of [...src, ...sources(TEST), ...sources(TOOLS)]) {
    everywhere.set(path, readFileSync(path, "utf8"));
  }
  const found: string[] = [];
  for (const path of src) {
    const text = everywhere.get(path)!;
    for (const match of text.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)) {
      const name = match[1]!;
      const word = new RegExp(`\\b${name}\\b`);
      let outside = false;
      for (const [other, body] of everywhere) {
        if (other !== path && word.test(body)) { outside = true; break; }
      }
      if (!outside) found.push(`${path.slice(SRC.length + 1)}: ${name}`);
    }
  }
  return found.sort();
}

describe("what the product exports, something imports", () => {
  it("reads the tree at all", () => {
    /* THE TRIPWIRE, BECAUSE A GATE THAT READS NOTHING PASSES. A broken walk
       or a renamed directory would make the count zero and the assertion
       below vacuously green — silently, which is the failure every gate
       here is written to avoid one level up. */
    expect(sources(SRC).length, "no sources found — has the tree moved?").toBeGreaterThan(50);
    expect(sources(TOOLS).length, "the browser gates were not found, so a symbol only they use would read as dead")
      .toBeGreaterThan(10);
  });

  it("keeps no runtime export that nothing outside its file names", () => {
    const inward = inwardOnly();
    expect(
      inward.length,
      `${inward.length} runtime export(s) are used only inside their own file, ` +
        `and the ceiling is ${PRIVATE_ENOUGH}. Either something should be ` +
        `calling it, or it should stop being exported, or — if nothing calls ` +
        `it at all — it should go.\n  ${inward.join("\n  ")}\n`,
    ).toBeLessThanOrEqual(PRIVATE_ENOUGH);
  });

  it("has a ceiling still worth having", () => {
    /* THE OTHER HALF OF THE RATCHET, the same shape the type scale uses:
       slack is room for the thing the ceiling exists to stop. */
    const inward = inwardOnly();
    expect(
      PRIVATE_ENOUGH - inward.length,
      `the ceiling is ${PRIVATE_ENOUGH} and there are ${inward.length}. Lower it.`,
    ).toBeLessThanOrEqual(2);
  });
});
