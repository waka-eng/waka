import assert from "node:assert/strict";
import test from "node:test";

import {
  GEMINI_API_BASE_URL,
  GEMINI_PROVIDER_SUPPORTED_OPERATIONS,
  GeminiProvider,
} from "../packages/shared/llm/gemini-provider.ts";
import {
  OPENAI_API_BASE_URL,
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL,
  OpenAIProvider,
} from "../packages/shared/llm/openai-provider.ts";
import {
  METADATA_CLASSIFICATION_ACTIONABILITY,
  METADATA_CLASSIFICATION_DOMAINS,
  METADATA_CLASSIFICATION_MOODS,
  LLM_PROVIDER_ERROR_CODES,
  LLM_PROVIDER_NAMES,
  LLM_PROVIDER_OPERATIONS,
  LLMProviderError,
  isLLMProviderError,
  type LLMProvider,
} from "../packages/shared/llm/provider.ts";
import {
  assertGroundedReflectionPrompt,
  assertEmbeddingResponse,
  assertMetadataClassificationResponse,
  assertProviderContractSurface,
  assertRegisteredProviderContractCoverage,
  assertProviderErrorContract,
  assertSingleStringOutputResponse,
  createLLMProviderContractRequests,
  createProviderResponseFixture,
  type RegisteredProviderContractFixture,
} from "./helpers/llm-provider-contract-harness.ts";

const requests = createLLMProviderContractRequests();

interface ProviderContractFixture extends RegisteredProviderContractFixture {
  provider: "gemini" | "openai";
  supportedOperations: readonly (typeof LLM_PROVIDER_OPERATIONS)[number][];
  createProvider(fetchImplementation: typeof fetch): LLMProvider;
  createSuccessFetch(): typeof fetch;
  expectedSuccessRequestId: string;
  createRateLimitResponse(): Response;
  createTransportError(): Error & {
    response: {
      status: number;
    };
  };
  expectedRateLimitDetails: Record<string, unknown>;
  expectedRateLimitMessage: string;
  expectedRateLimitRequestId: string;
  expectedTransportMessage: string;
}

function openAIJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-request-id": "openai_contract_success_req",
    },
    ...init,
  });
}

function geminiJsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json",
      "x-goog-request-id": "gemini_contract_success_req",
    },
    ...init,
  });
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clampNormalizedText(value: string, maxCharacters: number): string {
  const normalized = normalizeWhitespace(value);

  if (normalized.length <= maxCharacters) {
    return normalized;
  }

  return normalized.slice(0, maxCharacters).trimEnd();
}

function createFailurePathSummarizeRequest(
  provider: ProviderContractFixture["provider"],
  category: "provider_api" | "transport" | "validation",
) {
  return {
    ...requests.summarize,
    requestId: `req_summary_${provider}_${category}`,
    traceId: `trace_summary_${provider}_${category}`,
    maxRetries: 0,
    input: {
      ...requests.summarize.input,
    },
  };
}

const providerContractFixtures: readonly ProviderContractFixture[] = [
  {
    provider: "openai",
    supportedOperations: LLM_PROVIDER_OPERATIONS,
    createProvider(fetchImplementation) {
      return new OpenAIProvider({
        apiKey: "sk-test",
        fetch: fetchImplementation,
      });
    },
    createSuccessFetch() {
      const embeddingVector = Array.from(
        { length: OPENAI_EMBEDDING_DIMENSIONS },
        (_, index) => Number((index / OPENAI_EMBEDDING_DIMENSIONS).toFixed(6)),
      );

      return async (input, init) => {
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
          return openAIJsonResponse({
            model: OPENAI_EMBEDDING_MODEL,
            data: [
              {
                embedding: embeddingVector,
              },
            ],
          });
        }

        if (url === `${OPENAI_API_BASE_URL}/audio/transcriptions`) {
          return openAIJsonResponse({
            text: "  Voice transcript about linking scattered notes into one capture inbox.  ",
          });
        }

        if (url !== `${OPENAI_API_BASE_URL}/chat/completions`) {
          throw new Error(`Unexpected fetch to ${url}`);
        }

        const body = JSON.parse(String(init?.body)) as {
          messages?: Array<{
            role?: string;
            content?: unknown;
          }>;
          model?: string;
        };
        const systemInstruction = body.messages?.[0];

        if (
          systemInstruction?.role !== "system" ||
          typeof systemInstruction.content !== "string"
        ) {
          throw new Error(
            `Unhandled OpenAI request without system instruction: ${JSON.stringify(body)}`,
          );
        }

        if (systemInstruction.content.includes("Summarize the content")) {
          return openAIJsonResponse({
            model: body.model,
            choices: [
              {
                message: {
                  content:
                    "  Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Offline queue sync should never drop a note on reconnect.  ",
                },
              },
            ],
          });
        }

        if (systemInstruction.content.includes("Choose exactly one label")) {
          return openAIJsonResponse({
            model: body.model,
            choices: [
              {
                message: {
                  content: "  productivity  ",
                },
              },
            ],
          });
        }

        if (
          systemInstruction.content.includes("reflective follow-up question")
        ) {
          return openAIJsonResponse({
            model: body.model,
            choices: [
              {
                message: {
                  content: "  What pattern keeps showing up across these ideas?  ",
                },
              },
            ],
          });
        }

        if (systemInstruction.content.includes("strongest connection")) {
          return openAIJsonResponse({
            model: body.model,
            choices: [
              {
                message: {
                  content:
                    "  Both notes focus on turning fleeting captures into durable knowledge.  ",
                },
              },
            ],
          });
        }

        if (
          systemInstruction.content.includes("Generate a concise, descriptive title")
        ) {
          return openAIJsonResponse({
            model: body.model,
            choices: [
              {
                message: {
                  content:
                    "  Reliable capture from web, voice, photos, CLI, and AI chats with resilient synthesis. Reliable capture from web, voice, photos, CLI, and AI chats with resilient synthesis.  ",
                },
              },
            ],
          });
        }

        if (systemInstruction.content.includes("Classify the note into JSON")) {
          return openAIJsonResponse({
            model: body.model,
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    tags: [" capture ", "knowledge", "Capture", " ai "],
                    domain: " Technology ",
                    mood: " Curious ",
                    actionability: " Idea ",
                  }),
                },
              },
            ],
          });
        }

        if (
          systemInstruction.content.includes("Describe the image") ||
          systemInstruction.content.includes("Extract any legible text")
        ) {
          return openAIJsonResponse({
            model: body.model,
            choices: [
              {
                message: {
                  content:
                    "  A handwritten sticky note beside a laptop describing a fast capture workflow.  ",
                },
              },
            ],
          });
        }

        throw new Error(`Unhandled OpenAI request: ${JSON.stringify(body)}`);
      };
    },
    expectedSuccessRequestId: "openai_contract_success_req",
    createRateLimitResponse() {
      return openAIJsonResponse(
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
            "x-request-id": "openai_contract_rate_limited_req",
          },
        },
      );
    },
    createTransportError() {
      return Object.assign(new Error("OpenAI backend unavailable."), {
        response: {
          status: 503,
        },
      });
    },
    expectedRateLimitDetails: {
      code: "insufficient_quota",
      retryAfterSeconds: 12,
      type: "rate_limit_error",
    },
    expectedRateLimitMessage: "Rate limit exceeded for this workspace.",
    expectedRateLimitRequestId: "openai_contract_rate_limited_req",
    expectedTransportMessage: "OpenAI backend unavailable.",
  },
  {
    provider: "gemini",
    supportedOperations: GEMINI_PROVIDER_SUPPORTED_OPERATIONS,
    createProvider(fetchImplementation) {
      return new GeminiProvider({
        apiKey: "gemini-test-key",
        fetch: fetchImplementation,
      });
    },
    createSuccessFetch() {
      return async (input, init) => {
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

        if (!url.startsWith(`${GEMINI_API_BASE_URL}/models/`)) {
          throw new Error(`Unexpected fetch to ${url}`);
        }

        const body = JSON.parse(String(init?.body)) as {
          systemInstruction?: {
            parts?: Array<{
              text?: string;
            }>;
          };
        };
        const systemInstruction = body.systemInstruction?.parts?.[0]?.text;

        if (typeof systemInstruction !== "string") {
          throw new Error(
            `Unhandled Gemini request without system instruction: ${JSON.stringify(body)}`,
          );
        }

        if (systemInstruction.includes("Summarize the content")) {
          return geminiJsonResponse({
            modelVersion: "gemini-2.5-flash",
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text:
                        "  Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Offline queue sync should never drop a note on reconnect.  ",
                    },
                  ],
                  role: "model",
                },
                finishReason: "STOP",
              },
            ],
          });
        }

        if (systemInstruction.includes("Choose exactly one label")) {
          return geminiJsonResponse({
            modelVersion: "gemini-2.5-flash",
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: "  productivity  ",
                    },
                  ],
                  role: "model",
                },
              },
            ],
          });
        }

        if (
          systemInstruction.includes("reflective follow-up question")
        ) {
          return geminiJsonResponse({
            modelVersion: "gemini-2.5-flash",
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: "  What pattern keeps showing up across these ideas?  ",
                    },
                  ],
                  role: "model",
                },
              },
            ],
          });
        }

        if (systemInstruction.includes("strongest connection")) {
          return geminiJsonResponse({
            modelVersion: "gemini-2.5-flash",
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text:
                        "  Both notes focus on turning fleeting captures into durable knowledge.  ",
                    },
                  ],
                  role: "model",
                },
              },
            ],
          });
        }

        if (
          systemInstruction.includes("Generate a concise, descriptive title")
        ) {
          return geminiJsonResponse({
            modelVersion: "gemini-2.5-flash",
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text:
                        "  Reliable capture from web, voice, photos, CLI, and AI chats with resilient synthesis. Reliable capture from web, voice, photos, CLI, and AI chats with resilient synthesis.  ",
                    },
                  ],
                  role: "model",
                },
              },
            ],
          });
        }

        if (systemInstruction.includes("Classify the note into JSON")) {
          return geminiJsonResponse({
            modelVersion: "gemini-2.5-flash",
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
          return geminiJsonResponse({
            modelVersion: "gemini-2.0-flash-exp",
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: "  Voice transcript about linking scattered notes into one capture inbox.  ",
                    },
                  ],
                  role: "model",
                },
              },
            ],
          });
        }

        if (
          systemInstruction.includes("Describe the image") ||
          systemInstruction.includes("Extract any legible text")
        ) {
          return geminiJsonResponse({
            modelVersion: "gemini-2.5-flash",
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text:
                        "  A handwritten sticky note beside a laptop describing a fast capture workflow.  ",
                    },
                  ],
                  role: "model",
                },
              },
            ],
          });
        }

        throw new Error(`Unhandled Gemini request: ${JSON.stringify(body)}`);
      };
    },
    expectedSuccessRequestId: "gemini_contract_success_req",
    createRateLimitResponse() {
      return geminiJsonResponse(
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
            "x-goog-request-id": "gemini_contract_rate_limited_req",
          },
        },
      );
    },
    createTransportError() {
      return Object.assign(new Error("Gemini backend unavailable."), {
        response: {
          status: 503,
        },
      });
    },
    expectedRateLimitDetails: {
      retryAfterSeconds: 15,
      status: "resource_exhausted",
    },
    expectedRateLimitMessage: "Quota exhausted for this workspace.",
    expectedRateLimitRequestId: "gemini_contract_rate_limited_req",
    expectedTransportMessage: "Gemini backend unavailable.",
  },
];

const sharedContractOverlongSummary =
  "  Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Capture first, cluster later, and keep every draft durable through retries. Offline queue sync should never drop a note on reconnect.  ";
const sharedContractOverlongTitle =
  "  Reliable capture from web, voice, photos, CLI, and AI chats with resilient synthesis. Reliable capture from web, voice, photos, CLI, and AI chats with resilient synthesis.  ";
const sharedContractExpectedSummary = clampNormalizedText(
  sharedContractOverlongSummary,
  requests.summarize.input.maxCharacters ?? 280,
);
const sharedContractExpectedTitle = clampNormalizedText(
  sharedContractOverlongTitle,
  requests.generateTitle.input.maxCharacters ?? 80,
);
const sharedContractExpectedMetadata = {
  tags: ["capture", "knowledge", "ai"],
  domain: "technology",
  mood: "curious",
  actionability: "idea",
} as const;

function getRequestForOperation(operation: (typeof LLM_PROVIDER_OPERATIONS)[number]) {
  switch (operation) {
    case "generateEmbedding":
      return requests.generateEmbedding;
    case "classify":
      return requests.classify;
    case "summarize":
      return requests.summarize;
    case "generateReflection":
      return requests.generateReflection;
    case "explainConnection":
      return requests.explainConnection;
    case "generateTitle":
      return requests.generateTitle;
    case "classifyMetadata":
      return requests.classifyMetadata;
    case "transcribeAudio":
      return requests.transcribeAudio;
    case "describeImage":
      return requests.describeImage;
  }
}

async function invokeProviderOperation(
  provider: LLMProvider,
  operation: (typeof LLM_PROVIDER_OPERATIONS)[number],
) {
  switch (operation) {
    case "generateEmbedding":
      return provider.generateEmbedding(requests.generateEmbedding);
    case "classify":
      return provider.classify(requests.classify);
    case "summarize":
      return provider.summarize(requests.summarize);
    case "generateReflection":
      return provider.generateReflection(requests.generateReflection);
    case "explainConnection":
      return provider.explainConnection(requests.explainConnection);
    case "generateTitle":
      return provider.generateTitle(requests.generateTitle);
    case "classifyMetadata":
      return provider.classifyMetadata(requests.classifyMetadata);
    case "transcribeAudio":
      return provider.transcribeAudio(requests.transcribeAudio);
    case "describeImage":
      return provider.describeImage(requests.describeImage);
  }
}

function assertSharedOperationContract(args: {
  fixture: ProviderContractFixture;
  operation: (typeof LLM_PROVIDER_OPERATIONS)[number];
  response: Awaited<ReturnType<typeof invokeProviderOperation>>;
}): void {
  const { fixture, operation, response } = args;

  switch (operation) {
    case "generateEmbedding": {
      assertEmbeddingResponse({
        response: response as Awaited<ReturnType<LLMProvider["generateEmbedding"]>>,
        request: requests.generateEmbedding,
        expectedProvider: fixture.provider,
        expectedRequestId: fixture.expectedSuccessRequestId,
        expectedDimensions: OPENAI_EMBEDDING_DIMENSIONS,
      });
      break;
    }
    case "classify": {
      const classification =
        response as Awaited<ReturnType<LLMProvider["classify"]>>;
      assertSingleStringOutputResponse({
        response: classification,
        request: requests.classify,
        expectedProvider: fixture.provider,
        expectedRequestId: fixture.expectedSuccessRequestId,
        outputKey: "classification",
      });
      assert.equal(classification.output.classification, "productivity");
      break;
    }
    case "summarize": {
      const summary = response as Awaited<ReturnType<LLMProvider["summarize"]>>;
      assertSingleStringOutputResponse({
        response: summary,
        request: requests.summarize,
        expectedProvider: fixture.provider,
        expectedRequestId: fixture.expectedSuccessRequestId,
        outputKey: "summary",
      });
      assert.equal(summary.output.summary, sharedContractExpectedSummary);
      assert.equal(
        summary.output.summary.length <=
          (requests.summarize.input.maxCharacters ?? 280),
        true,
      );
      break;
    }
    case "generateReflection": {
      const reflection =
        response as Awaited<ReturnType<LLMProvider["generateReflection"]>>;
      assertSingleStringOutputResponse({
        response: reflection,
        request: requests.generateReflection,
        expectedProvider: fixture.provider,
        expectedRequestId: fixture.expectedSuccessRequestId,
        outputKey: "reflectionPrompt",
      });
      assert.equal(
        reflection.output.reflectionPrompt,
        'What tradeoff in "group inspiration by latent themes instead of source" needs the clearest decision next?',
      );
      break;
    }
    case "explainConnection": {
      const connection =
        response as Awaited<ReturnType<LLMProvider["explainConnection"]>>;
      assertSingleStringOutputResponse({
        response: connection,
        request: requests.explainConnection,
        expectedProvider: fixture.provider,
        expectedRequestId: fixture.expectedSuccessRequestId,
        outputKey: "explanation",
      });
      assert.equal(
        connection.output.explanation,
        "Both notes focus on turning fleeting captures into durable knowledge.",
      );
      break;
    }
    case "generateTitle": {
      const title =
        response as Awaited<ReturnType<LLMProvider["generateTitle"]>>;
      assertSingleStringOutputResponse({
        response: title,
        request: requests.generateTitle,
        expectedProvider: fixture.provider,
        expectedRequestId: fixture.expectedSuccessRequestId,
        outputKey: "title",
      });
      assert.equal(title.output.title, sharedContractExpectedTitle);
      assert.equal(
        title.output.title.length <=
          (requests.generateTitle.input.maxCharacters ?? 80),
        true,
      );
      break;
    }
    case "classifyMetadata": {
      const metadata =
        response as Awaited<ReturnType<LLMProvider["classifyMetadata"]>>;
      assertMetadataClassificationResponse({
        response: metadata,
        request: requests.classifyMetadata,
        expectedProvider: fixture.provider,
        expectedRequestId: fixture.expectedSuccessRequestId,
      });
      assert.deepEqual(metadata.output, sharedContractExpectedMetadata);
      break;
    }
    case "transcribeAudio": {
      const transcription =
        response as Awaited<ReturnType<LLMProvider["transcribeAudio"]>>;
      assertSingleStringOutputResponse({
        response: transcription,
        request: requests.transcribeAudio,
        expectedProvider: fixture.provider,
        expectedRequestId: fixture.expectedSuccessRequestId,
        outputKey: "transcript",
      });
      assert.equal(
        transcription.output.transcript,
        "Voice transcript about linking scattered notes into one capture inbox.",
      );
      break;
    }
    case "describeImage": {
      const description =
        response as Awaited<ReturnType<LLMProvider["describeImage"]>>;
      assertSingleStringOutputResponse({
        response: description,
        request: requests.describeImage,
        expectedProvider: fixture.provider,
        expectedRequestId: fixture.expectedSuccessRequestId,
        outputKey: "description",
      });
      assert.equal(
        description.output.description,
        "A handwritten sticky note beside a laptop describing a fast capture workflow.",
      );
      break;
    }
  }
}

const providerContract: LLMProvider = {
  provider: "openai",
  supportedOperations: LLM_PROVIDER_OPERATIONS,
  async generateEmbedding(request) {
    return createProviderResponseFixture({
      provider: "openai",
      request,
      model: "text-embedding-3-small",
      output: {
        embedding: [0.12, 0.44, 0.91],
        dimensions: 3,
      },
    });
  },
  async classify(request) {
    return createProviderResponseFixture({
      provider: "openai",
      request,
      model: "gpt-5-mini",
      output: {
        classification: request.input.labels?.[0] ?? "general",
      },
    });
  },
  async summarize(request) {
    return createProviderResponseFixture({
      provider: "openai",
      request,
      model: "gpt-5-mini",
      output: {
        summary:
          "Keep capture fast by moving enrichment work off the request path.",
      },
      usage: {
        inputTokens: 18,
        outputTokens: 12,
        totalTokens: 30,
      },
    });
  },
  async generateReflection(request) {
    return createProviderResponseFixture({
      provider: "openai",
      request,
      model: "gpt-5-mini",
      output: {
        reflectionPrompt: `What specifically sparked this thought: ${request.input.content}`,
      },
    });
  },
  async explainConnection(request) {
    return createProviderResponseFixture({
      provider: "openai",
      request,
      model: "gpt-5-mini",
      output: {
        explanation: `${request.input.sourceContent} connects to ${request.input.targetContent}.`,
      },
    });
  },
  async generateTitle(request) {
    return createProviderResponseFixture({
      provider: "openai",
      request,
      model: "gpt-5-mini",
      output: {
        title: request.input.content.slice(0, 40),
      },
    });
  },
  async classifyMetadata(request) {
    return createProviderResponseFixture({
      provider: "gemini",
      request,
      model: "gemini-2.5-flash",
      output: {
        tags: ["knowledge", "ai", "capture"],
        domain: "technology",
        mood: "excited",
        actionability: "idea",
      },
    });
  },
  async transcribeAudio(request) {
    return createProviderResponseFixture({
      provider: "openai",
      request,
      model: "gpt-4o-mini-transcribe",
      output: {
        transcript: `Transcript for ${request.input.audio.mediaUrl}`,
      },
    });
  },
  async describeImage(request) {
    return createProviderResponseFixture({
      provider: "openai",
      request,
      model: "gpt-4.1-mini",
      output: {
        description: `Description for ${request.input.imageUrl}`,
      },
    });
  },
};

test("shared provider module exposes the normalized provider and operation registries", () => {
  assert.deepEqual(LLM_PROVIDER_NAMES, ["openai", "gemini"]);
  assert.deepEqual(LLM_PROVIDER_OPERATIONS, [
    "generateEmbedding",
    "classify",
    "summarize",
    "generateReflection",
    "explainConnection",
    "generateTitle",
    "classifyMetadata",
    "transcribeAudio",
    "describeImage",
  ]);
  assert.deepEqual(LLM_PROVIDER_ERROR_CODES, [
    "AUTHENTICATION",
    "BAD_REQUEST",
    "INVALID_RESPONSE",
    "RATE_LIMITED",
    "TIMEOUT",
    "UNAVAILABLE",
    "UNSUPPORTED_OPERATION",
    "UNKNOWN",
  ]);
  assert.deepEqual(METADATA_CLASSIFICATION_DOMAINS, [
    "technology",
    "philosophy",
    "personal",
    "work",
    "design",
    "science",
    "business",
    "health",
    "education",
    "relationships",
    "creativity",
    "society",
    "other",
  ]);
  assert.deepEqual(METADATA_CLASSIFICATION_MOODS, [
    "curious",
    "excited",
    "frustrated",
    "reflective",
    "inspired",
    "uncertain",
    "urgent",
    "neutral",
  ]);
  assert.deepEqual(METADATA_CLASSIFICATION_ACTIONABILITY, [
    "idea",
    "observation",
    "question",
    "decision",
    "reference",
  ]);
});

test("provider error normalizes retry, tracing, and provider metadata", () => {
  const error = new LLMProviderError({
    code: "RATE_LIMITED",
    provider: "gemini",
    operation: "summarize",
    message: "Rate limit exceeded",
    retryable: true,
    requestId: "req_retry_1",
    traceId: "trace_retry_1",
    statusCode: 429,
    details: {
      retryAfterSeconds: 8,
    },
  });

  assert.equal(error.name, "LLMProviderError");
  assert.equal(error.code, "RATE_LIMITED");
  assert.equal(error.provider, "gemini");
  assert.equal(error.operation, "summarize");
  assert.equal(error.retryable, true);
  assert.equal(error.requestId, "req_retry_1");
  assert.equal(error.traceId, "trace_retry_1");
  assert.equal(error.statusCode, 429);
  assert.deepEqual(error.details, {
    retryAfterSeconds: 8,
  });
  assert.equal(isLLMProviderError(error), true);
  assert.equal(isLLMProviderError(new Error("plain error")), false);
});

test("provider interface accepts normalized request objects and returns normalized responses", async () => {
  const embedding = await providerContract.generateEmbedding(
    requests.generateEmbedding,
  );
  const summary = await providerContract.summarize(requests.summarize);
  const metadata = await providerContract.classifyMetadata(
    requests.classifyMetadata,
  );

  assertProviderContractSurface(providerContract, LLM_PROVIDER_OPERATIONS);
  assertEmbeddingResponse({
    response: embedding,
    request: requests.generateEmbedding,
    expectedProvider: "openai",
    expectedDimensions: 3,
  });
  assertSingleStringOutputResponse({
    response: summary,
    request: requests.summarize,
    expectedProvider: "openai",
    outputKey: "summary",
  });
  assertMetadataClassificationResponse({
    response: metadata,
    request: requests.classifyMetadata,
    expectedProvider: "gemini",
  });
  assert.deepEqual(metadata.output.tags, ["knowledge", "ai", "capture"]);
});

test("shared provider contract suite registers every concrete provider implementation", () => {
  assertRegisteredProviderContractCoverage(providerContractFixtures);
});

for (const fixture of providerContractFixtures.filter(
  (providerContractFixture) => providerContractFixture.provider !== "openai",
)) {
  test(`shared provider contract suite runs against the ${fixture.provider} adapter`, async () => {
    const provider = fixture.createProvider(fixture.createSuccessFetch());

    assertProviderContractSurface(provider, fixture.supportedOperations);

    for (const operation of fixture.supportedOperations) {
      const response = await invokeProviderOperation(provider, operation);
      assertSharedOperationContract({
        fixture,
        operation,
        response,
      });
    }

    const unsupportedOperations = LLM_PROVIDER_OPERATIONS.filter(
      (operation) => !fixture.supportedOperations.includes(operation),
    );

    for (const operation of unsupportedOperations) {
      const request = getRequestForOperation(operation);

      await assert.rejects(
        invokeProviderOperation(provider, operation),
        (error: unknown) => {
          const providerError = assertProviderErrorContract({
            error,
            expectedCode: "UNSUPPORTED_OPERATION",
            expectedOperation: operation,
            expectedProvider: fixture.provider,
            expectedRequestId: request.requestId,
            expectedRetryable: false,
            expectedTraceId: request.traceId,
          });

          assert.equal(
            providerError.message.includes("Embeddings stay pinned to OpenAI"),
            operation === "generateEmbedding",
          );

          return true;
        },
      );
    }
  });
}

test("OpenAI success payloads satisfy the normalized provider output contract", async () => {
  const overlongSummary = `  ${"Capture instantly, then enrich asynchronously so nothing gets lost. ".repeat(6)}\nQueue retries should preserve every draft until the API accepts it.  `;
  const overlongTitle = `  ${"Instant capture for every fleeting idea across web, voice, photos, links, and AI chats. ".repeat(2)}  `;
  const expectedSummary = clampNormalizedText(
    overlongSummary,
    requests.summarize.input.maxCharacters ?? 280,
  );
  const expectedTitle = clampNormalizedText(
    overlongTitle,
    requests.generateTitle.input.maxCharacters ?? 80,
  );
  const embeddingVector = Array.from(
    { length: OPENAI_EMBEDDING_DIMENSIONS },
    (_, index) => Number((index / OPENAI_EMBEDDING_DIMENSIONS).toFixed(6)),
  );

  const provider: LLMProvider = new OpenAIProvider({
    apiKey: "sk-test",
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
        return openAIJsonResponse({
          model: OPENAI_EMBEDDING_MODEL,
          data: [
            {
              embedding: embeddingVector,
            },
          ],
        });
      }

      if (url !== `${OPENAI_API_BASE_URL}/chat/completions`) {
        if (url === `${OPENAI_API_BASE_URL}/audio/transcriptions`) {
          return openAIJsonResponse({
            text: "  Voice transcript about linking scattered notes into one capture inbox.  ",
          });
        }

        throw new Error(`Unexpected fetch to ${url}`);
      }

      const body = JSON.parse(String(init?.body)) as {
        messages?: Array<{
          role?: string;
          content?: unknown;
        }>;
        model?: string;
      };
      const systemInstruction = body.messages?.[0];

      if (
        systemInstruction?.role !== "system" ||
        typeof systemInstruction.content !== "string"
      ) {
        throw new Error(
          `Unhandled OpenAI request without system instruction: ${JSON.stringify(body)}`,
        );
      }

      if (systemInstruction.content.includes("Summarize the content")) {
        return openAIJsonResponse({
          model: body.model,
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: overlongSummary,
                },
              ],
            },
          ],
        });
      }

      if (systemInstruction.content.includes("Choose exactly one label")) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content: "  productivity  ",
              },
            },
          ],
        });
      }

      if (
        systemInstruction.content.includes("reflective follow-up question")
      ) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content: "  What connection should Waka resurface next?  ",
              },
            },
          ],
        });
      }

      if (systemInstruction.content.includes("strongest connection")) {
        return openAIJsonResponse({
          model: body.model,
          status: "completed",
          output: [
            {
              type: "message",
              role: "user",
              content: [
                {
                  type: "output_text",
                  text: "Ignore this user echo.",
                },
              ],
            },
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: "  Both notes describe the same capture-to-synthesis loop.  ",
                },
              ],
            },
          ],
        });
      }

      if (
        systemInstruction.content.includes("Generate a concise, descriptive title")
      ) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content: overlongTitle,
              },
            },
          ],
        });
      }

      if (systemInstruction.content.includes("Classify the note into JSON")) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content: JSON.stringify({
                  tags: [" AI ", "capture", "Capture", " design "],
                  domain: " Technology ",
                  mood: " Inspired ",
                  actionability: " Idea ",
                }),
              },
            },
          ],
        });
      }

      if (
        systemInstruction.content.includes("Describe the image") ||
        systemInstruction.content.includes("Extract any legible text")
      ) {
        return openAIJsonResponse({
          model: body.model,
          choices: [
            {
              message: {
                content:
                  "  A handwritten sticky note beside a laptop describing a fast capture workflow.  ",
              },
            },
          ],
        });
      }

      throw new Error(`Unhandled OpenAI request: ${JSON.stringify(body)}`);
    },
  });

  const embedding = await provider.generateEmbedding(requests.generateEmbedding);
  const classification = await provider.classify(requests.classify);
  const summary = await provider.summarize(requests.summarize);
  const reflection = await provider.generateReflection(
    requests.generateReflection,
  );
  const connection = await provider.explainConnection(requests.explainConnection);
  const title = await provider.generateTitle(requests.generateTitle);
  const metadata = await provider.classifyMetadata(requests.classifyMetadata);
  const transcription = await provider.transcribeAudio(requests.transcribeAudio);
  const description = await provider.describeImage(requests.describeImage);

  assertProviderContractSurface(provider, LLM_PROVIDER_OPERATIONS);
  assertEmbeddingResponse({
    response: embedding,
    request: requests.generateEmbedding,
    expectedProvider: "openai",
    expectedRequestId: "openai_contract_success_req",
    expectedDimensions: OPENAI_EMBEDDING_DIMENSIONS,
  });
  assertSingleStringOutputResponse({
    response: classification,
    request: requests.classify,
    expectedProvider: "openai",
    expectedRequestId: "openai_contract_success_req",
    outputKey: "classification",
  });
  assertSingleStringOutputResponse({
    response: summary,
    request: requests.summarize,
    expectedProvider: "openai",
    expectedRequestId: "openai_contract_success_req",
    outputKey: "summary",
  });
  assertSingleStringOutputResponse({
    response: reflection,
    request: requests.generateReflection,
    expectedProvider: "openai",
    expectedRequestId: "openai_contract_success_req",
    outputKey: "reflectionPrompt",
  });
  assertSingleStringOutputResponse({
    response: connection,
    request: requests.explainConnection,
    expectedProvider: "openai",
    expectedRequestId: "openai_contract_success_req",
    outputKey: "explanation",
  });
  assertSingleStringOutputResponse({
    response: title,
    request: requests.generateTitle,
    expectedProvider: "openai",
    expectedRequestId: "openai_contract_success_req",
    outputKey: "title",
  });
  assertMetadataClassificationResponse({
    response: metadata,
    request: requests.classifyMetadata,
    expectedProvider: "openai",
    expectedRequestId: "openai_contract_success_req",
  });
  assertSingleStringOutputResponse({
    response: transcription,
    request: requests.transcribeAudio,
    expectedProvider: "openai",
    expectedRequestId: "openai_contract_success_req",
    outputKey: "transcript",
  });
  assertSingleStringOutputResponse({
    response: description,
    request: requests.describeImage,
    expectedProvider: "openai",
    expectedRequestId: "openai_contract_success_req",
    outputKey: "description",
  });

  assert.equal(classification.output.classification, "productivity");
  assert.equal(summary.output.summary, expectedSummary);
  assert.equal(
    summary.output.summary.length <=
      (requests.summarize.input.maxCharacters ?? 280),
    true,
  );
  assert.equal(summary.output.summary, summary.output.summary.trim());
  assert.equal(
    reflection.output.reflectionPrompt,
    'What tradeoff in "group inspiration by latent themes instead of source" needs the clearest decision next?',
  );
  assertGroundedReflectionPrompt({
    prompt: reflection.output.reflectionPrompt,
    content: requests.generateReflection.input.content,
    groundingContext: requests.generateReflection.input.groundingContext,
  });
  assert.equal(reflection.output.reflectionPrompt.endsWith("?"), true);
  assert.equal(
    connection.output.explanation,
    "Both notes describe the same capture-to-synthesis loop.",
  );
  assert.equal(title.output.title, expectedTitle);
  assert.equal(
    title.output.title.length <=
      (requests.generateTitle.input.maxCharacters ?? 80),
    true,
  );
  assert.deepEqual(metadata.output, {
    tags: ["ai", "capture", "design"],
    domain: "technology",
    mood: "inspired",
    actionability: "idea",
  });
  assert.equal(
    transcription.output.transcript,
    "Voice transcript about linking scattered notes into one capture inbox.",
  );
  assert.equal(
    description.output.description,
    "A handwritten sticky note beside a laptop describing a fast capture workflow.",
  );
});

test("Gemini success payloads satisfy the normalized provider output contract", async () => {
  const overlongSummary = `  ${"Capture first, cluster later, and keep every draft durable through retries. ".repeat(5)}\nOffline queue sync should never drop a note on reconnect.  `;
  const overlongTitle = `  ${"Reliable capture from web, voice, photos, CLI, and AI chats with resilient synthesis. ".repeat(2)}  `;
  const expectedSummary = clampNormalizedText(
    overlongSummary,
    requests.summarize.input.maxCharacters ?? 280,
  );
  const expectedTitle = clampNormalizedText(
    overlongTitle,
    requests.generateTitle.input.maxCharacters ?? 80,
  );

  const provider: LLMProvider = new GeminiProvider({
    apiKey: "gemini-test-key",
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

      if (!url.startsWith(`${GEMINI_API_BASE_URL}/models/`)) {
        throw new Error(`Unexpected fetch to ${url}`);
      }

      const body = JSON.parse(String(init?.body)) as {
        systemInstruction?: {
          parts?: Array<{
            text?: string;
          }>;
        };
      };
      const systemInstruction = body.systemInstruction?.parts?.[0]?.text;

      if (typeof systemInstruction !== "string") {
        throw new Error(
          `Unhandled Gemini request without system instruction: ${JSON.stringify(body)}`,
        );
      }

      if (systemInstruction.includes("Summarize the content")) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: overlongSummary,
                  },
                ],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
        });
      }

      if (systemInstruction.includes("Choose exactly one label")) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "  productivity  ",
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      if (
        systemInstruction.includes("reflective follow-up question")
      ) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "  What new pattern should Waka ask about next?  ",
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      if (systemInstruction.includes("strongest connection")) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "  Both notes turn fleeting captures into durable knowledge.  ",
                  },
                ],
                role: "model",
              },
              finishReason: "STOP",
            },
          ],
        });
      }

      if (
        systemInstruction.includes("Generate a concise, descriptive title")
      ) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: overlongTitle,
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      if (systemInstruction.includes("Classify the note into JSON")) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
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
        return geminiJsonResponse({
          modelVersion: "gemini-2.0-flash-exp",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: "  Voice transcript about linking scattered notes into one capture inbox.  ",
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      if (
        systemInstruction.includes("Describe the image") ||
        systemInstruction.includes("Extract any legible text")
      ) {
        return geminiJsonResponse({
          modelVersion: "gemini-2.5-flash",
          candidates: [
            {
              content: {
                parts: [
                  {
                    text:
                      "  A handwritten sticky note beside a laptop describing a fast capture workflow.  ",
                  },
                ],
                role: "model",
              },
            },
          ],
        });
      }

      throw new Error(`Unhandled Gemini request: ${JSON.stringify(body)}`);
    },
  });

  const classification = await provider.classify(requests.classify);
  const summary = await provider.summarize(requests.summarize);
  const reflection = await provider.generateReflection(
    requests.generateReflection,
  );
  const connection = await provider.explainConnection(requests.explainConnection);
  const title = await provider.generateTitle(requests.generateTitle);
  const metadata = await provider.classifyMetadata(requests.classifyMetadata);
  const transcription = await provider.transcribeAudio(requests.transcribeAudio);
  const description = await provider.describeImage(requests.describeImage);

  assertProviderContractSurface(provider, GEMINI_PROVIDER_SUPPORTED_OPERATIONS);
  assertSingleStringOutputResponse({
    response: classification,
    request: requests.classify,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_contract_success_req",
    outputKey: "classification",
  });
  assertSingleStringOutputResponse({
    response: summary,
    request: requests.summarize,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_contract_success_req",
    outputKey: "summary",
  });
  assertSingleStringOutputResponse({
    response: reflection,
    request: requests.generateReflection,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_contract_success_req",
    outputKey: "reflectionPrompt",
  });
  assertSingleStringOutputResponse({
    response: connection,
    request: requests.explainConnection,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_contract_success_req",
    outputKey: "explanation",
  });
  assertSingleStringOutputResponse({
    response: title,
    request: requests.generateTitle,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_contract_success_req",
    outputKey: "title",
  });
  assertMetadataClassificationResponse({
    response: metadata,
    request: requests.classifyMetadata,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_contract_success_req",
  });
  assertSingleStringOutputResponse({
    response: transcription,
    request: requests.transcribeAudio,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_contract_success_req",
    outputKey: "transcript",
  });
  assertSingleStringOutputResponse({
    response: description,
    request: requests.describeImage,
    expectedProvider: "gemini",
    expectedRequestId: "gemini_contract_success_req",
    outputKey: "description",
  });

  assert.equal(classification.output.classification, "productivity");
  assert.equal(summary.finishReason, "stop");
  assert.equal(summary.output.summary, expectedSummary);
  assert.equal(
    summary.output.summary.length <=
      (requests.summarize.input.maxCharacters ?? 280),
    true,
  );
  assert.equal(
    reflection.output.reflectionPrompt,
    'What tradeoff in "group inspiration by latent themes instead of source" needs the clearest decision next?',
  );
  assertGroundedReflectionPrompt({
    prompt: reflection.output.reflectionPrompt,
    content: requests.generateReflection.input.content,
    groundingContext: requests.generateReflection.input.groundingContext,
  });
  assert.equal(reflection.output.reflectionPrompt.endsWith("?"), true);
  assert.equal(
    connection.output.explanation,
    "Both notes turn fleeting captures into durable knowledge.",
  );
  assert.equal(title.output.title, expectedTitle);
  assert.equal(
    title.output.title.length <=
      (requests.generateTitle.input.maxCharacters ?? 80),
    true,
  );
  assert.deepEqual(metadata.output, {
    tags: ["capture", "knowledge", "ai"],
    domain: "technology",
    mood: "curious",
    actionability: "idea",
  });
  assert.equal(
    transcription.output.transcript,
    "Voice transcript about linking scattered notes into one capture inbox.",
  );
  assert.equal(
    description.output.description,
    "A handwritten sticky note beside a laptop describing a fast capture workflow.",
  );
});

for (const fixture of providerContractFixtures) {
  test(`${fixture.provider} rejects validation failures through the shared provider error contract`, async () => {
    let fetchCalls = 0;
    const request = createFailurePathSummarizeRequest(
      fixture.provider,
      "validation",
    );
    const provider = fixture.createProvider(async () => {
      fetchCalls += 1;
      throw new Error("fetch should not be called for validation failures");
    });

    await assert.rejects(
      provider.summarize({
        ...request,
        input: {
          ...request.input,
          model: "vision" as never,
        },
      }),
      (error: unknown) => {
        const providerError = assertProviderErrorContract({
          error,
          expectedCode: "BAD_REQUEST",
          expectedOperation: "summarize",
          expectedProvider: fixture.provider,
          expectedRequestId: request.requestId,
          expectedRetryable: false,
          expectedTraceId: request.traceId,
          expectedStatusCode: undefined,
          expectedMessageIncludes: '"vision"',
        });
        const details = providerError.details as
          | Record<string, unknown>
          | undefined;

        assert.equal(details?.requestedModel, "vision");
        assert.equal(Array.isArray(details?.supportedModels), true);

        return true;
      },
    );

    assert.equal(fetchCalls, 0);
  });

  test(`${fixture.provider} maps provider API failures to the shared provider error contract`, async () => {
    const request = createFailurePathSummarizeRequest(
      fixture.provider,
      "provider_api",
    );
    const provider = fixture.createProvider(
      async () => fixture.createRateLimitResponse(),
    );

    await assert.rejects(
      provider.summarize(request),
      (error: unknown) => {
        const providerError = assertProviderErrorContract({
          error,
          expectedCode: "RATE_LIMITED",
          expectedOperation: "summarize",
          expectedProvider: fixture.provider,
          expectedRequestId: fixture.expectedRateLimitRequestId,
          expectedRetryable: true,
          expectedTraceId: request.traceId,
          expectedStatusCode: 429,
          expectedMessageIncludes: fixture.expectedRateLimitMessage,
        });

        assert.deepEqual(providerError.details, fixture.expectedRateLimitDetails);
        assert.notEqual(providerError.requestId, request.requestId);

        return true;
      },
    );
  });

  test(`${fixture.provider} maps transport failures to the shared provider error contract`, async () => {
    const request = createFailurePathSummarizeRequest(
      fixture.provider,
      "transport",
    );
    const provider = fixture.createProvider(async () => {
      throw fixture.createTransportError();
    });

    await assert.rejects(
      provider.summarize(request),
      (error: unknown) => {
        const providerError = assertProviderErrorContract({
          error,
          expectedCode: "UNAVAILABLE",
          expectedOperation: "summarize",
          expectedProvider: fixture.provider,
          expectedRequestId: request.requestId,
          expectedRetryable: true,
          expectedTraceId: request.traceId,
          expectedStatusCode: 503,
          expectedMessageIncludes: fixture.expectedTransportMessage,
        });

        assert.equal(providerError.cause instanceof Error, true);
        assert.equal(providerError.requestId, request.requestId);

        return true;
      },
    );
  });
}
