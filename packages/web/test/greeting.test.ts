/**
 * A GREETING MAY TAKE BACK ITS OWN GESTURE, AND NOTHING ELSE.
 *
 * The world greets a returning person by gliding to the newest memory,
 * opening it, and then — 2.6 seconds later — letting it go and walking back
 * to headquarters. That undo used to release WHATEVER WAS SELECTED at the
 * moment the timer fired, not what the greeting itself had selected. Anyone
 * who pressed a caret, walked the reach or tapped a different orb inside
 * those 2.6 seconds watched their own card close and the camera leave, with
 * nothing on screen to explain it.
 *
 * It read exactly like paging being broken, which is how it was found (live,
 * 2026-08-27, chasing "the caret closes the card"): the step succeeded, the
 * panel followed, and a second later a timer from the arrival took it all
 * away.
 *
 * WHY THIS IS A SOURCE-LEVEL GATE. The behaviour needs a returning visitor
 * (`waka.seen` in the past), a fresh archive, and four real seconds of
 * wall-clock inside one case — the harness fakes `performance.now` and the
 * frame clock but not `setTimeout`, so a behavioural version would be four
 * seconds of sleeping and a race for its trouble. What can be held exactly
 * is the rule the fix states: before the greeting releases, it compares what
 * is selected NOW against the id it selected itself.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing — the page is read as text,
 * because the claim is about what the source commits to.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/pages/Home.tsx"),
  "utf8",
);

/** The greeting's own block: from the newest memory it picks to its timers. */
function greetingBlock(): string {
  const from = SRC.indexOf("const newest = fresh.reduce");
  expect(from, "the greeting still glides to the newest memory").toBeGreaterThan(-1);
  const to = SRC.indexOf("}, [inspirations, phase]);", from);
  expect(to, "the greeting effect still ends where it did").toBeGreaterThan(from);
  return SRC.slice(from, to);
}

describe("the greeting undoes itself and nothing else", () => {
  it("checks what is selected before letting go", () => {
    const block = greetingBlock();
    expect(
      block.includes("simApiRef.current?.release()"),
      "the greeting still lets its own memory go — that part was never wrong",
    ).toBe(true);
    /* the guard: what is selected right now, against what the greeting chose */
    expect(
      /selectedIdRef\.current\s*!==\s*newest\.id/.test(block),
      "a greeting that releases without asking whose selection it is will " +
        "close a card the person opened themselves. Compare against the id " +
        "the greeting selected before releasing.",
    ).toBe(true);
  });

  it("leaves the camera where the person put it, for the same reason", () => {
    const block = greetingBlock();
    const guardAt = block.search(/selectedIdRef\.current\s*!==\s*newest\.id/);
    const topAt = block.indexOf("simApiRef.current?.toTop()");
    expect(topAt, "the greeting still walks back to headquarters").toBeGreaterThan(-1);
    expect(
      guardAt !== -1 && guardAt < topAt,
      "walking the camera home is part of the same undo: if the person has " +
        "taken over, neither the selection nor the camera is the greeting's " +
        "to move.",
    ).toBe(true);
  });
});
