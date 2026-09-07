/**
 * NOTHING IN THE TREE IS UNREFERENCED — the API half.
 *
 * `packages/web/test/orphans.test.ts` has asked this of the web tree since
 * 2026-08-26 and caught two files the week it was written. The API had no
 * equivalent, and that is exactly where the orphans were: an audit on
 * 2026-08-28 walked the import graph from the four deployed entry points and
 * found five files nothing reaches, four of them verbatim mirrors of code
 * inside `lib/top-of-mind-synthesis.ts` and one a second Drizzle client whose
 * own header claimed every server-side caller imported it.
 *
 * WHY THE COMPILER CANNOT DO THIS. Every one of those five typechecked
 * perfectly, every day, for months. `tsc` asks whether a file is consistent,
 * never whether anyone wants it. Being unreachable is a property of the whole
 * graph at once, so it is only ever visible from a walk like this one.
 *
 * WHY IT IS WORSE HERE THAN IN WEB. An orphan in web is a screen nobody
 * renders. An orphan in api is a copy of a rule — and a copy of a rule is
 * something a gate can be pointed at by mistake. The drift lock that keeps
 * `docs/generation.md` honest about Layer 3's numbers was asserting against
 * the mirror rather than the pass, so the doc and the copy could have agreed
 * with each other indefinitely while the code that actually runs moved away
 * from both. Dead code in a rules engine does not merely sit there; it offers
 * itself as the answer to the next person who greps for the rule.
 *
 * WHAT THIS MOCKS, AND WHY: nothing. It reads the source as text and follows
 * its imports. There is no seam here to replace.
 *
 * THREE THINGS IT MUST NOT CALL DEAD:
 *
 *   A `.js` SPECIFIER IS A `.ts` FILE. This package is NodeNext, so every
 *   relative import is written `./thing.js` and resolves to `thing.ts` on
 *   disk. A resolver that only tries the literal path finds nothing and
 *   reports the entire package as orphaned.
 *
 *   A TEST IS NOT AN ENTRY POINT. Test files are excluded from the walk
 *   rather than treated as roots, deliberately. A module kept reachable only
 *   by its own test is a module the product does not call, and counting the
 *   test as a use would make this gate agree with the leftover.
 *
 *   A RECORDED DECISION IS NOT AN ACCIDENT. `PARKED` below is for code a
 *   human chose to keep unwired, with the place they wrote that down. Adding
 *   a name there is a claim someone can check; leaving one there after its
 *   phase has passed is the next audit's finding.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");

/**
 * Where the API starts, all five of them.
 *
 * `lambda.ts` and `background-worker.ts` are the deployed Lambda handlers and
 * `principle-refresh.ts` the nightly cron — all three named as `handler:`
 * strings in `sst.config.ts`, which `test/sst-config-env.test.ts` pins.
 * `server.ts` is the local stack, started by `scripts/dev-local.sh`, and
 * `nightly-local.ts` is that same script's once-per-boot firing of the
 * nightly clock (the `nightly` package script) — it imports the cron's own
 * handler rather than enqueueing anything itself, so the sole-enqueuer
 * ruling stays one function wide. Nothing else runs this package, so
 * nothing else may root the graph.
 */
const ENTRY = [
  "lambda.ts",
  "background-worker.ts",
  "principle-refresh.ts",
  "server.ts",
  "nightly-local.ts",
];

/**
 * Code deliberately kept without a caller, and where that was decided.
 *
 * Each entry needs a citation, because the difference between parked and
 * abandoned is entirely whether a person meant it — and a year from now the
 * only evidence of which one this was will be the line below.
 */
const PARKED = new Map<string, string>([
  [
    "scoring/board-selection.ts",
    "docs/goals/three-layers.md — the audit lists it K (P6 may reuse). " +
      "It chooses six readings for a wall by coverage and distinctness " +
      "rather than by arrival, and its header records the measurements " +
      "that rejected doing the same thing in a prompt. Delete it when P6 " +
      "lands without it, not before.",
  ],
]);

/**
 * `*.probe.ts` — fixtures another suite plants in `src/` while it runs.
 *
 * `test/vocabulary-gate.test.ts` writes `gate-torn-a-<pid>.probe.ts` and five
 * siblings into `packages/api/src/`, runs the real scanner against them as a
 * subprocess, and deletes them. Vitest runs test files in parallel, so this
 * walk can arrive while they are on disk — and it did, on 2 of 5 runs before
 * this line existed, reporting two files that had never been committed and
 * telling the reader to delete them.
 *
 * A gate that fails 40% of the time on work that is not yours is worse than
 * no gate: it trains everyone to re-run CI instead of reading it. Excluded by
 * the suffix rather than by name, because the suffix is the convention every
 * planted file already follows and a pid-keyed name cannot be listed.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry) && !/\.(test|d|probe)\.ts$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Every relative specifier a file imports, static or dynamic, resolved to a
 * real path on disk.
 *
 * `import(` is matched alongside `from` because `lib/queue.ts` reaches the
 * Lambda SDK and its own siblings that way, and a matcher that misses dynamic
 * imports reports live modules as dead.
 */
/**
 * Comments and their contents, removed before the matcher runs.
 *
 * A PROSE MENTION IS NOT AN IMPORT. The matcher below runs over raw text, so
 * without this a doc-comment example — `src/db/index.ts` already carries
 * `import { accounts } from "./db";` in its header — or a parting note like
 * `// moved from "./top-of-mind-selection.js"` marks the file it names as
 * reachable. That is the gate going quiet at exactly the moment it should
 * fire: someone deletes a module, leaves a note saying where it went, and the
 * dead file it points at is counted live.
 */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function importsOf(file: string): string[] {
  const text = withoutComments(readFileSync(file, "utf8"));
  const here = dirname(file);
  const found: string[] = [];
  for (const match of text.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)) {
    const spec = match[1] as string;
    if (!spec.startsWith(".")) continue;
    /* NodeNext: written `./thing.js`, on disk `thing.ts`. */
    const base = resolve(here, spec.replace(/\.js$/, ""));
    for (const candidate of [base, `${base}.ts`, resolve(base, "index.ts")]) {
      try {
        if (statSync(candidate).isFile()) {
          found.push(candidate);
          break;
        }
      } catch {
        /* not this one */
      }
    }
  }
  return found;
}

/**
 * Root-level tools that legitimately reach into `packages/api/src`.
 *
 * A TOOL IS A CONSUMER. `tools/seed-demo.ts` imports `hashPassword` from
 * `src/lib/auth.ts`, and `pnpm demo:seed` is a documented step in README. That
 * import happens to be redundant today because `lambda.ts` reaches `auth.ts`
 * too — but the first helper written for a tool and not for a request would
 * land in the orphan list under a message telling the reader to delete it,
 * and following that message breaks a documented command. Rooting the walk
 * here as well costs nothing and removes a wrong answer the gate would
 * otherwise give confidently.
 */
const TOOL_ROOTS = ["tools", "scripts"];

function toolEntryPoints(): string[] {
  const roots: string[] = [];
  for (const dirName of TOOL_ROOTS) {
    const dir = resolve(SRC, "../../..", dirName);
    if (!existsSync(dir)) continue;
    const stack = [dir];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      for (const entry of readdirSync(current)) {
        const full = resolve(current, entry);
        if (statSync(full).isDirectory()) stack.push(full);
        else if (/\.(ts|mjs)$/.test(entry)) roots.push(full);
      }
    }
  }
  return roots;
}

function reachableFromEntries(): Set<string> {
  const reachable = new Set<string>();
  const queue = [...ENTRY.map((name) => resolve(SRC, name)), ...toolEntryPoints()];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (reachable.has(file)) continue;
    reachable.add(file);
    for (const next of importsOf(file)) queue.push(next);
  }
  return reachable;
}

describe("every module in the API is reachable from a deployed entry point", () => {
  it("has no orphans beyond the parked ones", () => {
    const reachable = reachableFromEntries();
    const orphans = walk(SRC)
      .map((file) => file.slice(SRC.length + 1))
      .filter((rel) => !reachable.has(resolve(SRC, rel)) && !PARKED.has(rel))
      .sort();

    expect(
      orphans,
      "no import from `lambda.ts`, `background-worker.ts`, " +
        "`principle-refresh.ts` or `server.ts` reaches these files, so no " +
        "request, job or cron run has ever executed a line of them. They " +
        "still typecheck, still read like live code, and still have to be " +
        "understood by everyone who opens them — and in this package they " +
        "are usually a copy of a rule that also lives somewhere live, which " +
        "is worse than merely unused, because the next person to grep for " +
        "that rule can find the copy. Delete it, or import it from wherever " +
        "it was meant to run. If a human decided to keep it unwired, add it " +
        "to PARKED with the document that says so.",
    ).toEqual([]);
  });

  it("keeps every parked file real, and still parked", () => {
    /* A GUARD ON THE GUARD. An allowance that outlives its file is how a
       list of exceptions turns into a list nobody reads: the entry stops
       meaning "kept on purpose" and starts meaning "never checked". Both
       halves fail loudly — a name that no longer exists, and a name that is
       reachable now and so does not need an allowance at all. */
    const reachable = reachableFromEntries();
    for (const [rel, why] of PARKED) {
      const full = resolve(SRC, rel);
      /* `existsSync`, not `statSync`: `statSync` throws ENOENT before `expect`
         ever sees it, so a stale allowance failed with a raw stack trace and
         the message naming the entry and its justification never printed —
         the half of "both halves fail loudly" that did not. */
      expect(
        existsSync(full),
        `PARKED names ${rel}, which is not there. Remove the entry — ${why}`,
      ).toBe(true);
      expect(
        reachable.has(full),
        `PARKED names ${rel}, but something imports it now. It is live code; ` +
          `drop the allowance and let the walk cover it. Recorded as: ${why}`,
      ).toBe(false);
    }
  });

  it("walks the whole package, not an empty directory", () => {
    /* If `walk` or `SRC` ever breaks, every assertion above passes on an
       empty list and this suite goes quiet at the exact moment it stops
       working. The API has ~100 non-test modules; a floor well under that
       catches a broken walk without failing on ordinary growth. */
    expect(walk(SRC).length).toBeGreaterThan(50);
    expect(reachableFromEntries().size).toBeGreaterThan(50);
  });
});
