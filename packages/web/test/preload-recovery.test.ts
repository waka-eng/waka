/**
 * The narrow cancel: a stylesheet that never arrived must not cost the screen.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing but the event object, and the
 * event object IS the subject. `handlePreloadError` takes a `vite:preloadError`
 * event and decides whether to cancel it. There is no layer underneath — no
 * fetch, no DOM traversal, no clock. Constructing the event is constructing the
 * input, not standing in for a collaborator.
 *
 * WHAT WOULD MAKE THIS TEST WORTHLESS, stated because it nearly was: asserting
 * only that a CSS failure gets cancelled. That passes just as well on a blanket
 * `preventDefault()` for every preload error, which is the wrong fix — it
 * resolves a genuinely missing JavaScript chunk to `undefined` and moves the
 * failure somewhere further away that names nothing. So the case that carries
 * the weight here is the NEGATIVE one: a non-CSS failure must be left alone, to
 * reach `<SurfaceBoundary>` where it can be reported and retried.
 *
 * The string match on Vite's message is deliberate coupling, disclosed at the
 * site. If an upgrade changes that message, the first case below fails and says
 * so — the black rectangle does not come back, because the boundary now catches
 * what this stops cancelling.
 */
import { describe, expect, it, vi } from "vitest";

import { handlePreloadError, isStylesheetPreloadFailure } from "../src/lib/preload-recovery";

function preloadErrorEvent(payload: unknown): Event & { payload?: unknown } {
  const event = new Event("vite:preloadError", { cancelable: true }) as Event & {
    payload?: unknown;
  };
  event.payload = payload;
  return event;
}

describe("preload recovery", () => {
  it("cancels the stylesheet failure that once cost the whole world", () => {
    /* The exact message from the 2026-08-22 incident, where the named file had
       in fact loaded — 200, correct type, `sheet: true` — and the world was
       withheld anyway. */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const event = preloadErrorEvent(
      new Error("Unable to preload CSS for /assets/Home-Cqw0i9l-.css"),
    );

    expect(handlePreloadError(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);

    warn.mockRestore();
  });

  it("leaves a missing JavaScript chunk alone, so the boundary can report it", () => {
    /* Cancelling this would resolve the module to `undefined`, and React.lazy
       handed `undefined` fails later with a message about element types. A
       missing chunk is a real failure and belongs to <SurfaceBoundary>. */
    const event = preloadErrorEvent(
      new Error("Failed to fetch dynamically imported module: /assets/Home-sozNdt0r.js"),
    );

    expect(handlePreloadError(event)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not guess at payloads it cannot read", () => {
    expect(isStylesheetPreloadFailure(undefined)).toBe(false);
    expect(isStylesheetPreloadFailure(null)).toBe(false);
    expect(isStylesheetPreloadFailure({ message: "Unable to preload CSS for /a.css" })).toBe(
      false,
    );
  });

  it("anchors the match at the head, because the tail is a path", () => {
    /* A loose `includes` would cancel anything that merely quoted the message
       — an aggregated error, a wrapped rethrow — and quietly widen the cancel
       back toward the blanket version this exists to avoid. */
    expect(
      isStylesheetPreloadFailure(new Error("Wrapped: Unable to preload CSS for /a.css")),
    ).toBe(false);
    expect(isStylesheetPreloadFailure(new Error("Unable to preload CSS for /a.css"))).toBe(true);
  });
});
