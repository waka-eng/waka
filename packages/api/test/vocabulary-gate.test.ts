import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

/**
 * THE VOCABULARY GATE, RUN AS A PROCESS.
 *
 * `scripts/check-vocabulary.mjs` carries a large self-test, and everything that
 * self-test can reach is a pure function it calls directly. What it cannot
 * reach is itself: the gate decides its own verdict and prints its own report,
 * so a check inside it that has been DELETED and a check that PASSES produce
 * identical output. Both of the surviving mutations in that file's mutation
 * pass were of exactly that shape — `const unscanned = []` and
 * `const stale = []` each ran fully green, with the self-test reporting every
 * case correct, because on a clean tree neither check has anything to say.
 *
 * The only thing that can tell those apart is a tree the gate MUST reject. So
 * these run the real script, as a process, against trees built here, and assert
 * it exits non-zero and says why. That is also the one place the whole pipeline
 * is exercised end to end — a file appearing on disk, being discovered, masked,
 * judged, grouped and printed with a line number a person can open — which no
 * amount of testing the judging function can stand in for.
 *
 * AND THE HARDER HALF, WHICH THIS FILE DID NOT HAVE UNTIL NOW. Some of the
 * gate's checks cannot be triggered by any tree at all, because what they guard
 * against is a mistake in the GATE: an expiry check handed a narrowed list, a
 * root that is also an exclusion, a self-test that has quietly shrunk. A tree
 * cannot produce those, so for three rounds they were code nobody could prove
 * was wired to anything — and "reports and returns" is the exact failure this
 * gate was rejected for twice. `mutantGate` below is the answer: it copies the
 * real script, applies the edit that produces the mistake, and asserts the copy
 * fails. Delete the check's `process.exit`, or the check, and the case goes red.
 * Every anchor is asserted before it is replaced, so a rename in the gate makes
 * these fail loudly instead of quietly mutating nothing.
 *
 * AND ONE THING IT TURNED OUT TO BE GOOD FOR THAT WAS WRITTEN OFF AS TOO
 * EXPENSIVE. The gate prints how many self-test cases ran, and no number a
 * process prints about itself can be checked from inside it. That was recorded
 * as a limitation whose fix was "move SUITES and every case array into a shared
 * module" — several hundred lines, so, not now. It is a mutant: run the gate,
 * run a copy with one more case pushed onto SELFTEST, and the printed count has
 * to be one higher. Twelve lines with machinery that already existed. The
 * lesson is about the estimate rather than the check — the fix that gets
 * written down instead of done is worth re-costing against the tools that
 * arrived since.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, "..");
const GATE = join(PKG, "scripts", "check-vocabulary.mjs");

type Run = { code: number; out: string };

function runGate(script: string): Run {
  try {
    const out = execFileSync("node", [script], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      code: failure.status ?? 1,
      out: `${failure.stdout ?? ""}${failure.stderr ?? ""}`,
    };
  }
}

/**
 * A miniature package with the gate copied into it.
 *
 * The script derives the package it checks from its own location, so a copy in
 * `<temp>/scripts` checks `<temp>`. All three of its roots have to exist, since
 * a missing one is a crash rather than a verdict — which is itself the right
 * behaviour and not what these cases are about.
 */
function miniPackage(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "vocab-gate-"));
  for (const dir of ["src", "test", "scripts"]) {
    mkdirSync(join(root, dir), { recursive: true });
  }
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  cpSync(GATE, join(root, "scripts", "check-vocabulary.mjs"));
  return root;
}

const temporary: string[] = [];
afterEach(() => {
  while (temporary.length > 0) {
    const path = temporary.pop();
    if (path) rmSync(path, { recursive: true, force: true });
  }
});

/**
 * The real gate with one deliberate mistake in it, still checking the real
 * package.
 *
 * It has to live in `scripts/` because the script decides which package it is
 * checking from its own location, and it has to be `.mjs` because that is the
 * one extension this gate neither scans nor demands coverage of — so the mutant
 * is invisible to itself and to any run happening beside it.
 */
let mutants = 0;
function mutantGate(why: string, edits: Array<[string, string]>): string {
  const source = readFileSync(GATE, "utf8");
  let mutated = source;
  for (const [from, to] of edits) {
    expect(
      mutated,
      `the gate no longer contains what this case mutates (${why}). ` +
        `Re-anchor it on the code that replaced:\n${from}`,
    ).toContain(from);
    mutated = mutated.replace(from, to);
  }
  const path = join(PKG, "scripts", `vocabulary-mutant-${process.pid}-${(mutants += 1)}.mjs`);
  temporary.push(path);
  writeFileSync(path, mutated);
  return path;
}

describe("the vocabulary gate, as the package actually runs it", () => {
  it("reports bad identifiers in a real file, counted, at the line each is on", () => {
    /*
     * Planted into the package being checked rather than a copy of it, because
     * the allowlist is scoped to real paths: any tree that does not contain the
     * seven exempted names in their seven files fails on staleness long before
     * it reaches a verdict about identifiers. Planting is also what a person
     * does to check a gate by hand, and the reason this is written down is that
     * doing it by hand is how the blindness in this gate was found — a name at
     * one line of a file was caught and the same name eighty lines further down
     * the same file was not.
     *
     * TWO NAMES, ONE OF THEM TWICE, because every number in the report was a
     * bare expression nothing checked: the header's count of identifiers and the
     * `Nx` beside each name could both be replaced by the constant 1 with the
     * whole suite green. Grouping is proven on made-up violations in the
     * scanner's own self-test; this is the one place the numbers a person reads
     * are produced by real files.
     */
    const planted = join(PKG, "src", `gate-probe-${process.pid}.probe.ts`);
    temporary.push(planted);
    writeFileSync(
      planted,
      [
        "const a = 1;",
        "",
        "export const capturedProbeRow = a;",
        "export const roomProbeShelf = 2;",
        "export const echo = capturedProbeRow;",
        "",
      ].join("\n"),
    );

    const run = runGate(GATE);

    expect(run.code, `the gate should reject a planted violation\n${run.out}`).toBe(1);
    expect(run.out).toContain("2 identifier(s) still speak the old words");
    /* The line, not just the name: `file:line` is the whole actionable part. */
    expect(run.out).toContain(`capturedProbeRow  (2x, first at src/gate-probe-${process.pid}.probe.ts:3)`);
    expect(run.out).toContain(`roomProbeShelf  (1x, first at src/gate-probe-${process.pid}.probe.ts:4)`);
    expect(run.out).toContain("is the old vocabulary");
  });

  it("passes on the package as it stands, so the case above proves the plant", () => {
    const run = runGate(GATE);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("clean");

    /*
     * THE TWO HALVES ADD UP. The clean line's "N exceptions (A awaiting a
     * rename, B permanent)" is the only number about this gate anyone tracks
     * between commits, and B used to be `N - A` — an arithmetic that cannot
     * disagree with itself no matter what the data says. The gate now counts
     * both halves separately; this asserts the sum from outside, so re-deriving
     * one from the other has to survive being read as well as being computed.
     */
    const summary = /(\d+) recorded exceptions \((\d+) awaiting a rename, (\d+) permanent\)/.exec(
      run.out,
    );
    expect(summary, `the clean line no longer says how many exceptions there are\n${run.out}`)
      .not.toBeNull();
    const [, total, awaiting, permanent] = summary as RegExpExecArray;
    expect(Number(awaiting) + Number(permanent), run.out).toBe(Number(total));
    expect(Number(total)).toBeGreaterThan(0);

    /*
     * AND EACH HALF ON ITS OWN. The sum above cannot see a split that lies by
     * one in each direction — `rename - 1` with `permanent + 1` adds up
     * perfectly and moves the number this gate is read by, which is how many of
     * its holes are supposed to be temporary. The only thing outside the process
     * that knows the truth is the list itself, so the entries are counted in the
     * gate's own source. If that count is ever 0 the data has been reformatted
     * rather than broken, and the message says so instead of a bare mismatch.
     *
     * WHAT THIS STILL DOES NOT CATCH, since it is one line to say it: freezing
     * the printed number at the constant it happens to equal today survives,
     * because this compares it against that same number. It cannot mislead for
     * longer than one edit to ALLOWED — the next entry added or removed makes
     * the two disagree and this case goes red — which is the only window in
     * which a stale count could tell anyone anything false.
     */
    const declaredRename = (
      readFileSync(GATE, "utf8").match(/^ {4}disposition: "rename",$/gm) ?? []
    ).length;
    expect(
      declaredRename,
      "no `disposition: \"rename\",` lines found in the gate — ALLOWED has been " +
        "reformatted, so this case is counting nothing rather than checking anything",
    ).toBeGreaterThan(0);
    expect(
      Number(awaiting),
      `the clean line says ${awaiting} entries await a rename; ALLOWED declares ${declaredRename}\n${run.out}`,
    ).toBe(declaredRename);
  });

  it("reads a .mts, which is TypeScript that neither rule used to match", () => {
    /*
     * NOT A MUTATION — this was true of the gate as shipped. `classify` matched
     * `/\.ts$/` and the coverage walk matched `/\.tsx?$/`, so a `.mts` was
     * scanned by neither and missed by neither: the one combination the coverage
     * check exists to make impossible, and the exact shape of every blindness
     * this project has had. The two lines below, in a `.ts`, exit 1 with both
     * names. In a `.mts` they printed `clean`.
     *
     * Planted in the real package rather than a miniature one for the same
     * reason the torn-file case is: in a tree the allowlist does not match, the
     * run exits 1 at staleness regardless, and this case would pass on somebody
     * else's exit code.
     */
    const planted = join(PKG, "src", `gate-probe-${process.pid}.probe.mts`);
    temporary.push(planted);
    writeFileSync(
      planted,
      ["export const capturedProbeNote = 1;", "export const roomProbeDesk = 2;", ""].join("\n"),
    );

    const run = runGate(GATE);

    expect(run.code, `a .mts holding retired words must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("2 identifier(s) still speak the old words");
    expect(run.out).toContain(
      `capturedProbeNote  (1x, first at src/gate-probe-${process.pid}.probe.mts:1)`,
    );
    expect(run.out).toContain(
      `roomProbeDesk  (1x, first at src/gate-probe-${process.pid}.probe.mts:2)`,
    );
    /*
     * AND IT WAS READ, NOT MERELY NOTICED. If only the coverage walk had been
     * widened, this file would be reported as never scanned instead — a
     * different, much weaker verdict that would still turn this run red.
     */
    expect(run.out).not.toContain("never scanned");
  });

  it("refuses TypeScript files no root covers, and says how many", () => {
    /*
     * The coverage check. `extra/` is neither a root nor named in NOT_OURS, so
     * nothing would ever read it — and an unread file is indistinguishable from
     * a clean one, which is how `scripts/` once hid a violation of this gate's
     * own list inside this gate's own directory.
     *
     * Two files, because the count in the header is part of the report and was
     * carried by nothing: replacing it with the constant 1 was green everywhere.
     */
    const root = miniPackage({
      "src/fine.ts": "export const value = 1;\n",
      "extra/unlooked-at.ts": "export const value = 2;\n",
      "extra/nested/also-unlooked-at.ts": "export const value = 3;\n",
    });
    temporary.push(root);

    const run = runGate(join(root, "scripts", "check-vocabulary.mjs"));

    expect(run.code, run.out).toBe(1);
    expect(run.out).toContain("2 TypeScript file(s) in this package were");
    expect(run.out).toContain("never scanned");
    expect(run.out).toContain("extra/unlooked-at.ts");
    expect(run.out).toContain("extra/nested/also-unlooked-at.ts");
    /*
     * AND NOTHING AFTER IT RAN. Every check below this one also fails on a tree
     * this small — the allowlist matches nothing here — so a coverage check
     * that reports and forgets to exit still produces a non-zero run with the
     * right words in it. This case passed for that wrong reason until the
     * missing `process.exit` was tried on purpose.
     */
    expect(run.out).not.toContain("match nothing");
  });

  it("refuses a .tsx file rather than reading JSX as identifiers", () => {
    /*
     * The one judgement in the gate the package cannot exercise: there is no
     * .tsx in packages/api, so the refusal could be deleted and every run stay
     * green. It is caught twice over on purpose — the coverage walk matches
     * `.tsx` too, so an unrefused one shows up there as unscanned — but the
     * refusal is the check that should speak, because it is the one that
     * explains what to do about it.
     */
    const root = miniPackage({
      "src/Thing.tsx": "export const Thing = () => null;\n",
    });
    temporary.push(root);

    const run = runGate(join(root, "scripts", "check-vocabulary.mjs"));

    expect(run.code, run.out).toBe(1);
    expect(run.out).toContain("is a .tsx file");
    expect(run.out).toContain("src/Thing.tsx");
    expect(run.out).not.toContain("never scanned");
  });

  it("refuses an allowlist entry that no longer matches anything", () => {
    /*
     * The staleness check, which is the allowlist's expiry date. A tree with
     * none of the exempted names in it is the same situation as a rename that
     * has landed: every entry is now a hole buying nothing, and each still
     * pre-authorises its name for whatever later takes it in that file.
     */
    const root = miniPackage({ "src/fine.ts": "export const value = 1;\n" });
    temporary.push(root);

    const run = runGate(join(root, "scripts", "check-vocabulary.mjs"));

    expect(run.code, run.out).toBe(1);
    expect(run.out).toContain("match nothing");
    expect(run.out).toContain("src/lib/public-handles.ts");
  });

  it("refuses files it cannot read to the end of, all of them, in the real package", () => {
    /*
     * The blind-region check, and the reason it exists rather than the reason
     * it is tidy. Both blindnesses this project has had — an apostrophe in the
     * web gate, a regex holding backticks in this one — ended with the scanner
     * inside a literal at end of file, masking everything after it and printing
     * the same word a clean run prints. This asserts that shape is a failure,
     * whatever the next delimiter turns out to be.
     *
     * PLANTED INTO THE REAL PACKAGE, and that is the whole point of the case
     * rather than a detail of it. The first version built a miniature package,
     * where the allowlist matches nothing — so the run exited 1 at the staleness
     * check three screens further down, and the case passed on somebody else's
     * exit code with the blind report merely printed above it. Deleting this
     * check's `process.exit(1)` was green: green in the self-test, green here,
     * green on the package. In a tree where everything downstream passes, a
     * check that reports and returns produces exit 0 and this case is the thing
     * that notices.
     *
     * TWO TORN FILES, because recording only the first was also green
     * everywhere. The scanner's own self-test now carries that as a scan-loop
     * case; this asserts the run prints both, since the count and the list are
     * what a person acts on.
     */
    const first = join(PKG, "src", `gate-torn-a-${process.pid}.probe.ts`);
    const second = join(PKG, "src", `gate-torn-b-${process.pid}.probe.ts`);
    temporary.push(first, second);
    writeFileSync(first, "const opened = `never closed;\nexport const value = 1;\n");
    writeFileSync(second, "const also = `never closed either;\nexport const other = 2;\n");

    const run = runGate(GATE);

    expect(run.code, `a file the masker lost track of must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("lost track inside 2 file(s)");
    expect(run.out).toContain(`src/gate-torn-a-${process.pid}.probe.ts:1`);
    expect(run.out).toContain(`src/gate-torn-b-${process.pid}.probe.ts:1`);
    /*
     * AND THE EXIT IS THIS CHECK'S. Nothing downstream has anything to say about
     * this tree, so these three would be the giveaway if the verdict came from
     * somewhere else — the mistake that let the old version of this case pass
     * with the check's enforcement deleted.
     */
    expect(run.out).not.toContain("never scanned");
    expect(run.out).not.toContain("match nothing");
    expect(run.out).not.toContain("still speak the old words");
  });

  /*
   * THE BOUNDARY, NOT THE COUNT — and this round is what made these necessary,
   * which is the part worth writing down.
   *
   * The four count-based exits (`blind`, `neverRead`, `silent`, `unscanned`)
   * were each pinned by a case planting TWO of the thing, because the printed
   * number was a bare expression that could be replaced by the constant 1 with
   * everything green. Two is what proves the count. Two is also exactly what
   * cannot tell `if (x.length > 0)` from `if (x.length > 1)` — so the fix for
   * one hole opened another, and `> 1` was green in the gate, the self-test and
   * this file while a SINGLE torn file passed silently through the real package.
   * One file is not the small case here. It is the incident: 87 lines of
   * `src/lib/generation-doc.test.ts` went unread and the run printed `clean`.
   */
  it("refuses a single torn file — one is the incident, not the small case", () => {
    const only = join(PKG, "src", `gate-torn-solo-${process.pid}.probe.ts`);
    temporary.push(only);
    writeFileSync(only, "const opened = `never closed;\nexport const value = 1;\n");

    const run = runGate(GATE);

    expect(run.code, `one torn file must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("lost track inside 1 file(s)");
    expect(run.out).toContain(`src/gate-torn-solo-${process.pid}.probe.ts:1`);
    expect(run.out).not.toContain("never scanned");
    expect(run.out).not.toContain("match nothing");
    expect(run.out).not.toContain("still speak the old words");
  });

  it("refuses a single file that yielded no identifier", () => {
    /*
     * The cheapest tree there is for the `silent` check: a `.ts` file with
     * nothing in it. It is discovered, it is read, and it says nothing — which
     * is what an unread file looks like from here, and both deserve the same
     * verdict. One of them, so the exit's threshold is asserted and not just its
     * message.
     */
    const empty = join(PKG, "src", `gate-empty-${process.pid}.probe.ts`);
    temporary.push(empty);
    writeFileSync(empty, "\n");

    const run = runGate(GATE);

    expect(run.code, `one silent file must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("1 TypeScript file(s) yielded no identifier at");
    expect(run.out).toContain(`src/gate-empty-${process.pid}.probe.ts`);
    expect(run.out).not.toContain("never reached the scanner");
    expect(run.out).not.toContain("never scanned");
    expect(run.out).not.toContain("match nothing");
  });

  it("passes over a file removed between being listed and being read", () => {
    /*
     * Other suites plant `*.probe.ts` files in `src/` and remove them while the
     * package runs in parallel, so the walk can list a path that is gone by the
     * time it is looked at. That is somebody else's fixture, not this package's
     * code, and it must not crash the run. A dangling symlink holds that moment
     * still: the directory read lists it, and anything that follows it finds
     * nothing there.
     */
    const gone = join(PKG, "src", `gate-vanished-${process.pid}.probe.ts`);
    temporary.push(gone);
    symlinkSync(join(PKG, "src", `gate-already-removed-${process.pid}.ts`), gone);

    const run = runGate(GATE);

    expect(run.code, `a vanished file must not fail the run\n${run.out}`).toBe(0);
    expect(run.out).toContain("clean —");
  });

  it("refuses a single TypeScript file no root covers", () => {
    const root = miniPackage({
      "src/fine.ts": "export const value = 1;\n",
      "extra/unlooked-at.ts": "export const value = 2;\n",
    });
    temporary.push(root);

    const run = runGate(join(root, "scripts", "check-vocabulary.mjs"));

    expect(run.code, run.out).toBe(1);
    expect(run.out).toContain("1 TypeScript file(s) in this package were");
    expect(run.out).toContain("extra/unlooked-at.ts");
    /* Nothing downstream spoke — the two-file case's argument, at one file. */
    expect(run.out).not.toContain("match nothing");
  });
});

/**
 * MISTAKES IN THE GATE, WHICH NO TREE CAN PRODUCE.
 *
 * Everything above hands the gate a tree it must reject. These hand it a copy of
 * itself with one thing wrong, because the checks below guard against edits to
 * this script rather than against anything in the package — and a check that
 * nothing can trigger is a check nobody can prove is connected. Each case is a
 * mutation that ran fully green, three ways over, in review.
 */
describe("the vocabulary gate, when the mistake is in the gate", () => {
  it("fails when the expiry check is handed a narrowed allowlist", () => {
    /*
     * `ALLOWED.filter((e) => e.disposition === "permanent")` is the tempting
     * narrowing — permanent entries are the ones that "cannot go stale" — and it
     * leaves every temporary hole checked by nothing, with `unusedAllowanceFiles`
     * still correct about what it was shown and every expiry case still green.
     * The gate counts the pairs it looked at for exactly this reason. That count
     * had its own quiet exit until this case: deleting it was green everywhere.
     */
    const script = mutantGate("the expiry check's input is narrowed", [
      [
        "const expiry = unusedAllowanceFiles(ALLOWED, allowancesUsed);",
        'const expiry = unusedAllowanceFiles(ALLOWED.filter((e) => e.disposition === "permanent"), allowancesUsed);',
      ],
    ]);

    const run = runGate(script);

    expect(run.code, `a narrowed expiry check must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("the expiry check looked at");
    expect(run.out).not.toContain("clean —");
  });

  it("fails when a scan root is also an exclusion", () => {
    /*
     * Put a directory in both lists and the coverage check stops being able to
     * report anything: it never finds the files, so it can never miss them. The
     * mutant uses `dist`, which is genuinely not ours, so this case isolates the
     * root/exclusion guard from the justification check below it — and the
     * directory is created here because the guard has to fire BEFORE the walk
     * reaches it, which is the ordering the case is really about.
     */
    const dist = join(PKG, "dist");
    temporary.push(dist);
    mkdirSync(dist, { recursive: true });
    writeFileSync(join(dist, "built.ts"), "export const value = 1;\n");

    const script = mutantGate("an excluded directory is added to ROOTS", [
      [
        'const ROOTS = [join(PKG, "src"), join(PKG, "test"), join(PKG, "scripts")];',
        'const ROOTS = [join(PKG, "src"), join(PKG, "test"), join(PKG, "scripts"), join(PKG, "dist")];',
      ],
    ]);

    const run = runGate(script);

    expect(run.code, `a root that is also excluded must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("is named in both ROOTS and");
    expect(run.out).not.toContain("clean —");
  });

  it("fails when a source root is dropped and excluded in the same edit", () => {
    /*
     * The coherent form of the mutation above, and the one that survived every
     * check until this round: remove `test` from ROOTS and add `"test"` to
     * NOT_OURS. The two lists agree perfectly, the coverage walk skips exactly
     * what the scan stopped reading, and twenty files leave the gate in silence.
     * The gate now asks the repository — a directory it tracks cannot be
     * excluded — which is a justification this file cannot write for itself.
     */
    const script = mutantGate("a source root is dropped and excluded", [
      [
        'const ROOTS = [join(PKG, "src"), join(PKG, "test"), join(PKG, "scripts")];',
        'const ROOTS = [join(PKG, "src"), join(PKG, "scripts")];',
      ],
      ['  ".turbo", // task cache', '  ".turbo", // task cache\n  "test",'],
    ]);

    const run = runGate(script);

    expect(run.code, `excluding a tracked directory must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("NOT_OURS excludes test");
    expect(run.out).not.toContain("clean —");
  });

  it("fails when discovered files never reach the scanner", () => {
    /*
     * Filtering the argument to `scanFiles` is the shape of every "skip the test
     * directory" edit anyone would make, and it used to be invisible: the
     * coverage check compares the filesystem against what was DISCOVERED, and
     * discovery is untouched here. The scan loop now reports which paths reached
     * it.
     */
    const script = mutantGate("the scan's input is filtered", [
      [
        "const { violations, blind, read, silent } = scanFiles(\n  [...scanned].map((f) => relative(PKG, f)),",
        'const { violations, blind, read, silent } = scanFiles(\n  [...scanned].filter((f) => !f.includes("/test/")).map((f) => relative(PKG, f)),',
      ],
    ]);

    const run = runGate(script);

    expect(run.code, `files discovered and not read must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("never reached the scanner");
    expect(run.out).not.toContain("clean —");
  });

  it("fails when the scan loop swallows a file that made it throw", () => {
    /*
     * `try { … } catch { continue; }` around the per-file scan is the most
     * ordinary robustness edit there is, and it converts every file that trips
     * the scanner into a clean one. It is also the reason the loop reports the
     * paths it reached rather than being handed a list to echo back: if `read`
     * were the input list, this edit and the check would agree with each other
     * and neither would be about anything. That is the mutation this case exists
     * to kill — not just the `catch`, but any version of `read` that cannot
     * disagree with what was asked for.
     */
    const script = mutantGate("the scan loop catches and continues", [
      [
        "    const scan = scanSource(source, file, used);\n    read.push(file);",
        "    let scan;\n    try {\n      scan = scanSource(source, file, used);\n    } catch {\n      continue;\n    }\n    read.push(file);",
      ],
      [
        "function scanSource(source, file, used = new Set()) {\n  const found = [];",
        'function scanSource(source, file, used = new Set()) {\n  if (file.startsWith("test/")) throw new Error("planted");\n  const found = [];',
      ],
    ]);

    const run = runGate(script);

    expect(run.code, `a swallowed file must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("never reached the scanner");
    expect(run.out).not.toContain("clean —");
  });

  it("fails when a file is read as empty", () => {
    /*
     * The same hole through the other door, and the one the check above cannot
     * see: the path reaches the scanner, the scanner is handed nothing. Every
     * `.ts` file in this package has an identifier in it, so a file that yields
     * none is either empty or unread — and both print what a clean file prints.
     */
    const script = mutantGate("readSource returns nothing for a directory", [
      [
        '  whileListed((rel) => readFileSync(join(PKG, rel), "utf8"), vanished),',
        '  whileListed((rel) => (rel.startsWith("test/") ? "" : readFileSync(join(PKG, rel), "utf8")), vanished),',
      ],
    ]);

    const run = runGate(script);

    expect(run.code, `a file read as empty must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("yielded no identifier");
    expect(run.out).not.toContain("clean —");
  });

  it("fails when an allowlist entry's disposition is mistyped", () => {
    /*
     * One character in the data — `permanant` — and the entry belongs to neither
     * half of the list. The run printed "4 awaiting a rename, 3 permanent"
     * instead of 5 and 2 with all forty-four scanner cases green: a temporary
     * hole reclassifying itself as permanent, in the number this gate is read by.
     */
    const script = mutantGate("a disposition is mistyped", [
      ['    disposition: "rename",\n    to: "sourceForInspiration",', '    disposition: "permanant",\n    to: "sourceForInspiration",'],
    ]);

    const run = runGate(script);

    expect(run.code, `an unreadable disposition must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("ALLOWED does not have the shape");
    expect(run.out).not.toContain("clean —");
  });

  it("fails when one allowlist entry lists the same file twice", () => {
    /*
     * The entry-shape check, which is a different net from the arithmetic one
     * below it and needed its own case to prove it is strung up at all: a
     * duplicated path is counted twice in the (name, file) total the expiry
     * check measures itself against, so the gate claims to be guarding a hole
     * that is not there — and both copies are marked used by the same
     * identifier, so neither can ever be reported stale.
     */
    const script = mutantGate("a path is listed twice in one entry", [
      [
        '    files: ["src/lib/public-handles.ts"],',
        '    files: ["src/lib/public-handles.ts", "src/lib/public-handles.ts"],',
      ],
    ]);

    const run = runGate(script);

    expect(run.code, `a duplicated path must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("listed twice");
    expect(run.out).not.toContain("clean —");
  });

  it("fails when a single discovered file never reaches the scanner", () => {
    /*
     * The same hole as the filtered-input case above, at the boundary rather
     * than at a directory: `slice(1)` drops exactly one file, whichever it is,
     * so this asserts `neverRead.length > 0` and not merely that twenty missing
     * files are noticed. `> 1` was green everywhere before this case existed.
     */
    const script = mutantGate("one discovered file is dropped before the scan", [
      [
        "const { violations, blind, read, silent } = scanFiles(\n  [...scanned].map((f) => relative(PKG, f)),",
        "const { violations, blind, read, silent } = scanFiles(\n  [...scanned].slice(1).map((f) => relative(PKG, f)),",
      ],
    ]);

    const run = runGate(script);

    expect(run.code, `one file discovered and not read must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("1 file(s) were found by the walk and then");
    expect(run.out).toContain("never reached the scanner");
    expect(run.out).not.toContain("clean —");
  });

  it("counts the cases it prints, and prints the ones it counted", () => {
    /*
     * THE SELF-TEST SUMMARY, WHICH USED TO BE A DOCUMENTED LIMITATION AND WAS
     * NOT WORTH BEING ONE.
     *
     * `self-test passed (46 scanner, …)` is the gate's own report on its own
     * proof, so nothing inside the process can vouch for it: replacing the whole
     * expression with a string literal was green in the self-test, green here
     * and green on the package. The note in the gate said the fix was to move
     * SUITES and every case array into a shared module — several hundred lines —
     * and used that cost to explain why it was written down instead of done.
     * That cost was imaginary. Nothing moves. A copy of the gate with one more
     * case in SELFTEST must print one more, and a copy truncated to the floor
     * must print exactly the floor, and both are mutations of the kind this
     * describe block already runs ten of.
     *
     * The mutations it kills: the string literal (neither number moves), a
     * summary that is derived but offset (`cases.length + 1` — the truncated run
     * disagrees with the floors), one where every label reports the same array
     * (pushing to SELFTEST moves all ten, and the comparison is on the whole
     * object rather than one field), and one that prints the floors instead of
     * the counts (nothing moves when a case is added).
     */
    const summary = (out: string): Record<string, number> => {
      const line = /self-test passed \(([^)]*)\)/.exec(out);
      expect(line, `the gate no longer prints a self-test summary at all\n${out}`).not.toBeNull();
      const counts: Record<string, number> = {};
      for (const part of (line as RegExpExecArray)[1].split(", ")) {
        const [count, ...label] = part.split(" ");
        counts[label.join(" ")] = Number(count);
      }
      return counts;
    };

    const before = summary(runGate(GATE).out);
    expect(Object.keys(before).length, "the summary lists no suites").toBeGreaterThan(1);

    const pushed = mutantGate("one more case in the scanner suite", [
      [
        "\nselftest();",
        '\nSELFTEST.push({ why: "a case added by the process test", src: "const fine = 1;", expect: [] });\nselftest();',
      ],
    ]);
    expect(
      summary(runGate(pushed).out),
      "adding a case to SELFTEST did not move the number the gate prints for it",
    ).toEqual({ ...before, scanner: before.scanner + 1 });

    /*
     * AND EVERY OTHER LABEL MOVES WITH ITS OWN ARRAY. The push above is one
     * suite's, so the other nine were pinned only against each other: freezing
     * one of them at the number it happens to hold today survived — and unlike a
     * frozen total it would not correct itself, since the next case added to
     * that suite would be misreported with everything green. Pushing a copy of
     * each suite's first case works whatever shape its cases are, and every
     * printed number then has to move by one.
     */
    const grown = mutantGate("one more case in every suite", [
      ["\nselftest();", "\nfor (const s of SUITES) s.cases.push(s.cases[0]);\nselftest();"],
    ]);
    expect(
      summary(runGate(grown).out),
      "a suite gained a case and the number the gate prints for it did not move",
    ).toEqual(Object.fromEntries(Object.entries(before).map(([label, n]) => [label, n + 1])));

    /*
     * AND THE ABSOLUTE VALUES, for every label rather than only the one this
     * case can push to. Everything above is differential — it proves the numbers
     * MOVE correctly, not that they start in the right place. So: cut every
     * suite to the one number in the file that is allowed to be a constant — its
     * floor — and the printed line has to be the floors, label for label.
     */
    const declared = [
      ...readFileSync(GATE, "utf8").matchAll(
        /\{ label: "([^"]+)", cases: (\w+), floor: (\d+) \}/g,
      ),
    ];
    expect(
      declared.length,
      "SUITES is no longer written where this case reads it — label, array and floor on one line",
    ).toBe(Object.keys(before).length);
    const floors: Record<string, number> = {};
    let truncate = "";
    for (const [, label, array, floor] of declared) {
      floors[label] = Number(floor);
      truncate += `${array}.length = ${floor};\n`;
    }
    const cut = mutantGate("every suite cut to its floor", [
      ["\nselftest();", `\n${truncate}selftest();`],
    ]);
    expect(
      summary(runGate(cut).out),
      "a suite holding exactly its floor in cases must print exactly its floor",
    ).toEqual(floors);
  });

  it("fails when the self-test has shrunk", () => {
    /*
     * `self-test passed (46 scanner, …)` was a number printed rather than
     * checked, so the suite could be cut to three cases — or to none — and the
     * line would still say passed, with a smaller true number. Proof is not
     * supposed to get smaller, and the floors beside each suite are what say so.
     *
     * This is the floor's case and the one above is the number's, and they are
     * separate on purpose: cutting the suite has to fail because the PROOF
     * shrank, not because the printed count moved.
     */
    const script = mutantGate("the scanner suite is cut down", [
      ["\nselftest();", "\nSELFTEST.length = 3;\nselftest();"],
    ]);

    const run = runGate(script);

    expect(run.code, `a shrunken self-test must fail the run\n${run.out}`).toBe(1);
    expect(run.out).toContain("suite has shrunk");
    expect(run.out).not.toContain("self-test passed");
  });
});
