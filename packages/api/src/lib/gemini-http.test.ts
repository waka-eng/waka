import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchModelWithTimeout,
  ModelRequestTimeoutError,
} from "./gemini-http.js";

afterEach(() => vi.useRealTimers());

describe("fetchModelWithTimeout", () => {
  it("returns control even when a fetch implementation ignores abort", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | undefined;
    const fetchFn = vi.fn((_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      receivedSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;

    const request = fetchModelWithTimeout(fetchFn, "https://example.invalid", {}, 25);
    const rejection = expect(request).rejects.toBeInstanceOf(ModelRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(25);

    await rejection;
    expect(receivedSignal?.aborted).toBe(true);
  });

  /**
   * The 2026-08-31 hang: with streaming off, generation time is BODY time —
   * a 200 whose body never finishes used to escape the deadline entirely
   * (the timer was cleared the moment headers arrived) and pin a worker
   * until something external killed it. The exchange deadline covers it.
   */
  it("bounds the body read, not just the headers", async () => {
    vi.useFakeTimers();
    const stalledResponse = {
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      arrayBuffer: () => new Promise<ArrayBuffer>(() => undefined),
    } as unknown as Response;
    const fetchFn = vi.fn(async () => stalledResponse) as typeof fetch;

    const request = fetchModelWithTimeout(fetchFn, "https://example.invalid", {}, 25, 50);
    const rejection = expect(request).rejects.toBeInstanceOf(ModelRequestTimeoutError);
    await vi.advanceTimersByTimeAsync(50);

    await rejection;
  });

  it("hands back status, headers, and a readable body after buffering", async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as typeof fetch;

    const response = await fetchModelWithTimeout(fetchFn, "https://example.invalid");
    expect(response.ok).toBe(true);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.json()).toEqual({ ok: 1 });
  });
});
