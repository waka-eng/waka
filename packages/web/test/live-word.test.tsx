// @vitest-environment jsdom
/**
 * A LIVE REGION IS MOUNTED EMPTY, THEN SPOKEN INTO (review).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing but the clock (fake timers), to step past the beat
 * between mounting the region and filling it. A region that arrives already
 * holding its words is not announced by most screen readers.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LiveWord } from "../src/components/LiveWord";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });

it("mounts the status region empty and puts the words in after", async () => {
  await act(async () => root.render(<LiveWord text="Recording" />));
  const region = host.querySelector('[role="status"]')!;
  expect(region.textContent).toBe("");
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(region.textContent).toBe("Recording");
});
