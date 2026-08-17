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
 * WHAT THIS TOOL USED TO MISS, AND WHY IT MATTERED.
 *
 * The first version only knew names declared INSIDE the frame effect. A ref
 * declared in the component body above it — `const selectedIdRef = useRef(…)`
 * — was therefore not a group and not a local, so it fell through both buckets
 * and was silently counted as nothing. That is the worst possible failure mode
 * for a gate: it under-reports, so a boundary looks cheaper than it is, and it
 * under-reports exactly the dependencies that are hardest to sever, because a
 * ref is per-instance mutable state the page owns and a module cannot bring
 * with it.
 *
 * It was caught by the sky extraction. This tool measured the engine at NINE
 * outward references; the `SkyDeps` list the extraction actually had to write
 * has FIFTEEN members. The six it could not see were `groupBallsRef`,
 * `viewerIdRef`, `selectedIdRef`, two DOM handles reached through `measured`,
 * and the `setFocusCandId` state setter — every one of them a component-body
 * declaration. The answer (three groups, so it passes) survived; the cost of
 * the seam was reported at sixty per cent of its real size.
 *
 * So the walk now also collects the component body's own top-level names and
 * reports them in their own column. They are kept SEPARATE from in-effect
 * closures rather than added into one total, because the two cost different
 * things to sever: an in-effect closure moves with the module or becomes an
 * argument, while a component-body ref has to become a declared accessor on a
 * deps object and stays a permanent seam between the page and the module.
 *
 * MODULE-LEVEL NAMES ARE STILL NOT COUNTED, deliberately. `MOTES`, `TAU`,
 * `computeLayout` and the imports are reachable from any file by importing
 * them; they hold no per-instance state and they do not constrain a boundary.
 * Counting them would swing the tool from under-reporting to noise, which is
 * the same failure wearing the other hat.
 *
 * ONE BLIND SPOT IS KNOWN AND STILL OPEN. A name bound anywhere inside a
 * function is treated as bound throughout it, so a function that reads `view`
 * outwardly AND declares an unrelated local `view` in some inner callback loses
 * the real dependency. Same direction as the bug above — it under-reports. It
 * is latent in `Home.tsx` today (the group objects sit at the effect's top
 * level and nothing measured rebinds those names), so no number currently
 * printed is wrong. It is pinned as a fixture at the bottom, asserting what the
 * tool DOES rather than what it should, so that fixing it is a deliberate act
 * with its own re-measurement instead of a silent drift in the numbers.
 *
 * AND NOW IT PROVES IT CAN STILL SEE — see SELFTEST at the bottom. This file
 * emits NUMBERS, not a verdict, which makes it more dangerous than a gate that
 * says pass or fail: a wrong number gets quoted into a design document and
 * argued from. The blind spot above was found by accident, a whole extraction
 * later. `--file` (below) made a fix checkable by hand; the self-test makes it
 * checkable every run, which is the only version that survives the next edit.
 *
 * AND IT COVERS THE PLUMBING, NOT ONLY THE JUDGE. The first round of fixtures
 * asserted what `measure` returns and stopped there, which left every mechanism
 * BETWEEN a file on disk and a printed number unchecked: which function gets
 * chosen as the effect, what `GROUPS` is compared against, the `--unit`
 * aggregation, and the printing itself. Three separate breaks were found there
 * that CHANGED A PRINTED NUMBER while the self-test still said "passed" — one of
 * them flipping the gate's verdict sentence from FAILS to PASSES. That is the
 * whole risk of this tool in one sentence, so the mechanisms are now covered
 * individually, each by a fixture that names what it expects:
 *
 *   - `GROUPS` vs reality. The set below is thirteen hardcoded names. Renaming a
 *     state object in `Home.tsx` and not mirroring it here used to change every
 *     row silently — `stir` → `stirring` alone moved `tick` from 11 groups to 10
 *     and turned "4 group(s), so this FAILS" into "3 group(s), so this PASSES".
 *     This repo ships `rename-identifier.mjs` and a gate whose whole job is
 *     renaming, so that edit is not hypothetical. Every run now checks each name
 *     against the real file and exits 1 naming the ones that have gone.
 *   - The `--unit` path had NO fixture at all, and it is the exact path the
 *     nine-versus-fifteen story is about. Its arithmetic and its gate sentence
 *     now come from `summariseUnit`, a pure function the fixtures assert.
 *   - The printing. A column swap or a corrupted total is a wrong number in a
 *     right-looking table, so the rows, the histogram and the unit block are
 *     rendered by pure functions and the exact printed text is asserted.
 *
 * Run: node scripts/measure-groups.mjs [--only sky] [--unit a,b,c]
 *      node scripts/measure-groups.mjs --selftest    (fixtures + the `GROUPS`
 *                                                     reality check; in `pnpm test`)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ts = createRequire(import.meta.url)("typescript");

/**
 * The eleven owners 4a created, plus the two singles it deliberately left.
 *
 * Hardcoded names measured against a file that people rename things in. Nothing
 * used to tie the two together, so a name that drifted here just stopped being
 * counted — quietly, in the under-reporting direction, in every row at once.
 * `assertGroupsAreReal` below checks each of these against the real file on
 * every run, and every entry is also named by a fixture, so deleting one is red
 * too.
 */
const GROUPS = new Set([
  "view", "cam", "trip", "companion", "gesture",
  "sky", "pour", "clock", "stir", "poster", "hinted",
  "mech", "ground",
]);

/**
 * Names bound inside a function: params, locals, catch clauses. Not free.
 *
 * There was a fourth line here, binding a catch clause's variable directly. It
 * was dead: `forEachChild` visits that variable as a `VariableDeclaration` like
 * any other, so the branch below had already bound it, and deleting the catch
 * line changed no answer in any fixture or in `Home.tsx`. Removed rather than
 * left in place — a line that looks like a guard and guards nothing is worse
 * than no line, because the next reader counts it as coverage. The behaviour it
 * appeared to provide is real and is pinned by the `catches` fixture; what
 * actually delivers it is the variable-declaration branch.
 */
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
    ts.forEachChild(node, walk);
  })(fn);
  return bound;
}

/**
 * THE WALK, over a source STRING rather than a path.
 *
 * It used to run once, at module top level, against the one file it was aimed
 * at. Nothing else could call it, so the only way to check an answer was to
 * read the printed table and believe it — which is how nine got believed when
 * the truth was fifteen. Taking a string means the fixtures at the bottom go
 * through this exact function, not through a re-implementation of it that
 * could stay right while this one drifts.
 *
 * Nothing about WHAT is measured changed in the move: same effect discovery,
 * same three buckets, same scope rules. The full report over `Home.tsx` is
 * unchanged, row for row.
 */
function measure(source, fileName) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  /**
   * THE FRAME EFFECT IS THE BIGGEST EFFECT CALLBACK — not the biggest function.
   *
   * It used to be the biggest function expression in the file, full stop, and
   * that is a heuristic aimed at a moving target from two directions.
   *
   * The measured one: in `Home.tsx` the frame effect spans 200,767 characters
   * and the runner-up is a `walls.map` callback at 21,330. Safe today, but 4b
   * and 4c exist to make the effect SMALLER, and the first thing to go wrong
   * when it crosses 21k would be the tool silently measuring a `.map` body and
   * printing a full, plausible, entirely different table. Requiring an effect
   * hook takes that whole class off the board: the decoy is not a candidate at
   * any size.
   *
   * The unmeasured one: for `const Home = () => {…}` the component itself is a
   * function expression and the biggest one in the file, so it won it, and then
   * nothing inside it looked like a measurable function — the table came out
   * empty. Zero rows and a deps object of zero, printed as calmly as any other
   * answer. `HomeExperience` is a function declaration today, so that was luck.
   *
   * Size still decides among effect hooks, since `Home.tsx` has several and the
   * frame loop is by far the largest; that margin (200k vs 14k for the next
   * `useEffect`) is the one worth watching, and the chosen line is printed in
   * the header so a retarget is visible rather than silent.
   */
  const isEffectHookCall = (node) => {
    const call = node.parent;
    if (!call || !ts.isCallExpression(call) || call.arguments[0] !== node) return false;
    const callee = call.expression;
    const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : callee.getText(sf);
    return /^use[A-Za-z]*Effect$/.test(name);
  };

  let effect = null;
  (function findEffect(node) {
    if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && isEffectHookCall(node)) {
      const span = node.getEnd() - node.getStart(sf);
      if (!effect || span > effect.getEnd() - effect.getStart(sf)) effect = node;
    }
    ts.forEachChild(node, findEffect);
  })(sf);

  /* A source with no effect hook at all has no frame effect to measure. Only
     reachable from a fixture or a `--file` aimed at the wrong thing, but the
     alternative is a null dereference, and "cannot read properties of null" is a
     terrible thing for a self-test failure to say. The caller prints this state
     as a sentence rather than as an ordinary empty table, because an empty table
     reads like an answer and this is the absence of one. */
  if (!effect || !effect.body) {
    return {
      effect: null,
      effectLine: null,
      declaredInEffect: new Map(),
      componentScope: new Map(),
      report: [],
      untracked: [],
    };
  }

  /** Names declared directly in the effect body — the closure surface. */
  const declaredInEffect = new Map();
  /* Object literals sitting exactly where the groups sit, that `GROUPS` has
     never heard of. Not an error — `SELF_WALL` is a constant and `skyDeps` is
     the deps object an extraction already wrote — but a fourteenth state owner
     would appear here first, and it is better read next to the numbers than
     discovered by an extraction that has to declare it. */
  const untracked = [];
  for (const stmt of effect.body.statements ?? []) {
    if (ts.isVariableStatement(stmt)) {
      for (const d of stmt.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        declaredInEffect.set(d.name.text, lineOf(d.name));
        if (d.initializer && ts.isObjectLiteralExpression(d.initializer) && !GROUPS.has(d.name.text)) {
          untracked.push(d.name.text);
        }
      }
    } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
      declaredInEffect.set(stmt.name.text, lineOf(stmt.name));
    }
  }
  untracked.sort();

  /**
   * THE COMPONENT BODY ABOVE THE EFFECT — the seam the tool used to be blind to.
   *
   * Only the component's own TOP-LEVEL statements and its parameters count. A
   * name bound inside some other nested function in the component body is not in
   * scope for the effect, and an earlier pass that walked the whole component
   * subtree proved that by reporting a stray `x` and `body` as dependencies of
   * `mouthSpot` and `worn` — parameters of unrelated callbacks that happened to
   * share a name with something the effect really did use. Scope has to be
   * modelled, not approximated by "appears somewhere above".
   */
  const componentFn = (() => {
    /* Arrow functions count as components. They did not, and a component written
       `const Home = () => {…}` therefore had NO component body as far as this
       walk was concerned: every ref it declared fell out of the count, which is
       precisely the bug this tool already shipped once, restored by a different
       route. The climb stops at the first function-ish ancestor with a block
       body either way. */
    let p = effect.parent;
    const isFnLike = (n) =>
      ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n);
    while (p && !(isFnLike(p) && p.body && ts.isBlock(p.body))) p = p.parent;
    return p ?? null;
  })();

  /** name → how it is held, which is what decides the cost of severing it. */
  const componentScope = new Map();
  if (componentFn) {
    const note = (name, kind, line) => {
      if (ts.isIdentifier(name)) componentScope.set(name.text, { kind, line });
      else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
        for (const el of name.elements) if (ts.isBindingElement(el)) note(el.name, kind, line);
      }
    };
    for (const p of componentFn.parameters ?? []) note(p.name, "prop", lineOf(p));
    for (const stmt of componentFn.body.statements ?? []) {
      if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          /* `useRef` is called out by name because it is the expensive kind: it
             is mutable state the page instance owns, so a module that reaches it
             needs a declared accessor forever, not a one-off argument. */
          const init = d.initializer ? d.initializer.getText(sf) : "";
          const kind = /^useRef[<(]/.test(init)
            ? "ref"
            : /^useState[<(]/.test(init)
              ? "state"
              : /^use[A-Z]/.test(init)
                ? "hook"
                : "local";
          note(d.name, kind, lineOf(d));
        }
      } else if (ts.isFunctionDeclaration(stmt) && stmt.name) {
        componentScope.set(stmt.name.text, { kind: "fn", line: lineOf(stmt.name) });
      }
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

  const report = [];
  for (const { name, node, line } of functions) {
    const bound = boundWithin(node);
    const groups = new Set();
    const freeOther = new Set();
    const calls = new Set();
    const outer = new Set();

    (function walk(n) {
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        const isMember = ts.isPropertyAccessExpression(p) && p.name === n;
        const isKey = ts.isPropertyAssignment(p) && p.name === n;
        /* `const { cam: near } = row` names a FIELD called `cam` and a local
           called `near`. The field was being counted as a read of the state
           group — the same mistake as the property key above, one node type
           over. This one over-reports, which is the less dangerous direction but
           not a harmless one: the number it inflates is the group count, and the
           4c gate turns on the group count, so it can declare a module
           unseparable and stop a seam from being built. */
        const isRenamedField = ts.isBindingElement(p) && p.propertyName === n;
        if (!isMember && !isKey && !isRenamedField && !bound.has(n.text)) {
          if (GROUPS.has(n.text)) groups.add(n.text);
          else if (declaredInEffect.has(n.text) && n.text !== name) {
            /* a call is a dependency on behaviour, a read is one on state */
            const called = ts.isCallExpression(p) && p.expression === n;
            (called ? calls : freeOther).add(n.text);
          } else if (componentScope.has(n.text) && n.text !== name) {
            /* Reached past the effect entirely, into the component's own state.
               `fooRef.current` lands here as `fooRef`: the `.current` is a
               member name and is skipped above, which is right — the dependency
               is on the ref cell, not on the field read out of it. */
            outer.add(n.text);
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
      outer: [...outer].sort(),
      lines: sf.getLineAndCharacterOfPosition(node.getEnd()).line - lineOf(node) + 1,
    });
  }

  return {
    effect,
    effectLine: lineOf(effect),
    declaredInEffect,
    componentScope,
    report,
    untracked,
  };
}

/**
 * IS `GROUPS` STILL TALKING ABOUT THIS FILE?
 *
 * The constant is thirteen names typed into this script. The file it measures is
 * one people rename things in — with a script in this very directory, and under
 * a gate whose entire job is renaming identifiers. When a name drifts apart from
 * its entry here, nothing breaks: the identifier simply stops being a group, and
 * every function that touched it loses one from its count. Silently, everywhere,
 * in the direction that makes boundaries look cheaper than they are.
 *
 * It is not a small effect. Drifting `stir` alone takes `tick` from 11 groups to
 * 10, `draw` from 7 to 6, `step` from 4 to 3 — and 4 to 3 is the gate: the same
 * unit stops printing "so this FAILS" and starts printing "so this PASSES".
 *
 * So every run compares the constant against the real file. A group is a thing
 * declared at the frame effect's top level; if a name here is not declared there
 * any more, the run stops and says which one. Deliberately one-directional: the
 * reverse check ("is anything at that level a group we don't know about?")
 * cannot be made without a list of things to excuse — `SELF_WALL` and `skyDeps`
 * are both object literals at that level and neither is state the gate cares
 * about — and a list of excuses is a place for a violation to hide. The
 * untracked ones get printed instead, so a fourteenth owner is visible next to
 * the numbers rather than absent from them.
 */
function groupsNotDeclared(declaredInEffect) {
  return [...GROUPS].filter((g) => !declaredInEffect.has(g)).sort();
}

/**
 * A MODULE IS A SET, NOT A FUNCTION — and this is the arithmetic that says so.
 *
 * Lifted out of the printing block because it had no fixture there and could not
 * get one: it ran only when `--unit` was on the command line, which the
 * self-test never is. Four separate breaks in it stayed green — dropping the
 * component-body names from the total (the nine-versus-fifteen under-report,
 * exactly), moving the gate threshold so a 5-group unit printed PASSES, dropping
 * the filter that stops a unit's own members counting as calls out of it, and
 * corrupting the deps sum. Every one of those changes a number a person then
 * makes an extraction decision from.
 *
 * `fails` lives here and only here so the printed verdict cannot disagree with
 * the number printed beside it.
 */
function summariseUnit(report, members) {
  const rowsIn = report.filter((r) => members.has(r.name));
  const missing = [...members].filter((m) => !report.some((r) => r.name === m)).sort();

  const groups = new Set();
  const outward = new Set();
  const free = new Set();
  const past = new Set();
  let lines = 0;
  for (const r of rowsIn) {
    lines += r.lines;
    for (const g of r.groups) groups.add(g);
    /* A call to a sibling that is coming along costs nothing; a call to one
       staying behind is a call back into the file, which is what sank both
       previous extraction attempts. */
    for (const c of r.calls) if (!members.has(c)) outward.add(c);
    for (const f of r.freeOther) if (!members.has(f)) free.add(f);
    for (const o of r.outer) past.add(o);
  }

  const sorted = (s) => [...s].sort();
  return {
    functions: rowsIn.length,
    lines,
    missing,
    groups: sorted(groups),
    outward: sorted(outward),
    free: sorted(free),
    past: sorted(past),
    deps: outward.size + free.size + past.size,
    fails: groups.size >= 4,
  };
}

/**
 * THE PRINTING, WHICH IS ALSO A PLACE A NUMBER CAN GO WRONG.
 *
 * A right answer printed into the wrong column is a wrong answer, and it is the
 * kind that survives review longest because the table still looks like a table.
 * The past-effect column is the one the sky was under-read from; swap it with
 * in-effect and the nine-versus-fifteen story repeats with every number in the
 * file technically correct. So the rows, the histogram and the unit block are
 * built as strings by these functions and the fixtures assert the strings.
 */
/**
 * One spec, used for the header AND the cells, so they cannot disagree.
 *
 * They were two separate string literals, and a header whose labels no longer
 * sat over their own columns was invisible to every assertion — the numbers stay
 * right and the reader takes the wrong ones. Written this way a mislabelled
 * column is not a bug that can be committed: moving a label moves its data.
 * The widths are unchanged, and the labels happen to be exactly as wide as the
 * columns they name, so the printed table is identical to the hand-aligned one.
 */
const COLUMNS = [
  { label: "name", width: 28, left: true, of: (r) => r.name },
  { label: "lines", width: 5, of: (r) => String(r.lines) },
  { label: "groups", width: 6, of: (r) => String(r.groups.length) },
  { label: "in-effect", width: 9, of: (r) => String(r.freeOther.length + r.calls.length) },
  { label: "past-effect", width: 11, of: (r) => String(r.outer.length) },
  { label: "groups touched", width: 0, left: true, of: (r) => r.groups.join(" ") },
];

const cell = (text, col) => (col.left ? text.padEnd(col.width) : text.padStart(col.width));
const TABLE_HEADER = COLUMNS.map((c) => cell(c.label, c)).join("  ");

function formatRow(r) {
  return COLUMNS.map((c) => cell(c.of(r), c)).join("  ");
}

function histogramLines(report) {
  const hist = new Map();
  for (const r of report) hist.set(r.groups.length, (hist.get(r.groups.length) ?? 0) + 1);
  return [...hist.keys()]
    .sort((a, b) => a - b)
    .map((k) => `  ${k}: ${"#".repeat(hist.get(k))} (${hist.get(k)})`);
}

/**
 * THE ARGUMENTS — which file, which functions, which rows.
 *
 * These decide WHAT gets measured and WHAT gets shown, which makes them the
 * first plumbing between a file on disk and a number on screen, and all three
 * were unreachable from a fixture while they sat inline in the command-line
 * block. Each of these broke silently:
 *
 *   - `--file` ignored: the tool measures `Home.tsx` while the reader believes
 *     they are looking at whatever they pointed it at. That is the affordance
 *     the nine-versus-fifteen fix was VERIFIED with, so a wrong answer here
 *     invalidates the verification rather than the measurement.
 *   - `--unit a,b,c` keeping only `a`: "UNIT: 2 functions, 791 lines" becomes
 *     "1 functions, 467 lines" and every number shrinks with it. A unit measured
 *     short looks cheap — the under-reporting direction again.
 *   - `--only` inverted: a table of exactly the rows the reader did not ask for,
 *     under a heading saying otherwise.
 */
function targetFile(argv, realHome) {
  const at = argv.indexOf("--file");
  return at === -1 ? realHome : resolve(argv[at + 1]);
}

function unitMembers(argv) {
  const at = argv.indexOf("--unit");
  if (at === -1) return null;
  return new Set(
    (argv[at + 1] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

function rowsToPrint(report, filter) {
  if (!filter) return report;
  return report.filter((r) => r.groups.includes(filter) || /sky|neb|sat|cluster/i.test(r.name));
}

function formatUnit(unit, componentScope) {
  const lines = [`UNIT: ${unit.functions} functions, ${unit.lines} lines`];
  if (unit.missing.length) lines.push(`  NOT FOUND: ${unit.missing.join(", ")}`);
  lines.push(`  state groups needed (${unit.groups.length}): ${unit.groups.join(" ")}`);
  lines.push(`  calls back into the file (${unit.outward.length}): ${unit.outward.join(" ")}`);
  lines.push(`  other free names (${unit.free.length}): ${unit.free.join(" ")}`);
  /* Printed with its kind, because that is the sentence a reader needs: a ref
     here becomes a permanent accessor on the deps object, and knowing how many
     of those there will be is the difference between the nine this used to
     report for the sky and the fifteen `SkyDeps` actually has. */
  lines.push(
    `  reaches past the effect (${unit.past.length}): ` +
      unit.past.map((n) => `${n}[${componentScope.get(n)?.kind ?? "?"}]`).join(" "),
  );
  lines.push(`  → a deps object of about ${unit.deps} members.`);
  lines.push(
    `\n  GATE: four or more groups means it is not a module — ` +
      `${unit.groups.length} group(s), so this ${unit.fails ? "FAILS" : "PASSES"}.`,
  );
  return lines;
}

/**
 * PROVE THE TOOL CAN STILL SEE.
 *
 * The vocabulary gate needed this because it went blind and kept printing
 * `clean`. This one needs it more, and for a reason worth stating plainly: this
 * tool does not print a verdict, it prints NUMBERS. A verdict that is wrong
 * gets challenged. A number that is wrong gets copied into a design document,
 * argued from, and built on — `close-the-two-gaps.md` has a paragraph about the
 * sky engine that would have been written differently if the number had been
 * fifteen instead of nine.
 *
 * And its errors are asymmetric. Over-reporting makes a boundary look expensive
 * and someone comes to argue with the tool. UNDER-reporting makes a boundary
 * look cheap, everybody agrees, the module gets built, and the true cost only
 * shows up in the deps interface someone then has to write. Every fixture below
 * therefore asserts the WHOLE answer — the exact set in each of the four
 * buckets, not "at least these" — so a bucket that quietly empties is as red as
 * one that quietly fills.
 *
 * EACH ONE NAMES THE IDENTIFIERS IT EXPECTS. That is the lesson the vocabulary
 * gate paid for: its first self-test asked only "did anything get flagged", and
 * passed against a scanner that had been deliberately re-broken, because the
 * breakage happened to flag a different name for a different reason. Right
 * answer, wrong reason, green report. `expect: { outer: ["selectedIdRef"] }`
 * cannot be satisfied by accident.
 *
 * Fixtures are whole files, not fragments, because the walk starts by FINDING
 * the effect — biggest function expression in the file — and a fragment would
 * skip the step most likely to break. Each one is a component with a real
 * component body above the effect, since that body is the blind spot.
 */
const SELFTEST = [
  {
    why: "a function reaching a ref declared in the component body — the blindness that shipped",
    fn: "readsRef",
    /* This is the sky bug in miniature. `selectedIdRef` is one of the six the
       old walk could not see: not a group, not declared in the effect, so it
       fell out of the count entirely and the seam was reported six members
       short of what `SkyDeps` actually had to declare. */
    expect: { groups: [], freeOther: [], calls: [], outer: ["selectedIdRef"] },
    src: [
      "function Home() {",
      "  const selectedIdRef = useRef<string | null>(null);",
      "  useEffect(() => {",
      "    function readsRef() {",
      "      return selectedIdRef.current;",
      "    }",
      "    return readsRef;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "a ref reached through `.current` is a dependency on the CELL, not on the field",
    fn: "readsRef",
    /* WHAT THIS PINS: the cell is charged once, as `ballsRef`, no matter how
       many times it is read through.
       WHAT IT DOES NOT PIN, THOUGH IT USED TO CLAIM TO: it said `.current` must
       not show up in the answer, and that if it ever did, the member-name skip
       had gone. That is not a test of anything. `current` can never appear in
       any bucket — it is not in GROUPS, not declared in the effect, not a
       component-body name — so this case stays green with the member skip
       deleted outright. Setting `isMember = false` moves fourteen rows in
       `Home.tsx`, `tick` alone from 8 past-effect names to 12, and every fixture
       here stayed green while it did. The skip is pinned by the collision case
       below instead, where the field names are chosen to be names the tool
       tracks. */
    expect: { groups: [], freeOther: [], calls: [], outer: ["ballsRef"] },
    src: [
      "function Home() {",
      "  const ballsRef = useRef([]);",
      "  useEffect(() => {",
      "    function readsRef() {",
      "      ballsRef.current.length = 0;",
      "      return { current: 1 };",
      "    }",
      "    return readsRef;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "component-body names carry the kind that decides what severing costs",
    fn: "usesBoth",
    /* The kinds are not decoration: `[ref]` in the `--unit` output is what says
       "this becomes a permanent accessor on a deps object", and `[state]` says
       the same of a setter. A regression that classified everything `local`
       would leave the counts right and the sentence wrong. */
    expect: { groups: [], freeOther: [], calls: [], outer: ["camRef", "setFocusCandId"] },
    kinds: { camRef: "ref", setFocusCandId: "state", focusCandId: "state" },
    /* ASYMMETRIC ON PURPOSE — 0 in-effect, 2 past-effect. The other printed-row
       assertion has 0 in both columns, so swapping the two columns left it green
       while `tick` in the real table went from "24 in-effect, 8 past-effect" to
       "8 in-effect, 24 past-effect": both numbers correct, both in the wrong
       place, and past-effect is the column the sky was under-read from. A
       fixture can only catch a swap if its two columns differ. */
    printedRow:
      "usesBoth                          3       0          0            2  ",
    src: [
      "function Home() {",
      "  const camRef = useRef(0);",
      "  const [focusCandId, setFocusCandId] = useState<string | null>(null);",
      "  useEffect(() => {",
      "    function usesBoth() {",
      "      setFocusCandId(null);",
      "      return camRef.current;",
      "    }",
      "    return usesBoth;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "a function reaching only in-effect locals — a read is state, a call is behaviour",
    fn: "usesLocals",
    /* The split matters to the `--unit` reading: a call to a sibling that moves
       with the module costs nothing, while a call to one that stays behind is a
       call back into the file. Collapsing the two buckets would make every unit
       look self-contained. */
    expect: { groups: [], freeOther: ["edgePad"], calls: ["clampHome"], outer: [] },
    /* The other side of the swap: 2 in-effect, 0 past-effect. Both this and
       `usesBoth` have to be right for the columns to be in the right order. */
    printedRow:
      "usesLocals                        2       0          2            0  ",
    src: [
      "function Home() {",
      "  useEffect(() => {",
      "    const edgePad = 12;",
      "    function clampHome(v) {",
      "      return v;",
      "    }",
      "    function usesLocals(v) {",
      "      return clampHome(v + edgePad);",
      "    }",
      "    return usesLocals;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "state groups read directly, which is the number the gate in 4c actually turns on",
    fn: "stepView",
    expect: { groups: ["cam", "sky", "view"], freeOther: [], calls: [], outer: [] },
    src: [
      "function Home() {",
      "  useEffect(() => {",
      "    function stepView() {",
      "      view.zoom = cam.z;",
      "      sky.t += 1;",
      "    }",
      "    return stepView;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "NEGATIVE — a local that merely shadows a group name is not a dependency on the group",
    fn: "shadowsGroup",
    /* `view` here is a local in an inner arrow with no relation to the state
       object. Counting it would inflate the one number the 4c gate turns on,
       and inflating THAT is how a separable module gets declared unseparable
       and a seam that should exist never gets built. */
    expect: { groups: [], freeOther: [], calls: [], outer: [] },
    src: [
      "function Home() {",
      "  useEffect(() => {",
      "    function shadowsGroup(rows) {",
      "      return rows.map((row) => {",
      "        const view = row.v;",
      "        return view + 1;",
      "      });",
      "    }",
      "    return shadowsGroup;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "NEGATIVE — a parameter of an unrelated component-body callback is not in scope for the effect",
    fn: "worn",
    /* The over-reporting half of the same wound. The first attempt to fix the
       blind spot walked the whole component subtree, and reported `worn` as
       depending on a name `body` that is only a parameter of an unrelated
       handler. A tool that answers a scope question by asking "does this name
       appear somewhere above" is guessing. */
    expect: { groups: [], freeOther: [], calls: [], outer: [] },
    src: [
      "function Home() {",
      "  const onPick = (body) => body.id;",
      "  useEffect(() => {",
      "    function worn() {",
      "      return body;",
      "    }",
      "    return worn;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "a recursive call is not a dependency on anything outside itself",
    fn: "recurse",
    expect: { groups: [], freeOther: [], calls: [], outer: [] },
    src: [
      "function Home() {",
      "  useEffect(() => {",
      "    function recurse(n) {",
      "      return n <= 0 ? 0 : recurse(n - 1);",
      "    }",
      "    return recurse;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "CURRENT BEHAVIOUR — a nested function gets no row of its own, and its reaches land on its parent",
    fn: "outerFn",
    /* Written down because it is a limit, not a feature, and an unwritten limit
       gets mistaken for a guarantee.
       Only the effect body's TOP-LEVEL declarations become rows, so `nestedFn`
       is invisible in the table — you cannot ask `--unit nestedFn` and you will
       not see it in the histogram. Its dependencies are not lost, though: the
       walk descends, so `sky` and `edgePad` are charged to `outerFn`, which is
       the conservative direction and the right one for a gate whose dangerous
       error is under-reporting. Moving `outerFn` really does mean moving
       `nestedFn` with it.
       `nestedFn` itself is absent from `calls` because it is bound inside
       `outerFn` — it needs no accessor, it travels along. */
    expect: { groups: ["sky"], freeOther: ["edgePad"], calls: [], outer: ["viewerIdRef"] },
    rows: ["outerFn"],
    src: [
      "function Home() {",
      "  const viewerIdRef = useRef('');",
      "  useEffect(() => {",
      "    const edgePad = 12;",
      "    function outerFn() {",
      "      function nestedFn() {",
      "        return sky.t + edgePad + viewerIdRef.current;",
      "      }",
      "      return nestedFn();",
      "    }",
      "    return outerFn;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "an arrow assigned to a const is a row too, the way half the frame loop is written",
    fn: "aimTo",
    expect: { groups: ["cam", "view"], freeOther: [], calls: [], outer: [] },
    rows: ["aimTo"],
    src: [
      "function Home() {",
      "  useEffect(() => {",
      "    const aimTo = (x) => {",
      "      cam.x = x;",
      "      return view.w;",
      "    };",
      "    return aimTo;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "KNOWN BLIND SPOT — an inner binding suppresses the SAME name used outwardly, and under-reports",
    fn: "realDependency",
    /* FOUND WHILE WRITING THESE FIXTURES, AND LEFT UNFIXED ON PURPOSE — this
       asserts what the tool DOES, which is not what it SHOULD do.
       `boundWithin` flattens a function's whole subtree into one set of bound
       names, so a name bound anywhere inside is treated as bound everywhere
       inside. That is right for the shadow case above, where the name is ONLY
       ever a local. It is wrong here: `realDependency` genuinely reads the
       state group `view` and the component ref `someRef` at its top, and then,
       quite separately, an unrelated inner callback happens to declare locals
       of the same names. Both real dependencies vanish.
       The true answer is groups ["view"], outer ["someRef"] — a deps object of
       two. The tool says zero and one. Same direction as the bug that shipped:
       it makes a boundary look CHEAPER than it is.
       Latent rather than live, which is why this is a written-down defect and
       not a fix smuggled into a self-test commit: in `Home.tsx` today the group
       objects are declared at the effect's top level and no measured function
       binds those names inside itself, so no printed number is currently wrong.
       Fixing it means tracking scope per block instead of per function, which
       is a change to what the tool measures and belongs in its own change with
       its own re-measurement. When someone does that, this case goes red — that
       is the point of it. Update it deliberately, do not delete it. */
    expect: { groups: [], freeOther: ["edgePad"], calls: [], outer: [] },
    src: [
      "function Home() {",
      "  const someRef = useRef(0);",
      "  useEffect(() => {",
      "    const edgePad = 1;",
      "    function realDependency() {",
      "      view.zoom = 1;",
      "      someRef.current = edgePad;",
      "      [1, 2].forEach((n) => {",
      "        const view = n;",
      "        const someRef = n;",
      "        return view + someRef;",
      "      });",
      "    }",
      "    return realDependency;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "MEMBER SKIP — field names that spell tracked names are fields, not dependencies",
    fn: "readsMembers",
    /* The case the `.current` fixture above was believed to cover and does not.
       Every field here is deliberately named after something the tool DOES
       track: `view` and `sky` are groups, `selectedIdRef` is a component-body
       ref, `clampHome` is declared in the effect. Delete the member skip and all
       four surface at once — the answer becomes groups `cam sky view`, calls
       `clampHome`, outer `selectedIdRef` — so this fails by name in three
       buckets. The parameters are what make it a test of the SKIP rather than of
       scope: `layout`, `opts` and `bag` are bound, so nothing but the field
       names is in question. */
    expect: { groups: ["cam"], freeOther: [], calls: [], outer: [] },
    src: [
      "function Home() {",
      "  const selectedIdRef = useRef(null);",
      "  useEffect(() => {",
      "    function clampHome(v) {",
      "      return v;",
      "    }",
      "    function readsMembers(layout, opts, bag) {",
      "      const at = layout.view + opts.sky + bag.selectedIdRef + layout.clampHome;",
      "      return at + cam.x;",
      "    }",
      "    return readsMembers;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "EVERY REMAINING ENTRY OF `GROUPS` — so deleting one from the constant is red",
    fn: "readsTheRest",
    /* The other fixtures exercise `view`, `cam` and `sky`: three of thirteen.
       The ten that nobody named could be deleted from the constant, or misspelt
       in it, with the self-test still reporting "passed" — and each one silently
       drops a group from every row that touches it, in the under-reporting
       direction. Named here, all ten at once.
       This is the DELETION half of keeping the constant honest. The RENAME half
       — the name changing in `Home.tsx` and not here — cannot be caught by a
       fixture at all, because a fixture writes both sides; `assertGroupsAreReal`
       checks that against the real file on every run. */
    expect: {
      groups: [
        "clock", "companion", "gesture", "ground", "hinted",
        "mech", "poster", "pour", "stir", "trip",
      ],
      freeOther: [],
      calls: [],
      outer: [],
    },
    src: [
      "function Home() {",
      "  useEffect(() => {",
      "    function readsTheRest() {",
      "      poster.n = stir.phase + clock.t + ground.y + mech;",
      "      return hinted.at + trip.i + companion.k + gesture.g + pour.p;",
      "    }",
      "    return readsTheRest;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "NEGATIVE — a nested callback's PARAMETER named after a group is not a read of it",
    fn: "nestedParam",
    /* The shadow fixture higher up covers a nested VARIABLE only. Parameters are
       bound by a different line of `boundWithin` — the `ts.isParameter` branch
       of its walk, which reaches into nested functions the way the loop over
       `fn.parameters` cannot — and removing that line left every fixture green
       while inventing group reads out of `.map((view) => …)`. Over-reporting,
       which inflates the exact number the 4c gate turns on. */
    expect: { groups: [], freeOther: [], calls: [], outer: [] },
    src: [
      "function Home() {",
      "  useEffect(() => {",
      "    function nestedParam(rows) {",
      "      return rows.map((view) => view.x);",
      "    }",
      "    return nestedParam;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "a destructured local is bound, and the FIELD it was renamed from is not a read",
    fn: "destructures",
    /* Two mechanisms in one small function, both previously unpinned on this
       side of the walk.
       `const { view } = row` binds `view`: that is the binding-pattern branch of
       `boundWithin`'s `bind`, and deleting it turned this into a phantom read of
       the state group.
       `const { cam: near } = row` was worse than unpinned, it was WRONG — `cam`
       there names a field of `row`, and the tool counted it as a read of the
       state object. Found by this fixture; the skip that fixes it is in the
       walk. Only `sky` is genuinely read here. */
    expect: { groups: ["sky"], freeOther: [], calls: [], outer: [] },
    src: [
      "function Home() {",
      "  useEffect(() => {",
      "    function destructures(row) {",
      "      const { view, cam: near } = row;",
      "      return view + near + sky.t;",
      "    }",
      "    return destructures;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "AN ARROW COMPONENT still has a component body — it used to empty the whole table",
    fn: "readsRef",
    /* `const Home = () => {…}` is the other way React components get written,
       and it broke this tool completely rather than partly: the component is
       itself a function expression and the biggest one in the file, so it won
       the "biggest function" contest and became the thing being measured, and
       then nothing inside it was a top-level function declaration of an effect
       body. Identical code came out as "0 functions, deps 0" — the emptiest
       possible answer, printed with no more hesitation than a real one.
       Two fixes meet here: the effect is now found by being an effect hook's
       callback, and the climb that finds the component body accepts an arrow. */
    expect: { groups: ["view"], freeOther: [], calls: [], outer: ["someRef"] },
    kinds: { someRef: "ref" },
    src: [
      "const Home = () => {",
      "  const someRef = useRef(0);",
      "  useEffect(() => {",
      "    function readsRef() {",
      "      return someRef.current + view.w;",
      "    }",
      "    return readsRef;",
      "  }, []);",
      "  return null;",
      "};",
    ].join("\n"),
  },
  {
    why: "A DECOY BIGGER THAN THE EFFECT does not get measured in its place",
    fn: "realFn",
    /* Effect discovery used to be "the biggest function expression in the file",
       and in `Home.tsx` the runner-up is a `walls.map` callback of 21,330
       characters against the effect's 200,767. That margin is not a safety
       property, it is a coincidence that 4b and 4c are actively working to
       destroy: the entire point is to make the effect smaller. The failure would
       be silent and total — a complete, plausible table measured from a `.map`
       body.
       Here the decoy is deliberately the larger of the two. If it is ever chosen
       again this goes red as "no row for `realFn` at all — rows: decoyFn". */
    expect: { groups: ["cam"], freeOther: [], calls: [], outer: [] },
    rows: ["realFn"],
    src: [
      "function Home() {",
      "  const table = rows.map((row) => {",
      "    function decoyFn() {",
      "      return row.a + row.b + row.c + row.d + row.e + row.f + row.g;",
      "    }",
      "    const padPadPadPadPadPadPadPadPadPadPadPadPadPadPad = decoyFn();",
      "    const padPadPadPadPadPadPadPadPadPadPadPadPadPadPa2 = decoyFn();",
      "    const padPadPadPadPadPadPadPadPadPadPadPadPadPadPa3 = decoyFn();",
      "    return padPadPadPadPadPadPadPadPadPadPadPadPadPadPad;",
      "  });",
      "  useEffect(() => {",
      "    function realFn() {",
      "      return cam.x;",
      "    }",
      "    return realFn;",
      "  }, []);",
      "  return table;",
      "}",
    ].join("\n"),
  },
  {
    why: "a property KEY that happens to spell a group name is not a read of that group",
    fn: "makesLiteral",
    /* `{ view: 1 }` names a field, not the state object. Losing the key skip
       would put a group on almost every function in the file and the histogram
       would quietly stop meaning anything. */
    expect: { groups: ["cam"], freeOther: [], calls: [], outer: [] },
    /* The printed row, character for character, asserted once. The table is what
       people actually read, and a number in the wrong column is a wrong number:
       `past-effect` is the column the sky was under-read from, and swapping it
       with `in-effect` would retell that whole story with every underlying set
       still correct. This also pins `lines`, which no assertion touched, so
       `lines: 0` could zero the column and the table's sort order in silence.

       AND IT PINS AN OFF-BY-ONE, DELIBERATELY, RATHER THAN QUIETLY MENDING IT.
       `makesLiteral` occupies THREE lines and this says 2: `lines` is the end
       line minus the start line, a span rather than a count, so every row in the
       table is one short and a unit of four is four short. Found by writing this
       assertion out by hand and disagreeing with the tool, which is the argument
       for asserting printed text rather than the sets behind it.
       Left as it is on purpose. It is one line to fix, and fixing it re-dates
       every line count taken with this tool — `close-the-two-gaps.md` says
       "`tick`, 467 lines" and "`draw`, 531 lines" — so it is a re-measurement
       and belongs in a commit that also updates what quotes it. Nothing here
       turns on it: the 4c gate counts GROUPS, and the sort is by group count
       first with `lines` only breaking ties, which a constant offset cannot
       change. When someone fixes it, this expectation goes red and the doc gets
       corrected in the same breath. That is the point of writing it down. */
    printedRow:
      "makesLiteral                      2       1          0            0  cam",
    src: [
      "function Home() {",
      "  useEffect(() => {",
      "    function makesLiteral() {",
      "      return { view: 1, sky: 2, at: cam.x };",
      "    }",
      "    return makesLiteral;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "a component-body FUNCTION reached from the effect is a dependency like any ref",
    fn: "callsHelper",
    /* `componentScope` notes three shapes: parameters, variable declarations,
       and function declarations. Only the first two were named by any fixture,
       so the branch that notes `function tidy() {}` in the component body could
       be deleted with everything green — and `tidy` would then be in no bucket
       at all, exactly the fall-through that lost six names from the sky's deps.
       It matters more than a ref, if anything: a module that calls back into a
       function defined on the page has to take it as a member of its deps
       object, and `close-the-two-gaps.md` counts those as the cost of a seam. */
    expect: { groups: [], freeOther: [], calls: [], outer: ["tidy"] },
    kinds: { tidy: "fn" },
    src: [
      "function Home() {",
      "  function tidy(v) {",
      "    return v;",
      "  }",
      "  useEffect(() => {",
      "    function callsHelper() {",
      "      return tidy(1);",
      "    }",
      "    return callsHelper;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "NEGATIVE — a caught error named after a group is bound by the catch, not read",
    fn: "catches",
    /* `boundWithin` has a branch for catch clauses that no fixture reached, so
       deleting it stayed green. `catch (view)` is rare; `catch (e)` shadowing
       nothing is the common case, which is precisely why nobody would notice the
       branch going. Over-reporting, same family as the nested parameter. */
    expect: { groups: [], freeOther: [], calls: [], outer: [] },
    src: [
      "function Home() {",
      "  useEffect(() => {",
      "    function catches(run) {",
      "      try {",
      "        return run();",
      "      } catch (view) {",
      "        return view.message;",
      "      }",
      "    }",
      "    return catches;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "a NESTED function shadowing an effect-level name is its own, not a call outward",
    fn: "shadowsSibling",
    /* `boundWithin` binds the names of functions declared inside the measured
       one. Nothing asserted it, because the existing nested case names its inner
       function something nothing else is called — so the branch could be removed
       with every fixture green.
       Here `clampHome` exists BOTH at the effect's top level and nested inside
       the measured function. The nested one wins, so this function does not
       depend on the sibling and does not carry it along when it moves. Read the
       other way — the branch gone — it reports a call out to a function it never
       touches, and a candidate module grows a dependency that does not exist. */
    expect: { groups: [], freeOther: [], calls: [], outer: [] },
    src: [
      "function Home() {",
      "  useEffect(() => {",
      "    function clampHome(v) {",
      "      return v;",
      "    }",
      "    function shadowsSibling(v) {",
      "      function clampHome(x) {",
      "        return x + 1;",
      "      }",
      "      return clampHome(v);",
      "    }",
      "    return shadowsSibling;",
      "  }, []);",
      "  return null;",
      "}",
    ].join("\n"),
  },
  {
    why: "NO EFFECT HOOK AT ALL is an absence, not an empty answer",
    /* A file with no `useEffect` has nothing for this tool to say, and the
       honest report of that is a sentence, not a table with no rows in it — an
       empty table reads as "measured, nothing found", which is what the arrow
       component printed for a file full of state. */
    noEffect: true,
    src: [
      "function Home() {",
      "  const someRef = useRef(0);",
      "  const table = rows.map((row) => row.a + row.b);",
      "  return table;",
      "}",
    ].join("\n"),
  },
];

/**
 * THE UNIT FIXTURES — the path that decides whether a module may be extracted.
 *
 * `--unit` is where the nine-versus-fifteen number came from, and until now it
 * was the only part of this script with no fixture whatsoever: `selftest()` read
 * `report` rows and stopped, while the aggregation, the deps total and the gate
 * sentence ran only when a person typed `--unit` on the command line. Four
 * breaks in it printed different numbers with the self-test green — including
 * one that printed "5 group(s), so this PASSES", which is the tool saying the
 * opposite of the one thing it exists to say.
 *
 * These assert the exact sets, the total, the verdict, AND the printed lines,
 * because a number is only as good as the label it lands next to.
 *
 * The shared source is a unit that is genuinely worth measuring: three members
 * moving together, one calling another (which must NOT count as a call out of
 * the unit), one calling a sibling left behind (which must), a component ref and
 * a state setter reached past the effect, and an in-effect local closed over.
 */
const UNIT_SRC = [
  "function Home() {",
  "  const skyRef = useRef(null);",
  "  const [dialAway, setDialAway] = useState(false);",
  "  useEffect(() => {",
  "    const skyDeps = {};",
  "    function satAt(i) {",
  "      return sky.sats[i] + skyDeps.n;",
  "    }",
  "    function nebAt(i) {",
  "      return satAt(i) + cam.z + view.w;",
  "    }",
  "    function paint() {",
  "      nebAt(0);",
  "      setDialAway(true);",
  /* Passed by REFERENCE, not called — `satAt` therefore lands in `freeOther`
     rather than `calls`, and it is a member of the unit. That is the only shape
     in which the members filter on free names does anything at all: without a
     case like this, deleting `!members.has(f)` changed nothing and stayed green.
     It is also how half the frame loop is written — a handler handed to
     `addEventListener` or `requestAnimationFrame` is exactly this. */
  "      const handlers = [satAt];",
  "      return skyRef.current + wake() + handlers.length;",
  "    }",
  "    function wake() {",
  "      return trip.i;",
  "    }",
  "    return paint;",
  "  }, []);",
  "  return null;",
  "}",
].join("\n");

const UNIT_SELFTEST = [
  {
    why: "a unit of three, PASSING at three groups — and its own members are not calls out of it",
    members: ["satAt", "nebAt", "paint"],
    src: UNIT_SRC,
    /* `satAt` and `nebAt` are called from inside the unit, so they are not a cost
       of moving it; `wake` is not a member, so it is. Drop the `!members.has`
       filter and `outward` becomes `nebAt satAt wake` — the reading that makes
       every candidate look like it calls back into the file, which is what the
       previous two extraction arguments turned on. */
    expect: {
      functions: 3,
      lines: 9,
      missing: [],
      groups: ["cam", "sky", "view"],
      outward: ["wake"],
      free: ["skyDeps"],
      past: ["setDialAway", "skyRef"],
      deps: 4,
      fails: false,
    },
    /* THE HISTOGRAM, which nothing asserted and which is the shape of the whole
       argument in `close-the-two-gaps.md` — "how many functions are cheap
       enough to move". Rewriting it to count every function as one group left
       the fixtures green and turned the real file's "0: (17), 1: (12), 2: (8)…"
       into a single bar of 69. In this file: `paint` touches none, `satAt` and
       `wake` one each, `nebAt` two. */
    histogram: ["  0: # (1)", "  1: ## (2)", "  2: # (1)"],
    /* The disclosure line under the table: `skyDeps` is an object declared where
       the groups are declared and is not one of them, so nothing charges anyone
       for touching it. Silencing that list was invisible — and it is the only
       warning anyone would get that a fourteenth state owner had appeared. */
    untracked: ["skyDeps"],
    /* The exact text, kinds and all. `[ref]` is the word that tells a reader
       this becomes a permanent accessor rather than an argument. */
    printed: [
      "UNIT: 3 functions, 9 lines",
      "  state groups needed (3): cam sky view",
      "  calls back into the file (1): wake",
      "  other free names (1): skyDeps",
      "  reaches past the effect (2): setDialAway[state] skyRef[ref]",
      "  → a deps object of about 4 members.",
      "\n  GATE: four or more groups means it is not a module — 3 group(s), so this PASSES.",
    ],
  },
  {
    why: "THE GATE ITSELF — the same unit plus one group is four, and four FAILS",
    /* The threshold is the sentence this tool exists to print, and it was
       decided by a `>= 4` that no fixture touched: changing it to `>= 40` left
       every case green while the tool told a reader that a five-group unit was
       extractable. Pinned from both sides — the case above is three and must
       PASS, this one is four and must FAIL — so moving the number either way is
       red. Adding `wake` brings `trip` in with it. */
    members: ["satAt", "nebAt", "paint", "wake"],
    src: UNIT_SRC,
    expect: {
      functions: 4,
      lines: 11,
      missing: [],
      groups: ["cam", "sky", "trip", "view"],
      outward: [],
      free: ["skyDeps"],
      past: ["setDialAway", "skyRef"],
      deps: 3,
      fails: true,
    },
    printed: [
      "UNIT: 4 functions, 11 lines",
      "  state groups needed (4): cam sky trip view",
      "  calls back into the file (0): ",
      "  other free names (1): skyDeps",
      "  reaches past the effect (2): setDialAway[state] skyRef[ref]",
      "  → a deps object of about 3 members.",
      "\n  GATE: four or more groups means it is not a module — 4 group(s), so this FAILS.",
    ],
  },
  {
    why: "a member name that does not exist is NOT FOUND, not silently a smaller unit",
    /* A typo in `--unit` used to quietly measure whatever it did match, and a
       unit measured short is a unit that looks cheap. */
    members: ["satAt", "ghost"],
    src: UNIT_SRC,
    expect: {
      functions: 1,
      lines: 2,
      missing: ["ghost"],
      groups: ["sky"],
      outward: [],
      free: ["skyDeps"],
      past: [],
      deps: 1,
      fails: false,
    },
    printed: [
      "UNIT: 1 functions, 2 lines",
      "  NOT FOUND: ghost",
      "  state groups needed (1): sky",
      "  calls back into the file (0): ",
      "  other free names (1): skyDeps",
      "  reaches past the effect (0): ",
      "  → a deps object of about 1 members.",
      "\n  GATE: four or more groups means it is not a module — 1 group(s), so this PASSES.",
    ],
  },
];

/**
 * THE ARGUMENT FIXTURES — what got chosen, before anything got measured.
 *
 * Small, and the last mechanisms with no coverage at all. Each expectation here
 * corresponds to a break that changed a printed number with everything else
 * green: `--file` ignored measures the wrong file entirely, a truncated `--unit`
 * measures a unit short, and an inverted `--only` shows the rows nobody asked
 * for. Paths are compared after `resolve`, since that is what the real call does.
 */
const ARG_SELFTEST = [
  {
    why: "no --file means the real Home.tsx",
    argv: ["node", "measure-groups.mjs"],
    file: "/repo/src/pages/Home.tsx",
  },
  {
    why: "--file aims the measurement somewhere else, and is not quietly dropped",
    argv: ["node", "measure-groups.mjs", "--file", "/tmp/old-home.tsx"],
    file: "/tmp/old-home.tsx",
  },
  {
    why: "--file still works alongside the other flags",
    argv: ["node", "measure-groups.mjs", "--only", "sky", "--file", "/tmp/old-home.tsx"],
    file: "/tmp/old-home.tsx",
    members: null,
  },
  {
    why: "no --unit means no unit block at all",
    argv: ["node", "measure-groups.mjs"],
    file: "/repo/src/pages/Home.tsx",
    members: null,
  },
  {
    why: "--unit keeps EVERY member, spaces and all — a unit measured short looks cheap",
    argv: ["node", "measure-groups.mjs", "--unit", "step, satAt ,nebAt"],
    file: "/repo/src/pages/Home.tsx",
    members: ["nebAt", "satAt", "step"],
  },
  {
    why: "--unit with an empty name does not invent a member called nothing",
    argv: ["node", "measure-groups.mjs", "--unit", "step,,nebAt"],
    file: "/repo/src/pages/Home.tsx",
    members: ["nebAt", "step"],
  },
];

/* `--only` chooses rows, so it is checked against rows. The name test is part of
   the filter on purpose — `--only sky` is meant to catch `satAt` and `nebAt`,
   which touch the sky without naming it as a group. */
const ONLY_SELFTEST = [
  {
    why: "--only sky keeps group members and sky-named rows, and nothing else",
    filter: "sky",
    rows: [
      { name: "tick", groups: ["sky", "view"] },
      { name: "onKey", groups: ["cam"] },
      { name: "nebAt", groups: [] },
      { name: "syncDom", groups: ["view"] },
    ],
    kept: ["tick", "nebAt"],
  },
  {
    why: "no --only keeps everything, in the order it was measured",
    filter: null,
    rows: [
      { name: "tick", groups: ["sky", "view"] },
      { name: "onKey", groups: ["cam"] },
    ],
    kept: ["tick", "onKey"],
  },
];

function selftest() {
  const failures = [];
  const show = (a) => (a.length ? a.join(" ") : "(none)");
  const same = (got, want) => got.length === want.length && got.every((v, i) => v === want[i]);

  for (const c of SELFTEST) {
    const { report, componentScope, effect } = measure(c.src, "selftest.tsx");
    const row = report.find((r) => r.name === c.fn);
    const problems = [];

    if (c.noEffect) {
      if (effect !== null) {
        problems.push(`      expected no frame effect — got one, with rows: ${show(report.map((r) => r.name))}`);
      }
    } else if (!row) {
      problems.push(`      no row for \`${c.fn}\` at all — rows: ${show(report.map((r) => r.name))}`);
    } else {
      for (const bucket of ["groups", "freeOther", "calls", "outer"]) {
        const want = [...c.expect[bucket]].sort();
        if (!same(row[bucket], want)) {
          problems.push(`      ${bucket}: wanted ${show(want)} — got ${show(row[bucket])}`);
        }
      }
      /* The printed line, not just the sets behind it — see `formatRow`. */
      if (c.printedRow !== undefined && formatRow(row) !== c.printedRow) {
        problems.push(`      printed row:\n        wanted |${c.printedRow}|\n           got |${formatRow(row)}|`);
      }
    }
    if (c.rows) {
      const want = [...c.rows].sort();
      const got = report.map((r) => r.name).sort();
      if (!same(got, want)) problems.push(`      rows: wanted ${show(want)} — got ${show(got)}`);
    }
    for (const [name, kind] of Object.entries(c.kinds ?? {})) {
      const got = componentScope.get(name)?.kind ?? "(not in scope at all)";
      if (got !== kind) problems.push(`      \`${name}\` held as: wanted ${kind} — got ${got}`);
    }

    if (problems.length > 0) {
      failures.push(`  ${c.why}\n${problems.join("\n")}\n      ${c.src.replace(/\n/g, "\n      ")}\n`);
    }
  }

  for (const c of UNIT_SELFTEST) {
    const { report, componentScope, untracked } = measure(c.src, "selftest.tsx");
    const unit = summariseUnit(report, new Set(c.members));
    const problems = [];

    for (const [key, want] of Object.entries(c.expect)) {
      const got = unit[key];
      const wrong = Array.isArray(want) ? !same(got, want) : got !== want;
      if (wrong) {
        const w = Array.isArray(want) ? show(want) : String(want);
        const g = Array.isArray(got) ? show(got) : String(got);
        problems.push(`      ${key}: wanted ${w} — got ${g}`);
      }
    }

    if (c.untracked && !same(untracked, c.untracked)) {
      problems.push(`      untracked objects: wanted ${show(c.untracked)} — got ${show(untracked)}`);
    }
    if (c.histogram && !same(histogramLines(report), c.histogram)) {
      problems.push(
        `      histogram: wanted ${show(c.histogram)} — got ${show(histogramLines(report))}`,
      );
    }

    const printed = formatUnit(unit, componentScope);
    if (!same(printed, c.printed)) {
      problems.push(
        `      printed block:\n` +
          c.printed
            .map((want, i) => (printed[i] === want ? `        ok  |${want}|` : `        BAD wanted |${want}|\n            got    |${printed[i] ?? "(nothing)"}|`))
            .join("\n") +
          (printed.length > c.printed.length
            ? `\n        BAD extra line |${printed[c.printed.length]}|`
            : ""),
      );
    }

    if (problems.length > 0) {
      failures.push(`  ${c.why}\n    --unit ${c.members.join(",")}\n${problems.join("\n")}\n`);
    }
  }

  for (const c of ARG_SELFTEST) {
    const problems = [];
    const file = targetFile(c.argv, "/repo/src/pages/Home.tsx");
    if (file !== resolve(c.file)) {
      problems.push(`      measures: wanted ${resolve(c.file)} — got ${file}`);
    }
    if (c.members !== undefined) {
      const got = unitMembers(c.argv);
      if (c.members === null) {
        if (got !== null) problems.push(`      unit: wanted no unit block — got ${show([...got])}`);
      } else if (got === null) {
        problems.push(`      unit: wanted ${show(c.members)} — got no unit block`);
      } else if (!same([...got].sort(), c.members)) {
        problems.push(`      unit: wanted ${show(c.members)} — got ${show([...got].sort())}`);
      }
    }
    if (problems.length > 0) {
      failures.push(`  ${c.why}\n    argv: ${c.argv.slice(2).join(" ") || "(none)"}\n${problems.join("\n")}\n`);
    }
  }

  for (const c of ONLY_SELFTEST) {
    const got = rowsToPrint(c.rows, c.filter).map((r) => r.name);
    if (!same(got, c.kept)) {
      failures.push(
        `  ${c.why}\n    --only ${c.filter ?? "(none)"}\n` +
          `      rows shown: wanted ${show(c.kept)} — got ${show(got)}\n`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(
      `\nmeasure-groups SELF-TEST FAILED — the numbers below it cannot be trusted.\n` +
        `This tool reports the cost of a boundary. Under-reporting is the dangerous\n` +
        `direction: a seam that looks cheap gets built before anyone finds out.\n\n` +
        failures.join("\n"),
    );
    process.exit(1);
  }
  console.log(
    `measure-groups: self-test passed ` +
      `(${SELFTEST.length} row cases, ${UNIT_SELFTEST.length} unit cases, ` +
      `${ARG_SELFTEST.length + ONLY_SELFTEST.length} argument cases)`,
  );
}

/**
 * AND THE ONE CHECK NO FIXTURE CAN MAKE — is `GROUPS` still about this file?
 *
 * A fixture writes both sides of the question, so it can never notice the two
 * sides drifting apart. Only the real file can answer this, and it answers it on
 * every run of the tool, including `--selftest` in `pnpm test`: the drift this
 * catches happens in `Home.tsx`, and it is `pnpm test` that runs when someone
 * renames something there.
 *
 * Not conditional on anything. `--file` still points the MEASUREMENT wherever it
 * is aimed, but the constant is always checked against the real `Home.tsx`,
 * because a check that only runs sometimes is one that was never run on the day
 * it mattered. If the file cannot be read, that is a failure and it says so
 * rather than passing quietly.
 */
const REAL_HOME = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "pages", "Home.tsx");

function assertGroupsAreReal() {
  let source;
  try {
    source = readFileSync(REAL_HOME, "utf8");
  } catch (err) {
    console.error(
      `\nmeasure-groups: cannot read ${REAL_HOME}\n` +
        `  ${err.message}\n` +
        `  The group names below are checked against that file. Unread, they are\n` +
        `  thirteen unverified strings, so this is a failure and not a skip.\n`,
    );
    process.exit(1);
  }

  const { effect, declaredInEffect } = measure(source, REAL_HOME);
  if (!effect) {
    console.error(
      `\nmeasure-groups: no frame effect found in ${REAL_HOME}\n` +
        `  Nothing can be checked against a file this tool cannot find its way into.\n`,
    );
    process.exit(1);
  }

  const gone = groupsNotDeclared(declaredInEffect);
  if (gone.length > 0) {
    console.error(
      `\nmeasure-groups: GROUPS HAS DRIFTED FROM THE FILE — every number below would be wrong.\n\n` +
        `  Not declared at the frame effect's top level any more: ${gone.join(", ")}\n\n` +
        `  These names are hardcoded in this script and matched by text. A renamed\n` +
        `  state object does not break anything here, it just stops being counted:\n` +
        `  every function that touched it silently loses one group. That is enough to\n` +
        `  move a unit from "4 group(s), so this FAILS" to "3 group(s), so this\n` +
        `  PASSES" — the gate deciding the opposite thing, quietly.\n\n` +
        `  If the rename was intentional, mirror it in GROUPS and re-measure. The\n` +
        `  numbers in docs/goals/close-the-two-gaps.md were taken with the old names.\n`,
    );
    process.exit(1);
  }
}

/* Before the measurement, never after: a number nobody can check is worse than
   no number, and by the time the table is on screen it has already been read. */
selftest();
assertGroupsAreReal();
if (process.argv.includes("--selftest")) process.exit(0);

/**
 * `--file` exists so a correction to this tool can be CHECKED rather than
 * asserted. The blind spot above was found by comparing the tool's answer for
 * the sky against the deps list the extraction actually had to write; proving
 * the fix meant pointing it at the pre-extraction `Home.tsx` from git and
 * seeing nine become fifteen. A measuring instrument that can only ever be
 * aimed at one file cannot be tested against a case with a known answer.
 */
const HOME = targetFile(process.argv, REAL_HOME);

const { report, componentScope, effectLine, untracked } = measure(readFileSync(HOME, "utf8"), HOME);

/* An absence, said as one. The alternative — an empty table under a confident
   header — is how the arrow-component bug read for a file full of state. */
if (effectLine === null) {
  console.log(`No effect hook found in ${HOME}. There is nothing here this tool can measure.`);
  process.exit(0);
}

const onlyArg = process.argv.indexOf("--only");
const rows = rowsToPrint(report, onlyArg === -1 ? null : process.argv[onlyArg + 1]);

rows.sort((a, b) => b.groups.length - a.groups.length || b.lines - a.lines);

/* WHICH function was measured, said out loud. The effect is chosen by size among
   the file's effect hooks, and 4b and 4c exist to change those sizes; if the
   choice ever moves, this line moves with it, which is the difference between a
   retarget you notice and a different table you believe. */
console.log(`${report.length} functions declared in the frame effect (line ${effectLine}).`);
console.log(
  `${componentScope.size} names in the component body around it, ` +
    `${[...componentScope.values()].filter((v) => v.kind === "ref").length} of them refs.`,
);
/* Read this next to the counts: these are objects living where the groups live
   that GROUPS does not track, so nothing below charges anyone for touching
   them. Today both are known and neither is state — a fourteenth owner would
   show up here first. */
console.log(
  untracked.length
    ? `Not tracked as groups, though declared alongside them: ${untracked.join(" ")}\n`
    : `Every object declared at the effect's top level is a tracked group.\n`,
);
console.log(TABLE_HEADER);
console.log("-".repeat(100));
for (const r of rows) console.log(formatRow(r));

console.log("\ngroups touched → how many functions");
for (const line of histogramLines(report)) console.log(line);

/*
 * A MODULE IS A SET, NOT A FUNCTION.
 *
 * The gate in 4c asks about a candidate module, and a candidate is several
 * functions moving together. Measured one at a time they all look cheap; what
 * decides it is the union of what the SET needs and — the part that sank the
 * previous two attempts — what the set still calls back into the file for.
 */
const members = unitMembers(process.argv);
if (members) {
  const unit = summariseUnit(report, members);
  console.log(`\n${"=".repeat(72)}`);
  for (const line of formatUnit(unit, componentScope)) console.log(line);
}
