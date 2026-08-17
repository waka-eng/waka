#!/usr/bin/env node
/**
 * THE VOCABULARY GATE, API SIDE.
 *
 * `packages/web` has had a vocabulary gate for a while: it fails if a frontend
 * identifier uses a word the canon retired. The API had nothing, which is
 * backwards, because the API is the side that DEFINES the canon.
 * `docs/data-model.md` opens by saying it is "the vocabulary of record" and
 * that when code and it disagree, the code is wrong. Until now that sentence
 * was enforced on the package that merely consumes the vocabulary and not on
 * the one that owns it, so "the two sides cannot drift apart again" was only
 * ever half true.
 *
 * WHY THIS IS A SECOND SCRIPT AND NOT A SHARED ONE.
 *
 * The obvious move is to lift `packages/web/scripts/check-vocabulary.mjs` into
 * something both packages import. It was tried and measured, and it is wrong,
 * for a reason that is worth more than the duplication it costs.
 *
 * The web scanner ends with a pass that blanks JSX text — the words between a
 * `>` and the next `<` — because that text is the third vocabulary, the words a
 * person reads, where the old word is REQUIRED rather than forbidden. In a file
 * with no JSX that pass does not sit idle. TypeScript's generics are also
 * angle brackets, so it blanks whatever sits between the close of one type
 * argument and the open of the next:
 *
 *     export async function listRooms(): Promise<string>
 *     const roomIndex = new Map<string, number>();
 *
 * becomes
 *
 *     export async function listRooms(): Promise<string>
 *                              <string, number>
 *
 * and `roomIndex` — an actual violation — is gone. Measured against this
 * package on the day the gate was written: the JSX pass blanks 10,172
 * characters of real code across 369 lines in 47 of the API's files. Sharing
 * the scanner would have shipped an API gate that was blind over a twentieth of
 * the package on its first green run. That is precisely the failure the web
 * gate already had once, with an apostrophe instead of a generic, and importing
 * it deliberately would be hard to defend.
 *
 * The detail that makes this easy to get wrong, learned by getting it wrong:
 * the gap has to be free of braces, because the pattern stops at `{` or `}`.
 * Code inside a function body is therefore safe and code between two top-level
 * declarations is not — which is the opposite of where anyone would look first,
 * and is why the self-test case for it uses two `type X = Y<Z>;` lines.
 *
 * The lists differ too, and not cosmetically. The web gate's allowlist is DOM
 * methods (`setPointerCapture`, `CanvasPattern`); this one's is database
 * reality. The web gate has no reason to know that `spark` and `lens` are
 * concepts `docs/data-model.md` deleted. Two short lists, each legible on its
 * own, beat one list with a column saying which package each row is for.
 *
 * What the duplication genuinely costs: a fix to one scanner does not reach the
 * other. That cost is paid down the only way it can be — the self-test at the
 * bottom of this file carries every blindness the web gate has suffered,
 * translated into this language, so a lesson learned there cannot be un-learned
 * here without a red run.
 *
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * IDENTIFIERS ONLY. Prose in a comment may name the old word, and usually must,
 * to explain why something changed. `docs/data-model.md` itself is full of the
 * word "capture" as a verb. A gate that fired on comments would teach people to
 * write fewer comments, which is a worse codebase than one with a stale name in
 * it.
 *
 * STRINGS ARE NOT IDENTIFIERS, and on this side of the house that is a load-
 * bearing distinction rather than a convenience:
 *
 *   - `drizzle/migrations/0000_three_layers.sql` ships an enum whose value is
 *     the literal text `'pattern'`. That value is in every deployed database.
 *     A linter cannot rename it; only a migration can, and this branch is not
 *     allowed to add one.
 *   - A Drizzle column is a string name and a TypeScript property: the string
 *     `"room_id"` is the shipped database's, the property `roomId` is ours.
 *     Blanking the string and reading the property draws the line in exactly
 *     the right place — the half we can fix is checked, the half we cannot is
 *     left alone.
 *   - Raw SQL in a `sql` tagged template is the database's language, not ours.
 *
 * The one place this scanner is STRICTER than the web one is the inside of a
 * template literal. The web scanner blanks a template's whole body; this one
 * blanks the literal text but scans `${...}` interpolations as the code they
 * are, because in this package that is where column references live —
 * `sql`${table.profileId} IS NOT NULL`` — and a bad name there would otherwise
 * be invisible in the 54 places the API builds SQL that way.
 *
 * Run: node scripts/check-vocabulary.mjs        (also runs in `pnpm test`)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/*
 * Both of the package's own source roots, not just `src`.
 *
 * `test/helpers` builds request payloads and fixtures, which is exactly the
 * kind of code that quietly reintroduces a retired word — a helper called
 * `makeRoom` is how the next feature learns to say "room". The same argument
 * `vitest.unit.config.ts` makes for globbing instead of listing test files
 * applies here: an unscanned directory is indistinguishable from a clean one.
 */
const ROOTS = [join(PKG, "src"), join(PKG, "test")];

/**
 * The words that may not appear in an identifier, and what to use instead.
 *
 * Every entry traces to a specific ruling in `docs/data-model.md` or to the
 * canon/world split in `docs/map.md`. That provenance is the whole discipline
 * here: a forbidden list assembled from taste is an opinion someone will
 * reasonably argue with, and a gate people argue with gets switched off.
 */
const FORBIDDEN = [
  {
    word: "capture",
    use: "inspiration",
    why: "docs/map.md: `capture` is one of the world's words for layer 1; the canon's word is `inspiration`",
  },
  {
    word: "pattern",
    use: "signal",
    why: "docs/map.md: `pattern` is the world's word for layer 2. data-model.md defines a signal AS an evidence-backed pattern, so the word survives in prose and dies in identifiers",
  },
  {
    word: "room",
    use: "group",
    why: "docs/map.md: `room` is the human word, warmer than `group`, and belongs on screen. The stored entity is a group",
  },
  {
    word: "wow",
    use: "nothing — the canon deleted the concept",
    why: "data-model.md, WOW vocabulary row: `wow_kind`, `wow_score`, `/api/wow-moments` are Deleted",
  },
  {
    word: "spark",
    use: "nothing — the canon deleted the concept",
    why: "data-model.md, 2026-08-15: sparks removed from the model entirely; capture is text + attachments only",
  },
  {
    word: "lens",
    use: "nothing — the canon deleted the concept",
    why: "data-model.md, Lens boards row: Deleted, superseded structurally by agent profiles",
  },
  {
    word: "world",
    use: "nothing here — the world is how the web package draws things",
    why: "docs/map.md: the world is the frontend's rendering vocabulary. An API identifier named for it means the backend adopted the staging words of its own client",
  },
];

/*
 * WORDS CONSIDERED AND DELIBERATELY LEFT OUT, so the next person does not have
 * to re-derive the reasoning:
 *
 *   `field`, `wall`  — these read as world words, but `docs/data-model.md`
 *     uses both itself ("A room's *field* is exactly this...", and the Wall row
 *     says the concept is unchanged). A gate cannot forbid a word its own
 *     source of truth uses. `routes/groups-field.ts` and `groups-wall.ts` stay.
 *   `board`  — `scoring/board-selection.ts` and `docs/goals/board-selection.md`
 *     use it, and the canon offers no replacement noun. Forbidding a word with
 *     nothing to move to produces a violation nobody can honestly fix, which is
 *     how allowlists start growing.
 *   `note`, `moment`  — the canon deleted `top_of_mind_notes` and
 *     `wow_moments`, so the temptation is real, but both are ordinary English
 *     that appears in unrelated identifiers. The specific dead things are
 *     already caught: the tables are gone, and `wow` above catches the rest.
 *
 * The rule this list follows: forbid a word only where the canon both retires
 * it AND says what to say instead, or where it plainly belongs to another
 * package's vocabulary.
 */

/**
 * Names that contain a forbidden word and are, for now, allowed to stand.
 *
 * An allowlist is where a gate goes to die, so this one is built to resist
 * that in three ways:
 *
 * SCOPED TO FILES. An entry is `name` + the files it is allowed in, not a bare
 * name. Allowing the identifier `room` outright would let the next `const room`
 * anywhere in the package through, which is a far bigger hole than the one line
 * that needed it. The self-test proves the scoping bites: the same name passes
 * in its own file and fails in another.
 *
 * SPLIT BY DISPOSITION. `permanent` means the name is correct and always will
 * be, because something outside this repo owns the word. `rename` means the
 * name is genuinely wrong and is only here because this change could not safely
 * fix it — see the note below. A hole with no expiry date is a hole nobody ever
 * closes, so every entry has to declare which kind it is and, if it is a
 * rename, what it should become.
 *
 * SELF-EXPIRING. An entry that matches nothing is a failure, not a shrug. When
 * someone finally does one of these renames, the gate tells them to delete the
 * line rather than letting it sit here looking like a live exception forever.
 *
 * WHY SO MANY `rename` ENTRIES IN THE FIRST COMMIT. The gate was built while
 * three other agents had files in this package open, and a rename touches every
 * caller. Renaming `sourceForCapture` while someone else is editing the route
 * that calls it produces a conflict whose resolution is a guess. The honest
 * order is: land the gate, so nothing NEW arrives; then rename, one identifier
 * at a time, when the package is quiet. Both halves are visible here — nothing
 * was renamed and nothing was hidden.
 */
const ALLOWED = [
  {
    name: "HANDLE_PATTERN",
    files: ["src/lib/public-handles.ts"],
    disposition: "permanent",
    why:
      "a regular expression: `/^[A-Za-z0-9_-]{3,24}$/`. `pattern` here is the " +
      "English word for a regex and has no relation to the layer the canon " +
      "calls a signal. packages/web allows its mirror `PUBLIC_HANDLE_PATTERN` " +
      "for the same reason, which is a good sign the reasoning is not special " +
      "pleading",
  },
  {
    name: "buildLikePattern",
    files: ["src/routes/inspirations-recall.ts"],
    disposition: "permanent",
    why:
      "builds the second operand of a SQL `ILIKE`, which SQL itself calls a " +
      "pattern. Renaming it would make the function lie about what the " +
      "language it is speaking calls the thing it returns",
  },
  {
    name: "samePattern",
    files: [
      "src/queue/gemini.ts",
      "src/queue/gemini-judge.test.ts",
      "src/lib/model-provider.ts",
      "src/lib/model-provider.test.ts",
      "src/lib/signal-derivation.ts",
    ],
    disposition: "rename",
    to: "sameSignal",
    why:
      "the judge that decides whether a new inspiration is evidence for an " +
      "existing signal. The layer it names IS the signal, so `pattern` is the " +
      "world's word in the one package that must not use it. Harder than the " +
      "others because the name is also the JSON key in the Gemini " +
      "responseSchema and in the prompt: the schema, the parser, the callers " +
      "and the fixtures have to move in one commit or the model's answer stops " +
      "parsing at runtime, where no test would see it",
  },
  {
    name: "capture",
    files: ["src/lib/inspiration-embeddings.test.ts"],
    disposition: "rename",
    to: "inspiration",
    why:
      "a local fixture object standing for one layer-1 row. Nothing external " +
      "owns this name; it is simply the world's word for the thing the canon " +
      "calls an inspiration, in a file whose subject is inspiration embeddings",
  },
  {
    name: "captured",
    files: ["src/routes/inspirations-capture.test.ts"],
    disposition: "rename",
    to: "writtenRows",
    why:
      "the array a fake database records its writes into — `captured` in the " +
      "test-spy sense, which is ordinary English and nothing to do with layer " +
      "1. It is still worth renaming, and arguably the most worth renaming of " +
      "any entry here, BECAUSE the two senses collide: this is the test for " +
      "`inspirations-capture.ts`, so `captured` means 'what the spy recorded' " +
      "on one line and 'the inspiration' three lines later. Found only because " +
      "this gate matches `-ed` forms; exact-word matching walked past all 14 " +
      "uses",
  },
  {
    name: "RAW_CAPTURE",
    files: ["src/routes/group-authorization.test.ts"],
    disposition: "rename",
    to: "RAW_INSPIRATION",
    why:
      "the test's canary string — if it reaches a group response, evidence " +
      "crossed an account boundary. The name is wrong, the test is right, and " +
      "another agent has this exact file open",
  },
  {
    name: "sourceForCapture",
    files: [
      "src/routes/inspirations-capture.ts",
      "src/routes/inspirations-capture.test.ts",
    ],
    disposition: "rename",
    to: "sourceForInspiration",
    why:
      "an exported function deciding whose initiative a layer-1 row is. " +
      "`capture` reads as the verb here, which is why it survived review, but " +
      "the argument it answers about is the inspiration",
  },
  {
    name: "visibilityForCapture",
    files: [
      "src/routes/inspirations-capture.ts",
      "src/routes/inspirations-capture.test.ts",
    ],
    disposition: "rename",
    to: "visibilityForInspiration",
    why: "same function pair, same reasoning, and it carries a security fix — a rename here wants its own commit and a careful diff",
  },
  {
    name: "registerCaptureRoutes",
    files: ["src/routes/inspirations-capture.ts", "src/routes/inspirations.ts"],
    disposition: "rename",
    to: "registerInspirationCaptureRoutes",
    why:
      "its three siblings are `registerRecallRoutes`, `registerEditingRoutes` " +
      "and `registerReflectionRoutes`, so the shape is fine and only the noun " +
      "is off. The verb sense of `capture` is canon — data-model.md's " +
      "permission matrix says 'read + capture only' — so the honest fix keeps " +
      "the verb and adds the noun it acts on",
  },
  {
    name: "sharedIntoARoomYouAreIn",
    files: ["src/routes/feedback.ts", "src/routes/feedback.test.ts"],
    disposition: "rename",
    to: "sharedIntoAGroupYouAreIn",
    why:
      "a field on the input to `mayAnswerSignal`, the extracted permission " +
      "rule docs/map.md holds up as an example of a rule a test can run. It " +
      "would be a shame for the example to be the thing carrying the old word",
  },
  {
    name: "rooms",
    files: ["src/routes/feedback.ts"],
    disposition: "rename",
    to: "groups",
    why:
      "a local holding the rows of a `signalShares` join — every one of them a " +
      "group. Only caught at all because this gate matches plurals; the " +
      "singular `room` on the next line was visible to a gate that did not",
  },
  {
    name: "room",
    files: ["src/routes/feedback.ts"],
    disposition: "rename",
    to: "group",
    why: "the loop variable over `rooms` above, same two lines, same fix",
  },
  {
    name: "ROOM_FIELD_LIMIT",
    files: ["src/routes/groups-field.ts"],
    disposition: "rename",
    to: "GROUP_FIELD_LIMIT",
    why:
      "the page ceiling on a group's field. `field` is deliberately NOT " +
      "forbidden — data-model.md uses it — so only the first word moves",
  },
  {
    name: "MAX_REFLECTIONS_PER_CAPTURE",
    files: ["src/routes/inspirations-validation.ts"],
    disposition: "rename",
    to: "MAX_REFLECTIONS_PER_INSPIRATION",
    why:
      "a validation bound. Reflections are layer-1 detail ON an inspiration, " +
      "so the canon's word is the right one and there is no external owner",
  },
];

/* Indexed by name for the scan, and by identity for the stale check below. */
const ALLOWED_BY_NAME = new Map(ALLOWED.map((e) => [e.name, e]));
const allowancesUsed = new Set();

/** Identifier-ish tokens: what a variable, property or type could be called. */
const TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Strip everything that is not code: comments and string literals.
 *
 * A hand-rolled scanner rather than a parser, because the alternative is adding
 * a TypeScript dependency to a check that has to stay cheap enough to run on
 * every commit. It is deliberately CONSERVATIVE — anything it cannot
 * confidently classify is treated as prose and skipped, so the gate under-
 * reports rather than crying wolf. A false accusation costs trust; a missed one
 * costs a follow-up commit.
 *
 * There is NO JSX-text pass here, and its absence is the point. See the header:
 * that pass cannot tell a closing type argument from a closing tag, and this
 * package is nothing but type arguments.
 */
function codeOnly(source) {
  const out = Array.from(source);
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== "\n") out[i] = " ";
    }
  };

  /*
   * A stack, because template literals nest through their interpolations:
   *
   *     sql`... ${cols.map((c) => `${c.name}`).join(",")} ...`
   *
   * Inside the outer template we are in prose; inside its `${...}` we are back
   * in code; inside the inner template we are in prose again. A single boolean
   * gets this wrong at the first nesting and then mis-classifies the rest of
   * the file, which is the exact shape of the bug that blinded the web gate.
   */
  const stack = [];
  const top = () => (stack.length ? stack[stack.length - 1] : null);

  let i = 0;
  while (i < source.length) {
    const state = top();

    /* Literal text of a template: prose until a backtick or a `${`. */
    if (state && state.kind === "template") {
      if (source[i] === "\\") {
        blank(i, i + 2);
        i += 2;
        continue;
      }
      if (source[i] === "`") {
        stack.pop();
        i += 1;
        continue;
      }
      if (source.slice(i, i + 2) === "${") {
        stack.push({ kind: "interpolation", depth: 0 });
        i += 2;
        continue;
      }
      if (out[i] !== "\n") out[i] = " ";
      i += 1;
      continue;
    }

    /* Everything below is code: the file's top level, or inside a `${...}`. */
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      blank(i, end === -1 ? source.length : end);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      blank(i, end === -1 ? source.length : end + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }

    const ch = source[i];

    if (ch === "`") {
      stack.push({ kind: "template" });
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      /*
       * AN APOSTROPHE THAT IS NOT A STRING once made the web gate lie over half
       * a file: it opened a string on the `'` in prose and blanked everything
       * up to the next apostrophe — thousands of lines — so the scan reported
       * clean over code it had never looked at.
       *
       * The fix, inherited here because it is the right one, is a bound rather
       * than a parser: a quoted string in this codebase closes on the line it
       * opened on. If the closing quote is not on this line, the quote was
       * punctuation, so it is skipped as an ordinary character and the damage
       * is one line instead of the rest of the file. Backticks do not need this
       * — they genuinely span lines, and an unterminated one is a syntax error
       * the compiler catches long before this runs.
       *
       * On this side the apostrophe usually arrives inside a comment, already
       * blanked above. It still reaches here from regex literals — `/it's/` —
       * which is why the rule stays.
       */
      const nl = source.indexOf("\n", i + 1);
      const lineEnd = nl === -1 ? source.length : nl;
      let j = i + 1;
      let closed = false;
      while (j < lineEnd) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) {
        /* punctuation, not a delimiter */
        i += 1;
        continue;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }

    if (state && state.kind === "interpolation") {
      if (ch === "{") {
        state.depth += 1;
        i += 1;
        continue;
      }
      if (ch === "}") {
        if (state.depth === 0) {
          stack.pop();
        } else {
          state.depth -= 1;
        }
        i += 1;
        continue;
      }
    }

    i += 1;
  }

  return out.join("");
}

/** Split an identifier into words: camelCase, PascalCase, snake_case, kebab. */
function words(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/**
 * INFLECTIONS COUNT. `listRooms` is `list` + `rooms`, and `rooms` is not
 * `room`.
 *
 * The plural half of this was found by the self-test on its first run, which is
 * the best argument for the self-test that this file contains: the case had
 * been written to prove the scanner could see past a generic, and it failed for
 * an entirely different reason nobody had thought about. `capturedRows` and
 * `capturingSession` were then found by asking what else the same mistake
 * covers.
 *
 * It matters more here than on the frontend because backend nouns are plural by
 * default — tables are `inspirations`, `signals`, `groups` — and because the
 * backend is where things get done TO a row: captured, capturing, shared.
 * Exact-word matching would have let the old vocabulary through in precisely
 * the identifiers most likely to carry it.
 *
 * Candidate forms rather than a stemming library: the word as written, and the
 * handful of endings English uses for the shapes an identifier actually takes.
 * Any match counts. Guessing WHICH rule applies to a given word is the part
 * that would need a dictionary; generating all of them and testing membership
 * against a seven-word list does not, and the only cost of an extra candidate
 * is a spurious match against one of those seven words, which was checked.
 *
 * NOTE FOR WHOEVER READS THIS NEXT: `packages/web/scripts/check-vocabulary.mjs`
 * still has this hole — its `FORBIDDEN` words are compared exactly, so `rooms`
 * and `captured` pass there today. It was left alone deliberately: closing it
 * there surfaces web violations that want renames, and a rename is already in
 * flight in `packages/web/src/space/`. It is worth a follow-up, not a drive-by
 * from a change about the API.
 */
function forms(word) {
  return [
    word,
    word.replace(/s$/, ""), // captures  → capture
    word.replace(/es$/, ""), // lenses    → lens
    word.replace(/d$/, ""), // captured  → capture
    word.replace(/ed$/, ""), // patterned → pattern
    word.replace(/ing$/, ""), // rooming   → room
    word.replace(/ing$/, "e"), // capturing → capture
  ];
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, found);
    } else if (/\.tsx$/.test(entry)) {
      /*
       * Refuse rather than guess. This scanner has no JSX-text pass, so on a
       * .tsx file it would read the words a person reads on screen as if they
       * were identifiers and accuse the one place the old word is required.
       * The API has no .tsx today; if one ever appears, whoever added it should
       * see this sentence rather than a pile of false alarms.
       */
      console.error(
        `\nvocabulary gate: ${relative(PKG, full)} is a .tsx file.\n` +
          `This scanner reads TypeScript without JSX — it cannot tell tag text\n` +
          `from code, and would accuse the words a person reads on screen.\n` +
          `Either keep JSX out of packages/api, or teach this scanner the JSX\n` +
          `masking pass that packages/web/scripts/check-vocabulary.mjs carries.\n`,
      );
      process.exit(1);
    } else if (/\.ts$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Every forbidden identifier in one source, with the line it sits on.
 *
 * `file` is the package-relative path, and it is a real argument rather than a
 * convenience for the error message: an allowance is granted to a name IN A
 * FILE, so the scan cannot decide anything without knowing where it is.
 */
function scanSource(source, file) {
  const found = [];
  codeOnly(source)
    .split("\n")
    .forEach((line, index) => {
      for (const match of line.matchAll(TOKEN)) {
        const name = match[0];
        const allowance = ALLOWED_BY_NAME.get(name);
        if (allowance && allowance.files.includes(file)) {
          allowancesUsed.add(name);
          continue;
        }
        const parts = new Set(words(name).flatMap(forms));
        for (const { word, use } of FORBIDDEN) {
          if (!parts.has(word)) continue;
          found.push({ line: index + 1, name, word, use });
          break;
        }
      }
    });
  return found;
}

/**
 * PROVE THE GATE CAN STILL SEE.
 *
 * The web gate reported `vocabulary: clean` over half of `Home.tsx` for a week.
 * It was not broken in a way anyone could notice — it was blind, and a blind
 * check reports exactly what a working one does. That is the whole argument for
 * this function, and `docs/goals/a-codebase-you-can-navigate.md` turned it into
 * gate G7: nothing green is blind, and every gate is proven to fail at more
 * than one point.
 *
 * THE CASES ARE PLACED AFTER THE CONSTRUCTS THAT BLIND SCANNERS — a generic, a
 * template literal, an interpolation, a regex holding an apostrophe, an
 * unterminated quote — because "does it flag a bad name on line 1" was never
 * the question. The question is whether it can still see line 400.
 *
 * TWO REFINEMENTS ON THE WEB GATE'S VERSION, both bought with its scar tissue:
 *
 * 1. Each case names the identifiers it expects. The web self-test's first
 *    version only asked "did anything get flagged", and passed against a
 *    deliberately re-broken scanner, because the breakage exposed the word
 *    `room` sitting in PROSE, which got flagged instead of the planted
 *    identifier. Right answer, wrong reason, green either way.
 *
 * 2. `expect` is the EXACT set, not a subset, and the masking cases carry a
 *    planted violation alongside the prose they are meant to ignore. A "must
 *    not flag" case that contains nothing else can pass because the scanner
 *    went blind over the whole snippet — the same wrong-reason green, one level
 *    up. Pairing them means blindness fails the positive half and over-eagerness
 *    fails the negative half, in one case.
 */
const SELFTEST = [
  {
    expect: ["roomPanel"],
    why: "a plain forbidden identifier",
    src: "const roomPanel = 1;",
  },
  {
    expect: ["PatternRow"],
    why: "forbidden in a type name",
    src: "interface PatternRow { id: string }",
  },
  {
    expect: ["captureCount"],
    why: "forbidden as a property",
    src: "const a = { captureCount: 1 };",
  },
  {
    expect: ["RoomRow", "CaptureRow", "patternIndex"],
    why:
      "BETWEEN TWO GENERICS — what sharing the web scanner would have cost. " +
      "Its JSX-text pass blanks everything from the `>` of one type argument " +
      "to the `<` of the next, so `CaptureRow` and `patternIndex` both sit " +
      "inside a gap it would erase, and only `RoomRow` (before the first `>`) " +
      "would survive. The shape is `type X = ReturnType<typeof y>;` twice over, " +
      "which is a line this package already has in several files. " +
      "AN EARLIER VERSION OF THIS CASE PUT THE NAMES INSIDE A FUNCTION BODY " +
      "AND PROVED NOTHING: the `{` stops that regex dead, so the case passed " +
      "with the JSX pass bolted back on. It was caught by re-breaking the gate " +
      "on purpose, which is the only reason this comment can be trusted",
    src: [
      "export type RoomRow = Record<string, string>;",
      "export type CaptureRow = Array<number>;",
      "const patternIndex = new Map<string, number>();",
    ].join("\n"),
  },
  {
    expect: ["capturesById", "lenses"],
    why: "PLURALS, which exact-word matching let through until this file's own self-test caught it. `lenses` also proves the -es form, which stripping a single `s` does not reach",
    src: "const capturesById = new Map(); const lenses = [];",
  },
  {
    expect: ["capturePanel"],
    why: "after a multi-line template literal",
    src: ["const t = `line one", "line two`;", "const capturePanel = 2;"].join(
      "\n",
    ),
  },
  {
    expect: ["roomId"],
    why: "INSIDE a Drizzle sql`` interpolation — the web scanner blanks a template's whole body, which would hide every column reference in the 54 places this package builds SQL",
    src: "const q = sql`${table.roomId} IS NOT NULL`;",
  },
  {
    expect: ["patternId"],
    why: "after a NESTED template interpolation, where a one-boolean state machine loses track and mis-reads the rest of the file",
    src: [
      "const q = sql`${parts.map((c) => `${c.col}`).join(\",\")}`;",
      "const patternId = 1;",
    ].join("\n"),
  },
  {
    expect: ["roomList"],
    why: "after a regex holding an apostrophe — an unterminated quote that must be read as punctuation",
    src: ["const re = /it's/;", "const roomList = [];"].join("\n"),
  },
  {
    expect: ["sparkOffset"],
    why: "a concept the canon deleted, after a comment that mentions it",
    src: [
      "/* sparks used to live here; the canon removed them on 2026-08-15 */",
      "let sparkOffset = 0;",
    ].join("\n"),
  },
  {
    expect: ["roomRow"],
    why: "PAIRED: the old word in a comment stays legal, and the scanner is still awake on the next line. Without the planted name this case would pass on a scanner that had gone blind",
    src: [
      "/* this used to be called a room's field, and the rename is why */",
      "let roomRow = 1;",
    ].join("\n"),
  },
  {
    expect: ["roomLabel"],
    why: "PAIRED: a shipped enum VALUE is a string a migration owns and no linter can rename; the identifier next to it is ours",
    src: [
      'const entryTypes = ["pattern", "tension"] as const;',
      "const roomLabel = entryTypes[0];",
    ].join("\n"),
  },
  {
    expect: ["roomId"],
    why: "PAIRED: a Drizzle column NAME is the shipped database's and stays; the property beside it is ours and does not",
    src: 'export const t = pgTable("groups", { roomId: uuid("room_id") });',
  },
  {
    expect: ["patternCount"],
    why: "PAIRED: raw SQL text inside sql`` is the database's language, not ours",
    src: [
      "const q = sql`select count(*) from top_of_mind_entries where type = 'pattern'`;",
      "const patternCount = 0;",
    ].join("\n"),
  },
  {
    expect: [],
    why: "the old word in a comment, alone — must stay legal",
    src: "/* the room's field, and why a capture is not a pattern */",
  },
  {
    expect: [],
    why: "the old word in a string, alone — strings are not identifiers",
    src: 'const s = "Leave this room?";',
  },
  {
    expect: [],
    file: "src/lib/public-handles.ts",
    why: "an allowed name, in the file it is allowed in",
    src: "const HANDLE_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;",
  },
  {
    expect: ["HANDLE_PATTERN"],
    file: "src/routes/somewhere-else.ts",
    why: "THE SAME allowed name, in a file it was not granted to. This pair is the whole argument for scoping the allowlist to files — without it, one exception becomes a package-wide hole",
    src: "const HANDLE_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;",
  },
];

function selftest() {
  const failures = [];
  for (const c of SELFTEST) {
    const got = [
      ...new Set(scanSource(c.src, c.file ?? "<self-test>").map((h) => h.name)),
    ].sort();
    const want = [...c.expect].sort();
    const same =
      got.length === want.length && got.every((n, k) => n === want[k]);
    if (!same) {
      failures.push(
        `  ${c.why}\n` +
          `      ${c.src.replace(/\n/g, "\n      ")}\n` +
          `      expected: ${want.length ? want.join(", ") : "(nothing)"}\n` +
          `      flagged:  ${got.length ? got.join(", ") : "(nothing)"}\n`,
      );
    }
  }
  if (failures.length > 0) {
    console.error(
      `\nvocabulary gate SELF-TEST FAILED — the gate cannot see what it claims to.\n` +
        `A clean report from a blind gate is worse than no gate.\n\n` +
        failures.join("\n"),
    );
    process.exit(1);
  }
  console.log(`vocabulary (api): self-test passed (${SELFTEST.length} cases)`);
}

selftest();

/*
 * The self-test deliberately exercises a real allowance, so it marks one used.
 * Clearing here means the staleness check below reports on the PACKAGE, which
 * is the only thing it is allowed to have an opinion about.
 */
allowancesUsed.clear();

const violations = [];

for (const root of ROOTS) {
  for (const file of walk(root)) {
    const rel = relative(PKG, file);
    for (const hit of scanSource(readFileSync(file, "utf8"), rel)) {
      violations.push({ ...hit, file: rel });
    }
  }
}

/*
 * AN ALLOWANCE THAT MATCHES NOTHING IS A FAILURE.
 *
 * Every entry above is a hole in the gate. A hole that stopped being needed —
 * because the rename happened, or the file moved, or the identifier was deleted
 * — still reads like a live exception to the next person, and still silently
 * covers anything that later takes the same name in that file. Failing on it
 * costs one deletion and keeps the list honest about its own size.
 */
const stale = ALLOWED.filter((e) => !allowancesUsed.has(e.name));
if (stale.length > 0) {
  console.error(
    `\nvocabulary (api): ${stale.length} allowance(s) in ALLOWED no longer match anything.\n` +
      `Each one is a hole in this gate that is no longer buying anything.\n` +
      `If the rename happened, delete the entry. If the file moved, fix its path.\n`,
  );
  for (const e of stale) {
    console.error(`  ${e.name}  (expected in ${e.files.join(", ")})`);
  }
  console.error("");
  process.exit(1);
}

if (violations.length === 0) {
  const renames = ALLOWED.filter((e) => e.disposition === "rename");
  console.log(
    `vocabulary (api): clean — every identifier speaks the canon, or is one of\n` +
      `  ${ALLOWED.length} recorded exceptions (${renames.length} awaiting a rename, ` +
      `${ALLOWED.length - renames.length} permanent).`,
  );
  process.exit(0);
}

/* Grouped by identifier, because forty uses of one bad name is one decision. */
const byName = new Map();
for (const v of violations) {
  const got = byName.get(v.name);
  if (got) got.count += 1;
  else byName.set(v.name, { ...v, count: 1 });
}

console.error(
  `\nvocabulary (api): ${byName.size} identifier(s) still speak the old words.\n` +
    `docs/data-model.md is the vocabulary of record — when it and the code\n` +
    `disagree, the code is wrong.\n`,
);
for (const v of [...byName.values()].sort((a, b) => b.count - a.count)) {
  console.error(
    `  ${v.name}  (${v.count}x, first at ${v.file}:${v.line})\n` +
      `      "${v.word}" is the old vocabulary — use ${v.use}\n`,
  );
}
console.error(
  "If one of these is genuinely correct — a name the database or an external\n" +
    "API owns — add it to ALLOWED in scripts/check-vocabulary.mjs with the\n" +
    "reason and whether the entry is permanent or waiting on a rename.\n",
);
process.exit(1);
