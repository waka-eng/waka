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
});
