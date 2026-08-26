/**
 * EVERY FIELD OF A WALL'S CHROME IS READ BY SOMETHING THAT DRAWS.
 *
 * ── THE SHAPE NO OTHER GATE IN THIS REPO CAN SEE ───────────────────────────
 *
 * `orphans.test.ts` asks "is this module reachable, is this export called?".
 * `dead-css.ts` asks the browser which rule won each property. Both answer
 * *is this called*. Neither can answer the third question:
 *
 *     something is computed, stored, compared on every render — and nothing
 *     ever puts it in front of a person.
 *
 * `WallChrome` is where that kept happening, twice, unnoticed:
 *
 *   `forming`   `formingWords()` composes the line under the poster that says
 *               something is happening beneath it — "One signal is forming",
 *               or "A new ambition is forming" when a proposal outranks the
 *               readings. It is computed in both chrome derivations and read
 *               by no JSX at all. Confirmed in a browser with an emerging
 *               signal on the server: no forming line, before or after a
 *               reload.
 *
 *   `eyebrow`   went dark by a founder ruling on 2026-08-25 — "this should
 *               always say TOP OF MIND at the top no matter what room" — and
 *               the JSX writes those words literally. Nothing was wrong with
 *               that. What was wrong is that the field's doc comment still
 *               promised "the wall's name, and nothing else in that slot,
 *               ever", so a room's wall reading `top of mind` looked like a
 *               bug, and the audit that measured it came within one edit of
 *               reverting the ruling.
 *
 * Neither was found by a gate. Both were found by hand, chasing something
 * else, weeks apart. This is the cheapest thing that finds the next one on
 * the day it appears.
 *
 * ── WHAT COUNTS AS BEING READ ──────────────────────────────────────────────
 *
 * The render binds a wall's chrome to `c` (`const c = here ? chrome : …`), so
 * a field is DRAWN when `c.field` or `c?.field` appears in a `.tsx` file.
 * Deliberately not "appears anywhere": `prev.forming === next.forming` in the
 * memo's equality check is a read, and counting it would have let the exact
 * bug this gate exists for walk straight through.
 *
 * If the render binding is ever renamed, every field fails at once and the
 * fix is one line in `BINDINGS`. That is a good failure — loud, obvious, and
 * impossible to mistake for a finding about the product.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. Source is read as text.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const BOARD = resolve(SRC, "space/top-of-mind/board.ts");

/** The names the render tree binds a wall's chrome to. */
const BINDINGS = ["c", "chrome"];

/**
 * Fields that nothing draws ON PURPOSE, each with the reason and where the
 * reason is written down. A field may only sit here because a decision put it
 * here — never because it stopped being used and nobody noticed. That is the
 * whole difference this gate exists to keep visible.
 */
const DARK_BY_DECISION: Record<string, string> = {
  eyebrow:
    "RULED (founder, 2026-08-25): 'this should always say TOP OF MIND at the top " +
    "no matter what room' — the JSX writes those words literally. The name is " +
    "already on screen twice, in the pill and on the axis.",
  forming:
    "REPORTED, undecided — docs/audits/unreachable-behaviour-2026-08-26.md. " +
    "Deleting removes a designed piece of the product's voice; rendering it adds " +
    "a line to the poster. Both are decisions about what the poster says.",
};

function everyTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) everyTsx(full, out);
    else if (entry.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const strip = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/** The field names declared on `interface WallChrome`, comments removed. */
function wallChromeFields(): string[] {
  const source = strip(readFileSync(BOARD, "utf8"));
  /* A WORD BOUNDARY, because `indexOf` does not have one. Sabotaging this
     file by renaming the interface to `WallChromeX` passed all three checks:
     the prefix still matched, the parser happily read the renamed interface,
     and the floor below reported everything fine. It only failed once the
     name shared no prefix at all — which is to say the floor was testing
     something narrower than it claimed. */
  const found = /\binterface\s+WallChrome\b/.exec(source);
  expect(found, "interface WallChrome has moved or been renamed").not.toBeNull();
  const start = found!.index;
  const open = source.indexOf("{", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source.slice(open + 1, end);
  return [...body.matchAll(/(\w+)\s*[?]?\s*:/g)].map((m) => m[1] as string);
}

describe("a wall's chrome", () => {
  it("declares fields the gate can actually see", () => {
    /* THE GATE'S OWN FLOOR. A parser that silently found nothing would report
       a clean sweep over an empty list — the most convincing possible way to
       be wrong. If this ever fails, the interface moved and the check below
       means nothing until it is fixed. */
    const fields = wallChromeFields();
    expect(fields.length).toBeGreaterThanOrEqual(6);
    expect(fields).toContain("text");
  });

  it("draws every field, or says in writing why it does not", () => {
    const fields = wallChromeFields();
    let blob = "";
    for (const file of everyTsx(SRC)) blob += strip(readFileSync(file, "utf8"));

    const undrawn = fields.filter(
      (field) =>
        !BINDINGS.some((bind) =>
          new RegExp(`\\b${bind}\\s*\\??\\.\\s*${field}\\b`).test(blob),
        ),
    );

    const unexplained = undrawn.filter((field) => !(field in DARK_BY_DECISION));
    expect(
      unexplained,
      "these fields of WallChrome are computed on every render and nothing draws " +
        "them. That is not dead code a person can see — it is worse: a value the " +
        "product spends work on that no one receives. Either render it, remove it, " +
        "or add it to DARK_BY_DECISION with the ruling that made it dark and where " +
        "that ruling is written down.",
    ).toEqual([]);
  });

  it("keeps no excuse for a field that is drawn after all", () => {
    /* THE RATCHET'S OTHER HALF, and the reason this file is not just a list.
       An exception that has quietly become wrong is a gate lying in the
       reassuring direction: it reports a considered decision where there is
       now simply a stale entry. Every parked field must still be dark. */
    const fields = wallChromeFields();
    let blob = "";
    for (const file of everyTsx(SRC)) blob += strip(readFileSync(file, "utf8"));

    const stale = Object.keys(DARK_BY_DECISION).filter(
      (field) =>
        fields.includes(field) &&
        BINDINGS.some((bind) =>
          new RegExp(`\\b${bind}\\s*\\??\\.\\s*${field}\\b`).test(blob),
        ),
    );
    expect(
      stale,
      "these fields are listed as deliberately undrawn and something draws them " +
        "now. The decision was reversed and the note was not — delete the entry.",
    ).toEqual([]);

    const gone = Object.keys(DARK_BY_DECISION).filter((field) => !fields.includes(field));
    expect(
      gone,
      "these fields are listed as deliberately undrawn and no longer exist on " +
        "WallChrome at all. Delete the entry with the field.",
    ).toEqual([]);
  });
});
