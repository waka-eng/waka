// @vitest-environment jsdom

/**
 * A STALLED READING SAYS SO.
 *
 * A dead end from the audit of 2026-10-17:
 *   `ReadingPausedNotice` + `useReadingPaused` — a reading that failed (out
 *   of credit is a 402) was silent on every page. These read
 *   `/principles/status` and restart through `/principles/refresh?retry=1`.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api`'s `fetchPrincipleStatus` and
 * `retryPausedReading`, the layer directly beneath the hook, so a case can
 * say "the reading failed" and then "the retry worked" without a server. The
 * hook, the component, the locale catalog and React are real.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReadingPausedNotice } from "../src/components/ReadingPausedNotice";
import { ApiError, fetchPrincipleStatus, retryPausedReading } from "../src/lib/api";
import { useReadingPaused } from "../src/lib/use-reading-paused";

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return { ...actual, fetchPrincipleStatus: vi.fn(), retryPausedReading: vi.fn() };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
function render(element: ReturnType<typeof createElement>) {
  if (!container) { container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container); }
  act(() => root!.render(element));
}
afterEach(() => { act(() => root?.unmount()); container?.remove(); root = null; container = null; });

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

describe("a paused reading", () => {
  function Page() {
    const state = useReadingPaused(true);
    return createElement(ReadingPausedNotice, { state, locale: "en-US" });
  }
  const status = (readingPaused: boolean) => ({ phase: "ready" as const, eligible: true, signalCount: 3, topOfMindCount: 1, readingPaused });

  it("says the saves are safe and offers a Retry that restarts the reading", async () => {
    vi.mocked(fetchPrincipleStatus).mockResolvedValue(status(true));
    vi.mocked(retryPausedReading).mockResolvedValue(status(false));
    render(createElement(Page));
    await settle();
    expect(container!.textContent).toContain("Reading is paused — your saves are safe.");
    const retry = [...container!.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
    vi.useFakeTimers();
    try {
      await act(async () => { retry.click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
    } finally { vi.useRealTimers(); }
    expect(retryPausedReading).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toBe("");
  });

  it("stays down beside the principles line when that line already says it failed, so there is one Retry", async () => {
    vi.mocked(fetchPrincipleStatus).mockResolvedValue({ ...status(true), phase: "failed" });
    function Home() {
      const state = useReadingPaused(true);
      return createElement(ReadingPausedNotice, { state, locale: "en-US", besidePrincipleRead: true });
    }
    render(createElement(Home));
    await settle();
    expect(container!.textContent, "two failure lines and two Retry buttons for one stall").toBe("");
  });

  /* No server cooldown: Retry guards itself, disabled and "Retrying…" until
     its request answers and for at least three seconds, even when the server
     refuses at once. */
  it("holds Retry disabled as Retrying… for at least three seconds, even on an instant refusal", async () => {
    vi.mocked(fetchPrincipleStatus).mockResolvedValue(status(true));
    vi.mocked(retryPausedReading).mockReset().mockRejectedValue(new ApiError({ status: 502, message: "refused" }));
    render(createElement(Page));
    await settle();
    const button = () => container!.querySelector("button")!;
    vi.useFakeTimers();
    try {
      await act(async () => { button().click(); });
      expect(button().textContent).toBe("Retrying…");
      expect(button().disabled).toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      expect(button().disabled, "an instant refusal re-armed the button at once").toBe(true);
      await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    } finally { vi.useRealTimers(); }
    expect(button().disabled).toBe(false);
    expect(container!.textContent).toContain("Couldn’t restart it.");
    expect(retryPausedReading).toHaveBeenCalledTimes(1);
  });

  it("shows nothing when the reading is fine, or when the status itself cannot be read", async () => {
    vi.mocked(fetchPrincipleStatus).mockResolvedValue(status(false));
    render(createElement(Page));
    await settle();
    expect(container!.textContent).toBe("");
    act(() => root?.unmount()); container?.remove(); root = null; container = null;
    vi.mocked(fetchPrincipleStatus).mockRejectedValue(new Error("offline"));
    render(createElement(Page));
    await settle();
    expect(container!.textContent, "a failed check is not a paused reading").toBe("");
  });
});
