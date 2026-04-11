import assert from "node:assert/strict";
import test from "node:test";

import {
  GEMINI_API_BASE_URL,
  GEMINI_PROVIDER_DEFAULT_MODELS,
  GEMINI_PROVIDER_SUPPORTED_OPERATIONS,
  GeminiProvider,
  normalizeGeminiGenerateContentResult,
} from "../packages/shared/llm/gemini-provider.ts";
import {
  buildReflectionGroundingContext,
  buildReflectionGroundingPromptContent,
} from "../packages/shared/llm/reflection-grounding.ts";
import {
  isLLMProviderError,
  type LLMProvider,
} from "../packages/shared/llm/provider.ts";
import {
  assertGroundedReflectionPrompt,
  assertMetadataClassificationResponse,
  assertProviderContractSurface,
  assertSingleStringOutputResponse,
  createLLMProviderContractRequests,
} from "./helpers/llm-provider-contract-harness.ts";
import { PRIMARY_REFLECTION_GROUNDING_FIXTURE } from "./helpers/reflection-grounding-fixture.ts";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-goog-request-id": "gemini_req_test",
    },
    ...init,
  });
}

test("GeminiProvider validates constructor configuration", () => {
  assert.throws(
    () =>
      new GeminiProvider({
        apiKey: "   ",
        fetch: async () => jsonResponse({}),
      }),
    /GEMINI_API_KEY/i,
  );
});

test("normalizeGeminiGenerateContentResult maps assistant text, refusals, and finish reasons", () => {
  const success = normalizeGeminiGenerateContentResult({
    candidates: [
      {
        content: {
          parts: [
            {
              text: "Capture immediately.",
            },
            {
              text: "Enrich asynchronously.",
            },
          ],
          role: "model",
        },
        finishReason: "MAX_TOKENS",
      },
    ],
  });
  const refusal = normalizeGeminiGenerateContentResult({
    candidates: [
      {
        finishMessage: "Blocked for policy reasons.",
        finishReason: "SAFETY",
      },
    ],
  });

  assert.deepEqual(success, {
    role: "assistant",
    content: [
      {
        type: "text",
        text: "Capture immediately.",
      },
      {
        type: "text",
        text: "Enrich asynchronously.",
      },
    ],
    finishReason: "length",
    text: "Capture immediately.\nEnrich asynchronously.",
  });
  assert.deepEqual(refusal, {
    role: "assistant",
    content: [
      {
        type: "refusal",
        refusal: "Blocked for policy reasons.",
      },
    ],
    finishReason: "content-filter",
    text: "",
  });
});

test("GeminiProvider resolves model aliases and translates normalized operations into Gemini generateContent requests", async () => {
  const apiCalls: Array<{ url: string; init?: RequestInit }> = [];
  const requests = createLLMProviderContractRequests();
  const fetchStub: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    apiCalls.push({ url, init });

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

    if (!url.startsWith(`${GEMINI_API_BASE_URL}/models/`)) {
      throw new Error(`Unexpected fetch to ${url}`);
    }

    assert.equal(init?.method, "POST");
    assert.equal(init?.headers instanceof Headers, true);
    assert.equal((init?.headers as Headers).get("x-goog-api-key"), "gemini-test-key");

    const body = JSON.parse(String(init?.body)) as {
      contents: Array<{
        parts: Array<Record<string, unknown>>;
        role?: string;
      }>;
      generationConfig?: Record<string, unknown>;
      systemInstruction?: {
        parts: Array<{
          text?: string;
        }>;
      };
    };
    const systemInstruction = body.systemInstruction?.parts?.[0]?.text;

    if (typeof systemInstruction !== "string") {
      throw new Error(`Unhandled Gemini request without system instruction: ${JSON.stringify(body)}`);
    }

    if (systemInstruction.includes("Summarize the content")) {
      assert.equal(url, `${GEMINI_API_BASE_URL}/models/gemini-2.5-flash-custom:generateContent`);
      assert.equal(body.contents[0]?.role, "user");
      assert.deepEqual(body.contents[0]?.parts, [
        {
          text:
            "Waka should feel instant on capture while moving enrichment work onto the queue.",
        },
      ]);

      return jsonResponse({
        modelVersion: "gemini-2.5-flash-custom",
        candidates: [
          {
            content: {
              parts: [
                {
                  text:
                    "Capture instantly, enrich asynchronously, never lose the note.",
                },
              ],
              role: "model",
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 11,
          totalTokenCount: 31,
        },
      });
    }

    if (systemInstruction.includes("Choose exactly one label")) {
      return jsonResponse({
        modelVersion: "gemini-2.5-flash-custom",
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "productivity",
                },
              ],
              role: "model",
            },
          },
        ],
      });
    }

    if (systemInstruction.includes("reflective follow-up question")) {
      assert.deepEqual(body.contents[0]?.parts, [
        {
          text: buildReflectionGroundingPromptContent(
            requests.generateReflection.input.content,
            requests.generateReflection.input.groundingContext,
          ),
        },
      ]);
      assert.match(systemInstruction, /reference a concrete detail, theme, tension, or subject/i);
      assert.match(systemInstruction, /use the grounding context directly/i);

      return jsonResponse({
        modelVersion: "gemini-2.5-flash-custom",
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "What pattern keeps showing up across these ideas?",
                },
              ],
              role: "model",
            },
          },
        ],
      });
    }

    if (systemInstruction.includes("strongest connection")) {
      assert.deepEqual(body.contents[0]?.parts, [
        {
          text: "Source note:\nCapture fast.\n\nTarget note:\nResurface later.",
        },
      ]);

      return jsonResponse({
        modelVersion: "gemini-2.5-flash-custom",
        candidates: [
          {
            content: {
              parts: [
                {
                  text:
                    "Both notes focus on turning fleeting captures into durable knowledge.",
                },
              ],
              role: "model",
            },
          },
        ],
      });
    }

    if (systemInstruction.includes("Generate a concise, descriptive title")) {
      return jsonResponse({
        modelVersion: "gemini-2.5-flash-custom",
        candidates: [
          {
            content: {
              parts: [
                {
                  text:
                    "Instant capture, durable knowledge, and surprisingly resilient async synthesis pipelines",
                },
              ],
              role: "model",
            },
          },
        ],
      });
    }

    if (systemInstruction.includes("Classify the note into JSON")) {
      assert.deepEqual(body.generationConfig?.responseMimeType, "application/json");
      assert.deepEqual(body.generationConfig?.responseSchema, {
        properties: {
          actionability: {
            type: "STRING",
          },
          domain: {
            type: "STRING",
          },
          mood: {
            type: "STRING",
          },
          tags: {
            items: {
              type: "STRING",
            },
            type: "ARRAY",
          },
        },
        required: ["tags", "domain", "mood", "actionability"],
        type: "OBJECT",
      });

      return jsonResponse({
        modelVersion: "gemini-2.5-flash-custom",
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    tags: ["capture", "knowledge", "ai"],
                    domain: "technology",
                    mood: "curious",
                    actionability: "idea",
                  }),
                },
              ],
              role: "model",
            },
          },
        ],
      });
    }

    if (systemInstruction.includes("Transcribe this audio")) {
      assert.equal(url, `${GEMINI_API_BASE_URL}/models/gemini-2.0-flash-exp-custom:generateContent`);
      assert.equal(body.contents[0]?.role, "user");
      assert.equal(
        body.contents[0]?.parts.some(
          (part) =>
            "inline_data" in part &&
            (part.inline_data as { mime_type?: string }).mime_type === "audio/mpeg",
        ),
        true,
      );

      return jsonResponse({
        modelVersion: "gemini-2.0-flash-exp-custom",
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "Voice transcript for a capture about linking scattered notes.",
                },
              ],
              role: "model",
            },
          },
        ],
      });
    }

    if (systemInstruction.includes("Extract any legible text")) {
      assert.equal(url, `${GEMINI_API_BASE_URL}/models/gemini-2.5-flash-vision-custom:generateContent`);
      assert.equal(body.contents[0]?.role, "user");
      assert.equal(
        body.contents[0]?.parts.some(
          (part) =>
            "inline_data" in part &&
            typeof (part.inline_data as { data?: string }).data === "string" &&
            ((part.inline_data as { data?: string }).data?.length ?? 0) > 0 &&
            (part.inline_data as { mime_type?: string }).mime_type === "image/png",
        ),
        true,
      );

      return jsonResponse({
        modelVersion: "gemini-2.5-flash-vision-custom",
        candidates: [
          {
            content: {
              parts: [
                {
                  text:
                    "A handwritten sticky note describing a fast capture workflow beside a laptop.",
                },
              ],
              role: "model",
            },
          },
        ],
        usageMetadata: {
          promptTokenCount: 18,
          candidatesTokenCount: 14,
          totalTokenCount: 32,
          promptTokensDetails: [
            {
              modality: "TEXT",
              tokenCount: 9,
            },
            {
              modality: "IMAGE",
              tokenCount: 9,
            },
          ],
          candidatesTokensDetails: [
            {
              modality: "TEXT",
              tokenCount: 14,
            },
          ],
        },
      });
    }

    throw new Error(`Unhandled Gemini request: ${JSON.stringify(body)}`);
  };

  const provider: LLMProvider = new GeminiProvider({
    apiKey: "gemini-test-key",
    fetch: fetchStub,
    models: {
      text: "gemini-2.5-flash-custom",
      transcription: "gemini-2.0-flash-exp-custom",
      vision: "gemini-2.5-flash-vision-custom",
    },
  });

  const summary = await provider.summarize(requests.summarize);
  const classification = await provider.classify(requests.classify);
  const metadata = await provider.classifyMetadata(requests.classifyMetadata);
  const reflection = await provider.generateReflection(
    requests.generateReflection,
  );
  const connection = await provider.explainConnection(requests.explainConnection);
  const title = await provider.generateTitle(requests.generateTitle);
  const transcription = await provider.transcribeAudio(requests.transcribeAudio);
  const description = await provider.describeImage(requests.describeImage);

  assertProviderContractSurface(provider, GEMINI_PROVIDER_SUPPORTED_OPERATIONS);
  assertSingleStringOutputResponse({
    response: summary,
    request: requests.summarize,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_req_test",
    outputKey: "summary",
  });
  assert.equal(summary.traceId, requests.summarize.traceId);
  assert.deepEqual(summary.usage, {
    inputTokens: 20,
    outputTokens: 11,
    totalTokens: 31,
  });
  assert.equal(
    summary.output.summary,
    "Capture instantly, enrich asynchronously, never lose the note.",
  );
  assertSingleStringOutputResponse({
    response: classification,
    request: requests.classify,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_req_test",
    outputKey: "classification",
  });
  assertMetadataClassificationResponse({
    response: metadata,
    request: requests.classifyMetadata,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_req_test",
  });
  assert.deepEqual(metadata.output.tags, ["capture", "knowledge", "ai"]);
  assertSingleStringOutputResponse({
    response: reflection,
    request: requests.generateReflection,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_req_test",
    outputKey: "reflectionPrompt",
  });
  assertGroundedReflectionPrompt({
    prompt: reflection.output.reflectionPrompt,
    content: requests.generateReflection.input.content,
    groundingContext: requests.generateReflection.input.groundingContext,
  });
  assertSingleStringOutputResponse({
    response: connection,
    request: requests.explainConnection,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_req_test",
    outputKey: "explanation",
  });
  assertSingleStringOutputResponse({
    response: title,
    request: requests.generateTitle,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_req_test",
    outputKey: "title",
  });
  assertSingleStringOutputResponse({
    response: transcription,
    request: requests.transcribeAudio,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_req_test",
    outputKey: "transcript",
  });
  assertSingleStringOutputResponse({
    response: description,
    request: requests.describeImage,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_req_test",
    outputKey: "description",
  });
  assert.equal(reflection.output.reflectionPrompt.endsWith("?"), true);
  assert.match(connection.output.explanation, /durable knowledge/i);
  assert.equal(
    title.output.title,
    "Instant capture, durable knowledge, and surprisingly resilient async synthesis p",
  );
  assert.match(transcription.output.transcript, /Voice transcript/);
  assert.match(description.output.description, /sticky note/i);
  assert.deepEqual(description.usageMetadata, {
    candidatesTokensDetails: {
      modalities: [
        {
          modality: "text",
          tokenCount: 14,
        },
      ],
    },
    promptTokensDetails: {
      modalities: [
        {
          modality: "text",
          tokenCount: 9,
        },
        {
          modality: "image",
          tokenCount: 9,
        },
      ],
    },
  });
  assert.equal(
    apiCalls.some(
      (call) =>
        call.url === `${GEMINI_API_BASE_URL}/models/gemini-2.0-flash-exp-custom:generateContent`,
    ),
    true,
  );
});

test("GeminiProvider rewrites generic reflection prompts into grounded follow-up questions", async () => {
  const provider = new GeminiProvider({
    apiKey: "gemini-test-key",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.url;

      assert.equal(
        url,
        `${GEMINI_API_BASE_URL}/models/${GEMINI_PROVIDER_DEFAULT_MODELS.text}:generateContent`,
      );

      const body = JSON.parse(String(init?.body)) as {
        systemInstruction?: {
          parts?: Array<{ text?: string }>;
        };
      };
      const systemInstruction = body.systemInstruction?.parts?.[0]?.text ?? "";

      assert.match(systemInstruction, /reflective follow-up question/i);

      return jsonResponse({
        modelVersion: GEMINI_PROVIDER_DEFAULT_MODELS.text,
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "What pattern keeps showing up across these ideas?",
                },
              ],
              role: "model",
            },
          },
        ],
      });
    },
  });

  const content = PRIMARY_REFLECTION_GROUNDING_FIXTURE.sourceText;
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

test("GeminiProvider translates normalized generation settings into Gemini generationConfig", async () => {
  const provider = new GeminiProvider({
    apiKey: "gemini-test-key",
    fetch: async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      assert.equal(url, `${GEMINI_API_BASE_URL}/models/${GEMINI_PROVIDER_DEFAULT_MODELS.text}:generateContent`);

      const body = JSON.parse(String(init?.body)) as {
        generationConfig?: Record<string, unknown>;
      };

      assert.deepEqual(body.generationConfig, {
        frequencyPenalty: 0.1,
        maxOutputTokens: 96,
        presencePenalty: 0.3,
        seed: 17,
        stopSequences: ["END", "STOP"],
        temperature: 0.7,
        topK: 12,
        topP: 0.9,
      });

      return jsonResponse({
        modelVersion: GEMINI_PROVIDER_DEFAULT_MODELS.text,
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "Gemini generation config normalized correctly.",
                },
              ],
              role: "model",
            },
          },
        ],
      });
    },
  });

  const summary = await provider.summarize({
    operation: "summarize",
    requestId: "req_generation_config",
    generation: {
      frequencyPenalty: 0.1,
      maxTokens: 96,
      presencePenalty: 0.3,
      seed: 17,
      stopSequences: ["END", "STOP"],
      temperature: 0.7,
      topK: 12,
      topP: 0.9,
    },
    input: {
      content: "Translate normalized generation settings into Gemini options.",
    },
  });

  assert.equal(summary.output.summary, "Gemini generation config normalized correctly.");
});

test("GeminiProvider rejects embeddings because Waka pins vectors to OpenAI", async () => {
  const provider = new GeminiProvider({
    apiKey: "gemini-test-key",
    fetch: async () => jsonResponse({}),
  });

  await assert.rejects(
    provider.generateEmbedding({
      operation: "generateEmbedding",
      requestId: "req_embedding_gemini",
      input: {
        text: "Keep embeddings pinned to OpenAI.",
      },
    }),
    (error: unknown) =>
      isLLMProviderError(error) &&
      error.code === "UNSUPPORTED_OPERATION" &&
      error.operation === "generateEmbedding" &&
      error.provider === "gemini",
  );
});

test("GeminiProvider normalizes Gemini API failures into provider errors", async () => {
  const provider = new GeminiProvider({
    apiKey: "gemini-test-key",
    fetch: async () =>
      jsonResponse(
        {
          error: {
            code: 429,
            message: "Quota exhausted for this workspace.",
            status: "RESOURCE_EXHAUSTED",
          },
        },
        {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "15",
            "x-goog-request-id": "gemini_req_rate_limited",
          },
        },
      ),
  });

  await assert.rejects(
    provider.summarize({
      operation: "summarize",
      requestId: "req_summary_rate_limit",
      traceId: "trace_summary_rate_limit",
      input: {
        content: "Normalize Gemini API failures.",
      },
    }),
    (error: unknown) => {
      assert.equal(isLLMProviderError(error), true);

      if (!isLLMProviderError(error)) {
        return false;
      }

      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.message, "Quota exhausted for this workspace.");
      assert.equal(error.retryable, true);
      assert.equal(error.requestId, "gemini_req_rate_limited");
      assert.equal(error.traceId, "trace_summary_rate_limit");
      assert.equal(error.statusCode, 429);
      assert.deepEqual(error.details, {
        retryAfterSeconds: 15,
        status: "resource_exhausted",
      });

      return true;
    },
  );
});

test("GeminiProvider normalizes thrown transport errors into provider errors", async () => {
  const transportError = Object.assign(new Error("Gemini backend unavailable."), {
    response: {
      status: 503,
    },
  });

  const provider = new GeminiProvider({
    apiKey: "gemini-test-key",
    fetch: async () => {
      throw transportError;
    },
  });

  await assert.rejects(
    provider.summarize({
      operation: "summarize",
      requestId: "req_summary_transport_failure",
      traceId: "trace_summary_transport_failure",
      input: {
        content: "Normalize Gemini transport failures.",
      },
    }),
    (error: unknown) => {
      assert.equal(isLLMProviderError(error), true);

      if (!isLLMProviderError(error)) {
        return false;
      }

      assert.equal(error.code, "UNAVAILABLE");
      assert.equal(error.message, "Gemini backend unavailable.");
      assert.equal(error.retryable, true);
      assert.equal(error.requestId, "req_summary_transport_failure");
      assert.equal(error.traceId, "trace_summary_transport_failure");
      assert.equal(error.statusCode, 503);

      return true;
    },
  );
});
