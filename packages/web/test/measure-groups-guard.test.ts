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
 * A component whose frame effect declares each named group at its top level —
 * the shape the real `Home.tsx` has, small enough to read. `omit` leaves one out,
 * which is what a rename looks like from the script's side.
 */
function componentDeclaring(names: string[], omit?: string): string {
  const decls = names
    .filter((n) => n !== omit)
    .map((n) => `    const ${n} = { t: 0 };`)
    .join("\n");
  return [
    "function HomeExperience() {",
    "  const selectedIdRef = useRef(null);",
    "  useEffect(() => {",
    decls,
    "    function tick() {",
    `      return ${names.filter((n) => n !== omit).map((n) => `${n}.t`)[0] ?? "0"};`,
    "    }",
    "    return tick;",
    "  }, []);",
    "  return null;",
    "}",
  ].join("\n");
}

/**
 * The script resolves the file it checks from its OWN location — `../src/pages/
 * Home.tsx` — so a copy of it in a tree we control checks a file we control.
 * `node_modules` is linked in because the script requires `typescript`; nothing
 * else about the copy differs from the original.
 */
function runAgainst(home: string | null): { status: number; out: string } {
  const dir = mkdtempSync(join(tmpdir(), "measure-groups-guard-"));
  try {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    mkdirSync(join(dir, "src", "pages"), { recursive: true });
    symlinkSync(join(WEB_ROOT, "node_modules"), join(dir, "node_modules"), "dir");
    writeFileSync(join(dir, "scripts", "measure-groups.mjs"), readFileSync(SCRIPT, "utf8"));
    if (home !== null) writeFileSync(join(dir, "src", "pages", "Home.tsx"), home);

    try {
      const out = execFileSync("node", [join(dir, "scripts", "measure-groups.mjs"), "--selftest"], {
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

  it("stops the run and names the group that has gone", () => {
    const names = groupNames(source);
    const drifted = names[0]!;

    const { status, out } = runAgainst(componentDeclaring(names, drifted));

    expect(status).toBe(1);
    expect(out).toContain("GROUPS HAS DRIFTED");
    /* By name. A gate that says "something is wrong" sends the reader looking;
       this one has to say which of the thirteen stopped existing. */
    expect(out).toContain(drifted);
    /* And it says what the silent version of this would have cost, because the
       number moving is the whole reason the check is here. */
    expect(out).toContain("FAILS");
  });

  it("lets an honest file through, so the check is not merely always red", () => {
    const names = groupNames(source);

    const { status, out } = runAgainst(componentDeclaring(names));

    expect(status).toBe(0);
    /* The self-test ran too. Deleting the `selftest()` call is as silent a
       removal as deleting the drift check, and this line is the evidence it
       happened: it names how many cases, so an emptied fixture list shows up as
       a number rather than as nothing at all. */
    expect(out).toMatch(/self-test passed \(\d+ row cases, \d+ unit cases, \d+ argument cases\)/);
  });

  it("treats a file it cannot read as a failure, never as a pass", () => {
    const { status, out } = runAgainst(null);

    expect(status).toBe(1);
    expect(out).toContain("cannot read");
    /* The distinction that matters: unread is not the same as unchanged. */
    expect(out).toContain("thirteen unverified strings");
  });
});
