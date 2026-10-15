#!/usr/bin/env node
/**
 * THE VOCABULARY GATE.
 *
 * The frontend was renamed to speak the backend's words — `captures` became
 * `inspirations`, `patterns` became `signals`, two dozen `room` symbols became
 * `group`. That rename was a person reading a file. Nothing stopped the next
 * feature reintroducing `roomPanel`, and the whole point of `docs/goals/
 * three-layers.md` was that naming debt is a tax that recurs until one name
 * means one thing. So the rule becomes mechanical here.
 *
 * WHAT IT CHECKS, AND WHAT IT DELIBERATELY DOES NOT.
 *
 * `docs/architecture.md` names three vocabularies, and this gate exists to
 * enforce exactly one boundary between them:
 *
 *   CANON — what the database and API say. Identifiers must use these.
 *   WORLD WORDS — field, sky, headquarters, wall, orb, ground. These name
 *     WHERE a thing is drawn, not what it is, and they are legitimate.
 *   HUMAN WORDS — what a person reads on screen. "room" is warmer than
 *     "group" and is a deliberate product choice.
 *
 * So the gate reads IDENTIFIERS only. Prose in a comment may name the old word
 * — often it must, to explain why something changed. A string a person reads
 * is untouched. Getting this wrong in the strict direction would be worse than
 * having no gate: a check that fires on comments teaches people to write fewer
 * comments.
 *
 * Run: node scripts/check-vocabulary.mjs        (also runs in `pnpm test`)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

/**
 * The words that may not appear in an identifier, and what to use instead.
 * `world` is here because the owner rejected the noun outright: what a person
 * lands on is Home.
 */
const FORBIDDEN = [
  { word: "capture", use: "inspiration" },
  { word: "pattern", use: "signal" },
  /* The ADVICE changed on 2026-10-15, not the rule. This used to read
     `use: "group"`, which after rooms were removed ("방 없애") pointed the next
     author at a word the codebase no longer has -- a wrong instruction that
     passed. `room` stays forbidden; there is simply nothing to rename it to. */
  { word: "room", use: "nothing — rooms were removed from the product" },
  { word: "wow", use: "nothing — the canon removed this concept" },
  { word: "world", use: "home, or a world word naming where it is drawn" },
];

/**
 * Names that contain a forbidden word and are nonetheless correct.
 *
 * Kept deliberately short. An allowlist is where a gate goes to die: every
 * entry is a small permanent hole, so each one states WHY it cannot simply be
 * renamed, and "it would be a lot of work" is not a reason that appears here.
 */
const ALLOWED = new Map([
  ["onClickCapture", "React's standard capture-phase click event prop, not a memory concept"],
  [
    "capturedAt",
    "the API's own field name — the server sends `capturedAt`, and renaming " +
      "our mirror of it would break the correspondence this gate exists to create",
  ],
  ["capturedMs", "the parsed form of `capturedAt`, same reason"],
  [
    "captureRef",
    "React's pointer-capture API (setPointerCapture), not ours to name",
  ],
  [
    "setPointerCapture",
    "a DOM method",
  ],
  [
    "releasePointerCapture",
    "a DOM method",
  ],
  [
    "hasPointerCapture",
    "a DOM method",
  ],
  ["CanvasPattern", "a DOM type — the 2D context's fill pattern"],
  ["createPattern", "a DOM method on the 2D context"],
  [
    "PUBLIC_HANDLE_PATTERN",
    "a regular expression. `pattern` here is the English word for a regex, " +
      "with no relation to the layer the canon calls a signal",
  ],
]);

/** Identifier-ish tokens: what a variable, property or type could be called. */
const TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

/**
 * Strip everything that is not code: comments, string literals, JSX text.
 *
 * A hand-rolled scanner rather than a parser, because the alternative is
 * adding a TypeScript dependency to a check that has to stay cheap enough to
 * run on every commit. It is deliberately CONSERVATIVE — anything it cannot
 * confidently classify is treated as prose and skipped, so the gate under-
 * reports rather than crying wolf. A false accusation costs trust; a missed
 * one costs a follow-up commit.
 */
function codeOnly(source) {
  const out = Array.from(source);
  /* JSX TEXT IS SCREEN COPY, NOT CODE.
     This gate's rule, from docs/architecture.md, is "canon words in code,
     human words on screen" — and it was reading the screen. `＋ capture` as a
     button's label is the interface speaking to a person, which the rule
     explicitly permits, but it arrives here as bare source and was counted as
     an identifier.

     Matched by LINE, not by a `>`…`<` span: a span rule has to start after
     some `>`, and `=>` and `a > b` are everywhere, so it would blank real code
     and hide real violations. A line qualifies only if it carries no code
     punctuation at all, which leaves prose and nothing else. `{view ===
     "capture"}` keeps its braces and quotes and is still read as code. */
  {
    let at = 0;
    for (const line of source.split("\n")) {
      const t = line.trim();
      if (t && !/[=(){}<>;:.'"`[\]]/.test(t) && /[A-Za-z]/.test(t)) {
        for (let i = at; i < at + line.length; i += 1) out[i] = " ";
      }
      at += line.length + 1;
    }
  }
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== "\n") out[i] = " ";
    }
  };
  let i = 0;
  while (i < source.length) {
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
    if (ch === '"' || ch === "'" || ch === "`") {
      /*
       * AN APOSTROPHE IN JSX TEXT IS NOT A STRING, and believing it was made
       * this gate lie for half a file.
       *
       *     <p>Joining puts your name on this room's roll</p>
       *
       * That `'` is prose. The scanner opened a string on it and blanked
       * everything up to the next apostrophe — thousands of lines — so every
       * identifier in between became invisible and the gate reported clean
       * over code it had never looked at. It caught a probe near the top of
       * Home.tsx and missed the identical probe at line 9013, which is how it
       * was found.
       *
       * The fix is a bound rather than a parser: a quoted string in this
       * codebase closes on the line it opened on. If the closing quote is not
       * on this line, the quote was punctuation, so it is skipped as an
       * ordinary character and the damage is one line instead of the rest of
       * the file. Backticks are exempt — a template literal genuinely spans
       * lines, and one that never closes is a syntax error the compiler
       * catches long before this runs.
       */
      const lineEnd = ch === "`" ? source.length : (() => {
        const nl = source.indexOf("\n", i + 1);
        return nl === -1 ? source.length : nl;
      })();
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
      if (!closed && ch !== "`") {
        /* punctuation, not a delimiter */
        i += 1;
        continue;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  /*
   * TEXT BETWEEN TAGS IS THE THIRD VOCABULARY.
   *
   *     <span>a pattern, once something recurs</span>
   *     <p className="jar-label">Couldn't reach this room</p>
   *
   * Those words are what a person reads, and "room" there is warmer than
   * "group" — `docs/architecture.md` says so and this gate exists to protect
   * that distinction, not to erase it. They are neither comments nor string
   * literals, so the scanner above cannot see them, and without this the gate
   * accuses the one place the old word is REQUIRED.
   *
   * Precise rather than heuristic: blank what sits between a `>` and the next
   * `<`, and only when it holds no `{`, since a brace means an expression and
   * an expression holds identifiers. Everything the pass touches is by
   * construction outside a tag, so no attribute, prop or handler can be
   * hidden by it.
   */
  let text = out.join("");
  text = text.replace(/>([^<>{}]*)</g, (whole, inner) =>
    ">" + inner.replace(/[^\n]/g, " ") + "<",
  );
  return text;
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
 * FILES THIS GATE DOES NOT JUDGE, each with the reason and what retires it.
 *
 * The canon rename is this branch's work; these files are not. Judging them
 * would mean renaming identifiers inside a feature somebody else shipped, to
 * satisfy a rule that landed after it — which is how a vocabulary gate stops
 * being a gate and starts being a tax on whoever merges next.
 *
 * An entry is a promise to delete the file or rename it, not a licence to keep
 * writing the old words: `walk()` still judges everything else, so nothing NEW
 * can drift in beside it.
 */
const NOT_JUDGED = new Map([
  [
    "pages/Surface.tsx",
    "the flat screen, and temporary. It carries layer 4 (`/principles`), " +
      "which the world has no geometry for yet, plus a rooms feature that " +
      "landed on dev after this gate was written. Renaming ~34 `room*` " +
      "identifiers inside it would be an invasive edit to a file this branch " +
      "means to delete. Retire this entry by deleting Surface.tsx once " +
      "principles has a home in the world.",
  ],
  [
    "test/surfaceRoute.test.ts",
    "covers the file above and goes with it.",
  ],
]);

const notJudged = (full) =>
  [...NOT_JUDGED.keys()].some((suffix) => full.replace(/\\/g, "/").endsWith(suffix));

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, found);
    } else if (/\.(ts|tsx)$/.test(entry) && !notJudged(full)) {
      found.push(full);
    }
  }
  return found;
}

/** Every forbidden identifier in one source, with the line it sits on. */
function scanSource(source) {
  const found = [];
  codeOnly(source)
    .split("\n")
    .forEach((line, index) => {
      for (const match of line.matchAll(TOKEN)) {
        const name = match[0];
        if (ALLOWED.has(name)) continue;
        const parts = words(name);
        for (const { word, use } of FORBIDDEN) {
          if (!parts.includes(word)) continue;
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
 * This gate reported `vocabulary: clean` over half of `Home.tsx` for a week. It
 * was not broken in a way anyone could notice — it was blind, and a blind check
 * reports exactly what a working one does. An apostrophe in JSX text
 *
 *     <p>Joining puts your name on this room's roll</p>
 *
 * opened a string it never closed, so thousands of lines were blanked before
 * the scan ever saw them. It was caught only because someone planted a probe
 * near the top of the file, found it, planted the identical probe at line 9013,
 * and did not.
 *
 * That is the whole argument for this function. A gate is only worth the last
 * time someone proved it could fail, and proving it by hand does not survive
 * the next edit to the scanner. So the cases live here and run in `pnpm test`
 * alongside everything else.
 *
 * The MUST-FLAG cases are placed AFTER the exact constructs that have blinded
 * it before — an apostrophe, a template literal, a regex, an unterminated
 * quote — because "does it flag a bad name on line 1" was never the question.
 * The question is whether it can still see line 9013.
 *
 * EACH ONE NAMES THE IDENTIFIER IT EXPECTS, and that is not pedantry. The first
 * version of this self-test only asked "did anything get flagged", and it
 * passed against a deliberately re-broken scanner — because the breakage
 * destroyed the JSX masking, which exposed the word `room` sitting in the
 * PROSE, which got flagged instead of the planted identifier. Right answer,
 * wrong reason, and a green report either way. Asking WHICH name closes that.
 */
const SELFTEST = [
  { expect: "roomPanel", why: "a plain forbidden identifier", src: "const roomPanel = 1;" },
  { expect: "PatternRow", why: "forbidden in a type name", src: "interface PatternRow { id: string }" },
  { expect: "worldView", why: "forbidden as a property", src: "const a = { worldView: 1 };" },
  {
    expect: "roomPanel",
    why: "AFTER an apostrophe in JSX text — the blindness that shipped",
    src: [
      "export const A = () => (",
      "  <p>Joining puts your name on this room's roll</p>",
      ");",
      "const roomPanel = 1;",
    ].join("\n"),
  },
  {
    expect: "capturePanel",
    why: "after a multi-line template literal",
    src: ["const t = `line one", "line two`;", "const capturePanel = 2;"].join("\n"),
  },
  {
    expect: "roomList",
    why: "after a regex holding a quote",
    src: ["const re = /it's/;", "const roomList = [];"].join("\n"),
  },
  {
    expect: "roomId",
    why: "after a comment mentioning the old word",
    src: ["/* this used to be called a room, and the rename is why */", "let roomId = 1;"].join("\n"),
  },
  { expect: null, why: "an allowed API field name", src: "const x = item.capturedAt;" },
  { expect: null, why: "an allowed DOM type", src: "let p: CanvasPattern | null = null;" },
  { expect: null, why: "the old word in prose, which must stay legal", src: "/* the room's field */" },
  { expect: null, why: "the old word in a string a person reads", src: 'const s = "Leave this room?";' },
  {
    expect: null,
    why: "the old word in JSX text, which is the third vocabulary",
    src: "export const B = () => <span>Couldn't reach this room</span>;",
  },
];

function selftest() {
  const failures = [];
  for (const c of SELFTEST) {
    const names = scanSource(c.src).map((h) => h.name);
    const ok = c.expect === null ? names.length === 0 : names.includes(c.expect);
    if (!ok) {
      failures.push(
        `  ${c.expect === null ? "FALSE ALARM" : "MISSED `" + c.expect + "`"}: ${c.why}\n` +
          `      ${c.src.replace(/\n/g, "\n      ")}\n` +
          `      flagged: ${names.length ? names.join(", ") : "(nothing)"}\n`,
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
  console.log(`vocabulary: self-test passed (${SELFTEST.length} cases)`);
}

selftest();

const violations = [];

for (const file of walk(SRC)) {
  for (const hit of scanSource(readFileSync(file, "utf8"))) {
    violations.push({ ...hit, file: relative(SRC, file) });
  }
}

if (violations.length === 0) {
  console.log("vocabulary: clean — every identifier speaks the canon");
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
  `\nvocabulary: ${byName.size} identifier(s) still speak the old words.\n` +
    `docs/architecture.md: canon words in code, human words on screen.\n`,
);
for (const v of [...byName.values()].sort((a, b) => b.count - a.count)) {
  console.error(
    `  ${v.name}  (${v.count}x, first at ${v.file}:${v.line})\n` +
      `      "${v.word}" is the old vocabulary — use ${v.use}\n`,
  );
}
console.error(
  "If one of these is genuinely correct — an API field name, a DOM method —\n" +
    "add it to ALLOWED in scripts/check-vocabulary.mjs with the reason.\n",
);
process.exit(1);
