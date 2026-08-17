#!/usr/bin/env node
/**
 * RENAME ONE IDENTIFIER, AND NOTHING THAT MERELY LOOKS LIKE IT.
 *
 * Used by `docs/goals/close-the-two-gaps.md` step 4a to give 113 loose `let`s
 * an owner: `settle` becomes `stir.amp`, and every use site has to follow.
 *
 * WHY THIS IS NOT A REGEX.
 *
 * It was, twice, and both versions corrupted prose.
 *
 * The first was a plain `s/world/layout/g`, which rewrote 142 comment lines
 * and had to be unpicked by diffing against HEAD. The second masked comments
 * and string literals and still rewrote this, because JSX text is neither:
 *
 *     <div className="jar-skel">
 *       Waka could not be poured — reload to try again
 *       {failReason ? <span>{failReason}</span> : null}
 *     </div>
 *
 * A "blank everything between > and <" rule does not save it either: the run
 * holds `{failReason}`, so any brace-free pattern declines to match and the
 * sentence becomes "could not be pour.done". Each fix produced a narrower
 * version of the same bug, which is the signal that the tool was wrong rather
 * than the pattern.
 *
 * So this asks the compiler. An `Identifier` node is a name; a comment, a
 * string and a run of JSX text are not, and no amount of apostrophes or braces
 * changes that. TypeScript is already a dependency, so the parser is free.
 *
 * WHAT IT DELIBERATELY REFUSES.
 *
 * A shorthand property (`{ settle }`) would have to become `{ settle: stir.amp }`,
 * which is a different edit, so it stops and says so rather than writing
 * `{ stir.amp }` and leaving a syntax error for someone else to find.
 *
 * Run: node scripts/rename-identifier.mjs <file> <from> <to>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const ts = createRequire(import.meta.url)("typescript");

const [, , file, from, to] = process.argv;
if (!file || !from || !to) {
  console.error("usage: rename-identifier.mjs <file> <from> <to>");
  process.exit(2);
}

const src = readFileSync(file, "utf8");
const sourceFile = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Byte ranges to replace, collected leaf-first then applied back-to-front. */
const hits = [];
const refusals = [];

const lineOf = (pos) => sourceFile.getLineAndCharacterOfPosition(pos).line + 1;

function visit(node) {
  if (ts.isIdentifier(node) && node.text === from) {
    const parent = node.parent;
    const skip =
      /* `other.settle` — a field on something else entirely */
      (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
      /* `{ settle: 1 }` — a key, not a reference to our variable */
      (ts.isPropertyAssignment(parent) && parent.name === node) ||
      (ts.isMethodDeclaration(parent) && parent.name === node) ||
      /* `import { settle }` / `export { settle }` — a different binding */
      ts.isImportSpecifier(parent) ||
      ts.isExportSpecifier(parent) ||
      /* `x.settle` written as a type, and qualified type names */
      ts.isQualifiedName(parent);

    if (ts.isShorthandPropertyAssignment(parent) && parent.name === node) {
      refusals.push(lineOf(node.getStart(sourceFile)));
    } else if (!skip) {
      hits.push({ start: node.getStart(sourceFile), end: node.getEnd() });
    }
  }
  ts.forEachChild(node, visit);
}
visit(sourceFile);

if (refusals.length > 0) {
  console.error(
    `refusing: \`${from}\` appears as a shorthand property at line(s) ` +
      `${refusals.join(", ")}.\n` +
      `  \`{ ${from} }\` must become \`{ ${from}: ${to} }\` by hand — this script\n` +
      `  would write \`{ ${to} }\`, which is a syntax error.`,
  );
  process.exit(1);
}

let out = src;
for (const { start, end } of hits.sort((a, b) => b.start - a.start)) {
  out = out.slice(0, start) + to + out.slice(end);
}
writeFileSync(file, out);
console.log(`${file}: ${hits.length} identifier(s) ${from} -> ${to}`);
