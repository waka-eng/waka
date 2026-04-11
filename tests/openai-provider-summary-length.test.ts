import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENAI_API_BASE_URL,
  OpenAIProvider,
} from "../packages/shared/llm/openai-provider.ts";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-request-id": "openai_req_summary_length",
    },
    ...init,
  });
}

test("OpenAIProvider enforces the default 280-character summary cap", async () => {
  const overlongSummary = `  ${"Capture instantly, then enrich asynchronously so nothing gets lost. ".repeat(6)}\nQueue retries should preserve every draft until the API accepts it.  `;
  const normalizedSummary = overlongSummary.replace(/\s+/g, " ").trim();
  const expectedSummary = normalizedSummary.slice(0, 280).trimEnd();

  const provider = new OpenAIProvider({
    apiKey: "sk-test",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.url;

      if (url !== `${OPENAI_API_BASE_URL}/chat/completions`) {
        throw new Error(`Unexpected fetch to ${url}`);
      }

      const body = JSON.parse(String(init?.body)) as {
        model: string;
      };

      return jsonResponse({
        model: body.model,
        choices: [
          {
            message: {
              content: overlongSummary,
            },
          },
        ],
      });
    },
  });

  const summary = await provider.summarize({
    operation: "summarize",
    requestId: "req_summary_default_limit",
    input: {
      content:
        "Summaries must remain concise even if the model ignores the instruction.",
    },
  });

  assert.equal(summary.output.summary, expectedSummary);
  assert.equal(summary.output.summary.length <= 280, true);
  assert.equal(summary.output.summary.length < normalizedSummary.length, true);
  assert.equal(summary.output.summary.endsWith(" "), false);
});
