#!/usr/bin/env node
/**
 * WHICH STATE DOES EACH FUNCTION ACTUALLY TOUCH?
 *
 * Step 4b of `docs/goals/close-the-two-gaps.md`. Step 4a gave the frame loop's
 * state eleven owners; this reads the dependencies back off the code so the
 * decision in 4c is a measurement rather than an estimate.
 *
 * The gate it exists to answer: a candidate that still needs FOUR OR MORE
 * groups is not a module. Both previous attempts to extract from this file
 * failed at exactly this point and were argued about rather than measured —
 * once claiming the sky engine was separable when it was not.
 *
 * It reports, per function: which of the state objects it reads, which free
 * variables it closes over that are NOT state objects, and whether it is
 * reachable from the sky. Counting only the objects would flatter the answer,
 * because a function taking one group and eleven loose closures is no more
 * extractable than one taking four groups.
 *
 * Run: node scripts/measure-groups.mjs [--only sky]
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ts = createRequire(import.meta.url)("typescript");
const HOME = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "pages", "Home.tsx");

/** The eleven owners 4a created, plus the two singles it deliberately left. */
const GROUPS = new Set([
  "view", "cam", "trip", "companion", "gesture",
  "sky", "pour", "clock", "stir", "poster", "hinted",
  "mech", "ground",
]);

const src = readFileSync(HOME, "utf8");
const sf = ts.createSourceFile(HOME, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

/* The frame effect is the biggest arrow function in the file; everything 4a
   touched lives inside it. Found by size rather than by line number so this
   keeps working as the file shrinks. */
let effect = null;
(function findEffect(node) {
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    const span = node.getEnd() - node.getStart(sf);
    if (!effect || span > effect.getEnd() - effect.getStart(sf)) effect = node;
  }
  ts.forEachChild(node, findEffect);
})(sf);

/** Names declared directly in the effect body — the closure surface. */
const declaredInEffect = new Map();
for (const stmt of effect.body.statements ?? []) {
  if (ts.isVariableStatement(stmt)) {
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) declaredInEffect.set(d.name.text, lineOf(d.name));
    }
  } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
    declaredInEffect.set(stmt.name.text, lineOf(stmt.name));
  }
}

/** Every named function declared at the top of the effect body. */
const functions = [];
for (const stmt of effect.body.statements ?? []) {
  if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
    functions.push({ name: stmt.name.text, node: stmt, line: lineOf(stmt.name) });
  } else if (ts.isVariableStatement(stmt)) {
    for (const d of stmt.declarationList.declarations) {
      if (
        ts.isIdentifier(d.name) &&
        d.initializer &&
        (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) &&
        d.initializer.body
      ) {
        functions.push({ name: d.name.text, node: d.initializer, line: lineOf(d.name) });
      }
    }
  }
}

/** Names bound inside a function: params, locals, catch clauses. Not free. */
function boundWithin(fn) {
  const bound = new Set();
  const bind = (name) => {
    if (ts.isIdentifier(name)) bound.add(name.text);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) if (ts.isBindingElement(el)) bind(el.name);
    }
  };
  for (const p of fn.parameters ?? []) bind(p.name);
  (function walk(node) {
    if (node !== fn && (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node))) {
      if (node.name && ts.isIdentifier(node.name)) bound.add(node.name.text);
    }
    if (ts.isVariableDeclaration(node)) bind(node.name);
    if (ts.isParameter(node)) bind(node.name);
    if (ts.isCatchClause(node) && node.variableDeclaration) bind(node.variableDeclaration.name);
    ts.forEachChild(node, walk);
  })(fn);
  return bound;
}

const report = [];
for (const { name, node, line } of functions) {
  const bound = boundWithin(node);
  const groups = new Set();
  const freeOther = new Set();
  const calls = new Set();

  (function walk(n) {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isMember = ts.isPropertyAccessExpression(p) && p.name === n;
      const isKey = ts.isPropertyAssignment(p) && p.name === n;
      if (!isMember && !isKey && !bound.has(n.text)) {
        if (GROUPS.has(n.text)) groups.add(n.text);
        else if (declaredInEffect.has(n.text) && n.text !== name) {
          /* a call is a dependency on behaviour, a read is one on state */
          const called = ts.isCallExpression(p) && p.expression === n;
          (called ? calls : freeOther).add(n.text);
        }
      }
    }
    ts.forEachChild(n, walk);
  })(node);

  report.push({
    name,
    line,
    groups: [...groups].sort(),
    freeOther: [...freeOther].sort(),
    calls: [...calls].sort(),
    lines: sf.getLineAndCharacterOfPosition(node.getEnd()).line - lineOf(node) + 1,
  });
}

const onlyArg = process.argv.indexOf("--only");
const filter = onlyArg === -1 ? null : process.argv[onlyArg + 1];
const rows = filter
  ? report.filter((r) => r.groups.includes(filter) || /sky|neb|sat|cluster/i.test(r.name))
  : report;

rows.sort((a, b) => b.groups.length - a.groups.length || b.lines - a.lines);

console.log(`${functions.length} functions declared in the frame effect.\n`);
console.log("name                          lines  groups  closes-over  groups touched");
console.log("-".repeat(100));
for (const r of rows) {
  console.log(
    `${r.name.padEnd(28)}  ${String(r.lines).padStart(5)}  ${String(r.groups.length).padStart(6)}  ` +
      `${String(r.freeOther.length + r.calls.length).padStart(11)}  ${r.groups.join(" ")}`,
  );
}

const hist = new Map();
for (const r of report) hist.set(r.groups.length, (hist.get(r.groups.length) ?? 0) + 1);
console.log("\ngroups touched → how many functions");
for (const k of [...hist.keys()].sort((a, b) => a - b)) {
  console.log(`  ${k}: ${"#".repeat(hist.get(k))} (${hist.get(k)})`);
}

/*
 * A MODULE IS A SET, NOT A FUNCTION.
 *
 * The gate in 4c asks about a candidate module, and a candidate is several
 * functions moving together. Measured one at a time they all look cheap; what
 * decides it is the union of what the SET needs and — the part that sank the
 * previous two attempts — what the set still calls back into the file for.
 */
const unitArg = process.argv.indexOf("--unit");
if (unitArg !== -1) {
  const members = new Set(process.argv[unitArg + 1].split(",").map((s) => s.trim()));
  const rowsIn = report.filter((r) => members.has(r.name));
  const missing = [...members].filter((m) => !report.some((r) => r.name === m));

  const groups = new Set();
  const outward = new Set();
  const free = new Set();
  let lines = 0;
  for (const r of rowsIn) {
    lines += r.lines;
    for (const g of r.groups) groups.add(g);
    for (const c of r.calls) if (!members.has(c)) outward.add(c);
    for (const f of r.freeOther) if (!members.has(f)) free.add(f);
  }

  console.log(`\n${"=".repeat(72)}\nUNIT: ${rowsIn.length} functions, ${lines} lines`);
  if (missing.length) console.log(`  NOT FOUND: ${missing.join(", ")}`);
  console.log(`  state groups needed (${groups.size}): ${[...groups].sort().join(" ")}`);
  console.log(`  calls back into the file (${outward.size}): ${[...outward].sort().join(" ")}`);
  console.log(`  other free names (${free.size}): ${[...free].sort().join(" ")}`);
  console.log(
    `\n  GATE: four or more groups means it is not a module — ` +
      `${groups.size} group(s), so this ${groups.size >= 4 ? "FAILS" : "PASSES"}.`,
  );
}
