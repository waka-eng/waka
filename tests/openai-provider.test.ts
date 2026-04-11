import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENAI_API_BASE_URL,
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL,
  OPENAI_PROVIDER_DEFAULT_MODELS,
  buildOpenAIMessages,
  normalizeOpenAICompletionResult,
  OpenAIProvider,
} from "../packages/shared/llm/openai-provider.ts";
import {
  buildReflectionGroundingContext,
  buildReflectionGroundingPromptContent,
} from "../packages/shared/llm/reflection-grounding.ts";
import {
  isLLMProviderError,
} from "../packages/shared/llm/provider.ts";
import { assertGroundedReflectionPrompt } from "./helpers/llm-provider-contract-harness.ts";
import { PRIMARY_REFLECTION_GROUNDING_FIXTURE } from "./helpers/reflection-grounding-fixture.ts";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-request-id": "openai_req_test",
    },
    ...init,
  });
}

test("OpenAIProvider validates constructor configuration", () => {
  assert.throws(
    () =>
      new OpenAIProvider({
        apiKey: "   ",
        fetch: async () => jsonResponse({}),
      }),
    /OPENAI_API_KEY/i,
  );
});

test("buildOpenAIMessages prepends system instructions and preserves normalized role/content mapping", () => {
  const messages = buildOpenAIMessages({
    systemInstruction: "Keep the response concise and grounded in the provided context.",
    input: [
      {
        role: "assistant",
        content: "Previous synthesis.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Compare this note with the attached sketch.",
          },
          {
            type: "image",
            imageUrl: "data:image/png;base64,abc123",
            detail: "high",
          },
        ],
      },
    ],
  });

  assert.deepEqual(messages, [
    {
      role: "system",
      content: "Keep the response concise and grounded in the provided context.",
    },
    {
      role: "assistant",
      content: "Previous synthesis.",
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: "Compare this note with the attached sketch.",
        },
        {
          type: "image_url",
          image_url: {
            url: "data:image/png;base64,abc123",
            detail: "high",
          },
        },
      ],
    },
  ]);
});

test("normalizeOpenAICompletionResult maps assistant text and structured content blocks", () => {
  const result = normalizeOpenAICompletionResult({
    choices: [
      {
        message: {
          content: [
            {
              type: "text",
              text: "Capture immediately.",
            },
            {
              type: "refusal",
              refusal: "I cannot access external state.",
            },
            {
              type: "output_text",
              text: "Enrich asynchronously.",
            },
          ],
        },
      },
    ],
  });

  assert.deepEqual(result, {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Capture immediately.",
      },
      {
        type: "refusal",
        refusal: "I cannot access external state.",
      },
      {
        type: "text",
        text: "Enrich asynchronously.",
      },
    ],
    text: "Capture immediately.\nEnrich asynchronously.",
  });
});

test("normalizeOpenAICompletionResult normalizes OpenAI finish reasons across payload shapes", () => {
  const chatCompletionsResult = normalizeOpenAICompletionResult({
    choices: [
      {
        finish_reason: "content_filter",
        message: {
          content: "Output blocked by the content filter.",
        },
      },
    ],
  });

  const responsesResult = normalizeOpenAICompletionResult({
    status: "incomplete",
    incomplete_details: {
      reason: "max_output_tokens",
    },
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "Trimmed because the output limit was reached.",
          },
        ],
      },
    ],
  });

  assert.equal(chatCompletionsResult?.finishReason, "content-filter");
  assert.equal(responsesResult?.finishReason, "length");
});

test("OpenAIProvider summarizes responses-style assistant payloads", async () => {
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
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Responses API summary output.",
              },
            ],
          },
        ],
      });
    },
  });

  const summary = await provider.summarize({
    operation: "summarize",
    requestId: "req_summary_responses_payload",
    input: {
      content: "Normalize the assistant content blocks from the responses API payload.",
    },
  });

  assert.equal(summary.output.summary, "Responses API summary output.");
  assert.equal(summary.finishReason, "stop");
});

test("OpenAIProvider resolves normalized model aliases to configured OpenAI models", async () => {
  const configuredModels = {
    text: "gpt-5-mini-custom",
    transcription: "gpt-4o-mini-transcribe-custom",
    vision: "gpt-4.1-mini-custom",
  } as const;

  const provider = new OpenAIProvider({
    apiKey: "sk-test",
    models: configuredModels,
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === "https://assets.example/voice-note.mp3") {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: {
            "content-type": "audio/mpeg",
          },
        });
      }

      if (url === "https://assets.example/inspiration.png") {
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: {
            "content-type": "image/png",
          },
        });
      }

      if (url === `${OPENAI_API_BASE_URL}/embeddings`) {
        const body = JSON.parse(String(init?.body)) as {
          model: string;
        };
        assert.equal(body.model, OPENAI_EMBEDDING_MODEL);

        return jsonResponse({
          model: body.model,
          data: [
            {
              embedding: Array.from(
                { length: OPENAI_EMBEDDING_DIMENSIONS },
                () => 0.5,
              ),
            },
          ],
        });
      }

      if (url === `${OPENAI_API_BASE_URL}/chat/completions`) {
        const body = JSON.parse(String(init?.body)) as {
          messages: Array<{
            role: string;
            content: unknown;
          }>;
          model: string;
        };
        const systemPrompt = body.messages[0];

        if (
          systemPrompt?.role === "system" &&
          typeof systemPrompt.content === "string" &&
          systemPrompt.content.includes("Summarize the content")
        ) {
          assert.equal(body.model, configuredModels.text);
          assert.deepEqual(body.messages[1], {
            role: "user",
            content: "Use the normalized text model alias.",
          });

          return jsonResponse({
            model: body.model,
            choices: [
              {
                message: {
                  content: "A concise summary.",
                },
              },
            ],
          });
        }

        if (
          systemPrompt?.role === "system" &&
          typeof systemPrompt.content === "string" &&
          systemPrompt.content.includes("Extract any legible text")
        ) {
          assert.equal(body.model, configuredModels.vision);
          assert.equal(body.messages[1]?.role, "user");
          assert.ok(Array.isArray(body.messages[1]?.content));

          return jsonResponse({
            model: body.model,
            choices: [
              {
                message: {
                  content: "A concise image description.",
                },
              },
            ],
          });
        }

        throw new Error(`Unhandled chat completions request: ${JSON.stringify(body)}`);
      }

      if (url === `${OPENAI_API_BASE_URL}/audio/transcriptions`) {
        assert.equal(init?.body instanceof FormData, true);
        const formData = init?.body as FormData;
        assert.equal(
          formData.get("model"),
          configuredModels.transcription,
        );

        return jsonResponse({
          text: "Transcript text.",
        });
      }

      throw new Error(`Unexpected fetch to ${url}`);
    },
  });

  const embedding = await provider.generateEmbedding({
    operation: "generateEmbedding",
    requestId: "req_embedding_model_alias",
    input: {
      text: "Pinned embedding model.",
      model: "embedding",
    },
  });
  const summary = await provider.summarize({
    operation: "summarize",
    requestId: "req_summary_model_alias",
    input: {
      content: "Use the normalized text model alias.",
      model: "text",
    },
  });
  const description = await provider.describeImage({
    operation: "describeImage",
    requestId: "req_image_model_alias",
    input: {
      imageUrl: "https://assets.example/inspiration.png",
      model: "vision",
    },
  });
  const transcription = await provider.transcribeAudio({
    operation: "transcribeAudio",
    requestId: "req_audio_model_alias",
    input: {
      audio: {
        mediaUrl: "https://assets.example/voice-note.mp3",
        storageKey: "users/user-openai/voice-notes/voice-note.mp3",
      },
      model: "transcription",
    },
  });

  assert.equal(embedding.model, OPENAI_EMBEDDING_MODEL);
  assert.equal(summary.model, configuredModels.text);
  assert.equal(description.model, configuredModels.vision);
  assert.equal(transcription.model, configuredModels.transcription);
});

test("OpenAIProvider translates normalized generation settings into chat completion options", async () => {
  let requestBody: Record<string, unknown> | undefined;

  const provider = new OpenAIProvider({
    apiKey: "sk-test",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === `${OPENAI_API_BASE_URL}/chat/completions`) {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

        return jsonResponse({
          model: OPENAI_PROVIDER_DEFAULT_MODELS.text,
          choices: [
            {
              message: {
                content: "Translated settings summary.",
              },
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch to ${url}`);
    },
  });

  const request = {
    operation: "summarize",
    requestId: "req_summary_generation_options",
    input: {
      content: "Translate normalized generation settings into OpenAI options.",
      maxCharacters: 280,
      model: "text",
    },
    generation: {
      temperature: 0.25,
      maxTokens: 96,
      stopSequences: ["END", "   "],
      topP: 0.8,
      topK: 32,
      frequencyPenalty: 0.5,
      presencePenalty: 0.6,
      seed: 42,
    },
  } satisfies SummarizeRequest;

  const summary = await provider.summarize(request);

  assert.equal(summary.output.summary, "Translated settings summary.");
  assert.deepEqual(requestBody, {
    model: OPENAI_PROVIDER_DEFAULT_MODELS.text,
    messages: [
      {
        role: "system",
        content:
          "Summarize the content in 280 characters or fewer. Respond with summary text only.",
      },
      {
        role: "user",
        content: "Translate normalized generation settings into OpenAI options.",
      },
    ],
    max_completion_tokens: 96,
    temperature: 0.25,
    stop: ["END"],
    top_p: 0.8,
    frequency_penalty: 0.5,
    presence_penalty: 0.6,
    seed: 42,
  });
  assert.equal("top_k" in (requestBody ?? {}), false);
});

test("OpenAIProvider rejects unsupported model inputs before making a request", async () => {
  const provider = new OpenAIProvider({
    apiKey: "sk-test",
    fetch: async () => {
      throw new Error("fetch should not be called for invalid models");
    },
  });

  await assert.rejects(
    provider.summarize({
      operation: "summarize",
      requestId: "req_invalid_model_alias",
      input: {
        content: "A summary request with the wrong alias.",
        model: "vision" as never,
      },
    }),
    (error: unknown) =>
      isLLMProviderError(error) &&
      error.code === "BAD_REQUEST" &&
      error.operation === "summarize" &&
      error.message.includes('"vision"'),
  );
});

test("OpenAIProvider asks for reflection prompts grounded in the saved capture", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const content = PRIMARY_REFLECTION_GROUNDING_FIXTURE.sourceText;

  const provider = new OpenAIProvider({
    apiKey: "sk-test",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.url;

      if (url !== `${OPENAI_API_BASE_URL}/chat/completions`) {
        throw new Error(`Unexpected fetch to ${url}`);
      }

      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

      return jsonResponse({
        model: OPENAI_PROVIDER_DEFAULT_MODELS.text,
        choices: [
          {
            message: {
              content:
                "What tension between clustering by theme and source made this capture feel important?",
            },
          },
        ],
      });
    },
  });

  const reflection = await provider.generateReflection({
    operation: "generateReflection",
    requestId: "req_reflection_context",
    input: {
      content,
      groundingContext: buildReflectionGroundingContext(content),
      model: "text",
    },
  });

  assert.equal(
    reflection.output.reflectionPrompt,
    "What tension between clustering by theme and source made this capture feel important?",
  );
  assertGroundedReflectionPrompt({
    prompt: reflection.output.reflectionPrompt,
    content,
    groundingContext: buildReflectionGroundingContext(content),
  });
  assert.deepEqual(requestBody, {
    model: OPENAI_PROVIDER_DEFAULT_MODELS.text,
    messages: [
      {
        role: "system",
        content:
          "Write a single reflective follow-up question that helps the user deepen the captured idea. Use the grounding context directly by naming at least one phrase, detail, or theme from it. The question must reference a concrete detail, theme, tension, or subject from the captured content and must avoid vague wording like 'this thought' or 'this idea' without naming what it refers to. Respond with the question only.",
      },
      {
        role: "user",
        content: buildReflectionGroundingPromptContent(
          content,
          buildReflectionGroundingContext(content),
        ),
      },
    ],
    max_completion_tokens: 120,
  });
});

test("OpenAIProvider rewrites generic reflection prompts into grounded follow-up questions", async () => {
  const content = PRIMARY_REFLECTION_GROUNDING_FIXTURE.sourceText;
  const provider = new OpenAIProvider({
    apiKey: "sk-test",
    fetch: async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url !== `${OPENAI_API_BASE_URL}/chat/completions`) {
        throw new Error(`Unexpected fetch to ${url}`);
      }

      return jsonResponse({
        model: OPENAI_PROVIDER_DEFAULT_MODELS.text,
        choices: [
          {
            message: {
              content: "What pattern keeps showing up across these ideas?",
            },
          },
        ],
      });
    },
  });

  const reflection = await provider.generateReflection({
    operation: "generateReflection",
    requestId: "req_reflection_generic",
    input: {
      content,
      groundingContext: buildReflectionGroundingContext(content),
      model: "text",
    },
  });

  assert.equal(
    reflection.output.reflectionPrompt,
    PRIMARY_REFLECTION_GROUNDING_FIXTURE.expectedGroundedQuestion,
  );
  assertGroundedReflectionPrompt({
    prompt: reflection.output.reflectionPrompt,
    content,
    groundingContext: buildReflectionGroundingContext(content),
  });
});

test("OpenAIProvider rejects metadata classifications outside the allowed enums", async () => {
  const provider = new OpenAIProvider({
    apiKey: "sk-test",
    fetch: async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url !== `${OPENAI_API_BASE_URL}/chat/completions`) {
        throw new Error(`Unexpected fetch to ${url}`);
      }

      return jsonResponse({
        model: OPENAI_PROVIDER_DEFAULT_MODELS.text,
        choices: [
          {
            message: {
              content: JSON.stringify({
                tags: ["capture", "ai"],
                domain: "unknown_space",
                mood: "curious",
                actionability: "idea",
              }),
            },
          },
        ],
      });
    },
  });

  await assert.rejects(
    () =>
      provider.classifyMetadata({
        operation: "classifyMetadata",
        requestId: "req_invalid_metadata",
        input: {
          content: "A capture with invalid metadata classification output.",
        },
      }),
    (error: unknown) =>
      isLLMProviderError(error) &&
      error.code === "INVALID_RESPONSE" &&
      error.operation === "classifyMetadata",
  );
});

test("OpenAIProvider normalizes finish reasons and detailed token accounting", async () => {
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
            finish_reason: "length",
            message: {
              content: "Fast capture, async enrichment.",
            },
          },
        ],
        usage: {
          prompt_tokens: 21,
          prompt_tokens_details: {
            cached_tokens: 8,
            audio_tokens: 2,
          },
          completion_tokens: 13,
          completion_tokens_details: {
            reasoning_tokens: 5,
            audio_tokens: 1,
            accepted_prediction_tokens: 3,
            rejected_prediction_tokens: 2,
          },
          total_tokens: 34,
        },
      });
    },
  });

  const summary = await provider.summarize({
    operation: "summarize",
    requestId: "req_summary_usage_metadata",
    input: {
      content: "Capture immediately, then enrich in the background.",
    },
  });

  assert.equal(summary.finishReason, "length");
  assert.deepEqual(summary.usage, {
    inputTokens: 21,
    outputTokens: 13,
    totalTokens: 34,
  });
  assert.deepEqual(summary.usageMetadata, {
    inputTokensDetails: {
      cachedTokens: 8,
      audioTokens: 2,
    },
    outputTokensDetails: {
      reasoningTokens: 5,
      audioTokens: 1,
      acceptedPredictionTokens: 3,
      rejectedPredictionTokens: 2,
    },
  });
});

test("OpenAIProvider normalizes OpenAI API failures into provider errors", async () => {
  const provider = new OpenAIProvider({
    apiKey: "sk-test",
    fetch: async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url !== `${OPENAI_API_BASE_URL}/chat/completions`) {
        throw new Error(`Unexpected fetch to ${url}`);
      }

      return jsonResponse(
        {
          error: {
            code: "insufficient_quota",
            message: "Rate limit exceeded for this workspace.",
            type: "rate_limit_error",
          },
        },
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "12",
            "x-request-id": "openai_req_rate_limited",
          },
        },
      );
    },
  });

  await assert.rejects(
    provider.summarize({
      operation: "summarize",
      requestId: "req_summary_rate_limit",
      traceId: "trace_summary_rate_limit",
      input: {
        content: "Normalize provider error responses.",
      },
    }),
    (error: unknown) => {
      assert.equal(isLLMProviderError(error), true);

      if (!isLLMProviderError(error)) {
        return false;
      }

      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.message, "Rate limit exceeded for this workspace.");
      assert.equal(error.retryable, true);
      assert.equal(error.requestId, "openai_req_rate_limited");
      assert.equal(error.traceId, "trace_summary_rate_limit");
      assert.equal(error.statusCode, 429);
      assert.deepEqual(error.details, {
        code: "insufficient_quota",
        retryAfterSeconds: 12,
        type: "rate_limit_error",
      });

      return true;
    },
  );
});

test("OpenAIProvider normalizes OpenAI SDK failures into provider errors", async () => {
  const sdkError = Object.assign(new Error("OpenAI connection timed out."), {
    code: "connection_timeout",
    name: "APIConnectionTimeoutError",
    request_id: "openai_req_sdk_timeout",
    type: "api_connection_timeout_error",
  });

  const provider = new OpenAIProvider({
    apiKey: "sk-test",
    fetch: async () => {
      throw sdkError;
    },
  });

  await assert.rejects(
    provider.summarize({
      operation: "summarize",
      requestId: "req_summary_sdk_timeout",
      traceId: "trace_summary_sdk_timeout",
      input: {
        content: "Normalize OpenAI SDK failures.",
      },
    }),
    (error: unknown) => {
      assert.equal(isLLMProviderError(error), true);

      if (!isLLMProviderError(error)) {
        return false;
      }

      assert.equal(error.code, "TIMEOUT");
      assert.equal(error.message, "OpenAI connection timed out.");
      assert.equal(error.retryable, true);
      assert.equal(error.requestId, "openai_req_sdk_timeout");
      assert.equal(error.traceId, "trace_summary_sdk_timeout");
      assert.equal(error.statusCode, undefined);
      assert.deepEqual(error.details, {
        code: "connection_timeout",
        type: "api_connection_timeout_error",
      });

      return true;
    },
  );
});

test("OpenAIProvider rejects embeddings that do not match the locked dimension", async () => {
  const provider = new OpenAIProvider({
    apiKey: "sk-test",
    fetch: async (input) => {
      const url = typeof input === "string" ? input : input.url;

      if (url === `${OPENAI_API_BASE_URL}/embeddings`) {
        return jsonResponse({
          model: OPENAI_EMBEDDING_MODEL,
          data: [
            {
              embedding: [0.1, 0.2, 0.3],
            },
          ],
        });
      }

      throw new Error(`Unexpected fetch to ${url}`);
    },
  });

  await assert.rejects(
    provider.generateEmbedding({
      operation: "generateEmbedding",
      requestId: "req_bad_embedding",
      input: {
        text: "Keep dimensions pinned.",
      },
    }),
    (error: unknown) =>
      isLLMProviderError(error) &&
      error.code === "INVALID_RESPONSE" &&
      error.operation === "generateEmbedding",
  );
});
