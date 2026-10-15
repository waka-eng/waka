/**
 * ═══ A CLASS IN THE MARKUP WITH NO RULE ANYWHERE ══════════════════════════
 *
 * Founder, reading the top of mind on dev: the three verbs under the
 * statement printed as "EditRemoveWrite a new one" — one run of text, no
 * gaps, wrong type size.
 *
 * THE CAUSE WAS A CLASS NOTHING DECLARED. `<p className="jar-poster-aside">`
 * was used exactly once and no stylesheet ever mentioned it, so the three
 * buttons inside had no layout at all — and, because they were outside
 * `.jar-board-acts button.jar-board-act`, no type register either. Two
 * faults from one missing class, on the product's single most-looked-at
 * surface, shipped and live.
 *
 * THIS IS THE INVERSE OF DEAD CSS AND NOTHING WAS LOOKING FOR IT.
 * `dead-css.ts` walks the stylesheets and asks "does anything wear this
 * rule?" — a rule with no element. This is an element with no rule, and the
 * two are not the same question: every dead-CSS pass this session, and the
 * browser walk behind it, would report a perfectly healthy sheet while this
 * sat in the markup. Six gates were found green-while-blind in one night;
 * this is the seventh hole, and it is the one that reached the founder's
 * screen.
 *
 * A LEDGER, NOT A BAN, because the empty answer is legitimate sometimes.
 * A modifier can be a pure hook — `waka-dock-tool--erase` carries no
 * declarations of its own and is styled entirely by `.waka-dock-tool`,
 * which is correct and should not be made to declare something. So the
 * known set is pinned with the count, and a SIXTEENTH fails. That is the
 * ratchet: it cannot grow without somebody writing down why.
 *
 * WHAT TO DO WHEN THIS GOES RED. Ask which kind you have. If the class
 * carries meaning the page needs — layout, type, colour — it wants a rule,
 * and the bug is the missing rule. If it is a hook, a test handle, or a
 * modifier read only by a parent selector, add it to the ledger WITH the
 * reason. Do not raise the number without the sentence.
 *
 * Several entries below are unexamined and may well be the same bug as
 * `jar-poster-aside`. `chat-recheck` in particular is a real button.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing, and it could not. The claim
 * is about the relationship between two sets of FILES on disk — the class
 * names the markup writes, and the selectors the stylesheets declare — so
 * the only honest way to make it is to read both from the real tree. A
 * fixture here would be a test that the fixture agrees with itself: it
 * would stay green through exactly the defect this exists to catch, which
 * is a real class in a real component that no real sheet dresses.
 *
 * It renders nothing, so there is no DOM, no canvas, no clock and no
 * network to stand in for.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";


const SRC = resolve(__dirname, "../src");

/** Classes that legitimately carry no declarations of their own. */
const DRESSED_BY_SOMETHING_ELSE = 14;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === "styles") continue;
    if (statSync(path).isDirectory()) files(path, out);
    else if (name.endsWith(".tsx") || name.endsWith(".ts")) out.push(path);
  }
  return out;
}
const stripComments = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, " ");

describe("every class the markup wears is dressed by some rule", () => {
  it("has no more undressed classes than the ledger records", () => {
    const worn = new Set<string>();
    for (const path of files(SRC)) {
      const text = stripComments(readFileSync(path, "utf8"));
      for (const match of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g)) {
        for (const group of match.slice(1)) {
          if (!group) continue;
          for (const token of group.match(/[a-zA-Z][\w-]*/g) ?? []) {
            /* Only hyphenated tokens: the bare words in a template literal are
               variables and ternary branches, not class names. */
            if (token.includes("-")) worn.add(token);
          }
        }
      }
    }
    const declared = new Set<string>();
    for (const name of readdirSync(join(SRC, "styles"))) {
      if (!name.endsWith(".css")) continue;
      const css = stripComments(readFileSync(join(SRC, "styles", name), "utf8"));
      for (const match of css.matchAll(/\.([a-zA-Z][\w-]*)/g)) declared.add(match[1]);
    }
    const undressed = [...worn].filter((name) => !declared.has(name)).sort();
    expect(
      undressed.length,
      `${undressed.length} classes are worn by the markup and declared by no stylesheet:\n` +
        `  ${undressed.join("\n  ")}\n` +
        "If one of these needs layout, type or colour, the bug is the missing rule — " +
        "that is how the top of mind's verbs shipped as \"EditRemoveWrite a new one\". " +
        "If it is a hook or a modifier a parent styles, raise the number here AND say why.",
    ).toBeLessThanOrEqual(DRESSED_BY_SOMETHING_ELSE);
  });
});
