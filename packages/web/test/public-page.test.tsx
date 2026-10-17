// @vitest-environment jsdom
/**
 * /@handle — THE ONE SURFACE A STRANGER EVER SEES, and it had no test at all.
 *
 * That is not an oversight to repair quietly; it is the reason the page looked
 * like a different product for as long as it did. `docs/six-laws.md` names
 * `PublicProfile` under Law 5 as a surface that had never been through a craft
 * pass, and Law 3 explains how a surface gets to be that: "any component
 * rendered only in a state the founder has not happened to open." Nothing
 * mounted this page in CI either, so every ruling that moved the product onto
 * the near-black grainy ground simply did not reach it.
 *
 * WHAT IT WAS WEARING, measured: five pastel post-its, each with its own paper
 * colour and its own ink colour out of a table in the page file, at hand-set
 * tilts in degrees, on a WHITE ground, with the title in Fraunces serif and
 * the owner's name in italic, over a three-blob parchment wash whose circles
 * drift up and down on their own — founder, Law 6: "the bottom of the page
 * still has the old floating circles, I can see it float up and down once in a
 * while." It was the last living reference to `.nc-note` / `.nc-canvas` in the
 * tree, the language of the flat screens that were deleted around it.
 *
 * So these cases are deliberately about MATERIAL rather than only about
 * behaviour, because material is what was wrong. A test that only asserted
 * "the statements render" would have been green on every day of it.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6).
 *
 *   `lib/api` — and within it exactly one function, `fetchPublicProfile`,
 *   which `lib/api/public-profiles` defines as the only unauthenticated read
 *   in the whole client. The rest of the real module is spread back in, so
 *   `ApiError` and every payload type stay the product's own. It is the layer
 *   directly beneath this page: the page calls it and renders what comes
 *   back, with nothing in between.
 *   There is no fixture fallback here — a 404 renders the "not here" state,
 *   any other failure renders "didn't open" with a retry, and nothing else —
 *   so a wrong mock produces an empty page and a red
 *   test rather than a green one describing something else. That is the
 *   condition that makes mocking this layer safe on this page and not on the
 *   world: the world has fixture fallbacks and would go green describing
 *   something else.
 *
 *   THIS USED TO CITE `Profile.test.ts` instead of saying it. That file went
 *   with the settings page, leaving a G6 declaration resting on a reference
 *   to nothing. Cite a sibling for a RULE if you must; never for the reason
 *   your own mock is sound.
 *
 *   `lib/auth-context` — whether the reader has a world of their own is what
 *   the page's single control says, so it is the axis walked here. Stating the
 *   session is the only way to reach both faces of it; how a session is
 *   arrived at belongs to `auth-boundary.test.ts`.
 *
 * React Router's real history and the real stylesheets' CLASS CONTRACT run.
 * Appearance is not claimed — jsdom computes no cascade — so what is asserted
 * is which classes the page asks for, and `test/type-scale.test.ts` holds what
 * those classes are allowed to be made of.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import PublicProfilePage from "../src/pages/PublicProfile";
import { ApiError, fetchPublicProfile } from "../src/lib/api";

const reader = vi.hoisted(() => ({ signedIn: false }));

vi.mock("../src/lib/auth-context", () => ({
  useOptionalAuth: () => ({ isAuthenticated: reader.signedIn }),
}));

vi.mock("../src/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/api")>()),
  fetchPublicProfile: vi.fn(),
}));

const SHARED = {
  profile: { name: "River", handle: "river", preferredLocale: "en-US" as const },
  topOfMind: {
    version: 3,
    publishedAt: "2026-10-01T00:00:00.000Z",
    entries: [
      { type: "reading" as const, body: "I keep returning to what I cannot finish.", belief: null, prompt: null, pinned: false },
      { type: "reading" as const, body: "Second thing.", belief: null, prompt: null, pinned: false, supportChanged: true },
      { type: "reading" as const, body: "Third thing.", belief: null, prompt: null, pinned: false },
    ],
  },
};

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let here = "";

function Address(): null {
  here = useLocation().pathname;
  return null;
}

beforeEach(() => {
  reader.signedIn = false;
  vi.mocked(fetchPublicProfile).mockReset().mockResolvedValue(SHARED);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function visit(at = "/@river"): Promise<void> {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[at]}>
        <Address />
        <Routes>
          <Route path="/:handle" element={<PublicProfilePage />} />
          <Route path="/" element={<p>the world</p>} />
          <Route path="/login" element={<p>the door</p>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  await act(async () => undefined);
}

describe("the page a stranger sees", () => {
  it("shows whose it is and what they said, in order", async () => {
    await visit();
    expect(host.querySelector(".waka-public-title")?.textContent).toContain("River");
    const said = Array.from(host.querySelectorAll(".waka-public-body")).map((n) => n.textContent);
    expect(said).toEqual([
      "I keep returning to what I cannot finish.",
      "Second thing.",
      "Third thing.",
    ]);
  });

  /**
   * LIGHT IS THE ONLY MEANING CHANNEL — the founder law this page broke most
   * directly. Each statement carried `--bg` and `--ink` set to a pastel pair
   * out of a table, plus `--decay` spent on BOTH opacity and `saturate()`, so
   * a reading's third line was simultaneously fainter, greyer, and printed on
   * different coloured paper. Three channels saying the one thing the first
   * one already said, in the one place the product reserves for identity.
   *
   * There is one number now and `claims.css` spends it on ink. This asserts
   * the shape of that contract rather than its arithmetic: exactly one custom
   * property per statement, it descends, and it never reaches zero — "fading
   * never deletes", so the last line of a long reading is still read.
   */
  it("carries the weighting in one channel and no other", async () => {
    await visit();
    const weights = Array.from(host.querySelectorAll<HTMLElement>(".waka-public-said")).map(
      (node) => {
        const declared = node.getAttribute("style") ?? "";
        expect(
          declared.split(";").filter((part) => part.trim().length > 0),
          "a statement sets ONE custom property; the post-it version set seven",
        ).toHaveLength(1);
        return Number(node.style.getPropertyValue("--waka-said-weight"));
      },
    );
    expect(weights[0]).toBe(1);
    expect(weights[1]).toBeLessThan(weights[0]!);
    expect(weights[2]).toBeLessThan(weights[1]!);
    expect(Math.min(...weights)).toBeGreaterThan(0);
  });

  /** The product's own sentence for this state, not a second one written for
      this page — Law 3 is that one state gets one sentence everywhere. */
  it("says a reading needs another look in the words the rest of the product uses", async () => {
    await visit();
    expect(host.querySelector(".waka-public-aside")?.textContent).toBe(
      "This reading needs another look.",
    );
  });

  /**
   * NOTHING ON THIS PAGE PROMISES A DRAG. The notes said `cursor: grab`, which
   * is a control naming an act (Law 1) — and there is no drag here, because
   * nothing on this page belongs to the person reading it. Asserted as the
   * absence of the whole class, since that is what carried the promise.
   */
  it("offers no handle on something a visitor cannot move", async () => {
    await visit();
    expect(host.querySelector(".nc-note")).toBeNull();
    expect(host.querySelector(".nc-canvas")).toBeNull();
    expect(host.querySelector(".bg-field")).toBeNull();
  });

  /**
   * LAW 2, BOTH ARRIVALS. A stranger has nowhere behind them, so the corner is
   * a way IN and says so; `Login` then offers the way back to this page, which
   * is the only arrival the door can honestly return anyone to. A signed-in
   * reader has a world, so the same corner is a way OUT and costs one press.
   */
  it("is a way in for a stranger and a way out for a reader with a world", async () => {
    await visit();
    const corner = host.querySelector<HTMLButtonElement>(".waka-public-enter")!;
    expect(corner.textContent).toBe("Create your WAKA");
    await act(async () => corner.click());
    expect(here).toBe("/login");

    await act(async () => root.unmount());
    root = createRoot(host);
    reader.signedIn = true;
    await visit();
    const out = host.querySelector<HTMLButtonElement>(".waka-public-enter")!;
    expect(out.textContent).toBe("Open WAKA");
    await act(async () => out.click());
    expect(here).toBe("/");
  });

  /**
   * THE PAGE THAT IS NOT THERE still has the two things it owes: the address
   * typed, which is how a visitor sees their own typo, and a way onward. The
   * failure's own message is NOT among them — the `ApiError` string used to be
   * held in state and then never rendered, which is a sentence from the API
   * client waiting for somebody to print it to a stranger.
   */
  it("names the handle and offers a way onward when there is no page", async () => {
    vi.mocked(fetchPublicProfile).mockRejectedValue(new ApiError({ status: 404, message: "Failed to load public profile" }));
    await visit("/@nobody");
    expect(host.querySelector(".waka-public-handle")?.textContent).toBe("@nobody");
    expect(host.textContent).toContain("This page is not here");
    expect(host.textContent).not.toContain("Failed to load");
    expect(host.querySelector(".waka-public-enter")).not.toBeNull();
  });

  /**
   * A SERVER THAT FAILED IS NOT A PAGE THAT IS NOT THERE. A 500 or a dead
   * connection used to render "This page is not here" — a false statement
   * about somebody else's page, made to a stranger, with nothing to try. It
   * says it did not open now, and Try again reads it again.
   */
  it("says the page did not open, rather than that it is missing, and tries again", async () => {
    vi.mocked(fetchPublicProfile).mockRejectedValueOnce(new ApiError({ status: 500, message: "boom" }));
    await visit();
    expect(host.textContent).toContain("This page didn’t open");
    expect(host.textContent).not.toContain("This page is not here");
    const retry = [...host.querySelectorAll<HTMLButtonElement>(".waka-public-enter")]
      .find((button) => button.textContent === "Try again")!;
    await act(async () => retry.click());
    await act(async () => undefined);
    expect(host.querySelector(".waka-public-title")?.textContent).toBe("River’s top of mind");
  });

  /** The way in does not depend on the read, so it is there while it runs. */
  it("offers the way in while the page is still opening", async () => {
    vi.mocked(fetchPublicProfile).mockReturnValue(new Promise(() => undefined));
    await visit();
    expect(host.textContent).toContain("Opening this page…");
    expect(host.querySelector(".waka-public-enter")?.textContent).toBe("Create your WAKA");
  });

  /** A read that never answers ends, and ends in the state with a retry. */
  it("stops waiting after fifteen seconds", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchPublicProfile).mockImplementation((_handle, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new ApiError({ status: 0, message: "aborted" })));
      }));
      await visit();
      expect(host.textContent).toContain("Opening this page…");
      await act(async () => vi.advanceTimersByTimeAsync(15_000));
      expect(host.textContent).toContain("This page didn’t open");
    } finally {
      vi.useRealTimers();
    }
  });

  /** Shared page, unshared board: the owner's choice, and a state rather than
      an error. `topOfMind` is null and the page says so in its own words. */
  it("says nothing is shared rather than showing an empty wall", async () => {
    vi.mocked(fetchPublicProfile).mockResolvedValue({ profile: SHARED.profile, topOfMind: null });
    await visit();
    expect(host.querySelector(".waka-public-reading")).toBeNull();
    expect(host.querySelector(".waka-public-state")?.textContent).toBe(
      "Nothing is shared here yet.",
    );
  });
});
