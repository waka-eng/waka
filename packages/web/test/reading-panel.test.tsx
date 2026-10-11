// @vitest-environment jsdom
/**
 * THE READING'S PANEL, PINNED.
 *
 * goal: the-legible-loop, Phase 1. Two laws:
 *
 *   1. The panel rewords nothing — the sentences on screen are exactly the
 *      sentences the API served, because the surface's whole claim is that
 *      its words are drift-pinned to the code.
 *   2. Not one digit reaches the screen: constants arrive as words, and the
 *      panel's fetch-pending state keeps the law too.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). The `reading` prop is a fixture in the
 * exact shape `fetchTheReading` returns — the network read is the page's
 * (Home fetches on open) and this suite is about what the panel SHOWS.
 * `onClose` is a vi.fn spy: closing is a verb the page owns. Nothing else is
 * replaced — the real component, real React, real (jsdom) document. The
 * fixture sentences mirror the API's registry style on purpose, so a digit
 * smuggled into a sentence would fail here the way it fails the API's own
 * `the-reading.test.ts`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReadingPanel } from "../src/components/ReadingPanel";

let root: Root | null = null;
let host: HTMLElement | null = null;

function renderPanel(reading: Parameters<typeof ReadingPanel>[0]["reading"]): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  act(() => {
    root = createRoot(host!);
    root.render(<ReadingPanel reading={reading} onClose={vi.fn()} />);
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("the reading panel", () => {
  it("shows the served sentences verbatim, the coda quieter, and no digit anywhere", () => {
    const el = renderPanel({
      sentences: [
        "When three of your memories say the same thing, WAKA speaks it back to you as a pattern.",
        "Your own words are never rewritten.",
      ],
      coda: "What you do teaches it: an answer weighs, a star holds, a release returns.",
    });

    expect(el.textContent).toContain(
      "When three of your memories say the same thing, WAKA speaks it back to you as a pattern.",
    );
    expect(el.textContent).toContain("Your own words are never rewritten.");
    expect(el.querySelector(".jar-reading-coda")?.textContent).toContain(
      "a star holds",
    );
    expect(
      /\d/.test(el.textContent ?? ""),
      "a numeral reached the reading's surface",
    ).toBe(false);
  });

  it("says it is still fetching rather than rendering an empty page", () => {
    const el = renderPanel(null);
    expect(el.textContent).toContain("Still fetching the reading");
    expect(/\d/.test(el.textContent ?? "")).toBe(false);
  });
});
