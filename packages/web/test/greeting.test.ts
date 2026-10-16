/**
 * A GREETING OPENS NO CARD.
 *
 * The world used to greet a returning person by gliding to the newest memory,
 * opening its card, and 2.6 seconds later letting it go and walking back to
 * headquarters — an undo that had already needed a guard (2026-08-27) so it
 * only ever took back its own gesture. Founder, 2026-10-16: "once in a while
 * the inspiration card keeps coming up in the main page but dont have that."
 * So the gesture is gone, guard and all: coming back is the creature's
 * whisper alone, and a card opens only when the person opens one.
 *
 * WHY THIS IS A SOURCE-LEVEL GATE, as before: the behaviour needs a returning
 * visitor, a fresh archive and real seconds of `setTimeout`; what can be held
 * exactly is what the greeting's effect commits to — it selects nothing and
 * moves no camera. (home-navigation.test.tsx holds the behaviour too.)
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

/** The greeting's own block: from its no-card note to the end of its effect. */
function greetingBlock(): string {
  const from = SRC.indexOf("THE GREETING NO LONGER OPENS A CARD");
  expect(from, "the greeting's note is where it was").toBeGreaterThan(-1);
  const to = SRC.indexOf("}, [inspirations, phase]);", from);
  expect(to, "the greeting effect still ends where it did").toBeGreaterThan(from);
  return SRC.slice(from, to);
}

describe("the greeting opens no card", () => {
  it("selects nothing and moves no camera — it only speaks", () => {
    const block = greetingBlock();
    expect(block.includes(".select("), "the greeting is selecting a memory again").toBe(false);
    expect(block.includes(".release("), "the greeting is releasing a selection it should never have made").toBe(false);
    expect(block.includes(".toTop("), "the greeting is moving the camera").toBe(false);
    expect(/setTimeout\(tell,/.test(block), "the greeting no longer tells").toBe(true);
  });

  it("has no glide to the newest memory left anywhere", () => {
    expect(SRC.includes("const newest = fresh.reduce"), "the greeting's glide to the newest memory is back").toBe(false);
  });
});
