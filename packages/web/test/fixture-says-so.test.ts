/**
 * THE ALARM ON THE FIXTURE, PROVEN TO GO OFF.
 *
 * WHAT THIS MOCKS, AND WHY: nothing. There is no layer under it to mock —
 * `lib/fixture/offline-home.ts` reaches no network, no database and no clock
 * it did not read itself, which is the one thing that makes it safe to call
 * from a test at all. G6 in `docs/goals/a-codebase-you-can-navigate.md` asks
 * every suite to say this; here the answer is short.
 *
 * WHY IT EXISTS. G6 exists because a suite once passed while describing that
 * fixture: it mocked `lib/api` instead of `lib/data`, the loader threw, the
 * page did what it is built to do and replaced the world with invented rows,
 * and every assertion held against a world no product code had produced. The
 * fixture now warns on its way past, so that failure would announce itself in
 * the test output.
 *
 * G7 is why this file is here rather than a note saying the warning exists.
 * "Nothing green is blind" — an alarm nobody has heard is an alarm nobody has
 * checked, and this repo has already had one gate that was clean over half a
 * file because it was only ever proven at one place. So this asserts both
 * halves: that the fixture announces itself, and that the announcement names
 * the mistake that produces it, since a warning that says only "fixture" sends
 * the reader looking for a config flag rather than at their own mock.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { offlineHome } from "../src/lib/fixture/offline-home";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the offline fixture", () => {
  it("says out loud that nothing it returns is real", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const home = offlineHome();

    /* Vitest sets DEV, so this is the branch that hands a world back. If this
       is ever null the test below is vacuous, which is the failure mode this
       assertion exists to prevent. */
    expect(home).not.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);

    const said = String(warn.mock.calls[0]?.[0] ?? "");
    expect(said).toContain("THE DEV FIXTURE IS ON SCREEN");
    /* the sentence that turns a warning into an instruction */
    expect(said).toContain("mock lib/data, not lib/api");
  });

  it("warns every time it is asked, not only the first", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    offlineHome();
    offlineHome();

    /* A once-per-process warning would be silent for every test after the
       first in the same file — which is exactly the run where a suite is most
       likely to be describing the fixture without knowing it. */
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
