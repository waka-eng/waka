// @vitest-environment jsdom
/**
 * A RAISED PAGE THAT DROPS OUT COMES BACK IF ITS CLOSE FAILS.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. Timers are faked so the
 * drop-out and the 1.5s return can be stepped through, and the page is given
 * a `getAnimations` because jsdom has none (without it `leaveAsModal` closes
 * at once, which is not the path under test). `leaveAsModal` itself is real.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { leaveAsModal, MODAL_LEAVE_MS } from "../src/components/DialogSurface";

let page: HTMLElement;
beforeEach(() => {
  vi.useFakeTimers();
  page = document.createElement("div");
  page.dataset.motion = "modal";
  (page as unknown as { getAnimations: () => Animation[] }).getAnimations = () => [];
  document.body.append(page);
});
afterEach(() => { page.remove(); vi.useRealTimers(); });

it("drops out, closes, and comes back after 1.5s if the page is still here", () => {
  const close = vi.fn();
  leaveAsModal(close, page);
  expect(page.dataset.leaving).toBe("1");
  vi.advanceTimersByTime(MODAL_LEAVE_MS);
  expect(close).toHaveBeenCalledTimes(1);
  expect(page.dataset.leaving).toBe("1");
  vi.advanceTimersByTime(1500);
  expect(page.dataset.leaving).toBeUndefined();
});

it("a close that throws still brings the page back rather than leaving it invisible", () => {
  leaveAsModal(() => { throw new Error("recorder would not stop"); }, page);
  expect(() => vi.advanceTimersByTime(MODAL_LEAVE_MS)).toThrow("recorder would not stop");
  expect(page.dataset.leaving).toBe("1");
  vi.advanceTimersByTime(1500);
  expect(page.dataset.leaving).toBeUndefined();
  // And it can be left again.
  const close = vi.fn();
  leaveAsModal(close, page);
  vi.advanceTimersByTime(MODAL_LEAVE_MS);
  expect(close).toHaveBeenCalledTimes(1);
});
