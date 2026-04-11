import assert from "node:assert/strict";
import test from "node:test";

import { GeminiProvider } from "../packages/shared/llm/gemini-provider.ts";
import { OpenAIProvider } from "../packages/shared/llm/openai-provider.ts";
import { isLLMProviderError } from "../packages/shared/llm/provider.ts";
import { calculateLLMProviderRetryDelayMs } from "../packages/shared/llm/transport-retry.ts";

test("OpenAIProvider retries retryable API failures three times with exponential backoff", async () => {
  let attempts = 0;
  const delays: number[] = [];

  const provider = new OpenAIProvider({
    apiKey: "sk-test",
    sleep: async (ms) => {
      delays.push(ms);
    },
    fetch: async () => {
      attempts += 1;

      return jsonResponse(
        {
          error: {
            code: "rate_limit_exceeded",
            message: "OpenAI is temporarily rate limited.",
            type: "rate_limit_error",
          },
        },
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "x-request-id": "openai_req_retry_failure",
          },
        },
      );
    },
  });

  await assert.rejects(
    provider.summarize({
      operation: "summarize",
      requestId: "req_openai_retry_failure",
      traceId: "trace_openai_retry_failure",
      input: {
        content: "Retry transient OpenAI failures.",
      },
    }),
    (error: unknown) => {
      assert.equal(isLLMProviderError(error), true);

      if (!isLLMProviderError(error)) {
        return false;
      }

      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.retryable, true);
      assert.equal(error.requestId, "openai_req_retry_failure");
      assert.equal(error.traceId, "trace_openai_retry_failure");

      return true;
    },
  );

  assert.equal(attempts, 4);
  assert.deepEqual(delays, [
    calculateLLMProviderRetryDelayMs(0),
    calculateLLMProviderRetryDelayMs(1),
    calculateLLMProviderRetryDelayMs(2),
  ]);
});

test("GeminiProvider retries retryable API failures three times with exponential backoff", async () => {
  let attempts = 0;
  const delays: number[] = [];

  const provider = new GeminiProvider({
    apiKey: "gemini-test-key",
    sleep: async (ms) => {
      delays.push(ms);
    },
    fetch: async () => {
      attempts += 1;

      return jsonResponse(
        {
          error: {
            code: 503,
            message: "Gemini is temporarily unavailable.",
            status: "UNAVAILABLE",
          },
        },
        {
          status: 503,
          headers: {
            "content-type": "application/json",
            "x-goog-request-id": "gemini_req_retry_failure",
          },
        },
      );
    },
  });

  await assert.rejects(
    provider.summarize({
      operation: "summarize",
      requestId: "req_gemini_retry_failure",
      traceId: "trace_gemini_retry_failure",
      input: {
        content: "Retry transient Gemini failures.",
      },
    }),
    (error: unknown) => {
      assert.equal(isLLMProviderError(error), true);

      if (!isLLMProviderError(error)) {
        return false;
      }

      assert.equal(error.code, "UNAVAILABLE");
      assert.equal(error.retryable, true);
      assert.equal(error.requestId, "gemini_req_retry_failure");
      assert.equal(error.traceId, "trace_gemini_retry_failure");

      return true;
    },
  );

  assert.equal(attempts, 4);
  assert.deepEqual(delays, [
    calculateLLMProviderRetryDelayMs(0),
    calculateLLMProviderRetryDelayMs(1),
    calculateLLMProviderRetryDelayMs(2),
  ]);
});

function jsonResponse(
  body: Record<string, unknown>,
  init: ResponseInit = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
}
