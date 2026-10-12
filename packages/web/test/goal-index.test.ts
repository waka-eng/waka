/**
 * THE GOALS INDEX LISTS EVERY GOAL, AND ONLY REAL ONES.
 *
 * `docs/goals/` was 11,000 lines across 28 documents when this was written
 * and has only grown since. Every one of them opens with a title and a
 * `Status:` line, so each file is individually honest — and collectively they
 * were not navigable, because reading a status means opening the file.
 * `three-layers.md` (done in August) and `everything-in-the-world.md` (in
 * flight) are both about a thousand lines and both read like a plan. That is
 * a real cost on a new engineer: the largest body of prose in the repository,
 * with no way to tell finished work from current work except to read it.
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
 *
 * AND WHY EVERY CASE HERE FIRST PROVES IT HAS SOMETHING TO READ. Each of the
 * three assertions below is of the form "this list of problems is empty", and
 * that is the one shape that goes green when the subject disappears: a
 * directory renamed one level up, a filter that stops matching, an index
 * emptied to a stub, and `missing`, `dangling` and `statusless` are all `[]`
 * for the same innocent-looking reason. The suite would then report that the
 * index is complete while having compared nothing to nothing — the exact
 * failure the index itself exists to prevent, reproduced in the test that
 * guards it. So the corpus, the index's links and the exemption list each
 * have to be plausible before any emptiness means anything.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOALS = resolve(HERE, "../../../docs/goals");
const INDEX = "README.md";

/**
 * THE FEWEST GOALS THIS REPOSITORY CAN CREDIBLY HAVE.
 *
 * Not a count of them — a floor under one. There are forty-two today and the
 * number only rises, because a finished goal is not deleted: it stays as the
 * record of how the thing that shipped was decided, which is the whole reason
 * the index has a "done" section to put it in. So the realistic ways this
 * number falls are all accidents — the directory moved and `resolve` now
 * points at nothing, the `.md` filter stopped matching, a sweep deleted the
 * records — and every one of them takes the corpus to zero or near it rather
 * than to thirty.
 *
 * Twenty is therefore deliberately slack. A floor set near the true count
 * would fail on the next honest tidy-up and teach the next person that this
 * number is noise to be bumped, which is how a tripwire becomes a chore. Half
 * the corpus cannot vanish by accident and ought not to vanish on purpose
 * without someone reading this paragraph.
 */
const FEWEST_GOALS = 20;

/**
 * A SESSION RECORD FILED WITH ITS GOAL, which is not itself a goal — so it is
 * the one file not required to open with a `Status:` line, and the index says
 * so where it links to it.
 *
 * Named here rather than inline because an exemption is the other way a
 * completeness check quietly stops checking: a name left behind after the file
 * it excused was renamed excuses nothing and reads as if it still does, and a
 * list that grew to cover the corpus would make the status case unfailable.
 * The "keeps only live exemptions" case below is what stops both.
 */
const EXEMPT: readonly string[] = ["HANDOFF-ambition-reading.md"];

function goalFiles(): string[] {
  const names = readdirSync(GOALS)
    .filter((name) => name.endsWith(".md") && name !== INDEX)
    .sort();
  /* THE GUARD LIVES IN THE READER, not only in its own case, because each
     case below is independently capable of passing on an empty list and
     vitest offers no promise about which cases run. A corpus that has gone
     missing should be the failure every one of them reports. */
  expect(
    names.length,
    `only ${names.length} goal document(s) found in ${GOALS}. Every assertion ` +
      "in this file is \"the list of problems is empty\", so a corpus this " +
      "small makes all of them pass while comparing nothing. Either the path " +
      "is wrong (the directory moved, or this file did), the `.md` filter " +
      "stopped matching, or something deleted the goals.",
  ).toBeGreaterThanOrEqual(FEWEST_GOALS);
  return names;
}

function indexText(): string {
  const text = readFileSync(resolve(GOALS, INDEX), "utf8");
  /* An index emptied to a stub is the same vacuous pass from the other side:
     no rows means no dangling rows. */
  expect(
    text.trim().length,
    `${INDEX} is empty or near it. An index with no rows has no broken rows, ` +
      "so the dangling-link case would pass on a file that lists nothing.",
  ).toBeGreaterThan(200);
  return text;
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
  /**
   * THE CASE THAT FAILS WHEN THERE IS NOTHING TO CHECK.
   *
   * `goalFiles` and `indexText` already refuse an implausible corpus, so this
   * adds the one thing they cannot see from inside themselves: that the index
   * actually PARSES. `linkedFiles` is a regular expression over markdown, and
   * a regular expression that has stopped matching returns an empty set
   * rather than an error — switch the index to reference-style links
   * (`[name][1]`) and every row is still there, still correct, and invisible
   * to this file. The completeness case would go red and point at the goals,
   * which is the wrong half of the repository to go looking in; the dangling
   * case would go green. This one says which it is.
   */
  it("has a corpus, an index, and an index it can read", () => {
    const files = goalFiles();
    const linked = linkedFiles(indexText());
    expect(
      linked.size,
      `${INDEX} yielded ${linked.size} same-directory \`](name.md)\` links for ` +
        `${files.length} goal documents. The rows are read with a regular ` +
        "expression, and one that no longer matches the index's link syntax " +
        "comes back empty instead of failing — which would leave the " +
        "dangling-link case below with nothing to find. Check the index's " +
        "markdown before changing anything in `docs/goals/`.",
    ).toBeGreaterThanOrEqual(FEWEST_GOALS);
  });

  it("keeps only live exemptions", () => {
    /* An exemption names a file. When that file is renamed or deleted the
       name stays behind, excusing nothing while reading as though it still
       excuses something — and the next person to need an exemption copies a
       line that has not meant anything for months. */
    const present = new Set(goalFiles());
    const stale = EXEMPT.filter((name) => !present.has(name));
    expect(
      stale,
      "these names are exempted from the `Status:` rule and are not in " +
        "`docs/goals/` any more. Delete the exemption in the same diff as the " +
        "file, or the list grows into a thing nobody dares prune.",
    ).toEqual([]);
    /* And the list must stay an exception. Exempting the corpus would make
       the status case below unfailable in the quietest possible way. */
    expect(
      EXEMPT.length,
      "the exemption list has grown to cover most of the corpus, which makes " +
        "the status case pass by excusing everything it was meant to check.",
    ).toBeLessThan(FEWEST_GOALS / 2);
  });

  it("lists every goal document", () => {
    const linked = linkedFiles(indexText());
    const missing = goalFiles().filter((name) => !linked.has(name));
    expect(
      missing,
      "these files are in `docs/goals/` and not in `docs/goals/README.md`. " +
        "A new engineer reads that index to find out which of those thousands " +
        "of lines describe work that is happening now, and a partial index " +
        "still looks complete. Add a row under the section matching the " +
        "file's own `Status:` line.",
    ).toEqual([]);
  });

  it("links only to goal documents that exist", () => {
    const present = new Set(goalFiles());
    const rows = [...linkedFiles(indexText())];
    /* Said again here rather than leaned on from the case above: this is the
       assertion an empty set of rows passes, so it is the one that has to
       know its own input was real. */
    expect(rows.length, `${INDEX} offered no rows to check`).toBeGreaterThanOrEqual(
      FEWEST_GOALS,
    );
    const dangling = rows.filter((name) => !present.has(name)).sort();
    expect(
      dangling,
      "`docs/goals/README.md` links to these, and they are not there. A " +
        "renamed goal needs its row renamed in the same diff.",
    ).toEqual([]);
  });

  it("keeps every goal carrying the status line the index is built from", () => {
    /* The index's sections come from these lines. A goal without one cannot
       be placed, and the omission is invisible until someone tries. The
       handoff note is exempt by name (see `EXEMPT`): it is a session record
       filed with its goal, not a goal, and the index says so. */
    const exempt = new Set(EXEMPT);
    const read = goalFiles().filter((name) => !exempt.has(name));
    /* The files this case actually opened. Subtracting the exemptions from a
       corpus that passed the floor cannot leave nothing — but it is this
       number, not the corpus, that decides whether the emptiness below means
       anything, so it is this number that is checked. */
    expect(
      read.length,
      "no goal document was read, so no missing `Status:` line could be found",
    ).toBeGreaterThanOrEqual(FEWEST_GOALS - EXEMPT.length);
    const statusless = read.filter(
      (name) => !/^Status:/m.test(readFileSync(resolve(GOALS, name), "utf8")),
    );
    expect(
      statusless,
      "every goal opens with a `Status:` line — it is what says whether this " +
        "is a plan, work in flight, or a finished record, and it is what the " +
        "index is built from.",
    ).toEqual([]);
  });
});
