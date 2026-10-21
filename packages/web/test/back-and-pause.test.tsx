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
    return createElement(ReadingPausedNotice, { state, locale: "en-US", canRetry: true });
  }
  const status = (readingPaused: boolean) => ({ phase: "ready" as const, eligible: true, signalCount: 3, topOfMindCount: 1, readingPaused });

  it("says the saves are safe and offers a Retry that restarts the reading", async () => {
    vi.mocked(fetchPrincipleStatus).mockResolvedValue(status(true));
    vi.mocked(retryPausedReading).mockResolvedValue(status(false));
    render(createElement(Page));
    await settle();
    expect(container!.textContent).toContain("Reading is paused — your saves are safe.");
    const retry = [...container!.querySelectorAll("button")].find((b) => b.textContent === "Retry")!;
    vi.mocked(fetchPrincipleStatus).mockResolvedValue(status(false));
    vi.useFakeTimers();
    try {
      await act(async () => { retry.click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
    } finally { vi.useRealTimers(); }
    expect(retryPausedReading).toHaveBeenCalledTimes(1);
    expect(container!.textContent, "the fresh GET after the retry did not decide").toBe("");
  });

  /* ONE RULE: the latest GET is the state, and a GET that started before a
     Retry is ignored when it lands. */
  it("ignores a GET that started before the Retry, and takes the fresh one after it", async () => {
    vi.mocked(fetchPrincipleStatus).mockReset().mockResolvedValue(status(true));
    vi.mocked(retryPausedReading).mockReset().mockResolvedValue(status(false));
    render(createElement(Page));
    await settle();
    let answerOld!: (value: ReturnType<typeof status>) => void;
    vi.mocked(fetchPrincipleStatus).mockImplementationOnce(() => new Promise((resolve) => { answerOld = resolve; }))
      .mockResolvedValue(status(false));
    vi.useFakeTimers();
    try {
      await act(async () => { window.dispatchEvent(new Event("focus")); });
      await act(async () => { container!.querySelector("button")!.click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
      expect(container!.textContent).toBe("");
      await act(async () => { answerOld(status(true)); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    } finally { vi.useRealTimers(); }
    expect(container!.textContent, "a GET from before the Retry put the notice back").toBe("");
  });

  /* A GET sent while the Retry POST is still out started after the press,
     so the press alone cannot mark it stale: the POST's answer bumps again. */
  it("ignores a GET sent while the Retry POST was out, even when it lands last", async () => {
    vi.mocked(fetchPrincipleStatus).mockReset().mockResolvedValue(status(true));
    vi.mocked(retryPausedReading).mockReset().mockResolvedValue(status(false));
    render(createElement(Page));
    await settle();
    let answerDuring!: (value: ReturnType<typeof status>) => void;
    vi.useFakeTimers();
    try {
      await act(async () => { container!.querySelector("button")!.click(); });
      vi.mocked(fetchPrincipleStatus).mockImplementationOnce(() => new Promise((resolve) => { answerDuring = resolve; }))
        .mockResolvedValue(status(false));
      await act(async () => { window.dispatchEvent(new Event("focus")); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
      expect(container!.textContent).toBe("");
      await act(async () => { answerDuring(status(true)); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    } finally { vi.useRealTimers(); }
    expect(container!.textContent, "a GET sent during the Retry put the notice back").toBe("");
  });

  /* Home and the principles overlay each mount the hook; a Retry in one
     invalidates a GET in flight in the other, and when the POST answers the
     other asks again, so it shows the state after the Retry. */
  it("a Retry in one notice invalidates the other's in-flight GET, and the other asks again", async () => {
    vi.mocked(fetchPrincipleStatus).mockReset().mockResolvedValue(status(true));
    vi.mocked(retryPausedReading).mockReset().mockResolvedValue(status(false));
    function Overlay() {
      const state = useReadingPaused(true);
      return createElement("section", { id: "overlay" }, createElement(ReadingPausedNotice, { state, locale: "en-US", canRetry: true }));
    }
    function Two() { return createElement("div", null, createElement("section", { id: "home" }, createElement(Page)), createElement(Overlay)); }
    render(createElement(Two));
    await settle();
    const overlay = () => container!.querySelector("#overlay")!.textContent;
    expect(overlay()).toContain("Reading is paused");
    let answerOverlay!: (value: ReturnType<typeof status>) => void;
    vi.useFakeTimers();
    try {
      /* Only the overlay's GET is in flight (Home's answers at once). */
      vi.mocked(fetchPrincipleStatus).mockResolvedValueOnce(status(true))
        .mockImplementationOnce(() => new Promise((resolve) => { answerOverlay = resolve; }));
      await act(async () => { window.dispatchEvent(new Event("focus")); });
      vi.mocked(fetchPrincipleStatus).mockResolvedValue(status(false));
      const gets = vi.mocked(fetchPrincipleStatus).mock.calls.length;
      await act(async () => { container!.querySelector("#home button")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3_100); });
      expect(vi.mocked(fetchPrincipleStatus).mock.calls.length, "both notices ask again when the POST answers").toBe(gets + 2);
      expect(overlay(), "the overlay did not ask again after the Retry").toBe("");
      await act(async () => { answerOverlay(status(true)); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    } finally { vi.useRealTimers(); }
    expect(overlay(), "the overlay's pre-Retry GET put it back").toBe("");
    expect(container!.textContent).toBe("");
  });

  it("re-checks every 30s while paused, and a failed check leaves the notice up", async () => {
    vi.mocked(fetchPrincipleStatus).mockReset().mockResolvedValue(status(true));
    vi.useFakeTimers();
    try {
      render(createElement(Page));
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(container!.textContent).toContain("Reading is paused");
      const gets = vi.mocked(fetchPrincipleStatus).mock.calls.length;
      vi.mocked(fetchPrincipleStatus).mockRejectedValue(new Error("offline"));
      await act(async () => { await vi.advanceTimersByTimeAsync(30_100); });
      expect(vi.mocked(fetchPrincipleStatus).mock.calls.length, "no re-check while paused").toBe(gets + 1);
      expect(container!.textContent, "a failed check took the notice down").toContain("Reading is paused");
      vi.mocked(fetchPrincipleStatus).mockResolvedValue(status(false));
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    } finally { vi.useRealTimers(); }
    expect(container!.textContent).toBe("");
  });

  it("shows the notice without Retry unless the caller says this is a person (canRetry defaults off)", async () => {
    vi.mocked(fetchPrincipleStatus).mockReset().mockResolvedValue(status(true));
    function AgentPage() {
      const state = useReadingPaused(true);
      return createElement(ReadingPausedNotice, { state, locale: "en-US" });
    }
    render(createElement(AgentPage));
    await settle();
    expect(container!.textContent).toContain("Reading is paused — your saves are safe.");
    expect(container!.querySelector("button"), "an agent session was offered Retry").toBeNull();
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
  it("never aborts a slow Retry: Still trying… after 20s, then the real answer", async () => {
    vi.mocked(fetchPrincipleStatus).mockReset().mockResolvedValue(status(true));
    let answer!: (value: ReturnType<typeof status>) => void;
    vi.mocked(retryPausedReading).mockReset().mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    render(createElement(Page));
    await settle();
    const button = () => container!.querySelector("button");
    vi.useFakeTimers();
    try {
      await act(async () => { button()!.click(); });
      await act(async () => { await vi.advanceTimersByTimeAsync(20_100); });
      expect(button()?.textContent).toBe("Still trying…");
      expect(button()?.disabled).toBe(true);
      expect(vi.mocked(retryPausedReading).mock.calls[0], "the retry was given an abort signal").toEqual([]);
      vi.mocked(fetchPrincipleStatus).mockResolvedValue(status(false));
      await act(async () => { answer(status(false)); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    } finally { vi.useRealTimers(); }
    expect(container!.textContent, "the late answer was not shown").toBe("");
  });

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
