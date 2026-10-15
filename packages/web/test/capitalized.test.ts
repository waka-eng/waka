/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads one JSON catalogue
 * off disk and asserts a property of its values. No component mounts, no
 * module is imported for its behaviour, and no server, DOM, clock or account
 * data is involved — there is nothing here a mock could stand in for, which
 * is the point: a ruling about every string in the product must not depend on
 * anyone remembering to render the screen that happens to carry it. */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * ═══ EVERY STRING A PERSON READS BEGINS WITH A CAPITAL LETTER ═══
 *
 * The founder, pointing at one dropdown:
 *
 *   "all of it should say 'You're' in front. Make sure that like everything
 *    has the first character of the word capitalized. That goes for your
 *    agent stuff as well."
 *
 * Read the second sentence again. It does not say "these rows". It says
 * EVERYTHING, and then — in case anyone was planning to scope it to the
 * screen being pointed at — it names a different surface and says that too.
 *
 * WHAT HAPPENED INSTEAD. The ruling was applied to the eight switcher and
 * corner rows the finger was on, and nowhere else. One hundred and forty-one
 * lowercase-initial strings carried on rendering, several of them on the very
 * screen that was being looked at: the claim answers said "yes" / "partly" /
 * "not true", the speech bubble offered "talk about this", the form switch
 * read "me" / "my agent", the account card said "all settings" and
 * "sign out", and the card foot was a row of "edit", "save", "close",
 * "delete". The transcript audit (`docs/audits/every-ask-2026-10-10.md`,
 * item #163) ranked this the most likely NEXT complaint, which is the
 * strongest thing that can be said about a design decay: not that it is
 * untidy, but that it is a complaint already loaded and pointed at us.
 *
 * ── WHY A GATE, AND WHY THIS SHAPE OF GATE ────────────────────────────────
 *
 * `docs/six-laws.md` Law 3 — a change to the system lands on every surface,
 * not the one being looked at — has one known mechanism: a gate. The type
 * scale forked into two parallel design systems precisely because two
 * stylesheets were missing from a `GOVERNED` list, so every ruling about them
 * was unaudited BY CONSTRUCTION. And Law 7, added by that same audit, is this
 * failure in its general form: a RULE applied to the instance it was pointed
 * at rather than to the class its own words cover.
 *
 * A rule with no gate is a rule that holds until the next string is written.
 * This one was stated once, applied eight times, and decayed inside the same
 * session. So the ruling is now mechanical: **every `en-US` value begins with
 * a capital letter**, and the next person to add a lowercase one finds out
 * from the suite rather than from the founder.
 *
 * ── WHAT THE RULE IS NOT ──────────────────────────────────────────────────
 *
 * SENTENCE CASE, NOT TITLE CASE. The founder said the FIRST character. "Save
 * inspiration", never "Save Inspiration". That half is deliberately not
 * gated: a mid-string capital is right in `WAKA`, `MCP`, `Google`,
 * `waka-mcp`, every person's name and every room's name, so a mechanical
 * check there would spend its life being argued with and then exempted into
 * uselessness. The first character is the half that is unambiguous, and an
 * unambiguous half enforced beats a whole one nobody can keep green.
 *
 * KOREAN IS NOT GOVERNED, BECAUSE IT CANNOT BE. Hangul has no letter case, so
 * "모든 대화" neither passes nor fails a capitalisation rule — there is no
 * such property to have. `/^[a-z]/` is false for every Hangul syllable, so
 * the predicate is already silent there; the case below pins that silence so
 * that a future "stricter" rewrite of this gate cannot start demanding a
 * capital of a script that has none, and mangling the catalogue to get one.
 *
 * A VALUE THAT STARTS WITH SOMETHING OTHER THAN A LETTER IS FINE. `{count}
 * saved`, a digit, a `·`, an emoji: the rule is about the first LETTER being
 * the writer's choice, and a placeholder's first letter is not the writer's
 * to choose.
 */
const CATALOGUE = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/i18n/messages/en-US.json");
const KOREAN = resolve(dirname(fileURLToPath(import.meta.url)), "../src/lib/i18n/messages/ko-KR.json");

/**
 * AND THE STYLESHEETS, BECAUSE THE CATALOGUE IS NOT THE LAST WORD ON A STRING.
 *
 * This gate read 805 values, asserted every one of them began with a capital,
 * and passed — while `/login` rendered "sign in", `/profile` rendered "sign
 * out" and "save profile". Two rules in `chrome.css` said
 * `text-transform: lowercase`, and a transform applies AFTER the value the
 * gate inspected. The catalogue said "Sign in". The screen said "sign in".
 * Both were true, and only one of them was being read.
 *
 * That is this document's own Law 3 failure wearing a new coat: the ruling
 * was mechanised over the layer the finger happened to be pointing at. A
 * string's casing is decided by the catalogue AND by the cascade, so the gate
 * has to hold both ends or it holds neither.
 *
 * `uppercase` is NOT forbidden here, and the distinction matters: this
 * product has a deliberate uppercase register — the eyebrow — declared in
 * `system.css` and worn by labels that are not things you press. The ruling
 * the founder gave was about the FIRST character being a capital, and
 * `uppercase` satisfies it. `lowercase` is the only transform that can take a
 * capitalised value and uncapitalise it, so it is the only one gated.
 */
const STYLESHEETS = ["global.css", "system.css", "chrome.css", "home.css", "claims.css", "chat.css", "layers.css"];
const STYLE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../src/styles");

function catalogue(path: string): Record<string, string> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, string>;
}

/** The one property, in one place, so the ratchet case below asks exactly
    the question the rule case asks. */
function startsLower(value: string): boolean {
  return /^[a-z]/.test(value);
}

/**
 * THE FRAGMENTS, AND WHY EACH ONE STAYS LOWER CASE.
 *
 * Every entry here is a string that is NOT a label, a row or a sentence of
 * its own: a call site composes it into the middle of a longer sentence, and
 * capitalising it would print a capital inside that sentence. Each one was
 * found by opening its call site, which is the only way this question can be
 * answered — the catalogue cannot tell you where its words land.
 *
 * WHAT IS NOT A REASON TO BE HERE. "It is short." "It is a verb." "It sits
 * after a dash." A clause after an em dash IS capitalised in this product
 * already, everywhere, because `whyFailed` appends the API's own sentences
 * that way ("That was not saved — That room could not be made."), so the
 * reason-clause strings were capitalised rather than exempted. A segment
 * after a `·` is the start of its own segment and was capitalised too. Only a
 * fragment with no boundary in front of it — a verb between two names, an
 * object after one — belongs on this list.
 */
const EXEMPT: Record<string, string> = {
  /* THREE EXEMPTIONS WENT WITH `Profile.tsx` (2026-10-11), and the gate
     found them the same run — which is what the companion case below it
     exists for. They excused the mid-sentence verbs on the grants row and
     the read record (`{agent} reads {memory}`, `{reader} read {owner}'s
     {surface}`) and the object of the second. Founder: "I want all
     setting-related stuff to be only accessible through the drop down and
     not be its own thing"; the five sections those lines belonged to did
     not survive the prune. An exemption that excuses nothing is worse than
     none, because the next reader trusts it. */
  /* `worldPrinciplesRoomProgress` LEFT THIS LIST with the string it excused
     (2026-10-12, founder: "방 없애" — remove rooms). It rendered as `{n}/3
     shared patterns ready` under a room's progress bar, so the count was the
     head of the line and the words after it were mid-sentence — and the
     aria-label on the same bar read the identical string, so no casing
     served both halves. The staged room empty-state is gone and so is the
     key; the exemption went in the same change, which is the half of this
     ratchet the case below enforces. */
};

describe("every string a person reads begins with a capital", () => {
  it("reads a catalogue at all", () => {
    /* THE TRIPWIRE, BECAUSE A GATE THAT READS NOTHING PASSES. Rename the
       catalogue, move the messages under a nested object, change the shape of
       a value, and every assertion below goes vacuously green while the rule
       stops being enforced — silently, which is the exact failure this file
       exists to end one level up. Same argument as `way-out.test.ts`'s
       surface-count case. */
    const messages = catalogue(CATALOGUE);
    const values = Object.values(messages);
    /* A FLOOR AGAINST THE CATALOGUE VANISHING, NOT A HEADCOUNT.
       This was 700, calibrated the day it was written against ~805 keys, and
       it went red the moment a legitimate deletion landed — the review fold
       removed about a hundred strings exactly as its design doc asked. A
       tripwire that fails on honest subtraction teaches people to edit the
       tripwire, which is how a gate stops meaning anything. 400 is far below
       any plausible catalogue and far above the zero this exists to catch. */
    expect(values.length, "the en-US catalogue came back empty — has it moved?").toBeGreaterThanOrEqual(400);
    expect(
      values.every((value) => typeof value === "string"),
      "a catalogue value is not a string, so this gate is reading the wrong shape",
    ).toBe(true);
    /* And it has to be reading real copy, not a file of placeholders: the
       product's strings overwhelmingly start with a letter, so a run where
       almost nothing does means the parse, not the catalogue, is wrong. */
    /* 600 -> 540 on 2026-10-11, 540 -> 440 on 2026-10-12. The first move was
       the settings page — founder: "I want all setting-related stuff to be
       only accessible through the drop down and not be its own thing" — and
       121 strings went with the five sections that did not survive. The
       second was rooms — founder: "방 없애" — and 114 strings went with them,
       measured: 648 keys before, 534 after, both catalogues at exact parity.
       This is a TRIPWIRE for a broken parse, not a ratchet on the
       catalogue's size, so it is set well below the real figure rather than
       at it; what it is watching for is a run that suddenly reads almost
       nothing. Lowering it on an honest deletion is the correct move and the
       note above says why: a tripwire that fails on honest subtraction
       teaches people to edit the tripwire. */
    expect(values.filter((value) => /^[A-Za-z]/.test(value)).length).toBeGreaterThanOrEqual(440);
  });

  it("starts no en-US value with a lowercase letter", () => {
    const messages = catalogue(CATALOGUE);
    const offenders = Object.entries(messages)
      .filter(([key, value]) => startsLower(value) && !(key in EXEMPT))
      .map(([key, value]) => `${key}: ${JSON.stringify(value.slice(0, 60))}`);
    expect(
      offenders,
      `\n${offenders.join("\n")}\n\n` +
        "The founder's words were \"everything has the first character of the " +
        "word capitalized\", and \"everything\" is the part that was missed " +
        "the first time — the ruling landed on eight rows and 141 strings kept " +
        "rendering lower case. Capitalise the first character (sentence case, " +
        "not Title Case), or — if a call site genuinely composes this into the " +
        "middle of a longer sentence — add it to EXEMPT with the call site and " +
        "the reason.\n",
    ).toEqual([]);
  });

  it("keeps no exemption for a string that no longer needs one", () => {
    /* THE OTHER HALF OF THE RATCHET, same as `verb-pairs.test.ts`'s dead-entry
       case and `way-out.test.ts`'s stale-excuse case. An exemption outliving
       its reason is how a completeness check quietly stops being one: it reads
       as a decision somebody made, and excuses something nobody decided. Two
       ways it goes stale — the key is deleted, or the value was capitalised
       anyway and the entry is now arguing with the catalogue. */
    const messages = catalogue(CATALOGUE);
    const stale = Object.keys(EXEMPT).filter((key) => !(key in messages) || !startsLower(messages[key]!));
    expect(
      stale,
      "these are exempt from a rule they no longer break — either the key is " +
        "gone or its value already begins with a capital. An exemption that " +
        "excuses nothing while reading as if it does is worse than no " +
        "exemption, because the next reader trusts it.",
    ).toEqual([]);
  });

  it("lets no stylesheet uncapitalise what the catalogue capitalised", () => {
    const offenders: string[] = [];
    for (const file of STYLESHEETS) {
      const css = readFileSync(resolve(STYLE_DIR, file), "utf8");
      /* Line by line, so the failure can name WHERE — a file name alone sends
         the next person grepping a five-thousand-line stylesheet for a rule
         this gate already found. Declarations only: the word appears in prose
         in the comment above, and a comment is where the reasoning lives. */
      css.split("\n").forEach((line, at) => {
        const code = line.split("/*")[0]!;
        if (/text-transform\s*:\s*lowercase/.test(code)) offenders.push(`${file}:${at + 1} ${line.trim()}`);
      });
    }
    expect(
      offenders,
      "a stylesheet is lowercasing text the catalogue capitalised, which is " +
        "the founder's ruling undone after the gate above has read the " +
        "string. Delete the declaration — the catalogue already holds the " +
        "casing. If a surface needs a quieter register than sentence case, " +
        "that is a weight and a colour, not a transform.\n",
    ).toEqual([]);
  });

  it("capitalises the server's clauses wherever one is spoken alone", () => {
    /**
     * ═══ THE CATALOGUE IS NOT THE ONLY PLACE A SENTENCE COMES FROM ══════
     *
     * This gate reads `en-US.json` and has caught real decay doing it. It
     * has also been blind twice in one day, both times to a sentence the
     * catalogue never held:
     *
     *   a stylesheet lowercased three button labels AFTER this gate had
     *   read them — fixed, and gated above;
     *
     *   and the weather's clauses, which are assembled on the SERVER out
     *   of row counts. "you kept a memory", "your memory was consulted 170
     *   times" — written lower case on purpose, because the full record
     *   joins them into one line, and spoken ALONE by the creature, where a
     *   clause becomes a sentence and the ruling applies.
     *
     * THE API IS NOT ASKED TO CAPITALISE, and that is the design rather
     * than a dodge: a clause that is going to be joined must stay lower
     * case or the joined line grows capitals in its middle. What the rule
     * actually requires is that the WEB capitalise at the point a clause
     * stops being one, which is `asSentence` in `lib/words`.
     *
     * So this checks the two places that speak a clause on its own, by
     * name. A third render site that forgets is the failure mode, and the
     * only honest defence is that the list is short and stated here.
     */
    /* COUNTED, NOT JUST PRESENT. The first version of this asked whether
       each file mentioned `asSentence` at all, and `Home.tsx` passed with
       one of its TWO sites wired — the away-window sentence went on saying
       "you kept a memory." in the bubble, and was caught by a probe
       printing what the creature actually said rather than by this. A file
       that speaks two clauses needs two calls. */
    /* `ReadingPanel.tsx` LEFT THIS LIST WITH THE SURFACE (2026-10-11). It
       printed the loop's rules one clause per line and was one of three
       machinery doors on the settings page; founder: "I want all
       setting-related stuff to be only accessible through the drop down."
       See `SettingsPanel`'s header, which argues that those three are the
       removal most worth disagreeing with. If they come back, the entry
       comes back with them — a surface that speaks a server clause alone
       and does not pass it through `asSentence` prints a sentence starting
       in lower case. */
    const SPEAKS_A_CLAUSE_ALONE = [
      ["pages/Home.tsx", 2, "the creature asked what has been happening, and the away-window sentence"],
    ] as const;
    const bare: string[] = [];
    for (const [file, wanted, why] of SPEAKS_A_CLAUSE_ALONE) {
      const text = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src", file), "utf8");
      const calls = text.match(/\basSentence\s*\(/g)?.length ?? 0;
      if (calls < wanted) bare.push(`${file} — ${calls} of ${wanted} wired — ${why}`);
    }
    expect(
      bare,
      "this surface speaks one of the weather's clauses on its own and does " +
        "not pass it through `asSentence`, so it prints a sentence starting " +
        "in lower case. The API writes clauses deliberately — they are joined " +
        "elsewhere — and capitalising belongs at the point one stops being a " +
        "clause.\n",
    ).toEqual([]);
  });

  it("asks nothing of Korean, which has no letter case", () => {
    /* NOT A FORMALITY. The first instinct on reading this gate is to run it
       over both catalogues "for symmetry", and the second is to make the
       predicate stricter — "must start with an uppercase letter" instead of
       "must not start with a lowercase one". Either move turns 805 Hangul
       values into 805 failures, and the cheapest way to make them green is to
       mangle the Korean. So both halves are pinned: the predicate is silent on
       Hangul, and the Korean catalogue passes it as it stands. */
    const korean = catalogue(KOREAN);
    expect(Object.keys(korean).length).toBeGreaterThanOrEqual(400);
    expect(startsLower("모든 대화"), "the predicate must not read Hangul as lower case").toBe(false);
    const flagged = Object.entries(korean)
      .filter(([, value]) => startsLower(value))
      .map(([key, value]) => `${key}: ${JSON.stringify(value)}`);
    /* THE ONE LATIN-INITIAL KOREAN VALUE WAS A COMMAND'S NAME — `waka-mcp
       열기` — spelled the way it is typed, lower case on purpose, and not
       evidence of the decay this file guards. It went with the settings
       page's key panel on 2026-10-11, so the Korean catalogue now has no
       such value at all. Asserted as empty rather than deleted: a list
       pinned to exactly what is there is what makes the NEXT lower-case
       Korean string arrive as a failure to think about. */
    expect(flagged).toEqual([]);
  });
});
