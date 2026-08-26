/**
 * NOTHING IN THE TREE IS UNREFERENCED — the module half.
 *
 * goal: one-product-one-system, audit A4, whose end state includes exactly
 * that sentence. `e2e:dead-css` answers it for stylesheets by asking a
 * browser; this answers it for modules, which needs no browser because an
 * import graph is a fact about the source.
 *
 * WHAT IT CAUGHT ON THE DAY IT WAS WRITTEN. Two files, both orphans of the
 * flat screens deleted the same week, both of which had been sitting in the
 * bundle's dependency graph looking entirely reasonable:
 *
 *   `components/faces.ts` — "Lifted out of Home so the rail can use it
 *   without importing a page." The rail went out with `surface.css`.
 *
 *   `lib/confidence.ts` — 93 lines turning a confidence number into three
 *   named bands, because "the flat surfaces have no light channel, so they
 *   printed the number instead". In the world confidence IS the light, and
 *   `docs/data-model.md` says so; nothing needs the words.
 *
 * Neither was findable by grep: both had the shape of live code and names
 * that read like live code. What made them visible is that nothing imports
 * them, and that is only visible from the whole graph at once.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. It reads the source files as
 * text and follows their imports; there is no seam here to replace.
 *
 * TWO THINGS IT MUST NOT CALL DEAD, both learned by watching it try:
 *
 *   A LAZY IMPORT IS AN IMPORT. `main.tsx` reaches the world through
 *   `lazy(() => import("./pages/Home"))`, and a matcher written for
 *   `from "…"` misses it entirely — the first run of this reported
 *   `pages/Home.tsx`, the largest file in the product, as unreferenced.
 *
 *   AN AMBIENT DECLARATION IS NOT IMPORTED BY ANYONE. `.d.ts` files are
 *   pulled in by `tsconfig`, never by a statement.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../src");

/** Where the application starts. Everything else must be reachable from here. */
const ENTRY = ["main.tsx"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

/**
 * Every specifier a file imports, static or lazy, resolved to a real path.
 * `import(` is matched as well as `from` — see the header for what missing it
 * cost the first time.
 */
function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const here = dirname(file);
  const found: string[] = [];
  for (const match of text.matchAll(/(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g)) {
    const spec = match[1]!;
    if (!spec.startsWith(".")) continue;
    const base = resolve(here, spec);
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      resolve(base, "index.ts"),
      resolve(base, "index.tsx"),
    ]) {
      try {
        if (statSync(candidate).isFile()) {
          found.push(candidate);
          break;
        }
      } catch {
        /* not this one */
      }
    }
  }
  return found;
}

describe("every module in the tree is reachable from the entry point", () => {
  it("has no orphans", () => {
    const all = walk(SRC);
    const reachable = new Set<string>();
    const queue = ENTRY.map((name) => resolve(SRC, name));
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (reachable.has(file)) continue;
      reachable.add(file);
      for (const next of importsOf(file)) queue.push(next);
    }

    const orphans = all
      .filter((file) => !reachable.has(file))
      .map((file) => file.slice(SRC.length + 1))
      .sort();

    expect(
      orphans,
      "these modules are not reachable from `main.tsx` by any import, lazy or " +
        "otherwise. A file that nothing imports still typechecks, still reads " +
        "like live code, and still has to be understood by everyone who opens " +
        "it — usually it is the leftover of a screen that was deleted around " +
        "it. Delete it, or import it from wherever it was meant to be used.",
    ).toEqual([]);
  });

  it("reaches the world, which is only ever imported lazily", () => {
    /* A GUARD ON THE GUARD. If the `import(` half of the matcher above is ever
       broken, this suite does not fail loudly — it starts reporting most of
       the product as orphaned, and the temptation is to widen the allowance
       rather than fix the matcher. Naming the one lazy edge in the product
       makes that failure say what it actually is. */
    const reachable = new Set<string>();
    const queue = ENTRY.map((name) => resolve(SRC, name));
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (reachable.has(file)) continue;
      reachable.add(file);
      for (const next of importsOf(file)) queue.push(next);
    }
    expect(reachable.has(resolve(SRC, "pages/Home.tsx"))).toBe(true);
  });
});

/**
 * AND THE SAME QUESTION ONE LEVEL DOWN: an export nothing calls.
 *
 * The module check above passes happily on a file that is imported for one of
 * its five functions. Four dead ones were found this way on 2026-08-26, all in
 * live, imported modules:
 *
 *   `fetchGraph`        — the graph screen it served was deleted three
 *                         commits earlier; the call to fetch its data was not.
 *   `fetchReflections`  — redundant: `GET /inspirations/:id` already returns
 *                         a capture WITH its reflections.
 *   `deleteSignal`      — deliberately not offered. `everything-in-the-world`
 *                         ruled that a hard delete contradicts *fading never
 *                         deletes*, and the world answers a wrong pattern with
 *                         a counted stance instead. The route stays on the
 *                         server; this client wrapper was the flat screens'
 *                         and went with them.
 *   `isMachine`         — a one-line helper nothing asks.
 *
 * Deleting `deleteSignal` then stranded its `requestVoid` import, which the
 * compiler caught — dead code holds more dead code up.
 *
 * SCOPE, AND WHY IT IS NARROW. Only `lib/api`, `space/` and `space-kinds/` are
 * swept: those are call-surfaces, where an export exists to be used and an
 * unused one is a leftover. A component module exporting a type or a constant
 * that only its own file reads is a different thing and not swept here.
 *
 * A name used ONLY by a test still counts as unused for this purpose — a
 * function kept alive by its own test is a function the product does not call,
 * and the test is testing the leftover rather than the product. Say so by
 * deleting both.
 */
describe("every export on a call-surface is called", () => {
  const SURFACES = ["lib/api", "space", "space-kinds"];

  function everySourceFile(): string[] {
    return walk(SRC);
  }

  it("has no export that only its own declaration mentions", () => {
    const declared = new Map<string, string>();
    for (const file of everySourceFile()) {
      const rel = file.slice(SRC.length + 1);
      if (!SURFACES.some((dir) => rel.startsWith(`${dir}/`))) continue;
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/export (?:async )?function (\w+)|export const (\w+)/g)) {
        declared.set((match[1] ?? match[2]) as string, rel);
      }
    }

    /* THE WHOLE TREE AS ONE STRING, WITH ITS IMPORT STATEMENTS REMOVED.
       An import is not a use. The first version of this counted one, so a
       function imported into a page and never called read as alive — which is
       the exact shape it was written to catch, one level up. Stripping the
       import statements means a name has to be MENTIONED somewhere it could
       actually run. Re-exports survive the strip, because `export { x } from`
       is not an import statement and passing a name onward is a use of it. */
    let blob = "";
    for (const file of everySourceFile()) {
      blob += readFileSync(file, "utf8").replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g, " ");
    }

    const unused: string[] = [];
    for (const [name, where] of declared) {
      const uses = blob.match(new RegExp(`(?<![\\w.])${name}\\b`, "g"))?.length ?? 0;
      if (uses <= 1) unused.push(`${name} (${where})`);
    }

    expect(
      unused.sort(),
      "these are exported from a call-surface and nothing in the product calls " +
        "them. An export exists to be used; one that is not is a leftover of " +
        "whatever was deleted around it, and it holds its own imports up with " +
        "it. Delete it, or call it from wherever it was meant to be used.",
    ).toEqual([]);
  });
});
