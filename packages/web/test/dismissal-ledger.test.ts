/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads the source tree off
 * disk and asks which surfaces opt into a hook. No module is imported for its
 * behaviour and there is no DOM, clock, server or account data involved.
 * `helpers/code-only` replaces nothing: it is a string transform over source
 * text, so that prose quoting `modal={false}` cannot be counted as code. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { withoutComments } from "./helpers/code-only";

/**
 * ═══ WHICH SHEETS CLOSE BOTH WAYS, WRITTEN DOWN WHERE IT CANNOT ROT ═════
 *
 * `lib/dismiss.ts` used to open with "EVERY SHEET CLOSES THE SAME TWO WAYS …
 * one hook, so a sheet added later gets both without anyone remembering to."
 * Three of ten modal sheets had opted in. After rooms were removed on
 * 2026-10-12 it is one of seven, and the fall is itself the argument for
 * this gate: two of the three covered sheets were a room's, so a prose
 * claim of "three" would have survived the deletion untouched. The sentence was not a lie when it
 * was written — it was a description of an intention — and it became one
 * quietly, which is the whole problem: the file holding a rule is where
 * anybody auditing that rule looks, so a stale claim there is worse than no
 * claim at all.
 *
 * The header is now a count and a list with a reason beside each entry. A
 * list in a comment is exactly what went stale the first time, so this is
 * the half that keeps it true: the ledger below has to match the tree, and
 * it fails in BOTH directions.
 *
 *   A NEW MODAL SHEET fails until somebody adds it here, which costs one
 *   line and forces the question "does this one close when you press away"
 *   to be answered once, in the place the answer is recorded.
 *
 *   A SHEET THAT GAINS OR LOSES PRESS-AWAY fails until the ledger agrees,
 *   so the comment and the code cannot drift apart again.
 *
 * WHY `modal` IS THE LINE. `DialogSurface` renders `modal={false}` surfaces
 * as PAGES — the archive, the claims queue, the principles page, the chats
 * list and a conversation — and its own header argues press-away is not
 * applicable to them: "There is nowhere to press away TO. A sheet floats on
 * a scrim and the scrim is the press target; `.waka-page` is opaque and
 * covers the viewport." That argument is complete for the pages and is NOT
 * made for the sheets, which do float. So the pages are out of scope by
 * construction and the ten that remain are the ones a person could press
 * beside.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/**
 * THE LEDGER. One line per file that holds a modal sheet, so that a sheet
 * arriving or leaving is a line somebody has to write — which is the moment
 * the question "does this one close when you press away" gets answered, in
 * `lib/dismiss.ts`, where the answer is recorded with its argument.
 *
 * WHICH ONES ACTUALLY TAKE PRESS-AWAY IS NOT A FIELD HERE, deliberately.
 * The first draft of this ledger had an `away: boolean` per row and nothing
 * asserted it — and it was already wrong on the last row, where two of
 * `Home.tsx`'s four sheets take the hook and two do not. A field that
 * nothing checks is a comment with a type annotation, and this review began
 * with six assertions that could not fail. Coverage is asked of the file
 * that WIRES it, in the last case below.
 *
 * The file is the key, not the line number: a sheet that moves down its own
 * file has not changed, and a ledger that failed on every unrelated edit
 * above it would be deleted within a month.
 */
const SHEETS: ReadonlyArray<{ file: string; what: string }> = [
  { file: "components/InspirationComposer.tsx", what: "the notepad — press-away refused on purpose" },
  { file: "components/InspirationSearch.tsx", what: "the archive's search — holds a typed query" },
  { file: "components/PrincipleShare.tsx", what: "sharing a principle — never opted in" },
  { file: "components/ReadingChanges.tsx", what: "what changed in the reading — never opted in" },
  /* TWO ROWS LEFT THIS LEDGER ON 2026-10-12 (founder: "방 없애" — remove
     rooms): `space-kinds/GroupPanel.tsx`, the room form, which held a
     half-typed name and never opted in; and `space/settings/
     SpaceSettings.tsx`, a room's settings, which DID take press-away and
     had been unable to mount since 2026-10-09. Both files are deleted. */
  /* TWO IN ONE FILE, so this is the one place the ledger counts rather
     than naming: `Home.tsx` holds the memory card and the provenance room.
     The agent's name sheet was the third until 2026-10-15, when it was
     deleted for being unopenable. One of the two takes press-away, and
     splitting them apart here would mean identifying a JSX element by line
     number — the thing the note above refuses. It was FOUR until the join
     sheet went with rooms, and that sheet was one of the two covered ones.
     `Home.tsx`'s own split, when it comes, turns this row into named
     rows. */
  { file: "pages/Home.tsx", what: "the memory card (does not), the provenance room (takes press-away)" },
];

/** Every `<DialogSurface …>` opening tag in the tree, as file + whether it
    said `modal={false}`. Read from the source with comments blanked: two of
    these call sites DISCUSS `modal={false}` in the prose beside the
    attribute, and a gate that counted those would be reading documentation
    as evidence — see `helpers/code-only.ts`. */
function surfaces(): Array<{ file: string; modal: boolean }> {
  const found: Array<{ file: string; modal: boolean }> = [];
  for (const path of sources(SRC)) {
    const text = withoutComments(readFileSync(path, "utf8"));
    for (const hit of text.matchAll(/<DialogSurface\b/g)) {
      /* THE OPENING TAG ENDS AT THE FIRST `>` OUTSIDE BRACES, which is what
         makes this safe to run on JSX: every attribute value and every
         comment in an attribute list is inside `{…}`, so depth-zero is the
         only place the tag can close. A naïve `indexOf(">")` would stop
         inside `onClose={() => …}` on nine of these ten call sites. */
      let depth = 0;
      let at = hit.index + 1;
      while (at < text.length) {
        const here = text[at]!;
        if (here === "{") depth += 1;
        else if (here === "}") depth -= 1;
        else if (here === ">" && depth === 0) break;
        at += 1;
      }
      const attrs = text.slice(hit.index, at);
      found.push({ file: path.slice(SRC.length + 1), modal: !/\bmodal=\{false\}/.test(attrs) });
    }
  }
  return found;
}

describe("the sheets that close when you press away", () => {
  it("reads the tree at all", () => {
    /* THE TRIPWIRE, BECAUSE A GATE THAT READS NOTHING PASSES. A renamed
       component or a moved directory would make both lists empty and every
       assertion below vacuously green. */
    expect(surfaces().length, "no DialogSurface call sites found — has the component been renamed?")
      .toBeGreaterThan(10);
  });

  it("has a ledger row for every modal sheet, and no row for anything else", () => {
    const modal = [...new Set(surfaces().filter((one) => one.modal).map((one) => one.file))].sort();
    expect(modal, "a modal sheet arrived or left — add or remove its row in SHEETS, and say in lib/dismiss.ts why it does or does not close on a press away")
      .toEqual(SHEETS.map((row) => row.file).sort());
  });

  it("agrees with lib/dismiss.ts about how many sheets there are", () => {
    /* THE COUNT IS IN THE PROSE, so the prose is held to it. `dismiss.ts`
       says how many modal `DialogSurface` call sites there are and how many
       are covered — sentences a reader will trust, which is the reason the
       first version of that header was a problem. The number is matched as
       a numeral rather than as a word now: it was spelled "ten", and
       spelling it meant this assertion had to know English number names to
       stay green through a removal. */
    const header = readFileSync(resolve(SRC, "lib/dismiss.ts"), "utf8");
    const sheets = surfaces().filter((one) => one.modal).length;
    expect(header, `the tree holds ${sheets} modal sheets and the header does not say so`)
      .toContain(`${sheets} modal`);
    const callers = sources(SRC)
      .filter((path) => !path.endsWith("lib/dismiss.ts"))
      .flatMap((path) => [...withoutComments(readFileSync(path, "utf8")).matchAll(/\buseDismissAway\(/g)]);
    expect(callers.length, "the number of sheets opting into useDismissAway changed; the header says one")
      .toBe(1);
  });

  it("gives press-away to exactly the sheets the ledger says take it", () => {
    /* ASKED OF THE FILE THAT WIRES IT, which is where the truth is: the hook
       is called with the sheet's open-state and its keep-list, and only
       `Home.tsx` calls it. A ledger row claiming `away: true` for a file
       nothing wires would otherwise read as covered for ever. */
    const wired = withoutComments(readFileSync(resolve(SRC, "pages/Home.tsx"), "utf8"));
    const calls = [...wired.matchAll(/useDismissAway\(([^)]*)\)/g)].map((hit) => hit[1]!.trim());
    expect(calls.length, "Home.tsx no longer wires the one covered sheet").toBe(1);
    /* ONE CALL, ONE SHEET — and the distinctness check below is what stops
       N calls for the SAME surface satisfying a count, which is the vacuous
       pass available to any assertion that only counts. It mattered when
       there were three; it is kept at one so that the second sheet to opt
       in cannot do it by repeating the first.

       THE STATES ARE NOT SPELLED OUT, deliberately. They were, in the first
       draft: `settingsFor !== null`, `pendingJoin !== null`, `prov !== null`
       — and two of those three names no longer exist, which is exactly the
       failure the note predicted: it reds the build when a state variable is
       renamed or removed, which is not a change in dismissal coverage, and a
       gate that fails for reasons unrelated to its subject is a gate that
       gets deleted. What must not change silently is the NUMBER and which
       sheets, and the number is asserted above while the files are asserted
       by the ledger. */
    /* AGAINST `calls.length`, NOT A LITERAL. At one call this cannot fail --
       one call has one state and a set of one -- so written as `.toBe(1)` it
       was a line that could only ever pass. Expressed against the count it
       states the actual invariant (one sheet per call, no repeats) and arms
       itself the moment a second sheet opts in, instead of needing somebody
       to notice and rewrite it. Inert today, on purpose, and not pretending
       otherwise. */
    const states = calls.map((args) => args.split(",")[0]!.trim());
    expect(
      new Set(states).size,
      `${calls.length} calls, fewer sheets than calls: ${states.join(" | ")}. ` +
        "The one covered sheet is the provenance room.",
    ).toBe(calls.length);
  });
});
