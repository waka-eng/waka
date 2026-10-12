/**
 * THE REFERENCE LIBRARY IS NOT NAMED IN THIS REPOSITORY.
 *
 * Founder, after a day of design work that cited a published component
 * library in dozens of comments: "also dont mention <it> at all in any of
 * our codebase. readme, codebase, nowhere. we're just referencing it to
 * build our own thing. this is a MUST DO. NEVER MENTION <IT> ANYWHERE."
 *
 * The noun is elided from that quote on purpose. See "WHY THIS FILE NO
 * LONGER SPELLS IT" below — the elision is the point, not squeamishness.
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
 * ── WHY THIS FILE NO LONGER SPELLS IT ────────────────────────────────────
 *
 * It used to. The header quote carried the noun twice, `NAMES` carried it
 * as a regex literal, and the failure message quoted the founder verbatim —
 * four occurrences — and the walk then exempted this path so the gate did
 * not fail on itself. Security review 2026-10-11, finding 11: that
 * self-exemption "is necessary for a gate to state what it looks for, but
 * it means a `grep` of the repository still returns a hit, which is what
 * the instruction was about." The instruction was the word "nowhere", and a
 * file that says "the name appears nowhere" while being the one place the
 * name appears is not keeping it.
 *
 * So the patterns are assembled from character codes at module load. The
 * cost is real and worth naming: you cannot read this file and immediately
 * see what it forbids, which is a genuine loss for the next maintainer.
 * It is paid down by `decoded()` below — run the suite and the failure
 * message names the pattern it matched, so the moment anybody needs to know
 * what the rule is, the rule tells them. What is bought is that the
 * self-exemption is GONE: this file is now walked and matched like every
 * other, so the gate polices itself and the repository-wide `grep` the
 * founder would run comes back empty.
 *
 * REJECTED: a base64 constant. Shorter, but `atob` of an unexplained blob
 * reads as something being hidden from the reader rather than from `grep`,
 * and base64 is not meaningfully harder to deobfuscate than decimal — the
 * only thing either buys is not matching a literal search, and character
 * codes say "assembled, deliberately" to a human at a glance.
 *
 * REJECTED: a fixture file holding the names, gitignored so it never ships.
 * It works, and the review suggested it, but the gate then silently passes
 * on any machine where the fixture is absent — which is every CI runner and
 * every fresh clone. A gate whose rule is in an ignored file is a gate that
 * is off by default, and this one has already been off once.
 *
 * ── WHAT IT READS, AND WHY THAT IS NOW GIT'S LIST ────────────────────────
 *
 * Enumeration is `git ls-files --cached --others --exclude-standard`:
 * everything the repository tracks, plus everything untracked that is not
 * ignored. Two reasons, both from the same review:
 *
 *   - Finding 1. The old code walked the filesystem with `statSync`, which
 *     RESOLVES SYMLINKS, so a symlink to a directory was walked as a
 *     directory and `readFileSync` read whatever sat behind it. The review
 *     reproduced it: `repo/escape -> ../outside` made the walk emit
 *     `repo/escape/secret.txt`, a path outside the tree it was handed, and
 *     the failure message prints matching paths — so a match found in
 *     somebody's home directory would be printed into CI output. Git's list
 *     cannot leave the repository. `lstatSync` in `readableFiles` closes
 *     the other half, because git happily lists a TRACKED symlink and
 *     `readFileSync` would still follow that one.
 *
 *   - Finding 12. The walk read `.env.local` (two live connection strings),
 *     `.waka-attachments-local/` (cached user attachments) and `scratch/`
 *     into memory as UTF-8 on every run, and would have printed the
 *     containing path on a match. All three are gitignored, so
 *     `--exclude-standard` drops them for free.
 *
 * `--others` rather than tracked-only is load-bearing: the rule has to bite
 * on a file somebody just wrote and has not staged, which is exactly when
 * the attribution instinct strikes. Tracked-only would move the failure to
 * the commit after the mistake. Verified both ways on 2026-10-11: an
 * unstaged, unignored file containing the name fails this suite, and the
 * failure names the path.
 *
 * WHAT THIS GIVES UP, SAID PLAINLY. Ignored paths are no longer read, so a
 * `scratch/` note or a `*-probe.ts` throwaway may name the library and this
 * gate will not say so. That is the intended trade and not an oversight:
 * the instruction is about this CODEBASE, an ignored file is by definition
 * not part of it and cannot be published from it, and the price of reading
 * them was that every run slurped `.env.local`'s two connection strings and
 * whatever user attachments were cached locally — and that a developer's
 * private scratch file could fail a build CI passes. If the rule ever needs
 * to cover ignored files too, the honest fix is to stop ignoring them, not
 * to widen this walk back out.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing in the repository case —
 * the subject is the bytes on disk, so the only thing beneath it is the
 * filesystem, and replacing that would mean testing a fixture's spelling
 * rather than the repository's. The symlink case below is the exception and
 * builds a real temporary tree with a real symlink, because the property
 * under test is what the operating system does with one.
 */
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * WHAT IDENTIFIES IT. The product name (which also catches the npm scope it
 * ships under, `@<name>/...`) and the host its docs are served from — either
 * one names it to a reader who would know.
 *
 * Assembled from character codes so the literal is absent from this file;
 * see "WHY THIS FILE NO LONGER SPELLS IT" above. Case-insensitive, because a
 * lower-case mention in a commit-style comment is still a mention.
 */
const CODES: number[][] = [
  [97, 115, 116, 114, 121, 120],
  [97, 116, 109, 101, 116, 97, 46, 99, 111, 109],
];
const decoded = (codes: number[]): string => String.fromCharCode(...codes);
const NAMES = CODES.map(
  (codes) => new RegExp(decoded(codes).replace(/\./g, "\\."), "i"),
);

/**
 * EVERYTHING GIT WOULD SHOW YOU, as absolute paths.
 *
 * `-z` because a filename may contain a newline, and `git ls-files` without
 * it quotes and escapes such names — which would hand us a path that does
 * not exist. There is no fallback if git is missing: the tripwire below
 * fails on an empty list, which is the correct outcome for a gate that
 * cannot see the repository. A gate that quietly switches to a weaker
 * enumeration is how finding 12 survived.
 */
function repositoryFiles(): string[] {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return out.split("\0").filter(Boolean).map((relative) => join(ROOT, relative));
}

/**
 * THE ONES IT IS SAFE AND USEFUL TO READ.
 *
 * `lstatSync`, NOT `statSync` — this is finding 1. `statSync` follows a
 * symlink and reports the target, so a tracked symlink pointing anywhere on
 * the machine would be opened, read, and its path printed on a match.
 * `lstatSync` reports the link itself, and a link is skipped: a symlink has
 * no bytes of its own to police, and whatever it points at is either
 * already in this list under its real path or is not ours to read.
 *
 * Exported because that is the whole property finding 1 was about, and a
 * property asserted only through a 1300-file walk is asserted vaguely. The
 * symlink case below hands it a two-entry list and a real link.
 */
export function readableFiles(paths: string[]): string[] {
  const keep: string[] = [];
  for (const path of paths) {
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      /* raced away between the listing and here, or a dangling entry */
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    if (!stat.isFile()) continue;
    if (stat.size >= 2_000_000) continue;
    keep.push(path);
  }
  return keep;
}

describe("the reference library is not named here", () => {
  it("reads the repository at all", () => {
    /* THE TRIPWIRE. A walk that silently finds nothing passes forever and
       watches nothing — the same failure mode `copy.test.ts` and
       `reachable.test.ts` each guard with a floor. If the skip list or the
       root ever goes wrong, this is what says so. It also covers the new
       enumeration's own failure mode: a missing git, a detached worktree, a
       tarball export with no index — each yields an empty list and fails
       here rather than passing vacuously. */
    const files = readableFiles(repositoryFiles());
    expect(files.length, "the walk found almost no files — is the root wrong?")
      .toBeGreaterThan(300);
    expect(
      files.some((path) => path.endsWith(join("packages", "web", "src", "pages", "Home.tsx"))),
      "the walk did not reach the product's own source",
    ).toBe(true);
    /* AND IT REACHES THIS FILE. There is no self-exemption any more, so the
       gate's own bytes are in the set it checks — assert that, because a
       re-introduced exemption would be invisible otherwise. */
    expect(
      files.some((path) => path.endsWith(join("test", "unnamed-reference.test.ts"))),
      "the gate no longer reads itself, so it has stopped policing itself",
    ).toBe(true);
  });

  it("never reads through a symlink, however one got into the list", () => {
    /* FINDING 1, ASSERTED DIRECTLY. The review's own reproduction, shrunk:
       a file outside the tree, a link inside it pointing at that file. The
       old `statSync` code reported the link as a readable regular file and
       `readFileSync` then returned the outside bytes. `lstatSync` plus the
       symlink skip must drop it while leaving the ordinary sibling alone —
       the gate must not lose coverage to gain containment. */
    const base = mkdtempSync(join(tmpdir(), "unnamed-reference-"));
    try {
      const outside = join(base, "outside");
      const inside = join(base, "repo");
      mkdirSync(outside);
      mkdirSync(inside);
      /* A NEUTRAL SENTINEL, not the forbidden name. The property under test
         is "bytes from outside the tree never reach the reader", and any
         unique string proves that; writing the real name into a fixture
         would be the exact mistake this suite exists to catch, in a file
         this suite cannot see. */
      const sentinel = "OUTSIDE-THE-REPOSITORY-6f3a1c";
      const secret = join(outside, "secret.txt");
      writeFileSync(secret, `${sentinel}\n`, "utf8");
      writeFileSync(join(inside, "plain.txt"), "ordinary tracked bytes\n", "utf8");
      symlinkSync(secret, join(inside, "escape"));

      const kept = readableFiles([join(inside, "plain.txt"), join(inside, "escape")]);

      expect(kept, "the ordinary file was dropped along with the link").toEqual([
        join(inside, "plain.txt"),
      ]);
      /* The consequence, not just the mechanism: nothing the gate would go
         on to read carries what sits behind the link. */
      for (const path of kept) {
        expect(readFileSync(path, "utf8")).not.toContain(sentinel);
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("names it in no file", () => {
    const named: string[] = [];
    for (const path of readableFiles(repositoryFiles())) {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      for (const pattern of NAMES) {
        if (pattern.test(text)) {
          named.push(`${path.slice(ROOT.length + 1)} — ${pattern.source}`);
          break;
        }
      }
    }
    expect(
      named,
      "the reference library is named in these files. The founder's rule is " +
        "that the name appears NOWHERE in this codebase — readme, source, " +
        "comments, commit messages. Keep the reasoning and drop the " +
        "attribution: write \"the reference library's text-input " +
        "component\" rather than naming it, and never write the docs URL. " +
        "The two patterns, if you need to see them: " +
        CODES.map((codes) => decoded(codes)).join(", ") +
        "\n" +
        named.join("\n"),
    ).toEqual([]);
  });
});
