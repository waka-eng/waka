/**
 * THE THIRD VOCABULARY — the words a person actually reads.
 *
 * `scripts/check-vocabulary.mjs` guards identifiers and says, in as many
 * words, that it deliberately does not read copy: *"HUMAN WORDS — what a
 * person reads on screen. 'room' is warmer than 'group' and is a deliberate
 * product choice."* That is right, and it leaves one half of the boundary
 * unguarded. Canon may not be spoken to a person, and nothing checked it.
 *
 * Two things got in through that gap, both found by reading a surface closely
 * for an unrelated reason rather than by any gate:
 *
 *   A TAB READING `Make a group`, eight lines under a comment saying "MAKING
 *   OR JOINING A ROOM" and one step after a dialog offering "a room". Found
 *   while fixing an e2e walk that could not reach that form.
 *
 *   FIVE MORE `group`s in the room panel and the room's settings — "put
 *   something to this group", "close this group" — while every other surface
 *   in the product says room.
 *
 * AND THE COPY NOTHING RENDERS. On 2026-08-26, 274 of 387 message keys were
 * referenced nowhere: the search, sort, filter and scoring strings of the flat
 * screens deleted a week earlier. Seventy-one per cent of the product's
 * writing was for screens that no longer exist. The deletion swept routes and
 * stylesheets; it never swept the words, the same way it never swept the six
 * links pointing at those routes.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. Source and catalogue are read
 * as text.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");
const CATALOGUE = resolve(SRC, "lib/i18n/messages/en-US.json");

function everyFile(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) everyFile(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/**
 * Source, tests AND `tools/` as one string — a key named anywhere is in use.
 * `tools/` matters: the e2e walks assert on copy by key, and leaving them out
 * reported two live messages as dead on this gate's first run.
 */
function allSource(): string {
  /* COMMENTS ARE STRIPPED, and that is the point rather than a detail. Two
     keys survived the first sweep because a comment happened to name them —
     `signalHoldFaint` inside a journey's prose about what a typo would render
     as, and `attachImage` inside a doc-comment for a different function. A
     message kept alive by a sentence describing it is exactly as dead as a
     function kept alive by its own test, and `orphans.test.ts` already refuses
     that argument one level up. Refusing it here too costs two keys. */
  const strip = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  let blob = "";
  for (const file of everyFile(SRC)) blob += strip(readFileSync(file, "utf8"));
  for (const file of everyFile(HERE)) blob += strip(readFileSync(file, "utf8"));
  for (const file of everyFile(resolve(HERE, "../../../tools"))) {
    blob += strip(readFileSync(file, "utf8"));
  }
  return blob;
}

describe("the words a person reads", () => {
  it("has no message nothing renders", () => {
    const messages = JSON.parse(readFileSync(CATALOGUE, "utf8")) as Record<string, string>;
    const blob = allSource();
    /* A KEY IS IN USE IF ITS NAME APPEARS AS A LITERAL ANYWHERE. Two call
       sites look a key up by variable — the i18n wrapper itself, and the
       OAuth error mapping — and both build their keys from a table of string
       literals, so both are counted. If a third dynamic lookup is ever added
       from something that is NOT a literal table, this check will start
       reporting live copy as dead, and the fix is to name the keys in a table
       rather than to loosen this. */
    const unused = Object.keys(messages).filter(
      (key) => !new RegExp(`["'\`]${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'\`]`).test(blob),
    );
    expect(
      unused,
      "these messages are in the catalogue and nothing renders them. Copy for a " +
        "screen that no longer exists is worse than dead code: it is the only " +
        "kind of dead code a translator would be asked to translate.",
    ).toEqual([]);
  });

  it("never says a canon word to a person", () => {
    /* The pairs come from `check-vocabulary.mjs`'s own table, read the other
       way round: what an IDENTIFIER must say is exactly what COPY must not. */
    const CANON_IN_COPY = [{ canon: "group", human: "room" }];
    const offenders: string[] = [];
    for (const file of everyFile(SRC)) {
      if (!file.endsWith(".tsx")) continue;
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");
      /* JSX text nodes only: between a `>` and the next `<`, with no braces —
         a brace means an expression, and an expression is not copy. Generics
         are excluded by requiring a space or a letter, never a type comma. */
      for (const match of text.matchAll(/>([^<>{}]{3,})</g)) {
        const said = (match[1] as string).trim();
        /* PROSE ONLY. Between a `>` and the next `<` also sits the gap between
           two generics — `Map<string, number>` and `useState<Foo>(null)` — and
           the first version of this reported `([]);` as copy a person reads.
           The API's own vocabulary gate has a long comment about the same
           trap; this is that trap, met again in the other package. Copy is
           words and the punctuation of words: no braces, no semicolons, no
           parentheses, no equals. */
        if (!/^[A-Za-z][A-Za-z0-9 ,.'’·:&!?—–-]*$/.test(said)) continue;
        for (const { canon, human } of CANON_IN_COPY) {
          if (new RegExp(`(?<![\\w-])${canon}s?(?![\\w-])`, "i").test(said)) {
            offenders.push(`${file.slice(SRC.length + 1)}: "${said.slice(0, 60)}" — say ${human}`);
          }
        }
      }
    }
    const messages = JSON.parse(readFileSync(CATALOGUE, "utf8")) as Record<string, string>;
    for (const [key, value] of Object.entries(messages)) {
      for (const { canon, human } of CANON_IN_COPY) {
        if (new RegExp(`(?<![\\w-])${canon}s?(?![\\w-])`, "i").test(value)) {
          offenders.push(`${key}: "${value.slice(0, 60)}" — say ${human}`);
        }
      }
    }

    /* ── THE THIRD CHANNEL: A SENTENCE PASSED AS AN ARGUMENT ──────────────
       The two checks above read JSX text and the catalogue, and eight pieces
       of live copy walked between them. Two were sentences handed to a
       function — `failed("That group could not be made. Try another name.")`
       — which is neither a text node nor a message key. Six more were the
       `ApiError` messages in `lib/api/groups.ts`, and those reach a person by
       the least obvious road in the product: `whyFailed` composes
       `the server said no (500): ${err.message}` and puts it on screen, so
       every string thrown by the API client is copy. The failure-path walk
       printed one verbatim, which is how they were found at all.

       So: any string LITERAL that reads as a sentence — a capital, three or
       more words, no interpolation — is copy, wherever it sits. `.ts` as well
       as `.tsx`, because that is where six of the eight were.

       Deliberately not the whole file's strings: a class name, an event name
       and a selector are not sentences, and requiring a leading capital plus
       two spaces excludes them without needing a list of exceptions to
       maintain. */
    for (const file of everyFile(SRC)) {
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/\/\/[^\n]*/g, " ");
      for (const match of text.matchAll(/(['"])([A-Z][A-Za-z0-9 ,.'’·:&!?—–-]{10,}?)\1/g)) {
        const said = match[2] as string;
        if (said.split(" ").length < 3) continue;
        for (const { canon, human } of CANON_IN_COPY) {
          if (new RegExp(`(?<![\\w-])${canon}s?(?![\\w-])`, "i").test(said)) {
            offenders.push(`${file.slice(SRC.length + 1)}: "${said.slice(0, 60)}" — say ${human}`);
          }
        }
      }
    }
    expect(
      offenders,
      "canon reached a person. `check-vocabulary.mjs` guards the other half of " +
        "this boundary and says why: 'room' is warmer than 'group' and is a " +
        "deliberate product choice. Identifiers say group; screens say room.",
    ).toEqual([]);
  });
});
