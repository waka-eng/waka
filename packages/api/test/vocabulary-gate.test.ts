import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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

describe("the vocabulary gate, as the package actually runs it", () => {
  it("reports a bad identifier in a real file at the line it is on", () => {
    /*
     * Planted into the package being checked rather than a copy of it, because
     * the allowlist is scoped to real paths: any tree that does not contain the
     * seven exempted names in their seven files fails on staleness long before
     * it reaches a verdict about identifiers. Planting is also what a person
     * does to check a gate by hand, and the reason this is written down is that
     * doing it by hand is how the blindness in this gate was found — a name at
     * one line of a file was caught and the same name eighty lines further down
     * the same file was not.
     */
    const planted = join(PKG, "src", `gate-probe-${process.pid}.probe.ts`);
    temporary.push(planted);
    writeFileSync(planted, ["const a = 1;", "", "export const capturedProbeRow = a;", ""].join("\n"));

    const run = runGate(GATE);

    expect(run.code, `the gate should reject a planted violation\n${run.out}`).toBe(1);
    expect(run.out).toContain("capturedProbeRow");
    /* The line, not just the name: `file:line` is the whole actionable part. */
    expect(run.out).toContain(`src/gate-probe-${process.pid}.probe.ts:3`);
    expect(run.out).toContain("is the old vocabulary");
  });

  it("passes on the package as it stands, so the case above proves the plant", () => {
    const run = runGate(GATE);
    expect(run.code, run.out).toBe(0);
    expect(run.out).toContain("clean");
  });

  it("refuses a TypeScript file no root covers", () => {
    /*
     * The coverage check. `extra/` is neither a root nor named in NOT_OURS, so
     * nothing would ever read it — and an unread file is indistinguishable from
     * a clean one, which is how `scripts/` once hid a violation of this gate's
     * own list inside this gate's own directory.
     */
    const root = miniPackage({
      "src/fine.ts": "export const value = 1;\n",
      "extra/unlooked-at.ts": "export const value = 2;\n",
    });
    temporary.push(root);

    const run = runGate(join(root, "scripts", "check-vocabulary.mjs"));

    expect(run.code, run.out).toBe(1);
    expect(run.out).toContain("never scanned");
    expect(run.out).toContain("extra/unlooked-at.ts");
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

  it("refuses a file it cannot read to the end of", () => {
    /*
     * The blind-region check, and the reason it exists rather than the reason
     * it is tidy. Both blindnesses this project has had — an apostrophe in the
     * web gate, a regex holding backticks in this one — ended with the scanner
     * inside a literal at end of file, masking everything after it and printing
     * the same word a clean run prints. This asserts that shape is a failure,
     * whatever the next delimiter turns out to be.
     */
    const root = miniPackage({
      "src/torn.ts": ["const text = `never closed;", "export const value = 1;", ""].join("\n"),
    });
    temporary.push(root);

    const run = runGate(join(root, "scripts", "check-vocabulary.mjs"));

    expect(run.code, run.out).toBe(1);
    expect(run.out).toContain("lost track");
    expect(run.out).toContain("src/torn.ts:1");
  });
});
