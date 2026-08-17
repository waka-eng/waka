/**
 * THE ONE THING THE SEAM GATE CANNOT PROVE ABOUT ITSELF.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. It runs
 * `scripts/check-seams.mjs` as a real process and reads what it printed, so
 * there is no layer between this file and its subject to replace. Replacing
 * anything would mean asserting against a gate this package does not run.
 *
 * WHY IT IS NOT INSIDE THAT FILE. The gate proves itself: thirty-odd audit
 * cases, a fixture tree walked by its own scan loop, and four runs of itself
 * as a child process. A review still found a mutation none of that can catch —
 * deleting the CALL to the self-test. A self-test that is never invoked prints
 * nothing at all, and a gate that skipped it would report `clean` in exactly
 * the words a gate that had proved itself uses. Nothing inside a checker can
 * check that the checker ran; the question has to be asked from outside, which
 * is what this file is.
 *
 * That is the same shape as every failure this project has had a gate for: the
 * vocabulary gate clean over half of `Home.tsx`, a suite passing while
 * describing the dev fixture, a security guard deletable with everything
 * green. In each of them the check existed and the thing that decides whether
 * the check RUNS was unexamined.
 *
 * The second case asks the other half of the same question: whether `pnpm
 * test` still invokes the gate at all. A gate dropped from that one line is a
 * gate that has stopped existing, and the only visible symptom is two lines
 * missing from output nobody reads closely.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

describe("the seam gate", () => {
  it("proves itself before it says anything about this package", () => {
    const printed = execFileSync(
      process.execPath,
      [join(PACKAGE_ROOT, "scripts", "check-seams.mjs")],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );

    /* The counts are read out of the line rather than hard-coded, because what
       is being asserted is that the self-test RAN and had cases to run, not
       how many there are this week. */
    const proof = printed.match(
      /self-test passed \((\d+) audit cases, a (\d+)-suite scan over the real walk, (\d+) end-to-end runs\)/,
    );
    expect(proof, `the gate printed no proof of itself:\n${printed}`).not.toBeNull();
    expect(Number(proof![1])).toBeGreaterThan(20);
    expect(Number(proof![2])).toBeGreaterThan(0);
    expect(Number(proof![3])).toBeGreaterThan(0);

    /* And in that order. A gate that reported its verdict first and proved
       itself afterwards would have already printed `clean` by the time it
       discovered it was blind. */
    expect(printed).toMatch(/clean — \d+ suites/);
    expect(printed.indexOf("self-test passed")).toBeLessThan(printed.indexOf("clean —"));
  }, 30_000);

  it("is still wired into `pnpm test`, in a way that can fail the run", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    const script: string = manifest.scripts.test;
    const invocation = "node scripts/check-seams.mjs";

    expect(script).toContain(invocation);

    /* And its exit status has to still mean something. Whatever follows the
       gate must be `&&` or nothing at all: joined with `;` or swallowed by
       `||`, the gate would print its failures into a passing run, which is
       the same silence as not running it. Where it sits in the line is not
       the point and is left free. */
    const after = script.slice(script.indexOf(invocation) + invocation.length).trim();
    expect(after === "" || after.startsWith("&&")).toBe(true);
  });
});
