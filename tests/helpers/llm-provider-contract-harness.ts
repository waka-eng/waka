import assert from "node:assert/strict";

import {
  METADATA_CLASSIFICATION_ACTIONABILITY,
  METADATA_CLASSIFICATION_DOMAINS,
  METADATA_CLASSIFICATION_MOODS,
  LLM_PROVIDER_NAMES,
  isLLMProviderError,
  type ClassifyMetadataRequest,
  type ClassifyRequest,
  type DescribeImageRequest,
  type ExplainConnectionRequest,
  type GenerateEmbeddingRequest,
  type GenerateReflectionRequest,
  type GenerateTitleRequest,
  type LLMProviderError,
  type LLMProviderErrorCode,
  type LLMProvider,
  type LLMProviderName,
  type LLMProviderOperation,
  type LLMProviderRequestFor,
  type LLMProviderResponseFor,
  type SummarizeRequest,
  type TranscribeAudioRequest,
} from "../../packages/shared/llm/provider.ts";
import {
  buildReflectionGroundingContext,
  isGroundedReflectionPrompt,
  type ReflectionGroundingContext,
} from "../../packages/shared/llm/reflection-grounding.ts";
import {
  PRIMARY_REFLECTION_GROUNDING_FIXTURE,
  REFLECTION_GROUNDING_FIXTURES,
} from "./reflection-grounding-fixture.ts";

export interface LLMProviderContractRequests {
  classify: ClassifyRequest;
  classifyMetadata: ClassifyMetadataRequest;
  describeImage: DescribeImageRequest;
  explainConnection: ExplainConnectionRequest;
  generateEmbedding: GenerateEmbeddingRequest;
  generateReflection: GenerateReflectionRequest;
  generateTitle: GenerateTitleRequest;
  summarize: SummarizeRequest;
  transcribeAudio: TranscribeAudioRequest;
}

export interface RegisteredProviderContractFixture {
  provider: LLMProviderName;
}

type SingleStringOutputOperation =
  | "classify"
  | "describeImage"
  | "explainConnection"
  | "generateReflection"
  | "generateTitle"
  | "summarize"
  | "transcribeAudio";

type SingleStringOutputKey<TOperation extends SingleStringOutputOperation> =
  keyof LLMProviderResponseFor<TOperation>["output"] & string;

interface ProviderResponseEnvelopeAssertion<
  TOperation extends LLMProviderOperation,
> {
  response: LLMProviderResponseFor<TOperation>;
  request: LLMProviderRequestFor<TOperation>;
  expectedProvider: LLMProviderName;
  expectedRequestId?: string;
  expectedTraceId?: string;
}

interface SingleStringResponseAssertion<
  TOperation extends SingleStringOutputOperation,
> extends ProviderResponseEnvelopeAssertion<TOperation> {
  outputKey: SingleStringOutputKey<TOperation>;
  minLength?: number;
}

interface EmbeddingResponseAssertion
  extends ProviderResponseEnvelopeAssertion<"generateEmbedding"> {
  expectedDimensions: number;
}

interface ProviderErrorAssertion {
  error: unknown;
  expectedCode: LLMProviderErrorCode;
  expectedOperation: LLMProviderOperation;
  expectedProvider: LLMProviderName;
  expectedRequestId?: string;
  expectedRetryable: boolean;
  expectedStatusCode?: number;
  expectedTraceId?: string;
  expectedMessageIncludes?: string;
}

interface GroundedReflectionPromptAssertion {
  content: string;
  prompt: string;
  groundingContext?: ReflectionGroundingContext;
  unrelatedSourceTexts?: readonly string[];
}

interface ProviderResponseFixtureArgs<TOperation extends LLMProviderOperation> {
  provider: LLMProviderName;
  request: LLMProviderRequestFor<TOperation>;
  model: string;
  output: LLMProviderResponseFor<TOperation>["output"];
  finishReason?: LLMProviderResponseFor<TOperation>["finishReason"];
  requestId?: string;
  traceId?: string;
  usage?: LLMProviderResponseFor<TOperation>["usage"];
  usageMetadata?: LLMProviderResponseFor<TOperation>["usageMetadata"];
}

export function createLLMProviderContractRequests(): LLMProviderContractRequests {
  return {
    generateEmbedding: {
      operation: "generateEmbedding",
      requestId: "req_embedding",
      traceId: "trace_embedding",
      input: {
        text: "Surprising connections should surface across historical captures.",
        model: "embedding",
      },
    },
    summarize: {
      operation: "summarize",
      requestId: "req_summary",
      traceId: "trace_summary",
      timeoutMs: 3_000,
      maxRetries: 3,
      metadata: {
        sourceType: "TEXT_NOTE",
      },
      generation: {
        temperature: 0.2,
        maxTokens: 120,
        stopSequences: ["END"],
        topP: 0.9,
        topK: 40,
        frequencyPenalty: 0.1,
        presencePenalty: 0.1,
        seed: 7,
      },
      input: {
        content:
          "Waka should feel instant on capture while moving enrichment work onto the queue.",
        maxCharacters: 280,
        model: "text",
      },
    },
    classify: {
      operation: "classify",
      requestId: "req_classify",
      traceId: "trace_classify",
      input: {
        prompt: "Label this capture for downstream routing.",
        labels: ["productivity", "design"],
        model: "default",
      },
    },
    classifyMetadata: {
      operation: "classifyMetadata",
      requestId: "req_metadata",
      traceId: "trace_metadata",
      input: {
        content:
          "An idea about clustering AI conversations and resurfacing them later.",
        model: "text",
      },
    },
    generateReflection: {
      operation: "generateReflection",
      requestId: "req_reflection",
      traceId: "trace_reflection",
      input: {
        content: PRIMARY_REFLECTION_GROUNDING_FIXTURE.sourceText,
        groundingContext: buildReflectionGroundingContext(
          PRIMARY_REFLECTION_GROUNDING_FIXTURE.sourceText,
        ),
        model: "text",
      },
    },
    explainConnection: {
      operation: "explainConnection",
      requestId: "req_connection",
      traceId: "trace_connection",
      input: {
        sourceContent: "Capture fast.",
        targetContent: "Resurface later.",
        model: "text",
      },
    },
    generateTitle: {
      operation: "generateTitle",
      requestId: "req_title",
      traceId: "trace_title",
      input: {
        content: "Instant capture with resilient asynchronous enrichment.",
        maxCharacters: 80,
        model: "text",
      },
    },
    transcribeAudio: {
      operation: "transcribeAudio",
      requestId: "req_audio",
      traceId: "trace_audio",
      input: {
        audio: {
          mediaUrl: "https://assets.example/voice-note.mp3",
          storageKey: "users/user-audio/voice-notes/voice-note.mp3",
        },
        model: "transcription",
      },
    },
    describeImage: {
      operation: "describeImage",
      requestId: "req_image",
      traceId: "trace_image",
      input: {
        imageUrl: "https://assets.example/inspiration.png",
        model: "vision",
      },
    },
  };
}

export function createProviderResponseFixture<
  TOperation extends LLMProviderOperation,
>(
  args: ProviderResponseFixtureArgs<TOperation>,
): LLMProviderResponseFor<TOperation> {
  const response = {
    operation: args.request.operation,
    provider: args.provider,
    model: args.model,
    requestId: args.requestId ?? args.request.requestId,
    traceId: args.traceId ?? args.request.traceId,
    finishReason: args.finishReason,
    usage: args.usage,
    usageMetadata: args.usageMetadata,
    output: args.output,
  } satisfies LLMProviderResponseFor<TOperation>;

  return response;
}

export function assertProviderContractSurface(
  provider: Pick<LLMProvider, "provider" | "supportedOperations">,
  expectedOperations: readonly LLMProviderOperation[],
): void {
  assert.equal(typeof provider.provider, "string");
  assert.equal(provider.provider.length > 0, true);
  assert.deepEqual(provider.supportedOperations, expectedOperations);
}

export function assertRegisteredProviderContractCoverage(
  fixtures: readonly RegisteredProviderContractFixture[],
): void {
  assert.deepEqual(
    fixtures.map((fixture) => fixture.provider).sort(),
    [...LLM_PROVIDER_NAMES].sort(),
  );
}

export function assertProviderResponseEnvelope<
  TOperation extends LLMProviderOperation,
>(args: ProviderResponseEnvelopeAssertion<TOperation>): void {
  const expectedRequestId = args.expectedRequestId ?? args.request.requestId;
  const expectedTraceId = args.expectedTraceId ?? args.request.traceId;

  assert.equal(args.response.operation, args.request.operation);
  assert.equal(args.response.provider, args.expectedProvider);
  assert.equal(typeof args.response.model, "string");
  assert.equal(args.response.model.trim().length > 0, true);

  if (expectedRequestId) {
    assert.equal(args.response.requestId, expectedRequestId);
  }

  if (expectedTraceId) {
    assert.equal(args.response.traceId, expectedTraceId);
  }

  assert.equal(typeof args.response.output, "object");
  assert.notEqual(args.response.output, null);
}

export function assertSingleStringOutputResponse<
  TOperation extends SingleStringOutputOperation,
>(args: SingleStringResponseAssertion<TOperation>): void {
  assertProviderResponseEnvelope(args);

  const value = args.response.output[args.outputKey];

  assert.equal(typeof value, "string");
  assert.equal(value.trim().length >= (args.minLength ?? 1), true);
}

export function assertGroundedReflectionPrompt(
  args: GroundedReflectionPromptAssertion,
): void {
  const groundingContext =
    args.groundingContext ?? buildReflectionGroundingContext(args.content);
  const unrelatedSourceTexts =
    args.unrelatedSourceTexts ??
    REFLECTION_GROUNDING_FIXTURES.map((fixture) => fixture.sourceText).filter(
      (sourceText) => sourceText !== args.content,
    );

  assert.equal(
    isGroundedReflectionPrompt(args.prompt, args.content, groundingContext),
    true,
    `expected reflection prompt to anchor to the source text: ${args.prompt}`,
  );

  for (const unrelatedSourceText of unrelatedSourceTexts) {
    assert.equal(
      isGroundedReflectionPrompt(
        args.prompt,
        unrelatedSourceText,
        buildReflectionGroundingContext(unrelatedSourceText),
      ),
      false,
      `expected reflection prompt not to validate against unrelated text: ${unrelatedSourceText}`,
    );
  }
}

export function assertEmbeddingResponse(args: EmbeddingResponseAssertion): void {
  assertProviderResponseEnvelope(args);
  assert.equal(args.response.output.dimensions, args.expectedDimensions);
  assert.equal(args.response.output.embedding.length, args.expectedDimensions);
  assert.equal(
    args.response.output.embedding.every((value) => Number.isFinite(value)),
    true,
  );
}

export function assertMetadataClassificationResponse(
  args: ProviderResponseEnvelopeAssertion<"classifyMetadata">,
): void {
  assertProviderResponseEnvelope(args);
  assert.equal(args.response.output.tags.length > 0, true);
  assert.equal(
    args.response.output.tags.every((tag) => tag.trim().length > 0),
    true,
  );
  assert.equal(
    METADATA_CLASSIFICATION_DOMAINS.includes(args.response.output.domain),
    true,
  );
  assert.equal(
    METADATA_CLASSIFICATION_MOODS.includes(args.response.output.mood),
    true,
  );
  assert.equal(
    METADATA_CLASSIFICATION_ACTIONABILITY.includes(
      args.response.output.actionability,
    ),
    true,
  );
}

export function assertProviderErrorContract(
  args: ProviderErrorAssertion,
): LLMProviderError {
  assert.equal(isLLMProviderError(args.error), true);

  if (!isLLMProviderError(args.error)) {
    throw new Error("Expected an LLMProviderError.");
  }

  assert.equal(args.error.name, "LLMProviderError");
  assert.equal(args.error.code, args.expectedCode);
  assert.equal(args.error.provider, args.expectedProvider);
  assert.equal(args.error.operation, args.expectedOperation);
  assert.equal(args.error.retryable, args.expectedRetryable);

  if (args.expectedRequestId === undefined) {
    assert.equal(args.error.requestId, undefined);
  } else {
    assert.equal(args.error.requestId, args.expectedRequestId);
  }

  if (args.expectedTraceId === undefined) {
    assert.equal(args.error.traceId, undefined);
  } else {
    assert.equal(args.error.traceId, args.expectedTraceId);
  }

  if (args.expectedStatusCode === undefined) {
    assert.equal(args.error.statusCode, undefined);
  } else {
    assert.equal(args.error.statusCode, args.expectedStatusCode);
  }

  if (args.expectedMessageIncludes) {
    assert.equal(
      args.error.message.includes(args.expectedMessageIncludes),
      true,
    );
  }

  return args.error;
}
