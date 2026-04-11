import assert from "node:assert/strict";
import test from "node:test";

import { OPENAI_EMBEDDING_DIMENSIONS } from "../../packages/shared/llm/openai-provider.ts";
import {
  LLM_PROVIDER_OPERATIONS,
  type LLMProvider,
  type LLMProviderName,
  type LLMProviderOperation,
  type LLMProviderRequestFor,
} from "../../packages/shared/llm/provider.ts";
import {
  assertGroundedReflectionPrompt,
  assertEmbeddingResponse,
  assertMetadataClassificationResponse,
  assertProviderContractSurface,
  assertProviderErrorContract,
  assertSingleStringOutputResponse,
  createLLMProviderContractRequests,
  type RegisteredProviderContractFixture,
} from "./llm-provider-contract-harness.ts";
import { PRIMARY_REFLECTION_GROUNDING_FIXTURE } from "./reflection-grounding-fixture.ts";

export interface SharedProviderContractFixture
  extends RegisteredProviderContractFixture {
  provider: LLMProviderName;
  supportedOperations: readonly LLMProviderOperation[];
  createProvider(fetchImplementation: typeof fetch): LLMProvider;
  createSuccessFetch(): typeof fetch;
  expectedSuccessRequestId: string;
}

const requests = createLLMProviderContractRequests();
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

function getRequestForOperation(
  operation: (typeof LLM_PROVIDER_OPERATIONS)[number],
): LLMProviderRequestFor<(typeof LLM_PROVIDER_OPERATIONS)[number]> {
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
  fixture: SharedProviderContractFixture;
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
        PRIMARY_REFLECTION_GROUNDING_FIXTURE.expectedGroundedQuestion,
      );
      assertGroundedReflectionPrompt({
        prompt: reflection.output.reflectionPrompt,
        content: requests.generateReflection.input.content,
        groundingContext: requests.generateReflection.input.groundingContext,
      });
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
      const title = response as Awaited<ReturnType<LLMProvider["generateTitle"]>>;
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

export function registerSharedProviderContractSuite(
  fixture: SharedProviderContractFixture,
): void {
  test(
    `shared provider contract suite runs against the ${fixture.provider} adapter`,
    async () => {
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
    },
  );
}
