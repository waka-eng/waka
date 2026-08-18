/**
 * THE MAP MUST NOT NAME A FILE THAT IS NOT THERE.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads two markdown files and
 * the filesystem. There is no layer beneath it to stand in for.
 *
 * WHY IT EXISTS.
 *
 * `docs/map.md` is the answer to gate G2 — the document a person reads when
 * they have never opened this repository, and the only artifact whose entire
 * job is navigability. `docs/architecture.md` is the one it defers to for the
 * three vocabularies.
 *
 * A reviewer asked five newcomer questions starting from the map. Two were
 * answered in one hop. One failed outright. And the map turned out to name
 * `packages/web/src/lib/api.ts` three times after that file had been split into
 * `lib/api/`, while `architecture.md` was still describing a translation layer
 * in a file — `world-data.ts` — deleted long enough ago that nobody remembered
 * it. A map that sends a newcomer to a path that does not exist is worse than
 * no map: it costs them the trust they would otherwise spend reading code.
 *
 * Nothing caught either. Prose is not compiled, so a rename silently invalidates
 * every document that mentions it, and the documents most worth writing are the
 * ones that name the most files.
 *
 * So the paths become checkable. This does not verify that a document's CLAIMS
 * are true — a sentence can be wrong about a file that exists, and this cannot
 * see that. It removes the one failure that is mechanical, and says plainly
 * below what it still cannot see.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

/** Repo root, from packages/web/test/. */
const ROOT = resolve(import.meta.dirname, "..", "..", "..");

/**
 * The documents whose job is to point at code.
 *
 * Deliberately not every markdown file in the repo. A goal document is a record
 * of what was true when it was written, and rewriting one to keep a path alive
 * would falsify the record — `a-codebase-you-can-navigate.md` says of its own
 * table that it is "the dated snapshot it says it is". These two are different:
 * they describe the code as it is NOW, and are read by someone trying to find
 * their way around it today.
 */
const NAVIGATIONAL_DOCS = ["docs/map.md", "docs/architecture.md"];

/**
 * A path inside a backtick. Bounded to the three roots that hold code, so that
 * `\`signal\`" or "\`GET /api/signals\`" are not mistaken for filenames.
 */
const CITED_PATH =
  /`(packages\/[A-Za-z0-9_.\/-]+\.(?:ts|tsx|mjs|json)|docs\/[A-Za-z0-9_.-]+\.md|drizzle\/[A-Za-z0-9_.\/-]+)`/g;

function citedPaths(doc: string): string[] {
  const source = readFileSync(resolve(ROOT, doc), "utf8");
  /* Struck-through text records a defect that has since been fixed; the path in
     it is deliberately historical and may well be gone. */
  const live = source.replace(/~~[\s\S]*?~~/g, " ");
  return [...new Set([...live.matchAll(CITED_PATH)].map((m) => m[1]!))];
}

describe("the navigational documents point at files that exist", () => {
  it("finds paths to check — 'nothing cited' is not a pass", () => {
    /* The conditional-assertion trap: a scan whose assertions sit behind a
       match passes silently when it matches nothing. This repo has shipped that
       failure more than once, so the subject is asserted into existence first. */
    for (const doc of NAVIGATIONAL_DOCS) {
      expect(citedPaths(doc).length, `${doc} cites no file paths at all`).toBeGreaterThan(3);
    }
  });

  for (const doc of NAVIGATIONAL_DOCS) {
    it(`every path ${doc} names is really there`, () => {
      const missing = citedPaths(doc).filter((p) => !existsSync(resolve(ROOT, p)));
      expect(missing).toEqual([]);
    });
  }

  it("does not mistake prose for a path", () => {
    /* The check is only worth having if it is quiet on the words around the
       paths. If this ever fails, widen the pattern's exclusions rather than
       relaxing the assertions above. */
    const strayLooking = citedPaths("docs/map.md").filter(
      (p) => !/^(packages|docs|drizzle)\//.test(p),
    );
    expect(strayLooking).toEqual([]);
  });
});

/**
 * WHAT THIS STILL CANNOT SEE, so nobody reads a green run as more than it is:
 *
 * 1. A sentence that is WRONG about a file that EXISTS. The map said
 *    match-or-mint happens in `signal-derivation.ts`; the path is real and the
 *    claim moved to `signal-match-or-mint.ts`. Only a reader catches that.
 * 2. A line number. `middleware.ts:140` stays green when the function moves to
 *    line 900.
 * 3. A path written without backticks, or spanning a line break.
 * 4. A file that should be cited and is not — the map has no mention of the
 *    login throttle at all, which is how a reviewer failed to find it.
 *
 * The fix for (1) and (4) is a reader, not a script; the honest thing is to say
 * so here rather than let this file imply the map is verified.
 */
