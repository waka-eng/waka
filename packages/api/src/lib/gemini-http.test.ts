import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchModelWithTimeout,
  formatSafeGeminiError,
  isTransientModelError,
  modelErrorHttpStatus,
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

describe("isTransientModelError", () => {
  /**
   * The two failures the old regex got backwards. Both are what provider
   * overload actually looks like from inside this process, and neither
   * contains a matchable status code — so the retry that exists for exactly
   * this condition never fired, the pass logged a warning, and the job
   * reported success while the room lost a reading.
   */
  it("retries a request that timed out", () => {
    expect(isTransientModelError(new ModelRequestTimeoutError(25_000))).toBe(true);
  });

  it("does not depend on the digits inside the timeout message", () => {
    // "Model request timed out after 25000ms" — the old regex looked for a
    // word-bounded 500 and found none, so this returned false.
    const err = new ModelRequestTimeoutError(25_000);
    expect(/\b(503|429|500|502|504)\b/.test(err.message)).toBe(false);
    expect(isTransientModelError(err)).toBe(true);
  });

  it("retries a dead socket, which carries no status at all", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = { code: "ECONNRESET" };
    expect(isTransientModelError(err)).toBe(true);
  });

  it("retries a connect timeout reported only on the cause chain", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = { code: "UND_ERR_CONNECT_TIMEOUT" };
    expect(isTransientModelError(err)).toBe(true);
  });

  it("retries the provider statuses that mean try again", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) {
      const message = formatSafeGeminiError("Gemini judge failed", {
        status,
        statusText: "Service Unavailable",
        providerCode: "RESOURCE_EXHAUSTED",
      });
      expect(isTransientModelError(new Error(message))).toBe(true);
    }
  });

  it("does not retry a request the provider refused on its merits", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      const message = formatSafeGeminiError("Gemini judge failed", {
        status,
        statusText: "Bad Request",
      });
      expect(isTransientModelError(new Error(message))).toBe(false);
    }
  });

  it("does not retry a deliberate abort", () => {
    const err = new Error("The operation was aborted");
    err.name = "AbortError";
    expect(isTransientModelError(err)).toBe(false);
  });

  it("does not treat a status-shaped number elsewhere in a message as a status", () => {
    // The old regex retried on any word-bounded 500 anywhere in the string.
    expect(isTransientModelError(new Error("judge returned 503 candidates"))).toBe(false);
    expect(isTransientModelError(new Error("embedding dimension 500 mismatch"))).toBe(false);
  });

  it("does not retry an error it cannot classify", () => {
    expect(isTransientModelError(new Error("invalid judge json"))).toBe(false);
    expect(isTransientModelError("something went wrong")).toBe(false);
    expect(isTransientModelError(null)).toBe(false);
  });
});

describe("modelErrorHttpStatus", () => {
  it("reads the status out of our own error format", () => {
    const message = formatSafeGeminiError("Gemini embedding failed", {
      status: 429,
      statusText: "Too Many Requests",
    });
    expect(modelErrorHttpStatus(new Error(message))).toBe(429);
  });

  it("returns null when the message carries no status", () => {
    expect(modelErrorHttpStatus(new Error("fetch failed"))).toBeNull();
  });
});
