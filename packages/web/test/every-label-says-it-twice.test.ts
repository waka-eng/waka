/**
 * EVERY LABEL A PERSON IS GIVEN SAYS ITSELF IN BOTH LANGUAGES.
 *
 * FOUND BY LOOKING SOMEWHERE ELSE. Auditing the e2e walks for English
 * strings — thirteen of them locate the capture mouth by
 * `aria-label="Capture inspiration"`, a limit #317 wrote down — four
 * literals would not resolve against the catalogue. Three were fixture
 * markup. The fourth was not a test problem at all: the product itself had
 * seven labels written straight into the JSX, in English, that no catalogue
 * had ever seen.
 *
 * WHY THESE SEVEN AND NOT OTHERS. Every one of them is said by a label, a
 * tooltip or a screen reader, and by nothing else. `LoadingHome` is the
 * sharpest: its visible word has read `불러오는 중` since the face shipped,
 * three lines under an `aria-label="loading"` that never did. Same element,
 * same moment — the eye got Korean and the ear got English. A walk that
 * photographs the screen cannot see that, and none of the thirty walks in
 * `tools/e2e` ever did.
 *
 * So the ones that survived are exactly the ones nobody can see survive.
 * That is not a coincidence to note in passing; it is the reason this gate
 * reads source text rather than a rendered page.
 *
 * WHAT WENT ONTO THE CATALOGUE. The two step carets in the memory panel
 * (label and tooltip, so four attributes, `worldTheInspirationBefore` /
 * `worldTheInspirationAfter`); the group the dates sit in, whose own sibling
 * button has said `이 벽의 시간을 되감기` since the dial shipped
 * (`worldWindBackToADate`); the loading label, onto the `loading` key the
 * word beneath it already used; and the post-it preview, onto the
 * two-language copy `PublicProfile` keeps for itself — where `controls`, an
 * aria-label, already sat.
 *
 * THE ONE EXEMPTION IS THE PRODUCT'S OWN NAME. `aria-label="Waka"` on the
 * root is a proper noun. Translating it would be a bug, so it is named here
 * with its reason rather than quietly skipped — and case two holds that it
 * still matches something, because an exemption that has outlived the thing
 * it exempted is a hole with a comment over it. #317 shipped exactly that:
 * an `EXEMPT` entry for `jar-scrim`, a class that had not existed in the
 * source for weeks.
 *
 * WHAT THIS DOES NOT SAY. Nothing about whether the Korean is GOOD — no test
 * can hold that. `i18n.test.ts` holds that both catalogues carry the same
 * keys and no blank values; `copy.test.ts` holds that no key goes unread.
 * Between them the chain is closed at both ends: a key with no words, words
 * with no key, and now a label that never asked for a key at all.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). Nothing. It reads the source off disk
 * as text, the way `no-picture-reaches-the-field.test.ts` does.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");

/**
 * Attributes whose value a person is given as words — read aloud by a screen
 * reader, shown on hover, or standing in an empty field. `alt` and the three
 * `aria-*` spellings have no instance in the source today and are named
 * anyway: the cost is nothing and the first one written will be written in
 * whatever language its author happened to be thinking in.
 */
const SPOKEN = ["aria-label", "aria-description", "aria-roledescription", "aria-placeholder", "title", "placeholder", "alt"];

/** A bare literal: `aria-label="some words"`, not `aria-label={say(...)}`. */
const literalAttr = (attr: string): RegExp => new RegExp(`\\b${attr}="([^"]*)"`, "g");

interface Exemption {
  /** the literal, exactly as the source spells it */
  readonly value: string;
  /** why translating it would be the bug */
  readonly because: string;
}

const EXEMPT: readonly Exemption[] = [
  {
    value: "Waka",
    because: "the product's own name — a proper noun reads the same in every language",
  },
];

function everyFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) everyFile(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/** comments blanked: this file's own prose quotes the labels it removed */
const code = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

interface Found {
  readonly where: string;
  readonly attr: string;
  readonly value: string;
}

/** Every bare-literal spoken attribute in the source, with where it is. */
function sweep(): { found: Found[]; filesRead: number; sawHome: boolean } {
  const files = everyFile(SRC);
  let sawHome = false;
  const found: Found[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    if (file.endsWith("pages/Home.tsx") && text.includes("jar-dial-list")) sawHome = true;
    const body = code(text);
    const where = file.slice(SRC.length + 1);
    for (const attr of SPOKEN) {
      for (const m of body.matchAll(literalAttr(attr))) {
        found.push({ where, attr, value: m[1] });
      }
    }
  }
  return { found, filesRead: files.length, sawHome };
}

describe("every label a person is given says itself in both languages", () => {
  it("writes no spoken label straight into the JSX", () => {
    const { found } = sweep();
    const exemptValues = new Set(EXEMPT.map((e) => e.value));
    const offenders = found.filter((f) => !exemptValues.has(f.value));
    expect(
      offenders.map((f) => `${f.where}  ${f.attr}="${f.value}"`),
      "a label written in the JSX is a label one language will never hear — " +
        "give it a catalogue key and say it through `say()`, or exempt it here with its reason",
    ).toEqual([]);
  });

  it("keeps no exemption that has outlived the thing it exempted", () => {
    const { found } = sweep();
    // asked PER EXEMPTION, not "did any exemption match" — the weaker
    // question is the one #317's round-two review caught being asked, and it
    // passes forever once a single exemption is real.
    const stale = EXEMPT.filter((e) => !found.some((f) => f.value === e.value));
    expect(
      stale.map((e) => `${e.value} — exempted because ${e.because}, and matches nothing`),
      "an exemption for a label that is gone is a hole with a comment over it",
    ).toEqual([]);
  });

  it("really read the source, so a blind sweep cannot agree with everything", () => {
    const { found, filesRead, sawHome } = sweep();
    expect(sawHome, "did not read pages/Home.tsx — the sweep is looking at the wrong tree").toBe(true);
    expect(filesRead).toBeGreaterThan(50);
    // the exempted name is the one bare literal that should still be there;
    // finding it proves the regex matches what it claims to match
    expect(found.map((f) => f.value)).toContain("Waka");
  });
});
