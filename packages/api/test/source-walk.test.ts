/**
 * The shared gate walk tolerates a file that disappears between being listed
 * and being looked at. A dangling symlink is that moment held still: listed by
 * the directory read, gone the instant anything follows it.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { listSourceFiles, readListedFile } from "./helpers/source-walk.js";

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

function tree(): string {
  const root = mkdtempSync(join(tmpdir(), "source-walk-"));
  roots.push(root);
  mkdirSync(join(root, "lib"));
  writeFileSync(join(root, "lib", "kept.ts"), "export const kept = 1;\n");
  symlinkSync(join(root, "lib", "already-removed.ts"), join(root, "lib", "vanished.probe.ts"));
  return root;
}

describe("the shared source walk", () => {
  it("lists through a file removed between the directory read and its stat", () => {
    const root = tree();
    const files = listSourceFiles(root, (path) => path.endsWith(".ts"));
    expect(files).toContain(join(root, "lib", "kept.ts"));
  });

  it("reads a removed file as absent rather than throwing", () => {
    const root = tree();
    expect(readListedFile(join(root, "lib", "vanished.probe.ts"))).toBeNull();
    expect(readListedFile(join(root, "lib", "kept.ts"))).toContain("kept");
  });
});
