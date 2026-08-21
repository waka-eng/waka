#!/usr/bin/env node
/**
 * WHAT DOES EACH REQUEST HANDLER ACTUALLY REACH FOR?
 *
 * The API half of gate G5 in `docs/goals/a-codebase-you-can-navigate.md`: no
 * function in a frame loop or a request handler should reach past four state
 * groups without a written reason. `packages/web/scripts/measure-groups.mjs`
 * answers that for the frame loop, where the eleven state objects gave the
 * question a ready-made unit of measure. The API has no such objects, so this
 * has to say what it is counting before it counts anything.
 *
 * A CONCERN, HERE, IS ONE OF TWO THINGS:
 *
 *   1. A DATABASE TABLE the handler reads or writes. Read off the `pgTable`
 *      exports in `src/db/schema-*.ts`, so the list cannot drift from the
 *      schema — adding a table adds it here for free.
 *   2. A MODULE the handler calls into. Not every module: the connection
 *      (`lib/db.js`), the framework (hono), the query builder (drizzle) and
 *      the validator (zod) are excluded, because every handler in the package
 *      touches all four and a number that never varies measures nothing.
 *
 * Both are the same idea from two directions — a distinct thing the handler
 * has to know about, that a reader has to hold in their head to follow it.
 *
 * WHY THE COUNT IS TRANSITIVE THROUGH THE FILE AND STOPS AT ITS EDGE. A
 * handler that calls one file-local helper which itself touches six tables
 * knows about six tables; hiding them behind a name in the same file changes
 * the reading experience not at all, so local names are followed to a fixed
 * point. An IMPORTED module is one concern and is not followed, because that
 * is precisely what a module boundary buys: the reader takes `loadWall` on its
 * name and does not have to hold its four tables.
 *
 * The asymmetry is the whole point, and it is what the numbers below are
 * measuring. `groups.ts` scores 1–3 across all sixteen of its handlers, not
 * because those routes are small — they are the most permission-heavy in the
 * package — but because the work sits behind `groups-membership`,
 * `groups-wall`, `groups-field`, `groups-proposals` and `groups-top-of-mind`.
 * Change the rule to follow imports and the same file scores in the teens. So
 * this number answers "how much does a reader of THIS handler have to hold",
 * not "how much code runs" — and a handler can only lower it by giving
 * something a name that means something.
 *
 * WHAT IT DOES NOT CLAIM. This counts breadth, not badness. Some handlers are
 * legitimately wide — a sign-up writes an account, a profile and a session in
 * one transaction because those three either all exist or none do. The output
 * is a list to write reasons against, not a list of defects. That judgement is
 * in the goal document; this only supplies the numbers.
 *
 * Run: node scripts/measure-concerns.mjs [--min 5] [--verbose]
 */
import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ts = createRequire(import.meta.url)("typescript");
const API = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = join(API, "src", "routes");
const DB = join(API, "src", "db");

const minArg = process.argv.indexOf("--min");
const MIN = minArg === -1 ? 5 : Number(process.argv[minArg + 1]);
const VERBOSE = process.argv.includes("--verbose");

const parse = (file) =>
  ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

/**
 * THE TABLES, READ FROM THE SCHEMA ITSELF. `export const foo = pgTable(` is the
 * one shape the schema files use; anything else that turns up is a new pattern
 * and should make this loud rather than be quietly guessed at.
 */
const tables = new Set();
for (const f of readdirSync(DB)) {
  if (!f.startsWith("schema-") || !f.endsWith(".ts")) continue;
  const sf = parse(join(DB, f));
  (function walk(n) {
    if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.initializer &&
      ts.isCallExpression(n.initializer) &&
      ts.isIdentifier(n.initializer.expression) &&
      n.initializer.expression.text === "pgTable"
    ) {
      tables.add(n.name.text);
    }
    ts.forEachChild(n, walk);
  })(sf);
}

/** Imports that every handler has and that therefore separate nothing. */
const IGNORED_MODULES = [/^hono/, /^zod$/, /^drizzle-orm/, /lib\/db\.js$/, /db\/index\.js$/];
const METHODS = new Set(["get", "post", "patch", "put", "delete", "on", "all"]);

const findings = [];

for (const file of readdirSync(ROUTES).filter((f) => f.endsWith(".ts") && !f.includes(".test."))) {
  const path = join(ROUTES, file);
  const sf = parse(path);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  /** imported name → the module it came from, for the second kind of concern. */
  const importedFrom = new Map();
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !stmt.importClause) continue;
    const from = stmt.moduleSpecifier.text;
    if (IGNORED_MODULES.some((re) => re.test(from))) continue;
    const bindings = stmt.importClause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      /* type-only imports name a shape, not a thing the handler talks to */
      for (const el of bindings.elements) {
        if (!el.isTypeOnly && !stmt.importClause.isTypeOnly) importedFrom.set(el.name.text, from);
      }
    }
    if (stmt.importClause.name) importedFrom.set(stmt.importClause.name.text, from);
  }

  /**
   * WHAT IS DECLARED DIRECTLY IN ONE SCOPE.
   *
   * Not just functions, and not just the file's top level. `groups.ts`
   * registers all sixteen of its handlers inside an exported factory —
   * `createGroupRoutes(deps)` — so every helper they lean on is declared one
   * scope down from the file, and a first draft of this script that only read
   * the file's top-level statements reported all sixteen as touching NOTHING.
   * Nineteen handlers came back with a concern count of zero, which is not a
   * plausible thing for a route to do and is what gave the bug away.
   *
   * It records the initializer whatever its shape, not only arrow functions,
   * because an alias is a dependency too: `const loadMembership =
   * deps.loadMembership ?? loadGroupMembership` is how the group routes reach
   * the membership module, and reading only function literals would miss it.
   */
  const declaredIn = (scope) => {
    const out = new Map();
    const stmts = ts.isSourceFile(scope) ? scope.statements : (scope.body?.statements ?? []);
    for (const stmt of stmts) {
      if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) out.set(stmt.name.text, stmt);
      else if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer) out.set(d.name.text, d.initializer);
        }
      }
    }
    return out;
  };

  /** Outermost first, so an inner declaration shadows an outer one. */
  const scopeChainFor = (node) => {
    const chain = [];
    for (let p = node; p; p = p.parent) {
      if (ts.isSourceFile(p) || (ts.isFunctionLike(p) && p.body && ts.isBlock(p.body))) chain.unshift(p);
    }
    const merged = new Map();
    for (const scope of chain) for (const [k, v] of declaredIn(scope)) merged.set(k, v);
    return merged;
  };

  /** What one body reaches for, before following any call to a name in scope. */
  const direct = (node, scope) => {
    const hit = { tables: new Set(), modules: new Set(), locals: new Set() };
    (function walk(n) {
      if (ts.isIdentifier(n)) {
        const p = n.parent;
        const isMember = ts.isPropertyAccessExpression(p) && p.name === n;
        const isKey = ts.isPropertyAssignment(p) && p.name === n && !ts.isShorthandPropertyAssignment(p);
        if (!isMember && !isKey) {
          if (tables.has(n.text)) hit.tables.add(n.text);
          else if (importedFrom.has(n.text)) hit.modules.add(importedFrom.get(n.text));
          else if (scope.has(n.text)) hit.locals.add(n.text);
        }
      }
      ts.forEachChild(n, walk);
    })(node);
    return hit;
  };

  /** Follow local calls to a fixed point: a helper's reach is the caller's. */
  const closure = (seed, scope) => {
    const tablesOut = new Set(seed.tables);
    const modulesOut = new Set(seed.modules);
    const seen = new Set();
    const queue = [...seed.locals];
    while (queue.length) {
      const name = queue.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      const decl = scope.get(name);
      if (!decl) continue;
      const d = direct(decl, scope);
      for (const t of d.tables) tablesOut.add(t);
      for (const m of d.modules) modulesOut.add(m);
      for (const l of d.locals) if (!seen.has(l) && l !== name) queue.push(l);
    }
    return { tables: tablesOut, modules: modulesOut, via: seen };
  };

  /**
   * `routes.post("/:id/shares", async (c) => …)` and its siblings.
   *
   * The last argument is USUALLY the handler, but not always: `authRoutes.get(
   * "/callback/google", handleGoogleCallback)` passes it by name. A first draft
   * of this script accepted only an inline function and silently dropped every
   * route written that way — the same shape of hole the web tool had with refs,
   * and worth naming rather than quietly fixing, because it is the hole a
   * measuring script falls into by default: it sees the syntax it expected and
   * reports the rest as absent instead of as unmeasured.
   */
  (function findHandlers(n) {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      METHODS.has(n.expression.name.text) &&
      n.arguments.length >= 2 &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      const last = n.arguments[n.arguments.length - 1];
      const scope = scopeChainFor(n);
      let body = null;
      let byName = null;
      if (ts.isArrowFunction(last) || ts.isFunctionExpression(last)) body = last;
      else if (ts.isIdentifier(last) && scope.has(last.text)) {
        body = scope.get(last.text);
        byName = last.text;
      } else if (ts.isIdentifier(last)) {
        /* Handled in another module. Record the route so the count of routes
           is honest, and mark it: unmeasured is not the same as zero. */
        findings.push({
          file,
          route: `${n.expression.name.text.toUpperCase()} ${n.arguments[0].text}`,
          line: lineOf(n),
          lines: 0,
          tables: [],
          modules: [],
          via: [],
          elsewhere: importedFrom.get(last.text) ?? last.text,
        });
      }
      if (body) {
        const reach = closure(direct(body, scope), scope);
        findings.push({
          file,
          route: `${n.expression.name.text.toUpperCase()} ${n.arguments[0].text}`,
          line: lineOf(n),
          lines: sf.getLineAndCharacterOfPosition(body.getEnd()).line - lineOf(body) + 1,
          tables: [...reach.tables].sort(),
          modules: [...reach.modules].sort(),
          via: [...reach.via].sort(),
          byName,
        });
      }
    }
    ts.forEachChild(n, findHandlers);
  })(sf);
}

for (const f of findings) f.concerns = f.tables.length + f.modules.length;
const measured = findings.filter((f) => !f.elsewhere);
const unmeasured = findings.filter((f) => f.elsewhere);
findings.sort((a, b) => b.concerns - a.concerns || b.lines - a.lines);

console.log(
  `${tables.size} tables in the schema. ${findings.length} routes registered, ` +
    `${measured.length} with a body this can read.\n`,
);
console.log("concerns  lines  route                                        file");
console.log("-".repeat(96));
for (const f of measured) {
  if (f.concerns < MIN) continue;
  console.log(
    `${String(f.concerns).padStart(8)}  ${String(f.lines).padStart(5)}  ${f.route.padEnd(43)}  ${f.file}`,
  );
  if (VERBOSE) {
    console.log(`          tables: ${f.tables.join(" ") || "—"}`);
    console.log(`          modules: ${f.modules.join(" ") || "—"}`);
    if (f.via.length) console.log(`          through local helpers: ${f.via.join(" ")}`);
  }
}

if (unmeasured.length) {
  console.log("\nregistered here, handled elsewhere — counted as routes, not as numbers:");
  for (const f of unmeasured) console.log(`  ${f.route.padEnd(43)}  ${f.file} → ${f.elsewhere}`);
}

const hist = new Map();
for (const f of measured) hist.set(f.concerns, (hist.get(f.concerns) ?? 0) + 1);
console.log("\nconcerns → how many handlers");
for (const k of [...hist.keys()].sort((a, b) => a - b)) {
  console.log(`  ${String(k).padStart(2)}: ${"#".repeat(hist.get(k))} (${hist.get(k)})`);
}
const over = measured.filter((f) => f.concerns > 4).length;
console.log(
  `\n${over} of ${measured.length} handlers reach past four concerns ` +
    `(${Math.round((over / measured.length) * 100)}%).`,
);
