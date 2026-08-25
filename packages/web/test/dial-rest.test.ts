/**
 * THE TIMELINE IS NOT SWITCHED ON BY WHERE IN TIME YOU ARE.
 *
 * The founder asked, four separate times, for the hairline across the screen
 * to stop being there. It was hidden at rest, a gate was written that proved
 * it hidden at rest, screenshots were taken showing it hidden at rest — and
 * on their machine the line was still there.
 *
 * The reason was not a stray rule. `.jar-dial--live` was set on
 * `scrubbing || !atNow`, and `--live` is one of the ways the rail is REVEALED.
 * `atNow` goes false the moment you wind the wall back, and nothing sets it
 * true again except scrubbing to within half a day of the present — which is
 * a target a few pixels wide at the right-hand end of a rail you can only see
 * while you are touching it. So the first drag turned the hairline on for the
 * rest of the session, and there was no gesture that turned it off.
 *
 * Every gate and every capture missed it for the same reason: they open the
 * page, look, and never touch the dial. `atNow` is true for the whole life of
 * such a run, so the rest state they measured was real and the state a person
 * who had actually used the instrument was living in was never measured at
 * all. A fixture that only ever looks is not a neutral fixture.
 *
 * WHAT REPLACED IT. The fact "you are parked away from now" is carried by
 * `.jar-when`, the word in the top-left, which prints the day you are standing
 * in and does it at full ink. Light is the only meaning channel; a word can
 * hold that meaning, and then nothing has to stay switched on to hold it.
 *
 * WHY THIS IS A SOURCE GATE. `e2e/measure.ts` opens a real engine and can
 * prove what a class DOES, and it does: `the-rail-rests-hidden` measures the
 * rail at 0 at rest and 0.9 when asked for. What it cannot see is which
 * classes the world decides to hand it — that is a line of TSX, and in jsdom
 * the world is a canvas that never lays out. So this reads the expression and
 * fails if `atNow` is ever wired back into it.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads one file off disk and
 * asserts about the text in it, exactly as `hq-pointer.test.ts` and
 * `contrast.test.ts` do, and for the same reason: the thing being protected is
 * invisible to every rendered suite in this package.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOME = readFileSync(resolve(HERE, "../src/pages/Home.tsx"), "utf8");
const CSS = readFileSync(resolve(HERE, "../src/styles/home.css"), "utf8");

/** The className expression the dial is built from, as written. */
function dialClassExpression(): string {
  const at = HOME.indexOf("className={`jar-dial${");
  if (at < 0) return "";
  /* to the end of that template — the expression is one JSX attribute */
  const end = HOME.indexOf("`}", at);
  return end < 0 ? "" : HOME.slice(at, end + 2);
}

describe("the rail rests, whatever the archive's dates are", () => {
  it("still builds the dial's classes from one expression this gate can read", () => {
    /* If this fails the dial was rewritten and the two checks below are
       asserting about nothing — which is worse than no gate. */
    expect(
      dialClassExpression(),
      "the dial's className is no longer a `jar-dial${...}` template. Rewriting " +
        "it is fine; leaving this gate pointing at a shape that no longer " +
        "exists is not. Repoint it at wherever the classes are decided now.",
    ).not.toBe("");
  });

  it("never sets --live from where in time you are parked", () => {
    const expr = dialClassExpression();
    expect(
      /jar-dial--live/.test(expr),
      "`--live` is gone from the dial entirely. If that was deliberate, drop " +
        "this check — but the reveal rules in home.css still name it.",
    ).toBe(true);
    expect(
      /atNow/.test(expr),
      "`atNow` is back in the dial's classes. That is the bug: one drag turns " +
        "`atNow` false and only a scrub back to within half a day of now turns " +
        "it true again, so a reveal class fed by it keeps the hairline drawn " +
        "across the screen for the rest of the session. Where in time you are " +
        "parked is said by `.jar-when`, in words, in the top-left.",
    ).toBe(false);
  });

  it("says where in time you are with a word, and lights it when it is news", () => {
    /* The replacement has to actually exist, or the fact went unsaid rather
       than being said better. */
    expect(
      /className=\{`jar-when jar-label\$\{/.test(HOME),
      "`.jar-when` is not rendered any more. It is the only thing telling a " +
        "person they are standing somewhere other than now.",
    ).toBe(true);
    expect(
      /jar-when--away/.test(HOME) && /\.jar-when--away\s*\{[^}]*color:/.test(CSS),
      "`.jar-when--away` no longer changes the word's colour. Being wound back " +
        "is carried in light and nothing else — that is what let the rail go.",
    ).toBe(true);
  });

  it("leaves the bottom edge itself to the count", () => {
    /* The rail lives at the bottom — it is a horizontal instrument and that is
       the only clear full-width band on the page. What it must not do is take
       the EDGE, which belongs to the count: `e2e/measure.ts` proves the 10px
       between them in a real engine, and this only pins the anchor that makes
       that geometry possible at all. */
    const at = CSS.indexOf("\n.jar-dial {");
    expect(at, "`.jar-dial` has no rule").toBeGreaterThan(-1);
    const rule = CSS.slice(at, CSS.indexOf("\n}", at));
    expect(
      /bottom:\s*calc\(42px/.test(rule),
      "the rail no longer stands 42px off the bottom. That number is what " +
        "leaves the count its own 10px from the glass — if the rail is being " +
        "moved, move `signposts-one-inset` in e2e/measure.ts with it rather " +
        "than letting the two edges quietly disagree.",
    ).toBe(true);
  });
});
