#!/usr/bin/env node
/**
 * THE SEAM GATE — every suite says what layer it replaced, and no suite that
 * mounts the world replaces the wrong one.
 *
 * WHY THIS EXISTS. A suite once passed while describing the dev fixture. It
 * mocked `lib/api` where it should have mocked `lib/data`, so the loaders met
 * shapes they did not recognise and threw, `pages/Home` caught that and did
 * exactly what it is built to do — replaced the entire world with
 * `offlineHome()` — and every assertion in the file then held against rows no
 * product code had produced. Nothing was red. Nothing could have been red. It
 * was found because the fixture's wall happens to have a recognisable name and
 * someone read the audit output closely.
 *
 * G6 in `docs/goals/a-codebase-you-can-navigate.md` answers that with a
 * writing rule: every suite states in its header what layer it mocks and why.
 * A writing rule that nobody enforces lasts until the next hurried afternoon,
 * so this file is the enforcement.
 *
 * TWO RULES, AND THEY DO DIFFERENT WORK.
 *
 *   1. DECLARED. Every suite carries a header paragraph marked `WHAT THIS
 *      MOCKS`, and that paragraph NAMES every seam the file actually replaces,
 *      in backticks. Not "has a paragraph" — names them. A file that adds
 *      `vi.mock("../src/lib/data")` and does not say so fails, which is the
 *      only version of this rule that stays true as files change. Where a
 *      suite replaces nothing the paragraph must say so, in the word
 *      "nothing"; that is a real answer and the gate accepts it as one.
 *
 *      THE BACKTICKS ARE PART OF THE RULE, and they are the repair of a real
 *      hole. This used to be a substring test over the whole header, and a
 *      header saying "no fetch, no storage, no clock" already contains "fetch"
 *      — so it would have accepted a `vi.stubGlobal("fetch", …)` added
 *      underneath it, and two suites in this package sat one keystroke from
 *      that. Every header here already writes seam names in backticks, so
 *      asking for `` `fetch` `` rather than `fetch` costs no edits and turns a
 *      coincidence of prose into a declaration. The name is looked for in the
 *      DECLARATION PARAGRAPH — from `WHAT THIS MOCKS` to the end of that
 *      comment block — rather than anywhere in the header, so a name that
 *      appears in some earlier paragraph is not an answer to this question.
 *
 *   2. THE INCIDENT ITSELF. Any suite that mounts `pages/Home` must mock
 *      `lib/data`. This is the one rule that would have caught the original
 *      bug rather than merely made it legible. The page reads its three layers
 *      through the loaders; a suite that mounts it and mocks only `lib/api` is
 *      not describing the product, and no amount of honest prose about that
 *      choice makes it a correct one.
 *
 *      "Mounts" is answered by FOLLOWING IMPORTS, not by recognising names.
 *      The first version asked whether the source contained the literal
 *      `helpers/render-home` or the literal `"…/src/pages/Home"`, and a review
 *      broke it twice inside a minute. `import Home from
 *      "../src/pages/Home.tsx"` slipped past on the extension. A second helper
 *      called `helpers/render-page`, doing exactly what `render-home` does,
 *      slipped past on the name. Both were the original incident typed out
 *      verbatim, both mocked only `lib/api`, and both reported clean — so for
 *      those two shapes the rule was not a rule, it was a coincidence about
 *      which files existed the day it was written.
 *
 * WHAT THIS GATE CANNOT SEE, said plainly because G7 asks every gate to be
 * honest about its own reach:
 *
 *   - RULE 1 STILL CANNOT READ. It asks that the seam name appear, in
 *     backticks, inside the declaration paragraph — which a paragraph
 *     explaining that the page does NOT use `lib/data` satisfies just as well
 *     as one declaring the mock. `Profile.test.ts` carries a paragraph of that
 *     shape today: adding `vi.mock("../src/lib/data")` to it reports clean,
 *     which is how this bullet was checked rather than assumed. Closing it
 *     needs a machine-readable seam list — a line each suite carries and this
 *     file parses, instead of prose it greps — which is a change to every
 *     header in the package and belongs in a round of its own.
 *   - THE IMPORT WALK STOPS AT `src/` AND `node_modules/`, not at the edge of
 *     `test/`. Everything else under `packages/web` is opened and read, so a
 *     helper MOVED out of `test/` — four lines under `test-support/`, which is
 *     neither a rename nor product code — is followed like any other file.
 *     What stays invisible is a suite that reaches the page through PRODUCT
 *     code: importing `src/App`, which renders `pages/Home`, is a question
 *     about the product's own import graph and a much larger program. No suite
 *     does that today, and the scan fixture below pins it as deliberately out
 *     of scope rather than leaving the next reader to wonder.
 *   - It reads `vi.mock`, `vi.doMock`, `vi.stubGlobal` and `vi.stubEnv`, and
 *     nothing else. A suite that reaches into `globalThis` by hand, or swaps a
 *     method with `Object.defineProperty`, replaces something this gate will
 *     not ask it to declare. `auth-boundary.test.ts` does exactly that with
 *     `localStorage` and declares it anyway, because the rule is about honesty
 *     and the gate is only the floor under it.
 *   - `test/setup-jsdom.ts` replaces `window.localStorage` for EVERY suite in
 *     the package, through `Object.defineProperty`, and it is installed by
 *     `vitest.config.ts` rather than imported by anybody. So no file is
 *     obliged to declare it and none does: it is a real, package-wide seam
 *     that this gate is structurally unable to attribute to a suite.
 *   - IT CANNOT PROVE THAT IT RAN. Everything below proves what this file does
 *     when it is executing; nothing in it can notice the `selftest()` call
 *     being deleted, because the thing that would notice is the call. That
 *     question is asked from outside, in `test/seam-gate.test.ts`, which runs
 *     this file as a process and reads the proof out of its output, checks the
 *     number of suites it says it read against the files vitest will collect,
 *     and checks that `pnpm test` still invokes it at all.
 *
 *     THE SAME ARGUMENT APPLIES ONE FRAME DOWN, and for a while it was made
 *     only at the top. `scanFixture()` and `endToEnd()` are calls too, and the
 *     numbers announcing them used to be constants — the expected fixture list
 *     and a literal `4` — so either call could be deleted while the line above
 *     the verdict went on describing the work. They are receipts now, written
 *     where the work happens, and a deleted call moves them. The receipt for
 *     the fixture scan is written at the END of that function, after both of
 *     its comparisons, because next to the walk it recorded only that the walk
 *     had happened: `if (1) return;` in front of `scan(…)` gutted the layer
 *     with the proof line still announcing a seven-suite scan.
 *
 *     WHAT IS STILL NOT COVERED is a call replaced by a literal that repeats
 *     its answer, or the proof line edited by hand. That is forgery rather
 *     than deletion, it needs the answer to be known in advance, and no amount
 *     of checking inside this file reaches it — the regress has to stop, and
 *     it stops there rather than quietly. Two smaller residues, named because
 *     they were found by probing rather than by reasoning: disabling the
 *     fixture's FILE-DISCOVERY comparison alone leaves the receipt at 7 and
 *     the gate green — though the narrowing it exists to catch is still red
 *     three ways below it, through the failing list, the headline and the
 *     report, so what that mutation costs is the clear message and not the
 *     detection; and a `pnpm test` line whose earlier stage cannot fail (a
 *     leading `exit 0 &&`) satisfies the `&&`-chain check in
 *     `test/seam-gate.test.ts`, which reads the shape of the chain and not the
 *     behaviour of its links.
 *   - THE PARSE ANSWERS ONE QUESTION: WHERE THE PROSE IS. `commentsBlanked`
 *     now asks the TypeScript compiler, so comments in every spelling and JSX
 *     text are blanked before any rule looks. THE RULES THEMSELVES ARE STILL
 *     REGULAR EXPRESSIONS OVER TEXT, and the gap that leaves is a real one,
 *     stated with the shape that reaches it rather than in general terms:
 *
 *       A `vi.mock("../src/lib/data", …)` WRITTEN INSIDE AN ORDINARY STRING
 *       LITERAL IS COUNTED AS A MOCK. Staged and run, not reasoned about: a
 *       suite that mounts the world through `helpers/render-home`, mocks only
 *       `lib/api`, names `lib/data` in its header, and asserts somewhere that
 *       some advice text equals `'vi.mock("../src/lib/data", () => ({}))'`
 *       reports `seams: clean`. That is rule 2 turned off — the green-and-
 *       wrong direction, the one that matters — and it is reachable from code
 *       that compiles and runs.
 *
 *     How likely: it needs the exact call typed out inside a string, which is
 *     not what a hurried afternoon produces — but this repository tests gates
 *     by asserting on the text they print, so a future suite about THIS file
 *     is a plausible way to write it by accident. No suite does today, and
 *     that is a fact about today, not a reason.
 *
 *     THE FIX, AND WHY IT IS NOT IN THIS CHANGE. The four seam patterns and
 *     the two import patterns would become AST queries — a `vi.mock` is a
 *     CallExpression whose callee is `vi.mock` and whose first argument is a
 *     string literal, which no amount of quoting can imitate — and the parser
 *     is already in hand for it. It is not a line, though: a mock inside a
 *     COMMENT is not a CallExpression either, so moving these rules onto the
 *     AST would make every commented-out-mock case below pass whether
 *     `commentsBlanked` works or not, and the coverage this round was built
 *     to add would quietly stop covering anything. It has to arrive with its
 *     own re-derived cases, which is a round of its own and not a paragraph
 *     in this one.
 *
 *     One narrower shape is left for the same reason and is much smaller: a
 *     module specifier containing whitespace is skipped rather than reported
 *     as unfollowable, because every such match seen in this package has been
 *     two halves of two different statements.
 *   - `vi.spyOn` is deliberately NOT counted. A spy that records calls is a
 *     measuring instrument, not a replaced layer, and counting it would push
 *     every suite into declaring its own assertions as seams — which trains
 *     people to write the paragraph without reading it.
 *   - It cannot tell a correct mock from an incorrect one in general. Rule 2
 *     encodes the single case this project has actually been burned by. Every
 *     other seam choice is still a judgement, and the paragraph is where the
 *     judgement is written down for the next reader to disagree with.
 *
 * THIS IS THE STATIC HALF OF A PAIR. `withFixtureAlarm` in
 * `test/helpers/render-home.tsx` is the other: it watches for the fixture's own
 * announcement at mount time and refuses to hand back a world the fixture
 * produced, so the incident fails at runtime as well as here.
 * `test/fixture-guard.test.tsx` stages the incident and proves the runtime half
 * fires; the self-test below proves this half does.
 *
 * THE SPLIT BETWEEN THEM IS NARROWER THAN IT WAS FIRST WRITTEN. The claim used
 * to be "two halves, because either alone has a hole" — and for the two shapes
 * in rule 2 above that was simply false: both halves had the SAME hole, since
 * `withFixtureAlarm` lives inside `mountWorld` and neither a direct
 * `pages/Home.tsx` import nor a second helper passes through it. What is
 * actually true is narrower and still worth having. This half sees any suite
 * that reaches the page and does not mock `lib/data`, whoever does the
 * mounting. The runtime half sees a suite that mocks `lib/data` correctly and
 * ENDS UP IN THE FIXTURE ANYWAY — a loader throwing on a shape the mock got
 * wrong — which is a mistake no reading of a mock list can find. What neither
 * half covers: a helper that mounts the page WITHOUT calling `mountWorld` gets
 * the static half only. That is the remaining gap, and it is stated here
 * rather than left for the next review to find.
 *
 * Run: node scripts/check-seams.mjs        (also runs in `pnpm test`)
 */
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * THE ONE DEPENDENCY THIS FILE HAS, AND WHY IT STOPPED BEING TOO EXPENSIVE.
 *
 * Finding where the comments are used to be done by hand, by a scanner written
 * in this file, on the stated reasoning that a parser was "the dependency this
 * check is deliberately too cheap to have". That reasoning was wrong twice
 * over. `typescript` is already a devDependency of this package and already
 * runs on every `pnpm typecheck`, so it costs no install and no lockfile
 * change; and the scanner it was buying its way out of had a live false
 * negative in it — see `commentsBlanked` below.
 *
 * Imported at the top rather than behind a try/catch. A gate that quietly fell
 * back to the hand scanner when the import failed would report `clean` in the
 * same words with the hole back in place, which is the failure this whole file
 * is about. If typescript is missing the gate does not start.
 */
import ts from "typescript";

const THIS_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = resolve(dirname(THIS_FILE), "..");
const TEST_DIR = join(PACKAGE_ROOT, "test");

/**
 * The phrase a header has to carry.
 *
 * One fixed phrase rather than a list of accepted wordings, because the point
 * is that a reader opening any suite in this package finds the same words in
 * the same place. It is also greppable, which is how someone asks "which
 * suites touch `lib/data`" without opening every file in the directory.
 */
const MARKER = /WHAT THIS MOCKS/;

/**
 * A file's header: everything above the first line of real code.
 *
 * Bounded on purpose. The gate asks for a declaration in the HEADER, and
 * without a bound the phrase could sit anywhere — including inside the very
 * mock it was supposed to introduce, three hundred lines down, where nobody
 * opening the file would meet it.
 *
 * TWO WAYS THIS USED TO MISS THE BOUNDARY, both of which made rule 1 vacuous
 * rather than merely lenient. The first import was found with `/^import\s/m`,
 * so `import{it,expect,vi}from"vitest";` — legal, and what a formatter with
 * different settings emits — matched nothing and the whole file became the
 * header. And a file with no static import at all (everything reached through
 * `await import(…)`) did the same by design, on the reasoning that it "costs
 * nothing". It does not cost nothing: with the whole file as the header, a
 * declaration sitting BELOW the mocks satisfies rule 1, which is exactly the
 * arrangement the bound exists to reject. So there is no lenient direction
 * here any more. Where no import line can be found, only a comment block at
 * the very top of the file counts as a header, and a file with neither has no
 * header at all and is told so.
 */
const IMPORT_LINE = /^import[\s{("'*]/m;
const LEADING_COMMENT = /^\s*\/\*[\s\S]*?\*\//;

function headerOf(source) {
  const firstImport = source.search(IMPORT_LINE);
  if (firstImport !== -1) return source.slice(0, firstImport);
  const leading = source.match(LEADING_COMMENT);
  return leading ? leading[0] : "";
}

/**
 * The declaration paragraph inside a header: `WHAT THIS MOCKS` to the end of
 * the comment block that carries it.
 *
 * Rule 1 asks its question of this slice rather than of the whole header,
 * because a header is often several paragraphs and only one of them is an
 * answer. A seam name that appears in a paragraph above the marker — a note
 * about what a sibling suite does, say — is a mention, not a declaration, and
 * accepting it would let the gate be satisfied by writing about the codebase
 * in general.
 */
function declarationIn(header) {
  const at = header.search(MARKER);
  if (at === -1) return "";
  const rest = header.slice(at);
  const end = rest.indexOf("*/");
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Which dialect a file is, so the parse below is the one its author wrote in.
 *
 * It matters for exactly one thing here and that thing is enough: in a `.ts`
 * file `<T>value` is a type assertion, and in a `.tsx` file it opens a JSX
 * element. Parse one as the other and the recovery hands back a tree whose
 * comment positions are somebody else's. `Profile.test.ts` writes generic
 * calls today, so this is not hypothetical about this package.
 *
 * A source with no filename — every string case in the self-test below — is
 * parsed as TSX, the more permissive of the two for the shapes those cases
 * use. That default is stated rather than assumed because it is the one place
 * where the parse is a guess.
 */
const SCRIPT_KIND = new Map([
  [".ts", ts.ScriptKind.TS],
  [".mts", ts.ScriptKind.TS],
  [".cts", ts.ScriptKind.TS],
  [".tsx", ts.ScriptKind.TSX],
  [".js", ts.ScriptKind.JS],
  [".mjs", ts.ScriptKind.JS],
  [".cjs", ts.ScriptKind.JS],
  [".jsx", ts.ScriptKind.JSX],
]);

function scriptKindOf(key) {
  const dot = key.lastIndexOf(".");
  const named = dot === -1 ? undefined : SCRIPT_KIND.get(key.slice(dot));
  return named ?? ts.ScriptKind.TSX;
}

/**
 * THE SOURCE WITH ITS COMMENTS BLANKED OUT, WHICH IS WHERE THE CODE IS.
 *
 * Everything above this line reads PROSE — the header, the declaration
 * paragraph — and must keep the comments. Everything below it reads CODE, and
 * reading prose as code cost this gate its second rule. A `vi.mock` inside a
 * block comment still counted as a mock, so the shape of the original
 * incident — a suite that mounts the world with the `lib/data` mock commented
 * out, which is what someone leaves behind after asking "what happens if I
 * take this out" — reported clean. Rule 2 was switchable off with two
 * keystrokes and no deletion.
 *
 * It runs the other way too, and that half was already live in this package.
 * `IMPORT_OF_ANY` read a header sentence about a helper that no longer exists
 * as an import of it, and `IMPORT_OF_HOME` read a sentence saying a suite does
 * NOT render the page as evidence that it does. Five lines in `test/` today
 * parse as import specifiers, harmless only because none of them begins with a
 * dot.
 *
 * THIS USED TO BE A HAND-WRITTEN SCANNER, AND THE SCANNER SHIPPED WITH THE
 * BUG IT WAS ADDED TO FIX STILL IN IT. It walked the text tracking quotes and
 * comment openers, which means it had to decide what a `/` was without a
 * grammar. A regular expression literal containing a quote character —
 * ``s.replace(/`/g, "")``, one line, nothing clever — desynchronised it: the
 * backtick inside the regex opened a "template literal" whose only bound was
 * the end of the file, so everything up to the next backtick anywhere below
 * was skipped as string, INCLUDING WHOLE COMMENTS, which were then never
 * blanked and were read as code. Two ordinary lines in a suite — that
 * `replace`, and an assertion ending `` .toBe(`a`) `` — were enough to make a
 * commented-out `vi.mock("../src/lib/data")` between them count as a real
 * mock, which turns rule 2 off for a suite that mounts the world. That is
 * D16's own incident, reopened by its own repair, and it was live: asked where
 * the comments are in each of the 78 `.ts`/`.tsx`/`.mjs` files in this
 * package, the scanner and the parse agree on 77 and disagree on this one,
 * where the scanner reads fifteen comment spans as string — the largest of
 * them thirty-five lines, opening on a backtick in prose and closing on
 * another one in a doc comment far below.
 *
 * So the question is asked of the TypeScript parser, which is where the
 * grammar lives. Every token is visited and the comment trivia around it
 * collected: LEADING at each token's full start, and TRAILING at the same
 * position, which is the end of the token before it. Both are needed and one
 * alone is a quiet hole — leading trivia stops collecting at the first
 * non-newline, so `foo(); /* note *\/` on one line is invisible to it, and
 * two files in this package write exactly that.
 *
 * BLANKED, NOT REMOVED: every character becomes a space and newlines stay, so
 * offsets and line numbers are the ones in the file. STRINGS ARE LEFT ALONE,
 * unlike the sibling scanner in `check-vocabulary.mjs`, because the thing
 * being read here IS a string literal — the module specifier. A `//` inside
 * `"http://localhost"` is not a comment and an apostrophe in JSX text is not a
 * quote, which the old scanner spent two repairs approximating and a parser
 * simply knows.
 */
function commentsBlanked(source, key = "") {
  /*
   * The name is a label for error messages and nothing else — the dialect is
   * the last argument, passed explicitly so that it is decided by
   * `scriptKindOf` above rather than by whatever this string happens to end
   * in. Two places deciding the same thing is how one of them goes stale.
   */
  const parsed = ts.createSourceFile(
    "the-file-being-audited",
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes, which is what makes `getChildren` hand back tokens */ true,
    scriptKindOf(key),
  );

  const out = Array.from(source);
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== "\n") out[i] = " ";
    }
  };

  const walk = (node) => {
    /*
     * `getChildren` rather than `forEachChild`, because `forEachChild` skips
     * punctuation. A comment sitting alone before a closing brace is leading
     * trivia of that brace and of nothing else, and a walk that never visits
     * the brace never blanks it.
     */
    const children = node.getChildren(parsed);
    if (children.length > 0) {
      for (const child of children) walk(child);
      return;
    }
    /*
     * JSX TEXT IS PROSE TOO, and leaving it standing was the same hole in a
     * second spelling. The words between `<p>` and `</p>` are shown to a
     * reader, not run — but they were being read as code, so a suite that
     * mounts the world, mocks only `lib/api`, and happens to RENDER the
     * sentence `vi.mock("../src/lib/data")` — a help string, a docs page under
     * test — had rule 2 satisfied by text on a screen. Measured, not feared:
     * that file reported `seams: clean` before this line existed.
     *
     * The one thing this can hide is a `.tsx` file whose JSX never closes, in
     * which everything below becomes text and a real mock under it goes
     * unseen. Such a file does not compile: `pnpm test` runs vitest in the
     * same `&&` chain and it stops at "Transform failed", which is where a
     * file with unterminated JSX should be caught rather than here.
     */
    if (node.kind === ts.SyntaxKind.JsxText) blank(node.getStart(parsed), node.getEnd());

    const at = node.getFullStart();
    for (const range of ts.getTrailingCommentRanges(source, at) ?? []) {
      blank(range.pos, range.end);
    }
    for (const range of ts.getLeadingCommentRanges(source, at) ?? []) {
      blank(range.pos, range.end);
    }
  };
  walk(parsed);

  return out.join("");
}

/**
 * Normalise a mocked module specifier to the name a person writes in prose.
 *
 *     "../src/lib/data"         -> lib/data
 *     "../src/lib/auth-context" -> lib/auth-context
 *     "./helpers/render-home"   -> helpers/render-home
 *     "../test-support/render"  -> test-support/render
 *
 * The extension is dropped because a header saying "`helpers/canvas-stub.ts`"
 * and one saying "`helpers/canvas-stub`" are the same sentence, and a gate that
 * distinguished them would be teaching punctuation rather than accuracy.
 */
function seamName(specifier) {
  return specifier
    .replace(/^(\.\.?\/)+/, "")
    .replace(/^src\//, "")
    .replace(/\.[cm]?[jt]sx?$/, "");
}

/**
 * Every module specifier this file imports, however it phrases the import.
 *
 * `from "x"`, the side-effect `import "x"`, and the dynamic `import("x")` are
 * all here, because the walk below has to be about what the file actually
 * pulls in rather than about which spelling its author preferred. The dynamic
 * form matters most: `mountWorld` reaches the page through
 * `await import("../../src/pages/Home")` and a helper written the same way
 * would otherwise be a blank space in the graph.
 *
 * A SPECIFIER MAY NOT CONTAIN WHITESPACE, and that is not tidiness. Without it
 * the capture runs past its own closing quote when the opening one was never a
 * quote — the second half of a `).toBe(3)` and the first half of the next
 * assertion become one "module path", which two suites in this package produce
 * today. Comment blanking removes most of that; this removes the rest, because
 * a match that spans a line boundary is a match the file never wrote. No real
 * specifier has a space in it, so nothing legitimate is lost.
 */
const IMPORT_OF_ANY = /(?:\bfrom|\bimport)\s*\(?\s*["'`]([^"'`\s]+)["'`]/g;

/**
 * The seams a source replaces by asking vitest to replace them.
 *
 * `vi.mock("X")` and its sibling `vi.doMock("X")` swap a module wholesale;
 * `vi.stubGlobal("f")` and `vi.stubEnv("K")` swap a global or an environment
 * variable. The third kind of seam — a helper imported for the replacements it
 * installs — is not visible here at all, because answering "is this import a
 * helper" needs the import walk; it is added in `auditSource`.
 *
 * THREE THINGS THESE PATTERNS LEARNED FROM BEING BROKEN. Backticks count as
 * quotes: `` vi.mock(`../src/lib/appearance`) `` is ordinary, valid, does
 * exactly what the double-quoted form does, and used to be invisible to every
 * regex in this file — a gate a keystroke can switch off is not a gate.
 * `vi.doMock` is the same call with hoisting turned off, three characters from
 * the one being policed, and reading only `vi.mock` left a documented vitest
 * API as a way round the rule. And the `(` is required immediately after the
 * name so that `vi.mocked(fn)` — a typed accessor for a mock that already
 * exists, used nineteen times in `auth-boundary.test.ts` — is not read as a
 * seam being created.
 *
 * A FOURTH: THE COMMENTS ARE GONE BEFORE THIS LOOKS. A mock inside a block
 * comment is not a mock, and reading one as a mock is how rule 2 came to be
 * satisfied by a `vi.mock("../src/lib/data")` somebody had commented out —
 * see `commentsBlanked`.
 */
function mockedSeams(source, key) {
  const code = commentsBlanked(source, key);
  const seams = new Set();
  for (const m of code.matchAll(/\bvi\.(?:mock|doMock)\(\s*["'`]([^"'`\s]+)["'`]/g)) {
    seams.add(seamName(m[1]));
  }
  for (const m of code.matchAll(/\bvi\.(?:stubGlobal|stubEnv)\(\s*["'`]([^"'`\s]+)["'`]/g)) {
    seams.add(m[1]);
  }
  return seams;
}

/**
 * The page whose failure path is the dev fixture, named in any import.
 *
 * The extension is optional and that is not a detail. The first version of
 * this pattern demanded a quote immediately after `Home`, so
 * `import Home from "../src/pages/Home.tsx"` — the original incident, typed
 * with the extension a great many editors add for you — reported clean. One
 * character of tolerance is the difference between a rule and a coincidence.
 *
 * Whitespace is excluded for the same reason as in `IMPORT_OF_ANY`, and this
 * one is asked of code with its comments blanked: a header sentence saying a
 * suite "never renders `../src/pages/Home`" used to be read as proof that it
 * does, and the gate would then contradict, in its own output, the sentence it
 * had just read.
 */
const IMPORT_OF_HOME = /["'`][^"'`\s]*src\/pages\/Home(\.[cm]?[jt]sx?)?["'`]/;

/** A file that is itself a suite, and so is not a helper anybody declares. */
const SUITE_FILE = /\.test\.[cm]?[jt]sx?$/;

/**
 * DOES THIS FILE REACH THE PAGE — ASKED BY FOLLOWING IMPORTS, NOT BY NAME —
 * AND WHAT LOCAL FILES DOES IT PULL IN ON THE WAY.
 *
 * Rule 2 used to ask whether the source contained the literal
 * `helpers/render-home`. A review defeated that in a minute by writing a
 * second helper, `helpers/render-page`, doing exactly what `render-home` does
 * under a different name: the suite mocked only `lib/api`, mounted the world
 * through it, and the gate printed "clean". Keying a rule to one filename
 * means the rule covers the files that existed the day it was written, and the
 * next helper is exempt until somebody remembers this line — which is the same
 * bet the writing rule made before it was made mechanical.
 *
 * So the question is answered by reading. Every relative import that stays
 * inside the package and out of `src/` is opened and read too, TRANSITIVELY —
 * a suite that imports a helper that imports a second helper that mounts the
 * page is caught at the third step — and the file mounts the world if anything
 * reachable that way names `pages/Home`. A helper cannot be renamed out of the
 * rule, cannot be moved out of `test/` out of the rule, and one written
 * tomorrow is covered on the day it is written.
 *
 * `helpers` is the other thing the walk knows and no regex could: which of a
 * suite's OWN imports are local files rather than packages. Those are seams by
 * rule 1 — a suite inherits a frozen clock and a canvas that draws nothing
 * simply by importing a file that installs them, and a header that omits that
 * is describing a browser the test never had. Only depth 0 is collected: a
 * suite declares what IT reaches for, and what its helper reaches for is the
 * helper's business to document.
 *
 * `unfollowable` is the honest half of all this. An import that should have
 * been readable and was not means the walk stopped early and the answer would
 * be a guess, so it is reported rather than shrugged at — an unread file is
 * indistinguishable from a clean one, which is exactly how the vocabulary gate
 * beside this one came to be blind over half of `Home.tsx`.
 */
function followImports(source, read, fromKey, seen, depth) {
  /*
   * Blanked here rather than at the call site, so that every file the walk
   * opens on the way down gets the same treatment as the suite it started
   * from. A helper's own comments are prose too.
   *
   * `fromKey` decides which dialect it is parsed as, which is why the walk
   * carries the key of the file it is currently reading rather than of the
   * suite it started from: a `.tsx` helper reached from a `.ts` suite is
   * still JSX.
   */
  const code = commentsBlanked(source, fromKey);
  let mounts = IMPORT_OF_HOME.test(code);
  const unfollowable = [];
  const helpers = [];
  for (const [, specifier] of code.matchAll(IMPORT_OF_ANY)) {
    const found = read(specifier, fromKey);
    if (found.kind === "outside") continue;
    if (found.kind === "unreadable") {
      unfollowable.push(found.key);
      continue;
    }
    if (depth === 0 && !SUITE_FILE.test(found.key)) helpers.push(seamName(specifier));
    if (seen.has(found.key)) continue;
    seen.add(found.key);
    const deeper = followImports(found.source, read, found.key, seen, depth + 1);
    mounts = mounts || deeper.mounts;
    unfollowable.push(...deeper.unfollowable);
  }
  return { mounts, unfollowable, helpers };
}

const FOLLOWABLE = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx"];

/**
 * Open one import, if it is ours to open.
 *
 *   { kind: "outside" }                 a package, or product code under
 *                                       `src/` — not followed, see the header
 *   { kind: "unreadable", key }         ours to open, and no file found
 *   { kind: "read", key, source }
 *
 * The boundary is the PACKAGE, minus `src/` and `node_modules/`. It used to be
 * `test/`, and that was too narrow by exactly the shape of the original
 * incident: a four-line mounting helper at `test-support/render-page.tsx`,
 * imported by a suite that mocked only `lib/api`, was reported clean, because
 * "outside" was being used to mean two different things — "not our code" and
 * "not in the directory I happened to think of". `src/` is excluded because
 * following it means walking the product's whole import graph to answer one
 * question about test files, and `node_modules/` because it is not ours. Those
 * two exclusions are stated in the header as blind spots; every other file in
 * the package is read.
 *
 * `root` is a parameter rather than a constant so the self-test can point the
 * real reader at a fixture tree. A reader that answers "outside" to everything
 * is a blind walk that looks exactly like a working one from the outside, so
 * the fixture exercises this function rather than a stand-in for it.
 */
function readerUnder(root) {
  return function read(specifier, fromKey) {
    if (!/^\.{1,2}\//.test(specifier)) return { kind: "outside" };
    const target = resolve(dirname(fromKey), specifier);
    const inside = relative(root, target);
    if (inside === "" || inside.startsWith("..") || inside.startsWith(sep)) {
      return { kind: "outside" };
    }
    const parts = inside.split(sep);
    if (parts[0] === "src" || parts.includes("node_modules")) return { kind: "outside" };
    for (const extension of FOLLOWABLE) {
      const candidate = target + extension;
      try {
        if (statSync(candidate).isFile()) {
          return { kind: "read", key: candidate, source: readFileSync(candidate, "utf8") };
        }
      } catch {
        /* not this spelling; try the next */
      }
    }
    return { kind: "unreadable", key: parts.join("/") };
  };
}

/**
 * Everything wrong with one suite. Empty means it passes.
 *
 * Split out from the walk so the self-test below can run it over a string
 * instead of a file — the same shape `check-vocabulary.mjs` uses, and for the
 * same reason: a gate proven only by being pointed at the repo is proven only
 * against the day it was written. Splitting it is not enough on its own, which
 * is what the second layer of the self-test is about; see `scanFixture`.
 *
 * `read` and `key` are how the import walk is kept testable. The real scan
 * passes `readerUnder(PACKAGE_ROOT)` and the suite's path; a self-test case
 * passes a handful of helper sources written out in the case itself, so "a
 * helper that reaches the page" can be staged as a fact of the case rather
 * than as a fact of the repository.
 *
 * Neither argument has a default, deliberately. A default reader answering
 * "outside" to everything would be a blind walk that looks from the outside
 * exactly like a working one — and the scan loop at the bottom of this file
 * spent its first draft doing precisely that, because the default was there
 * and looked harmless. A caller who forgets now gets a TypeError instead of a
 * clean report.
 */
function auditSource(source, read, key) {
  const problems = [];
  const header = headerOf(source);
  const declaration = declarationIn(header);
  const world = followImports(source, read, key, new Set([key]), 0);
  const seams = [...new Set([...mockedSeams(source, key), ...world.helpers])];

  if (!MARKER.test(header)) {
    problems.push(
      "no seam declaration in the header. Add a paragraph marked " +
        "`WHAT THIS MOCKS, AND WHY (gate G6)` naming each layer this suite " +
        "replaces and why that is the right layer. If it replaces nothing, " +
        "say so and say why nothing needs replacing — that is a real answer.",
    );
  } else if (seams.length === 0) {
    if (!/\bnothing\b/i.test(header)) {
      problems.push(
        "the header declares seams but this suite replaces none. Where a " +
          "suite mocks nothing, the declaration has to say the word " +
          "`nothing`, so a reader can tell an empty answer from a missing one.",
      );
    }
  } else {
    const unnamed = seams.filter((seam) => !declaration.includes(`\`${seam}\``));
    if (unnamed.length > 0) {
      problems.push(
        `the header does not name ${unnamed.map((s) => `\`${s}\``).join(", ")}, ` +
          "which this suite replaces. A declaration that is out of date with " +
          "its own mocks is worse than none: it reads as though someone " +
          "checked. Write the name in backticks, inside the declaration " +
          "paragraph, so the gate is reading an answer and not a coincidence.",
      );
    }
  }

  for (const missing of world.unfollowable) {
    problems.push(
      `this suite imports \`${missing}\`, which the gate could not read. ` +
        "Rule 2 is answered by following imports, so an import that cannot be " +
        "opened is an import the gate cannot see through, and its answer to " +
        '"does this mount the world" would be a guess printed as a fact. ' +
        "Fix the path, or teach the reader the spelling it does not know.",
    );
  }

  /*
   * RULE 2. Ordered last so its message is the final thing printed, because it
   * is the only failure here that means a suite is probably GREEN AND WRONG
   * rather than merely undocumented.
   */
  if (world.mounts && !seams.includes("lib/data")) {
    problems.push(
      "THIS SUITE MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`.\n" +
        "      `pages/Home` reads its three layers through `loadInspirations` /\n" +
        "      `loadSignals` / `loadTopOfMind`, and answers a throw from any of\n" +
        "      them by replacing the entire world with the dev fixture. Mocking\n" +
        "      `lib/api` underneath them makes that throw likely and the failure\n" +
        "      silent: the suite passes while describing invented rows. This is\n" +
        "      the exact incident G6 was written for.",
    );
  }

  return problems;
}

/*
 * THE SCAN LOOP: which files are read, and what is done with the answers.
 *
 * `walk` decides what gets judged and `scan` decides what counts as failing,
 * and neither of them is the audit. That distinction is the whole reason this
 * file was rejected twice: a self-test that only ever called `auditSource` was
 * green while `walk`'s pattern had lost `.tsx`, while `walk` no longer entered
 * subdirectories, and while a single-problem suite was dropped from the
 * failing list. `vitest.config.ts` in this package carries the same warning in
 * its own words — "a test that never runs looks exactly like a test that
 * passes" — and this loop had the identical shape with nothing pointed at it.
 * `scanFixture` below is what points at it.
 */
function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, found);
    else if (/\.test\.(ts|tsx)$/.test(entry)) found.push(full);
  }
  return found;
}

/*
 * The same glob vitest runs, and only that.
 *
 * `test/helpers/` and `test/setup-jsdom.ts` are not suites — they assert
 * nothing and can pass nothing — so demanding a declaration from them would be
 * asking a file to describe a subject it does not have. They install real
 * seams, though, which is why rule 1 makes every suite that imports one name
 * it: the obligation lands on the file making the claim.
 *
 * `root` and `testDir` are separate because they answer different questions:
 * which tree is SCANNED for suites, and which tree may be READ when following
 * their imports. For this package that is `test/` and `packages/web`.
 */
function scan({ root, testDir }) {
  const read = readerUnder(root);
  const suites = walk(testDir).sort();
  const failing = [];
  for (const file of suites) {
    const problems = auditSource(readFileSync(file, "utf8"), read, file);
    if (problems.length > 0) {
      failing.push({ file: relative(testDir, file).split(sep).join("/"), problems });
    }
  }
  return { suites, failing };
}

/**
 * Print the verdict and hand back the exit code.
 *
 * A returned number rather than a `process.exit` call inside the branch, so
 * that the self-test can run this whole path — walk, audit, report, exit — as
 * a real process and read the code it actually exits with. A gate that printed
 * its failures and exited 0 would look identical in a terminal and be worth
 * nothing in CI, and that mutation survived every version of this file until
 * the end-to-end runs below existed.
 */
function report({ suites, failing }) {
  if (suites.length === 0) {
    console.error(
      "\nseams: the scan found NO suites at all, which is not the same as\n" +
        "finding nothing wrong. Either the directory it walks has moved or the\n" +
        "pattern it walks with no longer matches this package's file names.\n",
    );
    return 1;
  }

  if (failing.length === 0) {
    console.log(`seams: clean — ${suites.length} suites each say what they replace`);
    return 0;
  }

  console.error(
    `\nseams: ${failing.length} of ${suites.length} suite(s) do not say what layer they replace.\n` +
      "G6 in docs/goals/a-codebase-you-can-navigate.md: a suite that mocks the\n" +
      "wrong layer describes the dev fixture and stays green while doing it.\n",
  );
  for (const { file, problems } of failing) {
    for (const problem of problems) console.error(`  test/${file}\n      ${problem}\n`);
  }
  return 1;
}

/**
 * PROVE THE GATE CAN FAIL, AT MORE THAN ONE POINT, AND FOR THE RIGHT REASON.
 *
 * G7 — "nothing green is blind". The vocabulary gate beside this one reported
 * clean over half of `Home.tsx` for a week because it had been proven at
 * exactly one location, and a blind check prints the same word a working one
 * does. So the cases live here and run in `pnpm test` rather than in whatever
 * anyone remembered to try by hand the day it was written.
 *
 * THE SELF-TEST HAS THREE LAYERS, AND THE SECOND AND THIRD ARE THIS ROUND'S
 * REPAIR. The first is the case list below: strings in, exact problem list
 * out, which proves the JUDGEMENT. That is not the same as proving the gate.
 * A review built a version of this file that lets a real violation through —
 * `walk`'s pattern narrowed from `.test.(ts|tsx)` to `.test.(ts)`, one
 * character — and the case list printed "passed" all the way down, because
 * nothing in it had ever asked which files the gate reads. The same was true
 * of `problems.length > 0`, of the recursion into subdirectories, and of the
 * exit code. Every one of those decides WHAT GETS JUDGED or WHAT IS DONE WITH
 * THE VERDICT, and none of them is `auditSource`.
 *
 * So layer two (`scanFixture`) writes a small tree of suites to a temporary
 * directory and runs the REAL `walk` and the REAL `scan` over it, asserting
 * the exact list of files discovered and the exact list of files reported
 * failing. Layer three (`endToEnd`) runs this file as a CHILD PROCESS — three
 * times against fixture trees, and once with no arguments against this package
 * exactly as `pnpm test` invokes it — and asserts the exit codes and the
 * printed text. Between them, each of the four one-line breaks above turns
 * something red and names it.
 *
 * A break that produces no red is the finding, not the mutation. Every
 * mechanism between "a file exists on disk" and "a violation is printed" was
 * broken one at a time while writing this, and the survivors are what the
 * layers above were added for. One survivor could not be closed from in here
 * at all — deleting the `selftest()` call — and it is closed from outside, in
 * `test/seam-gate.test.ts`.
 *
 * The must-flag cases are chosen to break the gate in DIFFERENT ways, because
 * "does it notice a file with no header" was never the interesting question.
 * A declaration below the imports, a declaration that has fallen out of date
 * with its own mocks, and a suite that mounts the world on the wrong seam are
 * three separate failures and only the first is obvious.
 *
 * EACH CASE STATES ITS WHOLE ANSWER, and that is the repair of a hole a review
 * walked straight through. The cases used to assert
 * `problems.join(" | ").includes(expect)`. Under that assertion a gate
 * rewritten to audit only the LAST seam of each suite — one word,
 * `seams.slice(-1)` — passed all eleven cases and the whole package and
 * printed the identical "clean", while missing an undeclared `lib/appearance`
 * mock that the real gate catches. It passed because in every case the
 * undeclared seam happened to be last: the word "every" in "names every seam"
 * had no coverage at all, and a self-test that cannot tell those two gates
 * apart is a decoration on the one it is supposed to be proving.
 *
 * So `flags` is the EXACT list: one string per expected problem, in order, and
 * a case whose audit returns a different NUMBER of problems fails. The seam
 * names are written into the expected strings together with the clause that
 * follows them, which pins the reported list from both sides — a report naming
 * one seam too few does not contain the string, and neither does one naming a
 * seam too many. Three cases below carry more than one problem, which is what
 * makes "in order" mean anything: with every case at one problem or zero, a
 * gate that reversed its list or spliced out everything before the last
 * problem passed the whole suite.
 */

/*
 * Helper sources the cases hand to the import walk.
 *
 * Written out here rather than read off disk so that "this helper mounts the
 * page" is a fact of the case rather than a fact of the repository — the walk
 * is then proven against the shape, not against today's filenames, which is
 * the whole point of the D2 repair. `INSTALLS` is the other half: a helper
 * that replaces something real and goes nowhere near the page, so a case can
 * prove the walk does not treat every helper import as a mount. Resolution —
 * which spelling of which path on this disk becomes which file — is not what
 * these prove; `scanFixture` runs the real reader over a real tree for that.
 */
const HELPER_THAT_MOUNTS = 'const { default: Page } = await import("../../src/pages/Home");';
const HELPER_THAT_INSTALLS = "export function installCanvasStub() {}";

const SELFTEST = [
  {
    flags: ["no seam declaration in the header"],
    why: "a suite with no header at all",
    src: 'import { it } from "vitest";\nvi.mock("../src/lib/data", () => ({}));',
  },
  {
    flags: ["no seam declaration in the header"],
    why: "the declaration exists but sits BELOW the imports, where no reader meets it",
    src: [
      'import { it } from "vitest";',
      "/* WHAT THIS MOCKS, AND WHY: `lib/data`, because the page reads through it. */",
      'vi.mock("../src/lib/data", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["no seam declaration in the header"],
    why:
      "THE SAME, IN A FILE WITH NO STATIC IMPORT AT ALL — treating such a file as all " +
      "header was called lenient and was really vacuous: the declaration below the mock " +
      "satisfied the rule the bound exists to enforce",
    src: [
      'const { it } = await import("vitest");',
      'vi.mock("../src/lib/data", () => ({}));',
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
    ].join("\n"),
  },
  {
    flags: ["does not name `lib/appearance`, which this suite replaces"],
    why:
      "ONE MISSING SPACE, UNDER A LINE COMMENT. `import{it}from\"vitest\"` is what a " +
      "formatter with other settings emits, and `/^import\\s/` did not see it — so the " +
      "header boundary fell back to the leading BLOCK comment, which a `//` line above " +
      "it pushes out of reach, and a file with a perfectly good declaration was told it " +
      "had none. The bound has to find the import to be a bound at all",
    src: [
      "// eslint-disable-next-line no-restricted-imports",
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import{it,expect,vi}from"vitest";',
      'vi.mock("../src/lib/appearance", () => ({}));',
      'vi.mock("../src/lib/data", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["does not name `lib/auth-context`, which this suite replaces"],
    why: "a header that has fallen out of date with its own mocks",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      'vi.mock("../src/lib/data", () => ({}));',
      'vi.mock("../src/lib/auth-context", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["does not name `lib/appearance`, which this suite replaces"],
    why:
      "THE UNDECLARED SEAM COMES FIRST AND A DECLARED ONE FOLLOWS IT — a gate that " +
      "looks at only the last seam calls this clean",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      'vi.mock("../src/lib/appearance", () => ({}));',
      'vi.mock("../src/lib/data", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["does not name `lib/appearance`, `lib/theme`, which this suite replaces"],
    why:
      "two undeclared seams with a declared one between them — the report has to " +
      "name both, and only those",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      'vi.mock("../src/lib/appearance", () => ({}));',
      'vi.mock("../src/lib/data", () => ({}));',
      'vi.mock("../src/lib/theme", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["does not name `lib/appearance`, which this suite replaces"],
    why: "a specifier in backticks — one keystroke used to switch this rule off",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      "vi.mock(`../src/lib/appearance`, () => ({}));",
      'vi.mock("../src/lib/data", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["does not name `lib/appearance`, which this suite replaces"],
    why:
      "`vi.doMock` — the same call with hoisting off, a documented vitest API three " +
      "characters from the one being policed, and invisible until it was asked for",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      'vi.doMock("../src/lib/appearance", () => ({}));',
      'vi.mock("../src/lib/data", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["does not name `fetch`, which this suite replaces"],
    why: "a stubbed global left undeclared",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      'vi.stubGlobal("fetch", async () => undefined);',
    ].join("\n"),
  },
  {
    flags: ["does not name `fetch`, which this suite replaces"],
    why:
      "THE PROSE COLLISION — a header saying \"no fetch, no storage, no clock\" contains " +
      "the word `fetch`, and under a bare substring test that was an answer. This is one " +
      "of the two live collisions in this package, staged.",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: nothing — no fetch, no storage, no clock. */",
      'import { it } from "vitest";',
      'vi.stubGlobal("fetch", async () => undefined);',
    ].join("\n"),
  },
  {
    flags: ["does not name `WAKA_API_URL`, which this suite replaces"],
    why: "`vi.stubEnv` replaces something real, and is a sibling of the call above",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: nothing but the network. */",
      'import { it } from "vitest";',
      'vi.stubEnv("WAKA_API_URL", "http://localhost");',
    ].join("\n"),
  },
  {
    flags: ["does not name `lib/appearance`, which this suite replaces"],
    why:
      "the seam IS backticked, in a paragraph ABOVE the declaration — a mention of what " +
      "another suite does is not an answer to what this one replaces",
    src: [
      "/** `lib/appearance` is mocked by `home-sky.test.tsx`, not here. */",
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      'vi.mock("../src/lib/appearance", () => ({}));',
      'vi.mock("../src/lib/data", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["does not name `helpers/render-home`, which this suite replaces"],
    why: "a helper that installs a canvas and a clock, unmentioned",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data` and `lib/api`. */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'vi.mock("../src/lib/data", () => ({}));',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["does not name `support/canvas-stub`, which this suite replaces"],
    why:
      "A DECLARABLE HELPER THAT IS NOT UNDER `helpers/`. Rule 1's third seam kind used " +
      "to be keyed to that literal directory name — the same bet rule 2 was rewritten to " +
      "stop making — so `./support/canvas-stub` installed a canvas and owed nobody a word",
    helpers: { "./support/canvas-stub": HELPER_THAT_INSTALLS },
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      'import "./support/canvas-stub";',
    ].join("\n"),
  },
  {
    flags: ["does not name `helpers/canvas-stub`, which this suite replaces"],
    why: "a helper pulled in for its side effects alone, with no bindings to give it away",
    helpers: { "./helpers/canvas-stub": HELPER_THAT_INSTALLS },
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      'import "./helpers/canvas-stub";',
      'vi.mock("../src/lib/data", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["imports `helpers/ghost`, which the gate could not read"],
    why:
      "an import the walk cannot open — silence here would make rule 2 a guess",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, and `helpers/ghost` for the clock. */",
      'import { it } from "vitest";',
      'import { tick } from "./helpers/ghost";',
      'vi.mock("../src/lib/data", () => ({}));',
    ].join("\n"),
  },
  {
    flags: [
      "imports `helpers/ghost-a`, which the gate could not read",
      "imports `helpers/ghost-b`, which the gate could not read",
    ],
    why:
      "TWO of them, in order — reporting only the first unreadable import leaves the " +
      "second file exactly as unread and the report exactly as confident",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: nothing; the two below are clocks. */",
      'import { it } from "vitest";',
      'import { tick } from "./helpers/ghost-a";',
      'import { tock } from "./helpers/ghost-b";',
    ].join("\n"),
  },
  {
    flags: ["the header declares seams but this suite replaces none"],
    why: "a suite that mocks nothing and does not say the word",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: the layers beneath it. */",
      'import { it } from "vitest";',
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why: "THE INCIDENT: the world mounted on `lib/api`, declared honestly and still wrong",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, and `helpers/render-home` for the",
      " * canvas and the clock. The network is the layer under the page.",
      " */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why: "the same, reaching pages/Home directly rather than through the helper",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/api`. */",
      'import { it } from "vitest";',
      'const page = await import("../src/pages/Home");',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why:
      "THE INCIDENT WITH THE EXTENSION TYPED IN — `pages/Home.tsx`, which the first " +
      "version of this rule read as a different module entirely",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/api`, the layer under the page. */",
      'import { it } from "vitest";',
      'import Home from "../src/pages/Home.tsx";',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why:
      "THE MOCK IS COMMENTED OUT. This is the one that matters, and it was live: a " +
      "`vi.mock(\"../src/lib/data\")` inside a block comment satisfied rule 2, so the " +
      "whole gate could be switched off for a file by wrapping four lines in the " +
      "thing a person leaves behind while asking what happens without them. The " +
      "suite is then the original incident exactly — world mounted, `lib/api` " +
      "underneath, loaders throwing into the dev fixture — and reported clean",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, and `helpers/render-home` for the",
      " * canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'vi.mock("../src/lib/api", () => ({}));',
      "/* TODO(sprint-4): put this back once the loader shapes settle.",
      'vi.mock("../src/lib/data", () => ({}));',
      "*/",
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why:
      "THE SAME MOCK COMMENTED OUT THE WAY AN EDITOR DOES IT — `//` on each line of " +
      "the selection, which is what every toggle-comment key emits and is far commoner " +
      "than reaching for `/* */`. The case above pinned only the block spelling, so the " +
      "`//` half of the comment handling could be deleted outright with all thirty-odd " +
      "cases printing `passed`, and the real `home-dial.test.tsx` toggled off this way " +
      "reported clean. One shape of a rule is not the rule",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, and `helpers/render-home` for the",
      " * canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'vi.mock("../src/lib/api", () => ({}));',
      '// vi.mock("../src/lib/data", async (importOriginal) => {',
      "//   const actual = await importOriginal();",
      "//   return { ...actual, ...dataMockFrom(FACTS) };",
      "// });",
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why:
      "AND THE SAME MOCK PARKED AT THE END OF A LINE THAT STILL RUNS. A comment on the " +
      "same line as code is TRAILING trivia, and leading trivia stops collecting at the " +
      "first thing that is not a newline — so a walk that asks only for leading comments " +
      "never sees this one, blanks nothing, and reads the note as a live mock. Two files " +
      "in this package write a trailing comment today",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, and `helpers/render-home` for the",
      " * canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'vi.mock("../src/lib/api", () => ({})); // vi.mock("../src/lib/data", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why:
      "THE SAME MOCK, COMMENTED OUT, WITH TWO ORDINARY LINES AROUND IT THAT USED TO " +
      "TURN THE COMMENT BACK INTO CODE. The hand-written scanner this file used to " +
      "carry had no grammar, so the backtick inside the regular expression literal " +
      "opened a template string bounded only by the end of the file: everything down " +
      "to the next backtick was skipped as string, the comment in the middle of it was " +
      "never blanked, and the mock inside the comment counted. Two lines nobody would " +
      "look at twice, and rule 2 was off for the file — D16's own incident, reopened " +
      "inside D16's own repair. This is the case that fails if the parse is ever traded " +
      "back for a scanner",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, `lib/data`, and `helpers/render-home`",
      " * for the canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'const stripped = (s) => s.replace(/`/g, "");',
      'vi.mock("../src/lib/api", () => ({}));',
      "/* TODO(sprint-4): put this back once the loader shapes settle.",
      'vi.mock("../src/lib/data", () => ({}));',
      "*/",
      'it("keeps the label", () => {',
      '  expect(stripped("`a`")).toBe(`a`);',
      "});",
    ].join("\n"),
  },
  {
    flags: [],
    key: "a-self-test-case.test.ts",
    why:
      "A `.ts` SUITE THAT WRITES `<T>value`, WITH ITS REAL MOCKS UNDER IT. That is a " +
      "type assertion in TypeScript and an opening JSX tag in TSX, so parsing every " +
      "file as TSX — the obvious simplification, and every other case here allows it — " +
      "turns both `vi.mock` lines below into the TEXT of an element that never closes. " +
      "They are blanked as prose, the suite is left mocking nothing, and a file that " +
      "correctly mocks `lib/data` is accused of mounting the world without it. The " +
      "dialect is part of the question and this is the case that says so; `Profile" +
      ".test.ts` writes generic calls in a `.ts` file today",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/data` because the page reads through the",
      " * loaders, `lib/api` for the group reads, and `helpers/render-home` for the",
      " * canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      "const root = <HTMLElement>document.body;",
      'vi.mock("../src/lib/data", () => ({}));',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why:
      "AND THE MOCK THAT ONLY EXISTS ON A SCREEN. The sentence between `<p>` and `</p>` " +
      "is shown to a reader, not run, and it was being read as code — so a suite that " +
      "mounts the world on `lib/api` and renders the words `vi.mock(\"../src/lib/data\")` " +
      "as help text had rule 2 satisfied by a paragraph. Same class as the comment, one " +
      "spelling over, and it reported clean until this case existed",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, `lib/data`, and `helpers/render-home`",
      " * for the canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'vi.mock("../src/lib/api", () => ({}));',
      "export const Hint = () => (",
      '  <p>To fix this suite, add vi.mock("../src/lib/data") above the imports.</p>',
      ");",
    ].join("\n"),
  },
  {
    flags: ["does not name `fetch`, which this suite replaces"],
    why:
      "A `//` INSIDE A STRING IS NOT A COMMENT. `\"http://localhost\"` carries the two " +
      "characters that open a line comment, and a reader that blanks from there loses " +
      "the rest of the line — here the `vi.stubGlobal` sharing it, which then goes " +
      "undeclared and unreported. The old scanner bought this by skipping strings " +
      "by hand; a parse gets it from the grammar, and this case is what notices if it " +
      "is ever bought by hand again",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `WAKA_API_URL`, so nothing reaches the network. */",
      'import { it } from "vitest";',
      "beforeEach(() => {",
      '  vi.stubEnv("WAKA_API_URL", "http://localhost"); vi.stubGlobal("fetch", stub);',
      "});",
    ].join("\n"),
  },
  {
    flags: ["does not name `lib/appearance`, which this suite replaces"],
    why:
      "AN APOSTROPHE IN JSX TEXT IS NOT A QUOTE. \"this room's roll\" opens a string for " +
      "anything reading character by character, and with no partner on the line the " +
      "reader goes blind from there to the next one — over both mocks below, so a suite " +
      "that replaces two layers is reported as replacing none. The old scanner bounded " +
      "quotes to their line to survive this; the parse knows it is text",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      "const empty = <p>this room's roll is still empty</p>;",
      'vi.mock("../src/lib/data", () => ({}));',
      'vi.mock("../src/lib/appearance", () => ({}));',
    ].join("\n"),
  },
  {
    flags: [],
    why:
      "A SENTENCE ABOUT AN IMPORT IS NOT AN IMPORT. The header explains that a helper " +
      "was deleted, writing the specifier it used to be taken `from`; the gate read " +
      "that as an import it could not open and failed a suite whose only import is " +
      "vitest",
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: nothing. The frozen clock this suite used to take",
      ' * from "./helpers/ghost" went away with the loader that needed it.',
      " */",
      'import { it } from "vitest";',
    ].join("\n"),
  },
  {
    flags: [],
    why:
      "A SENTENCE DENYING THE MOUNT IS NOT A MOUNT. The gate used to answer a header " +
      "saying the suite never renders the page by accusing it of rendering the page — " +
      "flatly contradicting, in its own output, the line it had just read",
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: nothing. This suite never renders",
      ' * "../src/pages/Home"; it asks the loaders directly.',
      " */",
      'import { it } from "vitest";',
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why:
      "AN ASSERTION MESSAGE ENDING IN THE WORD `from`, WITH A REAL IMPORT BEHIND IT. " +
      "The capture ran from that string's closing quote to the next quote anywhere " +
      "below — swallowing the `await import(…)` line whole, so the helper that mounts " +
      "the page was never opened and the suite reported clean. Two suites in this " +
      "package end a message with `from` today; this is that shape with a mount " +
      "underneath it",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, and `helpers/render-home` for the",
      " * canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'vi.mock("../src/lib/api", () => ({}));',
      'it("counts the rows", async () => {',
      '  expect(rows.length, "the memories it was read from").toBe(3);',
      '  const { mountWorld } = await import("./helpers/render-home");',
      "});",
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why:
      "THE INCIDENT THROUGH A SECOND MOUNTING HELPER — same work, different " +
      "filename, and the first version of this rule knew only one name",
    helpers: { "./helpers/render-page": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, and `helpers/render-page` for the",
      " * canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountPage } from "./helpers/render-page";',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why:
      "THE INCIDENT TWO HELPERS DEEP — suite to `chain-a` to `chain-b` to the page. " +
      "The transitive walk is the property rule 2 is sold on, and a depth-1 version of " +
      "it passed every case here until this one existed",
    helpers: {
      "./helpers/chain-a": 'export { mountPage } from "./chain-b";',
      "./chain-b": HELPER_THAT_MOUNTS,
    },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, and `helpers/chain-a` for the canvas",
      " * and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountPage } from "./helpers/chain-a";',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    why:
      "THE INCIDENT FROM A MOUNTING MODULE OUTSIDE `test/` — `test-support/render-page`, " +
      "four lines, neither a rename nor product code, and invisible while the walk " +
      "stopped at the edge of `test/`",
    helpers: { "../test-support/render-page": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, and `test-support/render-page` for",
      " * the canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountPage } from "../test-support/render-page";',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    flags: ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"],
    onDisk: true,
    why:
      "THE REAL HELPER, THROUGH THE REAL READER — `test/helpers/render-home.tsx` as it " +
      "stands in this repository today, so that a rename or a move of the one helper " +
      "six suites mount the world through cannot leave this gate quietly answering " +
      "about a file that is no longer there",
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, and `helpers/render-home` for the",
      " * canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    flags: [
      "does not name `lib/appearance`, which this suite replaces",
      "MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`",
    ],
    why:
      "TWO PROBLEMS AT ONCE, IN ORDER — an undeclared seam and a world mounted on the " +
      "wrong one. With every case at one problem or none, a gate that reversed its list " +
      "or reported only its last problem passed everything here",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, and `helpers/render-home` for the",
      " * canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'vi.mock("../src/lib/appearance", () => ({}));',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    flags: [
      "does not name `lib/appearance`, which this suite replaces",
      "imports `helpers/ghost`, which the gate could not read",
      "MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`",
    ],
    why:
      "ALL THREE KINDS AT ONCE, IN THE ORDER THE FILE PROMISES — declaration first, " +
      "unreadable imports next, rule 2 last so the one failure that means GREEN AND " +
      "WRONG is the last thing on the screen",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/api`, `helpers/render-home` for the canvas,",
      " * and `helpers/ghost` for the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'import { tick } from "./helpers/ghost";',
      'vi.mock("../src/lib/appearance", () => ({}));',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    flags: [],
    why: "a suite that mocks nothing and says so",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: nothing — these are pure functions. */",
      'import { it } from "vitest";',
    ].join("\n"),
  },
  {
    flags: [],
    why: "a complete and accurate declaration for a suite that mounts the world",
    helpers: { "./helpers/render-home": HELPER_THAT_MOUNTS },
    src: [
      "/**",
      " * WHAT THIS MOCKS, AND WHY: `lib/data` because the page reads its layers",
      " * through the loaders, `lib/api` for the group reads that have no loader,",
      " * `lib/auth-context` for the session, and `helpers/render-home` for the",
      " * canvas and the clock.",
      " */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'vi.mock("../src/lib/data", () => ({}));',
      'vi.mock("../src/lib/api", () => ({}));',
      'vi.mock("../src/lib/auth-context", () => ({}));',
    ].join("\n"),
  },
  {
    flags: [],
    why:
      "the same mock written with its extension — `lib/data.ts` and `lib/data` are the " +
      "same sentence, and a gate that told them apart would be teaching punctuation",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      'vi.mock("../src/lib/data.ts", () => ({}));',
    ].join("\n"),
  },
  {
    flags: [],
    why:
      "a helper that installs a canvas and never touches the page — importing a " +
      "helper is not by itself mounting the world, or rule 2 would be an alarm " +
      "nobody could switch off",
    helpers: { "./helpers/canvas-stub": HELPER_THAT_INSTALLS },
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `helpers/canvas-stub`, for the canvas. */",
      'import { it } from "vitest";',
      'import { installCanvasStub } from "./helpers/canvas-stub";',
    ].join("\n"),
  },
  {
    flags: [],
    why: "a spy is an instrument, not a seam, and must not be demanded",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: nothing — there is no layer beneath it. */",
      'import { it } from "vitest";',
      'const warn = vi.spyOn(console, "warn");',
    ].join("\n"),
  },
  {
    flags: [],
    why:
      "`vi.mocked` reads a mock that already exists rather than creating a seam — " +
      "`auth-boundary.test.ts` uses it throughout and declares none of them, and a " +
      "rule widened to `vi.<anything>(` would demand a paragraph about an accessor",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/api`, the layer beneath the provider. */",
      'import { it } from "vitest";',
      'vi.mock("../src/lib/api", () => ({}));',
      "vi.mocked(fetchCurrentViewer).mockResolvedValue(null);",
    ].join("\n"),
  },
];

/**
 * The reader a string-only case gets.
 *
 * Helpers the case wrote out are readable; any other relative import is
 * deliberately UNREADABLE rather than absent, so that a case which forgets to
 * supply a helper it imports says so loudly instead of quietly being audited
 * as a file that mounts nothing. Packages and product code under `src/` are
 * outside the walk, exactly as on disk.
 *
 * It is keyed by the specifier as written rather than by a resolved path,
 * which is the one way it is unlike `readerUnder`: a string case cannot have a
 * directory. That is why the fixture below exists — resolution is proven by
 * running the real reader over a real tree, and these cases prove everything
 * that happens after a file has been opened.
 */
function readerFor(helpers) {
  return (specifier) => {
    if (Object.hasOwn(helpers, specifier)) {
      return { kind: "read", key: seamName(specifier), source: helpers[specifier] };
    }
    if (!/^\.{1,2}\//.test(specifier)) return { kind: "outside" };
    if (/(^|\/)src\//.test(specifier)) return { kind: "outside" };
    return { kind: "unreadable", key: seamName(specifier) };
  };
}

/*
 * THE TREE THE SCAN LOOP IS PROVEN AGAINST.
 *
 * Seven suites, each staging exactly one thing about the loop rather than
 * about the audit, so that when one goes missing the report says which
 * mechanism lost it:
 *
 *   clean.test.ts            passes; the scan must not report it
 *   undeclared.test.tsx      a `.tsx` file with ONE problem — the file that
 *                            disappears when `walk`'s pattern loses `tsx`, and
 *                            the one that disappears when the failing list is
 *                            gathered with `problems.length > 1`
 *   pages/nested.test.ts     one directory down — gone if `walk` stops
 *                            recursing
 *   chain.test.ts            reaches the page through two helpers on disk, so
 *                            the transitive walk is proven through the real
 *                            reader and not only through written-out strings
 *   moved-helper.test.ts     reaches the page through a mounting module OUTSIDE
 *                            `test/`; this is the original incident with the
 *                            helper moved one directory, which the walk used
 *                            to call "outside" and report clean
 *   through-product.test.ts  reaches a file under `src/` that names the page —
 *                            and must stay CLEAN, because the header says
 *                            product code is out of scope and a documented
 *                            blind spot is worth pinning from both sides
 *   ghost.test.ts            imports a file that does not exist, inside the
 *                            walkable area, and must be reported as unreadable
 *                            with the path the real reader produces
 *
 * Written to a temporary directory rather than checked in, because files named
 * `*.test.tsx` that deliberately violate the gate would be collected by vitest
 * and read by the next person grepping for a real suite.
 */
const FIXTURE = {
  "test/clean.test.ts": [
    "/** WHAT THIS MOCKS, AND WHY: nothing — it is a fixture for the gate's own scan. */",
    'import { it } from "vitest";',
  ].join("\n"),

  "test/undeclared.test.tsx": [
    "/** WHAT THIS MOCKS, AND WHY: nothing, says this header, untruthfully. */",
    'import { it } from "vitest";',
    'vi.mock("../src/lib/appearance", () => ({}));',
  ].join("\n"),

  "test/pages/nested.test.ts": [
    "/** WHAT THIS MOCKS, AND WHY: `lib/api`, which is the wrong layer on purpose. */",
    'import { it } from "vitest";',
    'import Home from "../../src/pages/Home";',
    'vi.mock("../../src/lib/api", () => ({}));',
  ].join("\n"),

  "test/chain.test.ts": [
    "/** WHAT THIS MOCKS, AND WHY: `lib/api`, and `helpers/chain-a` for the clock. */",
    'import { it } from "vitest";',
    'import { mountPage } from "./helpers/chain-a";',
    'vi.mock("../src/lib/api", () => ({}));',
  ].join("\n"),
  /*
   * These two import each other, which is not decoration: helper graphs really
   * do have cycles, and the `seen` set in `followImports` is the only reason
   * one does not walk forever. A gate that dies of a stack overflow on a
   * legitimate pair of helpers is a gate somebody deletes.
   */
  "test/helpers/chain-a.ts": 'export { mountPage } from "./chain-b";',
  "test/helpers/chain-b.ts": [
    'import { frame } from "./chain-a";',
    'export const mountPage = async () => (await import("../../src/pages/Home")).default;',
    "export const frames = () => frame;",
  ].join("\n"),

  "test/moved-helper.test.ts": [
    "/** WHAT THIS MOCKS, AND WHY: `lib/api`, and `support/render-page` for the canvas. */",
    'import { it } from "vitest";',
    'import { mountPage } from "../support/render-page";',
    'vi.mock("../src/lib/api", () => ({}));',
  ].join("\n"),
  "support/render-page.tsx":
    'export const mountPage = async () => (await import("../src/pages/Home")).default;',

  "test/through-product.test.ts": [
    "/** WHAT THIS MOCKS, AND WHY: nothing — the walk must not follow this into `src/`. */",
    'import { it } from "vitest";',
    'import { App } from "../src/app-shim";',
  ].join("\n"),
  /*
   * The specifier inside this one is written the way a SUITE would write it,
   * not the way a file in `src/` would. The case is about whether the walk
   * opens the file at all: if it ever does, this text makes the suite above
   * mount the world and the fixture turns red on the widened scope rather than
   * on a coincidence of paths.
   */
  "src/app-shim.ts": 'export const App = () => import("../src/pages/Home");',

  "test/ghost.test.ts": [
    "/** WHAT THIS MOCKS, AND WHY: nothing; `test/helpers/ghost` is a clock. */",
    'import { it } from "vitest";',
    'import { tick } from "./helpers/ghost";',
  ].join("\n"),
};

const FIXTURE_SUITES = [
  "chain.test.ts",
  "clean.test.ts",
  "ghost.test.ts",
  "moved-helper.test.ts",
  "pages/nested.test.ts",
  "through-product.test.ts",
  "undeclared.test.tsx",
];

const FIXTURE_FAILING = [
  ["chain.test.ts", ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"]],
  ["ghost.test.ts", ["imports `test/helpers/ghost`, which the gate could not read"]],
  ["moved-helper.test.ts", ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"]],
  ["pages/nested.test.ts", ["MOUNTS THE WORLD AND DOES NOT MOCK `lib/data`"]],
  ["undeclared.test.tsx", ["does not name `lib/appearance`, which this suite replaces"]],
];

/* Two clean suites and nothing else, for the run that must exit 0. */
const CLEAN_FIXTURE = {
  "test/clean.test.ts": FIXTURE["test/clean.test.ts"],
  "test/through-product.test.ts": FIXTURE["test/through-product.test.ts"],
  "src/app-shim.ts": FIXTURE["src/app-shim.ts"],
};

/* Helpers but no suites: the shape of a scan pointed at the wrong directory. */
const EMPTY_FIXTURE = { "test/helpers/chain-a.ts": FIXTURE["test/helpers/chain-a.ts"] };

function writeFixture(files) {
  const root = mkdtempSync(join(tmpdir(), "seam-gate-fixture-"));
  for (const [path, source] of Object.entries(files)) {
    const full = join(root, ...path.split("/"));
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, source, "utf8");
  }
  return root;
}

function withFixture(files, fn) {
  const root = writeFixture(files);
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/*
 * WHAT ACTUALLY RAN — WRITTEN BY THE WORK, NOT BY THE PRINTER.
 *
 * The proof line reads these two counters and nothing else. That is the
 * repair of a hole in the layers this file grew last round: the line used to
 * be built from `FIXTURE_SUITES.length` — the EXPECTED list, not what the walk
 * found — and from a `return 4` at the bottom of `endToEnd`. Both are
 * constants, so both survived their own subject being deleted. Commenting out
 * the `scanFixture(failures);` call left the gate still announcing a 7-suite
 * scan; replacing `endToEnd(failures)` with the literal 4 left it still
 * announcing four child runs; and the outside test that reads those numbers
 * could not tell either from the truth.
 *
 * A counter incremented where the work happens cannot be lied to by deleting
 * the call, because the call is the only thing that increments it. That is the
 * same argument this file makes about `selftest()` in its own header, one
 * frame down. WHAT IT DOES NOT COVER is somebody editing the proof line
 * itself, or handing these variables a value by hand — a forgery is always one
 * step past a deletion, and the regress has to stop somewhere. It stops here,
 * said out loud, because the alternative is a gate that checks its own
 * checker for ever.
 */
let fixtureSuitesWalked = 0;
let childRunsSpawned = 0;

/**
 * LAYER TWO: the scan loop, over a tree with known answers.
 *
 * `walk` and `scan` are asserted separately because they fail differently. A
 * file the walk never finds and a file the scan never reports are the same
 * silence in the terminal and two different bugs, and the first is the one
 * that has actually happened here — twice, in two gates, in this package.
 */
function scanFixture(failures) {
  withFixture(FIXTURE, (root) => {
    const testDir = join(root, "test");

    const found = walk(testDir)
      .map((file) => relative(testDir, file).split(sep).join("/"))
      .sort();
    if (found.join("|") !== FIXTURE_SUITES.join("|")) {
      failures.push(
        "  FILE DISCOVERY: `walk` did not find the suites the fixture contains.\n" +
          `      expected: ${JSON.stringify(FIXTURE_SUITES)}\n` +
          `      found:    ${JSON.stringify(found)}\n` +
          "      A suite the walk never opens is audited by nothing, and the report\n" +
          "      for it reads exactly like a suite with no problems.\n",
      );
    }

    const { failing } = scan({ root, testDir });
    const said = failing.map(({ file, problems }) => [file, problems]);
    const wanted = FIXTURE_FAILING.map(([file]) => file).join("|");
    if (said.map(([file]) => file).join("|") !== wanted) {
      failures.push(
        "  THE FAILING LIST: `scan` reported a different set of suites than the\n" +
          "      fixture stages.\n" +
          `      expected: ${JSON.stringify(FIXTURE_FAILING.map(([f]) => f))}\n` +
          `      reported: ${JSON.stringify(said.map(([f]) => f))}\n`,
      );
      return;
    }
    for (const [index, [file, expected]] of FIXTURE_FAILING.entries()) {
      const [, problems] = said[index];
      const ok =
        problems.length === expected.length &&
        expected.every((flag, i) => problems[i].includes(flag));
      if (!ok) {
        failures.push(
          `  THE FAILING LIST: test/${file} was reported, but not for what it stages.\n` +
            `      expected ${expected.length} problem(s): ${JSON.stringify(expected)}\n` +
            `      got ${problems.length}: ` +
            `${JSON.stringify(problems.map((p) => p.split("\n")[0]))}\n`,
        );
      }
    }

    /*
     * THE RECEIPT IS WRITTEN LAST, AND THAT POSITION IS THE POINT. It used to
     * sit next to the `walk` call above, where it recorded that the walk had
     * happened and nothing about whether anything was compared to it — so
     * `if (1) return;` in front of `scan(…)` gutted this whole layer with the
     * proof line still announcing a seven-suite scan and the outside test
     * still satisfied. Down here the number is only reached by a run that got
     * all the way through both comparisons, which is the thing being claimed.
     */
    fixtureSuitesWalked = found.length;
  });
}

/**
 * LAYER THREE: this file, as a process, against those trees and against this
 * package.
 *
 * The only thing layer two cannot see is what the gate DOES with a verdict it
 * has reached correctly. A `report` that prints every failure and returns 0,
 * or an entry point that exits 0 regardless, reads identically in a terminal
 * and is worth nothing in `pnpm test` — and that mutation survived every
 * earlier version of this self-test. So the runs below read the real exit
 * status and the real output.
 *
 * The last of them takes no arguments and scans this repository, because the
 * other three all arrive through `--scan` and a path nobody uses is not the
 * path that has to be right.
 */

/*
 * The marker that stops this from being an infinite regress. A child audits
 * its tree and reports; it does not spawn children of its own.
 */
const NO_SPAWN = "SEAM_GATE_NO_SPAWN";

function runNode(args) {
  /*
   * Both streams are piped rather than inherited. A child staging five
   * deliberate failures would otherwise print its whole report into the
   * terminal of a gate run that is passing, and a reader who saw that would
   * reasonably stop trusting either message.
   */
  const options = {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, [NO_SPAWN]: "1" },
  };
  try {
    const stdout = execFileSync(process.execPath, [THIS_FILE, ...args], options);
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  } finally {
    /*
     * The receipt for one child, written by the only line that can spawn one.
     * A run that exits 1 is as real as one that exits 0 — both are the gate
     * having been executed end to end — so this sits in `finally` rather than
     * on either branch.
     */
    childRunsSpawned += 1;
  }
}

const runAgainst = (root) => runNode(["--scan", root]);

function endToEnd(failures) {
  if (process.env[NO_SPAWN]) return;

  withFixture(FIXTURE, (root) => {
    const run = runAgainst(root);
    if (run.status !== 1) {
      failures.push(
        `  THE EXIT CODE: five failing suites and the gate exited ${run.status}.\n` +
          "      A gate that prints its failures and exits 0 is a gate CI ignores.\n",
      );
    }
    /*
     * THE HEADLINE, WHICH NOTHING USED TO READ. `5 of 7 suite(s)` is the one
     * line a person actually acts on, and both numbers in it were asserted by
     * nobody: rewriting it to `${failing.length - 1} of ${suites.length + 7}`
     * left every layer of this self-test green. A count in a report is a claim
     * like any other.
     */
    const headline = `${FIXTURE_FAILING.length} of ${FIXTURE_SUITES.length} suite(s)`;
    if (!run.stderr.includes(headline)) {
      failures.push(
        `  THE HEADLINE: the report did not say "${headline}".\n` +
          "      That line is the summary the reader believes without counting.\n",
      );
    }

    for (const [file, problems] of FIXTURE_FAILING) {
      /*
       * THE WHOLE PATH, NOT A SUBSTRING OF IT. `test/chain.test.ts` sits
       * inside `test/test/chain.test.ts`, which is exactly what this report
       * prints when the entry line hands `scan` the package root instead of
       * its `test/` directory — every path in the output then names a file
       * that does not exist, and a substring check cannot tell that from a
       * correct run.
       */
      if (!run.stderr.includes(`\n  test/${file}\n`)) {
        failures.push(
          `  THE REPORT: test/${file} failed the audit and was not named in the output.\n` +
            "      A failure nobody can find in the terminal is a failure nobody fixes,\n" +
            "      and a path printed with the wrong prefix is one nobody can open.\n",
        );
      }
      /*
       * The file name alone is not the report. A run that printed a list of
       * paths and dropped every reason would satisfy the check above and tell
       * the person reading it nothing about what to change.
       */
      for (const problem of problems) {
        if (!run.stderr.includes(problem)) {
          failures.push(
            `  THE REPORT: test/${file} was named, but not its reason.\n` +
              `      missing from the output: ${JSON.stringify(problem)}\n`,
          );
        }
      }
    }
    for (const quiet of ["clean.test.ts", "through-product.test.ts"]) {
      if (run.stderr.includes(quiet)) {
        failures.push(
          `  THE REPORT: test/${quiet} passes the audit and was named as failing.\n`,
        );
      }
    }
  });

  withFixture(CLEAN_FIXTURE, (root) => {
    const run = runAgainst(root);
    if (run.status !== 0 || !run.stdout.includes("clean — 2 suites")) {
      failures.push(
        `  THE CLEAN PATH: a tree with nothing wrong exited ${run.status} saying\n` +
          `      ${JSON.stringify(run.stdout.trim() || run.stderr.trim())}\n` +
          '      — it should exit 0 and say "clean — 2 suites".\n',
      );
    }
  });

  withFixture(EMPTY_FIXTURE, (root) => {
    const run = runAgainst(root);
    if (run.status !== 1 || !run.stderr.includes("found NO suites at all")) {
      failures.push(
        `  THE EMPTY SCAN: a tree with no suites in it exited ${run.status} saying\n` +
          `      ${JSON.stringify(run.stdout.trim() || run.stderr.trim())}\n` +
          "      — scanning nothing and printing `clean` is how a gate that has\n" +
          "      lost its own directory looks from the outside.\n",
      );
    }
  });

  /*
   * AND THE WAY THIS PACKAGE ACTUALLY RUNS IT: no arguments, this repository,
   * as a process. The three runs above all reach the gate through `--scan`,
   * and a gate proven only on the path nobody uses is the shape of every bug
   * in this file's history.
   *
   * WHAT IT MAY NOT ASSERT IS THAT THE REPOSITORY IS CLEAN. The first draft
   * did, and a probe showed what that costs: with one real undeclared
   * `vi.stubGlobal("fetch")` added to `i18n.test.ts`, the gate printed
   * "SELF-TEST FAILED — the gate cannot see what it claims to" and never named
   * the suite. A working gate accusing itself of blindness, while hiding the
   * violation it had correctly found, is a worse failure than the one it was
   * built to prevent. So this asks only about THIS FILE: that the no-argument
   * path proves itself before it judges anything, and that whichever verdict
   * it reaches, it leaves with the matching code.
   */
  const here = runNode([]);
  const proved = here.stdout.indexOf("self-test passed");
  const clean = here.stdout.indexOf("seams: clean —");
  const complained = here.stderr.includes("do not say what layer they replace");
  if (proved === -1 || (clean !== -1 && clean < proved)) {
    failures.push(
      "  THE REAL RUN: `node scripts/check-seams.mjs` reached a verdict about this\n" +
        "      package without first printing that it had proved itself.\n" +
        `      stdout: ${JSON.stringify(here.stdout.trim())}\n`,
    );
  }
  if ((clean !== -1 && here.status !== 0) || (complained && here.status !== 1)) {
    failures.push(
      `  THE REAL RUN: the no-argument path printed one verdict and exited ${here.status}.\n` +
        "      An exit code that disagrees with the report is the half of a gate\n" +
        "      that CI reads, and the half a person never sees.\n",
    );
  }
}

function selftest() {
  const failures = [];
  for (const c of SELFTEST) {
    /*
     * The on-disk case is anchored at a suite path that does not exist, which
     * is fine and is the point: only its DIRECTORY is used, so `./helpers/…`
     * resolves exactly as it would from any real suite, and the case is about
     * this repository's own helper rather than about any particular file being
     * scanned.
     */
    const read = c.onDisk ? readerUnder(PACKAGE_ROOT) : readerFor(c.helpers ?? {});
    /*
     * The key is a filename because the parse needs one — `.ts` and `.tsx` are
     * different grammars for `<T>value`, and a case that stages that has to be
     * able to say which it is. Cases that do not care get a `.tsx` name, the
     * more permissive of the two, and the default is written here rather than
     * left to `commentsBlanked` so that a reader of the cases can see it.
     */
    const key = c.onDisk
      ? join(TEST_DIR, "any-suite.test.tsx")
      : (c.key ?? "a-self-test-case.test.tsx");
    const said = auditSource(c.src, read, key);
    const ok = said.length === c.flags.length && c.flags.every((f, i) => said[i].includes(f));
    if (!ok) {
      failures.push(
        `  ${c.why}\n` +
          `      ${c.src.replace(/\n/g, "\n      ")}\n` +
          `      expected ${c.flags.length} problem(s): ${JSON.stringify(c.flags)}\n` +
          `      got ${said.length}: ${JSON.stringify(said.map((s) => s.split("\n")[0]))}\n`,
      );
    }
  }

  scanFixture(failures);
  endToEnd(failures);

  if (failures.length > 0) {
    console.error(
      "\nseam gate SELF-TEST FAILED — the gate cannot see what it claims to.\n" +
        "A clean report from a blind gate is worse than no gate.\n\n" +
        failures.join("\n"),
    );
    process.exit(1);
  }
  console.log(
    `seams: self-test passed (${SELFTEST.length} audit cases, ` +
      `a ${fixtureSuitesWalked}-suite scan over the real walk, ` +
      `${childRunsSpawned} end-to-end runs)`,
  );
}

/*
 * `--scan <root>` audits some other tree: the suites under `<root>/test`, with
 * imports followed anywhere under `<root>` except `src/` and `node_modules/`.
 * It exists so the self-test can run this file end to end against a fixture
 * whose answers are known. Such a run does not self-test: it is the SUBJECT of
 * a self-test already running in the parent, and proving itself again there
 * would only make the parent slower. What stops the regress is the `NO_SPAWN`
 * marker, not this branch. Nothing else uses `--scan`; `pnpm test` runs this
 * file with no arguments, and that path self-tests before it scans anything.
 *
 * BOTH PATHS LEAVE THROUGH THE SAME LINE, deliberately. When the two exits
 * were written separately, the one the self-test could reach was covered and
 * the one `pnpm test` actually uses was not — so `process.exit(0)` in the real
 * path was a mutation that printed every failure and told CI everything was
 * fine, with 34 cases and a fixture scan still saying "passed". One exit site
 * means the child runs below cover the line this package runs.
 */
const scanFlag = process.argv.indexOf("--scan");
const root = scanFlag === -1 ? PACKAGE_ROOT : resolve(process.argv[scanFlag + 1]);
if (scanFlag === -1) selftest();
process.exit(report(scan({ root, testDir: join(root, "test") })));
