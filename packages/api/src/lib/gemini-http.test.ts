import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchModelWithTimeout,
  formatSafeGeminiError,
  ModelRequestTimeoutError,
  safeGeminiErrorDetails,
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

describe("safe provider errors", () => {
  const PRIVATE = "the user's private note about their sister";

  function providerError(body: unknown, status = 429, statusText = "Too Many Requests") {
    return new Response(JSON.stringify(body), {
      status,
      statusText,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  it("formats status, status text and provider code", () => {
    expect(
      formatSafeGeminiError("Gemini extraction failed", {
        status: 503,
        statusText: "Service Unavailable",
        providerCode: "UNAVAILABLE",
      }),
    ).toBe("Gemini extraction failed: HTTP 503 Service Unavailable providerCode=UNAVAILABLE");
    expect(formatSafeGeminiError("Gemini embedding failed", { status: 400, statusText: "Bad Request" }))
      .toBe("Gemini embedding failed: HTTP 400 Bad Request");
  });

  it("keeps only the provider's code, never its message", async () => {
    const details = await safeGeminiErrorDetails(
      providerError({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: `quota: ${PRIVATE}` } }),
    );
    expect(details).toEqual({ status: 429, statusText: "Too Many Requests", providerCode: "RESOURCE_EXHAUSTED" });
    const message = formatSafeGeminiError("Gemini judge failed", details);
    expect(message).not.toContain(PRIVATE);
    expect(message).not.toContain("quota");
  });

  it("falls back to a numeric code and refuses a code shaped like prose", async () => {
    expect(await safeGeminiErrorDetails(providerError({ error: { code: 500 } }, 500, "Internal Server Error")))
      .toEqual({ status: 500, statusText: "Internal Server Error", providerCode: "500" });
    const prose = await safeGeminiErrorDetails(providerError({ error: { status: PRIVATE } }));
    expect(prose.providerCode).toBeUndefined();
  });

  it("reads nothing from a non-JSON body and leaves the response readable", async () => {
    const response = new Response(PRIVATE, { status: 502, statusText: "Bad Gateway",
      headers: { "Content-Type": "text/html" } });
    const details = await safeGeminiErrorDetails(response);
    expect(details).toEqual({ status: 502, statusText: "Bad Gateway" });
    expect(formatSafeGeminiError("Gemini judge failed", details)).not.toContain(PRIVATE);
    expect(await response.text()).toBe(PRIVATE);
  });
});
