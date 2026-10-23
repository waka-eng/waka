/**
 * A VALUE IS EARNED, NEVER TYPED.
 *
 * Founder, 2026-09-08: "You cannot declare your own values. This can only be
 * generated. So remove this option."
 *
 * What that removed. The values band on your own wall carried `declare one`,
 * and under it a two-line draft with `declare it · not now`. Pressing it
 * posted your words to `POST /principles`, which routed them internally: what
 * qualified came back a principle and joined the band, what read as a goal
 * was kept as an inspiration instead. It shipped on 2026-09-01 for a real
 * reason — a person with no values had no way to give their word first — and
 * the founder has withdrawn it on the stronger reading of what layer four is
 * FOR. Layers one to three are what you kept, what the machine found in it,
 * and what is current. Layer four is what all of that turned out to say about
 * how you choose. A sentence you can type straight into it is a conclusion
 * with nothing underneath, and it is indistinguishable, once written, from
 * one that a year of evidence earned.
 *
 * ── WHY A GATE AND NOT JUST A DELETION ─────────────────────────────────────
 *
 * Because the deleted thing was correct on its own terms and will be
 * reinvented. It answered a real emptiness — a new person's band says "this
 * fills as you keep things", which is honest and also nothing to do — and the
 * next reader who meets that emptiness will reach for exactly the same fix,
 * as this repository already did once. This file is the note they will meet
 * instead: the emptiness is the product working, and the way to fill it is to
 * keep things.
 *
 * The server route is deliberately untouched and still answers. Nothing in
 * the product calls it, and retiring an endpoint that other clients may hold
 * is a decision with its own blast radius; this gate holds the PRODUCT shut,
 * which is what was asked for.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads the source and the
 * catalogues off disk as text, the way `verb-pairs.test.ts` does.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const MESSAGES = resolve(SRC, "lib/i18n/messages");

function everyFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) everyFile(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** file -> text, for every source file the product ships. */
const sources = new Map(everyFile(SRC).map((f) => [f.slice(SRC.length + 1), readFileSync(f, "utf8")]));

/** The five strings the removed control spoke, in both languages. */
const RETIRED = [
  "worldDeclareOne",
  "worldDeclareIt",
  "worldDeclaring",
  "worldWhatYouHoldTo",
  "worldAPrincipleOfYourOwn",
];

describe("a value is earned, never typed", () => {
  it("has no client for the route that mints one from words", () => {
    /* WRITING to `/principles` — the bare collection — is declaring. READING
       it is the band itself, and `POST /principles/reorder` is an ordering:
       both stay. So the rule is not "this path is forbidden", it is "no write
       helper is aimed at it", which is asked by looking at what stands in
       front of each mention of the exact path. */
    const WRITERS = ["postJson", "patchJson", "putJson", "requestVoid", "deleteJson"];
    const COLLECTION = /apiPath\(\s*["'`]\/principles["'`]\s*\)/g;
    const declaring: string[] = [];
    for (const [name, text] of sources) {
      for (const hit of text.matchAll(COLLECTION)) {
        const before = text.slice(Math.max(0, (hit.index ?? 0) - 160), hit.index);
        if (WRITERS.some((w) => new RegExp(`(?<![\\w.])${w}\\s*[<(]`).test(before))) {
          declaring.push(`${name} writes to /principles`);
        }
      }
      if (/\bdeclarePrinciple\b/.test(text)) declaring.push(`${name} (declarePrinciple)`);
    }
    expect(
      declaring,
      "Something in the product writes a principle from a person's own words. " +
        "Layer four is generated from what they kept — see this file's header " +
        "before restoring it.",
    ).toEqual([]);
  });

  it("reads a source tree that really contains the neighbouring verbs", () => {
    /* The tripwire under the case above: a scan that matches nothing passes
       forever. Reordering posts to the same collection with a suffix and must
       be found, and so must the two verbs that DO act on a principle. */
    const blob = [...sources.values()].join("\n");
    expect(blob).toMatch(/apiPath\(`\/principles\/reorder(?:`|\$\{)|apiPath\("\/principles\/reorder"\)/);
    expect(blob).toMatch(/\bupdatePrinciple\b/);
    expect(blob).toMatch(/\bdeletePrinciple\b/);
    expect(sources.size).toBeGreaterThan(50);
  });

  it("ships no words in any language for an act that cannot happen", () => {
    /* A dead string is a control someone will wire back up. Both catalogues
       are checked, because the Korean half is where a retired key hides. */
    const left: string[] = [];
    for (const file of readdirSync(MESSAGES).filter((f) => f.endsWith(".json"))) {
      const catalogue = JSON.parse(readFileSync(resolve(MESSAGES, file), "utf8")) as Record<
        string,
        string
      >;
      for (const key of RETIRED) if (key in catalogue) left.push(`${file}: ${key}`);
    }
    expect(left, "these name the withdrawn act and no screen says them").toEqual([]);
  });
});
