/**
 * THE THINGS THE SEAM GATE CANNOT PROVE ABOUT ITSELF.
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
 * THE THREE CASES ASK THREE DIFFERENT QUESTIONS, and keeping them apart is the
 * repair of a conflation this file used to carry. The first is about the GATE:
 * did it prove itself, and did it do that before saying anything about this
 * package. The second is about the PACKAGE: are its suites all declared, and —
 * the half nothing used to ask — did the gate actually read every suite vitest
 * will run, rather than a subset it had quietly stopped walking. A gate with
 * one file dropped from its view prints `clean` in the same words as a gate
 * with none, and the count it prints was compared to nothing. The third asks
 * whether `pnpm test` still invokes it at all: a gate dropped from that one
 * line is a gate that has stopped existing, and the only visible symptom is
 * two lines missing from output nobody reads closely.
 *
 * When the first case is the only one failing, the gate is broken. When the
 * second is, this package is. They used to be one case under a heading about
 * the gate, so a genuine violation staged in any suite made the gate look like
 * the thing at fault — the same conflation `endToEnd` in that file refuses,
 * three lines from where it says so.
 *
 * WHAT THIS FILE STILL CANNOT SEE, since it exists to say that about its
 * subject and owes the same about itself:
 *
 *   - The second case compares HOW MANY suites the gate read with how many
 *     vitest will collect, not WHICH. A gate that read thirteen different
 *     files would pass it. That is not idle: pointing the scan one directory
 *     too high makes it read a set of the same size with every path wrong.
 *     What catches that today is inside the gate — its end-to-end layer
 *     asserts whole reported paths, so a doubled prefix is red there. Closing
 *     it here would mean the gate printing the list it read, which is a second
 *     output mode to prove; the exchange was judged the wrong way round for
 *     one number.
 *   - It reads `include` AND `exclude` out of `vitest.config.ts` with a regular
 *     expression, and globs both. Reading `include` alone was a live hole with
 *     the same shape as the case itself: `exclude: ["test/when.test.ts"]` drops
 *     a suite from the run — 12 files, 99 tests — while the gate still reads 13
 *     and 13 still equals 13, so a suite left the run with this file green. If
 *     either list ever stops being literal strings on one line, this case fails
 *     loudly rather than silently, which is why the parse is asserted rather
 *     than defaulted: a field that is mentioned and unreadable is not the same
 *     fact as a field that is absent, and only the second one is empty.
 *
 *     What that still does not reach is a run whose file set is decided
 *     somewhere other than these two keys — `test.projects`, a workspace file,
 *     or a pattern typed on the command line. Those change what vitest
 *     collects without changing this config, and this case would compare the
 *     gate against a run that did not happen. None is used in this package.
 *   - The `pnpm test` case reads the SHAPE of the chain, not the behaviour of
 *     its links. Every stage must be joined by `&&` and the gate must be one of
 *     them, which is what stops the gate being backgrounded, `;`-joined or
 *     swallowed by `||`. A stage that cannot fail — a leading `exit 0 &&` — is
 *     a chain of `&&` by this reading and never reaches the gate. Closing it
 *     means running the line, which means a test that runs the whole suite to
 *     check that the suite runs; the shape check is where this stops.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A GLOB WE OWN, BECAUSE `fs.globSync` IS NOT EVERYWHERE.
 *
 * This file used `fs.globSync`, which arrived in Node 22. It passed on a
 * developer machine and failed in CI with `globSync is not a function`, because
 * CI pins Node 20 (`.github/workflows/ci.yml`, `NODE_VERSION`). Green locally
 * and red on the runner is the worst version of a broken test: the person who
 * wrote it has no reason to look.
 *
 * Bumping the runner was the other option and was rejected — the same variable
 * feeds the deploy workflows, so a test-only problem would have moved the Node
 * version production is built with.
 *
 * It handles what a vitest `include`/`exclude` actually contains: a literal
 * path, `*` within one segment, and `**` across segments. Anything richer is
 * not in these lists, and a pattern this does not understand simply matches
 * nothing — which the count assertion below turns into a loud failure rather
 * than a silent narrowing.
 */
function globFiles(pattern: string, cwd: string): string[] {
  const rx = new RegExp(
    "^" +
      pattern
        .split(/(\*\*\/|\*\*|\*|\?)/)
        .map((part) => {
          if (part === "**/") return "(?:[^/]+/)*";
          if (part === "**") return ".*";
          if (part === "*") return "[^/]*";
          if (part === "?") return "[^/]";
          return part.replace(/[.+^${}()|[\]\\]/g, "\\$&");
        })
        .join("") +
      "$",
  );

  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith("."))
        continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const rel = relative(cwd, full).split("\\").join("/");
        if (rx.test(rel)) found.push(rel);
      }
    }
  };
  walk(cwd);
  return found;
}

/**
 * Run the gate and hand back everything it said, whatever it exited with.
 *
 * `spawnSync` rather than `execFileSync`, because a gate that has found a real
 * violation exits 1, and a helper that throws on that turns "this package has
 * a problem" into "this test could not be run" — which is how the two subjects
 * above got mixed up in the first place.
 */
function runGate() {
  const run = spawnSync(process.execPath, [join(PACKAGE_ROOT, "scripts", "check-seams.mjs")], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" };
}

/**
 * One list of file patterns out of `vitest.config.ts`, by name.
 *
 * ABSENCE IS READ FROM THE TEXT, NOT ASSUMED. A field that is not mentioned at
 * all is genuinely empty and returns nothing; a field that IS mentioned and
 * cannot be parsed makes this throw, rather than returning the empty list and
 * quietly meaning "no exclusions". Those two are the same value and opposite
 * facts, and treating them alike is how the `exclude` hole below got written:
 * an unread list defaulted to nothing excluded, which is exactly what a
 * silently narrowed run looks like from here.
 */
function patternsIn(config: string, field: "include" | "exclude"): string[] {
  if (!new RegExp(`\\b${field}\\s*:`).test(config)) return [];
  const list = config.match(new RegExp(`\\b${field}\\s*:\\s*\\[([^\\]]*)\\]`));
  expect(
    list,
    `vitest.config.ts states an \`${field}\` this test cannot read — teach it the ` +
      "new spelling rather than deleting the check, or the run it describes stops " +
      "being the run that happens",
  ).not.toBeNull();
  const patterns = [...list![1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  expect(
    patterns.length,
    `\`${field}\` in vitest.config.ts is stated but parsed to no patterns`,
  ).toBeGreaterThan(0);
  return patterns;
}

/**
 * FLOORS, NOT A CENSUS.
 *
 * What is being asserted is that each layer of the self-test still ran with
 * something in it, not how many cases there are this week — so these can only
 * fail by going DOWN. Adding a case, a fixture suite or a child run costs
 * nothing here; deleting one is the mutation, and every one of them was a
 * mutation that used to survive. The last two are the numbers that file's own
 * header describes: a seven-suite fixture tree, and four runs of itself.
 */
const FLOOR = { auditCases: 20, fixtureSuites: 7, endToEndRuns: 4 };

describe("the seam gate", () => {
  it("proves itself, and does that before it says anything about this package", () => {
    const gate = runGate();
    const printed = gate.stdout;

    /* The counts are read out of the line rather than hard-coded, because what
       is being asserted is that the self-test RAN and had cases to run. Each
       of the three is now a receipt written by the work itself — the audit
       loop, the fixture walk, the line that spawns a child — so a layer that
       has been deleted or switched off moves a number here rather than
       printing the same sentence about work it did not do. */
    const proof = printed.match(
      /self-test passed \((\d+) audit cases, a (\d+)-suite scan over the real walk, (\d+) end-to-end runs\)/,
    );
    expect(
      proof,
      `the gate printed no proof of itself:\n${printed}\n${gate.stderr}`,
    ).not.toBeNull();
    expect(Number(proof![1]), "audit cases").toBeGreaterThanOrEqual(FLOOR.auditCases);
    expect(Number(proof![2]), "suites walked in the fixture tree").toBeGreaterThanOrEqual(
      FLOOR.fixtureSuites,
    );
    expect(Number(proof![3]), "runs of itself as a child process").toBeGreaterThanOrEqual(
      FLOOR.endToEndRuns,
    );

    /* And in that order. A gate that reported its verdict first and proved
       itself afterwards would have already printed `clean` by the time it
       discovered it was blind. A verdict of "not clean" goes to stderr, where
       it cannot be ordered against stdout from here — but that is the run
       where nobody is being reassured, and the gate's own end-to-end layer
       asks the same question of the same stream. */
    const clean = printed.indexOf("seams: clean —");
    if (clean !== -1) {
      expect(printed.indexOf("self-test passed")).toBeLessThan(clean);
    }
  }, 30_000);

  it("reads every suite in this package, and finds nothing to report about them", () => {
    const gate = runGate();

    /* WHICH FILES VITEST WILL COLLECT, asked of the same config vitest reads
       rather than of a pattern copied into this file. A copy would agree with
       the gate for the same wrong reason on the day either one narrowed. */
    const config = readFileSync(join(PACKAGE_ROOT, "vitest.config.ts"), "utf8");
    const patterns = patternsIn(config, "include");
    expect(patterns.length, "no include patterns found in vitest.config.ts").toBeGreaterThan(0);

    /* AND WHAT IT TAKES BACK OUT. This used to read `include` alone, and the
       count check passed while a suite was gone: `exclude: ["test/when.test.ts"]`
       dropped that file to 12 files / 99 tests, the gate still read 13, 13
       equalled 13, and the whole package was green — the exact quiet narrowing
       this case exists for, arriving through the one line it was not reading.
       Both lists are globbed with the same globber against the same directory
       and subtracted, so a literal path and a pattern are handled the same
       way. */
    const dropped = new Set(
      patternsIn(config, "exclude").flatMap((pattern) => globFiles(pattern, PACKAGE_ROOT)),
    );
    const collected = new Set(
      patterns
        .flatMap((pattern) => globFiles(pattern, PACKAGE_ROOT))
        .filter((file) => !dropped.has(file)),
    );

    expect(
      gate.stdout,
      `the gate did not report this package clean:\n${gate.stderr}`,
    ).toMatch(/clean — \d+ suites/);
    expect(gate.status, "a clean report has to leave with a clean exit code").toBe(0);

    /* THE NUMBER IT PRINTS, AGAINST THE NUMBER OF FILES THAT EXIST. Nothing
       related those two before, so any narrowing of the gate's own walk — one
       file dropped by a pattern, a directory it stopped entering, an allowlist
       added in a hurry — left it reporting `clean` over a package it was no
       longer reading all of. That is this gate's own history twice over, and
       the vocabulary gate's beside it. It is also why the check is an equality
       and not a floor: a gate reading MORE files than vitest runs is reporting
       on suites nobody executes, which is its own kind of untrue. */
    const counted = Number(gate.stdout.match(/clean — (\d+) suites/)![1]);
    expect(
      counted,
      `the gate read ${counted} suites; vitest will collect ${collected.size}: ` +
        `${JSON.stringify([...collected].sort())}`,
    ).toBe(collected.size);
  }, 30_000);

  it("is still wired into `pnpm test`, in a way that can fail the run", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8"));
    const script: string = manifest.scripts.test;
    const invocation = "node scripts/check-seams.mjs";

    /* EVERY STAGE `&&`-JOINED, ON BOTH SIDES OF THE GATE. Checking only what
       FOLLOWS the invocation looked right and was not: `vocabulary || seams &&
       vitest` puts a `&&` after the gate and still never runs it, because sh
       reads that as `(vocabulary || seams) && vitest` and the vocabulary gate
       passes. So the whole line has to be a chain of `&&` with the gate as one
       of its links — nothing joined by `;`, nothing swallowed by `||`, nothing
       backgrounded. Where in the chain it sits is not the point and is left
       free. */
    const stages = script.split("&&").map((stage) => stage.trim());
    expect(stages, `\`pnpm test\` is \`${script}\``).toContain(invocation);
    expect(
      stages.join(" "),
      `something other than \`&&\` joins the stages of \`${script}\``,
    ).not.toMatch(/[|;&]/);
  });
});
