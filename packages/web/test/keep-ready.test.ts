/**
 * WHAT STOPS A NOTE FROM BEING KEPT, ENUMERATED.
 *
 * This logic used to live in two places — the composer's disabled attribute
 * and `keepIt`'s opening guards — and the two were never the same list. It
 * was reachable only by rendering a note and probing a DOM attribute, which
 * is why the drift went unnoticed: a test that presses a button can tell you
 * THAT nothing happened and not WHY, so a silently-returning save and a
 * correctly-blocked one looked identical from the outside.
 *
 * `whyNotKept` is a pure function over settled state, so the causes can be
 * listed. WHAT THIS MOCKS, AND WHY (gate G6): nothing. There is nothing to
 * mock — no clock, no network, no DOM.
 */
import { describe, expect, it } from "vitest";

import {
  canKeep,
  KEEP_FILE_LIMIT,
  whyNotKept,
  type KeepReadiness,
} from "../src/lib/keep-ready";

/** A note with words in it and nothing wrong. */
const ready: KeepReadiness = {
  hasWords: true,
  ready: true,
  saving: false,
  uploading: false,
  recording: false,
  undecidedRecording: false,
  invalidFiles: 0,
  files: 0,
};

describe("whether a note can be kept", () => {
  it("keeps a note that has words and nothing wrong with it", () => {
    expect(whyNotKept(ready)).toBeNull();
    expect(canKeep(ready)).toBe(true);
  });

  /* A BLANK PAGE IS NOT AN ERROR. It has no Save on it at all — the bar
     renders the pair only when there is something to keep — so a reason
     here would be the product complaining that you have not written
     anything yet. */
  it("says nothing at all about an empty note, and still will not keep it", () => {
    const empty = { ...ready, hasWords: false };
    expect(whyNotKept(empty)).toBeNull();
    expect(canKeep(empty)).toBe(false);
  });

  it("names each thing that blocks a save", () => {
    const cases: Array<[Partial<KeepReadiness>, string]> = [
      [{ recording: true }, "worldComposerFinishRecording"],
      [{ undecidedRecording: true }, "worldComposerChooseRecording"],
      [{ ready: false }, "worldComposerOpening"],
      [{ uploading: true }, "worldComposerUploading"],
      [{ saving: true }, "worldComposerUploading"],
      [{ invalidFiles: 1 }, "worldComposerFixFiles"],
      [{ files: KEEP_FILE_LIMIT + 1 }, "worldComposerTooManyFiles"],
    ];
    for (const [state, reason] of cases) {
      expect(whyNotKept({ ...ready, ...state }), JSON.stringify(state)).toBe(reason);
      expect(canKeep({ ...ready, ...state }), JSON.stringify(state)).toBe(false);
    }
  });

  /* THE LIMIT IS A CEILING, NOT A FENCE — five is fine and six is not, and
     an off-by-one here would reject a save the server would have taken. */
  it("allows exactly the limit and refuses one more", () => {
    expect(whyNotKept({ ...ready, files: KEEP_FILE_LIMIT })).toBeNull();
    expect(whyNotKept({ ...ready, files: KEEP_FILE_LIMIT + 1 })).toBe(
      "worldComposerTooManyFiles",
    );
  });

  /**
   * THE ORDER IS THE MESSAGE, which is the part a later edit is most likely
   * to break without noticing: only the first reason is ever shown, so
   * reordering the checks silently changes what a person is told.
   *
   * A running recording outranks everything, because stopping it is the
   * thing to do before thinking about anything else; a file count is last,
   * because telling somebody they have too many attachments while one of
   * them is also unreadable is answering the wrong question.
   */
  it("reports the most actionable reason when several are true at once", () => {
    const everything: KeepReadiness = {
      hasWords: true,
      ready: false,
      saving: true,
      uploading: true,
      recording: true,
      undecidedRecording: true,
      invalidFiles: 2,
      files: 9,
    };
    expect(whyNotKept(everything)).toBe("worldComposerFinishRecording");
    expect(whyNotKept({ ...everything, recording: false })).toBe(
      "worldComposerChooseRecording",
    );
    expect(
      whyNotKept({ ...everything, recording: false, undecidedRecording: false }),
    ).toBe("worldComposerOpening");
    expect(
      whyNotKept({
        ...everything,
        recording: false,
        undecidedRecording: false,
        ready: true,
      }),
    ).toBe("worldComposerUploading");
    expect(
      whyNotKept({
        ...everything,
        recording: false,
        undecidedRecording: false,
        ready: true,
        saving: false,
        uploading: false,
      }),
    ).toBe("worldComposerFixFiles");
  });

  /* EVERY REASON IS A REAL MESSAGE KEY. The type says so and the type is
     erased; this reads the catalogue, so a key renamed in the JSON and not
     here fails the build rather than printing its own name at somebody. */
  it("names only messages that exist in the catalogue", async () => {
    const messages = (await import("../src/lib/i18n/messages/en-US.json")).default as Record<string, string>;
    const reasons = new Set<string>();
    for (const state of [
      { recording: true },
      { undecidedRecording: true },
      { ready: false },
      { uploading: true },
      { invalidFiles: 1 },
      { files: KEEP_FILE_LIMIT + 1 },
    ]) {
      const why = whyNotKept({ ...ready, ...state });
      if (why) reasons.add(why);
    }
    expect(reasons.size).toBe(6);
    for (const key of reasons) expect(messages[key], key).toBeTruthy();
  });
});
