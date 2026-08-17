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
 *
 *   2. THE INCIDENT ITSELF. Any suite that mounts `pages/Home` must mock
 *      `lib/data`. This is the one rule that would have caught the original
 *      bug rather than merely made it legible. The page reads its three layers
 *      through the loaders; a suite that mounts it and mocks only `lib/api` is
 *      not describing the product, and no amount of honest prose about that
 *      choice makes it a correct one.
 *
 * WHAT THIS GATE CANNOT SEE, said plainly because G7 asks every gate to be
 * honest about its own reach:
 *
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
 * produced, so the incident fails at runtime as well as here. Two halves,
 * because either alone has a hole. This file cannot see a suite whose mocks are
 * individually declared and collectively wrong; the runtime guard cannot see a
 * suite that never mounts the page. `test/fixture-guard.test.tsx` stages the
 * incident and proves the runtime half fires; the self-test below proves this
 * half does.
 *
 * Run: node scripts/check-seams.mjs        (also runs in `pnpm test`)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
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
    .replace(/\.(ts|tsx|js|mjs)$/, "");
}

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
 */
function seamsIn(source) {
  const seams = new Set();
  for (const m of source.matchAll(/\bvi\.mock\(\s*["']([^"']+)["']/g)) {
    seams.add(seamName(m[1]));
  }
  for (const m of source.matchAll(/\bvi\.stubGlobal\(\s*["']([^"']+)["']/g)) {
    seams.add(m[1]);
  }
  for (const m of source.matchAll(/from\s+["'](\.{1,2}\/helpers\/[^"']+)["']/g)) {
    seams.add(seamName(m[1]));
  }
  return [...seams];
}

/** Does this file mount the page whose failure path is the dev fixture? */
function mountsHome(source) {
  return (
    /from\s+["'][^"']*helpers\/render-home["']/.test(source) ||
    /["'][^"']*src\/pages\/Home["']/.test(source)
  );
}

/**
 * Everything wrong with one suite. Empty means it passes.
 *
 * Split out from the walk so the self-test below can run it over a string
 * instead of a file — the same shape `check-vocabulary.mjs` uses, and for the
 * same reason: a gate proven only by being pointed at the repo is proven only
 * against the day it was written.
 */
function auditSource(source) {
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

  /*
   * RULE 2. Ordered last so its message is the final thing printed, because it
   * is the only failure here that means a suite is probably GREEN AND WRONG
   * rather than merely undocumented.
   */
  if (mountsHome(source) && !seamsIn(source).includes("lib/data")) {
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
 * PROVE THE GATE CAN FAIL, AT MORE THAN ONE POINT.
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
 */
const SELFTEST = [
  {
    expect: "no seam declaration",
    why: "a suite with no header at all",
    src: 'import { it } from "vitest";\nvi.mock("../src/lib/data", () => ({}));',
  },
  {
    expect: "no seam declaration",
    why: "the declaration exists but sits BELOW the imports, where no reader meets it",
    src: [
      'import { it } from "vitest";',
      "/* WHAT THIS MOCKS, AND WHY: lib/data, because the page reads through it. */",
      'vi.mock("../src/lib/data", () => ({}));',
    ].join("\n"),
  },
  {
    expect: "does not name",
    why: "a header that has fallen out of date with its own mocks",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data`, the layer under the page. */",
      'import { it } from "vitest";',
      'vi.mock("../src/lib/data", () => ({}));',
      'vi.mock("../src/lib/auth-context", () => ({}));',
    ].join("\n"),
  },
  {
    expect: "does not name",
    why: "a stubbed global left undeclared",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: nothing but the network. */",
      'import { it } from "vitest";',
      'vi.stubGlobal("fetch", async () => undefined);',
    ].join("\n"),
  },
  {
    expect: "does not name",
    why: "a helper that installs a canvas and a clock, unmentioned",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/data` and `lib/api`. */",
      'import { it } from "vitest";',
      'import { mountWorld } from "./helpers/render-home";',
      'vi.mock("../src/lib/data", () => ({}));',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    expect: "replaces none",
    why: "a suite that mocks nothing and does not say the word",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: the layers beneath it. */",
      'import { it } from "vitest";',
    ].join("\n"),
  },
  {
    expect: "MOUNTS THE WORLD",
    why: "THE INCIDENT: the world mounted on `lib/api`, declared honestly and still wrong",
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
    expect: "MOUNTS THE WORLD",
    why: "the same, reaching pages/Home directly rather than through the helper",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: `lib/api`. */",
      'import { it } from "vitest";',
      'const page = await import("../src/pages/Home");',
      'vi.mock("../src/lib/api", () => ({}));',
    ].join("\n"),
  },
  {
    expect: null,
    why: "a suite that mocks nothing and says so",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: nothing — these are pure functions. */",
      'import { it } from "vitest";',
    ].join("\n"),
  },
  {
    expect: null,
    why: "a complete and accurate declaration for a suite that mounts the world",
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
    expect: null,
    why: "a spy is an instrument, not a seam, and must not be demanded",
    src: [
      "/** WHAT THIS MOCKS, AND WHY: nothing — there is no layer beneath it. */",
      'import { it } from "vitest";',
      'const warn = vi.spyOn(console, "warn");',
    ].join("\n"),
  },
];

function selftest() {
  const failures = [];
  for (const c of SELFTEST) {
    const said = auditSource(c.src).join(" | ");
    const ok = c.expect === null ? said === "" : said.includes(c.expect);
    if (!ok) {
      failures.push(
        `  ${c.expect === null ? "FALSE ALARM" : 'MISSED "' + c.expect + '"'}: ${c.why}\n` +
          `      ${c.src.replace(/\n/g, "\n      ")}\n` +
          `      said: ${said || "(nothing)"}\n`,
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
  const problems = auditSource(readFileSync(file, "utf8"));
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
