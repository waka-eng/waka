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
