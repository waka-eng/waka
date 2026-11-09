/**
 * ONE QUESTION, ASKED ONE WAY: "does this person want stillness?"
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads source files. The
 * answer lives in `lib/motion.ts`'s `prefersStillness()`, which guards a
 * missing window and a `matchMedia` that throws; a copy of the query beside
 * it is a copy that can forget either.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const CALLERS = [
  "components/Companion.tsx",
  "components/WalkingCompanion.tsx",
  "components/onboarding/CreatureStage.tsx",
  "components/onboarding/OnboardingQuestion.tsx",
  "components/onboarding/SayBubble.tsx",
];

it("asks prefersStillness() rather than matching the media query itself", () => {
  const copied = CALLERS.filter((file) => readFileSync(resolve(SRC, file), "utf8").includes("prefers-reduced-motion: reduce"));
  expect(copied, "these ask the reduced-motion query themselves; use `prefersStillness()` from lib/motion").toEqual([]);
  const asking = CALLERS.filter((file) => /prefersStillness\(\)/.test(readFileSync(resolve(SRC, file), "utf8")));
  expect(asking).toEqual(CALLERS);
});
