import assert from "node:assert/strict";
import test from "node:test";

import { buildPendingInspirationEnrichmentFields } from "../apps/web/src/inspirations/enrichment-field-metadata.ts";
import {
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL,
} from "../packages/shared/llm/runtime.ts";
import type {
  ClassifyRequest,
  ClassifyResponse,
  ClassifyMetadataRequest,
  ClassifyMetadataResponse,
  GenerateEmbeddingRequest,
  GenerateEmbeddingResponse,
  GenerateReflectionRequest,
  GenerateReflectionResponse,
  GenerateTitleRequest,
  GenerateTitleResponse,
  SummarizeRequest,
  SummarizeResponse,
} from "../packages/shared/llm/provider.ts";
import {
  buildCreateInspirationProcessingState,
  handleCreateInspirationRouteRequest,
  type CreateInspirationBackgroundScheduler,
  type CreateInspirationPersistenceClient,
  type CreatedInspirationRecord,
} from "../apps/web/src/inspirations/create-route.ts";
import {
  processInspirationQueueMessage,
  type InspirationEmbeddingClient,
  type InspirationNonEmbeddingClient,
} from "../apps/web/src/jobs/process-inspiration-message.ts";
import type { AiEnrichmentSqsJobPayload } from "../packages/shared/types.ts";
import type { MarkInspirationEnrichmentEnqueuedPersistenceArgs } from "../apps/web/src/inspirations/enrichment-pipeline.ts";
import type {
  InspirationEmbeddingPersistenceClient,
  InspirationEmbeddingRecord,
  UpdateInspirationEnrichmentLifecycleArgs,
} from "../apps/web/src/jobs/inspiration-embedding-persistence.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
  buildInitialInspirationEnrichmentPersistenceData,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";

function createCreatePersistenceClient(): {
  createCalls: Array<{
    data: Record<string, unknown>;
    select: {
      id: true;
      rawContent: true;
      sourceType: true;
    };
  }>;
  client: CreateInspirationPersistenceClient;
} {
  const createCalls: Array<{
    data: Record<string, unknown>;
    select: {
      id: true;
      rawContent: true;
      sourceType: true;
    };
  }> = [];

  return {
    createCalls,
    client: {
      inspiration: {
        async create(args) {
          createCalls.push(args as typeof createCalls[number]);

          return {
            id: "insp_single_word",
            rawContent: String(args.data.rawContent),
            sourceType: args.data.sourceType as CreatedInspirationRecord["sourceType"],
          };
        },
      },
    },
  };
}

function createAsyncTaskHarness(): {
  flushScheduledTasks(): Promise<void>;
  schedule: CreateInspirationBackgroundScheduler;
} {
  const tasks: Array<() => Promise<void>> = [];

  return {
    async flushScheduledTasks() {
      while (tasks.length > 0) {
        const task = tasks.shift();

        if (task) {
          await task();
        }
      }
    },
    schedule(task) {
      tasks.push(task);
    },
  };
}

function createEnrichmentPipelineClient(): {
  client: {
    inspiration: {
      update(
        args: MarkInspirationEnrichmentEnqueuedPersistenceArgs,
      ): Promise<{
        id: string;
      }>;
    };
  };
  updateCalls: MarkInspirationEnrichmentEnqueuedPersistenceArgs[];
} {
  const updateCalls: MarkInspirationEnrichmentEnqueuedPersistenceArgs[] = [];

  return {
    client: {
      inspiration: {
        async update(args) {
          updateCalls.push(args);

          return {
            id: args.where.userId_id.id,
          };
        },
      },
    },
    updateCalls,
  };
}

function createEmbeddingVector(): number[] {
  return Array.from(
    { length: OPENAI_EMBEDDING_DIMENSIONS },
    (_, index) => Number((index / OPENAI_EMBEDDING_DIMENSIONS).toFixed(6)),
  );
}

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

class StubNonEmbeddingClient implements InspirationNonEmbeddingClient {
  async classify(request: ClassifyRequest): Promise<ClassifyResponse> {
    return {
      operation: "classify",
      provider: "openai",
      model: "gpt-5-mini",
      requestId: request.requestId,
      traceId: request.traceId,
      output: {
        classification: "NOT_NEEDED",
      },
    };
  }

  async summarize(request: SummarizeRequest): Promise<SummarizeResponse> {
    return {
      operation: "summarize",
      provider: "openai",
      model: "gpt-5-mini",
      requestId: request.requestId,
      traceId: request.traceId,
      output: {
        summary: "serendipity summary",
      },
    };
  }

  async generateReflection(
    request: GenerateReflectionRequest,
  ): Promise<GenerateReflectionResponse> {
    return {
      operation: "generateReflection",
      provider: "openai",
      model: "gpt-5-mini",
      requestId: request.requestId,
      traceId: request.traceId,
      output: {
        reflectionPrompt: "What makes this word worth keeping?",
      },
    };
  }

  async generateTitle(
    request: GenerateTitleRequest,
  ): Promise<GenerateTitleResponse> {
    return {
      operation: "generateTitle",
      provider: "openai",
      model: "gpt-5-mini",
      requestId: request.requestId,
      traceId: request.traceId,
      output: {
        title: "Serendipity",
      },
    };
  }

  async classifyMetadata(
    request: ClassifyMetadataRequest,
  ): Promise<ClassifyMetadataResponse> {
    return {
      operation: "classifyMetadata",
      provider: "openai",
      model: "gpt-5-mini",
      requestId: request.requestId,
      traceId: request.traceId,
      output: {
        actionability: "idea",
        domain: "personal",
        mood: "inspired",
        tags: ["serendipity"],
      },
    };
  }
}

class StubInspirationEmbeddingPersistenceClient
  implements InspirationEmbeddingPersistenceClient
{
  readonly executedSql: string[] = [];
  readonly updateCalls: UpdateInspirationEnrichmentLifecycleArgs[] = [];
  private readonly inspirationRecord: InspirationEmbeddingRecord | null;

  constructor(inspirationRecord: InspirationEmbeddingRecord | null) {
    this.inspirationRecord = inspirationRecord;
  }

  readonly inspiration = {
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

    return this.inspirationRecord ? 1 : 0;
  }
}

test("single-word inspirations are accepted and queued for async enrichment", async () => {
  const { client, createCalls } = createCreatePersistenceClient();
  const { client: enrichmentPipeline, updateCalls } =
    createEnrichmentPipelineClient();
  const asyncTasks = createAsyncTaskHarness();
  const enqueuedPayloads: AiEnrichmentSqsJobPayload[] = [];

  const response = await handleCreateInspirationRouteRequest(
    new Request("https://waka.app/api/inspirations", {
      method: "POST",
      body: JSON.stringify({
        rawContent: "serendipity",
        sourceType: "TEXT_NOTE",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-single-word";
          },
        },
        backgroundScheduler: asyncTasks.schedule,
        enrichmentPipeline,
        persistence: client,
        queuePublisher: {
          async enqueue(payload) {
            enqueuedPayloads.push(payload);
          },
        },
      },
    },
  );

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    id: "insp_single_word",
    processingState: buildCreateInspirationProcessingState(),
    rawContent: "serendipity",
    sourceType: "TEXT_NOTE",
  });
  assert.deepEqual(createCalls, [
    {
      data: {
        userId: "user-single-word",
        originalRawContent: "serendipity",
        rawContent: "serendipity",
        sourceType: "TEXT_NOTE",
        tags: [],
        ...buildInitialInspirationEnrichmentPersistenceData(),
      },
      select: {
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        id: true,
        rawContent: true,
        sourceType: true,
      },
    },
  ]);
  assert.deepEqual(enqueuedPayloads, []);
  assert.deepEqual(updateCalls, []);

  await asyncTasks.flushScheduledTasks();

  assert.deepEqual(enqueuedPayloads, [
    {
      jobType: "ai_enrichment",
      inspirationId: "insp_single_word",
    },
  ]);
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.data.enrichmentStatus, "PENDING");
  assert.equal(
    updateCalls[0]?.data.enrichmentMaxAttemptCount,
    INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  );
  assert.deepEqual(
    updateCalls[0]?.data.enrichmentFields,
    buildPendingInspirationEnrichmentFields(
      INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    ),
  );
  assert.equal(updateCalls[0]?.data.enrichmentResumeState, null);
  assert.equal(updateCalls[0]?.where.userId_id.userId, "user-single-word");
  assert.equal(updateCalls[0]?.where.userId_id.id, "insp_single_word");
});

test("single-word inspirations are processed by the async embedding worker", async () => {
  const embeddingClient = new StubEmbeddingClient();
  const nonEmbeddingClient = new StubNonEmbeddingClient();
  const persistenceClient = new StubInspirationEmbeddingPersistenceClient({
    id: "insp_single_word",
    rawContent: "serendipity",
  });

  await processInspirationQueueMessage(
    {
      body: JSON.stringify({ inspirationId: "insp_single_word" }),
      messageId: "message-single-word",
    },
    {
      embeddingClient,
      nonEmbeddingClient,
      persistenceClient,
    },
  );

  assert.deepEqual(embeddingClient.requests, [
    {
      maxRetries: 3,
      operation: "generateEmbedding",
      requestId: "message-single-word",
      timeoutMs: 55_000,
      traceId: "insp_single_word",
      input: {
        model: "embedding",
        text: "serendipity",
      },
    },
  ]);
  assert.equal(persistenceClient.updateCalls.length, 1);
  assert.equal(
    persistenceClient.updateCalls[0]?.data.enrichmentStatus,
    INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
  );
  assert.equal(persistenceClient.executedSql.length, 1);
  assert.match(
    persistenceClient.executedSql[0]!,
    /"title" = COALESCE\("title", 'Serendipity'\)/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"summary" = 'serendipity summary'/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /"tags" = ARRAY\['serendipity'\]::text\[]/,
  );
  assert.match(
    persistenceClient.executedSql[0]!,
    /WHERE "id" = 'insp_single_word'$/m,
  );
});
