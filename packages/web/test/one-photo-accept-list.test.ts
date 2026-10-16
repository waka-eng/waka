/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. It imports one constant for
 * its value and reads the source tree off disk. No DOM, clock, server or
 * account data is involved. `helpers/code-only` replaces nothing: it is a
 * string transform over source text, so that this file's own prose quoting
 * the accept list cannot be counted as a copy of it. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { withoutComments } from "./helpers/code-only";
import { PHOTO_ACCEPT } from "../src/lib/inspiration-photo";

/**
 * ═══ THE PHOTO RULE HAS ONE HOME, AND THE PICKERS QUOTE IT ══════════════
 *
 * `lib/inspiration-photo.ts` states the rule in its first sentence —
 * "Inspect a small header, not the filename or the browser's MIME guess" —
 * sniffs magic bytes for JPEG, PNG, GIF, WebP, AVIF, HEIC and HEIF, enforces
 * `MAX_PHOTO_BYTES`, and refuses everything else with a sentence.
 *
 * The set it accepts was then typed out at four file inputs, and the fourth
 * disagreed: three said the seven types plus `.heic`/`.heif`, and the memory
 * card's add-attachment picker said `image/*`. So a TIFF, a BMP or an SVG
 * renamed `.jpg` was selectable from one of the product's four pickers and
 * refused with a sentence at the other three — and that same picker's upload
 * path never called the sniffer at all, which is the second case below.
 *
 * ALL FOUR NOW QUOTE THE CONSTANT, and `attachTo` sniffs. The ledger below is
 * empty for the first time, which is the state this gate was written to reach
 * and the state it now defends: a fifth hand-written list fails the first
 * case, and an upload path that stops sniffing fails the second.
 *
 * WHY A GATE AND NOT JUST THE CONSTANT. `PHOTO_ACCEPT` now exists beside the
 * sniffer, and an exported constant does not stop a fifth picker from typing
 * the list out again — the N+1th call site `lib/keep-ready.ts`'s header warns
 * about, which this codebase has now been bitten by in the save rule, the
 * date vocabulary and the view list as well.
 */
const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

function sources(dir: string, found: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sources(path, found);
    else if (path.endsWith(".ts") || path.endsWith(".tsx")) found.push(path);
  }
  return found;
}

/**
 * THE COPIES STILL WRITTEN OUT BY HAND — AND THERE ARE NONE.
 *
 * It held three rows when it was written, all in files under concurrent work,
 * so they were reported with the exact edit rather than edited: a gate naming
 * the one-line change was worth more to their owner than a merge conflict.
 * Their owner made all three, and the rows came out as the gate asked:
 *
 *   `components/NoteTools.tsx`   — the archive note's bar
 *   `pages/Home.tsx`             — the notepad's slot in the dock
 *   `pages/Home.tsx`             — the memory card's add-attachment label,
 *                                  THE ONE THAT DISAGREED, which offered
 *                                  `image/*` where the other three offered
 *                                  seven named types
 *
 * THIS IS A LEDGER AND NOT A WAIVER, and it fails in both directions — which
 * is why it stays here empty rather than being deleted with its last row. A
 * hand-written list fails until somebody adds a row and argues for it in this
 * comment; fixing one fails until its row is deleted. Empty is the assertion
 * now: NO picker in this tree states the accepted set in its own words.
 *
 * (`value` was recorded beside each file so that the copy which DISAGREED was
 * impossible to read past, and `fix` named the edit. Both fields are kept on
 * the type for the next row, whose first job will be to prove it is not a
 * fourth copy of something already stated once.)
 */
const BY_HAND: ReadonlyArray<{ file: string; value: string; fix: string }> = [];

/** Every `accept="…"` written as a literal string in the tree, with comments
    blanked first — this file and `lib/inspiration-photo.ts` both QUOTE the
    list in prose, and a gate that counted its own documentation would report
    copies that do not exist. */
function handWritten(): Array<{ file: string; value: string }> {
  const found: Array<{ file: string; value: string }> = [];
  for (const path of sources(SRC)) {
    const text = withoutComments(readFileSync(path, "utf8"));
    for (const hit of text.matchAll(/\baccept=(["'])([^"']*)\1/g)) {
      found.push({ file: path.slice(SRC.length + 1), value: hit[2]! });
    }
  }
  return found;
}

describe("one accepted set of photos, stated once", () => {
  it("reads the tree at all", () => {
    /* THE TRIPWIRE, BECAUSE A GATE THAT READS NOTHING PASSES. If the walk
       broke or every picker were renamed, `handWritten()` would come back
       empty and the ledger assertion would read as "all fixed". */
    expect(sources(SRC).length, "no sources found — has the tree moved?").toBeGreaterThan(50);
    expect(PHOTO_ACCEPT, "the constant is empty, so comparing against it proves nothing")
      .toContain("image/heic");
  });

  it("has no hand-written accept list that is not in the ledger", () => {
    /* `ReadonlyArray` and not `Array`: the ledger above is readonly on
       purpose, and a mutable parameter made passing it a type error that
       nothing reported, since `tsconfig.json` includes `src` only and vitest
       transpiles without checking. */
    const sorted = (rows: ReadonlyArray<{ file: string; value: string }>) =>
      [...rows].map((row) => `${row.file}: ${row.value}`).sort();
    expect(
      sorted(handWritten()),
      "an accept list was written out by hand, or one of the three recorded copies was fixed. " +
        "Use `accept={PHOTO_ACCEPT}` from `lib/inspiration-photo`, and delete the row in BY_HAND.",
    ).toEqual(sorted(BY_HAND));
  });

  it("knows that exactly four upload paths consult the sniffer", () => {
    /**
     * AND THE HALF THAT IS NOT ABOUT THE PICKER AT ALL.
     *
     * `accept` is a hint to the operating system's chooser and can be
     * defeated by renaming, dragging or pasting — so the rule is only
     * actually enforced where `inspectInspirationPhoto` is called. Counted:
     * FOUR calls — two in `Home.tsx`, one in `SavesOverlay.tsx`, one in
     * `ConversationPanel.tsx`.
     *
     *   `addInspirationFiles` — the notepad's picker, its drop handler and
     *   its paste handler. The last two never pass a chooser at all, which
     *   is the clearest statement of why the sniffer and not `accept` is the
     *   check.
     *
     *   `attachTo` — the memory card's add-attachment label, counted at ONE
     *   here until today and the reason this case exists. It used to go
     *   straight to presign, upload and finalize and classify what it had
     *   stored from the browser's guess — `type: file.type.startsWith(
     *   "image/") ? "image" : "file"` — which is the exact input the rule's
     *   first sentence refuses, with no `MAX_PHOTO_BYTES` check either. It
     *   now sniffs first and every later step reads the returned file, so
     *   the stored `contentType` and the `"image"` classification are
     *   statements about bytes that were read.
     *
     *   `SavesOverlay.tsx`'s `attach` — THE FOURTH PATH, closed the same
     *   day it was reported, and the hardest of them because one function
     *   served two doors: the photo input in the bar, and `useAudioRecording`
     *   handing over a clip this product had just made. Sniffing both would
     *   have refused the recorder's own `audio/webm` — correctly, and
     *   uselessly. So the caller now NAMES the door (`came: "photo" |
     *   "recording"`), because the caller is the only thing that knows: a
     *   recording is a Blob built from a `MediaRecorder` a moment earlier
     *   and never off the machine, while a photo is a file a person chose
     *   and is worth exactly its bytes. The parameter defaults to "photo",
     *   so a caller that forgets gets sniffed and refused rather than
     *   trusted.
     *
     *   `ConversationPanel`'s `checkPick` — THE FOURTH, 2026-10-16: a
     *   chat's ＋ → "Add photos", and a photo that arrives by "Add file",
     *   both sniffed before `uploadMessageAttachment` stages them. The
     *   notepad's and the archive note's "Add file" rows reach the sniffer
     *   through the two calls already counted, by their 'file' door.
     *
     * THERE IS NO UNCOUNTED PATH LEFT. When this paragraph said there was,
     * it named `SavesOverlay`; `grep -rn "finalizeAttachment" src` now
     * reaches only call sites that appear in this count.
     *
     * PINNED SO THAT A CHANGE IS AN EVENT, in both directions. Going UP means
     * somebody closed another path — raise the number and say which. Going
     * DOWN means a path that used to read the bytes stopped.
     */
    const calls = sources(SRC)
      .filter((path) => !path.endsWith(join("lib", "inspiration-photo.ts")))
      .flatMap((path) => [...withoutComments(readFileSync(path, "utf8")).matchAll(/\binspectInspirationPhoto\(/g)]);
    expect(
      calls.length,
      "the number of upload paths that sniff the bytes changed. If it went UP, somebody closed " +
        "another path — raise this number and name it. If it went DOWN, a path stopped checking.",
    ).toBe(4);
  });
});
