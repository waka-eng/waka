// @vitest-environment jsdom

/**
 * BACK CLOSES THE LAYER, AND A STALLED READING SAYS SO.
 *
 * Two of the dead ends from the audit of 2026-10-17, each with its own seam:
 *
 *   `useBackCloses` — review, settings and info were page states with no
 *   history entry, so the phone's edge swipe (Back) left WAKA instead of
 *   putting the layer away. The cases run against jsdom's real `history`,
 *   because the whole mechanism is a pushed entry and a `popstate`; a fake
 *   history would assert the hook against a history that cannot pop.
 *
 *   `ReadingPausedNotice` + `useReadingPaused` — a reading that failed (out
 *   of credit is a 402) was silent on every page. These read
 *   `/principles/status` and restart through `/principles/refresh?retry=1`.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): `lib/api`'s `fetchPrincipleStatus` and
 * `retryPausedReading`, the layer directly beneath the hook, so a case can
 * say "the reading failed" and then "the retry worked" without a server. The
 * hook, the component, the locale catalog and React are real. Nothing is
 * mocked for `useBackCloses`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReadingPausedNotice } from "../src/components/ReadingPausedNotice";
import { fetchPrincipleStatus, retryPausedReading } from "../src/lib/api";
import { useBackCloses } from "../src/lib/back-closes";
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
const popped = () => act(async () => {
  window.history.back();
  await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
});

describe("Back closes an open layer", () => {
  function Layer({ open, onClose }: { open: boolean; onClose: () => void }) {
    useBackCloses(open, onClose, "test-layer");
    return null;
  }

  it("pushes one entry when it opens, and Back closes it without leaving the page", async () => {
    const start = window.history.length;
    const close = vi.fn();
    render(createElement(Layer, { open: true, onClose: close }));
    expect(window.history.length).toBe(start + 1);
    await popped();
    expect(close).toHaveBeenCalledTimes(1);
    expect(window.location.pathname, "Back left the page").toBe("/");
  });

  it("takes its entry back when closed some other way, so Back has no dead step", async () => {
    const close = vi.fn();
    render(createElement(Layer, { open: true, onClose: close }));
    expect((window.history.state as Record<string, unknown> | null)?.wakaLayer).toBe("test-layer");
    render(createElement(Layer, { open: false, onClose: close }));
    await act(async () => {
      await new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
    });
    expect((window.history.state as Record<string, unknown> | null)?.wakaLayer).toBeUndefined();
    expect(close, "closing by its own control is not a Back").not.toHaveBeenCalled();
  });
});

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
    await act(async () => { retry.click(); });
    await settle();
    expect(retryPausedReading).toHaveBeenCalledTimes(1);
    expect(container!.textContent).toBe("");
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
