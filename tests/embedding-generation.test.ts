import assert from "node:assert/strict";
import test from "node:test";

import {
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL,
  createNonEmbeddingClientFromEnv,
  createNonEmbeddingProviderFromEnv,
  createEmbeddingClientFromEnv,
  executeNonEmbeddingRequestFromEnv,
  resolveEmbeddingProviderName,
  resolveLLMRuntimeConfig,
  resolveLLMProviderName,
} from "../packages/shared/llm/runtime.ts";
import { isLLMProviderError } from "../packages/shared/llm/provider.ts";
import {
  createLLMProviderSelectionFixture,
  createTrackedNonEmbeddingClient,
} from "./helpers/llm-provider-selection-fixture.ts";

function createJsonResponse(
  status: number,
  payload: unknown,
  headers?: Record<string, string>,
) {
  return {
    headers,
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

async function assertSummarizationRoutesToProvider(
  provider: "openai" | "gemini",
) {
  const fixture = createLLMProviderSelectionFixture();
  const otherProvider = provider === "openai" ? "gemini" : "openai";

  const summary = await fixture.withProvider(provider, async () =>
    executeNonEmbeddingRequestFromEnv(process.env, fixture.clients, {
      operation: "summarize",
      requestId: `req_summary_${provider}`,
      traceId: `trace_summary_${provider}`,
      input: {
        content: `Route summarization through the ${provider} adapter.`,
        model: "text",
      },
    }),
  );

  assert.equal(resolveLLMProviderName({ LLM_PROVIDER: provider }), provider);
  assert.equal(summary.provider, provider);
  assert.equal(
    summary.model,
    provider === "openai" ? "gpt-5-mini" : "gemini-2.5-flash",
  );
  assert.equal(summary.output.summary, `${provider}:summary`);
  assert.deepEqual(fixture.getInvocationsFor(provider), [
    {
      operation: "summarize",
      provider,
      requestId: `req_summary_${provider}`,
      traceId: `trace_summary_${provider}`,
    },
  ]);
  assert.deepEqual(fixture.getInvocationsFor(otherProvider), []);
}

async function assertMetadataClassificationRoutesToProvider(
  provider: "openai" | "gemini",
) {
  const fixture = createLLMProviderSelectionFixture();
  const otherProvider = provider === "openai" ? "gemini" : "openai";

  const metadata = await fixture.withProvider(provider, async () =>
    executeNonEmbeddingRequestFromEnv(process.env, fixture.clients, {
      operation: "classifyMetadata",
      requestId: `req_metadata_${provider}`,
      traceId: `trace_metadata_${provider}`,
      input: {
        content: `Route metadata classification through the ${provider} adapter.`,
        model: "text",
      },
    }),
  );

  assert.equal(resolveLLMProviderName({ LLM_PROVIDER: provider }), provider);
  assert.equal(metadata.provider, provider);
  assert.equal(
    metadata.model,
    provider === "openai" ? "gpt-5-mini" : "gemini-2.5-flash",
  );
  assert.deepEqual(metadata.output, {
    actionability: "idea",
    domain: "technology",
    mood: "curious",
    tags: [`${provider}:tag`],
  });
  assert.deepEqual(fixture.getInvocationsFor(provider), [
    {
      operation: "classifyMetadata",
      provider,
      requestId: `req_metadata_${provider}`,
      traceId: `trace_metadata_${provider}`,
    },
  ]);
  assert.deepEqual(fixture.getInvocationsFor(otherProvider), []);
}

test("LLM runtime config normalizes the selected non-embedding provider and pins embeddings to OpenAI", () => {
  assert.deepEqual(resolveLLMRuntimeConfig({}), {
    nonEmbeddingProvider: "openai",
    embeddingProvider: "openai",
  });
  assert.deepEqual(resolveLLMRuntimeConfig({ LLM_PROVIDER: " Gemini " }), {
    nonEmbeddingProvider: "gemini",
    embeddingProvider: "openai",
  });
  assert.throws(
    () => resolveLLMRuntimeConfig({ LLM_PROVIDER: "anthropic" }),
    /LLM_PROVIDER must be either "openai" or "gemini"/,
  );
});

test("non-embedding provider factory selects the adapter from normalized LLM_PROVIDER values", () => {
  const openaiProvider = {
    provider: "openai" as const,
  };
  const geminiProvider = {
    provider: "gemini" as const,
  };
  const providers = {
    openai: openaiProvider,
    gemini: geminiProvider,
  };

  assert.equal(createNonEmbeddingProviderFromEnv({}, providers), openaiProvider);
  assert.equal(
    createNonEmbeddingProviderFromEnv({ LLM_PROVIDER: " OPENAI " }, providers),
    openaiProvider,
  );
  assert.equal(
    createNonEmbeddingProviderFromEnv({ LLM_PROVIDER: " Gemini " }, providers),
    geminiProvider,
  );
  assert.equal(
    createNonEmbeddingProviderFromEnv({ LLM_PROVIDER: "GeMiNi" }, providers),
    geminiProvider,
  );
});

test("non-embedding provider factory rejects falling back to OpenAI when Gemini is selected", () => {
  const openaiProvider = {
    provider: "openai" as const,
  };

  assert.throws(
    () =>
      createNonEmbeddingProviderFromEnv(
        { LLM_PROVIDER: " Gemini " },
        {
          openai: openaiProvider,
        },
      ),
    /A gemini provider implementation must be registered for non-embedding LLM tasks/,
  );
});

test("non-embedding client factory returns the normalized env-selected execution surface", () => {
  const openaiClient = createTrackedNonEmbeddingClient("openai");
  const geminiClient = createTrackedNonEmbeddingClient("gemini");
  const clients = {
    openai: openaiClient,
    gemini: geminiClient,
  };

  assert.equal(createNonEmbeddingClientFromEnv({}, clients), openaiClient);
  assert.equal(
    createNonEmbeddingClientFromEnv({ LLM_PROVIDER: " openai " }, clients),
    openaiClient,
  );
  assert.equal(
    createNonEmbeddingClientFromEnv(
      { LLM_PROVIDER: " Gemini " },
      clients,
    ),
    geminiClient,
  );
});

test("summarization requests route through the OpenAI client when LLM_PROVIDER=openai", async () => {
  await assertSummarizationRoutesToProvider("openai");
});

test("summarization requests route through the Gemini client when LLM_PROVIDER=gemini", async () => {
  await assertSummarizationRoutesToProvider("gemini");
});

test("metadata classification requests route through the OpenAI client when LLM_PROVIDER=openai", async () => {
  await assertMetadataClassificationRoutesToProvider("openai");
});

test("metadata classification requests route through the Gemini client when LLM_PROVIDER=gemini", async () => {
  await assertMetadataClassificationRoutesToProvider("gemini");
});

test("non-embedding execution routes every operation through the resolved provider", async () => {
  const fixture = createLLMProviderSelectionFixture();

  const summary = await fixture.withProvider("gemini", async () =>
    executeNonEmbeddingRequestFromEnv(process.env, fixture.clients, {
      operation: "summarize",
      requestId: "req_summary",
      traceId: "trace_summary",
      input: {
        content: "Keep capture instant by moving enrichment off the write path.",
        model: "text",
      },
    }),
  );
  const title = await fixture.withProvider("gemini", async () =>
    executeNonEmbeddingRequestFromEnv(process.env, fixture.clients, {
      operation: "generateTitle",
      requestId: "req_title",
      traceId: "trace_title",
      input: {
        content: "Generate a concise capture title.",
        model: "text",
      },
    }),
  );
  const metadata = await fixture.withProvider("gemini", async () =>
    executeNonEmbeddingRequestFromEnv(process.env, fixture.clients, {
      operation: "classifyMetadata",
      requestId: "req_metadata",
      traceId: "trace_metadata",
      input: {
        content: "An excited idea about durable knowledge.",
        model: "text",
      },
    }),
  );
  const classification = await fixture.withProvider("gemini", async () =>
    executeNonEmbeddingRequestFromEnv(process.env, fixture.clients, {
      operation: "classify",
      requestId: "req_classify",
      traceId: "trace_classify",
      input: {
        prompt: "Classify this inspiration.",
        labels: ["idea", "reference"],
        model: "text",
      },
    }),
  );
  const reflection = await fixture.withProvider("gemini", async () =>
    executeNonEmbeddingRequestFromEnv(process.env, fixture.clients, {
      operation: "generateReflection",
      requestId: "req_reflection",
      traceId: "trace_reflection",
      input: {
        content: "This idea feels important but unfinished.",
        model: "text",
      },
    }),
  );
  const connection = await fixture.withProvider("gemini", async () =>
    executeNonEmbeddingRequestFromEnv(process.env, fixture.clients, {
      operation: "explainConnection",
      requestId: "req_connection",
      traceId: "trace_connection",
      input: {
        sourceContent: "Capture-first product design",
        targetContent: "Reliable offline queues",
        model: "text",
      },
    }),
  );
  const transcription = await fixture.withProvider("openai", async () =>
    executeNonEmbeddingRequestFromEnv(process.env, fixture.clients, {
      operation: "transcribeAudio",
      requestId: "req_transcribe",
      traceId: "trace_transcribe",
      input: {
        audio: {
          mediaUrl: "https://waka.example/audio.wav",
          storageKey: "users/user-embedding/voice-notes/audio.wav",
        },
        model: "transcription",
      },
    }),
  );
  const description = await fixture.withProvider("openai", async () =>
    executeNonEmbeddingRequestFromEnv(process.env, fixture.clients, {
      operation: "describeImage",
      requestId: "req_describe",
      traceId: "trace_describe",
      input: {
        imageUrl: "https://waka.example/photo.jpg",
        model: "vision",
      },
    }),
  );

  assert.equal(summary.provider, "gemini");
  assert.equal(summary.model, "gemini-2.5-flash");
  assert.equal(summary.output.summary, "gemini:summary");
  assert.equal(title.provider, "gemini");
  assert.equal(title.model, "gemini-2.5-flash");
  assert.equal(title.output.title, "gemini:title");
  assert.equal(metadata.provider, "gemini");
  assert.deepEqual(metadata.output.tags, ["gemini:tag"]);
  assert.equal(classification.provider, "gemini");
  assert.equal(classification.output.classification, "gemini:classification");
  assert.equal(reflection.provider, "gemini");
  assert.equal(
    reflection.output.reflectionPrompt,
    "gemini:reflection",
  );
  assert.equal(connection.provider, "gemini");
  assert.equal(connection.output.explanation, "gemini:connection");
  assert.equal(transcription.provider, "openai");
  assert.equal(transcription.model, "gpt-4o-mini-transcribe");
  assert.equal(transcription.output.transcript, "openai:transcript");
  assert.equal(description.provider, "openai");
  assert.equal(description.model, "gpt-4.1-mini");
  assert.equal(description.output.description, "openai:description");
  assert.deepEqual(
    fixture.getInvocationsFor("gemini").map((invocation) => invocation.operation),
    [
      "summarize",
      "generateTitle",
      "classifyMetadata",
      "classify",
      "generateReflection",
      "explainConnection",
    ],
  );
  assert.deepEqual(
    fixture.getInvocationsFor("openai").map((invocation) => invocation.operation),
    ["transcribeAudio", "describeImage"],
  );
  assert.deepEqual(
    fixture.getInvocations().map((invocation) => invocation.provider),
    [
      "gemini",
      "gemini",
      "gemini",
      "gemini",
      "gemini",
      "gemini",
      "openai",
      "openai",
    ],
  );
});

test("embedding generation sends capture content to OpenAI and enforces a 1536-dimension vector", async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const embedding = Array.from(
    { length: OPENAI_EMBEDDING_DIMENSIONS },
    (_, index) => Number((index / OPENAI_EMBEDDING_DIMENSIONS).toFixed(6)),
  );

  const client = createEmbeddingClientFromEnv(
    {
      LLM_PROVIDER: "gemini",
      OPENAI_API_KEY: "sk-openai-test",
      OPENAI_BASE_URL: "https://waka.example/v1/",
    },
    {
      fetch: async (input, init) => {
        requests.push({ input, init });

        return createJsonResponse(200, {
          data: [
            {
              embedding,
              index: 0,
            },
          ],
          model: OPENAI_EMBEDDING_MODEL,
          usage: {
            prompt_tokens: 11,
            total_tokens: 11,
          },
        });
      },
    },
  );

  const response = await client.generateEmbedding({
    operation: "generateEmbedding",
    requestId: "req_embedding_capture",
    traceId: "trace_embedding_capture",
    input: {
      text: "Capture this idea and connect it to older research notes.",
    },
  });

  assert.equal(resolveLLMProviderName({ LLM_PROVIDER: "gemini" }), "gemini");
  assert.equal(resolveEmbeddingProviderName({ LLM_PROVIDER: "gemini" }), "openai");
  assert.equal(response.provider, "openai");
  assert.equal(response.model, OPENAI_EMBEDDING_MODEL);
  assert.equal(response.output.dimensions, OPENAI_EMBEDDING_DIMENSIONS);
  assert.equal(response.output.embedding.length, OPENAI_EMBEDDING_DIMENSIONS);
  assert.equal(response.usage?.inputTokens, 11);
  assert.equal(response.usage?.totalTokens, 11);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "https://waka.example/v1/embeddings");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    input: "Capture this idea and connect it to older research notes.",
    model: OPENAI_EMBEDDING_MODEL,
  });
  assert.deepEqual(requests[0]?.init?.headers, {
    Authorization: "Bearer sk-openai-test",
    "Content-Type": "application/json",
  });
});

test("embedding generation normalizes OpenAI API failures into provider errors", async () => {
  const client = createEmbeddingClientFromEnv(
    {
      OPENAI_API_KEY: "sk-openai-test",
    },
    {
      fetch: async () =>
        createJsonResponse(
          429,
          {
            error: {
              code: "insufficient_quota",
              message: "Embedding capacity exceeded.",
              type: "rate_limit_error",
            },
          },
          {
            "retry-after": "6",
            "x-request-id": "openai_req_embedding_limit",
          },
        ),
    },
  );

  await assert.rejects(
    async () =>
      client.generateEmbedding({
        operation: "generateEmbedding",
        requestId: "req_embedding_rate_limit",
        traceId: "trace_embedding_rate_limit",
        input: {
          text: "Retry this embedding request later.",
        },
      }),
    (error: unknown) => {
      assert.equal(isLLMProviderError(error), true);

      if (!isLLMProviderError(error)) {
        return false;
      }

      assert.equal(error.code, "RATE_LIMITED");
      assert.equal(error.message, "Embedding capacity exceeded.");
      assert.equal(error.retryable, true);
      assert.equal(error.requestId, "openai_req_embedding_limit");
      assert.equal(error.traceId, "trace_embedding_rate_limit");
      assert.equal(error.statusCode, 429);
      assert.deepEqual(error.details, {
        code: "insufficient_quota",
        retryAfterSeconds: 6,
        type: "rate_limit_error",
      });

      return true;
    },
  );
});

test("embedding generation normalizes OpenAI SDK failures into provider errors", async () => {
  const sdkError = Object.assign(new Error("Embedding request timed out."), {
    code: "connection_timeout",
    name: "APIConnectionTimeoutError",
    request_id: "openai_req_embedding_timeout",
    type: "api_connection_timeout_error",
  });

  const client = createEmbeddingClientFromEnv(
    {
      OPENAI_API_KEY: "sk-openai-test",
    },
    {
      fetch: async () => {
        throw sdkError;
      },
    },
  );

  await assert.rejects(
    async () =>
      client.generateEmbedding({
        operation: "generateEmbedding",
        requestId: "req_embedding_sdk_timeout",
        traceId: "trace_embedding_sdk_timeout",
        input: {
          text: "This timeout should be normalized.",
        },
      }),
    (error: unknown) => {
      assert.equal(isLLMProviderError(error), true);

      if (!isLLMProviderError(error)) {
        return false;
      }

      assert.equal(error.code, "TIMEOUT");
      assert.equal(error.message, "Embedding request timed out.");
      assert.equal(error.retryable, true);
      assert.equal(error.requestId, "openai_req_embedding_timeout");
      assert.equal(error.traceId, "trace_embedding_sdk_timeout");
      assert.equal(error.statusCode, undefined);
      assert.deepEqual(error.details, {
        code: "connection_timeout",
        type: "api_connection_timeout_error",
      });

      return true;
    },
  );
});

test("embedding generation rejects vectors that are not 1536 dimensions", async () => {
  const client = createEmbeddingClientFromEnv(
    {
      OPENAI_API_KEY: "sk-openai-test",
    },
    {
      fetch: async () =>
        createJsonResponse(200, {
          data: [
            {
              embedding: [0.1, 0.2, 0.3],
              index: 0,
            },
          ],
          model: OPENAI_EMBEDDING_MODEL,
        }),
    },
  );

  await assert.rejects(
    async () =>
      client.generateEmbedding({
        operation: "generateEmbedding",
        requestId: "req_embedding_bad_dimensions",
        input: {
          text: "Short but valid text.",
        },
      }),
    (error: unknown) => {
      assert.equal(isLLMProviderError(error), true);

      if (!isLLMProviderError(error)) {
        return false;
      }

      assert.equal(error.code, "INVALID_RESPONSE");
      assert.equal(error.provider, "openai");
      assert.match(error.message, /1536 dimensions/);

      return true;
    },
  );
});
