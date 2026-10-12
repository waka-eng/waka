/**
 * THE REFERENCE LIBRARY IS NOT NAMED IN THIS REPOSITORY.
 *
 * Founder, after a day of design work that cited a published component
 * library in dozens of comments: "also dont mention astryx at all in any of
 * our codebase. readme, codebase, nowhere. we're just referencing it to
 * build our own thing. this is a MUST DO. NEVER MENTION ASTRYX ANYWHERE."
 *
 * ── WHY A GATE AND NOT A SCRUB ───────────────────────────────────────────
 *
 * The scrub happened — source, stylesheets, docs, and the two local commit
 * messages that carried it. A scrub fixes the past. This is a MUST DO with
 * no expiry, and the work that keeps provoking it is ongoing: every surface
 * being reworked this week gains a header comment explaining what was
 * harvested from that library and why, and the honest instinct while
 * writing one is to say where the rule came from. That instinct is what
 * this gate stands against.
 *
 * ── WHY THE PATTERN IS WIDER THAN ONE WORD ───────────────────────────────
 *
 * "Never mention it" is not satisfied by deleting one proper noun. A
 * comment reading "Meta's design system says" names it to anybody who would
 * recognise the name, and so does the docs URL. So the gate watches the
 * product name, the package scope it publishes under, and the host its
 * documentation is served from.
 *
 * IT DOES NOT WATCH THE WORD "META", and that absence is deliberate rather
 * than an oversight: `metadata`, `meta description`, `--t-meta` and
 * `message.meta` are all over this codebase, and a gate that cries at those
 * would be turned off within a week. The phrase that actually identifies
 * the library is the one caught below.
 *
 * ── WHAT IS STILL ALLOWED, AND MUST BE ───────────────────────────────────
 *
 * The REASONING. Every comment that says "the reference library's
 * text-input component makes the clear button part of the anatomy" stays
 * exactly as it is, and should: the argument is why the code looks the way
 * it does, and deleting it would leave the next reader with a decision and
 * no account of it. Bare component names — `TextInput`, `ChatComposer`,
 * `Popover` — stay too; they are generic interface words and are how the
 * patterns are discussed everywhere.
 *
 * The founder's instruction was about ATTRIBUTION, not about the ideas.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing, and there is nothing it
 * could mock. The subject is the bytes on disk, so the only thing beneath
 * this suite is the filesystem — replacing that would mean testing a
 * fixture's spelling rather than the repository's.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Directories whose contents are not ours to police. */
const SKIP = new Set([
  "node_modules", ".git", "dist", "build", ".next", "coverage",
  ".turbo", ".sst", ".vite", "cdk.out",
]);

/**
 * WHAT IDENTIFIES IT. The product name, the npm scope it ships under, and
 * the host its docs are served from — any one of these names it to a reader
 * who would know. Case-insensitive, because a lower-case mention in a
 * commit-style comment is still a mention.
 */
const NAMES = [/astryx/i, /atmeta\.com/i];

function everyFile(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    let stat;
    try { stat = statSync(path); } catch { continue; }
    if (stat.isDirectory()) everyFile(path, found);
    else if (stat.size < 2_000_000) found.push(path);
  }
  return found;
}

describe("the reference library is not named here", () => {
  it("reads the repository at all", () => {
    /* THE TRIPWIRE. A walk that silently finds nothing passes forever and
       watches nothing — the same failure mode `copy.test.ts` and
       `reachable.test.ts` each guard with a floor. If the skip list or the
       root ever goes wrong, this is what says so. */
    const files = everyFile(ROOT);
    expect(files.length, "the walk found almost no files — is the root wrong?")
      .toBeGreaterThan(300);
    expect(
      files.some((path) => path.endsWith(join("packages", "web", "src", "pages", "Home.tsx"))),
      "the walk did not reach the product's own source",
    ).toBe(true);
  });

  it("names it in no file", () => {
    const named: string[] = [];
    for (const path of everyFile(ROOT)) {
      let text: string;
      try { text = readFileSync(path, "utf8"); } catch { continue; }
      /* THIS FILE IS THE ONE PLACE THE PATTERNS MAY APPEAR, because a gate
         has to be able to say what it is looking for. */
      if (path.endsWith("unnamed-reference.test.ts")) continue;
      for (const pattern of NAMES) {
        if (pattern.test(text)) {
          named.push(`${path.slice(ROOT.length + 1)} — ${pattern}`);
          break;
        }
      }
    }
    expect(
      named,
      "the reference library is named in these files. Founder: \"NEVER " +
        "MENTION ASTRYX ANYWHERE.\" Keep the reasoning and drop the " +
        "attribution — write \"the reference library's text-input " +
        "component\" rather than naming it, and never write the docs URL.\n" +
        named.join("\n"),
    ).toEqual([]);
  });
});
