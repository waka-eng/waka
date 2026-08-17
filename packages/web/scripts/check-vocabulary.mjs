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
  { word: "room", use: "group" },
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
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) break;
        j += 1;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
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

function walk(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, found);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      found.push(full);
    }
  }
  return found;
}

const violations = [];

for (const file of walk(SRC)) {
  const source = readFileSync(file, "utf8");
  const code = codeOnly(source);
  const lines = code.split("\n");

  lines.forEach((line, index) => {
    for (const match of line.matchAll(TOKEN)) {
      const name = match[0];
      if (ALLOWED.has(name)) continue;
      const parts = words(name);
      for (const { word, use } of FORBIDDEN) {
        if (!parts.includes(word)) continue;
        violations.push({
          file: relative(SRC, file),
          line: index + 1,
          name,
          word,
          use,
        });
        break;
      }
    }
  });
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
