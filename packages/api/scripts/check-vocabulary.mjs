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
 * All of the package's source roots, not just `src`.
 *
 * `test/helpers` builds request payloads and fixtures, which is exactly the
 * kind of code that quietly reintroduces a retired word — a helper called
 * `makeRoom` is how the next feature learns to say "room". The same argument
 * `vitest.unit.config.ts` makes for globbing instead of listing test files
 * applies here: an unscanned directory is indistinguishable from a clean one.
 *
 * `scripts` was missing from the first version of this list and the omission
 * proves the point better than the paragraph above does: this file lives in
 * `scripts`, four other TypeScript files live beside it, and one of them —
 * `verify-merge-judge.ts` — uses `samePattern` four times, a name this gate's
 * own ALLOWED list classifies as genuinely wrong. The gate shipped green while
 * a violation of its own list sat in its own directory. Nobody chose that; the
 * directory was simply never named, which is the failure mode the sentence
 * above describes and the reason the coverage check below now exists.
 */
const ROOTS = [join(PKG, "src"), join(PKG, "test"), join(PKG, "scripts")];

/*
 * The package's own top-level `.ts` files — the three vitest configs and
 * `sst-env.d.ts`. They are code the package runs, they are small, and they are
 * clean today, so there is no honest reason to leave them out and every reason
 * not to have a fourth category of "file we do not look at".
 */
const LOOSE_FILE_DIR = PKG;

/*
 * DIRECTORIES DELIBERATELY OUTSIDE THE SCAN, with the reason each is out.
 *
 * The coverage check below fails on any `.ts` file that is neither under a root
 * nor under one of these, so a new directory of TypeScript cannot appear in
 * this package without someone making a decision about it. Adding a name here
 * is that decision, written down.
 */
const NOT_OURS = new Set([
  "node_modules", // other people's code, and the gate has no opinion about it
  "dist", // build output; the input is already scanned
  "coverage", // vitest's report, regenerated on every run
  ".turbo", // task cache
]);

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
 * SELF-EXPIRING, PER FILE. An entry whose name does not appear in EVERY file it
 * lists is a failure, not a shrug. Per-NAME expiry was the first version and it
 * was not the granularity the paragraph above promises: `samePattern` listed
 * five files, the code moved out of one of them (`src/lib/signal-derivation.ts`
 * → `src/lib/signal-match-or-mint.ts`), and the entry stayed green because four
 * other files still matched. The dead path went on pre-authorising the name in
 * a file that no longer had it, which is the exact hole the file scoping exists
 * to close. Checking each `(name, file)` pair separately costs one string join
 * and makes a moved file loud.
 *
 * WHY THE `rename` ENTRIES THAT ARE LEFT ARE THE ONES THAT ARE LEFT. The first
 * version of this list had fourteen entries and twelve of them were admitted-
 * wrong names, which made the gate green by construction on its first run. The
 * stated reason — a rename touches every caller, and three other agents had
 * files in this package open — was true of some of them and not of others.
 * Seven had no caller outside their own file at all: two module-private consts,
 * two adjacent locals in one function, and three test-locals. Those were not
 * risky renames deferred; they were free renames the allowlist absorbed. They
 * have been done, and this list is shorter by exactly those seven.
 *
 * What remains genuinely crosses files. `sourceForCapture` and its three
 * siblings are exported and called from routes another agent is editing;
 * `samePattern` is the JSON key in a Gemini responseSchema, so the schema, the
 * parser, the callers and the fixtures have to move in one commit or the
 * model's answer stops parsing at runtime, where no test would see it. Those
 * are worth deferring. "One caller in one file" was not.
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
      "src/lib/signal-match-or-mint.ts",
      "scripts/verify-merge-judge.ts",
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
      "parsing at runtime, where no test would see it. The last two paths were " +
      "added when the gate learned to check allowances per file: the code moved " +
      "out of `src/lib/signal-derivation.ts` into `signal-match-or-mint.ts` and " +
      "the old path sat here unnoticed, and `scripts/` was not being scanned at " +
      "all, so the sixth site was invisible. Both are the reason this entry is " +
      "the one the per-file staleness check was aimed at",
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
];

/* Indexed by name for the scan, and by identity for the stale check below. */
const ALLOWED_BY_NAME = new Map(ALLOWED.map((e) => [e.name, e]));

/*
 * A used allowance is a (name, file) PAIR, not a name. A tab separates them
 * because neither an identifier nor a path can contain one, so the key cannot
 * be forged by a file called `samePattern` or anything else creative.
 */
const allowanceKey = (name, file) => `${name}\t${file}`;
const allowancesUsed = new Set();

/**
 * Which listed files an entry failed to be used in.
 *
 * Split out from the report below so the self-test can drive it directly with a
 * made-up entry and a made-up set of uses. Left inline, the only way to prove
 * per-file expiry works was to edit ALLOWED by hand and read the output — which
 * is how the per-NAME version survived: someone did exactly that, with a
 * single-file entry, the easy case where per-name and per-file agree.
 */
function unusedAllowanceFiles(entries, used) {
  const out = [];
  for (const entry of entries) {
    const unused = entry.files.filter(
      (file) => !used.has(allowanceKey(entry.name, file)),
    );
    if (unused.length > 0) out.push({ name: entry.name, unused });
  }
  return out;
}

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

/**
 * What to do with one filename: read it, refuse it, or leave it alone.
 *
 * A pure function taking a name rather than three branches inside `walk`,
 * because the interesting branch is unreachable from the package as it stands.
 * The API has no `.tsx` file, so deleting the refusal outright changes nothing
 * a run can observe — the gate stayed green with it gone, which means the one
 * decision here that is a JUDGEMENT rather than a mechanism had no proof at
 * all. Pulled out to a name, the self-test can ask it directly.
 */
function classify(filename) {
  /*
   * Refuse rather than guess. This scanner has no JSX-text pass, so on a .tsx
   * file it would read the words a person reads on screen as if they were
   * identifiers and accuse the one place the old word is required. The API has
   * no .tsx today; if one ever appears, whoever added it should see the
   * sentence below rather than a pile of false alarms.
   */
  if (/\.tsx$/.test(filename)) return "refuse";
  if (/\.ts$/.test(filename)) return "scan";
  return "ignore";
}

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, found);
      continue;
    }
    const verdict = classify(entry);
    if (verdict === "refuse") {
      console.error(
        `\nvocabulary gate: ${relative(PKG, full)} is a .tsx file.\n` +
          `This scanner reads TypeScript without JSX — it cannot tell tag text\n` +
          `from code, and would accuse the words a person reads on screen.\n` +
          `Either keep JSX out of packages/api, or teach this scanner the JSX\n` +
          `masking pass that packages/web/scripts/check-vocabulary.mjs carries.\n`,
      );
      process.exit(1);
    }
    if (verdict === "scan") found.push(full);
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
          allowancesUsed.add(allowanceKey(name, file));
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
 *
 * A THIRD, ADDED AFTER REVIEW, AND THE MOST EMBARRASSING OF THE THREE: the
 * first version of this list had eighteen cases and not one of them contained
 * `//`. Every masking case used `/* *\/`. A one-character edit to the
 * line-comment branch — dropping the search for the newline, so `//` blanks to
 * end of FILE — left all eighteen green and the package reported clean; a
 * planted violation appended to `src/routes/groups.ts` went unseen, because
 * that file's first `//` is on line 200 of 685 and 71% of it had gone dark.
 * 86 of the package's scanned files contain a `//`. The gate was proven against
 * the apostrophe form and the block-comment form of the blindness it was
 * written to prevent, and unproven against the commonest comment in the
 * package it scans. The same hole covered the `-ed`/`-ing` inflections, which
 * the commit message credits with finding all fourteen uses of `captured`:
 * deleting those four lines from `forms()` was also green.
 *
 * The rule that follows from it, and the reason the list below is longer than
 * it looks: EVERY MASKING MECHANISM GETS A CASE, and the case is written by
 * breaking the mechanism first and watching the case go red. The four are line
 * comments, block comments, quoted strings and template literals; the two
 * traversal mechanisms are the roots and the allowance expiry, which are
 * checked separately below because neither is a property of one snippet.
 *
 * `at` — the exact `name:line` pairs — is carried by every multi-line case.
 * Names alone are not enough: `blank()` can be made to eat newlines, which
 * keeps every name-only case green and still exits 1 on a real violation, while
 * reporting a line hundreds of rows off. `file:line` is the whole actionable
 * content of the report, so it is asserted rather than hoped for.
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
    at: ["RoomRow:1", "CaptureRow:2", "patternIndex:3"],
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
    at: ["capturePanel:3"],
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
    at: ["patternId:2"],
    why: "after a NESTED template interpolation, where a one-boolean state machine loses track and mis-reads the rest of the file",
    src: [
      "const q = sql`${parts.map((c) => `${c.col}`).join(\",\")}`;",
      "const patternId = 1;",
    ].join("\n"),
  },
  {
    expect: ["roomSep", "patternId"],
    at: ["roomSep:1", "patternId:2"],
    why:
      "A BRACE INSIDE `${...}`, which is the only thing the interpolation depth " +
      "counter exists for. The nested-template case above has an " +
      "expression-body arrow, so no `{` ever reaches the counter and deleting it " +
      "left that case green. Here the arrow has a block body: without the " +
      "counter the `}` closing it pops the interpolation early, everything after " +
      "it goes back to being template prose, and `roomSep` — a real column " +
      "reference in the position this package puts them — vanishes. `patternId` " +
      "on the next line proves the file does not ALSO go dark, which is what " +
      "made the damage look survivable and the counter look untested",
    src: [
      "const q = sql`${parts.map((c) => { return c.col; }).join(roomSep)}`;",
      "const patternId = 1;",
    ].join("\n"),
  },
  {
    expect: ["roomList", "patternKey"],
    at: ["roomList:2", "patternKey:4"],
    why:
      "TWO regexes holding apostrophes, with a violation BETWEEN them — the web " +
      "gate's original wound, reproduced rather than gestured at. One " +
      "apostrophe proves nothing: an unterminated quote with no partner never " +
      "closes, so a scanner that hunts for its mate across the whole file " +
      "behaves identically to one bounded to the line, and the single-regex " +
      "version of this case stayed green when the bound was removed. It takes a " +
      "SECOND apostrophe for the unbounded scanner to close on, and a planted " +
      "name in the gap for the damage to have somewhere to show",
    src: [
      "const re = /it's/;",
      "const roomList = [];",
      "const re2 = /don't/;",
      "const patternKey = 2;",
    ].join("\n"),
  },
  {
    expect: ["roomList"],
    why:
      "the apostrophe case's OTHER half: code after the apostrophe ON THE SAME " +
      "LINE. The comment on that branch promises the damage from a misread " +
      "quote is one line rather than the rest of the file; the honest number is " +
      "zero lines, and nothing asserted it. Blanking to end of line instead of " +
      "treating the quote as punctuation passed every case, because every case " +
      "put its planted name on the NEXT line",
    src: "const re = /it's/; const roomList = [];",
  },
  {
    expect: ["SQLPatternFragment", "JSONCaptureBody"],
    why:
      "AN ACRONYM RUNNING INTO A WORD. `words()` splits on two rules and only " +
      "the first — lowercase then uppercase — had a case; `SQLPattern` has no " +
      "such boundary, so without the second rule it splits to `sqlpattern` and " +
      "matches nothing. Backend names carry acronyms constantly (SQL, JSON, " +
      "HTTP, URL), which makes this the likelier of the two rules to matter and " +
      "the one that was untested",
    src: [
      "type SQLPatternFragment = string;",
      "interface JSONCaptureBody { id: string }",
    ].join("\n"),
    at: ["SQLPatternFragment:1", "JSONCaptureBody:2"],
  },
  {
    expect: ["wowScore", "worldSnapshot"],
    why:
      "THE TWO FORBIDDEN WORDS NO CASE NAMED. Five of the seven appeared " +
      "somewhere in this list; `wow` and `world` appeared in none, so either " +
      "could be deleted from FORBIDDEN with every case green — a gate that " +
      "quietly stops enforcing two of its seven rulings. `wow_kind` and " +
      "`wow_score` are the deleted columns by name, and `world` is the " +
      "frontend's rendering vocabulary arriving in the package that must not " +
      "borrow it",
    src: "const wowScore = 1; const worldSnapshot = {};",
  },
  {
    expect: ["roomHeading"],
    at: ["roomHeading:4"],
    why:
      "A BLOCK COMMENT SPANNING LINES, which is the only shape that makes " +
      "`blank()` cross a newline and therefore the only one that can catch it " +
      "eating them. Every other masking case blanks within a single line, so " +
      "dropping the newline guard from `blank()` left them all green while the " +
      "whole file collapsed onto line 1 — names right, lines hundreds of rows " +
      "off, and `file:line` is the only part of the report anyone can act on",
    src: [
      "/*",
      " * this used to be called a room's field, and the rename is why",
      " */",
      "let roomHeading = 1;",
    ].join("\n"),
  },
  {
    expect: ["capturePanel"],
    why:
      "AN ESCAPED QUOTE INSIDE A STRING. The string scanner steps over `\\\\x` " +
      "as one unit; without that step the `\\\"` ends the string early and the " +
      "words a person wrote — `leave this room` — are read as code and accused. " +
      "So the break shows up as an EXTRA name (`room`), not a missing one, " +
      "which is why the exact-set assertion is what catches it and a subset " +
      "assertion would not",
    src: 'const s = "she said \\"leave this room\\" and left"; const capturePanel = 1;',
  },
  {
    expect: ["sparkOffset"],
    at: ["sparkOffset:2"],
    why: "a concept the canon deleted, after a comment that mentions it",
    src: [
      "/* sparks used to live here; the canon removed them on 2026-08-15 */",
      "let sparkOffset = 0;",
    ].join("\n"),
  },
  {
    expect: ["roomRow"],
    at: ["roomRow:2"],
    why: "PAIRED: the old word in a comment stays legal, and the scanner is still awake on the next line. Without the planted name this case would pass on a scanner that had gone blind",
    src: [
      "/* this used to be called a room's field, and the rename is why */",
      "let roomRow = 1;",
    ].join("\n"),
  },
  {
    expect: ["roomRow"],
    at: ["roomRow:2"],
    why:
      "THE SAME PAIR IN A `//` COMMENT, and the case whose absence is the reason " +
      "this list was sent back. Eighteen cases used `/* *" +
      "/` and none used `//`, so the line-comment branch was the one masking " +
      "mechanism with no proof at all — blanking it to end of file was green, " +
      "and 86 of the package's files have a `//` in them. It fails in both " +
      "directions: mask too much and `roomRow` disappears, mask nothing and the " +
      "`room` in the sentence above it is accused",
    src: [
      "// this used to be called a room's field",
      "let roomRow = 1;",
    ].join("\n"),
  },
  {
    expect: ["capturePanelId"],
    at: ["capturePanelId:5"],
    why:
      "A BAD NAME AFTER A LONG `//` BLOCK. One commented line proves the branch " +
      "runs; four prove it stops at each newline rather than at the first one " +
      "and then running to the end of everything. The block deliberately " +
      "contains `world` and `room`, both forbidden, so a branch that stops " +
      "masking early is as loud as one that masks too much",
    src: [
      "// docs/data-model.md is the vocabulary of record, and it says the",
      "// word for layer 1 is inspiration rather than the world's word for",
      "// it. The same paragraph is why a room is stored as a group. This",
      "// block is four lines so a masker that runs past one has room to run.",
      "const capturePanelId = 3;",
    ].join("\n"),
  },
  {
    expect: ["roomTotal"],
    why:
      "A `//` COMMENT AFTER CODE ON THE SAME LINE. The mask has to start at the " +
      "slashes, not at the start of the line — a `//.*` swept over whole lines " +
      "takes the declaration with it. `patterns` in the trailing prose is " +
      "forbidden and must stay unaccused",
    src: "const roomTotal = 1; // patterns used to be counted here",
  },
  {
    expect: ["roomHost"],
    why:
      "`//` INSIDE A STRING, which is not a comment. A URL is the everyday way " +
      "this arrives. If the line-comment branch is ever hoisted above the " +
      "string branch — or replaced with a regex over raw text — the rest of the " +
      "line goes dark and `roomHost` is lost; the `rooms` in the URL path must " +
      "stay unaccused either way",
    src: 'const u = "https://example.com/rooms"; const roomHost = 1;',
  },
  {
    expect: ["capturedRows", "capturingSession"],
    why:
      "`-ed` AND `-ing`, the inflections the commit message credits with " +
      "finding all fourteen uses of `captured` — and which no case exercised. " +
      "Deleting the `d$` line from `forms()` loses `capturedRows`; deleting the " +
      "`ing$ → e` line loses `capturingSession`. The self-test only ever " +
      "covered `s` and `es`, so the two rules that did the work were the two " +
      "nothing watched",
    src: "const capturedRows = []; const capturingSession = 1;",
  },
  {
    expect: ["patternedAfter", "roomingList"],
    why:
      "the other two inflection rules, isolated one per name so a deletion says " +
      "which line went. `patterned` reaches `pattern` only by stripping `ed` " +
      "(stripping `d` leaves `patterne`), and `rooming` reaches `room` only by " +
      "stripping `ing` (stripping it and appending `e` leaves `roome`). Four " +
      "rules, four names, no rule covered by another",
    src: "const patternedAfter = null; const roomingList = [];",
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
    at: ["patternCount:2"],
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

/**
 * THE ALLOWANCE EXPIRY, WHICH IS NOT A PROPERTY OF ANY SNIPPET.
 *
 * `scanSource` cannot express these: an allowance expires across a whole run,
 * over several files, so the only thing a snippet case could prove is that a
 * name is skipped in its own file — which the HANDLE_PATTERN pair already does.
 * These drive `unusedAllowanceFiles` with a made-up entry instead.
 *
 * The middle case is the one that matters and the one the per-NAME version
 * passed: a two-file entry with only one file matched. Per-name, the entry is
 * "used" and green, and the unmatched path keeps pre-authorising the name in a
 * file that no longer contains it. Per-file, it is named and loud. The
 * single-file case above it is the easy one where both versions agree, and it
 * is the only one that was ever checked.
 */
const EXPIRY_SELFTEST = [
  {
    why: "an entry whose only file matched — nothing to report",
    entry: { name: "n", files: ["a.ts"] },
    used: ["n\ta.ts"],
    expect: [],
  },
  {
    why: "TWO FILES, ONE MATCHED — the case per-name expiry called green. The unmatched path is a live exemption for a file that does not use the name",
    entry: { name: "n", files: ["a.ts", "b.ts"] },
    used: ["n\ta.ts"],
    expect: ["b.ts"],
  },
  {
    why: "an entry nothing matched at all — both paths named, not just the first",
    entry: { name: "n", files: ["a.ts", "b.ts"] },
    used: [],
    expect: ["a.ts", "b.ts"],
  },
  {
    why: "the same name used in a file the entry does not list buys the entry nothing — the key is the pair, not either half",
    entry: { name: "n", files: ["a.ts"] },
    used: ["n\tsomewhere-else.ts"],
    expect: ["a.ts"],
  },
];

/**
 * WHICH FILES THIS SCANNER WILL AND WILL NOT READ.
 *
 * `.tsx` → refuse is the one judgement in this file that the package cannot
 * currently exercise: there is no `.tsx` in packages/api, so deleting the
 * refusal is invisible to every run. That is the definition of an untested
 * decision, and it is a decision worth keeping — a scanner with no JSX pass
 * turned loose on JSX accuses the words a person reads on screen, which is the
 * one place the retired word is REQUIRED.
 *
 * `.d.ts` is here because `sst-env.d.ts` sits in the package root and the two
 * rules could plausibly disagree about it. They do not: it is TypeScript, it is
 * scanned, and the case says so out loud rather than leaving it to be
 * rediscovered.
 */
const CLASSIFY_SELFTEST = [
  ["signals.ts", "scan"],
  ["sst-env.d.ts", "scan"],
  ["Home.tsx", "refuse"],
  ["check-vocabulary.mjs", "ignore"],
  ["0000_three_layers.sql", "ignore"],
  ["notes.txt", "ignore"],
];

function selftest() {
  const failures = [];

  for (const [filename, want] of CLASSIFY_SELFTEST) {
    const got = classify(filename);
    if (got !== want) {
      failures.push(
        `  which files the scanner reads\n` +
          `      ${filename}\n` +
          `      expected: ${want}\n` +
          `      got:      ${got}\n`,
      );
    }
  }

  for (const c of SELFTEST) {
    const hits = scanSource(c.src, c.file ?? "<self-test>");
    const got = [...new Set(hits.map((h) => h.name))].sort();
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
      continue;
    }
    /*
     * Lines are checked only where the case declares them, and every multi-line
     * case declares them. A single-line snippet has nothing to get wrong.
     */
    if (!c.at) continue;
    const gotAt = [...new Set(hits.map((h) => `${h.name}:${h.line}`))].sort();
    const wantAt = [...c.at].sort();
    const sameAt =
      gotAt.length === wantAt.length && gotAt.every((n, k) => n === wantAt[k]);
    if (!sameAt) {
      failures.push(
        `  ${c.why}\n` +
          `      ${c.src.replace(/\n/g, "\n      ")}\n` +
          `      right names, WRONG LINES — a report nobody can act on\n` +
          `      expected: ${wantAt.join(", ")}\n` +
          `      reported: ${gotAt.join(", ")}\n`,
      );
    }
  }

  for (const c of EXPIRY_SELFTEST) {
    const got = unusedAllowanceFiles([c.entry], new Set(c.used));
    const unused = got.length > 0 ? [...got[0].unused].sort() : [];
    const want = [...c.expect].sort();
    const same =
      unused.length === want.length && unused.every((f, k) => f === want[k]);
    if (!same) {
      failures.push(
        `  ${c.why}\n` +
          `      entry ${c.entry.name} in ${c.entry.files.join(", ")}\n` +
          `      used: ${c.used.length ? c.used.join(", ") : "(nothing)"}\n` +
          `      expected stale: ${want.length ? want.join(", ") : "(nothing)"}\n` +
          `      reported stale: ${unused.length ? unused.join(", ") : "(nothing)"}\n`,
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
  console.log(
    `vocabulary (api): self-test passed (${SELFTEST.length} scanner cases, ` +
      `${EXPIRY_SELFTEST.length} expiry cases, ${CLASSIFY_SELFTEST.length} file-kind cases)`,
  );
}

selftest();

/*
 * The self-test deliberately exercises a real allowance, so it marks one used.
 * Clearing here means the staleness check below reports on the PACKAGE, which
 * is the only thing it is allowed to have an opinion about.
 */
allowancesUsed.clear();

const violations = [];
const scanned = new Set();

for (const root of ROOTS) {
  for (const file of walk(root)) {
    scanned.add(file);
  }
}
for (const entry of readdirSync(LOOSE_FILE_DIR)) {
  const full = join(LOOSE_FILE_DIR, entry);
  if (!statSync(full).isFile()) continue;
  /* Same classifier as the roots, so a `.tsx` here is refused rather than
     silently skipped and left for the coverage check to find. */
  if (classify(entry) === "scan") scanned.add(full);
}

for (const file of scanned) {
  const rel = relative(PKG, file);
  for (const hit of scanSource(readFileSync(file, "utf8"), rel)) {
    violations.push({ ...hit, file: rel });
  }
}

/*
 * NOTHING TYPESCRIPT IN THIS PACKAGE GOES UNLOOKED-AT.
 *
 * ROOTS is a list someone maintains by hand, and a hand-maintained list of
 * directories fails silently in the one direction that matters: drop an entry,
 * or add a directory and forget, and the gate reports clean over code it never
 * opened. That is not hypothetical here. `scripts/` was omitted from the first
 * version, and it contained four `.ts` files, one of which used a name this
 * gate's own list calls wrong. Deleting `test` from ROOTS was likewise green.
 *
 * So the roots are checked against the filesystem rather than trusted. This
 * walk starts at the package root, skips only the directories named in
 * NOT_OURS, and asserts that every `.ts` file it finds is one the scan above
 * actually read. Dropping a root now fails; adding a directory of TypeScript
 * without deciding about it now fails. It is the same argument the ROOTS
 * comment makes, moved out of the comment and into an assertion.
 *
 * WHAT THIS CHECK STILL DOES NOT COVER, said out loud rather than left to be
 * discovered: `.mjs` and `.js`. The canon is a vocabulary for the TypeScript
 * this package ships, and the two `.mjs` files here are both build-time
 * scripts, one of them this one. If product code ever arrives in plain
 * JavaScript, this is the sentence that will be wrong, and the fix is to widen
 * both `classify` and the pattern below together.
 */
function everyTypeScriptFile(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    if (NOT_OURS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) everyTypeScriptFile(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

const unscanned = everyTypeScriptFile(PKG).filter((f) => !scanned.has(f));
if (unscanned.length > 0) {
  console.error(
    `\nvocabulary (api): ${unscanned.length} TypeScript file(s) in this package were\n` +
      `never scanned. An unscanned file is indistinguishable from a clean one,\n` +
      `so this is a failure rather than a note.\n\n` +
      `Add the directory to ROOTS in scripts/check-vocabulary.mjs, or — if it is\n` +
      `genuinely not this package's code — add its top-level name to NOT_OURS\n` +
      `with the reason.\n`,
  );
  for (const f of unscanned) console.error(`  ${relative(PKG, f)}`);
  console.error("");
  process.exit(1);
}

/*
 * AN ALLOWANCE THAT MATCHES NOTHING IS A FAILURE — PER FILE.
 *
 * Every entry above is a hole in the gate. A hole that stopped being needed —
 * because the rename happened, or the file moved, or the identifier was deleted
 * — still reads like a live exception to the next person, and still silently
 * covers anything that later takes the same name in that file. Failing on it
 * costs one deletion and keeps the list honest about its own size.
 *
 * Per FILE and not per name, because an entry that lists five paths is five
 * holes, and four of them matching says nothing about the fifth. See
 * `unusedAllowanceFiles` and the expiry cases in the self-test.
 */
const stale = unusedAllowanceFiles(ALLOWED, allowancesUsed);
if (stale.length > 0) {
  const holes = stale.reduce((n, e) => n + e.unused.length, 0);
  console.error(
    `\nvocabulary (api): ${holes} (name, file) exemption(s) in ALLOWED match nothing.\n` +
      `Each one is a hole in this gate that is no longer buying anything, and\n` +
      `each still pre-authorises that name for anything else in that file.\n` +
      `If the rename happened, delete the path — and the entry, if it was the\n` +
      `last one. If the file moved, fix the path.\n`,
  );
  for (const e of stale) {
    console.error(`  ${e.name}  (not found in ${e.unused.join(", ")})`);
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
