import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInspirationEnrichmentFieldMetadata,
  buildProcessingInspirationEnrichmentFields,
  createInspirationEnrichmentFields,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_TIMEOUT,
} from "../apps/web/src/inspirations/enrichment-field-metadata.ts";
import { buildInspirationEnrichmentResumeState } from "../apps/web/src/inspirations/enrichment-resume-state.ts";
import {
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL,
} from "../packages/shared/llm/runtime.ts";
import { buildReflectionGroundingContext } from "../packages/shared/llm/reflection-grounding.ts";
import {
  type ClassifyRequest,
  type ClassifyResponse,
  LLMProviderError,
  type ClassifyMetadataRequest,
  type ClassifyMetadataResponse,
  type GenerateEmbeddingRequest,
  type GenerateEmbeddingResponse,
  type GenerateReflectionRequest,
  type GenerateReflectionResponse,
  type GenerateTitleRequest,
  type GenerateTitleResponse,
  type SummarizeRequest,
  type SummarizeResponse,
} from "../packages/shared/llm/provider.ts";
import {
  createInspirationQueueRecordProcessingRequest,
  type InspirationQueueRecord,
} from "../apps/web/src/jobs/inspiration-queue.ts";
import { INSPIRATION_AI_FIELD_GENERATION_RETRY_POLICIES } from "../apps/web/src/jobs/inspiration-ai-field-generation-policy.ts";
import {
  configureInspirationEmbeddingPersistenceClient,
  parseInspirationQueueMessageBody,
  processInspirationQueueMessage,
  type InspirationEmbeddingClient,
  type InspirationNonEmbeddingClient,
} from "../apps/web/src/jobs/process-inspiration-message.ts";
import {
  DEFAULT_INSPIRATION_CONNECTION_ANALYSIS_LIMIT,
  DEFAULT_INSPIRATION_CONNECTION_SIMILARITY_THRESHOLD,
} from "../apps/web/src/jobs/inspiration-connection-analysis-job.ts";
import {
  buildCountClusterableInspirationsArgs,
} from "../apps/web/src/jobs/inspiration-cluster-rebuild-job.ts";
import { buildAiConversationSummaryPromptContent } from "../apps/web/src/import/ai-conversation-summary.ts";
import type {
  InspirationEmbeddingPersistenceClient,
  InspirationEmbeddingRecord,
  UpdateInspirationEnrichmentLifecycleArgs,
} from "../apps/web/src/jobs/inspiration-embedding-persistence.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  INSPIRATION_ENRICHMENT_STATUS_FAILED,
  INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";

function createEmbeddingVector(): number[] {
  return Array.from(
    { length: OPENAI_EMBEDDING_DIMENSIONS },
    (_, index) => Number((index / OPENAI_EMBEDDING_DIMENSIONS).toFixed(6)),
  );
}

function createJsonResponse(status: number, payload: unknown) {
  return {
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

const DEFAULT_AI_FIELD_GENERATION_ALLOWED_RUNTIME_MS = 55_000;
const EMBEDDING_PROVIDER_MAX_RETRIES =
  INSPIRATION_AI_FIELD_GENERATION_RETRY_POLICIES.embedding.providerMaxRetries;
const SUMMARY_PROVIDER_MAX_RETRIES =
  INSPIRATION_AI_FIELD_GENERATION_RETRY_POLICIES.summary.providerMaxRetries;
const METADATA_PROVIDER_MAX_RETRIES =
  INSPIRATION_AI_FIELD_GENERATION_RETRY_POLICIES.metadata.providerMaxRetries;
const TITLE_PROVIDER_MAX_RETRIES =
  INSPIRATION_AI_FIELD_GENERATION_RETRY_POLICIES.title.providerMaxRetries;

class StubEmbeddingClient implements InspirationEmbeddingClient {
  readonly requests: GenerateEmbeddingRequest[] = [];

  async generateEmbedding(
    request: GenerateEmbeddingRequest,
  ): Promise<GenerateEmbeddingResponse> {
    this.requests.push(request);

    return {
      operation: "generateEmbedding",
      provider: "openai",
      model: OPENAI_EMBEDDING_MODEL,
      requestId: request.requestId,
      traceId: request.traceId,
      output: {
        embedding: createEmbeddingVector(),
        dimensions: OPENAI_EMBEDDING_DIMENSIONS,
      },
    };
  }
}

class FailingEmbeddingClient implements InspirationEmbeddingClient {
  readonly error: Error;
  readonly requests: GenerateEmbeddingRequest[] = [];

  constructor(error: Error) {
    this.error = error;
  }

  async generateEmbedding(
    request: GenerateEmbeddingRequest,
  ): Promise<GenerateEmbeddingResponse> {
    this.requests.push(request);

    throw this.error;
  }
}

class HangingEmbeddingClient implements InspirationEmbeddingClient {
  readonly requests: GenerateEmbeddingRequest[] = [];

  async generateEmbedding(
    request: GenerateEmbeddingRequest,
  ): Promise<GenerateEmbeddingResponse> {
    this.requests.push(request);

    return new Promise<GenerateEmbeddingResponse>(() => {});
  }
}

class StubNonEmbeddingClient implements InspirationNonEmbeddingClient {
  readonly classificationRequests: ClassifyRequest[] = [];
  readonly metadataRequests: ClassifyMetadataRequest[] = [];
  readonly reflectionRequests: GenerateReflectionRequest[] = [];
  readonly summaryRequests: SummarizeRequest[] = [];
  readonly titleRequests: GenerateTitleRequest[] = [];

  async classify(request: ClassifyRequest): Promise<ClassifyResponse> {
    this.classificationRequests.push(request);

    return {
      operation: "classify",
      provider: "openai",
      model: "gpt-5-mini",
      requestId: request.requestId,
      traceId: request.traceId,
      output: {
        classification: "PROMPTED",
      },
    };
  }

  async summarize(request: SummarizeRequest): Promise<SummarizeResponse> {
    this.summaryRequests.push(request);

    return {
      operation: "summarize",
      provider: "openai",
      model: "gpt-5-mini",
      requestId: request.requestId,
      traceId: request.traceId,
      output: {
        summary: "A durable capture summary.",
      },
    };
  }

  async generateReflection(
    request: GenerateReflectionRequest,
  ): Promise<GenerateReflectionResponse> {
    this.reflectionRequests.push(request);

    return {
      operation: "generateReflection",
      provider: "openai",
      model: "gpt-5-mini",
      requestId: request.requestId,
      traceId: request.traceId,
      output: {
        reflectionPrompt: "What exactly sparked this thought?",
      },
    };
  }

  async generateTitle(
    request: GenerateTitleRequest,
  ): Promise<GenerateTitleResponse> {
    this.titleRequests.push(request);

    return {
      operation: "generateTitle",
      provider: "openai",
      model: "gpt-5-mini",
      requestId: request.requestId,
      traceId: request.traceId,
      output: {
        title: "Capture title",
      },
    };
  }

  async classifyMetadata(
    request: ClassifyMetadataRequest,
  ): Promise<ClassifyMetadataResponse> {
    this.metadataRequests.push(request);

    return {
      operation: "classifyMetadata",
      provider: "openai",
      model: "gpt-5-mini",
      requestId: request.requestId,
      traceId: request.traceId,
      output: {
        actionability: "idea",
        domain: "technology",
        mood: "curious",
        tags: ["capture", "knowledge"],
      },
    };
  }
}

class MetadataTimeoutNonEmbeddingClient extends StubNonEmbeddingClient {
  override async classifyMetadata(
    request: ClassifyMetadataRequest,
  ): Promise<ClassifyMetadataResponse> {
    this.metadataRequests.push(request);

    return new Promise<ClassifyMetadataResponse>(() => {});
  }
}

class NonRetryableMetadataNonEmbeddingClient extends StubNonEmbeddingClient {
  override async classifyMetadata(
    request: ClassifyMetadataRequest,
  ): Promise<ClassifyMetadataResponse> {
    this.metadataRequests.push(request);

    throw new LLMProviderError({
      code: "INVALID_RESPONSE",
      message: "Metadata response was malformed.",
      operation: "classifyMetadata",
      provider: "openai",
      retryable: false,
    });
  }
}

class StubInspirationEmbeddingPersistenceClient
  implements InspirationEmbeddingPersistenceClient
{
  readonly countCalls: Array<Record<string, unknown>> = [];
  readonly executedSql: string[] = [];
  readonly updateCalls: UpdateInspirationEnrichmentLifecycleArgs[] = [];
  private readonly clusterableInspirationCount: number;
  private readonly inspirationRecord: InspirationEmbeddingRecord | null;
  private readonly updatedRowCount: number;

  constructor(
    inspirationRecord: InspirationEmbeddingRecord | null,
    updatedRowCount = inspirationRecord ? 1 : 0,
    clusterableInspirationCount = 0,
  ) {
    this.clusterableInspirationCount = clusterableInspirationCount;
    this.inspirationRecord = inspirationRecord;
    this.updatedRowCount = updatedRowCount;
  }

  readonly inspiration = {
    count: async (args: Record<string, unknown>) => {
      this.countCalls.push(args);

      return this.clusterableInspirationCount;
    },
    findUnique: async () => this.inspirationRecord,
    update: async (args: UpdateInspirationEnrichmentLifecycleArgs) => {
      this.updateCalls.push(args);

      return {
        id: args.where.id,
      };
    },
  };

  async $executeRawUnsafe(sql: string): Promise<number> {
    this.executedSql.push(sql);

    return this.updatedRowCount;
  }
}

test("parseInspirationQueueMessageBody requires a JSON object with an inspirationId and supports parent refresh payloads", () => {
  assert.deepEqual(
    parseInspirationQueueMessageBody(
      JSON.stringify({
        inspirationId: "insp_42",
        fieldNames: ["summary", "embedding"],
      }),
    ),
    {
      jobType: "ai_enrichment",
      fieldNames: ["summary", "embedding"],
      inspirationId: "insp_42",
    },
  );
  assert.deepEqual(
    parseInspirationQueueMessageBody(
      JSON.stringify({
        jobType: "reflection_reembedding",
        inspirationId: "insp_parent_refresh",
      }),
    ),
    {
      jobType: "reflection_reembedding",
      inspirationId: "insp_parent_refresh",
    },
  );

  assert.throws(
    () => parseInspirationQueueMessageBody(JSON.stringify({})),
    /inspirationId must be a non-empty string/,
  );
});

test("processInspirationQueueMessage generates the full enrichment payload and persists it in one write", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const startedAt = new Date("2026-04-10T00:00:00.000Z");
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_42",
    rawContent: "Connect this capture back to my earlier systems notes.",
    sourceType: "TEXT_NOTE",
  });

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({ inspirationId: "insp_42" }),
      messageId: "message-42",
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      now: () => startedAt,
      persistenceClient,
    },
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.equal(nonEmbeddingClient.summaryRequests.length, 1);
  assert.equal(nonEmbeddingClient.metadataRequests.length, 1);
  assert.equal(nonEmbeddingClient.classificationRequests.length, 1);
  assert.equal(nonEmbeddingClient.reflectionRequests.length, 1);
  assert.equal(nonEmbeddingClient.titleRequests.length, 1);
  assert.deepEqual(persistenceClient.updateCalls, [
    {
      data: {
        enrichmentAttemptCount: {
          increment: 1,
        },
        enrichmentCompletedAt: null,
        enrichmentFailedAt: null,
        enrichmentFields: buildProcessingInspirationEnrichmentFields(
          startedAt,
          {
            attemptCount: 1,
            maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          },
        ),
        enrichmentLastError: null,
        enrichmentLastFailureReason: null,
        enrichmentLastFailureRetryability: null,
        enrichmentMaxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        enrichmentResumeState: null,
        enrichmentStartedAt: startedAt,
        enrichmentStatus: INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
      },
      select: {
        id: true,
      },
      where: {
        id: "insp_42",
      },
    },
  ]);
  assert.deepEqual(embeddingClient.requests[0], {
    maxRetries: EMBEDDING_PROVIDER_MAX_RETRIES,
    operation: "generateEmbedding",
    requestId: "message-42",
    timeoutMs: DEFAULT_AI_FIELD_GENERATION_ALLOWED_RUNTIME_MS,
    traceId: "insp_42",
    input: {
      model: "embedding",
      text: "Connect this capture back to my earlier systems notes.",
    },
  });
  assert.deepEqual(nonEmbeddingClient.summaryRequests[0], {
    maxRetries: SUMMARY_PROVIDER_MAX_RETRIES,
    operation: "summarize",
    requestId: "message-42",
    timeoutMs: DEFAULT_AI_FIELD_GENERATION_ALLOWED_RUNTIME_MS,
    traceId: "insp_42",
    generation: {
      seed: 0,
      temperature: 0,
    },
    input: {
      content: "Connect this capture back to my earlier systems notes.",
      model: "text",
    },
  });
  assert.deepEqual(nonEmbeddingClient.metadataRequests[0], {
    maxRetries: METADATA_PROVIDER_MAX_RETRIES,
    operation: "classifyMetadata",
    requestId: "message-42",
    timeoutMs: DEFAULT_AI_FIELD_GENERATION_ALLOWED_RUNTIME_MS,
    traceId: "insp_42",
    generation: {
      seed: 0,
      temperature: 0,
    },
    input: {
      content: "Connect this capture back to my earlier systems notes.",
      model: "text",
    },
  });
  assert.deepEqual(nonEmbeddingClient.titleRequests[0], {
    maxRetries: TITLE_PROVIDER_MAX_RETRIES,
    operation: "generateTitle",
    requestId: "message-42",
    timeoutMs: DEFAULT_AI_FIELD_GENERATION_ALLOWED_RUNTIME_MS,
    traceId: "insp_42",
    generation: {
      seed: 0,
      temperature: 0,
    },
    input: {
      content: "Connect this capture back to my earlier systems notes.",
      model: "text",
    },
  });
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.deepEqual(nonEmbeddingClient.classificationRequests[0], {
    maxRetries: METADATA_PROVIDER_MAX_RETRIES,
    operation: "classify",
    requestId: "message-42",
    timeoutMs: DEFAULT_AI_FIELD_GENERATION_ALLOWED_RUNTIME_MS,
    traceId: "insp_42",
    generation: {
      seed: 0,
      temperature: 0,
    },
    input: {
      labels: ["PROMPTED", "NOT_NEEDED"],
      model: "text",
      prompt:
        "Classify whether this saved inspiration should surface a post-save reflection prompt.\n" +
        "Return exactly one label: PROMPTED or NOT_NEEDED.\n" +
        "Choose PROMPTED for complex, nuanced, emotionally charged, interpretive, or insight-dense captures that would benefit from deeper thinking.\n" +
        "Choose NOT_NEEDED for simple saves, quick references, bare links, single words, straightforward reminders, or factual snippets.\n" +
        "Source type: TEXT_NOTE\n" +
        "Captured content:\n" +
        "Connect this capture back to my earlier systems notes.",
    },
  });
  assert.deepEqual(nonEmbeddingClient.reflectionRequests[0], {
    maxRetries: TITLE_PROVIDER_MAX_RETRIES,
    operation: "generateReflection",
    requestId: "message-42",
    timeoutMs: DEFAULT_AI_FIELD_GENERATION_ALLOWED_RUNTIME_MS,
    traceId: "insp_42",
    generation: {
      seed: 0,
      temperature: 0,
    },
    input: {
      content: "Connect this capture back to my earlier systems notes.",
      groundingContext: buildReflectionGroundingContext(
        "Connect this capture back to my earlier systems notes.",
      ),
      model: "text",
    },
  });
  assert.match(
    persistenceClient.executedSql[0]!,
    /WHERE "id" = 'insp_42'\n  AND "rawContent" IS NOT DISTINCT FROM 'Connect this capture back to my earlier systems notes\.'$/m,
  );
  assert.match(persistenceClient.executedSql[0]!, /::vector/);
  assert.match(
    persistenceClient.executedSql[0]!,
    /"title" = COALESCE\("title", 'Capture title'\)/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary" = 'A durable capture summary\.'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"tags" = ARRAY\['capture', 'knowledge'\]::text\[]/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"domain" = 'technology'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"mood" = 'curious'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"actionability" = 'idea'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"reflectionPrompt" = 'What exactly sparked this thought\?'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"reflectionStatus" = 'PROMPTED'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentCompletedAt" = CURRENT_TIMESTAMP/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentFields" = '/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary":\{"attemptCount":1,"completedAt":"2026-04-10T00:00:00.000Z"/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentFailedAt" = NULL/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentLastFailureReason" = NULL/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentLastFailureRetryability" = NULL/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentStatus" = 'COMPLETED'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentLastError" = NULL/,
  );
});

test("processInspirationQueueMessage enqueues connection analysis after the completed enrichment write persists the embedding", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_connections",
    rawContent: "Surface related notes after the embedding lands.",
    userId: "user_connections",
  });
  const enqueuedPayloads: Array<Record<string, unknown>> = [];
  const executedSqlCountsAtEnqueue: number[] = [];

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({ inspirationId: "insp_connections" }),
      messageId: "message-connections",
    },
    {
      connectionAnalysisJobPublisher: {
        async enqueue(payload) {
          executedSqlCountsAtEnqueue.push(persistenceClient.executedSql.length);
          enqueuedPayloads.push(payload);
        },
      },
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.deepEqual(executedSqlCountsAtEnqueue, [1]);
  assert.deepEqual(enqueuedPayloads, [
    {
      inspirationId: "insp_connections",
      jobType: "connection_analysis",
      maxConnections: DEFAULT_INSPIRATION_CONNECTION_ANALYSIS_LIMIT,
      similarityThreshold:
        DEFAULT_INSPIRATION_CONNECTION_SIMILARITY_THRESHOLD,
      userId: "user_connections",
    },
  ]);
});

test("processInspirationQueueMessage skips connection analysis when an ai_enrichment rerun does not request embedding", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    embedding: createEmbeddingVector(),
    id: "insp_title_only",
    rawContent: "Refresh only the title without re-running similarity search.",
    userId: "user_title_only",
  });
  const enqueuedPayloads: Array<Record<string, unknown>> = [];

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({
        fieldNames: ["title"],
        inspirationId: "insp_title_only",
      }),
      messageId: "message-title-only",
    },
    {
      connectionAnalysisJobPublisher: {
        async enqueue(payload) {
          enqueuedPayloads.push(payload);
        },
      },
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.deepEqual(enqueuedPayloads, []);
});

test("processInspirationQueueMessage enqueues cluster rebuild after the fifth newly embedded inspiration persists", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient(
    {
      id: "insp_cluster_trigger",
      rawContent: "Rebuild semantic clusters once the fifth embedding lands.",
      userId: "user_cluster_trigger",
    },
    1,
    5,
  );
  const enqueuedPayloads: Array<Record<string, unknown>> = [];
  const executedSqlCountsAtEnqueue: number[] = [];

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({ inspirationId: "insp_cluster_trigger" }),
      messageId: "message-cluster-trigger",
    },
    {
      clusterRebuildJobPublisher: {
        async enqueue(payload) {
          executedSqlCountsAtEnqueue.push(persistenceClient.executedSql.length);
          enqueuedPayloads.push(payload);
        },
      },
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.deepEqual(persistenceClient.countCalls, [
    buildCountClusterableInspirationsArgs("user_cluster_trigger"),
  ]);
  assert.deepEqual(executedSqlCountsAtEnqueue, [1]);
  assert.deepEqual(enqueuedPayloads, [
    {
      jobType: "cluster_rebuild",
      triggerInspirationId: "insp_cluster_trigger",
      userId: "user_cluster_trigger",
    },
  ]);
});

test("processInspirationQueueMessage skips cluster rebuild before the fifth clusterable inspiration", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient(
    {
      id: "insp_cluster_wait",
      rawContent: "Do not rebuild clusters before the fifth embedding.",
      userId: "user_cluster_wait",
    },
    1,
    4,
  );
  const enqueuedPayloads: Array<Record<string, unknown>> = [];

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({ inspirationId: "insp_cluster_wait" }),
      messageId: "message-cluster-wait",
    },
    {
      clusterRebuildJobPublisher: {
        async enqueue(payload) {
          enqueuedPayloads.push(payload);
        },
      },
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.deepEqual(persistenceClient.countCalls, [
    buildCountClusterableInspirationsArgs("user_cluster_wait"),
  ]);
  assert.deepEqual(enqueuedPayloads, []);
});

test("processInspirationQueueMessage skips cluster rebuild when reprocessing an inspiration that already had an embedding", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient(
    {
      embedding: createEmbeddingVector(),
      id: "insp_cluster_rerun",
      rawContent: "Reprocessing an existing embedding should not trigger reclustering cadence.",
      userId: "user_cluster_rerun",
    },
    1,
    5,
  );
  const enqueuedPayloads: Array<Record<string, unknown>> = [];

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({ inspirationId: "insp_cluster_rerun" }),
      messageId: "message-cluster-rerun",
    },
    {
      clusterRebuildJobPublisher: {
        async enqueue(payload) {
          enqueuedPayloads.push(payload);
        },
      },
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.deepEqual(persistenceClient.countCalls, []);
  assert.deepEqual(enqueuedPayloads, []);
});

test("processInspirationQueueMessage extracts pure URL imports before AI enrichment and persists the extracted article body", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const extractedSourceMeta = {
    contentType: "article",
    domain: "example.com",
    favicon: "https://example.com/favicon.ico",
    ogDescription: "Reliable capture pipelines need durable metadata.",
    ogImage: "https://example.com/og/reliability.png",
    ogTitle: "Reliability Notes",
  } as const;
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_url_import",
    rawContent: "https://example.com/articles/reliability",
    sourceType: "URL_IMPORT",
    sourceUrl: "https://example.com/articles/reliability",
  });
  const extractorRequests: Array<{
    rawContent: string;
    sourceUrl: string;
  }> = [];

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({ inspirationId: "insp_url_import" }),
      messageId: "message-url-import",
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
      urlImportExtractor: {
        async extract(request) {
          extractorRequests.push(request);

          return {
            content:
              "Reliability is downstream of capture speed, extraction quality, and resilient retries.",
            sourceMeta: extractedSourceMeta,
            title: "Reliability Notes",
          };
        },
      },
    },
  );

  assert.deepEqual(extractorRequests, [
    {
      rawContent: "https://example.com/articles/reliability",
      sourceUrl: "https://example.com/articles/reliability",
    },
  ]);
  assert.equal(nonEmbeddingClient.titleRequests.length, 0);
  assert.deepEqual(nonEmbeddingClient.summaryRequests[0]?.input, {
    content:
      "Reliability is downstream of capture speed, extraction quality, and resilient retries.",
    model: "text",
  });
  assert.deepEqual(nonEmbeddingClient.metadataRequests[0]?.input, {
    content:
      "Reliability is downstream of capture speed, extraction quality, and resilient retries.",
    model: "text",
  });
  assert.deepEqual(embeddingClient.requests[0]?.input, {
    model: "embedding",
    text: "Reliability is downstream of capture speed, extraction quality, and resilient retries.",
  });
  assert.match(
    persistenceClient.executedSql[0]!,
    /"rawContent" = 'Reliability is downstream of capture speed, extraction quality, and resilient retries\.'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"title" = COALESCE\("title", 'Reliability Notes'\)/,
  );
  assert.ok(
    persistenceClient.executedSql[0]!.includes(
      `"sourceMeta" = COALESCE("sourceMeta", '{}'::jsonb) || '${JSON.stringify(extractedSourceMeta)}'::jsonb,`,
    ),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /WHERE "id" = 'insp_url_import'\n  AND "rawContent" IS NOT DISTINCT FROM 'https:\/\/example\.com\/articles\/reliability'$/m,
  );
});

test("processInspirationQueueMessage preserves URL import timeout failures as the persisted enrichment error", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_url_import_timeout",
    rawContent: "https://example.com/slow",
    sourceType: "URL_IMPORT",
    sourceUrl: "https://example.com/slow",
  });

  await assert.rejects(
    async () =>
      processInspirationQueueMessage(
        {
          body: JSON.stringify({ inspirationId: "insp_url_import_timeout" }),
          messageId: "message-url-import-timeout",
        },
        {
          embeddingClient,
          nonEmbeddingClient,
          persistenceClient,
          urlImportExtractor: {
            async extract() {
              throw new Error(
                "URL import timed out after 10 seconds for https://example.com/slow.",
              );
            },
          },
        },
      ),
    /URL import timed out after 10 seconds for https:\/\/example\.com\/slow\./,
  );

  assert.equal(embeddingClient.requests.length, 0);
  assert.equal(nonEmbeddingClient.summaryRequests.length, 0);
  assert.equal(nonEmbeddingClient.metadataRequests.length, 0);
  assert.equal(nonEmbeddingClient.titleRequests.length, 0);
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentStatus" = 'FAILED'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentLastFailureReason" = 'URL import timed out after 10 seconds for https:\/\/example\.com\/slow\.'/,
  );
});

test("processInspirationQueueMessage embeds AI conversations from the focused summary output while prompting the summarizer with high-signal turns", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const aiConversationRawContent =
    "User: Hi there.\nAssistant: Happy to help.\nUser: We need pgvector clustering on Neon and embeddings locked to text-embedding-3-small.\nAssistant: Keep OpenAI for embeddings, leave non-embedding tasks switchable via LLM_PROVIDER, and poll every 3 seconds.\nUser: Decision: preserve key entities like Prisma, DBSCAN, and Auth.js in the summary.\nAssistant: Next step: update the enrichment worker and add tests.";
  const aiConversationSourceMeta = {
    conversationTitle: "Waka AI import",
    model: "gpt-4.1-mini",
    participantNames: ["Ada", "ChatGPT"],
    provider: "chatgpt",
    turns: [
      {
        participantIndex: 0,
        role: "user",
        text: "Hi there.",
      },
      {
        participantIndex: 1,
        role: "assistant",
        text: "Happy to help.",
      },
      {
        participantIndex: 0,
        role: "user",
        text: "We need pgvector clustering on Neon and embeddings locked to text-embedding-3-small.",
      },
      {
        participantIndex: 1,
        role: "assistant",
        text: "Keep OpenAI for embeddings, leave non-embedding tasks switchable via LLM_PROVIDER, and poll every 3 seconds.",
      },
      {
        participantIndex: 0,
        role: "user",
        text: "Decision: preserve key entities like Prisma, DBSCAN, and Auth.js in the summary.",
      },
      {
        participantIndex: 1,
        role: "assistant",
        text: "Next step: update the enrichment worker and add tests.",
      },
    ],
    turnCount: 6,
  } as const;
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_ai_conversation",
    rawContent: aiConversationRawContent,
    sourceMeta: aiConversationSourceMeta,
  });

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({ inspirationId: "insp_ai_conversation" }),
      messageId: "message-ai-conversation",
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  const expectedSummaryContent = buildAiConversationSummaryPromptContent({
    rawContent: aiConversationRawContent,
    sourceMeta: aiConversationSourceMeta,
  });

  assert.equal(embeddingClient.requests.length, 1);
  assert.equal(nonEmbeddingClient.summaryRequests.length, 1);
  assert.equal(
    embeddingClient.requests[0]?.input.text,
    "A durable capture summary.",
  );
  assert.equal(
    nonEmbeddingClient.summaryRequests[0]?.input.content,
    expectedSummaryContent,
  );
  assert.match(
    nonEmbeddingClient.summaryRequests[0]?.input.content ?? "",
    /pgvector clustering on Neon/,
  );
  assert.match(
    nonEmbeddingClient.summaryRequests[0]?.input.content ?? "",
    /Decision: preserve key entities like Prisma, DBSCAN, and Auth\.js in the summary\./,
  );
  assert.doesNotMatch(
    nonEmbeddingClient.summaryRequests[0]?.input.content ?? "",
    /Hi there\./,
  );
  assert.doesNotMatch(
    nonEmbeddingClient.summaryRequests[0]?.input.content ?? "",
    /Happy to help\./,
  );
});

test("processInspirationQueueMessage reuses a persisted AI conversation summary when rerunning only the embedding field", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const aiConversationSourceMeta = {
    conversationTitle: "Persisted AI summary",
    participantNames: ["Ada", "ChatGPT"],
    provider: "chatgpt",
  } as const;
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_ai_summary_resume",
    rawContent:
      "User: keep the full transcript stored, but embed the focused summary on rerun.",
    sourceMeta: aiConversationSourceMeta,
    summary: "Persisted focused AI conversation summary.",
  });

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({
        fieldNames: ["embedding"],
        inspirationId: "insp_ai_summary_resume",
      }),
      messageId: "message-ai-summary-resume",
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.equal(
    embeddingClient.requests[0]?.input.text,
    "Persisted focused AI conversation summary.",
  );
  assert.equal(nonEmbeddingClient.summaryRequests.length, 0);
});

test("processInspirationQueueMessage regenerates the focused summary before an embedding-only AI conversation rerun when no persisted summary exists", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_ai_summary_dependency",
    rawContent:
      "User: refresh the embedding from the focused AI conversation summary, not the raw transcript.",
    sourceMeta: {
      participantNames: ["Ada", "ChatGPT"],
      provider: "chatgpt",
    },
  });

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({
        fieldNames: ["embedding"],
        inspirationId: "insp_ai_summary_dependency",
      }),
      messageId: "message-ai-summary-dependency",
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.equal(nonEmbeddingClient.summaryRequests.length, 1);
  assert.equal(
    embeddingClient.requests[0]?.input.text,
    "A durable capture summary.",
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.summary.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary" = 'A durable capture summary\.'/,
  );
});

test("processInspirationQueueMessage backfills the source conversation reference when persisting an AI conversation summary embedding", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_ai_source_ref_backfill",
    rawContent:
      "User: keep the transcript, but persist a focused summary embedding with durable provenance.",
    sourceMeta: {
      conversationId: "conversation-123",
      participantNames: ["Ada", "ChatGPT"],
      provider: "chatgpt",
    },
  });

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({
        fieldNames: ["summary", "embedding"],
        inspirationId: "insp_ai_source_ref_backfill",
      }),
      messageId: "message-ai-source-ref-backfill",
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /"sourceConversationRef" = COALESCE\("sourceConversationRef", 'ai-conversation-ref:v1:chatgpt:conversation=conversation-123'\)/,
  );
});

test("processInspirationQueueMessage accepts prepared subscriber requests", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_prepared",
    rawContent: "Process the extracted SQS body through the default job worker.",
  });
  const record: InspirationQueueRecord = {
    body: JSON.stringify({ inspirationId: "insp_prepared" }),
    messageId: "message-prepared",
  };

  await processInspirationQueueMessage(
    createInspirationQueueRecordProcessingRequest(record),
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.deepEqual(embeddingClient.requests[0], {
    maxRetries: EMBEDDING_PROVIDER_MAX_RETRIES,
    operation: "generateEmbedding",
    requestId: "message-prepared",
    timeoutMs: DEFAULT_AI_FIELD_GENERATION_ALLOWED_RUNTIME_MS,
    traceId: "insp_prepared",
    input: {
      model: "embedding",
      text: "Process the extracted SQS body through the default job worker.",
    },
  });
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /WHERE "id" = 'insp_prepared'\n  AND "rawContent" IS NOT DISTINCT FROM 'Process the extracted SQS body through the default job worker\.'$/m,
  );
});

test("processInspirationQueueMessage accepts a prevalidated ai_enrichment payload from the dispatcher", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_validated",
    rawContent: "Use the validated dispatcher payload instead of reparsing the body.",
  });

  await processInspirationQueueMessage(
    {
      body: "not-json-but-already-validated",
      jobType: "ai_enrichment",
      metadata: {
        messageId: "message-validated",
      },
      payload: {
        jobType: "ai_enrichment",
        inspirationId: "insp_validated",
      },
      record: {
        body: "not-json-but-already-validated",
        messageId: "message-validated",
      },
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.deepEqual(embeddingClient.requests[0], {
    maxRetries: EMBEDDING_PROVIDER_MAX_RETRIES,
    operation: "generateEmbedding",
    requestId: "message-validated",
    timeoutMs: DEFAULT_AI_FIELD_GENERATION_ALLOWED_RUNTIME_MS,
    traceId: "insp_validated",
    input: {
      model: "embedding",
      text: "Use the validated dispatcher payload instead of reparsing the body.",
    },
  });
  assert.equal(persistenceClient.executedSql.length, 1);
});

test("processInspirationQueueMessage rejects jobs outside the supported enrichment flows before calling downstream services", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();

  await assert.rejects(
    async () =>
      processInspirationQueueMessage(
        {
          body: JSON.stringify({
            jobType: "url_import",
            inspirationId: "insp_url",
            sourceUrl: "https://example.com/article",
          }),
          jobType: "url_import",
          metadata: {
            messageId: "message-url-import",
          },
          payload: {
            jobType: "url_import",
            inspirationId: "insp_url",
            sourceUrl: "https://example.com/article",
          },
          record: {
            body: JSON.stringify({
              jobType: "url_import",
              inspirationId: "insp_url",
              sourceUrl: "https://example.com/article",
            }),
            messageId: "message-url-import",
          },
        },
        {
          embeddingClient,
          nonEmbeddingClient,
          persistenceClient: new StubInspirationEmbeddingPersistenceClient({
            id: "insp_url",
            rawContent: "This should never be read.",
          }),
        },
      ),
    /only supports ai_enrichment or reflection_reembedding jobs; received url_import/,
  );

  assert.equal(embeddingClient.requests.length, 0);
});

test("processInspirationQueueMessage accepts a prevalidated reflection_reembedding payload from the dispatcher and reprocesses the parent", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const startedAt = new Date("2026-04-10T00:11:00.000Z");
  const previousCompletedAt = new Date("2026-04-10T00:10:00.000Z");
  const previousFailedAt = new Date("2026-04-10T00:10:30.000Z");
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    enrichmentFields: createInspirationEnrichmentFields((fieldName) => {
      if (fieldName === "title" || fieldName === "summary") {
        return buildInspirationEnrichmentFieldMetadata({
          attemptCount: 1,
          completedAt: previousCompletedAt,
          maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          startedAt: previousCompletedAt,
          status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        attemptCount: 1,
        failedAt: previousFailedAt,
        lastError: {
          capturedAt: previousFailedAt.toISOString(),
          failureClass: "TRANSIENT_FIELD_RUNTIME_TIMEOUT",
          message: "Previous partial retry state should be ignored.",
          reason: "Previous partial retry state should be ignored.",
          retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        },
        lastFailureReason: "Previous partial retry state should be ignored.",
        lastFailureRetryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        startedAt: previousFailedAt,
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_TIMEOUT,
      });
    }),
    enrichmentResumeState: buildInspirationEnrichmentResumeState({
      capture: {
        mediaUrl: null,
        rawContent: "Reprocess the parent after a child deepen request.",
        sourceMeta: null,
        sourceUrl: null,
        title: "Existing parent title",
        transcript: null,
      },
      completedFieldNames: ["title", "summary"],
      completedOutputs: {
        summary: "Old summary from a stale partial run.",
        title: "Existing parent title",
      },
      remainingFieldNames: ["embedding", "tags", "domain", "mood", "actionability"],
      updatedAt: previousFailedAt,
    }),
    id: "insp_parent_refresh",
    rawContent: "Reprocess the parent after a child deepen request.",
    title: "Existing parent title",
  });

  await processInspirationQueueMessage(
    {
      body: "not-json-but-already-validated",
      jobType: "reflection_reembedding",
      metadata: {
        messageId: "message-parent-refresh",
      },
      payload: {
        jobType: "reflection_reembedding",
        inspirationId: "insp_parent_refresh",
      },
      record: {
        body: "not-json-but-already-validated",
        messageId: "message-parent-refresh",
      },
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      now: () => startedAt,
      persistenceClient,
    },
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.equal(nonEmbeddingClient.summaryRequests.length, 1);
  assert.equal(nonEmbeddingClient.metadataRequests.length, 1);
  assert.equal(nonEmbeddingClient.titleRequests.length, 0);
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentResumeState,
    null,
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.summary.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.summary.attemptCount,
    1,
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.title.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary" = 'A durable capture summary\.'/,
  );
});

test("processInspirationQueueMessage rebuilds reflection re-embedding input from the persisted parent plus rooted child expansions", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_parent_with_children",
    rawContent: "Parent context that should stay in the root embedding.",
    sourceExpansions: [
      {
        rawContent: "First child detail already persisted on the parent lineage.",
      },
      {
        rawContent: "Newest child detail that must be reflected in the parent.",
      },
    ],
  });

  await processInspirationQueueMessage(
    {
      body: "not-json-but-already-validated",
      jobType: "reflection_reembedding",
      metadata: {
        messageId: "message-parent-with-children",
      },
      payload: {
        jobType: "reflection_reembedding",
        inspirationId: "insp_parent_with_children",
      },
      record: {
        body: "not-json-but-already-validated",
        messageId: "message-parent-with-children",
      },
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  const expectedCombinedContent = [
    "Parent context that should stay in the root embedding.",
    "First child detail already persisted on the parent lineage.",
    "Newest child detail that must be reflected in the parent.",
  ].join("\n\n");

  assert.equal(embeddingClient.requests[0]?.input.text, expectedCombinedContent);
  assert.equal(
    nonEmbeddingClient.summaryRequests[0]?.input.content,
    expectedCombinedContent,
  );
  assert.equal(
    nonEmbeddingClient.metadataRequests[0]?.input.content,
    expectedCombinedContent,
  );
});

test("processInspirationQueueMessage appends the saved reflection answer to reflection re-embedding content", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_reflection_answered",
    rawContent: "The original capture should stay anchored in the refreshed embedding.",
    reflectionAnswer:
      "The tension between speed and fidelity is what made this feel important.",
  });

  await processInspirationQueueMessage(
    {
      body: "not-json-but-already-validated",
      jobType: "reflection_reembedding",
      metadata: {
        messageId: "message-reflection-answered",
      },
      payload: {
        jobType: "reflection_reembedding",
        inspirationId: "insp_reflection_answered",
      },
      record: {
        body: "not-json-but-already-validated",
        messageId: "message-reflection-answered",
      },
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  const expectedCombinedContent = [
    "The original capture should stay anchored in the refreshed embedding.",
    "The tension between speed and fidelity is what made this feel important.",
  ].join("\n\n");

  assert.equal(embeddingClient.requests[0]?.input.text, expectedCombinedContent);
  assert.equal(
    nonEmbeddingClient.summaryRequests[0]?.input.content,
    expectedCombinedContent,
  );
  assert.equal(
    nonEmbeddingClient.metadataRequests[0]?.input.content,
    expectedCombinedContent,
  );
});

test("processInspirationQueueMessage prefers normalized job metadata for the embedding request id", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_metadata_request",
    rawContent: "Queue metadata should drive the downstream request id.",
  });

  await processInspirationQueueMessage(
    {
      body: "not-json-but-already-validated",
      jobType: "ai_enrichment",
      metadata: {
        messageId: "message-from-metadata",
      },
      payload: {
        jobType: "ai_enrichment",
        inspirationId: "insp_metadata_request",
      },
      record: {
        body: "not-json-but-already-validated",
        messageId: "message-from-record",
      },
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.equal(
    embeddingClient.requests[0]?.requestId,
    "message-from-metadata",
  );
});

test("processInspirationQueueMessage rejects when the queued inspiration record no longer exists", async () => {
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient(null);

  await assert.rejects(
    async () =>
      processInspirationQueueMessage(
        {
          body: JSON.stringify({ inspirationId: "missing_inspiration" }),
          messageId: "message-missing",
        },
        {
          embeddingClient: new StubEmbeddingClient(),
          nonEmbeddingClient: new StubNonEmbeddingClient(),
          persistenceClient,
        },
      ),
    /missing_inspiration was not found for embedding generation/,
  );

  assert.equal(persistenceClient.updateCalls.length, 0);
});

test("processInspirationQueueMessage records the latest enrichment failure details for retries", async () => {
  const embeddingClient = new FailingEmbeddingClient(
    new Error("Embedding provider timed out."),
  );
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const startedAt = new Date("2026-04-10T00:10:00.000Z");
  const failedAt = new Date("2026-04-10T00:10:05.000Z");
  const timestamps = [startedAt, failedAt];
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_failure",
    rawContent: "Persist the failure so the next retry has the latest context.",
  });

  await assert.rejects(
    async () =>
      processInspirationQueueMessage(
        {
          attributes: {
            ApproximateReceiveCount: "2",
          },
          body: JSON.stringify({ inspirationId: "insp_failure" }),
          messageId: "message-failure",
        },
        {
          embeddingClient,
          nonEmbeddingClient,
          now: () => timestamps.shift() ?? failedAt,
          persistenceClient,
        },
      ),
    /Embedding provider timed out/,
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.equal(persistenceClient.updateCalls.length, 1);
  assert.deepEqual(persistenceClient.updateCalls[0], {
    data: {
      enrichmentAttemptCount: {
        increment: 1,
      },
      enrichmentCompletedAt: null,
      enrichmentFailedAt: null,
      enrichmentFields: buildProcessingInspirationEnrichmentFields(
        startedAt,
        {
          attemptCount: 2,
          maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        },
      ),
      enrichmentLastError: null,
      enrichmentLastFailureReason: null,
      enrichmentLastFailureRetryability: null,
      enrichmentMaxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      enrichmentResumeState: null,
      enrichmentStartedAt: startedAt,
      enrichmentStatus: INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
    },
    select: {
      id: true,
    },
    where: {
      id: "insp_failure",
    },
  });
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentStatus" = 'FAILED'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentFailedAt" = CURRENT_TIMESTAMP/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentLastFailureReason" = 'Embedding provider timed out\.'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentLastFailureRetryability" = 'RETRYABLE'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary" = 'A durable capture summary\.'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"title" = COALESCE\("title", 'Capture title'\)/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"embedding":\{"attemptCount":2,"completedAt":null,"failedAt":"2026-04-10T00:10:05.000Z"/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary":\{"attemptCount":2,"completedAt":"2026-04-10T00:10:05.000Z"/,
  );
});

test("processInspirationQueueMessage times out only the unfinished enrichment fields when the job exceeds its runtime budget", async () => {
  const allowedRuntimeMs = 10;
  const embeddingClient = new HangingEmbeddingClient();
  const nonEmbeddingClient = new MetadataTimeoutNonEmbeddingClient();
  const startedAt = new Date("2026-04-10T00:12:00.000Z");
  const timedOutAt = new Date("2026-04-10T00:12:10.000Z");
  const timestamps = [startedAt, timedOutAt];
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_timeout",
    rawContent: "Persist the finished AI fields and time out only the unfinished ones.",
  });

  await assert.rejects(
    async () =>
      processInspirationQueueMessage(
        {
          body: JSON.stringify({ inspirationId: "insp_timeout" }),
          messageId: "message-timeout",
        },
        {
          allowedRuntimeMs,
          embeddingClient,
          nonEmbeddingClient,
          now: () => timestamps.shift() ?? timedOutAt,
          persistenceClient,
        },
      ),
    /AI field generation exceeded the allowed runtime of 10ms\. Timed out unfinished fields: embedding, tags, domain, mood, actionability\./,
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.equal(embeddingClient.requests[0]?.timeoutMs, allowedRuntimeMs);
  assert.equal(nonEmbeddingClient.summaryRequests.length, 1);
  assert.equal(nonEmbeddingClient.summaryRequests[0]?.timeoutMs, allowedRuntimeMs);
  assert.equal(nonEmbeddingClient.metadataRequests.length, 1);
  assert.equal(
    nonEmbeddingClient.metadataRequests[0]?.timeoutMs,
    allowedRuntimeMs,
  );
  assert.equal(nonEmbeddingClient.titleRequests.length, 1);
  assert.equal(nonEmbeddingClient.titleRequests[0]?.timeoutMs, allowedRuntimeMs);
  assert.equal(persistenceClient.updateCalls.length, 1);
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentLastFailureReason" = 'AI field generation exceeded the allowed runtime of 10ms\. Timed out unfinished fields: embedding, tags, domain, mood, actionability\.'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary" = 'A durable capture summary\.'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"title" = COALESCE\("title", 'Capture title'\)/,
  );
  assert.doesNotMatch(persistenceClient.executedSql[0]!, /::vector/);
  assert.doesNotMatch(
    persistenceClient.executedSql[0]!,
    /"tags" = ARRAY\['capture', 'knowledge'\]::text\[]/,
  );
  assert.doesNotMatch(
    persistenceClient.executedSql[0]!,
    /"domain" = 'technology'/,
  );
  assert.doesNotMatch(
    persistenceClient.executedSql[0]!,
    /"mood" = 'curious'/,
  );
  assert.doesNotMatch(
    persistenceClient.executedSql[0]!,
    /"actionability" = 'idea'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary":\{"attemptCount":1,"completedAt":"2026-04-10T00:12:10.000Z"/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(`"summary":\\{[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED}"`),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"title":\{"attemptCount":1,"completedAt":"2026-04-10T00:12:10.000Z"/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(`"title":\\{[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED}"`),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"embedding":\{"attemptCount":1,"completedAt":null,"failedAt":"2026-04-10T00:12:10.000Z","lastError":\{"capturedAt":"2026-04-10T00:12:10.000Z","failureClass":"TRANSIENT_FIELD_RUNTIME_TIMEOUT","message":"AI field generation exceeded the allowed runtime of 10ms\. Timed out unfinished fields: embedding, tags, domain, mood, actionability\."/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(`"embedding":\\{[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_TIMEOUT}"`),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"tags":\{"attemptCount":1,"completedAt":null,"failedAt":"2026-04-10T00:12:10.000Z"/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(`"tags":\\{[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_TIMEOUT}"`),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentResumeState" = '/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"capture":\{"mediaUrl":null,"rawContent":"Persist the finished AI fields and time out only the unfinished ones\.","sourceMeta":null,"sourceUrl":null,"title":null,"transcript":null\}/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"completedOutputs":\{"summary":"A durable capture summary\.","title":"Capture title"\}/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"remainingFieldNames":\["embedding","tags","domain","mood","actionability"\]/,
  );
  assert.doesNotMatch(
    persistenceClient.executedSql[0]!,
    /Timed out unfinished fields: embedding, title, summary, tags, domain, mood, actionability/,
  );
});

test("processInspirationQueueMessage transitions exhausted timed-out fields into terminal failed state while preserving retry metadata", async () => {
  const allowedRuntimeMs = 10;
  const embeddingClient = new HangingEmbeddingClient();
  const nonEmbeddingClient = new MetadataTimeoutNonEmbeddingClient();
  const startedAt = new Date("2026-04-10T00:12:00.000Z");
  const failedAt = new Date("2026-04-10T00:12:10.000Z");
  const timestamps = [startedAt, failedAt];
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_timeout_terminal",
    rawContent:
      "When retries are exhausted, timed out AI fields should become terminal failures.",
  });

  await assert.rejects(
    async () =>
      processInspirationQueueMessage(
        {
          attributes: {
            ApproximateReceiveCount: String(
              INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
            ),
          },
          body: JSON.stringify({ inspirationId: "insp_timeout_terminal" }),
          messageId: "message-timeout-terminal",
        },
        {
          allowedRuntimeMs,
          embeddingClient,
          nonEmbeddingClient,
          now: () => timestamps.shift() ?? failedAt,
          persistenceClient,
        },
      ),
    /AI field generation exceeded the allowed runtime of 10ms\. Timed out unfinished fields: embedding, tags, domain, mood, actionability\./,
  );

  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /"embedding":\{"attemptCount":3,"completedAt":null,"failedAt":"2026-04-10T00:12:10.000Z"/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(
      `"embedding":\\{[\\s\\S]*?"lastFailureRetryability":"${INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE}"[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED}"`,
    ),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(
      `"tags":\\{[\\s\\S]*?"lastFailureRetryability":"${INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE}"[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED}"`,
    ),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(
      `"summary":\\{[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED}"`,
    ),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(
      `"title":\\{[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED}"`,
    ),
  );
});

test("processInspirationQueueMessage terminally fails only the affected generated fields for non-retryable AI errors", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new NonRetryableMetadataNonEmbeddingClient();
  const startedAt = new Date("2026-04-10T00:14:00.000Z");
  const failedAt = new Date("2026-04-10T00:14:05.000Z");
  const timestamps = [startedAt, failedAt];
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_non_retryable_metadata",
    rawContent:
      "Non-retryable metadata failures should only stop the metadata-derived fields.",
  });

  await assert.rejects(
    async () =>
      processInspirationQueueMessage(
        {
          body: JSON.stringify({
            inspirationId: "insp_non_retryable_metadata",
          }),
          messageId: "message-non-retryable-metadata",
        },
        {
          embeddingClient,
          nonEmbeddingClient,
          now: () => timestamps.shift() ?? failedAt,
          persistenceClient,
        },
      ),
    /Metadata response was malformed\./,
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.equal(nonEmbeddingClient.summaryRequests.length, 1);
  assert.equal(nonEmbeddingClient.titleRequests.length, 1);
  assert.equal(nonEmbeddingClient.metadataRequests.length, 1);
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary" = 'A durable capture summary\.'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"title" = COALESCE\("title", 'Capture title'\)/,
  );
  assert.match(persistenceClient.executedSql[0]!, /::vector/);
  assert.doesNotMatch(
    persistenceClient.executedSql[0]!,
    /"tags" = ARRAY\['capture', 'knowledge'\]::text\[]/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(
      `"tags":\\{[\\s\\S]*?"lastFailureRetryability":"${INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE}"[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED}"`,
    ),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(
      `"domain":\\{[\\s\\S]*?"lastFailureRetryability":"${INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE}"[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED}"`,
    ),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(
      `"summary":\\{[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED}"`,
    ),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(
      `"embedding":\\{[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED}"`,
    ),
  );
});

test("processInspirationQueueMessage resumes only the timed-out fields from stored timeout metadata", async () => {
  const resumeUpdatedAt = new Date("2026-04-10T00:13:00.000Z");
  const startedAt = new Date("2026-04-10T00:13:05.000Z");
  const previousCompletedAt = new Date("2026-04-10T00:12:10.000Z");
  const previousFailedAt = new Date("2026-04-10T00:12:10.000Z");
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    enrichmentFields: createInspirationEnrichmentFields((fieldName) => {
      if (fieldName === "title" || fieldName === "summary") {
        return buildInspirationEnrichmentFieldMetadata({
          attemptCount: 1,
          completedAt: previousCompletedAt,
          maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          startedAt: previousCompletedAt,
          status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        attemptCount: 1,
        failedAt: previousFailedAt,
        lastError: {
          capturedAt: previousFailedAt.toISOString(),
          failureClass: "TRANSIENT_FIELD_RUNTIME_TIMEOUT",
          message: "Previous field runtime timeout.",
          reason: "Previous field runtime timeout.",
          retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        },
        lastFailureReason: "Previous field runtime timeout.",
        lastFailureRetryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        startedAt: previousFailedAt,
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_TIMEOUT,
      });
    }),
    enrichmentResumeState: buildInspirationEnrichmentResumeState({
      capture: {
        mediaUrl: null,
        rawContent: "Resume only the fields that timed out last time.",
        sourceMeta: null,
        sourceUrl: null,
        title: null,
        transcript: null,
      },
      completedFieldNames: ["title", "summary"],
      completedOutputs: {
        summary: "A durable capture summary.",
        title: "Capture title",
      },
      remainingFieldNames: ["embedding", "tags", "domain", "mood", "actionability"],
      updatedAt: resumeUpdatedAt,
    }),
    id: "insp_resume",
    rawContent: "Resume only the fields that timed out last time.",
  });
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();

  await processInspirationQueueMessage(
    {
      attributes: {
        ApproximateReceiveCount: "2",
      },
      body: JSON.stringify({ inspirationId: "insp_resume" }),
      messageId: "message-resume",
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      now: () => startedAt,
      persistenceClient,
    },
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.equal(embeddingClient.requests[0]?.input.text, "Resume only the fields that timed out last time.");
  assert.equal(nonEmbeddingClient.summaryRequests.length, 0);
  assert.equal(nonEmbeddingClient.titleRequests.length, 0);
  assert.equal(nonEmbeddingClient.metadataRequests.length, 1);
  assert.equal(
    nonEmbeddingClient.metadataRequests[0]?.input.content,
    "Resume only the fields that timed out last time.",
  );
  assert.equal(persistenceClient.updateCalls.length, 1);
  assert.deepEqual(
    persistenceClient.updateCalls[0]?.data.enrichmentResumeState,
    buildInspirationEnrichmentResumeState({
      capture: {
        mediaUrl: null,
        rawContent: "Resume only the fields that timed out last time.",
        sourceMeta: null,
        sourceUrl: null,
        title: null,
        transcript: null,
      },
      completedFieldNames: ["title", "summary"],
      completedOutputs: {
        summary: "A durable capture summary.",
        title: "Capture title",
      },
      remainingFieldNames: ["embedding", "tags", "domain", "mood", "actionability"],
      updatedAt: resumeUpdatedAt,
    }),
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.summary.attemptCount,
    1,
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.summary.completedAt,
    previousCompletedAt.toISOString(),
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.embedding.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.embedding.attemptCount,
    2,
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.embedding.failedAt,
    previousFailedAt.toISOString(),
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.embedding.lastError?.message,
    "Previous field runtime timeout.",
  );
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary" = 'A durable capture summary\.'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary":\{"attemptCount":1,"completedAt":"2026-04-10T00:12:10.000Z"/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"title" = COALESCE\("title", 'Capture title'\)/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"tags" = ARRAY\['capture', 'knowledge'\]::text\[]/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentResumeState" = NULL/,
  );
});

test("processInspirationQueueMessage reruns only incomplete fields when stored retry metadata lags behind recovered outputs", async () => {
  const resumeUpdatedAt = new Date("2026-04-10T00:14:00.000Z");
  const startedAt = new Date("2026-04-10T00:14:05.000Z");
  const previousCompletedAt = new Date("2026-04-10T00:13:10.000Z");
  const previousFailedAt = new Date("2026-04-10T00:13:10.000Z");
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    actionability: "idea",
    domain: "technology",
    enrichmentFields: createInspirationEnrichmentFields((fieldName) => {
      if (fieldName === "embedding") {
        return buildInspirationEnrichmentFieldMetadata({
          attemptCount: 1,
          failedAt: previousFailedAt,
          lastError: {
            capturedAt: previousFailedAt.toISOString(),
            failureClass: "TRANSIENT_FIELD_RUNTIME_TIMEOUT",
            message: "Previous embedding timeout.",
            reason: "Previous embedding timeout.",
            retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
          },
          lastFailureReason: "Previous embedding timeout.",
          lastFailureRetryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
          maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          startedAt: previousFailedAt,
          status: INSPIRATION_ENRICHMENT_FIELD_STATUS_TIMEOUT,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        attemptCount: 1,
        completedAt: previousCompletedAt,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        startedAt: previousCompletedAt,
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
      });
    }),
    enrichmentResumeState: buildInspirationEnrichmentResumeState({
      capture: {
        mediaUrl: null,
        rawContent: "Retry only the unfinished field even if resume metadata is stale.",
        sourceMeta: null,
        sourceUrl: null,
        title: "Recovered title",
        transcript: null,
      },
      completedFieldNames: ["title"],
      completedOutputs: {
        title: "Recovered title",
      },
      remainingFieldNames: ["embedding", "summary", "tags", "domain", "mood", "actionability"],
      updatedAt: resumeUpdatedAt,
    }),
    id: "insp_stale_retry_state",
    mood: "curious",
    rawContent: "Retry only the unfinished field even if resume metadata is stale.",
    summary: "Recovered summary.",
    tags: ["capture", "knowledge"],
    title: "Recovered title",
  });
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();

  await processInspirationQueueMessage(
    {
      attributes: {
        ApproximateReceiveCount: "2",
      },
      body: JSON.stringify({ inspirationId: "insp_stale_retry_state" }),
      messageId: "message-stale-retry-state",
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      now: () => startedAt,
      persistenceClient,
    },
  );

  assert.equal(embeddingClient.requests.length, 1);
  assert.equal(nonEmbeddingClient.summaryRequests.length, 0);
  assert.equal(nonEmbeddingClient.metadataRequests.length, 0);
  assert.equal(nonEmbeddingClient.titleRequests.length, 0);
  assert.deepEqual(
    persistenceClient.updateCalls[0]?.data.enrichmentResumeState,
    buildInspirationEnrichmentResumeState({
      capture: {
        mediaUrl: null,
        rawContent: "Retry only the unfinished field even if resume metadata is stale.",
        sourceMeta: null,
        sourceUrl: null,
        title: "Recovered title",
        transcript: null,
      },
      completedFieldNames: ["title", "summary", "tags", "domain", "mood", "actionability"],
      completedOutputs: {
        actionability: "idea",
        domain: "technology",
        mood: "curious",
        summary: "Recovered summary.",
        tags: ["capture", "knowledge"],
        title: "Recovered title",
      },
      remainingFieldNames: ["embedding"],
      updatedAt: resumeUpdatedAt,
    }),
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.embedding.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.embedding.attemptCount,
    2,
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.summary.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.summary.completedAt,
    previousCompletedAt.toISOString(),
  );
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary" = 'Recovered summary\.'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"tags" = ARRAY\['capture', 'knowledge'\]::text\[]/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"domain" = 'technology'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"mood" = 'curious'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"actionability" = 'idea'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentResumeState" = NULL/,
  );
});

test("processInspirationQueueMessage can rerun a selected incomplete field without disturbing other failed fields", async () => {
  const previousCompletedAt = new Date("2026-04-10T00:20:00.000Z");
  const previousFailedAt = new Date("2026-04-10T00:21:00.000Z");
  const startedAt = new Date("2026-04-10T00:22:00.000Z");
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    enrichmentFields: createInspirationEnrichmentFields((fieldName) => {
      if (fieldName === "title") {
        return buildInspirationEnrichmentFieldMetadata({
          attemptCount: 1,
          completedAt: previousCompletedAt,
          maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          startedAt: previousCompletedAt,
          status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        attemptCount: 1,
        failedAt: previousFailedAt,
        lastError: {
          capturedAt: previousFailedAt.toISOString(),
          failureClass: "TRANSIENT_UNKNOWN",
          message: `Previous ${fieldName} failure.`,
          reason: `Previous ${fieldName} failure.`,
          retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        },
        lastFailureReason: `Previous ${fieldName} failure.`,
        lastFailureRetryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        startedAt: previousFailedAt,
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
      });
    }),
    id: "insp_selected_rerun",
    rawContent: "Retry only the summary while leaving the other failed fields alone.",
    title: "Recovered title",
  });
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({
        inspirationId: "insp_selected_rerun",
        fieldNames: ["summary"],
      }),
      messageId: "message-selected-rerun",
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      now: () => startedAt,
      persistenceClient,
    },
  );

  assert.equal(embeddingClient.requests.length, 0);
  assert.equal(nonEmbeddingClient.summaryRequests.length, 1);
  assert.equal(nonEmbeddingClient.metadataRequests.length, 0);
  assert.equal(nonEmbeddingClient.titleRequests.length, 0);
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.summary.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
  );
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentFields?.embedding.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
  );
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary" = 'A durable capture summary\.'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"enrichmentStatus" = 'FAILED'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"remainingFieldNames":\["embedding","tags","domain","mood","actionability"\]/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(
      `"embedding":\\{[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED}"`,
    ),
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    new RegExp(
      `"summary":\\{[\\s\\S]*?"status":"${INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED}"`,
    ),
  );
});

test("processInspirationQueueMessage ignores completed enrichment writes once the source capture has changed", async () => {
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient(
    {
      id: "insp_stale_success",
      rawContent: "Only save enrichment if this exact source capture is still current.",
    },
    0,
  );

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({ inspirationId: "insp_stale_success" }),
      messageId: "message-stale-success",
    },
    {
      embeddingClient: new StubEmbeddingClient(),
      nonEmbeddingClient: new StubNonEmbeddingClient(),
      persistenceClient,
    },
  );

  assert.equal(persistenceClient.updateCalls.length, 1);
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /WHERE "id" = 'insp_stale_success'\n  AND "rawContent" IS NOT DISTINCT FROM 'Only save enrichment if this exact source capture is still current\.'$/m,
  );
});

test("processInspirationQueueMessage suppresses stale failure writes after the source capture changes", async () => {
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient(
    {
      id: "insp_stale_failure",
      rawContent: "Do not let an outdated failure clobber a newer capture.",
    },
    0,
  );

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({ inspirationId: "insp_stale_failure" }),
      messageId: "message-stale-failure",
    },
    {
      embeddingClient: new FailingEmbeddingClient(
        new Error("Embedding provider timed out."),
      ),
      nonEmbeddingClient: new StubNonEmbeddingClient(),
      persistenceClient,
    },
  );

  assert.equal(persistenceClient.updateCalls.length, 1);
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /WHERE "id" = 'insp_stale_failure'\n  AND "rawContent" IS NOT DISTINCT FROM 'Do not let an outdated failure clobber a newer capture\.'$/m,
  );
});

test("processInspirationQueueMessage uses the configured default persistence client when one is registered", async () => {
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_default",
    rawContent: "Persist this capture through the default queue worker wiring.",
  });

  configureInspirationEmbeddingPersistenceClient(persistenceClient);

  try {
    await processInspirationQueueMessage(
      {
        body: JSON.stringify({ inspirationId: "insp_default" }),
        messageId: "message-default",
      },
      {
        embeddingClient: new StubEmbeddingClient(),
        nonEmbeddingClient: new StubNonEmbeddingClient(),
      },
    );
  } finally {
    configureInspirationEmbeddingPersistenceClient(null);
  }

  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /WHERE "id" = 'insp_default'\n  AND "rawContent" IS NOT DISTINCT FROM 'Persist this capture through the default queue worker wiring\.'$/m,
  );
});

test("processInspirationQueueMessage preserves an existing title instead of regenerating it", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_existing_title",
    rawContent: "Keep the user-authored title while backfilling the rest.",
    title: "User title",
  });

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({ inspirationId: "insp_existing_title" }),
      messageId: "message-existing-title",
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.equal(nonEmbeddingClient.titleRequests.length, 0);
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /"title" = COALESCE\("title", 'User title'\)/,
  );
});

test("processInspirationQueueMessage pins default embedding generation to OpenAI even when LLM_PROVIDER=gemini", async () => {
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_openai_locked",
    rawContent: "Keep embeddings pinned so vector dimensions never drift.",
  });
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const requests: Array<{ input: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async (input, init) => {
    requests.push({
      input: String(input),
      init,
    });

    return createJsonResponse(200, {
      data: [
        {
          embedding: createEmbeddingVector(),
          index: 0,
        },
      ],
      model: OPENAI_EMBEDDING_MODEL,
      usage: {
        prompt_tokens: 9,
        total_tokens: 9,
      },
    }) as unknown as Response;
  }) as typeof fetch;

  try {
    await processInspirationQueueMessage(
      {
        body: JSON.stringify({ inspirationId: "insp_openai_locked" }),
        messageId: "message-openai-locked",
      },
      {
        env: {
          LLM_PROVIDER: "gemini",
          OPENAI_API_KEY: "sk-openai-test",
          OPENAI_BASE_URL: "https://waka.example/v1/",
        },
        nonEmbeddingClient,
        persistenceClient,
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.input, "https://waka.example/v1/embeddings");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    input: "Keep embeddings pinned so vector dimensions never drift.",
    model: OPENAI_EMBEDDING_MODEL,
  });
  assert.deepEqual(requests[0]?.init?.headers, {
    Authorization: "Bearer sk-openai-test",
    "Content-Type": "application/json",
  });
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /WHERE "id" = 'insp_openai_locked'\n  AND "rawContent" IS NOT DISTINCT FROM 'Keep embeddings pinned so vector dimensions never drift\.'$/m,
  );
});
