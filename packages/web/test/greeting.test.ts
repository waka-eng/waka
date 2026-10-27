/**
 * Arrival never opens a card. Top of Mind remains the default; prompts change
 * only when requested. home-poster.test.tsx exercises the arrival behavior.
 *
 * WHAT THIS MOCKS, AND WHY: nothing. This source guard holds the removal of
 * the old automatic glide to the newest memory.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/pages/Home.tsx"),
  "utf8",
);

describe("arrival opens no card", () => {
  it("has no glide to the newest memory left anywhere", () => {
    expect(SRC.includes("const newest = fresh.reduce"), "the greeting's glide to the newest memory is back").toBe(false);
  });
});
