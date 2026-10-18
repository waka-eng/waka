// @vitest-environment jsdom

/**
 * A READ THAT NEVER ANSWERS ENDS, AND A SCREEN THAT CANNOT LOAD SAYS WHY.
 *
 * Two dead ends from the audit of 2026-10-17 that have nothing to do with
 * sessions (sign-in, sign-out and expiry behave exactly as on `origin/dev`):
 *
 *   THE WEB READ DEADLINE. Web reads were a bare `fetch`, so a server that
 *   accepted the connection and then said nothing kept every waiting screen
 *   waiting. `apiFetch` now gives web reads 20s to start answering and a
 *   longer ceiling for a body already arriving.
 *
 *   THE LOADING SCREEN'S FAILURE FACE. A failed load said "Loading" forever.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): the global `fetch`, the network seam
 * beneath `lib/api/transport` (as in `api.test.ts`) — the transport is the
 * subject. `LoadingHome` is rendered with plain props; nothing is mocked for
 * it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LoadingHome } from "../src/components/LoadingHome";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const text = () => container?.textContent ?? "";
const press = async (label: string) => {
  const button = [...(container?.querySelectorAll("button") ?? [])].find((b) => b.textContent === label);
  expect(button, `no "${label}" button on screen: ${text()}`).toBeTruthy();
  await act(async () => { button!.click(); });
};
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null; container = null;
  vi.unstubAllGlobals();
});

describe("the loading screen's failure face", () => {
  it("replaces LOADING with what went wrong and every way out it was given", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const retry = vi.fn(), out = vi.fn();
    await act(async () => {
      root!.render(createElement(LoadingHome, { problem: {
        message: "Your home didn’t load.", detail: "The server could not be reached.",
        actions: [{ label: "Try again", onClick: retry }, { label: "Sign out", onClick: out }],
      } }));
    });
    expect(text()).not.toContain("Loading");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Your home didn’t load.");
    await press("Try again");
    await press("Sign out");
    expect(retry).toHaveBeenCalledTimes(1);
    expect(out).toHaveBeenCalledTimes(1);
  });
});

describe("the web read deadline", () => {
  /* A body that starts and never finishes. The mock honours the request's
     signal the way a real fetch does: aborting it errors the stream. */
  function stalledBody(init?: RequestInit): Response {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"rows":'));
      init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
    } });
    return new Response(stream, { status: 200, headers: { "Content-Type": "application/json" } });
  }

  it("ends a body that never finishes as a failed read, after the long body ceiling", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => stalledBody(init)));
      const { apiFetch } = await import("../src/lib/api/transport");
      const reading = apiFetch("/api/inspirations");
      const settled = expect(reading, "a stalled body never ended").rejects.toBeDefined();
      await vi.advanceTimersByTimeAsync(120_000);
      await settled;
    } finally { vi.useRealTimers(); }
  });

  it("lets a slow body that is still arriving finish past 20s, instead of calling it unreachable", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode('{"ok":'));
          setTimeout(() => controller.enqueue(encoder.encode('true')), 30_000);
          setTimeout(() => { controller.enqueue(encoder.encode('}')); controller.close(); }, 60_000);
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")));
        } });
        return new Response(stream, { status: 200, headers: { "Content-Type": "application/json" } });
      }));
      const { apiFetch } = await import("../src/lib/api/transport");
      const reading = apiFetch("/api/inspirations");
      await vi.advanceTimersByTimeAsync(60_000);
      const response = await reading;
      expect(await response.json(), "a slow, progressing body was cut off at the first-byte deadline").toEqual({ ok: true });
    } finally { vi.useRealTimers(); }
  });

  it("releases its timer and the caller's abort listener once the body is in", async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
      const { apiFetch } = await import("../src/lib/api/transport");
      const controller = new AbortController();
      const added = vi.spyOn(controller.signal, "addEventListener");
      const removed = vi.spyOn(controller.signal, "removeEventListener");
      const response = await apiFetch("/api/inspirations", { signal: controller.signal });
      expect(await response.json()).toEqual({ ok: true });
      expect(vi.getTimerCount(), "the 20s deadline outlived its request").toBe(0);
      expect(removed.mock.calls.map((call) => call[1])).toEqual(added.mock.calls.map((call) => call[1]));
    } finally { vi.useRealTimers(); }
  });

  it("passes a 401 through untouched: session handling is not the transport's", async () => {
    const heard = vi.fn();
    window.addEventListener("waka:session-expired", heard);
    try {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 401 })));
      const { apiFetch } = await import("../src/lib/api/transport");
      expect((await apiFetch("/api/inspirations")).status).toBe(401);
      expect(heard).not.toHaveBeenCalled();
    } finally { window.removeEventListener("waka:session-expired", heard); }
  });
});
