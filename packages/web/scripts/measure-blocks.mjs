#!/usr/bin/env node
/**
 * WHAT WOULD EACH JSX BLOCK HAVE TO TAKE AS PROPS?
 *
 * `measure-groups.mjs` answers that question for the FUNCTIONS in the frame
 * effect. This answers it for the BLOCKS in the returned tree, which is a
 * different question with a different unit: a block that becomes a child
 * component takes one prop per free binding, and the count of those props is
 * the whole argument for or against extracting it. Step 4d of
 * `docs/goals/close-the-two-gaps.md` was settled by a count of this kind, and
 * the numbers in its table (41 / 38 / 26) are what this tool has to reproduce
 * before anything it says about a later step can be believed.
 *
 * That reproduction is the point of `--file`. A tool aimed at one working copy
 * can only ever assert; aimed at a commit with a published answer it can be
 * checked. The same document records an earlier draft of that table which was
 * wrong in the flattering direction because its two columns came from two
 * different counters. So: one tool, both commits, or it is not a measurement.
 *
 * WHAT COUNTS AS A BINDING, AND WHY THE EXCLUSIONS ARE WHAT THEY ARE.
 *
 * A name is counted if the block reads it and the COMPONENT BODY declares it —
 * state, refs, hooks, callbacks, plain locals, parameters. Those are the props.
 * Three kinds of name are deliberately not counted:
 *
 *   - JSX intrinsics (`div`, `p`, `button`). They are grammar, not data.
 *   - Module-level names — imports, `computeLayout`, `MOTES`. A child
 *     component imports them itself; they hold no per-instance state and they
 *     constrain no boundary. `measure-groups.mjs` excludes them for the same
 *     reason and it is the same judgement.
 *   - Anything the block binds itself: `map` callback parameters, `const`s in
 *     an IIFE, catch clauses. Scope is modelled rather than approximated,
 *     because a `c` bound by `candidates.map((c) => …)` is not a prop and a
 *     counter that thinks it is will report the sky as unextractable forever.
 *
 * Names are reported WITH THEIR KIND, because the kinds cost different things
 * to sever. Ten pieces of read-only data are ten props and no more; a setter
 * or a ref is a channel back into the page that survives the extraction.
 *
 * Run: node scripts/measure-blocks.mjs [--file path/to/Home.tsx] [--names]
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ts = createRequire(import.meta.url)("typescript");

const fileArg = process.argv.indexOf("--file");
const HOME =
  fileArg === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "pages", "Home.tsx")
    : resolve(process.argv[fileArg + 1]);

const src = readFileSync(HOME, "utf8");
const sf = ts.createSourceFile(HOME, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
const endLineOf = (n) => sf.getLineAndCharacterOfPosition(n.getEnd()).line + 1;

/**
 * The component whose returned tree the blocks live in: the largest function
 * in the file that returns JSX. Found by size rather than by name so this
 * keeps working when the page is renamed or split.
 */
let componentFn = null;
(function findComponent(node) {
  if (
    (ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    node.body &&
    ts.isBlock(node.body)
  ) {
    const hasJsxReturn = node.body.statements.some(
      (s) =>
        ts.isReturnStatement(s) &&
        s.expression &&
        (ts.isJsxElement(skipParens(s.expression)) || ts.isJsxFragment(skipParens(s.expression))),
    );
    if (hasJsxReturn) {
      const span = node.getEnd() - node.getStart(sf);
      if (!componentFn || span > componentFn.getEnd() - componentFn.getStart(sf)) componentFn = node;
    }
  }
  ts.forEachChild(node, findComponent);
})(sf);
if (!componentFn) throw new Error("no component with a JSX return found");

function skipParens(n) {
  return ts.isParenthesizedExpression(n) ? skipParens(n.expression) : n;
}

/** name → how the component holds it, which is what decides the cost. */
const componentScope = new Map();
{
  const note = (name, kind, line) => {
    if (ts.isIdentifier(name)) componentScope.set(name.text, { kind, line });
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) if (ts.isBindingElement(el)) note(el.name, kind, line);
    }
  };
  for (const p of componentFn.parameters ?? []) note(p.name, "prop", lineOf(p));
  for (const stmt of componentFn.body.statements) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        const init = d.initializer ? d.initializer.getText(sf) : "";
        const kind = /^useRef[<(]/.test(init)
          ? "ref"
          : /^useState[<(]/.test(init)
            ? "state"
            : /^useCallback[<(]/.test(init)
              ? "cb"
              : /^useMemo[<(]/.test(init)
                ? "memo"
                : /^use[A-Z]/.test(init)
                  ? "hook"
                  : "local";
        note(d.name, kind, lineOf(d));
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      componentScope.set(stmt.name.text, { kind: "fn", line: lineOf(stmt.name) });
    }
  }
  /* `useState` gives two names from one array pattern and they cost different
     things — the value is a prop, the setter is a channel back. The pattern
     walk above labels both "state", so the setters are re-labelled here by the
     one thing that distinguishes them at a call site: they are only ever
     called, never rendered. */
  for (const [name, held] of componentScope) {
    if (held.kind === "state" && /^set[A-Z]/.test(name)) held.kind = "setter";
  }
}

/** Names bound inside the block itself: params, locals, catch clauses. */
function boundWithin(root) {
  const bound = new Set();
  const bind = (name) => {
    if (ts.isIdentifier(name)) bound.add(name.text);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const el of name.elements) if (ts.isBindingElement(el)) bind(el.name);
    }
  };
  (function walk(node) {
    if (ts.isVariableDeclaration(node)) bind(node.name);
    if (ts.isParameter(node)) bind(node.name);
    if (ts.isCatchClause(node) && node.variableDeclaration) bind(node.variableDeclaration.name);
    if (node !== root && ts.isFunctionDeclaration(node) && node.name) bound.add(node.name.text);
    ts.forEachChild(node, walk);
  })(root);
  return bound;
}

/** Module-level names — imports and file-scope declarations. Not props. */
const moduleScope = new Set();
for (const stmt of sf.statements) {
  if (ts.isImportDeclaration(stmt) && stmt.importClause) {
    const { name, namedBindings } = stmt.importClause;
    if (name) moduleScope.add(name.text);
    if (namedBindings) {
      if (ts.isNamespaceImport(namedBindings)) moduleScope.add(namedBindings.name.text);
      else for (const el of namedBindings.elements) moduleScope.add(el.name.text);
    }
  } else if (ts.isVariableStatement(stmt)) {
    for (const d of stmt.declarationList.declarations) {
      if (ts.isIdentifier(d.name)) moduleScope.add(d.name.text);
    }
  } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
    moduleScope.add(stmt.name.text);
  }
}

/**
 * Every free name the block reads, with how the component holds it.
 *
 * The module-level and global names are collected too, in their own bucket.
 * They are not props and are not counted as bindings, but a reader comparing
 * this against an older count needs to see the difference rather than take it
 * on trust — a table whose two columns mean different things is how step 4d's
 * first draft went wrong.
 */
function bindingsOf(block) {
  const bound = boundWithin(block);
  const free = new Map();
  const elsewhere = new Set();
  (function walk(n) {
    if (ts.isIdentifier(n)) {
      const p = n.parent;
      const isMember = ts.isPropertyAccessExpression(p) && p.name === n;
      const isKey = ts.isPropertyAssignment(p) && p.name === n;
      const isAttrName = ts.isJsxAttribute(p) && p.name === n;
      /* A lowercase JSX tag is an intrinsic — grammar, not a dependency. An
         uppercase one is a real component reference and stays. */
      const isTag =
        (ts.isJsxOpeningElement(p) || ts.isJsxSelfClosingElement(p) || ts.isJsxClosingElement(p)) &&
        p.tagName === n;
      const intrinsic = isTag && /^[a-z]/.test(n.text);
      if (!isMember && !isKey && !isAttrName && !intrinsic && !bound.has(n.text)) {
        const held = componentScope.get(n.text);
        if (held) free.set(n.text, held.kind);
        else elsewhere.add(n.text + (moduleScope.has(n.text) ? "" : "*"));
      }
    }
    ts.forEachChild(n, walk);
  })(block);
  return { free, elsewhere };
}

/**
 * The blocks, named by the class the outermost element carries. Matching on
 * the className rather than on a line number is what lets the same invocation
 * run against an older commit, which is the only way this tool can be checked.
 */
const WANTED = [
  ["the ready field", "jar-hq"],
  ["the sky", "jar-sky"],
  ["the reading panel", "jar-panel"],
];

/**
 * `{phase === "ready" ? (<div className="jar-hq">…) : null}` — the guard is
 * part of the block. It is two lines and, in the ready field's case, one
 * binding (`phase`, which appears nowhere inside), and including it is what
 * makes 461/33 read as the 463/41 step 4d published. A block that leaves the
 * page takes its own condition with it or the page keeps rendering it.
 */
function withGuard(node) {
  let n = node;
  while (
    n.parent &&
    (ts.isParenthesizedExpression(n.parent) ||
      (ts.isConditionalExpression(n.parent) && n.parent.whenTrue === n))
  ) {
    n = n.parent;
  }
  return n;
}

const found = new Map();
(function findBlocks(node) {
  if (ts.isJsxElement(node)) {
    const attrs = node.openingElement.attributes.properties;
    for (const a of attrs) {
      if (!ts.isJsxAttribute(a) || a.name.getText(sf) !== "className" || !a.initializer) continue;
      const text = a.initializer.getText(sf);
      for (const [label, cls] of WANTED) {
        /* the class has to START the value: `jar-panel-text` is not the panel,
           and `jar-hq-inner` is not the ready field */
        if (!new RegExp(`["\`{]${cls}(["\`\\s$]|$)`).test(text)) continue;
        const prev = found.get(label);
        const span = node.getEnd() - node.getStart(sf);
        if (!prev || span > prev.span) found.set(label, { node: withGuard(node), span });
      }
    }
  }
  ts.forEachChild(node, findBlocks);
})(componentFn.body);

/**
 * WHICH NAMES RUN BETWEEN BLOCKS — the count that decides whether a collection
 * is the right move at all.
 *
 * A binding only ONE block reads is that block's own subject: extracting the
 * block takes it along and no seam is left behind. A binding SEVERAL blocks
 * read is a channel running between them, and that is what `measured` and
 * `editing` were each built to name. Without this column the two look alike,
 * and a reader could reasonably conclude a third collection is waiting.
 */
function sharedAcrossBlocks(perBlock) {
  const seen = new Map();
  for (const [label, free] of perBlock) {
    for (const [name, kind] of free) {
      const prev = seen.get(name) ?? { kind, blocks: [] };
      prev.blocks.push(label);
      seen.set(name, prev);
    }
  }
  return [...seen].filter(([, v]) => v.blocks.length > 1);
}

const showNames = process.argv.includes("--names");
console.log(`${HOME}`);
console.log(
  `component: ${componentFn.name?.text ?? "(anonymous)"} at line ${lineOf(componentFn)}, ` +
    `${componentScope.size} names in its body\n`,
);
console.log("block                lines   props   +module/global   all   editing state it holds");
console.log("-".repeat(88));

const EDITING = /^(edit|setEdit|saveEdit|editing)$/;
const perBlock = [];
for (const [label] of WANTED) {
  const hit = found.get(label);
  if (!hit) {
    console.log(`${label.padEnd(20)}  NOT FOUND`);
    continue;
  }
  const { free, elsewhere } = bindingsOf(hit.node);
  perBlock.push([label, free]);
  const lines = endLineOf(hit.node) - lineOf(hit.node) + 1;
  const editing = [...free.keys()].filter((n) => EDITING.test(n));
  console.log(
    `${label.padEnd(20)} ${String(lines).padStart(5)}   ${String(free.size).padStart(5)}   ` +
      `${String(elsewhere.size).padStart(13)}   ${String(free.size + elsewhere.size).padStart(3)}   ` +
      `${editing.join(" ")}`,
  );
  if (showNames) {
    const byKind = new Map();
    for (const [n, k] of free) byKind.set(k, [...(byKind.get(k) ?? []), n]);
    for (const k of [...byKind.keys()].sort()) {
      console.log(`    ${k.padEnd(7)} (${byKind.get(k).length}): ${byKind.get(k).sort().join(" ")}`);
    }
    console.log(
      `    not props (${elsewhere.size}), module-level or global, * = global: ` +
        `${[...elsewhere].sort().join(" ")}\n`,
    );
  }
}

const shared = sharedAcrossBlocks(perBlock);
console.log(`${shared.length} name(s) read by more than one block — the channels between them:`);
for (const [name, v] of shared.sort((a, b) => b[1].blocks.length - a[1].blocks.length)) {
  console.log(`  ${name.padEnd(14)} [${v.kind}] ${v.blocks.join(", ")}`);
}
console.log("\nEverything else each block reads is its own subject and leaves with it.");
