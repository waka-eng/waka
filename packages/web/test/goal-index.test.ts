/**
 * THE GOALS INDEX LISTS EVERY GOAL, AND ONLY REAL ONES.
 *
 * `docs/goals/` is 11,000 lines across 28 documents. Every one of them opens
 * with a title and a `Status:` line, so each file is individually honest —
 * and collectively they were not navigable, because reading a status means
 * opening the file. `three-layers.md` (done in August) and
 * `everything-in-the-world.md` (in flight) are both about a thousand lines
 * and both read like a plan. That is a real cost on a new engineer: the
 * largest body of prose in the repository, with no way to tell finished work
 * from current work except to read it.
 *
 * `docs/goals/README.md` is that index. An index nobody checks becomes a
 * fourth thing to distrust, so this asserts the two directions that actually
 * rot:
 *
 *   A NEW GOAL MUST APPEAR IN IT. This is the failure the index exists to
 *   prevent — someone adds a goal, nobody adds the row, and the index quietly
 *   becomes a partial list that still looks complete.
 *
 *   A ROW MUST NAME A REAL FILE. A renamed or deleted goal leaves a link that
 *   404s, which teaches readers the index is stale and to skip it.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing, and nothing needs replacing.
 * The subject is a directory of files on disk and a table of links in one of
 * them. `readdirSync` and `readFileSync` over the real `docs/goals/` ARE the
 * subject — a fixture directory here would only prove this test can read a
 * fixture, and the drift it exists to catch happens in the real one.
 *
 * WHAT IT DELIBERATELY DOES NOT CHECK: whether the prose in a row matches the
 * file's `Status:` line word for word. The status lines are sentences with
 * dates and clauses in them ("in flight, yielding — first place in the queue
 * handed to…"), and a test demanding an exact copy would either force the
 * index to repeat them whole, which is the wall of text it replaces, or fail
 * on every wording change. Which section a goal sits under is a judgement,
 * and judgements belong to reviewers. Completeness is not a judgement, so
 * that is what is mechanised.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOALS = resolve(HERE, "../../../docs/goals");
const INDEX = "README.md";

function goalFiles(): string[] {
  return readdirSync(GOALS)
    .filter((name) => name.endsWith(".md") && name !== INDEX)
    .sort();
}

function indexText(): string {
  return readFileSync(resolve(GOALS, INDEX), "utf8");
}

/** Every `](target.md)` the index links to, relative names as written. */
function linkedFiles(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.matchAll(/\]\(([^)]+\.md)\)/g)) {
    const target = match[1] as string;
    if (target.includes("/")) continue; // a link out of this directory
    out.add(target);
  }
  return out;
}

describe("the goals index", () => {
  it("lists every goal document", () => {
    const linked = linkedFiles(indexText());
    const missing = goalFiles().filter((name) => !linked.has(name));
    expect(
      missing,
      "these files are in `docs/goals/` and not in `docs/goals/README.md`. " +
        "A new engineer reads that index to find out which of 11,000 lines " +
        "describe work that is happening now, and a partial index still looks " +
        "complete. Add a row under the section matching the file's own " +
        "`Status:` line.",
    ).toEqual([]);
  });

  it("links only to goal documents that exist", () => {
    const present = new Set(goalFiles());
    const dangling = [...linkedFiles(indexText())].filter((name) => !present.has(name)).sort();
    expect(
      dangling,
      "`docs/goals/README.md` links to these, and they are not there. A " +
        "renamed goal needs its row renamed in the same diff.",
    ).toEqual([]);
  });

  it("keeps every goal carrying the status line the index is built from", () => {
    /* The index's sections come from these lines. A goal without one cannot
       be placed, and the omission is invisible until someone tries. The
       handoff note is exempt by name: it is a session record filed with its
       goal, not a goal, and the index says so. */
    const exempt = new Set(["HANDOFF-ambition-reading.md"]);
    const statusless = goalFiles()
      .filter((name) => !exempt.has(name))
      .filter((name) => !/^Status:/m.test(readFileSync(resolve(GOALS, name), "utf8")));
    expect(
      statusless,
      "every goal opens with a `Status:` line — it is what says whether this " +
        "is a plan, work in flight, or a finished record, and it is what the " +
        "index is built from.",
    ).toEqual([]);
  });
});
