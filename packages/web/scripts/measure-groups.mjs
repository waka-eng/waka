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
 * Run: node scripts/measure-groups.mjs [--only sky] [--unit a,b,c]
 *      node scripts/measure-groups.mjs --selftest    (fixtures only; in `pnpm test`)
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ts = createRequire(import.meta.url)("typescript");

/** The eleven owners 4a created, plus the two singles it deliberately left. */
const GROUPS = new Set([
  "view", "cam", "trip", "companion", "gesture",
  "sky", "pour", "clock", "stir", "poster", "hinted",
  "mech", "ground",
]);

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

  /* A source with no function expression at all has no frame effect to measure.
     Only reachable from a fixture or a `--file` aimed at the wrong thing, but
     the alternative is a null dereference, and "cannot read properties of null"
     is a terrible thing for a self-test failure to say. */
  if (!effect || !effect.body) {
    return { effect: null, declaredInEffect: new Map(), componentScope: new Map(), report: [] };
  }

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
    let p = effect.parent;
    while (p && !((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p)) && p.body)) p = p.parent;
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
        if (!isMember && !isKey && !bound.has(n.text)) {
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

  return { effect, declaredInEffect, componentScope, report };
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
    /* `.current` must not show up anywhere in the answer. If it ever does, the
       member-name skip has gone, and every `foo.bar` in the file is about to be
       counted as a dependency on something called `bar`. */
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
    why: "a property KEY that happens to spell a group name is not a read of that group",
    fn: "makesLiteral",
    /* `{ view: 1 }` names a field, not the state object. Losing the key skip
       would put a group on almost every function in the file and the histogram
       would quietly stop meaning anything. */
    expect: { groups: ["cam"], freeOther: [], calls: [], outer: [] },
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
];

function selftest() {
  const failures = [];
  const show = (a) => (a.length ? a.join(" ") : "(none)");
  const same = (got, want) => got.length === want.length && got.every((v, i) => v === want[i]);

  for (const c of SELFTEST) {
    const { report, componentScope } = measure(c.src, "selftest.tsx");
    const row = report.find((r) => r.name === c.fn);
    const problems = [];

    if (!row) {
      problems.push(`      no row for \`${c.fn}\` at all — rows: ${show(report.map((r) => r.name))}`);
    } else {
      for (const bucket of ["groups", "freeOther", "calls", "outer"]) {
        const want = [...c.expect[bucket]].sort();
        if (!same(row[bucket], want)) {
          problems.push(`      ${bucket}: wanted ${show(want)} — got ${show(row[bucket])}`);
        }
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

  if (failures.length > 0) {
    console.error(
      `\nmeasure-groups SELF-TEST FAILED — the numbers below it cannot be trusted.\n` +
        `This tool reports the cost of a boundary. Under-reporting is the dangerous\n` +
        `direction: a seam that looks cheap gets built before anyone finds out.\n\n` +
        failures.join("\n"),
    );
    process.exit(1);
  }
  console.log(`measure-groups: self-test passed (${SELFTEST.length} cases)`);
}

/* Before the measurement, never after: a number nobody can check is worse than
   no number, and by the time the table is on screen it has already been read. */
selftest();
if (process.argv.includes("--selftest")) process.exit(0);

/**
 * `--file` exists so a correction to this tool can be CHECKED rather than
 * asserted. The blind spot above was found by comparing the tool's answer for
 * the sky against the deps list the extraction actually had to write; proving
 * the fix meant pointing it at the pre-extraction `Home.tsx` from git and
 * seeing nine become fifteen. A measuring instrument that can only ever be
 * aimed at one file cannot be tested against a case with a known answer.
 */
const fileArg = process.argv.indexOf("--file");
const HOME =
  fileArg === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), "..", "src", "pages", "Home.tsx")
    : resolve(process.argv[fileArg + 1]);

const { report, componentScope } = measure(readFileSync(HOME, "utf8"), HOME);

const onlyArg = process.argv.indexOf("--only");
const filter = onlyArg === -1 ? null : process.argv[onlyArg + 1];
const rows = filter
  ? report.filter((r) => r.groups.includes(filter) || /sky|neb|sat|cluster/i.test(r.name))
  : report;

rows.sort((a, b) => b.groups.length - a.groups.length || b.lines - a.lines);

console.log(`${report.length} functions declared in the frame effect.`);
console.log(
  `${componentScope.size} names in the component body around it, ` +
    `${[...componentScope.values()].filter((v) => v.kind === "ref").length} of them refs.\n`,
);
console.log("name                          lines  groups  in-effect  past-effect  groups touched");
console.log("-".repeat(100));
for (const r of rows) {
  console.log(
    `${r.name.padEnd(28)}  ${String(r.lines).padStart(5)}  ${String(r.groups.length).padStart(6)}  ` +
      `${String(r.freeOther.length + r.calls.length).padStart(9)}  ` +
      `${String(r.outer.length).padStart(11)}  ${r.groups.join(" ")}`,
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
  const past = new Set();
  let lines = 0;
  for (const r of rowsIn) {
    lines += r.lines;
    for (const g of r.groups) groups.add(g);
    for (const c of r.calls) if (!members.has(c)) outward.add(c);
    for (const f of r.freeOther) if (!members.has(f)) free.add(f);
    for (const o of r.outer) past.add(o);
  }

  console.log(`\n${"=".repeat(72)}\nUNIT: ${rowsIn.length} functions, ${lines} lines`);
  if (missing.length) console.log(`  NOT FOUND: ${missing.join(", ")}`);
  console.log(`  state groups needed (${groups.size}): ${[...groups].sort().join(" ")}`);
  console.log(`  calls back into the file (${outward.size}): ${[...outward].sort().join(" ")}`);
  console.log(`  other free names (${free.size}): ${[...free].sort().join(" ")}`);
  /* Printed with its kind, because that is the sentence a reader needs: a ref
     here becomes a permanent accessor on the deps object, and knowing how many
     of those there will be is the difference between the nine this used to
     report for the sky and the fifteen `SkyDeps` actually has. */
  console.log(
    `  reaches past the effect (${past.size}): ` +
      [...past]
        .sort()
        .map((n) => `${n}[${componentScope.get(n)?.kind ?? "?"}]`)
        .join(" "),
  );
  console.log(
    `  → a deps object of about ${outward.size + free.size + past.size} members.`,
  );
  console.log(
    `\n  GATE: four or more groups means it is not a module — ` +
      `${groups.size} group(s), so this ${groups.size >= 4 ? "FAILS" : "PASSES"}.`,
  );
}
