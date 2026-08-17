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
 *      MOCKS`, and that paragraph NAMES every seam the file actually replaces.
 *      Not "has a paragraph" — names them. A file that adds
 *      `vi.mock("../src/lib/data")` and does not say so fails, which is the
 *      only version of this rule that stays true as files change. Where a
 *      suite replaces nothing the paragraph must say so, in the word
 *      "nothing"; that is a real answer and the gate accepts it as one.
 *      "Names them" means the header contains the string, which is weaker than
 *      it sounds — see the first bullet under WHAT THIS GATE CANNOT SEE.
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
 *   - RULE 1 IS A SUBSTRING TEST over the whole header, so a seam name that
 *     also occurs in ordinary prose satisfies it by accident. A header saying
 *     "no fetch, no storage, no clock" already contains "fetch", and would
 *     accept a `vi.stubGlobal("fetch", …)` added underneath it. The rule
 *     reliably catches the case it was built for — a mock added and never
 *     written down in a header that does not discuss it — and does not catch a
 *     header whose prose happens to collide. Delimiting the names would fix
 *     this and is worth doing: the codebase already writes them in backticks,
 *     so requiring `` `lib/data` `` rather than `lib/data` is a cheap and
 *     greppable rule. It is not done here because it is a change to twelve
 *     headers rather than to this file, and half-doing it would be the same
 *     overclaim this paragraph exists to withdraw.
 *   - THE IMPORT WALK STOPS AT THE EDGE OF `test/`. A suite that reaches the
 *     page through PRODUCT code — importing `src/App`, which renders
 *     `pages/Home` — is invisible to rule 2, because following the product's
 *     own import graph is a different and much larger program. No suite does
 *     that today; if one is written, this is the sentence that was wrong.
 *   - It reads `vi.mock` and `vi.stubGlobal` and nothing else. A suite that
 *     reaches into `globalThis` by hand, or swaps a method with
 *     `Object.defineProperty`, replaces something this gate will not ask it to
 *     declare. `auth-boundary.test.ts` does exactly that with `localStorage`
 *     and declares it anyway, because the rule is about honesty and the gate
 *     is only the floor under it.
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
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const TEST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "test");

/**
 * The phrase a header has to carry.
 *
 * One fixed phrase rather than a list of accepted wordings, because the point
 * is that a reader opening any suite in this package finds the same words in
 * the same place. It is also greppable, which is how someone asks "which
 * suites touch `lib/data`" without reading eleven files.
 */
const MARKER = /WHAT THIS MOCKS/;

/**
 * A file's header: everything above the first line of real code.
 *
 * Bounded on purpose. The gate asks for a declaration in the HEADER, and
 * without a bound the phrase could sit anywhere — including inside the very
 * mock it was supposed to introduce, three hundred lines down, where nobody
 * opening the file would meet it. The first `import` is the boundary because
 * every suite here starts with one; a file with no import at all is treated as
 * all header, which is the lenient direction and costs nothing.
 */
function headerOf(source) {
  const firstImport = source.search(/^import\s/m);
  return firstImport === -1 ? source : source.slice(0, firstImport);
}

/**
 * Normalise a mocked module specifier to the name a person writes in prose.
 *
 *     "../src/lib/data"        -> lib/data
 *     "../src/lib/auth-context" -> lib/auth-context
 *     "./helpers/render-home"   -> helpers/render-home
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
 */
const IMPORT_OF_ANY = /(?:\bfrom|\bimport)\s*\(?\s*["'`]([^"'`]+)["'`]/g;
const IMPORT_OF_HELPER = /(?:\bfrom|\bimport)\s*\(?\s*["'`](\.{1,2}\/helpers\/[^"'`]+)["'`]/g;

/**
 * Every seam a source replaces.
 *
 * Three kinds, and each is a different way of taking something away from the
 * code under test:
 *
 *   `vi.mock("X")`         — a module swapped out wholesale
 *   `vi.stubGlobal("f")`   — a global swapped out (`fetch`, in practice)
 *   `import "./helpers/…"` — a helper whose whole job is installing a
 *                            replacement: the canvas, the clock, the frame
 *                            loop, the viewport, `Math.random`
 *
 * The third is included because it is the one a reader is most likely to
 * forget they are relying on. A suite inherits a frozen clock and a canvas
 * that draws nothing simply by importing a helper, and a header that omits
 * that is describing a browser the test never had.
 *
 * TWO THINGS THESE PATTERNS LEARNED FROM BEING BROKEN. Backticks count as
 * quotes: `` vi.mock(`../src/lib/appearance`) `` is ordinary, valid, does
 * exactly what the double-quoted form does, and used to be invisible to every
 * regex in this file — a gate a keystroke can switch off is not a gate. And a
 * helper can arrive through a SIDE-EFFECT import, `import "./helpers/x";` with
 * no bindings at all, which is precisely the shape a helper whose whole job is
 * installing something takes; matching only `from` missed the case the third
 * paragraph above is entirely about.
 */
function seamsIn(source) {
  const seams = new Set();
  for (const m of source.matchAll(/\bvi\.mock\(\s*["'`]([^"'`]+)["'`]/g)) {
    seams.add(seamName(m[1]));
  }
  for (const m of source.matchAll(/\bvi\.stubGlobal\(\s*["'`]([^"'`]+)["'`]/g)) {
    seams.add(m[1]);
  }
  for (const m of source.matchAll(IMPORT_OF_HELPER)) {
    seams.add(seamName(m[1]));
  }
  return [...seams];
}

/**
 * The page whose failure path is the dev fixture, named in any import.
 *
 * The extension is optional and that is not a detail. The first version of
 * this pattern demanded a quote immediately after `Home`, so
 * `import Home from "../src/pages/Home.tsx"` — the original incident, typed
 * with the extension a great many editors add for you — reported clean. One
 * character of tolerance is the difference between a rule and a coincidence.
 */
const IMPORT_OF_HOME = /["'`][^"'`]*src\/pages\/Home(\.[cm]?[jt]sx?)?["'`]/;

/**
 * DOES THIS FILE REACH THE PAGE — ASKED BY FOLLOWING IMPORTS, NOT BY NAME.
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
 * inside `test/` is opened and read too, transitively, and the file mounts the
 * world if anything reachable that way names `pages/Home`. A helper cannot be
 * renamed out of the rule, and one written tomorrow is covered on the day it
 * is written.
 *
 * `unfollowable` is the honest half of that. An import inside `test/` that
 * cannot be opened means the walk stopped early and the answer below would be
 * a guess, so it is reported rather than shrugged at — an unread file is
 * indistinguishable from a clean one, which is exactly how the vocabulary gate
 * beside this one came to be blind over half of `Home.tsx`.
 */
function reachesWorld(source, read, fromKey, seen) {
  let mounts = IMPORT_OF_HOME.test(source);
  const unfollowable = [];
  for (const [, specifier] of source.matchAll(IMPORT_OF_ANY)) {
    const found = read(specifier, fromKey);
    if (found.kind === "outside") continue;
    if (found.kind === "unreadable") {
      unfollowable.push(found.key);
      continue;
    }
    if (seen.has(found.key)) continue;
    seen.add(found.key);
    const deeper = reachesWorld(found.source, read, found.key, seen);
    mounts = mounts || deeper.mounts;
    unfollowable.push(...deeper.unfollowable);
  }
  return { mounts, unfollowable };
}

const FOLLOWABLE = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx"];

/**
 * Open one import, if it is ours to open.
 *
 *   { kind: "outside" }                 a package, or product code under
 *                                       `src/` — not followed, see the header
 *   { kind: "unreadable", key }         inside `test/`, and no file found
 *   { kind: "read", key, source }
 *
 * Only `test/` is walked. Following `../src/...` would mean walking the
 * product's whole import graph to answer one question about test files, and
 * the answer to "which suites mount the page" has never needed it. The header
 * says out loud what that leaves invisible.
 */
function readLocal(specifier, fromKey) {
  if (!/^\.{1,2}\//.test(specifier)) return { kind: "outside" };
  const target = resolve(dirname(fromKey), specifier);
  if (!target.startsWith(TEST_DIR + sep)) return { kind: "outside" };
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
  return { kind: "unreadable", key: relative(TEST_DIR, target) };
}

/**
 * Everything wrong with one suite. Empty means it passes.
 *
 * Split out from the walk so the self-test below can run it over a string
 * instead of a file — the same shape `check-vocabulary.mjs` uses, and for the
 * same reason: a gate proven only by being pointed at the repo is proven only
 * against the day it was written.
 *
 * `read` and `key` are how the import walk is kept testable. The real scan
 * passes `readLocal` and the suite's path; a self-test case passes a handful
 * of helper sources written out in the case itself, so "a helper that reaches
 * the page" can be staged as a fact of the case rather than as a fact of the
 * repository. One case deliberately does use the real reader — see `onDisk`
 * below, and the reason it has to exist.
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
  const seams = seamsIn(source);

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
    const unnamed = seams.filter((seam) => !header.includes(seam));
    if (unnamed.length > 0) {
      problems.push(
        `the header does not name ${unnamed.map((s) => `\`${s}\``).join(", ")}, ` +
          "which this suite replaces. A declaration that is out of date with " +
          "its own mocks is worse than none: it reads as though someone checked.",
      );
    }
  }

  const world = reachesWorld(source, read, key, new Set([key]));
  for (const missing of world.unfollowable) {
    problems.push(
      `this suite imports \`${missing}\`, which the gate could not read. ` +
        "Rule 2 is answered by following imports, so an import that cannot be " +
        "opened is an import the gate cannot see through, and its answer to " +
        '"does this mount the world" would be a guess printed as a fact. ' +
        "Fix the path, or teach `readLocal` the spelling it does not know.",
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

/**
 * PROVE THE GATE CAN FAIL, AT MORE THAN ONE POINT, AND FOR THE RIGHT REASON.
 *
 * G7 — "nothing green is blind". The vocabulary gate beside this one reported
 * clean over half of `Home.tsx` for a week because it had been proven at
 * exactly one location, and a blind check prints the same word a working one
 * does. So the cases live here and run in `pnpm test` rather than in whatever
 * anyone remembered to try by hand the day it was written.
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
 * seam too many. And the shape that was missing is staged below: an undeclared
 * seam FOLLOWED by a declared one, which is the case `seams.slice(-1)` cannot
 * survive. That mutation is a good permanent canary for this file.
 */

/*
 * Helper sources the cases hand to the import walk.
 *
 * Written out here rather than read off disk so that "this helper mounts the
 * page" is a fact of the case rather than a fact of the repository — the walk
 * is then proven against the shape, not against today's filenames, which is
 * the whole point of the D2 repair. `INSTALLS` is the other half: a helper
 * that replaces something real and goes nowhere near the page, so a case can
 * prove the walk does not treat every helper import as a mount.
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
      "/* WHAT THIS MOCKS, AND WHY: lib/data, because the page reads through it. */",
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
    flags: ["does not name `fetch`, which this suite replaces"],
    why: "a stubbed global left undeclared",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: nothing but the network. */",
      'import { it } from "vitest";',
      'vi.stubGlobal("fetch", async () => undefined);',
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
      "an import inside test/ that the walk cannot open — silence here would make " +
      "rule 2 a guess",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, and `helpers/ghost` for the clock. */",
      'import { it } from "vitest";',
      'import { tick } from "./helpers/ghost";',
      'vi.mock("../src/lib/data", () => ({}));',
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
    onDisk: true,
    why:
      "THE REAL HELPER, THROUGH THE REAL READER — the one case that touches the " +
      "disk, because nothing else here proves the resolution works on this repository",
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
];

/**
 * The reader a string-only case gets.
 *
 * Helpers the case wrote out are readable; any other `./helpers/…` is
 * deliberately UNREADABLE rather than absent, so that a case which forgets to
 * supply a helper it imports says so loudly instead of quietly being audited
 * as a file that mounts nothing. Everything else — packages, and product code
 * under `src/` — is outside the walk, exactly as on disk.
 */
function readerFor(helpers) {
  return (specifier) => {
    if (Object.hasOwn(helpers, specifier)) {
      return { kind: "read", key: seamName(specifier), source: helpers[specifier] };
    }
    if (/^\.{1,2}\/helpers\//.test(specifier)) {
      return { kind: "unreadable", key: seamName(specifier) };
    }
    return { kind: "outside" };
  };
}

function selftest() {
  const failures = [];
  for (const c of SELFTEST) {
    /*
     * The on-disk case is anchored at a suite path that does not exist, which
     * is fine and is the point: only its DIRECTORY is used, so `./helpers/…`
     * resolves exactly as it would from any real suite, and the case is about
     * the resolution rather than about any particular file being scanned.
     */
    const read = c.onDisk ? readLocal : readerFor(c.helpers ?? {});
    const key = c.onDisk ? join(TEST_DIR, "any-suite.test.tsx") : "<a self-test case>";
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
  if (failures.length > 0) {
    console.error(
      "\nseam gate SELF-TEST FAILED — the gate cannot see what it claims to.\n" +
        "A clean report from a blind gate is worse than no gate.\n\n" +
        failures.join("\n"),
    );
    process.exit(1);
  }
  console.log(`seams: self-test passed (${SELFTEST.length} cases)`);
}

selftest();

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
 */
const suites = walk(TEST_DIR);
const failing = [];
for (const file of suites) {
  const problems = auditSource(readFileSync(file, "utf8"), readLocal, file);
  if (problems.length > 0) failing.push({ file: relative(TEST_DIR, file), problems });
}

if (failing.length === 0) {
  console.log(`seams: clean — ${suites.length} suites each say what they replace`);
  process.exit(0);
}

console.error(
  `\nseams: ${failing.length} of ${suites.length} suite(s) do not say what layer they replace.\n` +
    "G6 in docs/goals/a-codebase-you-can-navigate.md: a suite that mocks the\n" +
    "wrong layer describes the dev fixture and stays green while doing it.\n",
);
for (const { file, problems } of failing) {
  for (const problem of problems) console.error(`  test/${file}\n      ${problem}\n`);
}
process.exit(1);
