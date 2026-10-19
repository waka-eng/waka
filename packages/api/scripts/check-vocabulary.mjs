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
 * WHAT IS TESTED, AND THE LESSON THAT CHANGED THE ANSWER.
 *
 * This file used to test the function that JUDGES — hand it a snippet, check
 * which names it flags — and nothing that decides WHAT GETS JUDGED. That is a
 * gate that can print `self-test passed (30 cases)` and `clean` without having
 * looked at real code, and it did: a regex holding three backticks in
 * `src/lib/generation-doc.test.ts` left the masker inside a template from line
 * 164 to the end of the file, so 87 of its 250 lines were blanked unread. A
 * planted violation at line 185 passed. The identical name at line 100 of the
 * same file was caught. Every case in this file was green throughout.
 *
 * So the traversal, the masking, the scan loop and the report are all pure
 * functions with their own cases now, and the arguments they used to reach for
 * — the filesystem, the run's bookkeeping — are handed in, so a case can drive
 * them against a tree that does not exist. `test/vocabulary-gate.test.ts` runs
 * this script as a process for the one thing no case here can reach: whether a
 * check that would fail is still WIRED IN, since a deleted check and a passing
 * one print the same word.
 *
 * And the masker now says when it has lost track. Every literal in a file that
 * compiles is closed, so reaching end of file still inside one means this
 * scanner is wrong and everything after that point was masked without being
 * read. Both blindnesses this project has had — an apostrophe in the web gate,
 * a regex here — had exactly that signature and neither was visible in the
 * verdict. It costs one integer and it does not need to know what the next
 * unhandled delimiter will be.
 *
 * THE THREE THINGS THAT DECIDE WHETHER THE JUDGEMENT RUNS AT ALL, since that is
 * where every defect in this file has turned out to live. The parts that JUDGE
 * are proven several ways over; the parts that decide which files reach them,
 * whether a check's failure stops the process, and whether a printed number came
 * from anything were carried by reading the code, three reviews running.
 *
 *   - WHICH FILES. The walk is checked against the filesystem, and the SCAN is
 *     now checked against the walk: `scanFiles` reports the paths that reached
 *     it and the files that yielded no identifier, and the run asserts both. The
 *     four edits that used to delete a directory from the judgement in silence —
 *     filtering the argument, an empty `readSource`, an early return, a
 *     `try/catch` — all fail now. And NOT_OURS cannot excuse a directory the
 *     repository tracks, so dropping a root while excluding it is no longer the
 *     one edit that switches off a check and its guard together.
 *   - WHETHER FAILURE STOPS ANYTHING. Every `process.exit(1)` in the run below
 *     is held down by a case in `test/vocabulary-gate.test.ts` that goes red if
 *     it is deleted. The checks no tree can trigger — the expiry pair count, the
 *     root/exclusion guard, the self-test floors — are held by cases that run a
 *     MUTATED COPY of this script against the real package, because a check
 *     nothing can trigger is a check nobody can prove is connected.
 *   - WHETHER THE NUMBERS MEAN ANYTHING. `disposition` is read for sense, the
 *     rename/permanent split is counted from both sides rather than by
 *     subtraction AND each half is asserted against the list's own data from
 *     outside, the counts in the report, coverage and blind headers are asserted
 *     against trees with two of the thing in them, and — because two of a thing
 *     cannot tell `> 0` from `> 1` — against trees with exactly ONE as well. The
 *     incident this gate was written for was one torn file. The self-test's own
 *     summary is checked the only way a self-reported number can be: a mutated
 *     copy with one extra case must print one more.
 *
 * WHAT IS STILL UNCHECKED, in one place, with what would get through and the
 * fix for each. It is a shorter list than it was, because two of the three
 * entries that used to be here were closable and are now closed.
 *
 *   1. JAVASCRIPT — `.js`, `.mjs`, `.cjs` — is outside both `classify` and the
 *      coverage walk. A retired word in an identifier in such a file is neither
 *      read nor reported unread. What keeps this from mattering today is that
 *      the package has exactly two such files, `scripts/measure-concerns.mjs`
 *      and this script, and neither ships; what makes it cost more than one
 *      character is that the process test's mutated copies of this gate live in
 *      `scripts/*.mjs` and rely on being invisible to it. See the long note
 *      above `everyTypeScriptFile`. (This entry used to say `.mjs` and `.js`
 *      while the rule was `/\.tsx?$/` — so `.mts` and `.cts`, which ARE
 *      TypeScript, were outside it too and the note did not say so. That was a
 *      live hole, not a hypothetical one: a `src/*.mts` with two retired words
 *      in it ran clean. Both rules now match the whole family.)
 *   2. In a tree with no `.gitignore` anywhere above this package, the exclusion
 *      justification declines to speak and NOT_OURS goes unexamined — see the
 *      note beside `ignoreRules`. Every checkout has one; an export might not.
 *      The same note covers the one unheld edit near it: widening the decline to
 *      "or the ignore file mentions no directories" is green everywhere, and is
 *      inert wherever a real `.gitignore` exists.
 *
 * Run: node scripts/check-vocabulary.mjs        (also runs in `pnpm test`)
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
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
 * WHICH DIRECTORY NAMES THE REPOSITORY ITSELF SAYS ARE NOT OURS.
 *
 * NOT_OURS and ROOTS are two hand-maintained lists, and `rootsAlsoExcluded`
 * below only catches the case where they NAME THE SAME THING. The coherent form
 * of that mistake does not: drop `test` from ROOTS and add `"test"` to NOT_OURS,
 * and the two lists agree with each other perfectly while twenty files stop
 * being read AND stop being missed — the coverage check cannot report a file its
 * own walk was told to skip. That is one edit, in two data lists, that switches
 * off the scan and its guard together, which is precisely the shape this gate
 * exists to make impossible.
 *
 * So the excuse has to come from somewhere that is not this file. `.gitignore`
 * is the repository's own record of which directories are generated or vendored,
 * it is maintained by a different force for a different reason, and nobody can
 * add `test` to it without git quietly forgetting the next test file — which is
 * a great deal louder than editing two constants here.
 *
 * The reading is DELIBERATELY LITERAL: a plain name on its own line, with or
 * without slashes around it. A glob or a path does not license a name, and a
 * `!` negation is not an ignore. Everything it declines to understand it treats
 * as "not ignored", so the only mistake it can make is refusing an exclusion
 * somebody must then justify — never allowing one it should have refused.
 */
function ignoredDirectoryNames(text) {
  const names = new Set();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const name = line.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!name || name.includes("/") || /[*?[\]]/.test(name)) continue;
    names.add(name);
  }
  return names;
}

/**
 * Excluded directories that are really here and that the repository tracks.
 *
 * `exists` is handed in for the same reason every other traversal's listing is:
 * so the cases can describe a package rather than need one. Only directories
 * that are actually present can hide anything, which is why `.turbo` — a cache
 * this package has never had — is not a finding.
 */
function unjustifiedExclusions(notOurs, ignored, exists) {
  return [...notOurs].filter((name) => exists(name) && !ignored.has(name));
}

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
    name: "pattern",
    files: ["src/queue/gemini.ts", "src/queue/review-question.test.ts", "src/lib/openrouter-model-provider.ts", "src/lib/openrouter-model-provider.test.ts"],
    disposition: "permanent",
    why: "the external OpenAPI/JSON Schema regular-expression keyword, used in provider output schemas and their translation tests. The provider owns this field name; it is not WAKA's layer-2 signal concept",
  },
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
    /* signals.ts imports it for the scoped-recall q filter — the same SQL,
       spoken at a second call site, is not a second word */
    files: ["src/routes/inspirations-recall.ts", "src/routes/signals.ts"],
    disposition: "permanent",
    why:
      "builds the second operand of a SQL `ILIKE`, which SQL itself calls a " +
      "pattern. Renaming it would make the function lie about what the " +
      "language it is speaking calls the thing it returns",
  },
  /* `samePattern` — the entry that used to stand here — was retired
     2026-08-24 by the three-way judge (no-quiet-corners Phase 5): the JSON
     key, the schema, the parser, the callers and the fixtures all moved to
     `relation` in one commit, exactly the way this entry's own note said
     they would have to. The one survivor is a deliberately-malformed probe
     in `gemini-judge.test.ts`, as a quoted string key — a string, not an
     identifier, per this gate's own doctrine. */
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
 *
 * It also reports how many (name, file) pairs it LOOKED AT, which sounds like
 * bookkeeping and is not. A correct function on the wrong input is the other
 * way this check dies: hand it `ALLOWED.filter(permanent)` and every rename
 * entry — the five holes that are supposed to be temporary — stops being
 * checked for staleness, with this function still returning the right answer
 * about the entries it was shown, and every case here still green. The caller
 * asserts the count against ALLOWED, so narrowing the input is a red run rather
 * than a quiet one.
 */
function unusedAllowanceFiles(entries, used) {
  const stale = [];
  let checked = 0;
  for (const entry of entries) {
    checked += entry.files.length;
    const unused = entry.files.filter(
      (file) => !used.has(allowanceKey(entry.name, file)),
    );
    if (unused.length > 0) stale.push({ name: entry.name, unused });
  }
  return { stale, checked };
}

/** The only two things an entry is allowed to be. */
const DISPOSITIONS = ["permanent", "rename"];

/**
 * THE ALLOWLIST'S OWN SHAPE, CHECKED RATHER THAN ASSUMED.
 *
 * Everything above treats `disposition` as data with meaning and nothing ever
 * read it for sense. One character does the damage: `disposition: "permanant"`
 * on a rename entry matches neither branch, so the run prints "4 awaiting a
 * rename, 3 permanent" instead of 5 and 2, and a hole that was supposed to be
 * temporary has quietly reclassified itself as forever — with every case in this
 * file green, because no case in this file reads the data. The number in that
 * sentence is the ratchet the whole allowlist discipline is read against; it is
 * the one line of this gate's output anyone tracks over time.
 *
 * A `rename` with no `to` is the same defect said differently: it is a permanent
 * hole wearing a temporary label, since nobody can act on it. And a path listed
 * twice in one entry is counted twice in the pair total the expiry check
 * measures itself against, so the gate reports guarding more holes than exist
 * while the duplicate proves nothing.
 */
function allowlistProblems(entries) {
  const problems = [];
  for (const entry of entries) {
    if (!DISPOSITIONS.includes(entry.disposition)) {
      problems.push(
        `${entry.name}: disposition ${JSON.stringify(entry.disposition)} is ` +
          `neither ${DISPOSITIONS.join(" nor ")}, so it counts as neither`,
      );
    }
    if (entry.disposition === "rename" && !entry.to) {
      problems.push(
        `${entry.name}: a rename with no \`to\` — nobody can do a rename that ` +
          `does not say what the name becomes`,
      );
    }
    if (entry.files.length === 0) {
      problems.push(`${entry.name}: allowed in no files, so it allows nothing`);
    }
    const seen = new Set();
    for (const file of entry.files) {
      if (seen.has(file)) {
        problems.push(
          `${entry.name}: ${file} listed twice — a repeated path inflates the ` +
            `(name, file) total the expiry check measures itself against`,
        );
      }
      seen.add(file);
    }
  }
  return problems;
}

/**
 * The two halves of the list, counted separately and never by subtraction.
 *
 * `ALLOWED.length - renames.length` reads like the same thing and is not: it
 * makes the permanent count a mirror of the rename count, so anything that stops
 * an entry from being seen as a rename — a typo in the data, a mistyped literal
 * in the filter — moves it silently into "permanent" and the two numbers still
 * add up to the total. Counting both and demanding they account for every entry
 * is what makes that arithmetic unable to lie.
 */
function dispositionSplit(entries) {
  return {
    rename: entries.filter((e) => e.disposition === "rename"),
    permanent: entries.filter((e) => e.disposition === "permanent"),
  };
}

/** Identifier-ish tokens: what a variable, property or type could be called. */
const TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * The words after which a `/` opens a regular expression rather than dividing.
 *
 * Everything else is decided by the character before the slash (see
 * `startsRegex`); these are the identifiers-by-spelling that end no expression,
 * so the character rule would get them backwards. `return /\.tsx$/.test(x)` is
 * the shape that matters and it is not hypothetical — `src/lib/gemini-http.ts`
 * and `src/routes/attachments.ts` both have one.
 */
const REGEX_MAY_FOLLOW = new Set([
  "return",
  "typeof",
  "case",
  "in",
  "of",
  "do",
  "else",
  "void",
  "delete",
  "instanceof",
  "new",
  "yield",
  "await",
]);

/**
 * Is the `/` at `at` the start of a regex literal, or a division sign?
 *
 * The same rule a real parser uses, minus the parser: a `/` that follows
 * something an expression can END with is division, and a `/` that follows
 * anything else opens a regex. `masked` is the partly-blanked output rather
 * than the raw source, so a comment or string before the slash has already
 * become spaces and is skipped along with them — which is right, because
 * neither is part of the expression the slash belongs to.
 *
 * Getting this backwards is not a tie. Calling a regex "division" is the bug
 * this branch exists to fix: the quotes and backticks inside the regex reach
 * the string and template branches and open literals that never close. Calling
 * division "a regex" costs at most the span to the next slash on that line,
 * which is why the fallback below is bounded.
 */
function startsRegex(masked, at) {
  let j = at - 1;
  while (j >= 0 && /\s/.test(masked[j])) j -= 1;
  if (j < 0) return true;
  if (!/[A-Za-z0-9_$)\]]/.test(masked[j])) return true;
  let k = j;
  while (k >= 0 && /[A-Za-z0-9_$]/.test(masked[k])) k -= 1;
  return REGEX_MAY_FOLLOW.has(masked.slice(k + 1, j + 1).join(""));
}

/**
 * Where the regex opened at `start` closes, or -1 if it does not close on its
 * line.
 *
 * A character class is tracked because `/[^/]+/` is legal and its first `/`
 * closes nothing — stopping there would blank two characters, hand `]+` back to
 * the scanner as code and let the real closing slash open a second phantom
 * regex. `\\` is stepped over for the same reason the string branch steps over
 * it: `/a\/b/` is one literal, not two.
 */
function regexEnd(source, start) {
  const nl = source.indexOf("\n", start + 1);
  const lineEnd = nl === -1 ? source.length : nl;
  let inClass = false;
  for (let j = start + 1; j < lineEnd; j += 1) {
    const c = source[j];
    if (c === "\\") {
      j += 1;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
      continue;
    }
    if (c === "/") return j;
  }
  return -1;
}

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
 *
 * RETURNS THE CODE AND WHERE IT LOST TRACK. `openedAt` is the offset of a
 * literal that was still open when the source ran out, or -1. Every literal in
 * a file that compiles is closed, so a non-negative `openedAt` does not mean
 * the FILE is malformed — it means THIS SCANNER is, and everything from that
 * offset to the end of the file was masked without being understood. Both
 * blindnesses this gate has suffered had exactly that signature and neither was
 * visible in the verdict, because a blind scan and a clean one print the same
 * word. Reporting it is what turns the next one into a red run instead of a
 * quiet week. See the check at the bottom of this file.
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
        stack.push({ kind: "interpolation", depth: 0, at: i });
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

    if (ch === "/" && startsRegex(out, i)) {
      /*
       * A REGEX LITERAL, and the reason this branch exists rather than the
       * reason it looks tidy.
       *
       * Without it a `/.../` is not a delimiter at all — its contents are read
       * as code, and any quote or backtick inside opens a literal the scanner
       * then hunts for a partner to. `src/lib/generation-doc.test.ts:164` is
       *
       *     const missing = [...doc.matchAll(/`((?:packages|docs|tools)\/[^`\s]+)`/g)]
       *
       * three backticks in one regex: push, pop, push — and the third never
       * closed, so from that line to the end of the file 87 of 250 lines of
       * real test code were read as template prose and blanked. The gate
       * reported `clean` over them. A `capturedRoomProbe` planted at line 185
       * passed; the identical name at line 100 of the same file was caught.
       * That is the apostrophe wound the header spends thirty lines on, one
       * literal form over, live in this package.
       *
       * The interior is BLANKED rather than scanned, which is a small behaviour
       * change worth saying out loud: `/room|pattern/` used to be flagged and
       * now is not. That follows the same rule as strings — a regex body is
       * text the program matches against, not a name anyone can rename — and it
       * is what makes the apostrophes in `/it's/` a handled case instead of a
       * near miss that the unterminated-quote bound happened to catch.
       */
      const end = regexEnd(source, i);
      if (end === -1) {
        /* No closing slash on this line, so it was punctuation or division
           after all — the same bound, and the same reasoning, as the quote
           branch below. One line of damage instead of the rest of the file. */
        i += 1;
        continue;
      }
      blank(i + 1, end);
      i = end + 1;
      continue;
    }

    if (ch === "`") {
      stack.push({ kind: "template", at: i });
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
       * WHERE THE STRAY APOSTROPHE COMES FROM, corrected. This used to say it
       * arrives from regex literals like `/it's/`, and that was true until the
       * regex branch above started masking their bodies — the two cases in the
       * self-test that use `/it's/` now prove the REGEX branch and no longer
       * reach this one. What is left for this rule is the slash the regex
       * branch declines: a division it reads correctly, or a `/` that opens
       * nothing and closes nowhere. That is a backstop rather than a daily
       * occurrence, and it is asserted directly by its own case rather than
       * left to be exercised by accident, which is how it was covered before
       * and is not a way to know anything.
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

  return { code: out.join(""), openedAt: stack.length ? stack[0].at : -1 };
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
 * A pure function taking a name rather than three branches inside the
 * traversal, because the interesting branch is unreachable from the package as
 * it stands. The API has no `.tsx` file, so deleting the refusal outright
 * changes nothing a run can observe — the gate stayed green with it gone, which
 * means the one decision here that is a JUDGEMENT rather than a mechanism had
 * no proof at all. Pulled out to a name, the self-test can ask it directly, and
 * `test/vocabulary-gate.test.ts` builds a package with a `.tsx` in it to prove
 * the refusal is still wired to an exit rather than merely printed.
 *
 * THE RULE IS THE WHOLE TYPESCRIPT EXTENSION FAMILY, and the `[cm]?` is there
 * because of a real hole rather than for completeness. This said `/\.ts$/` and
 * the coverage walk below said `/\.tsx?$/`, so a `.mts` or a `.cts` was matched
 * by NEITHER: not scanned, and not reported as unscanned either — the one
 * combination the coverage check exists to make impossible. It was not
 * hypothetical. `src/rr-probe.mts` holding two retired words ran clean on the
 * shipped gate, and the identical two lines in `src/rr-probe.ts` exited 1 with
 * both names and both line numbers. Node treats `.mts`/`.cts` as TypeScript,
 * `tsc` compiles them, and this package's `tsconfig.json` includes only files
 * whose names end in `.ts`, so a stray `.mts` is not typechecked either — which
 * makes an unnoticed one worse than an ordinary blind spot rather than better.
 * (Verified, not assumed: a deliberate type error in a `.mts` under `src` left
 * `tsc --noEmit` green, and the same error in a `.ts` failed it.) Both rules
 * moved in one edit, which is the only way they may ever move: the scan and the
 * walk have to agree about what TypeScript is, or a file falls between them
 * exactly the way this one did.
 */
function classify(filename) {
  /*
   * Refuse rather than guess. This scanner has no JSX-text pass, so on a .tsx
   * file it would read the words a person reads on screen as if they were
   * identifiers and accuse the one place the old word is required. The API has
   * no .tsx today; if one ever appears, whoever added it should see the
   * sentence below rather than a pile of false alarms.
   */
  if (/\.[cm]?tsx$/.test(filename)) return "refuse";
  if (/\.[cm]?ts$/.test(filename)) return "scan";
  return "ignore";
}

/**
 * A directory listing, as the traversals below need it.
 *
 * Injected rather than imported so the traversals are pure functions of a tree
 * they are handed. That is the whole point: file DISCOVERY decides what ever
 * reaches the judgement, and until it took an argument, the only way to check
 * it was to run it on the real package and read the answer — which proves the
 * package is clean today and says nothing about whether the walk still walks.
 */
const realListing = (dir) =>
  /* The entry's type comes with the directory read: a separate stat raced
     the `*.probe.ts` fixtures other suites plant and remove in parallel. */
  readdirSync(dir, { withFileTypes: true }).map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
  }));

/**
 * A reader that tolerates exactly one thing: a file that was listed and is no
 * longer there (another suite's fixture, removed while this ran). It is
 * recorded in `vanished` and answers null; any other failure — or a read that
 * fails on a file still present — throws as before.
 */
const whileListed = (readSource, vanished) => (rel) => {
  try {
    return readSource(rel);
  } catch (error) {
    if (error?.code === "ENOENT" && !existsSync(join(PKG, rel))) {
      vanished.add(rel);
      return null;
    }
    throw error;
  }
};

/**
 * WHICH FILES THE SCAN WILL READ, AND WHICH IT REFUSES.
 *
 * Pure, and parameterised on the roots, the loose-file directory and the
 * listing, because every one of them is a decision that can go wrong silently.
 * A traversal that stops recursing, visits only the first root, or matches
 * `.ts` a little too narrowly does not fail — it returns a shorter list, and a
 * shorter list is a quieter, cleaner-looking run. That is the shape of every
 * blindness in this project's history, and it is why this is a function with
 * cases rather than three loops inline at the bottom of the file.
 *
 * The loose-file pass does NOT descend, because the package root's
 * subdirectories are either roots already or named in NOT_OURS; descending
 * would scan `node_modules`.
 *
 * Refusals are RETURNED rather than exited on. Exiting from inside the walk put
 * the one branch here that is a judgement rather than a mechanism — `.tsx` —
 * beyond the reach of any test, because a case that proves it would have had to
 * kill the process.
 */
function filesToScan(roots, looseDir, listing) {
  const out = { scan: [], refuse: [] };
  const take = (dir, name) => {
    const verdict = classify(name);
    if (verdict === "refuse") out.refuse.push(join(dir, name));
    else if (verdict === "scan") out.scan.push(join(dir, name));
  };
  const descend = (dir) => {
    for (const { name, isDirectory } of listing(dir)) {
      if (isDirectory) descend(join(dir, name));
      else take(dir, name);
    }
  };
  for (const root of roots) descend(root);
  for (const { name, isDirectory } of listing(looseDir)) {
    if (!isDirectory) take(looseDir, name);
  }
  return out;
}

/**
 * Every forbidden identifier in one source, with the line it sits on, and the
 * line from which the masker stopped understanding the file.
 *
 * `file` is the package-relative path, and it is a real argument rather than a
 * convenience for the error message: an allowance is granted to a name IN A
 * FILE, so the scan cannot decide anything without knowing where it is.
 *
 * `used` is HANDED IN rather than reached for. It was a module-level Set, and
 * the self-test below exercises a real allowance in its real file, so the
 * self-test's use marked that (name, file) pair used for the whole run. One
 * `allowancesUsed.clear()` after the self-test was all that stopped a genuinely
 * stale exemption from going green — a single deletable line standing between
 * the expiry check and a lie, with nothing able to catch its deletion, since
 * the pair it forged is one the package really does use. Passing the set makes
 * the self-test unable to reach the run's bookkeeping at all, which is a
 * property rather than a line someone has to remember.
 */
function scanSource(source, file, used = new Set()) {
  const found = [];
  let tokens = 0;
  const { code, openedAt } = codeOnly(source);
  code.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(TOKEN)) {
      tokens += 1;
      const name = match[0];
      const allowance = ALLOWED_BY_NAME.get(name);
      if (allowance && allowance.files.includes(file)) {
        used.add(allowanceKey(name, file));
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
  const blindFromLine =
    openedAt === -1 ? -1 : source.slice(0, openedAt).split("\n").length;
  return { found, blindFromLine, tokens };
}

/**
 * THE SCAN LOOP: every discovered file read, judged, and labelled with where it
 * came from.
 *
 * Pure and parameterised on `readSource` for the same reason the traversal is.
 * The loop is three lines and looks too small to be worth a name, which is
 * exactly the argument that left it untested: a `break` in it, or a `file`
 * field that stops varying, produces a run that reads one file and reports
 * `clean` for a hundred and forty-four others.
 *
 * `files` are PACKAGE-RELATIVE paths, and that is load-bearing rather than
 * cosmetic — an allowance is granted to a name in a path, so the string handed
 * in here is what the allowlist is compared against. Hand it absolute paths and
 * every allowance stops matching; hand it bare basenames and an exemption
 * written for `src/lib/public-handles.ts` silently covers any file of that name
 * anywhere. The self-test carries a case for the second, which is the direction
 * that fails quietly.
 *
 * IT REPORTS WHAT IT ACTUALLY LOOKED AT, and that is the part worth the extra
 * two lines. The coverage check at the bottom of this file compares the
 * filesystem against the DISCOVERED list, so everything between "the walk found
 * this file" and "its identifiers were examined" used to be unguarded: filter
 * the argument here, or return an empty string from `readSource`, or wrap this
 * loop in a `try { … } catch { continue; }` — the most ordinary robustness edit
 * there is — and the files vanish from the scan while every check in this file
 * still passes. So the loop says which paths reached `scanSource` (`read`) and
 * which of them yielded no identifier at all (`silent`), and the run asserts
 * both against what discovery handed it. A `.ts` file with nothing nameable in
 * it is either empty or unread, and both deserve a sentence rather than a
 * silent pass — an unread file and a clean one print the same word, which is
 * the failure this whole gate is built around.
 */
function scanFiles(files, readSource, used) {
  const violations = [];
  const blind = [];
  const read = [];
  const silent = [];
  for (const file of files) {
    const source = readSource(file);
    /* null only for a file removed after it was listed — see whileListed */
    if (source === null) continue;
    const scan = scanSource(source, file, used);
    read.push(file);
    if (!(scan.tokens > 0)) silent.push(file);
    for (const hit of scan.found) violations.push({ ...hit, file });
    if (scan.blindFromLine !== -1) blind.push({ file, line: scan.blindFromLine });
  }
  return { violations, blind, read, silent };
}

/**
 * THE REPORT: one row per identifier, worst first, pointing at its first use.
 *
 * Extracted because it is the only part of this file a person ever reads, and
 * because none of it runs on a clean tree. Every case below is unreachable from
 * the package as it stands — there are no violations — so grouping, counting
 * and first-occurrence were carried by nothing at all. `first at` is the line
 * anyone actually opens; a mutation that keeps the LAST occurrence instead of
 * the first still exits 1, still names the right identifier, and sends the
 * reader to the wrong place.
 */
function groupViolations(violations) {
  const byName = new Map();
  for (const v of violations) {
    const got = byName.get(v.name);
    if (got) got.count += 1;
    else byName.set(v.name, { ...v, count: 1 });
  }
  return [...byName.values()].sort((a, b) => b.count - a.count);
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
 * comments, block comments, quoted strings, template literals and — since the
 * gate was caught blind over 87 lines of a real file — regex literals.
 *
 * AND THE RULE THE REGEX FIX ADDED TO IT: A CASE CAN STOP TESTING WHAT IT SAYS
 * IT TESTS. The two `/it's/` cases were written to hold down the quote branch's
 * line bound, and they did, right up until the regex branch started masking
 * pattern bodies — after which their apostrophes never reached the quote branch
 * at all, the bound could be deleted green, and both cases still passed while
 * their comments still described the old job. Nothing announced that. The only
 * thing that found it was re-running the mutation the cases were written for,
 * AFTER the change, which is now the habit: a fix is not finished when the
 * suite is green, it is finished when the breaks it was built from are red
 * again.
 *
 * WHAT IS DELIBERATELY NOT COVERED, having been tried: masking one character
 * FEWER of a regex body (`blank(i + 1, end - 1)`) survives every case, and is
 * meant to. It masks less rather than more, so it cannot hide anything, and the
 * single character it exposes cannot spell a forbidden word — the shortest is
 * three letters — nor act as a delimiter, since the scan has already resumed
 * past it. A case pinning that boundary would assert an arbitrary number rather
 * than a behaviour.
 *
 * `at` — the exact `name:line` pairs — is carried by every multi-line case, and
 * that is enforced in the harness rather than promised here, because this
 * sentence was false when it was only a sentence: one case of thirty had none.
 * Names alone are not enough: `blank()` can be made to eat newlines, which
 * keeps every name-only case green and still exits 1 on a real violation, while
 * reporting a line hundreds of rows off. `file:line` is the whole actionable
 * content of the report, so it is asserted rather than hoped for.
 *
 * WHAT NO CASE HERE CAN REACH, and where it went instead: this function decides
 * its own verdict, so a check that has been DELETED and a check that PASSES
 * print the same thing. `const unscanned = []` and `const stale = []` each ran
 * fully green with every case below correct. Those live in
 * `test/vocabulary-gate.test.ts`, which runs this script as a process against
 * trees that must be rejected.
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
    expect: ["roomProbe"],
    at: ["roomProbe:2"],
    why:
      "A REGEX HOLDING BACKTICKS — the blindness this branch was added for, and " +
      "it was live in this package rather than imagined. " +
      "src/lib/generation-doc.test.ts:164 is this line. Three backticks inside " +
      "one regex: with no regex branch they are read as template delimiters, so " +
      "push, pop, push — and the third never closes. 87 of that file's 250 " +
      "lines were masked as template prose and the gate called them clean. This " +
      "case was written before the branch existed and watched to fail, which is " +
      "the only way to know it is the case that catches it",
    src: [
      "const cited = [...doc.matchAll(/`([^`\\s]+)`/g)];",
      "const roomProbe = 1;",
    ].join("\n"),
  },
  {
    expect: ["captureIdx"],
    at: ["captureIdx:2"],
    why:
      "A REGEX HOLDING A QUOTE, the same wound in the commoner form, PAIRED " +
      "with the proof that the body is masked rather than merely survived: " +
      "`room` and `pattern` are inside the pattern text and must not be " +
      "accused. A regex body is text the program matches against, not a name " +
      "anyone could rename — the same rule strings get, for the same reason. " +
      "Break the branch and this case fails in both directions at once: the " +
      "unbalanced quote swallows line 2 and `captureIdx` goes missing",
    src: ["const re = /a room's pattern/;", "const captureIdx = 1;"].join("\n"),
  },
  {
    expect: ["roomTally", "patternTally"],
    why:
      "DIVISION IS NOT A REGEX, which is the whole reason the branch asks what " +
      "came before the slash instead of just seeing one. Two divisions on one " +
      "line: treat the first as a regex and it closes on the second, blanking " +
      "the span between them and taking `patternTally` with it. A `/` after an " +
      "identifier, a digit, a `)` or a `]` cannot open a regex, and that rule " +
      "is what this case holds down",
    src: "const roomTally = a / 2; const patternTally = b / 3;",
  },
  {
    expect: ["roomIdx", "patternIdx", "roomShare", "patternShare"],
    at: [
      "roomIdx:1",
      "patternIdx:1",
      "roomShare:2",
      "patternShare:2",
    ],
    why:
      "THE OTHER THINGS AN EXPRESSION CAN END WITH: a `)`, a `]`, and a digit. " +
      "The case above only ever divides after an identifier, so three of the " +
      "four characters in that rule could be dropped with it green — and " +
      "`counts[0] / total` and `fn() / total` are how this package divides more " +
      "often than not. Each line needs TWO slashes in the same position for the " +
      "misread to have somewhere to do damage, and a name between them to do it " +
      "to; one slash closes on nothing and proves nothing, which is the " +
      "apostrophe case's lesson for the third time in this list",
    src: [
      "const roomIdx = counts[0] / total; const patternIdx = fn() / total;",
      "const roomShare = 10 / 2; const patternShare = 30 / 4;",
    ].join("\n"),
  },
  {
    expect: ["captureZ"],
    why:
      "`return /re/` — the exception to the character rule, and not a " +
      "hypothetical one: src/lib/gemini-http.ts:195 and " +
      "src/routes/attachments.ts:253 both have this shape. `return` is spelled " +
      "like an identifier but ends no expression, so without it in the keyword " +
      "set the slash reads as division and the pattern text is handed to the " +
      "scanner as code — `rooms` accused, in a string no one can rename. " +
      "AN EARLIER VERSION USED `/it's fine/` AND SURVIVED THE DELETION: one " +
      "apostrophe on a line closes nothing, so the misread cost nothing " +
      "visible. The damage this mechanism prevents is a false accusation, and " +
      "the case has to be shaped like one",
    src: "function f(s) { return /rooms?$/.test(s) && captureZ; }",
  },
  {
    expect: ["captureSeg"],
    why:
      "A SLASH INSIDE A CHARACTER CLASS. `/[^/]+rooms/` is legal and the slash " +
      "in the class closes nothing. Stop there and the rest of the pattern — " +
      "`rooms` — comes back as code and is accused, which is a false alarm " +
      "against text no one can rename. The exact-set assertion is what catches " +
      "it: the break adds a name rather than losing one",
    src: "const seg = /[^/]+rooms/; const captureSeg = 1;",
  },
  {
    expect: ["captureEsc"],
    why:
      "AN ESCAPED SLASH INSIDE A REGEX. `/a\\/rooms\\/b/` is one literal, and " +
      "without the escape step the scan closes on the first `\\/`, hands " +
      "`rooms` back as code and accuses it, then opens a phantom regex on the " +
      "second. The package writes paths this way — the regex at " +
      "src/lib/generation-doc.test.ts:164 has `\\/` in it",
    src: "const p = /a\\/rooms\\/b/; const captureEsc = 1;",
  },
  {
    expect: ["capturePending"],
    at: ["capturePending:2"],
    why:
      "A SLASH IN REGEX POSITION THAT NEVER CLOSES ON ITS LINE. The branch is " +
      "bounded to one line exactly as the quote branch is, and for the same " +
      "reason: an unbounded search runs to the next slash ANYWHERE, which is " +
      "why line 3 carries one. THE FIRST VERSION OF THIS CASE HAD ONLY THE " +
      "FIRST TWO LINES AND PROVED NOTHING — with no later slash to close on, " +
      "the unbounded scanner gives up in the same place the bounded one does " +
      "and the case stayed green with the bound deleted. That is the apostrophe " +
      "case's lesson exactly, arrived at again by breaking this one on purpose",
    src: [
      "const re = /oops no closing",
      "const capturePending = 1;",
      "const re2 = /fine/;",
    ].join("\n"),
  },
  {
    expect: ["capturePanelEsc"],
    at: ["capturePanelEsc:2"],
    why:
      "AN ESCAPED BACKTICK INSIDE A TEMPLATE. The template branch steps over " +
      "`\\\\x` as one unit; without that step the escaped backtick closes the " +
      "template early, ` room ` is read as code and accused, and the NEXT " +
      "backtick opens a fresh template that swallows line 2. So the break shows " +
      "as an extra name and a missing one together. Four files in this package " +
      "contain `\\\\``  or `\\\\${`, and this was the sibling of the string " +
      "escape skip that had a case while it had none",
    src: ["const t = `a \\` room b`;", "const capturePanelEsc = 1;"].join("\n"),
  },
  {
    expect: ["captureRaw"],
    why:
      "AN ESCAPED `${` INSIDE A TEMPLATE — the other half of the same skip, and " +
      "it fails the opposite way round. `\\\\${` is literal text, not an " +
      "interpolation; without the escape step the scanner opens one and reads " +
      "`roomName` inside it as the code it is not, accusing a name that only " +
      "exists as prose in a template",
    src: "const t = `literal \\${roomName} stays prose`; const captureRaw = 1;",
  },
  {
    expect: ["captureTotal"],
    why:
      "A SINGLE-QUOTED STRING. The string branch asserts it handles both quote " +
      "characters and every case used `\"`, so dropping `'` support was green — " +
      "half an asserted mechanism with nothing on it. It fails loudly rather " +
      "than quietly, `room` being read as code, which is the reason the " +
      "exact-set assertion catches it",
    src: "const s = 'leave this room'; const captureTotal = 1;",
  },
  {
    expect: ["layer2Room"],
    why:
      "A DIGIT RUNNING INTO A CAPITAL. `words()` splits on `([a-z0-9])([A-Z])` " +
      "and every case exercised the letter half, so the `0-9` could be deleted " +
      "with all of them green. Backend names carry version and layer numbers — " +
      "`layer2Room`, `v2Capture` — and without the digit the whole name reads " +
      "as one word `layer2room`, which matches nothing at all",
    src: "const layer2Room = 1;",
  },
  {
    expect: ["HANDLE_PATTERN"],
    file: "src/routes/public-handles.ts",
    why:
      "THE ALLOWED NAME IN A FILE OF THE SAME BASENAME, in a different " +
      "directory. The pair below proves scoping bites across obviously " +
      "different paths; this proves the comparison is the whole path and not " +
      "the file's name. `src/lib/public-handles.ts` holds the exemption and " +
      "`src/routes/public-handles.ts` must not inherit it — the failure " +
      "direction of a basename comparison is a silent extra hole, which is the " +
      "direction that never announces itself",
    src: "const HANDLE_PATTERN = /^[A-Za-z0-9_-]{3,24}$/;",
  },
  {
    expect: ["capturePend"],
    at: ["capturePend:2"],
    why:
      "AN UNCLOSED APOSTROPHE IN CODE POSITION — the string branch's line " +
      "bound, which until this case existed was proven by nothing. THE TWO " +
      "`/it's/` CASES USED TO COVER IT AND NO LONGER DO: adding the regex " +
      "branch means their apostrophes are masked as pattern text before they " +
      "ever reach the quote branch, so those cases now prove the regex branch " +
      "instead, and deleting the bound went green. A fix that quietly moves " +
      "what a case is testing is the most expensive kind, because the case " +
      "still passes and still reads as if it covers the old thing. Two " +
      "apostrophes with a name between them, because one closes on nothing",
    src: [
      "const s = don't;",
      "const capturePend = 1;",
      "const s2 = won't;",
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
    at: ["roomLabel:2"],
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
  {
    expect: ["samePatternRoom"],
    file: "src/queue/gemini.ts",
    why: "A NAME THAT MERELY STARTS WITH AN ALLOWED ONE IS NOT THE ALLOWED ONE. The lookup is an exact map today; widening it to `find((e) => name.startsWith(e.name))` is a one-line edit that reads like a convenience and hands `samePattern`'s exemption to everything built on top of it, in the file where that exemption lives",
    src: "const samePatternRoom = 1;",
  },
  {
    expect: ["HANDLE_PATTERN"],
    file: "src/lib/public-handles.probe.ts",
    why: "AND A FILE THAT MERELY STARTS WITH AN ALLOWED ONE'S PATH IS NOT THAT FILE. The name half of the scoping had this pair and the path half did not: `files.includes(file)` widened to a stem comparison — `files.some((f) => file.startsWith(f.replace(/\\.ts$/, \"\")))`, which is what anyone would write to let an entry cover the `.test.ts` beside it — was green in every case, and `public-handles.probe.ts` inherited HANDLE_PATTERN's exemption. The case above only proves a DIFFERENT directory is not covered, which that edit gets right",
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
 *
 * `.mts` and `.cts` are here because the two rules DID disagree about them, on
 * the shipped gate, with nothing red anywhere: this function matched `/\.ts$/`
 * and the coverage walk matched `/\.tsx?$/`, so such a file was neither read
 * nor missed. A `src/*.mts` holding two retired words printed `clean`. The pair
 * of extensions is now written down on both sides, and `.mjs` stays here as the
 * negative half — the family this gate reads is TypeScript's, and the line
 * between them is the case rather than a comment.
 */
const CLASSIFY_SELFTEST = [
  ["signals.ts", "scan"],
  ["sst-env.d.ts", "scan"],
  ["signals.mts", "scan"],
  ["legacy.cts", "scan"],
  ["Home.tsx", "refuse"],
  ["check-vocabulary.mjs", "ignore"],
  ["0000_three_layers.sql", "ignore"],
  ["notes.txt", "ignore"],
];

/**
 * A MADE-UP PACKAGE, for the traversals to be run against.
 *
 * Every case below needs a tree with a shape the real package has — nested
 * directories, several roots, files of each kind, a directory that must be
 * skipped — and needs it to be a tree nobody is going to reorganise. Reading
 * the real filesystem instead is what left discovery untested: an assertion
 * about `packages/api` proves the package is clean today and cannot say a word
 * about whether the walk still walks, because a walk that returns nothing and a
 * package with nothing wrong in it produce the same green line.
 */
const FAKE_TREE = {
  "/pkg": [
    { name: "src", isDirectory: true },
    { name: "test", isDirectory: true },
    { name: "node_modules", isDirectory: true },
    { name: "vitest.unit.config.ts", isDirectory: false },
    { name: "package.json", isDirectory: false },
  ],
  "/pkg/src": [
    { name: "routes", isDirectory: true },
    { name: "signals.ts", isDirectory: false },
    { name: "notes.md", isDirectory: false },
  ],
  "/pkg/src/routes": [
    { name: "groups.ts", isDirectory: false },
    { name: "groups.test.ts", isDirectory: false },
  ],
  "/pkg/test": [{ name: "helpers.ts", isDirectory: false }],
  "/pkg/node_modules": [{ name: "someone-else.ts", isDirectory: false }],
};
const fakeListing = (dir) => FAKE_TREE[dir] ?? [];

/**
 * FILE DISCOVERY, WHICH DECIDES WHAT IS EVER JUDGED.
 *
 * The self-test above proves the scanner reads a snippet correctly. Nothing
 * proved the loop that chooses which files become snippets, and that is the
 * half that has failed in this project — `scripts/` was simply never named, and
 * the gate shipped green over a violation of its own list sitting in its own
 * directory.
 *
 * Each case is a mutation someone could plausibly make. Visiting only the first
 * root, or losing the recursion, or narrowing the extension test, does not
 * throw and does not print anything: it returns a shorter list, and a shorter
 * list looks exactly like a cleaner package.
 */
const DISCOVERY_SELFTEST = [
  {
    why: "EVERY ROOT, not just the first — `roots[0]` instead of the loop is one character and drops `test/` entirely",
    roots: ["/pkg/src", "/pkg/test"],
    loose: "/pkg",
    expectScan: [
      "/pkg/src/routes/groups.test.ts",
      "/pkg/src/routes/groups.ts",
      "/pkg/src/signals.ts",
      "/pkg/test/helpers.ts",
      "/pkg/vitest.unit.config.ts",
    ],
    expectRefuse: [],
  },
  {
    why: "NESTED DIRECTORIES — without the recursion `src/routes` is invisible, which in the real package is most of the routes",
    roots: ["/pkg/src"],
    loose: "/pkg",
    expectScan: [
      "/pkg/src/routes/groups.test.ts",
      "/pkg/src/routes/groups.ts",
      "/pkg/src/signals.ts",
      "/pkg/vitest.unit.config.ts",
    ],
    expectRefuse: [],
  },
  {
    why: "THE LOOSE-FILE PASS DOES NOT DESCEND. The package root's subdirectories are roots already or NOT_OURS, so a descent here would scan node_modules — and `someone-else.ts` proves it does not",
    roots: [],
    loose: "/pkg",
    expectScan: ["/pkg/vitest.unit.config.ts"],
    expectRefuse: [],
  },
  {
    why: "A `.tsx` IS REFUSED RATHER THAN SKIPPED, wherever it is found. Returned instead of exited on, so the branch this package cannot exercise is still a case rather than a hope",
    roots: ["/pkg/src"],
    loose: "/pkg",
    tree: {
      "/pkg": [{ name: "vitest.unit.config.ts", isDirectory: false }],
      "/pkg/src": [
        { name: "signals.ts", isDirectory: false },
        { name: "Probe.tsx", isDirectory: false },
      ],
    },
    expectScan: ["/pkg/src/signals.ts", "/pkg/vitest.unit.config.ts"],
    expectRefuse: ["/pkg/src/Probe.tsx"],
  },
  {
    why: "A `.mts` REACHES THE SCAN LIST, and a `.mjs` beside it does not. The walk and `classify` have to agree about the TypeScript family in the same direction: narrow this side and the file is silently unread, narrow the coverage side and it is unread AND unmissed, which is how a `src/*.mts` with two retired words in it printed `clean`",
    roots: ["/pkg/src"],
    loose: "/pkg",
    tree: {
      "/pkg": [{ name: "vitest.unit.config.ts", isDirectory: false }],
      "/pkg/src": [
        { name: "signals.ts", isDirectory: false },
        { name: "queue.mts", isDirectory: false },
        { name: "legacy.cts", isDirectory: false },
        { name: "build-step.mjs", isDirectory: false },
      ],
    },
    expectScan: [
      "/pkg/src/legacy.cts",
      "/pkg/src/queue.mts",
      "/pkg/src/signals.ts",
      "/pkg/vitest.unit.config.ts",
    ],
    expectRefuse: [],
  },
];

/**
 * THE COVERAGE CHECK ITSELF, which is the guard on the guard.
 *
 * ROOTS is hand-maintained, so the coverage walk exists to catch a root nobody
 * updated. But the walk was hand-written and unchecked, which only moved the
 * problem: three single edits to it ran fully green — matching `.tsx` only,
 * dropping the recursion, or excluding a directory. The compound is the one
 * that stings: narrow the extension AND drop `test` from ROOTS and the whole
 * test directory goes unscanned with every check in this file passing.
 *
 * It must find `.tsx` as well as `.ts`. The scan REFUSES a `.tsx` while this
 * walk must still SEE it, so that a `.tsx` nobody scanned is caught here even
 * if the refusal above is ever softened — the second, independent way to bite.
 */
const COVERAGE_SELFTEST = [
  {
    why: "`.ts` AND `.tsx`, nested, from the package root down — the file list the scan is measured against",
    dir: "/pkg",
    notOurs: new Set(["node_modules"]),
    expect: [
      "/pkg/src/routes/groups.test.ts",
      "/pkg/src/routes/groups.ts",
      "/pkg/src/signals.ts",
      "/pkg/test/helpers.ts",
      "/pkg/vitest.unit.config.ts",
    ],
  },
  {
    why: "A `.tsx` IS FOUND HERE even though the scan refuses it — the two rules must disagree, or an unscanned .tsx is invisible to both",
    dir: "/pkg/src",
    notOurs: new Set(),
    tree: {
      "/pkg/src": [
        { name: "signals.ts", isDirectory: false },
        { name: "Probe.tsx", isDirectory: false },
      ],
    },
    expect: ["/pkg/src/Probe.tsx", "/pkg/src/signals.ts"],
  },
  {
    why: "NOT_OURS SKIPS, and skips the directory rather than the file — `someone-else.ts` under node_modules must not appear",
    dir: "/pkg",
    notOurs: new Set(["node_modules", "test"]),
    expect: [
      "/pkg/src/routes/groups.test.ts",
      "/pkg/src/routes/groups.ts",
      "/pkg/src/signals.ts",
      "/pkg/vitest.unit.config.ts",
    ],
  },
  {
    why: "`.mts` AND `.cts` ARE FOUND. They are TypeScript, and until this case both rules missed them from opposite sides — the scan matched `.ts` and this walk matched `.tsx?`, so such a file was neither read nor reported unread, which is the one state this check exists to make impossible. `.mjs` in the same directory must still be skipped, or the two halves of the rule have stopped agreeing about what TypeScript is",
    dir: "/pkg/src",
    notOurs: new Set(),
    tree: {
      "/pkg/src": [
        { name: "signals.ts", isDirectory: false },
        { name: "queue.mts", isDirectory: false },
        { name: "legacy.cts", isDirectory: false },
        { name: "build-step.mjs", isDirectory: false },
      ],
    },
    expect: ["/pkg/src/legacy.cts", "/pkg/src/queue.mts", "/pkg/src/signals.ts"],
  },
];

/**
 * A ROOT MAY NOT BE EXCLUDED — the data mutation the check above cannot see.
 *
 * `everyTypeScriptFile` can be perfect and the coverage check still dead, if
 * NOT_OURS names a directory ROOTS points at: the walk stops finding the files,
 * so there is nothing left to notice missing.
 */
const ROOTS_SELFTEST = [
  {
    why: "the real shape — roots and exclusions naming different things",
    roots: ["/pkg/src", "/pkg/test"],
    notOurs: new Set(["node_modules", "dist"]),
    expect: [],
  },
  {
    why: "`src` EXCLUDED WHILE BEING A ROOT — green today, and the package's largest directory unlooked-at",
    roots: ["/pkg/src", "/pkg/test"],
    notOurs: new Set(["node_modules", "src"]),
    expect: ["src"],
  },
];

/**
 * AN EXCLUSION HAS TO BE JUSTIFIED FROM OUTSIDE THIS FILE.
 *
 * The check above only fires when ROOTS and NOT_OURS name the same directory.
 * The version of that mistake nobody would call a mistake keeps them in perfect
 * agreement — remove `test` from ROOTS and add `"test"` to NOT_OURS in the same
 * edit — and it is strictly worse than either half alone, because the coverage
 * walk skips exactly what the scan stopped reading. Twenty files leave the gate
 * with nothing anywhere saying so.
 *
 * These drive `ignoredDirectoryNames` and `unjustifiedExclusions` together, over
 * a made-up `.gitignore` and a made-up package, because what matters is the pair:
 * a parse that is too generous licenses an exclusion it should have refused.
 */
const EXCLUSION_SELFTEST = [
  {
    why: "the real shape — everything excluded that is actually here is something the repository already ignores",
    gitignore: "node_modules\n# build / cache\ndist\ncoverage\n",
    notOurs: ["node_modules", "dist", "coverage", ".turbo"],
    present: ["node_modules", "dist", "src", "test"],
    expect: [],
  },
  {
    why: "A SOURCE DIRECTORY EXCLUDED — dropping `test` from ROOTS and naming it here instead, which is the one edit that removes files from the scan and from the coverage check in the same breath",
    gitignore: "node_modules\ndist\n",
    notOurs: ["node_modules", "test"],
    present: ["node_modules", "src", "test"],
    expect: ["test"],
  },
  {
    why: "AN EXCLUSION FOR SOMETHING THAT IS NOT THERE hides nothing — `.turbo` is a cache this package has never had, and a rule that fired on it would be noise nobody could act on",
    gitignore: "node_modules\n",
    notOurs: ["node_modules", ".turbo"],
    present: ["node_modules"],
    expect: [],
  },
  {
    why: "A TRAILING SLASH IS STILL A NAME — `.gitignore` files write directories both ways and the two must not disagree",
    gitignore: "/node_modules/\ncoverage/\n",
    notOurs: ["node_modules", "coverage"],
    present: ["node_modules", "coverage"],
    expect: [],
  },
  {
    why: "A NEGATION IS NOT AN IGNORE — `!dist` says the opposite, and reading the name off the line without reading the `!` would license the exclusion it revokes",
    gitignore: "node_modules\n!dist\n",
    notOurs: ["node_modules", "dist"],
    present: ["node_modules", "dist"],
    expect: ["dist"],
  },
  {
    why: "A GLOB IS NOT A NAME. This check refuses what it cannot read literally, so its only possible mistake is asking for a justification that already exists — never accepting one that does not",
    gitignore: "di*\ntools/output/\n",
    notOurs: ["dist"],
    present: ["dist"],
    expect: ["dist"],
  },
];

/**
 * THE ALLOWLIST AS DATA, which nothing read for sense until now.
 *
 * These are the mutations that change a NUMBER the run prints rather than a
 * verdict, and the number is the one thing about this gate anyone tracks between
 * commits: how many holes there are and how many of them are supposed to close.
 */
const ALLOWLIST_SELFTEST = [
  {
    why: "the shape the list is supposed to have",
    entries: [
      { name: "a", files: ["src/a.ts"], disposition: "permanent" },
      { name: "b", files: ["src/b.ts"], disposition: "rename", to: "c" },
    ],
    expectProblems: 0,
    expectSplit: "1 rename / 1 permanent",
  },
  {
    why: "A ONE-CHARACTER TYPO — `permanant` — belongs to neither half. It moves an entry out of the rename column with nothing to announce it, and the printed count silently says one fewer hole is waiting to be closed",
    entries: [
      { name: "a", files: ["src/a.ts"], disposition: "permanant", to: "b" },
    ],
    expectProblems: 1,
    expectSplit: "0 rename / 0 permanent",
  },
  {
    why: "A RENAME WITH NO `to` is a permanent hole wearing a temporary label — the disposition promises the entry expires and the entry does not say into what",
    entries: [{ name: "a", files: ["src/a.ts"], disposition: "rename" }],
    expectProblems: 1,
    expectSplit: "1 rename / 0 permanent",
  },
  {
    why: "THE SAME PATH TWICE in one entry counts twice in the pair total, so the gate reports guarding more holes than the list actually has, and the duplicate can never be reported stale on its own",
    entries: [
      { name: "a", files: ["src/a.ts", "src/a.ts"], disposition: "permanent" },
    ],
    expectProblems: 1,
    expectSplit: "0 rename / 1 permanent",
  },
  {
    why: "AN ENTRY ALLOWED NOWHERE — an empty `files` is an exemption that grants nothing and can never expire, since it has no pair to go stale",
    entries: [{ name: "a", files: [], disposition: "permanent" }],
    expectProblems: 1,
    expectSplit: "0 rename / 1 permanent",
  },
];

/**
 * THE SCAN LOOP, which is three lines and was carried by nothing.
 *
 * `readSource` is handed in, so a corpus can be made of strings. The cases are
 * the mutations that produce a quieter run rather than an error: reading only
 * the first file, or labelling every hit with the same path.
 */
const SCAN_LOOP_SELFTEST = [
  {
    why: "EVERY FILE IS READ, and each violation carries the file it came from. A `break` after the first leaves the rest of the package reported clean",
    corpus: {
      "src/a.ts": "const roomOne = 1;",
      "src/b.ts": "const patternTwo = 2;",
      "src/c.ts": "const captureThree = 3;",
    },
    expect: ["src/a.ts:1 roomOne", "src/b.ts:1 patternTwo", "src/c.ts:1 captureThree"],
  },
  {
    why: "AN ALLOWANCE APPLIES IN ITS OWN FILE AND NOWHERE ELSE, decided per file inside the loop — this is the scoping the whole allowlist design rests on, exercised through the loop rather than a single snippet",
    corpus: {
      "src/lib/public-handles.ts": "const HANDLE_PATTERN = 1;",
      "src/routes/elsewhere.ts": "const HANDLE_PATTERN = 2;",
    },
    expect: ["src/routes/elsewhere.ts:1 HANDLE_PATTERN"],
  },
  {
    why: "A FILE THE MASKER LOST TRACK OF IS REPORTED WITH THE LINE IT LOST TRACK ON, so the blind region has a name and an address rather than being a silent clean verdict",
    corpus: {
      "src/ok.ts": "const t = `fine`;\nconst roomOk = 1;",
      "src/torn.ts": "const t = `never closed;\nconst roomTorn = 2;",
    },
    expect: ["src/ok.ts:2 roomOk"],
    expectBlind: ["src/torn.ts:1"],
  },
  {
    why: "EVERY blind file, not the first one. `if (blindFromLine !== -1 && blind.length === 0)` reads like a guard against a noisy report and means the second and later blind regions are never mentioned — the same masking bug in two files gets half a verdict",
    corpus: {
      "src/torn-a.ts": "const a = `never closed;",
      "src/torn-b.ts": "const b = `also never closed;",
    },
    expect: [],
    expectBlind: ["src/torn-a.ts:1", "src/torn-b.ts:1"],
  },
  {
    why: "WHICH PATHS ACTUALLY REACHED THE SCANNER, reported rather than assumed. Filtering the argument, or a `try/catch` around this loop, removes files from the scan while leaving the discovery the coverage check measures untouched",
    corpus: {
      "src/a.ts": "const roomOne = 1;",
      "src/b.ts": "const fine = 2;",
    },
    expect: ["src/a.ts:1 roomOne"],
    expectRead: ["src/a.ts", "src/b.ts"],
  },
  {
    why: "A FILE THAT YIELDED NO IDENTIFIER AT ALL is a finding, not a clean file. It is what a `readSource` that returns `\"\"` for a directory looks like, and what a `scanSource` that early-returns for one looks like — both of which leave the path in the list of files read",
    corpus: {
      "src/real.ts": "const roomHere = 1;",
      "src/empty.ts": "",
      "src/note.ts": "// nothing here but a sentence about a room\n",
    },
    expect: ["src/real.ts:1 roomHere"],
    expectSilent: ["src/empty.ts", "src/note.ts"],
  },
];

/**
 * THE REPORT, which no clean run can reach.
 *
 * Everything below the `violations.length === 0` branch is dead code on a green
 * tree, so grouping, counting and first-occurrence had no coverage of any kind
 * — the previous review reasonably called those mutations unreachable, which is
 * true of the RUN and is exactly why they belong here instead.
 *
 * `first at` is the part a person acts on. A mutation that keeps the last
 * occurrence rather than the first still exits 1 and still names the right
 * identifier; it just sends the reader to the wrong line of the wrong file.
 */
const REPORT_SELFTEST = [
  {
    why: "ONE ROW PER NAME, counted across files, pointing at the FIRST occurrence",
    violations: [
      { name: "roomId", word: "room", use: "group", file: "src/a.ts", line: 12 },
      { name: "roomId", word: "room", use: "group", file: "src/b.ts", line: 3 },
      { name: "roomId", word: "room", use: "group", file: "src/c.ts", line: 9 },
    ],
    expect: ["roomId 3x src/a.ts:12"],
  },
  {
    why: "WORST FIRST — forty uses of one name is one decision and belongs at the top, above a name used once",
    violations: [
      { name: "lensBoard", word: "lens", use: "nothing", file: "src/a.ts", line: 1 },
      { name: "roomId", word: "room", use: "group", file: "src/b.ts", line: 2 },
      { name: "roomId", word: "room", use: "group", file: "src/c.ts", line: 4 },
    ],
    expect: ["roomId 2x src/b.ts:2", "lensBoard 1x src/a.ts:1"],
  },
];

/**
 * EVERY SUITE, WITH THE SIZE IT MAY NOT SHRINK BELOW.
 *
 * The summary line says how many cases ran, and until now that number was
 * printed rather than checked: `SELFTEST` could be cut to three cases, or to
 * none, and the run would still say `self-test passed` — a smaller true number,
 * which is the one kind of lie a reader has no way to notice. Proof is not
 * supposed to get smaller, so the floor is written down beside each suite and a
 * suite below its floor is a failure.
 *
 * It is a ratchet, and it is meant to be raised: add cases, raise the floor in
 * the same commit. Lowering one is allowed too — deleting a case that has stopped
 * testing what it says it tests is a real thing that happens here — but it takes
 * an edit on this line, which is exactly the moment to say why in the message.
 */
const SUITES = [
  { label: "scanner", cases: SELFTEST, floor: 46 },
  { label: "expiry", cases: EXPIRY_SELFTEST, floor: 4 },
  { label: "file-kind", cases: CLASSIFY_SELFTEST, floor: 8 },
  { label: "discovery", cases: DISCOVERY_SELFTEST, floor: 5 },
  { label: "coverage", cases: COVERAGE_SELFTEST, floor: 4 },
  { label: "root/exclusion", cases: ROOTS_SELFTEST, floor: 2 },
  { label: "exclusion/ignore", cases: EXCLUSION_SELFTEST, floor: 6 },
  { label: "allowlist", cases: ALLOWLIST_SELFTEST, floor: 5 },
  { label: "scan-loop", cases: SCAN_LOOP_SELFTEST, floor: 6 },
  { label: "report", cases: REPORT_SELFTEST, floor: 2 },
];

function selftest() {
  const failures = [];

  for (const suite of SUITES) {
    if (suite.cases.length < suite.floor) {
      failures.push(
        `  the ${suite.label} suite has shrunk to ${suite.cases.length} case(s) from ${suite.floor}.\n` +
          `      A gate's proof is not supposed to get smaller. If a case was\n` +
          `      genuinely testing nothing, delete it AND lower the floor, so the\n` +
          `      commit says so out loud.\n`,
      );
    }
  }

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
    /*
     * "Every multi-line case carries `at`" was a sentence in two comments here,
     * and it was false — one case of thirty had no `at`. A claim about the
     * cases is as checkable as the cases themselves, so it is checked instead
     * of asserted, and the next case written without one says so.
     */
    if (c.src.includes("\n") && !c.at) {
      failures.push(
        `  ${c.why}\n` +
          `      ${c.src.replace(/\n/g, "\n      ")}\n` +
          `      a multi-line case with no \`at\` — its line numbers are unasserted,\n` +
          `      which is the half of the report a person actually acts on\n`,
      );
      continue;
    }
    const hits = scanSource(c.src, c.file ?? "<self-test>").found;
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
    const unused = got.stale.length > 0 ? [...got.stale[0].unused].sort() : [];
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
    if (got.checked !== c.entry.files.length) {
      failures.push(
        `  ${c.why}\n` +
          `      the expiry check looked at ${got.checked} (name, file) pair(s),\n` +
          `      but the entry has ${c.entry.files.length} — a pair it never looks at is a\n` +
          `      hole it can never call stale\n`,
      );
    }
  }

  for (const c of DISCOVERY_SELFTEST) {
    const listing = c.tree ? (d) => c.tree[d] ?? [] : fakeListing;
    const got = filesToScan(c.roots, c.loose, listing);
    for (const [half, want] of [
      ["scan", c.expectScan],
      ["refuse", c.expectRefuse],
    ]) {
      const mine = [...got[half]].sort();
      const theirs = [...want].sort();
      if (
        mine.length !== theirs.length ||
        !mine.every((f, k) => f === theirs[k])
      ) {
        failures.push(
          `  file discovery — ${c.why}\n` +
            `      roots: ${c.roots.join(", ") || "(none)"}, loose: ${c.loose}\n` +
            `      expected to ${half}: ${theirs.join(", ") || "(nothing)"}\n` +
            `      actually ${half}:    ${mine.join(", ") || "(nothing)"}\n`,
        );
      }
    }
  }

  for (const c of COVERAGE_SELFTEST) {
    const listing = c.tree ? (d) => c.tree[d] ?? [] : fakeListing;
    const got = everyTypeScriptFile(c.dir, listing, c.notOurs).sort();
    const want = [...c.expect].sort();
    if (got.length !== want.length || !got.every((f, k) => f === want[k])) {
      failures.push(
        `  the coverage check — ${c.why}\n` +
          `      under ${c.dir}, skipping ${[...c.notOurs].join(", ") || "(nothing)"}\n` +
          `      expected: ${want.join(", ") || "(nothing)"}\n` +
          `      found:    ${got.join(", ") || "(nothing)"}\n`,
      );
    }
  }

  for (const c of ROOTS_SELFTEST) {
    const got = rootsAlsoExcluded(c.roots, c.notOurs).sort();
    const want = [...c.expect].sort();
    if (got.length !== want.length || !got.every((n, k) => n === want[k])) {
      failures.push(
        `  a root that is also excluded — ${c.why}\n` +
          `      expected: ${want.join(", ") || "(nothing)"}\n` +
          `      found:    ${got.join(", ") || "(nothing)"}\n`,
      );
    }
  }

  for (const c of EXCLUSION_SELFTEST) {
    const present = new Set(c.present);
    const got = unjustifiedExclusions(
      c.notOurs,
      ignoredDirectoryNames(c.gitignore),
      (name) => present.has(name),
    ).sort();
    const want = [...c.expect].sort();
    if (got.length !== want.length || !got.every((n, k) => n === want[k])) {
      failures.push(
        `  an exclusion the repository does not back up — ${c.why}\n` +
          `      .gitignore: ${JSON.stringify(c.gitignore)}\n` +
          `      excluded:   ${c.notOurs.join(", ")}\n` +
          `      expected:   ${want.join(", ") || "(nothing)"}\n` +
          `      found:      ${got.join(", ") || "(nothing)"}\n`,
      );
    }
  }

  for (const c of ALLOWLIST_SELFTEST) {
    const problems = allowlistProblems(c.entries);
    if (problems.length !== c.expectProblems) {
      failures.push(
        `  the allowlist's own shape — ${c.why}\n` +
          `      expected ${c.expectProblems} problem(s), found ${problems.length}\n` +
          `      ${problems.join("\n      ") || "(nothing)"}\n`,
      );
    }
    const split = dispositionSplit(c.entries);
    const got = `${split.rename.length} rename / ${split.permanent.length} permanent`;
    if (got !== c.expectSplit) {
      failures.push(
        `  the allowlist's two halves — ${c.why}\n` +
          `      expected: ${c.expectSplit}\n` +
          `      counted:  ${got}\n`,
      );
    }
  }

  for (const c of SCAN_LOOP_SELFTEST) {
    const { violations, blind, read, silent } = scanFiles(
      Object.keys(c.corpus),
      (f) => c.corpus[f],
      new Set(),
    );
    const got = violations.map((v) => `${v.file}:${v.line} ${v.name}`).sort();
    const want = [...c.expect].sort();
    if (got.length !== want.length || !got.every((v, k) => v === want[k])) {
      failures.push(
        `  the scan loop — ${c.why}\n` +
          `      over ${Object.keys(c.corpus).join(", ")}\n` +
          `      expected: ${want.join(", ") || "(nothing)"}\n` +
          `      reported: ${got.join(", ") || "(nothing)"}\n`,
      );
    }
    const gotBlind = blind.map((b) => `${b.file}:${b.line}`).sort();
    const wantBlind = [...(c.expectBlind ?? [])].sort();
    if (
      gotBlind.length !== wantBlind.length ||
      !gotBlind.every((b, k) => b === wantBlind[k])
    ) {
      failures.push(
        `  the scan loop — ${c.why}\n` +
          `      expected blind regions: ${wantBlind.join(", ") || "(none)"}\n` +
          `      reported:               ${gotBlind.join(", ") || "(none)"}\n`,
      );
    }
    /*
     * `read` is asserted for every case rather than only the one that names it,
     * because "which files reached the scanner" is the claim the run's coverage
     * check now rests on, and a claim used everywhere should be checked
     * everywhere. `expectRead` defaults to the whole corpus for the same reason.
     */
    const gotRead = [...read].sort();
    const wantRead = [...(c.expectRead ?? Object.keys(c.corpus))].sort();
    if (
      gotRead.length !== wantRead.length ||
      !gotRead.every((f, k) => f === wantRead[k])
    ) {
      failures.push(
        `  the scan loop — ${c.why}\n` +
          `      expected to read: ${wantRead.join(", ") || "(nothing)"}\n` +
          `      actually read:    ${gotRead.join(", ") || "(nothing)"}\n`,
      );
    }
    const gotSilent = [...silent].sort();
    const wantSilent = [...(c.expectSilent ?? [])].sort();
    if (
      gotSilent.length !== wantSilent.length ||
      !gotSilent.every((f, k) => f === wantSilent[k])
    ) {
      failures.push(
        `  the scan loop — ${c.why}\n` +
          `      expected to yield no identifier: ${wantSilent.join(", ") || "(nothing)"}\n` +
          `      actually yielded none:           ${gotSilent.join(", ") || "(nothing)"}\n`,
      );
    }
  }

  for (const c of REPORT_SELFTEST) {
    const got = groupViolations(c.violations).map(
      (v) => `${v.name} ${v.count}x ${v.file}:${v.line}`,
    );
    if (
      got.length !== c.expect.length ||
      !got.every((r, k) => r === c.expect[k])
    ) {
      failures.push(
        `  the report — ${c.why}\n` +
          `      expected: ${c.expect.join(" | ")}\n` +
          `      produced: ${got.join(" | ") || "(nothing)"}\n`,
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
  /*
   * THIS LINE IS NOW CHECKED FROM OUTSIDE, and the story of how is the useful
   * part of the comment.
   *
   * It used to say: the counts come from SUITES so they track the arrays, but
   * nothing outside this process reads them, and replacing the whole expression
   * with a string literal is green everywhere — which was true, and was written
   * down as a limitation with a fix beside it: move SUITES and every case array
   * into a module both this script and the test import. That fix was described
   * as several hundred lines of case data moving, and that description was
   * simply wrong. Nothing has to move. `test/vocabulary-gate.test.ts` already
   * runs MUTATED COPIES of this file; a copy with one case pushed onto SELFTEST
   * must print a scanner count one higher and everything else identical, and a
   * copy truncated to the floor must print exactly the floor. Twelve lines,
   * using machinery that already existed.
   *
   * So the numbers are held down now: `counts the cases it prints, and prints
   * the ones it counted` in that file goes red on the string-literal mutation,
   * on a summary that is derived but offset, and on one whose labels all report
   * the same array. The floors above remain the check that matters — they fail
   * first if a suite has actually shrunk — and this line is no longer a number
   * that only its author can vouch for.
   */
  console.log(
    `vocabulary (api): self-test passed (` +
      SUITES.map((s) => `${s.cases.length} ${s.label}`).join(", ") +
      `)`,
  );
}

selftest();

/*
 * THE LIST ITSELF, BEFORE ANY FILE IS OPENED. These are defects in the data
 * rather than in the package, and every one of them changes what the run prints
 * about how many holes this gate is carrying.
 */
const listProblems = allowlistProblems(ALLOWED);
const split = dispositionSplit(ALLOWED);
/*
 * A SECOND NET NO SINGLE MUTATION CAN REACH, and that is said here rather than
 * left for the next reviewer to discover. Everything that could put an entry in
 * neither column — a mistyped `disposition`, a filter looking for the wrong
 * literal — is caught upstream by the entry check above or by the five allowlist
 * cases in the self-test, and it was tried: disabling the entry check's
 * disposition branch and mistyping an entry together still dies in the self-test
 * before the run begins. So no case below can drive this branch, and it is kept
 * anyway, deliberately, because it is what makes the two numbers on the clean
 * line total by construction rather than by three other things being right. It
 * is redundancy, it is one line, and the alternative is an arithmetic nobody
 * ever states.
 */
if (split.rename.length + split.permanent.length !== ALLOWED.length) {
  listProblems.push(
    `the two halves account for ${split.rename.length + split.permanent.length} ` +
      `of ${ALLOWED.length} entries — the rest are in neither column and are ` +
      `counted in neither number`,
  );
}
if (listProblems.length > 0) {
  console.error(
    `\nvocabulary (api): ALLOWED does not have the shape the rest of this file\n` +
      `reads it as. Each entry is a hole in this gate, and the count of holes —\n` +
      `how many are permanent, how many are waiting on a rename — is the one\n` +
      `number anyone tracks between commits. An entry in neither column is a hole\n` +
      `nobody is counting.\n`,
  );
  for (const problem of listProblems) console.error(`  ${problem}`);
  console.error("");
  process.exit(1);
}

/*
 * A ROOT THAT IS ALSO EXCLUDED, checked before anything is read, because it
 * disables the coverage check below rather than tripping it.
 */
const excludedRoots = rootsAlsoExcluded(ROOTS, NOT_OURS);
if (excludedRoots.length > 0) {
  console.error(
    `\nvocabulary (api): ${excludedRoots.join(", ")} is named in both ROOTS and\n` +
      `NOT_OURS. The coverage check finds every TypeScript file under the package\n` +
      `and asserts the scan read it; a directory in NOT_OURS is not found, so it\n` +
      `cannot be missed either. That combination is a scan with its own guard\n` +
      `switched off, and it looks exactly like a clean run.\n`,
  );
  process.exit(1);
}

/*
 * AND AN EXCLUSION THE REPOSITORY DOES NOT BACK UP, which is the same mistake
 * made coherently: the guard above only sees ROOTS and NOT_OURS naming the same
 * directory, and the edit that actually happens keeps them in agreement — the
 * root is DROPPED as the exclusion is added. Nothing in this file can tell that
 * apart from a directory that genuinely is not ours, so the answer comes from
 * `.gitignore`, which is where this repository already records what is generated
 * or vendored and which nobody can edit in this direction without git losing
 * track of real files.
 */
const ignoreRules = (() => {
  const names = new Set();
  let files = 0;
  let dir = PKG;
  for (;;) {
    try {
      for (const name of ignoredDirectoryNames(
        readFileSync(join(dir, ".gitignore"), "utf8"),
      )) {
        names.add(name);
      }
      files += 1;
    } catch {
      /* no .gitignore at this level, which is not a fact about anything */
    }
    /* Stop at the repository root — `.git` is a directory in a clone and a file
       in a worktree, so its mere existence is the test. */
    const parent = dirname(dir);
    if (existsSync(join(dir, ".git")) || parent === dir) return { names, files };
    dir = parent;
  }
})();

/*
 * THE ONE WAY THIS CHECK FALLS SILENT, said here rather than discovered later:
 * a tree with no `.gitignore` anywhere above this package — an export, a tarball,
 * a container that copied `packages/` without the repository — has no record to
 * consult, and a check with no evidence should decline rather than accuse. The
 * cost is that in such a tree NOT_OURS goes unexamined; the alternative is a red
 * run on a legitimate checkout, which is worse, because the first thing anyone
 * does with a gate that cries wolf is switch it off. The mutation that turns
 * this into a hiding place — making the search find nothing — is held down by
 * the process test, which runs the whole thing against this repository, where
 * `.gitignore` is right there.
 *
 * ONE EDIT NEARBY IS NOT HELD, and it is written down rather than left to be
 * found: widening this condition to `ignoreRules.names.size === 0 || …` — decline
 * when the ignore file mentioned no directories, as well as when there was no
 * ignore file — is green in the self-test, the process test and the package. It
 * is unheld because nothing here can produce the tree that separates the two: a
 * package with a `.gitignore` that names nothing. Every tree the gate actually
 * runs on has one that names plenty, which is exactly why the widening hides
 * nothing there, and it is also why closing it would mean a case that depends on
 * what `.gitignore` files exist ABOVE a temporary directory — a case whose
 * verdict is a property of the machine it runs on. That is worse proof than this
 * sentence.
 */
const unjustified =
  ignoreRules.files === 0
    ? []
    : unjustifiedExclusions(NOT_OURS, ignoreRules.names, (name) =>
        existsSync(join(PKG, name)),
      );
if (unjustified.length > 0) {
  console.error(
    `\nvocabulary (api): NOT_OURS excludes ${unjustified.join(", ")}, which is in\n` +
      `this package and which no .gitignore between here and the repository root\n` +
      `mentions. NOT_OURS is for code this package does not own — vendored or\n` +
      `generated — and the repository's own ignore rules are the record of which\n` +
      `directories those are.\n\n` +
      `Excluding a directory the repository tracks removes it from the coverage\n` +
      `check as well as from the scan, so its files stop being read AND stop being\n` +
      `missed. That is the one edit that can drop a source root and leave every\n` +
      `other check in this file green.\n\n` +
      `If it really is generated, ignore it in .gitignore first. If it is ours,\n` +
      `it belongs in ROOTS.\n`,
  );
  process.exit(1);
}

const discovered = filesToScan(ROOTS, LOOSE_FILE_DIR, realListing);

if (discovered.refuse.length > 0) {
  for (const full of discovered.refuse) {
    console.error(
      `\nvocabulary gate: ${relative(PKG, full)} is a .tsx file.\n` +
        `This scanner reads TypeScript without JSX — it cannot tell tag text\n` +
        `from code, and would accuse the words a person reads on screen.\n` +
        `Either keep JSX out of packages/api, or teach this scanner the JSX\n` +
        `masking pass that packages/web/scripts/check-vocabulary.mjs carries.\n`,
    );
  }
  process.exit(1);
}

const scanned = new Set(discovered.scan);

const vanished = new Set();
const { violations, blind, read, silent } = scanFiles(
  [...scanned].map((f) => relative(PKG, f)),
  whileListed((rel) => readFileSync(join(PKG, rel), "utf8"), vanished),
  allowancesUsed,
);

/*
 * A FILE THE MASKER LOST TRACK OF, which is the failure this gate has actually
 * had rather than the one it was written for.
 *
 * Every literal in a file that compiles is closed. So if the masker reaches the
 * end of a file still inside a string or a template, the mistake is this
 * scanner's, and everything from that point on was blanked without being read.
 * There is no output to distinguish that from a clean file — that is the whole
 * problem, twice over now. The apostrophe blinded the web gate over half of
 * Home.tsx for a week; a regex holding three backticks blinded this one over 87
 * lines of `src/lib/generation-doc.test.ts`, and the run printed `clean` both
 * times. A planted `capturedRoomProbe` was invisible at line 185 and caught at
 * line 100 of the same file.
 *
 * This check does not know what the next unhandled delimiter will be, which is
 * exactly why it is worth having: it fires on the SHAPE of the failure — the
 * scan ran out of file while still expecting a closing mark — rather than on
 * any particular cause. It costs one integer.
 *
 * `> 0`, AND THE BOUNDARY IS ASSERTED RATHER THAN READ. This and the three
 * count-based exits below it were pinned by cases that plant exactly TWO of the
 * thing — which is what it takes to prove the printed COUNT is not the constant
 * 1, and is also precisely what cannot tell `> 0` from `> 1`. Changing this one
 * character was green in the gate, the self-test and the process test, and hid a
 * single torn file in the real package: the incident that produced this check
 * was ONE file, `src/lib/generation-doc.test.ts`. Each of the four now has a
 * one-of-the-thing case alongside its two-of-the-thing case, and the fix for the
 * count is what created the hole in the boundary — worth remembering the next
 * time a number is pinned by planting several.
 */
if (blind.length > 0) {
  console.error(
    `\nvocabulary (api): the scanner lost track inside ${blind.length} file(s) and\n` +
      `masked the rest of each without reading it. Every literal in a file that\n` +
      `compiles is closed, so this is a bug in scripts/check-vocabulary.mjs, not\n` +
      `in the files below — and the identifiers after these lines were NOT\n` +
      `checked. A blind scan and a clean one print the same word, which is why\n` +
      `this is a failure.\n`,
  );
  for (const b of blind) {
    console.error(`  ${b.file}:${b.line}  unterminated from here to end of file`);
  }
  console.error("");
  process.exit(1);
}

/*
 * DISCOVERED IS NOT READ, AND THE GAP BETWEEN THEM WAS GUARDED BY NOTHING.
 *
 * The coverage check below compares the filesystem against `scanned` — the list
 * the WALK produced. Everything after that point was taken on trust: four
 * separate one-line edits removed the whole `test/` directory from the judgement
 * with the walk, the coverage check, the self-test and the process test all
 * green — filtering the argument to `scanFiles`, returning `""` from
 * `readSource` for those paths, early-returning from `scanSource`, or wrapping
 * the loop body in a `try/catch` that continues. Every one of them is an edit
 * somebody could make believing it was a tidy-up.
 *
 * So the loop now says which paths reached it and the run compares that against
 * discovery — derived here a second time from `scanned` rather than reusing the
 * expression handed to `scanFiles`, because a filter applied to a shared
 * variable would otherwise shrink both sides at once. Narrowing `scanned` itself
 * is what the coverage walk below already catches.
 *
 * `> 0` is the boundary and it is asserted at one file as well as at several —
 * see the note on the blind check above for why that needed saying out loud.
 */
const shouldHaveRead = [...scanned].map((f) => relative(PKG, f)).filter((f) => !vanished.has(f));
const wasRead = new Set(read);
const neverRead = shouldHaveRead.filter((f) => !wasRead.has(f));
if (neverRead.length > 0) {
  console.error(
    `\nvocabulary (api): ${neverRead.length} file(s) were found by the walk and then\n` +
      `never reached the scanner. Discovery is not judgement — a file that is\n` +
      `listed and not read is reported exactly as a clean one is.\n`,
  );
  for (const f of neverRead) console.error(`  ${f}`);
  console.error("");
  process.exit(1);
}

/*
 * AND A FILE THAT WAS READ BUT HELD NOTHING TO READ. This is the same failure
 * arriving through the other door: the path reached the scanner and the scanner
 * saw no identifier at all. A `.ts` file in this package always has one, so the
 * honest possibilities are an empty file nobody deleted or a scan that was
 * handed nothing — and the second is what `readSource` returning `""` for a
 * directory looks like from here.
 *
 * `> 0` is the boundary and it is asserted at one file as well as at several,
 * with an empty file planted in the real package — the cheapest tree there is
 * for this check, and the one the two-file version could not distinguish from
 * `> 1`.
 */
if (silent.length > 0) {
  console.error(
    `\nvocabulary (api): ${silent.length} TypeScript file(s) yielded no identifier at\n` +
      `all. Either the file is empty and should be deleted, or the scanner was\n` +
      `handed nothing for it — and an unread file prints the same word a clean\n` +
      `one does, which is the failure this gate exists to make impossible.\n`,
  );
  for (const f of silent) console.error(`  ${f}`);
  console.error("");
  process.exit(1);
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
 * NOT_OURS, and asserts that every `.ts` file it finds is one the walk above
 * DISCOVERED. Dropping a root now fails; adding a directory of TypeScript
 * without deciding about it now fails. It is the same argument the ROOTS
 * comment makes, moved out of the comment and into an assertion.
 *
 * DISCOVERED, not read — and the difference is not pedantry. This sentence used
 * to say "actually read", and it was wrong: `scanned` comes from the walk, and
 * nothing here ever touched what `scanFiles` iterated or what `readSource`
 * returned. That half is now the two checks above, and it took four green
 * mutations to notice the claim was only a claim. The pair is what covers the
 * ground: this walk ties the filesystem to discovery, and those tie discovery to
 * the scanner.
 *
 * WHAT THIS CHECK STILL DOES NOT COVER, said out loud rather than left to be
 * discovered, and rewritten because the sentence that used to be here was
 * wrong in a way that mattered.
 *
 * It said `.mjs` and `.js`, as if the rule were "not JavaScript". The rule was
 * `/\.tsx?$/`, and `.mts` and `.cts` are outside it while being TypeScript —
 * neither scanned nor reported missing, which is exactly the combination this
 * check exists to make impossible. That was a live hole in the shipped gate,
 * not a mutation: two retired words in a `src/*.mts` ran clean. Both rules now
 * match `/\.[cm]?tsx?$/` and there is a case for it in the coverage suite and
 * another in `test/vocabulary-gate.test.ts` that plants a real `.mts`.
 *
 * What is genuinely left outside is JAVASCRIPT: `.js`, `.mjs`, `.cjs`. A
 * retired word in an identifier in such a file would not be seen and would not
 * be missed. Two things keep that from being worth closing today, and both are
 * facts rather than preferences. The package contains exactly two `.js`-family
 * files, `scripts/measure-concerns.mjs` and this script, and neither ships. And
 * `test/vocabulary-gate.test.ts` proves the checks in this file are wired to
 * exits by writing MUTATED COPIES of this script into `scripts/` and running
 * them; those copies live in a directory this gate scans and are `.mjs`
 * precisely because that is an extension it neither reads nor demands coverage
 * of. Widen the rules to JavaScript and a deliberately broken copy of this
 * script becomes a file the gate reads — the run that is testing it, and any
 * run happening beside it, would both judge it as if it were the package's own
 * code. So widening costs a second decision about where the mutants live, which
 * is a change worth making the day product code arrives in plain JavaScript,
 * and not before.
 */
function everyTypeScriptFile(dir, listing, notOurs, found = []) {
  for (const { name, isDirectory } of listing(dir)) {
    if (notOurs.has(name)) continue;
    const full = join(dir, name);
    if (isDirectory) everyTypeScriptFile(full, listing, notOurs, found);
    else if (/\.[cm]?tsx?$/.test(name)) found.push(full);
  }
  return found;
}

/**
 * A ROOT MAY NOT ALSO BE EXCLUDED, which is the one way this coverage check can
 * be switched off without touching a line of its code.
 *
 * The check works by finding every `.ts` under the package and asserting the
 * scan read it. Put `src` in NOT_OURS and the finding half stops finding it, so
 * there is nothing left to assert about — the run goes green with the package's
 * largest directory unlooked-at, and both the code and the data still read as
 * if they were doing their jobs. NOT_OURS is meant to name things this package
 * does not own; a directory the gate is pointed at is by definition not one of
 * them, and the two lists disagreeing is a mistake rather than a decision.
 */
function rootsAlsoExcluded(roots, notOurs) {
  return roots.map((r) => r.split("/").pop()).filter((n) => notOurs.has(n));
}

/* `> 0`, asserted at one uncovered file as well as at two — see the blind check. */
const unscanned = everyTypeScriptFile(PKG, realListing, NOT_OURS).filter(
  (f) => !scanned.has(f),
);
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
const expiry = unusedAllowanceFiles(ALLOWED, allowancesUsed);

/*
 * EVERY PAIR IN THE LIST GOT LOOKED AT. Narrowing what is handed to the check —
 * `ALLOWED.filter((e) => e.disposition === "permanent")` is the tempting one,
 * since permanent entries are the ones that "cannot go stale" — leaves the five
 * rename entries, the temporary holes, checked by nothing, with the function
 * itself still correct and every expiry case still green.
 */
const allPairs = ALLOWED.reduce((n, e) => n + e.files.length, 0);
if (expiry.checked !== allPairs) {
  console.error(
    `\nvocabulary (api): the expiry check looked at ${expiry.checked} of the\n` +
      `${allPairs} (name, file) exemptions in ALLOWED. The ones it did not look at\n` +
      `can never be reported stale, which is the same as not having an expiry\n` +
      `check for them.\n`,
  );
  process.exit(1);
}

const stale = expiry.stale;
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
  /*
   * Both halves counted, neither derived from the other — see `dispositionSplit`
   * and the check at the top of the run, which is what makes these two numbers
   * unable to add up while meaning something false.
   */
  console.log(
    `vocabulary (api): clean — every identifier speaks the canon, or is one of\n` +
      `  ${ALLOWED.length} recorded exceptions (${split.rename.length} awaiting a rename, ` +
      `${split.permanent.length} permanent).`,
  );
  process.exit(0);
}

/* Grouped by identifier, because forty uses of one bad name is one decision. */
const report = groupViolations(violations);

console.error(
  `\nvocabulary (api): ${report.length} identifier(s) still speak the old words.\n` +
    `docs/data-model.md is the vocabulary of record — when it and the code\n` +
    `disagree, the code is wrong.\n`,
);
for (const v of report) {
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
