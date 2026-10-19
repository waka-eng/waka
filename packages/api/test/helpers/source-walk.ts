/**
 * The source walk the static gates share (orphans, human-only gate, prompt
 * fence).
 *
 * Other suites plant `*.probe.ts` fixtures in `src/` and remove them while the
 * whole package runs in parallel, so a path that was listed can be gone by the
 * time it is looked at. The directory read carries each entry's type, so no
 * separate stat can race; a read that finds the file gone answers null.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Every file under `dir` that `keep` accepts, recursively. */
export function listSourceFiles(dir: string, keep: (path: string) => boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) listSourceFiles(path, keep, out);
    else if (keep(path)) out.push(path);
  }
  return out;
}

/** A listed file's text, or null when it was removed after it was listed. */
export function readListedFile(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
