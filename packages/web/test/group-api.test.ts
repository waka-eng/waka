/**
 * WHAT THIS MOCKS, AND WHY: only `fetch`, the HTTP boundary. The real group
 * client must preserve privacy metadata before any component can use it.
 */
import { afterEach, expect, it, vi } from "vitest";
import { fetchGroupTopOfMind } from "../src/lib/api/groups";

afterEach(() => vi.unstubAllGlobals());

it("preserves the server restriction flag for current and historical reads", async () => {
  const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ topOfMind: null, entries: [], restricted: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  }));
  vi.stubGlobal("fetch", fetch);
  expect(await fetchGroupTopOfMind("group-1")).toMatchObject({ restricted: true });
  expect(await fetchGroupTopOfMind("group-1", 2)).toMatchObject({ restricted: true });
  expect(fetch.mock.calls.map((call) => call[0])).toEqual([
    "/api/groups/group-1/top-of-mind", "/api/groups/group-1/top-of-mind?version=2",
  ]);
});

it("forwards cancellation to the authenticated HTTP request", async () => {
  const controller = new AbortController();
  const fetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  }));
  vi.stubGlobal("fetch", fetch);
  const read = fetchGroupTopOfMind("group-1", undefined, controller.signal);
  controller.abort();
  await expect(read).rejects.toMatchObject({ status: 0 });
  expect(fetch).toHaveBeenCalledWith("/api/groups/group-1/top-of-mind", {
    method: "GET", credentials: "include", headers: { Accept: "application/json" }, signal: controller.signal,
  });
});
