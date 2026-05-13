/**
 * Gemini transport mock for vitest specs.
 *
 * Why this exists
 * ---------------
 * `src/queue/gemini.ts` reaches Gemini through a single `globalThis.fetch`
 * call against `generativelanguage.googleapis.com`. The Seed contract bans
 * live calls during `pnpm test` for three independent reasons:
 *
 *   1. Determinism — model output drifts across versions and across days.
 *      A test that asserts "this row got cluster=loop" must not flake when
 *      Gemini decides today is a `tension` day.
 *   2. Cost / rate-limit — CI re-runs would burn the developer's API key
 *      against a hard 15 RPM free-tier ceiling, leading to noisy 429s that
 *      look like product bugs but aren't.
 *   3. Offline + air-gapped CI — the suite must run on a laptop in airplane
 *      mode and on locked-down CI runners with no egress.
 *
 * Design
 * ------
 * The standalone `src/queue/classifier.smoke.ts` script proved out a
 * `globalThis.fetch` swap that scopes the override to Gemini's hostname and
 * delegates everything else (Neon's HTTPS, the SQS SDK, etc.) to the real
 * transport. We lift that pattern into a reusable harness with three
 * additions the smoke script didn't need:
 *
 *   - A *queue* of scripted responses so a single test can drive multiple
 *     Gemini calls with different outcomes (e.g. retry tests).
 *   - A *call log* the test reads back to assert on prompt content, headers,
 *     and call count without brittle `expect.fetch.toHaveBeenCalled()`-style
 *     globals (vitest globals are off — see vitest.config.ts).
 *   - A *fail-fast* default that throws if a test invokes Gemini without
 *     first scripting a response. Silent test passes from forgotten setup
 *     are how mock-based suites rot; making this loud catches drift.
 *
 * Public surface
 * --------------
 *   const gemini = installGeminiMock();
 *
 *   // configure one call
 *   gemini.queueResponse({ kind: "label", label: "outlier" });
 *
 *   // run system under test
 *   await classifier.handler(...);
 *
 *   // assert
 *   expect(gemini.calls.length).toBe(1);
 *   expect(gemini.calls[0].body).toContain("the inspiration text");
 *
 *   // teardown (typically in afterAll)
 *   gemini.restore();
 *
 * Lifecycle
 * ---------
 * Install in `beforeAll`, restore in `afterAll`, and call `reset()` in
 * `beforeEach` to clear the response queue + call log between cases. The
 * harness is idempotent — install/restore are safe to call repeatedly.
 *
 * Non-goals
 * ---------
 *   - We do NOT model the full Gemini wire shape beyond what
 *     `parseClusterFromResponse` reads. Adding fields here without a real
 *     classifier need would let tests drift away from production behaviour.
 *   - We do NOT mock `classifyInspirationText` directly. Mocking the
 *     transport (fetch) keeps the gemini.ts module under test rather than
 *     replaced — including the prompt builder, the URL builder, and the
 *     response parser, which are the bits most likely to silently break.
 */

import type { Cluster } from "../../src/db/index.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A scripted response for the next (or Nth) Gemini call.
 *
 * Each variant maps to a real Gemini scenario `gemini.ts` already handles,
 * so a test can exercise *any* code path the production worker can hit
 * without crafting raw HTTP responses by hand.
 *
 *   - `label`        : 200 OK, `responseSchema`-constrained string. The
 *                      happy path. The label is JSON-encoded into the
 *                      `parts[].text` field exactly the way Google emits it
 *                      under `responseSchema: { type: "STRING", enum: [...] }`.
 *   - `outOfSet`     : 200 OK, but the model emitted a value not in
 *                      `clusterEnumValues`. Drives the "validator rejects
 *                      out-of-set → cluster=null permanent skip" path.
 *   - `block`        : 200 OK, `promptFeedback.blockReason` set, no
 *                      `candidates`. Drives the "Gemini refused this prompt
 *                      → cluster=null permanent skip" path.
 *   - `emptyText`    : 200 OK with `candidates[0].content.parts[0].text`
 *                      empty / missing — exercises `parseClusterFromResponse`'s
 *                      degenerate-shape guards.
 *   - `malformed`    : 200 OK with a body the envelope schema rejects.
 *                      Tests that schema-drift is treated as permanent skip,
 *                      not retried.
 *   - `http`         : Non-2xx response. Drives the "transport-level error
 *                      → throw → SQS retry via batchItemFailures" path.
 *                      Both 4xx and 5xx are valid here.
 *   - `nonJson`      : 200 OK with a body that fails `Response.json()`.
 *                      Drives the "Google changed the API contract" loud-fail
 *                      branch in `classifyInspirationText`.
 *   - `networkError` : `fetch` itself rejects (DNS / TLS / abort).
 *                      Drives the same retry path as `http`.
 *   - `custom`       : Escape hatch. The test supplies a fully-formed
 *                      `Response` (or a thunk that returns one). Use only
 *                      when none of the other variants fit.
 */
export type GeminiMockResponse =
  | { kind: "label"; label: Cluster; finishReason?: string }
  | { kind: "outOfSet"; text: string; finishReason?: string }
  | { kind: "block"; blockReason: string }
  | { kind: "emptyText" }
  | { kind: "malformed"; body: unknown }
  | { kind: "http"; status: number; body?: string }
  | { kind: "nonJson"; body: string }
  | { kind: "networkError"; message?: string }
  | {
      kind: "custom";
      respond: () => Response | Promise<Response>;
    };

/**
 * Recorded Gemini call. Captured eagerly from each `fetch(...)` invocation so
 * tests can assert on prompt content, headers, or call ordering after the
 * system-under-test has run.
 *
 * `body` is the raw request body string. We deliberately do NOT pre-parse it
 * to JSON — a test that wants the parsed shape can call `JSON.parse(call.body)`
 * itself, while string assertions ("the inspiration text appears verbatim")
 * stay one-liners.
 */
export interface GeminiMockCall {
  /** Fully resolved request URL. Gemini credentials must not appear here. */
  url: string;
  /** HTTP method as observed on the wire (always "POST" in production today). */
  method: string;
  /** Stringified request body, or `null` if `fetch` was called without one. */
  body: string | null;
  /** Header bag flattened from the request init. Lowercase keys. */
  headers: Record<string, string>;
  /** Wall-clock timestamp (epoch ms) when the call was observed. */
  timestamp: number;
}

/**
 * Handle returned by `installGeminiMock`. Owns the scripted-response queue,
 * the call log, and the lifecycle hooks for swapping `globalThis.fetch`.
 */
export interface GeminiMockHandle {
  /**
   * Queue the next response for the next Gemini call. Calls are dequeued
   * FIFO. If the queue is empty when the handler invokes Gemini, the mock
   * throws — see `defaultMode` below to override that fail-fast behaviour
   * for specific tests (e.g. "verify nothing calls Gemini" assertions).
   */
  queueResponse(response: GeminiMockResponse): void;
  /**
   * Set the fallback behaviour when the queue is empty. `"throw"` (default)
   * loud-fails so a test that forgets to script its calls is obvious in the
   * runner output. `"unexpected"` records the call but throws inside the
   * mocked fetch; useful when you want the call captured for assertions
   * before failing. `"passthrough"` lets the request hit the *real* network —
   * never use this in CI; it exists for local triage only.
   */
  setDefaultMode(mode: "throw" | "unexpected" | "passthrough"): void;
  /**
   * Reset the response queue + call log. Doesn't restore the global. Pair
   * with `beforeEach` so each test starts from a clean slate without
   * paying the install/restore cost between cases.
   */
  reset(): void;
  /** Live array of recorded Gemini calls, in invocation order. */
  readonly calls: ReadonlyArray<GeminiMockCall>;
  /** Number of queued responses still waiting to be consumed. */
  readonly pending: number;
  /**
   * Convenience: assert the call count and return the last call. Throws
   * with a descriptive message if the count is wrong, so a test can write
   *
   *   const call = gemini.expectCalls(1);
   *   expect(call.body).toContain(text);
   *
   * without juggling its own `if (calls.length !== 1) throw ...` guard.
   */
  expectCalls(expected: number): GeminiMockCall;
  /** Restore the real `globalThis.fetch`. Idempotent. */
  restore(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Hostname `gemini.ts` hits. Matched as a substring against the request URL
 * so query params + path don't matter. Hard-coded here (rather than imported
 * from gemini.ts) on purpose — if the production code starts hitting a
 * different host, the test mock should fail to match and the suite should
 * scream, rather than silently following the production change.
 */
const GEMINI_HOST_NEEDLE = "generativelanguage.googleapis.com";

/**
 * Build a Gemini-shaped 200 response for a `label` script.
 *
 * Mirrors the on-the-wire shape `parseClusterFromResponse` reads:
 *
 *   { candidates: [
 *       { content: { parts: [{ text: '"<label>"' }] },
 *         finishReason: "STOP" } ] }
 *
 * The `JSON.stringify(label)` is what produces the canonical `"<label>"`
 * form (i.e. the model's enum-constrained output, double-quoted).
 */
function buildLabelResponseBody(
  label: Cluster,
  finishReason = "STOP",
): unknown {
  return {
    candidates: [
      {
        content: { parts: [{ text: JSON.stringify(label) }] },
        finishReason,
      },
    ],
  };
}

function buildOutOfSetBody(text: string, finishReason = "STOP"): unknown {
  return {
    candidates: [
      {
        content: { parts: [{ text: JSON.stringify(text) }] },
        finishReason,
      },
    ],
  };
}

function buildBlockBody(blockReason: string): unknown {
  return { promptFeedback: { blockReason } };
}

function buildEmptyTextBody(): unknown {
  return { candidates: [{ content: { parts: [{ text: "" }] } }] };
}

/**
 * Translate a `GeminiMockResponse` into a real `Response` (or throw, for the
 * `networkError` variant). Shaped as a separate function so tests can read
 * the table-driven mapping at a glance.
 */
async function buildResponse(spec: GeminiMockResponse): Promise<Response> {
  switch (spec.kind) {
    case "label":
      return new Response(
        JSON.stringify(buildLabelResponseBody(spec.label, spec.finishReason)),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    case "outOfSet":
      return new Response(
        JSON.stringify(buildOutOfSetBody(spec.text, spec.finishReason)),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    case "block":
      return new Response(JSON.stringify(buildBlockBody(spec.blockReason)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    case "emptyText":
      return new Response(JSON.stringify(buildEmptyTextBody()), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    case "malformed":
      return new Response(JSON.stringify(spec.body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    case "http":
      return new Response(spec.body ?? `HTTP ${spec.status}`, {
        status: spec.status,
        headers: { "content-type": "text/plain" },
      });
    case "nonJson":
      // Body is not valid JSON. `Response.json()` will throw, which is exactly
      // the contract `classifyInspirationText` re-throws as a loud failure.
      return new Response(spec.body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    case "networkError":
      throw new Error(spec.message ?? "Simulated network error");
    case "custom":
      return await spec.respond();
  }
}

/**
 * Flatten the `headers` field of a `RequestInit` into a plain
 * `Record<string, string>` with lowercase keys. Used for call-log capture so
 * tests can assert on "Content-Type" without caring whether the SDK passed a
 * `Headers` object, an array of tuples, or a plain object.
 *
 * We intentionally type the input as `unknown` rather than `HeadersInit` —
 * the tsconfig disables DOM lib types, so `HeadersInit` isn't in scope. The
 * runtime branches below cover the three shapes the standard accepts.
 */
function flattenHeaders(init: unknown): Record<string, string> {
  if (!init) return {};
  const out: Record<string, string> = {};
  // Headers is a global in Node 18+; check structurally so we don't rely on
  // the DOM lib type being declared.
  if (
    typeof Headers !== "undefined" &&
    init instanceof (Headers as new () => { forEach: (cb: (v: string, k: string) => void) => void })
  ) {
    (init as { forEach: (cb: (v: string, k: string) => void) => void }).forEach(
      (v, k) => {
        out[k.toLowerCase()] = v;
      },
    );
    return out;
  }
  if (Array.isArray(init)) {
    for (const [k, v] of init as [string, string][]) {
      out[k.toLowerCase()] = v;
    }
    return out;
  }
  if (typeof init === "object") {
    for (const [k, v] of Object.entries(init as Record<string, unknown>)) {
      out[k.toLowerCase()] = String(v);
    }
  }
  return out;
}

/**
 * Reduce a fetch `body` (any shape `RequestInit["body"]` accepts) to a
 * string for capture. We don't try to handle `ReadableStream` / `Blob` —
 * the production code stringifies its JSON body via `JSON.stringify` before
 * calling fetch, so we'll always see a string in practice. The fallback
 * exists so a future code path that passes something exotic doesn't crash
 * the mock; it just records `<non-string body>`.
 */
function bodyToString(body: unknown): string | null {
  if (body == null) return null;
  if (typeof body === "string") return body;
  return "<non-string body>";
}

function hasApiKeyQueryParam(url: string): boolean {
  try {
    return new URL(url).searchParams.has("key");
  } catch {
    return /[?&]key=/.test(url);
  }
}

/**
 * Install the Gemini fetch interceptor and return a handle for scripting +
 * assertions. Safe to call once per test file — re-installing in a process
 * that already has the mock active simply replaces the prior handle (and
 * the prior queue + call log are dropped, which is what you'd want).
 */
export function installGeminiMock(): GeminiMockHandle {
  const realFetch = globalThis.fetch;

  const responseQueue: GeminiMockResponse[] = [];
  const callLog: GeminiMockCall[] = [];
  let defaultMode: "throw" | "unexpected" | "passthrough" = "throw";
  let restored = false;

  const mockFetch: typeof realFetch = (async (input, init) => {
    // Resolve the request URL from any of the three accepted argument shapes.
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;

    // Non-Gemini calls (e.g. anything else a future test might trigger)
    // fall through to the real implementation. This keeps the mock narrowly
    // scoped — installing it never breaks unrelated network code.
    if (!url.includes(GEMINI_HOST_NEEDLE)) {
      return realFetch(input, init);
    }

    // Capture the call BEFORE we decide how to respond. Even a "fail-fast on
    // empty queue" outcome benefits from the call landing in the log so the
    // test can show the user what the SUT actually requested.
    const captured: GeminiMockCall = {
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      body: bodyToString(init?.body ?? null),
      headers: flattenHeaders(init?.headers),
      timestamp: Date.now(),
    };
    callLog.push(captured);

    if (hasApiKeyQueryParam(url)) {
      throw new Error(
        "[gemini-mock] Gemini API key must be sent via x-goog-api-key header, not URL query.",
      );
    }

    const next = responseQueue.shift();
    if (!next) {
      switch (defaultMode) {
        case "throw":
          throw new Error(
            `[gemini-mock] No scripted response queued for Gemini call to ${url}. ` +
              `Use gemini.queueResponse(...) before invoking the system-under-test, ` +
              `or call gemini.setDefaultMode("passthrough" | "unexpected") to override.`,
          );
        case "unexpected":
          // Same as throw, but the call has already been captured above so
          // a test can read `gemini.calls` from the catch handler.
          throw new Error(
            `[gemini-mock] Unexpected Gemini call to ${url} (default mode = "unexpected").`,
          );
        case "passthrough":
          return realFetch(input, init);
      }
    }

    return buildResponse(next);
  }) as typeof realFetch;

  globalThis.fetch = mockFetch;

  const handle: GeminiMockHandle = {
    queueResponse(response) {
      responseQueue.push(response);
    },
    setDefaultMode(mode) {
      defaultMode = mode;
    },
    reset() {
      responseQueue.length = 0;
      callLog.length = 0;
      defaultMode = "throw";
    },
    get calls() {
      return callLog;
    },
    get pending() {
      return responseQueue.length;
    },
    expectCalls(expected) {
      if (callLog.length !== expected) {
        throw new Error(
          `[gemini-mock] Expected ${expected} Gemini call(s), saw ${callLog.length}.\n` +
            (callLog.length > 0
              ? "Last call: " +
                JSON.stringify(callLog[callLog.length - 1], null, 2)
              : "(no calls recorded)"),
        );
      }
      // We just verified `expected === callLog.length` and `expected >= 1`
      // is the only meaningful caller intent — but for `expected === 0`
      // there is no last call to return, so we throw to keep the type
      // narrow as `GeminiMockCall` rather than `GeminiMockCall | undefined`.
      const last = callLog[callLog.length - 1];
      if (!last) {
        throw new Error(
          `[gemini-mock] expectCalls(${expected}) — no call to return. ` +
            `Use \`gemini.calls\` directly when expected === 0.`,
        );
      }
      return last;
    },
    restore() {
      if (restored) return;
      restored = true;
      globalThis.fetch = realFetch;
    },
  };

  return handle;
}

// ---------------------------------------------------------------------------
// Convenience: pre-built scripts
// ---------------------------------------------------------------------------

/**
 * Shorthand factories for the common scripts. They exist so a test reads
 * naturally:
 *
 *   gemini.queueResponse(geminiLabel("loop"));
 *   gemini.queueResponse(geminiBlock("SAFETY"));
 *   gemini.queueResponse(geminiHttpError(503));
 *
 * vs. the verbose discriminated-union form. Pure sugar; no behaviour change.
 */
export const geminiLabel = (
  label: Cluster,
  finishReason = "STOP",
): GeminiMockResponse => ({ kind: "label", label, finishReason });

export const geminiOutOfSet = (text: string): GeminiMockResponse => ({
  kind: "outOfSet",
  text,
});

export const geminiBlock = (blockReason = "SAFETY"): GeminiMockResponse => ({
  kind: "block",
  blockReason,
});

export const geminiEmptyText = (): GeminiMockResponse => ({
  kind: "emptyText",
});

export const geminiMalformed = (body: unknown): GeminiMockResponse => ({
  kind: "malformed",
  body,
});

export const geminiHttpError = (
  status: number,
  body?: string,
): GeminiMockResponse => ({ kind: "http", status, body });

export const geminiNonJson = (
  body = "<<not json>>",
): GeminiMockResponse => ({ kind: "nonJson", body });

export const geminiNetworkError = (
  message = "Simulated network error",
): GeminiMockResponse => ({ kind: "networkError", message });
