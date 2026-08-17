/**
 * THE MEASURING TOOL'S OWN GUARD, PROVEN TO FIRE.
 *
 * WHAT THIS MOCKS, AND WHY: nothing. It runs the real
 * `scripts/measure-groups.mjs` as a real process against a real file on disk,
 * because the thing under test IS the wiring — that the guard is called at all,
 * that it reads the path it claims to read, and that it stops the run. A test
 * that imported the module could not check any of that, and importing it would
 * execute it. G6 in `docs/goals/a-codebase-you-can-navigate.md` asks every suite
 * to say what it stands on; this one stands on the file system and `node`.
 *
 * WHY IT EXISTS. `measure-groups.mjs` prints the numbers that decide whether a
 * candidate module may be extracted from `Home.tsx`, and it matches thirteen
 * hardcoded state-object names against that file by text. If one is renamed
 * there and not here, the name simply stops being counted — every row loses a
 * group, silently, in the direction that makes a boundary look cheaper than it
 * is. Drifting `stir` alone is enough to turn "4 group(s), so this FAILS" into
 * "3 group(s), so this PASSES". The script now checks the constant against the
 * real file on every run.
 *
 * But the check is one function call, and a reviewer's own experiment says the
 * quiet part: DELETING `assertGroupsAreReal()` — or `selftest()` beside it —
 * left the whole web suite green. This repo has been here before. A security
 * guard was once removed with 495 tests passing, and the lesson written down
 * afterwards was that a check nothing checks is a comment. So these three cases
 * are the check on the check: drift must stop the run and name the name, an
 * unreadable file must stop it too, and an honest file must let it through — the
 * last one so that "it always fails" cannot masquerade as safety.
 *
 * The doctored component is GENERATED from the script's own `GROUPS`, rather
 * than repeating the thirteen names here. A copy in this file would be a second
 * place to drift, and it would go red for the wrong reason the first time
 * someone legitimately adds a fourteenth owner.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const WEB_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = join(WEB_ROOT, "scripts", "measure-groups.mjs");

/** The thirteen names, read from the script rather than restated. */
function groupNames(source: string): string[] {
  const block = source.match(/const GROUPS = new Set\(\[([\s\S]*?)\]\)/);
  expect(block, "GROUPS declaration not found in measure-groups.mjs — did it move?").not.toBeNull();
  const names = [...block![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
  /* If this ever reads zero names the cases below would all pass vacuously,
     which is the exact shape of failure this file exists to prevent. */
  expect(names.length).toBeGreaterThan(1);
  return names;
}

/**
 * The floor the script refuses to measure below, also read rather than restated
 * — for the same reason as the names: a copy here is a second place to drift,
 * and it would go red for the wrong reason the day someone legitimately lowers
 * it after an extraction.
 */
function minRows(source: string): number {
  const found = source.match(/const MIN_PLAUSIBLE_ROWS = (\d+);/);
  expect(found, "MIN_PLAUSIBLE_ROWS not found in measure-groups.mjs — did it move?").not.toBeNull();
  return Number(found![1]);
}

/**
 * A component whose frame effect declares each named group at its top level —
 * the shape the real `Home.tsx` has, small enough to read. `omit` leaves one out,
 * which is what a rename looks like from the script's side.
 *
 * `functions` is how many measurable functions the effect declares. It exists
 * because the script now also refuses a report that came back implausibly small,
 * so the doctored file has to be plausible on THAT axis too: a one-function
 * component would make the drift case exit for the floor's reason while the
 * assertion about drift went on passing, which is a green light bought with the
 * wrong evidence.
 */
function componentDeclaring(
  names: string[],
  { omit = [], functions, plain = 0 }: { omit?: string[]; functions: number; plain?: number },
): string {
  const kept = names.filter((n) => !omit.includes(n));
  const decls = kept.map((n) => `    const ${n} = { t: 0 };`).join("\n");
  const read = kept.map((n) => `${n}.t`)[0] ?? "0";
  /* Each one reaches a group AND the component-body ref, so a unit built out of
     them has something in every column the `--unit` block prints — including
     the `[ref]` kind, which is the word that says "permanent accessor" and the
     whole point of that block. */
  const bodies = Array.from({ length: functions }, (_, i) =>
    [
      `    function tick${i}() {`,
      `      return ${read} + selectedIdRef.current;`,
      "    }",
    ].join("\n"),
  ).join("\n");
  /* Functions touching NO group, and named nothing `--only` matches by name.
     They are what makes a filter observable from outside the process: `--only
     <a group>` must drop exactly these rows from the table and must NOT drop
     them from the histogram or from the count in the header. */
  const plains = Array.from({ length: plain }, (_, i) =>
    [`    function plain${i}() {`, "      return 0;", "    }"].join("\n"),
  ).join("\n");
  return [
    "function HomeExperience() {",
    "  const selectedIdRef = useRef(null);",
    "  useEffect(() => {",
    decls,
    bodies,
    plains,
    "    return tick0;",
    "  }, []);",
    "  return null;",
    "}",
  ].join("\n");
}

/**
 * A fixture the script cannot possibly satisfy, pushed onto its own `SELFTEST`
 * list just before `selftest()` runs.
 *
 * This is how the last case below gets a REAL self-test failure to check the
 * handling of, without a second copy of the script that has been broken by hand
 * and can rot. `SELFTEST` is a `const` array, so pushing to it is legal, and the
 * push happens after every case is declared and before any is run.
 */
const PLANTED_FAILURE = {
  why: "PLANTED BY measure-groups-guard.test.ts — this case exists to fail",
  fn: "planted",
  expect: { groups: ["view"], freeOther: [], calls: [], outer: [] },
  src: [
    "function Home() {",
    "  useEffect(() => {",
    "    function planted() {",
    "      return 1;",
    "    }",
    "    return planted;",
    "  }, []);",
    "  return null;",
    "}",
  ].join("\n"),
};

function withAFailingFixture(source: string): string {
  const anchor = "\nselftest();\n";
  expect(
    source.includes(anchor),
    "the `selftest()` call is not where this test expects it — did it move?",
  ).toBe(true);
  return source.replace(anchor, `\nSELFTEST.push(${JSON.stringify(PLANTED_FAILURE)});\nselftest();\n`);
}

/**
 * The script resolves the file it checks from its OWN location — `../src/pages/
 * Home.tsx` — so a copy of it in a tree we control checks a file we control.
 * `node_modules` is linked in because the script requires `typescript`; nothing
 * else about the copy differs from the original.
 */
function runAgainst(
  home: string | null,
  transform: (source: string) => string = (s) => s,
  args: string[] = ["--selftest"],
): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "measure-groups-guard-"));
  try {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "src", "pages"), { recursive: true });
    symlinkSync(join(WEB_ROOT, "node_modules"), join(dir, "node_modules"), "dir");
    writeFileSync(join(dir, "scripts", "measure-groups.mjs"), transform(readFileSync(SCRIPT, "utf8")));
    if (home !== null) writeFileSync(join(dir, "src", "pages", "Home.tsx"), home);

    try {
      const out = execFileSync("node", [join(dir, "scripts", "measure-groups.mjs"), ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, out };
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      return { status: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

afterEach(() => {
  /* nothing persists: every case builds and removes its own tree */
});

describe("measure-groups checks its group names against the real file", () => {
  const source = readFileSync(SCRIPT, "utf8");

  it("stops the run and names EVERY group that has gone, not just the first", () => {
    const names = groupNames(source);
    /* Two, from opposite ends of the list. With one, `groupsNotDeclared(…)
       .slice(0, 1)` reported the same thing the honest code does and stayed
       green — and a rename pass is exactly the event that moves several at
       once, so a reader told about one would fix it, re-run, and be told about
       the next, believing each time they were nearly done. */
    const drifted = [names[0]!, names[names.length - 1]!];

    const { status, out } = runAgainst(
      componentDeclaring(names, { omit: drifted, functions: minRows(source) }),
    );

    expect(status).toBe(1);
    expect(out).toContain("GROUPS HAS DRIFTED");
    /* By name. A gate that says "something is wrong" sends the reader looking;
       this one has to say which of the thirteen stopped existing. */
    for (const name of drifted) expect(out).toContain(name);
    /* And it says what the silent version of this would have cost, because the
       number moving is the whole reason the check is here. */
    expect(out).toContain("FAILS");
  });

  it("lets an honest file through, so the check is not merely always red", () => {
    const names = groupNames(source);

    const { status, out } = runAgainst(componentDeclaring(names, { functions: minRows(source) }));

    expect(status).toBe(0);
    /* The self-test ran too. Deleting the `selftest()` call is as silent a
       removal as deleting the drift check, and this line is the evidence it
       happened: it names how many cases in each family, so an emptied fixture
       list shows up as a number rather than as nothing at all. */
    expect(out).toMatch(
      /self-test passed \(\d+ row cases, \d+ unit cases, \d+ argument cases, \d+ printing cases\)/,
    );
    /* And it STOPPED there. `--selftest` is what `pnpm test` runs, and losing
       the early exit turns every test run into eighty-odd lines of table — a
       report nobody asked for, in a place nobody reads, which is how a real
       failure message gets scrolled past. */
    expect(out).not.toContain("functions declared in the frame effect");
  });

  it("treats a file it cannot read as a failure, never as a pass", () => {
    const { status, out } = runAgainst(null);

    expect(status).toBe(1);
    expect(out).toContain("cannot read");
    /* The distinction that matters: unread is not the same as unchanged. */
    expect(out).toContain("thirteen unverified strings");
  });

  /**
   * The floor, from the side that proves it is a floor. Every group name is
   * present here, so the drift check passes and this is the only thing left to
   * refuse. Without a case like this the number is a comment: the script's own
   * fixtures are all one to four functions long, so nothing else in the suite
   * ever produces a report small enough to test it.
   */
  it("refuses a report too small to be the frame effect, with every name present", () => {
    const names = groupNames(source);

    const { status, out } = runAgainst(componentDeclaring(names, { functions: 1 }));

    expect(status).toBe(1);
    expect(out).not.toContain("GROUPS HAS DRIFTED");
    expect(out).toContain("ONLY 1 FUNCTIONS FOUND");
    /* It has to say what to do about it, because the legitimate version of this
       — 4b and 4c shrinking the effect — looks identical from here. */
    expect(out).toContain("MIN_PLAUSIBLE_ROWS");
  });

  /**
   * AND A FAILING SELF-TEST HAS TO STOP THE RUN.
   *
   * The `self-test passed` assertion above is evidence that `selftest()` was
   * CALLED. It is not evidence that failing it costs anything, and the two came
   * apart: changing the `process.exit(1)` inside the failure branch to
   * `exit(0)` left the whole suite green, because on an honest tree that branch
   * is never taken. The hole only opens later, when a fixture genuinely breaks
   * — and then `pnpm test` prints "SELF-TEST FAILED", continues into vitest, and
   * reports success. A previous reviewer checked this mutation and recorded it
   * as caught; it was not.
   *
   * So this case gives the script a fixture it cannot satisfy and demands the
   * run die. It is the difference between "the guard is called" and "the guard
   * has teeth", which is the failure mode this whole file exists for.
   */
  /**
   * AND THE TWO LINES THAT ACTUALLY PUT IT ON SCREEN.
   *
   * Every round of this gate has ended the same way: the pure function gets
   * extracted and asserted, and the layer CALLING it does not, so the next break
   * simply moves up one. The script's own fixtures now assert the header block
   * and the table as text, which means the last unchecked thing is the pair of
   * `for (…) console.log(line)` calls at the bottom and the arguments handed to
   * them — and all three ways of breaking those stayed green: deleting the
   * header loop, deleting the table loop, and passing `null` where
   * `onlyFilter(process.argv)` belongs.
   *
   * That is a place to stop rather than one more level to climb, because this
   * case is outside the process: it runs the real script with no `--selftest`,
   * against a file it controls, and reads what came out of stdout. Nothing about
   * the printing is left between here and a terminal.
   *
   * The numbers are all derived from the doctored file rather than recorded, so
   * this does not become a golden file that churns.
   */
  it("prints the header, the table and the filtered table, end to end", () => {
    const names = groupNames(source);
    const ticks = minRows(source);
    const plains = 3;
    const home = componentDeclaring(names, { functions: ticks, plain: plains });
    /* `useEffect` is the third line of that component, every time. */
    const header = `${ticks + plains} functions declared in the frame effect (line 3).`;
    const rowsFor = (out: string, prefix: string) =>
      out.split("\n").filter((l) => new RegExp(`^${prefix}\\d+ `).test(l)).length;

    const full = runAgainst(home, undefined, []);
    expect(full.status).toBe(0);
    expect(full.out).toContain(header);
    expect(full.out).toContain("Every object declared at the effect's top level is a tracked group.");
    expect(rowsFor(full.out, "tick")).toBe(ticks);
    expect(rowsFor(full.out, "plain")).toBe(plains);

    /* `--only <a group>` keeps the rows that touch it and drops the rest — and
       the histogram underneath still describes the whole file, which is the one
       thing that made feeding it the filtered rows invisible. */
    const filtered = runAgainst(home, undefined, ["--only", names[0]!]);
    expect(filtered.status).toBe(0);
    expect(rowsFor(filtered.out, "tick")).toBe(ticks);
    expect(rowsFor(filtered.out, "plain")).toBe(0);
    expect(filtered.out).toContain(`  0: ${"#".repeat(plains)} (${plains})`);
    /* The count above the table is the file's, not the filter's. */
    expect(filtered.out).toContain(header);
  });

  /**
   * AND `--unit`, WHICH IS THE PATH THE WHOLE TOOL EXISTS FOR.
   *
   * `summariseUnit` and `formatUnit` are asserted inside the script from both
   * sides of the gate. The five lines of command line that reach them were not,
   * and every one of them broke green: deleting the block outright, handing
   * `summariseUnit` an empty member set, handing `formatUnit` an empty component
   * scope so every `[ref]` became `[?]`, ignoring `unitMembers`, and feeding the
   * unit the rows `--only` left rather than the whole report — which silently
   * turns a member into "NOT FOUND" and makes the unit look smaller and
   * therefore cheaper. That is the nine-versus-fifteen failure exactly, arrived
   * at through the argument list instead of the walk.
   *
   * Both flags at once, because the unit must be measured from the FULL report
   * while the table beside it is filtered.
   */
  it("measures the unit named by --unit, from the whole report, with kinds", () => {
    const names = groupNames(source);
    const home = componentDeclaring(names, { functions: minRows(source), plain: 3 });

    const { status, out } = runAgainst(home, undefined, [
      "--only",
      names[0]!,
      "--unit",
      "tick0,plain0",
    ]);

    expect(status).toBe(0);
    /* `plain0` is a row `--only` drops from the TABLE and must not drop from the
       unit: two functions, four lines, and no NOT FOUND. */
    expect(out).toContain("UNIT: 2 functions, 4 lines");
    expect(out).not.toContain("NOT FOUND");
    expect(out).toContain(`  state groups needed (1): ${names[0]}`);
    expect(out).toContain("  calls back into the file (0): ");
    expect(out).toContain("  other free names (0): ");
    /* The kind, which only the component scope can supply. */
    expect(out).toContain("  reaches past the effect (1): selectedIdRef[ref]");
    expect(out).toContain("  → a deps object of about 1 members.");
    expect(out).toContain(
      "  GATE: four or more groups means it is not a module — 1 group(s), so this PASSES.",
    );
  });

  /**
   * `--file` REALLY AIMS THE MEASUREMENT, and an absence is still said as one.
   *
   * `targetFile` is asserted as a pure function, but nothing proved the command
   * line calls it: replacing `targetFile(process.argv, REAL_HOME)` with
   * `REAL_HOME` measured `Home.tsx` while the reader believed they were looking
   * at whatever they pointed it at — and that affordance is how the
   * nine-versus-fifteen fix was verified in the first place, so a wrong answer
   * there discredits the verification and not merely a run.
   *
   * The file it is aimed at has no effect hook, which also pins the other half:
   * the tool must say so in a sentence. `measure` returning nulls is covered by
   * a fixture; the branch in the command-line block that turns that into English
   * instead of an empty table under a confident header was not, and an empty
   * table reads like an answer.
   */
  it("measures the file --file names, and calls an absence an absence", () => {
    const names = groupNames(source);
    const dir = mkdtempSync(join(tmpdir(), "measure-groups-elsewhere-"));
    try {
      const elsewhere = join(dir, "no-effect.tsx");
      writeFileSync(
        elsewhere,
        ["function Other() {", "  const someRef = useRef(0);", "  return someRef;", "}"].join("\n"),
      );

      const { status, out } = runAgainst(
        componentDeclaring(names, { functions: minRows(source) }),
        undefined,
        ["--file", elsewhere],
      );

      expect(status).toBe(0);
      expect(out).toContain(`No effect hook found in ${elsewhere}`);
      /* It measured THAT file, not the one next to the script: no table, and
         none of the doctored component's rows. */
      expect(out).not.toContain("groups touched");
      expect(out).not.toContain("tick0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dies when a fixture genuinely fails, rather than printing and carrying on", () => {
    const names = groupNames(source);

    const { status, out } = runAgainst(
      componentDeclaring(names, { functions: minRows(source) }),
      withAFailingFixture,
    );

    expect(status).toBe(1);
    expect(out).toContain("SELF-TEST FAILED");
    /* By name, and the planted case is the one that failed — not something else
       that happened to break while the plant went through unnoticed. */
    expect(out).toContain(PLANTED_FAILURE.why);
    /* And the success line must NOT also be there: a run that prints both has
       fallen through the failure branch instead of stopping in it. */
    expect(out).not.toContain("self-test passed");
  });
});
