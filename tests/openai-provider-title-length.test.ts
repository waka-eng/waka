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
      "x-request-id": "openai_req_title_length",
    },
    ...init,
  });
}

test("OpenAIProvider enforces the default 80-character title cap", async () => {
  const overlongTitle = `  ${"Instant capture for every fleeting idea across web, voice, links, photos, and CLI sync. ".repeat(2)}  `;
  const normalizedTitle = overlongTitle.replace(/\s+/g, " ").trim();
  const expectedTitle = normalizedTitle.slice(0, 80).trimEnd();

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
              content: overlongTitle,
            },
          },
        ],
      });
    },
  });

  const title = await provider.generateTitle({
    operation: "generateTitle",
    requestId: "req_title_default_limit",
    input: {
      content:
        "Generate a short title even if the model returns more words than requested.",
    },
  });

  assert.equal(title.output.title, expectedTitle);
  assert.equal(title.output.title.length <= 80, true);
  assert.equal(title.output.title.length < normalizedTitle.length, true);
  assert.equal(title.output.title.endsWith(" "), false);
});
