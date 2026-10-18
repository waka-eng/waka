/**
 * ═══ A NOTE'S WRITE THAT NEVER ANSWERS STILL ENDS ════════════════════════
 *
 * Review, 2026-10-17. Every read and editor of a note waits for its writes
 * to settle (`lib/note-writes.ts`), so a hung PATCH would hold them all. The
 * request is aborted after `UPDATE_TIMEOUT_MS` and fails like any failed
 * save (the words stay, Save stays lit, pressing again retries).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6). `fetch` — a piece of browser: one that
 * never answers unless aborted, which is the network condition under test.
 * The real `updateInspiration` and HTTP layer run.
 */
import { afterEach, expect, it, vi } from "vitest";

import { UPDATE_TIMEOUT_MS, updateInspiration } from "../src/lib/api/inspirations";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("aborts a write that is never answered, so it settles as a failure", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_done, fail) => {
    init.signal?.addEventListener("abort", () => fail(new DOMException("aborted", "AbortError")));
  }));
  const write = updateInspiration("00000000-0000-4000-8000-000000000001", { text: "words" });
  const settled = write.then(() => "landed", () => "failed");
  await vi.advanceTimersByTimeAsync(UPDATE_TIMEOUT_MS - 1);
  let early = "pending";
  void settled.then((value) => { early = value; });
  await Promise.resolve();
  expect(early, "still waiting just before the limit").toBe("pending");
  await vi.advanceTimersByTimeAsync(2);
  expect(await settled).toBe("failed");
});
