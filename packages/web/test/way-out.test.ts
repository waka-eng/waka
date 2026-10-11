/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. This reads source text off
 * disk and asserts a property of it. No component mounts, no module is
 * imported for its behaviour, and no server, DOM or account data is used —
 * there is nothing here that could be mocked, which is the point: a ruling
 * enforced by a gate does not depend on anyone remembering to mount the
 * surface it governs. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ═══ LAW 2: EVERY SURFACE HAS A WAY OUT YOU CAN SEE ═══
 *
 * The founder's most-repeated complaint, in their own words, three times on
 * three different surfaces:
 *
 *   "for your inspirations, after I click on it, I feel like I'm lost how to
 *    go back to the previous screen"
 *   "I go to my agent and then now I have no way to get back to my top of
 *    mind"
 *   "I find it so annoying that from talk with Waka, there's no one click to
 *    go back to top of mind"
 *
 * Each was fixed where it was reported, and the next one arrived anyway. That
 * is what this file is for. See `docs/six-laws.md`.
 *
 * ── WHY A GATE AND NOT A CHECKLIST ────────────────────────────────────────
 *
 * Law 3 says a change to the system has to land on every surface rather than
 * the one being looked at, and the mechanism has always been a gate: the type
 * scale drifted into two parallel systems precisely because two stylesheets
 * were not in `GOVERNED`, and the rulings about them were therefore unaudited
 * BY CONSTRUCTION. A design law with no gate is a law that holds until the
 * next surface is written.
 *
 * ── WHAT COUNTS AS A WAY OUT, AND WHAT DOES NOT ───────────────────────────
 *
 * `DialogSurface` already gives every sheet Escape, a focus trap and focus
 * restoration, and several of these also close on a press away. NONE OF THAT
 * COUNTS HERE. All of it is invisible, and invisible exits are exactly what
 * the three complaints above were describing — the archive had an address, a
 * working browser Back and a switcher naming it, and still read as a trap.
 * What counts is a control a person can SEE and press.
 *
 * So this looks for a rendered control that says it leaves: one of the way-out
 * words below, or a class named for the act. A surface with neither must say
 * why in `NO_VISIBLE_WAY_OUT`, with a reason — the same shape as
 * `verb-pairs.test.ts`, which asks every verb for a way back or a reason it
 * has none.
 */
/* `worldReflectionDone` IS OFF THIS REGISTER (2026-10-10), in the same change
   that removed the only surface wearing it. It held "Done for now", the
   visible close in the review sheet's header — and the note below still cites
   it, deliberately, because the lesson is about this gate rather than about
   that surface: a curated word list called that perfectly good exit a trap on
   its first run, which is why the structural check beneath it is the one to
   trust. The five review components are folded into the claim queue's
   correction field; a way-out word kept alive by nothing is the same leftover
   `verb-pairs.test.ts` refuses one file over, so it goes in this commit rather
   than the next one. */
const WAY_OUT_WORDS = [
  "worldClose",
  "worldCardClose",
  "worldNotNow",
  "worldEnough",
  "worldDone",
  "worldBack",
  "worldCancel",
  "worldCancelEdit",
  "worldPrinciplesBack",
  "loginBackToPage",
] as const;

/* A class named for leaving. The overlays' corner mark, and the footer rows
   that carry a single dismissing press on the surfaces built before it. */
const WAY_OUT_CLASSES = /className="[^"]*(?:-close\b|-out\b|waka-over-close|jar-x)\b/;

/**
 * THE STRUCTURAL SIGNAL, WHICH IS THE ONE THAT SHOULD BE TRUSTED.
 *
 * A curated list of words is a gate that fails the day someone writes a
 * perfectly good exit with a word nobody thought of — which is exactly what
 * happened on its first run: the review surface's header has carried a
 * visible "Done for now" wired to its own close since it was written, and
 * this file called it a trap. A gate that cries wolf gets an exemption added
 * to shut it up, and then it is guarding nothing.
 *
 * So the real test is structural: is there a button a person can see whose
 * press calls the same thing the surface's own `onClose` calls? That is what
 * "a visible way out" MEANS, independent of how the label is phrased or
 * which locale key happens to hold it.
 *
 * `aria-hidden` buttons are excluded deliberately. Several surfaces render
 * their scrim as a `<button aria-hidden tabIndex={-1}>` so it is a real press
 * target — and a scrim is the invisible exit this law was written about, so
 * counting it would let every surface pass by having a backdrop.
 */
function closedByAVisibleButton(span: string): boolean {
  const closer = /onClose=\{([^}]{1,60})\}/.exec(span);
  const handlers = [...span.matchAll(/<button\b([^>]*)>/g)]
    .filter((tag) => !/aria-hidden/.test(tag[1]))
    .map((tag) => tag[1]);
  return handlers.some((attrs) => {
    const press = /onClick=\{([^}]{1,80})/.exec(attrs);
    if (!press) return false;
    const body = press[1];
    return /\bonClose\b/.test(body) || Boolean(closer && body.includes(closer[1].trim()));
  });
}

/**
 * SURFACES WITH NO VISIBLE WAY OUT, AND WHY — a list that is meant to shrink.
 *
 * An entry is a decision on the record, not an exemption from the law. Two
 * kinds are legitimate:
 *
 *   - a MENU, whose every row leaves it, so a row that only undoes the press
 *     that opened it is the "Close menu" row the founder deleted: "this also
 *     is so useless."
 *   - a surface whose own content is a flow that finishes, where the finish
 *     IS the way out and a second control beside it would be two ways to
 *     agree.
 *
 * "It has Escape" is not a reason. "Nobody has complained" is not a reason.
 */
const NO_VISIBLE_WAY_OUT: Record<string, string> = {
  "components/OpenCorner.tsx":
    "A menu. Each of its three rows opens something and closes this, so the " +
    "only control it could add is the row the founder cut as useless.",
};

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, found);
    else if (name.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/** Each `<DialogSurface` and the text up to its matching close tag. Nesting
    is real — the archive opens a card sheet inside itself — so this counts
    depth rather than taking the first close tag it meets. */
function surfacesIn(text: string): string[] {
  const spans: string[] = [];
  const open = /<DialogSurface\b/g;
  let match: RegExpExecArray | null;
  while ((match = open.exec(text))) {
    let depth = 0;
    let at = match.index;
    const tag = /<DialogSurface\b|<\/DialogSurface>/g;
    tag.lastIndex = at;
    let edge: RegExpExecArray | null;
    while ((edge = tag.exec(text))) {
      depth += edge[0].startsWith("</") ? -1 : 1;
      if (depth === 0) {
        at = edge.index + edge[0].length;
        break;
      }
    }
    /* A self-closing surface renders nothing of its own, so there is nothing
       in it to find a way out of. */
    spans.push(text.slice(match.index, at));
  }
  return spans;
}

function hasWayOut(span: string): boolean {
  return (
    closedByAVisibleButton(span) ||
    WAY_OUT_CLASSES.test(span) ||
    WAY_OUT_WORDS.some((word) => span.includes(word))
  );
}

describe("every surface has a way out you can see", () => {
  const files = sourceFiles("src").filter((path) => readFileSync(path, "utf8").includes("<DialogSurface"));

  it("finds the surfaces at all", () => {
    /* THE TRIPWIRE, BECAUSE A GATE THAT READS NOTHING PASSES. If the
       component is renamed, or the walk stops matching, every assertion below
       goes vacuously green and the law stops being enforced silently — which
       is the failure mode this whole file exists to prevent, one level up. */
    expect(files.length, "no file renders a DialogSurface — has it been renamed?").toBeGreaterThanOrEqual(12);
    const spans = files.flatMap((path) => surfacesIn(readFileSync(path, "utf8")));
    expect(spans.length, "found the files but parsed no surfaces out of them").toBeGreaterThanOrEqual(18);
    /* And the spans must have real content: a balanced-match bug that
       returned the opening tag alone would find no way out anywhere and
       produce a wall of false failures rather than silence. */
    expect(Math.min(...spans.map((span) => span.length))).toBeGreaterThan(80);
  });

  it("offers a visible way out, or says why it does not", () => {
    const trapped: string[] = [];
    for (const path of files) {
      const key = path.replace(/^src\//, "");
      const spans = surfacesIn(readFileSync(path, "utf8"));
      const without = spans.filter((span) => !hasWayOut(span));
      if (!without.length || NO_VISIBLE_WAY_OUT[key]) continue;
      trapped.push(
        `${key}: ${without.length} of ${spans.length} surface(s) render no control that leaves.\n` +
          "    Escape and a press-away do not count — both are invisible, and " +
          "invisible exits are what the founder reported three times.\n" +
          "    Add a control a person can see, or put this file in " +
          "NO_VISIBLE_WAY_OUT with a reason.",
      );
    }
    expect(trapped, `\n${trapped.join("\n")}\n`).toEqual([]);
  });

  it("keeps no excuse for a surface that has one, or does not exist", () => {
    /* THE OTHER HALF OF THE RATCHET. An exemption outliving its reason is how
       a completeness check quietly stops checking: it reads as considered and
       excuses something nobody decided. Same argument as `goal-index`'s
       exemption case and `verb-pairs`' dead-entry case. */
    const stale = Object.keys(NO_VISIBLE_WAY_OUT).filter((key) => {
      const path = join("src", key);
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        return true;
      }
      return surfacesIn(text).every((span) => hasWayOut(span));
    });
    expect(
      stale,
      "an entry naming a file that is gone, or a surface that now has a " +
        "visible way out, excuses nothing while reading as if it does.",
    ).toEqual([]);
  });
});
