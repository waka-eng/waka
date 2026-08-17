/**
 * THE ALARM ON THE FIXTURE, PROVEN TO GO OFF.
 *
 * WHAT THIS MOCKS, AND WHY: nothing. There is no layer under it to mock —
 * `lib/fixture/offline-home.ts` reaches no network, no database and no clock
 * it did not read itself, which is the one thing that makes it safe to call
 * from a test at all. G6 in `docs/goals/a-codebase-you-can-navigate.md` asks
 * every suite to say this; here the answer is short.
 *
 * WHY IT EXISTS. G6 exists because a suite once passed while describing that
 * fixture: it mocked `lib/api` instead of `lib/data`, the loader threw, the
 * page did what it is built to do and replaced the world with invented rows,
 * and every assertion held against a world no product code had produced. The
 * fixture now warns on its way past, so that failure would announce itself in
 * the test output.
 *
 * G7 is why this file is here rather than a note saying the warning exists.
 * "Nothing green is blind" — an alarm nobody has heard is an alarm nobody has
 * checked, and this repo has already had one gate that was clean over half a
 * file because it was only ever proven at one place. So this asserts both
 * halves: that the fixture announces itself, and that the announcement names
 * the mistake that produces it, since a warning that says only "fixture" sends
 * the reader looking for a config flag rather than at their own mock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { offlineHome } from "../src/lib/fixture/offline-home";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the offline fixture", () => {
  it("says out loud that nothing it returns is real", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const home = offlineHome();

    /* Vitest sets DEV, so this is the branch that hands a world back. If this
       is ever null the test below is vacuous, which is the failure mode this
       assertion exists to prevent. */
    expect(home).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);

    const said = String(warn.mock.calls[0]?.[0] ?? "");
    expect(said).toContain("THE DEV FIXTURE IS ON SCREEN");
    /* the sentence that turns a warning into an instruction */
    expect(said).toContain("mock lib/data, not lib/api");
  });

  it("warns every time it is asked, not only the first", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    offlineHome();
    offlineHome();

    /* A once-per-process warning would be silent for every test after the
       first in the same file — which is exactly the run where a suite is most
       likely to be describing the fixture without knowing it. */
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

/**
 * AND THE FIXTURE CANNOT BE SHIPPED BY A BUILD FLAG.
 *
 * A reviewer reading `docs/map.md` found that the agent-wall fixture was gated
 * on `DEV === true || VITE_SHOW_INTERNAL === "1"`. The second clause is a
 * build-time variable Vite inlines, so `VITE_SHOW_INTERNAL=1 vite build`
 * produced a PRODUCTION bundle that showed fabricated agent memories to real
 * people as their own. Nothing guarded it, and the comment beside it noted that
 * shipping invented memories had already happened once — while leaving open the
 * flag that would do it again.
 *
 * The gate is now `DEV` alone. This is the check that keeps it there, because
 * the mistake is not exotic: `showsDebug()` two files away still uses the wider
 * rule legitimately, and copying it back here would look like consistency.
 *
 * It reads the SOURCE rather than importing the value, deliberately. Under
 * vitest `import.meta.env.DEV` is true, so an imported `MOCK_AGENTS` is `true`
 * either way and a test on it would pass no matter which condition produced it
 * — green, and blind, which is the failure this repo keeps finding.
 */
describe("invented data cannot reach a production build", () => {
  /**
   * WHY THIS SCANS THE DIRECTORY INSTEAD OF NAMING A FILE.
   *
   * The first version of this test read ONE declaration in ONE file. It was
   * written the day `MOCK_AGENTS` was found gated on `showsDebug()` — which
   * honours `VITE_SHOW_INTERNAL`, a build-time flag Vite inlines — and it
   * pinned that one line.
   *
   * Its sibling `offlineHome()` was calling `showsDebug()` the whole time and
   * this test could not see it, because it was not looking there. A reviewer
   * ran `VITE_SHOW_INTERNAL=1 vite build` and read the fixture back out of the
   * compiled bundle: a signed-out visitor, on any 401, was shown two dozen
   * invented memories painted as their own world instead of the door.
   *
   * So the instance was fixed and the class was left open, and the test that
   * was supposed to hold the line was green throughout. It now walks every
   * file under `src/lib/fixture/` and asserts about all of them, so a new
   * fixture is covered the moment it exists rather than the moment somebody
   * remembers to add it here.
   */
  const fixtureDir = new URL("../src/lib/fixture/", import.meta.url);

  /** The one predicate a fixture may gate on. `DEV` is statically false in a
      production build, so the invented rows become dead code the bundler
      drops — a structural guarantee rather than a promise. */
  const ALLOWED_GATE = "inventedDataAllowed";
  /** The wider rule. Correct for a debug pill, never for invented data. */
  const FORBIDDEN_GATE = "showsDebug";

  const fixtureFiles = async () => {
    const { readdirSync } = await import("node:fs");
    return readdirSync(fixtureDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
  };

  it("finds fixture files to check — 'nothing to check' is not a pass", async () => {
    /* The conditional-assertion trap this repo has hit before: a scan whose
       assertions all sit behind a match silently passes when it matches
       nothing. Assert the subject exists first. */
    expect((await fixtureFiles()).length).toBeGreaterThan(1);
  });

  it("gates every fixture on DEV alone, never on a flag a build can set", async () => {
    const { readFileSync } = await import("node:fs");
    const offenders: string[] = [];

    for (const file of await fixtureFiles()) {
      const src = readFileSync(new URL(file, fixtureDir), "utf8");
      /* Comments legitimately DISCUSS showsDebug — both files explain why they
         do not use it — so only code is judged. Block and line comments out. */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
      if (code.includes(FORBIDDEN_GATE)) offenders.push(`${file} calls ${FORBIDDEN_GATE}()`);
      if (code.includes("VITE_SHOW_INTERNAL")) offenders.push(`${file} reads VITE_SHOW_INTERNAL`);
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the two known fixture entry points on the narrow gate", async () => {
    /* Named explicitly as well as scanned, so that deleting a gate outright —
       which the scan above would read as clean — still fails. */
    const { readFileSync } = await import("node:fs");
    const agents = readFileSync(new URL("agent-walls.ts", fixtureDir), "utf8");
    const offline = readFileSync(new URL("offline-home.ts", fixtureDir), "utf8");

    expect(agents).toMatch(new RegExp(`MOCK_AGENTS\\s*=\\s*${ALLOWED_GATE}\\(\\)`));
    expect(offline).toMatch(new RegExp(`if\\s*\\(!${ALLOWED_GATE}\\(\\)\\)\\s*return null`));
  });

  it("defines the narrow gate as DEV and nothing else", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("../src/lib/dev-build.ts", import.meta.url), "utf8");
    const body = src.match(
      new RegExp(`export function ${ALLOWED_GATE}\\(\\): boolean \\{([^}]*)\\}`),
    );
    expect(body, `${ALLOWED_GATE} not found — did it move?`).not.toBeNull();
    expect(body![1]!.trim()).toBe("return import.meta.env.DEV === true;");
  });
});
