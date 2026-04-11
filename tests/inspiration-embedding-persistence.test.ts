import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFailedInspirationEnrichmentFields,
  buildInspirationEnrichmentFieldMetadata,
  buildProcessingInspirationEnrichmentFields,
  createInspirationEnrichmentFields,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
} from "../apps/web/src/inspirations/enrichment-field-metadata.ts";
import { buildInspirationEnrichmentResumeState } from "../apps/web/src/inspirations/enrichment-resume-state.ts";
import { LLMProviderError } from "../packages/shared/llm/provider.ts";
import { OPENAI_EMBEDDING_DIMENSIONS } from "../packages/shared/llm/runtime.ts";
import {
  buildMarkInspirationEnrichmentAttemptStartedArgs,
  buildMarkInspirationEnrichmentFailedArgs,
  buildFindInspirationForEmbeddingArgs,
  persistInspirationEnrichment,
  serializeInspirationEnrichmentError,
  serializeEmbeddingVector,
  type InspirationEmbeddingPersistenceClient,
  type UpdateInspirationEnrichmentLifecycleArgs,
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

function createCompletedEnrichmentFields(
  occurredAt: Date,
  attemptCount = 1,
) {
  return createInspirationEnrichmentFields(() =>
    buildInspirationEnrichmentFieldMetadata({
      attemptCount,
      completedAt: occurredAt,
      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      startedAt: occurredAt,
      status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
    }),
  );
}

class StubInspirationEmbeddingPersistenceClient
  implements InspirationEmbeddingPersistenceClient
{
  readonly executedSql: string[] = [];
  readonly updateCalls: UpdateInspirationEnrichmentLifecycleArgs[] = [];
  private readonly updatedRowCount: number;

  constructor(updatedRowCount: number) {
    this.updatedRowCount = updatedRowCount;
  }

  readonly inspiration = {
    findUnique: async () => null,
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

test("find args request only the inspiration fields needed for embedding generation", () => {
  assert.deepEqual(buildFindInspirationForEmbeddingArgs("insp_123"), {
    where: {
      id: "insp_123",
    },
    select: {
      actionability: true,
      domain: true,
      embedding: true,
      enrichmentFields: true,
      id: true,
      mediaUrl: true,
      mood: true,
      rawContent: true,
      reflectionAnswer: true,
      reflectionPrompt: true,
      reflectionStatus: true,
      sourceConversationRef: true,
      sourceMeta: true,
      sourceExpansions: {
        orderBy: [
          {
            createdAt: "asc",
          },
        ],
        select: {
          rawContent: true,
        },
        where: {
          deletedAt: null,
        },
      },
      sourceType: true,
      sourceUrl: true,
      summary: true,
      tags: true,
      title: true,
      transcript: true,
      enrichmentResumeState: true,
      userId: true,
    },
  });
});

test("serializeEmbeddingVector emits the pgvector literal for a 1536-dimension embedding", () => {
  const vectorLiteral = serializeEmbeddingVector(createEmbeddingVector());

  assert.match(vectorLiteral, /^\[[\d,.\-eE]+\]$/);
  assert.equal(vectorLiteral.startsWith("[0"), true);
  assert.equal(vectorLiteral.endsWith("]"), true);
});

test("attempt start args increment the attempt count and mark the inspiration as processing", () => {
  const occurredAt = new Date("2026-04-10T01:00:00.000Z");

  assert.deepEqual(
    buildMarkInspirationEnrichmentAttemptStartedArgs(
      "insp_attempt",
      occurredAt,
    ),
    {
      data: {
        enrichmentAttemptCount: {
          increment: 1,
        },
        enrichmentCompletedAt: null,
        enrichmentFailedAt: null,
        enrichmentFields: buildProcessingInspirationEnrichmentFields(
          occurredAt,
          {
            attemptCount: 1,
            maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          },
        ),
        enrichmentLastError: null,
        enrichmentLastFailureReason: null,
        enrichmentLastFailureRetryability: null,
        enrichmentMaxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        enrichmentStartedAt: occurredAt,
        enrichmentStatus: INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
      },
      select: {
        id: true,
      },
      where: {
        id: "insp_attempt",
      },
    },
  );
});

test("attempt start args preserve completed field metadata and prior failed-field diagnostics on retry", () => {
  const occurredAt = new Date("2026-04-10T01:30:00.000Z");
  const previousCompletedAt = new Date("2026-04-10T01:00:00.000Z");
  const previousFailedAt = new Date("2026-04-10T01:10:00.000Z");
  const existingFields = createInspirationEnrichmentFields((fieldName) => {
    if (fieldName === "summary") {
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
        message: "Previous retryable field failure.",
        reason: "Previous retryable field failure.",
        retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
      },
      lastFailureReason: "Previous retryable field failure.",
      lastFailureRetryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      startedAt: previousFailedAt,
      status: INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
    });
  });

  const args = buildMarkInspirationEnrichmentAttemptStartedArgs(
    "insp_attempt_retry",
    occurredAt,
    {
      attemptCount: 2,
      completedFieldNames: ["summary"],
      enrichmentFields: existingFields,
    },
  );

  assert.deepEqual(args.data.enrichmentFields?.summary, existingFields.summary);
  assert.equal(
    args.data.enrichmentFields?.embedding.status,
    INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
  );
  assert.equal(args.data.enrichmentFields?.embedding.attemptCount, 2);
  assert.equal(
    args.data.enrichmentFields?.embedding.failedAt,
    previousFailedAt.toISOString(),
  );
  assert.deepEqual(
    args.data.enrichmentFields?.embedding.lastError,
    existingFields.embedding.lastError,
  );
});

test("failure args capture the latest serialized error details", () => {
  const occurredAt = new Date("2026-04-10T00:00:00.000Z");
  const args = buildMarkInspirationEnrichmentFailedArgs(
    "insp_failed",
    new Error("Queue delivery exhausted."),
    occurredAt,
    {
      attemptCount: 3,
      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    },
  );

  assert.equal(args.data.enrichmentStatus, INSPIRATION_ENRICHMENT_STATUS_FAILED);
  assert.equal(args.data.enrichmentCompletedAt, null);
  assert.equal(args.data.enrichmentFailedAt?.toISOString(), occurredAt.toISOString());
  assert.equal(
    args.data.enrichmentLastFailureReason,
    "Queue delivery exhausted.",
  );
  assert.equal(
    args.data.enrichmentLastFailureRetryability,
    INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  );
  assert.equal(
    args.data.enrichmentMaxAttemptCount,
    INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  );
  assert.equal(
    args.data.enrichmentLastError?.message,
    "Queue delivery exhausted.",
  );
  assert.equal(args.data.enrichmentLastError?.reason, "Queue delivery exhausted.");
  assert.equal(
    args.data.enrichmentLastError?.retryability,
    INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  );
  assert.equal(args.data.enrichmentLastError?.attemptCount, 3);
  assert.equal(
    args.data.enrichmentLastError?.maxAttemptCount,
    INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  );
  assert.equal(
    args.data.enrichmentLastError?.capturedAt,
    occurredAt.toISOString(),
  );
  assert.deepEqual(
    args.data.enrichmentFields,
    buildFailedInspirationEnrichmentFields({
      attemptCount: 3,
      failedAt: occurredAt,
      lastError: args.data.enrichmentLastError!,
      lastFailureReason: "Queue delivery exhausted.",
      lastFailureRetryability:
        INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    }),
  );
});

test("serialized enrichment errors normalize into JSON-safe details", () => {
  const occurredAt = new Date("2026-04-10T12:34:56.000Z");
  const error = serializeInspirationEnrichmentError(
    new Error("Keep the latest failure visible."),
    occurredAt,
    {
      attemptCount: 1,
      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    },
  );

  assert.deepEqual(error, {
    attemptCount: 1,
    capturedAt: "2026-04-10T12:34:56.000Z",
    failureClass: "TRANSIENT_UNKNOWN",
    maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    message: "Keep the latest failure visible.",
    name: "Error",
    reason: "Keep the latest failure visible.",
    retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
    stack: error.stack,
  });
});

test("serialized provider failures persist retryability classification and transport metadata", () => {
  const occurredAt = new Date("2026-04-10T13:00:00.000Z");
  const error = serializeInspirationEnrichmentError(
    new LLMProviderError({
      code: "RATE_LIMITED",
      provider: "openai",
      operation: "summarize",
      message: "Rate limit exceeded.",
      retryable: true,
      requestId: "req_retryable",
      traceId: "trace_retryable",
      statusCode: 429,
    }),
    occurredAt,
    {
      attemptCount: 2,
      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    },
  );

  assert.equal(
    error.retryability,
    INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  );
  assert.equal(error.failureClass, "TRANSIENT_PROVIDER_RATE_LIMITED");
  assert.equal(error.retryable, true);
  assert.equal(error.attemptCount, 2);
  assert.equal(
    error.maxAttemptCount,
    INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  );
  assert.equal(error.requestId, "req_retryable");
  assert.equal(error.traceId, "trace_retryable");
  assert.equal(error.statusCode, 429);
});

test("persistInspirationEnrichment updates the saved inspiration record via one vector-backed enrichment write", async () => {
  const client = new StubInspirationEmbeddingPersistenceClient(1);
  const completedAt = new Date("2026-04-10T14:00:00.000Z");
  const persistedSourceMeta = {
    contentType: "article",
    domain: "example.com",
    ogDescription: "A durable metadata snapshot for URL imports.",
    ogImage: "https://example.com/og/capture.png",
    ogTitle: "Capture title",
  } as const;

  await persistInspirationEnrichment(client, {
    inspirationId: "insp_123",
    actionability: "idea",
    domain: "technology",
    embedding: createEmbeddingVector(),
    enrichmentFields: createCompletedEnrichmentFields(completedAt),
    expectedRawContent: "Keep the original capture intact.",
    enrichmentResumeState: buildInspirationEnrichmentResumeState({
      capture: {
        mediaUrl: null,
        rawContent: "Keep the original capture intact.",
        sourceMeta: null,
        sourceUrl: null,
        title: null,
        transcript: null,
      },
      completedFieldNames: [
        "embedding",
        "title",
        "summary",
        "tags",
        "domain",
        "mood",
        "actionability",
      ],
      completedOutputs: {
        actionability: "idea",
        domain: "technology",
        embedding: createEmbeddingVector(),
        mood: "curious",
        summary: "A concise capture summary.",
        tags: ["capture", "knowledge"],
        title: "Capture title",
      },
      remainingFieldNames: [],
      updatedAt: completedAt,
    }),
    enrichmentStatus: "COMPLETED",
    ignoreIfSourceCaptureChanged: true,
    mood: "curious",
    rawContent: "Keep the extracted article body intact for downstream AI fields.",
    sourceMeta: persistedSourceMeta,
    sourceConversationRef:
      "ai-conversation-ref:v1:chatgpt:conversation=conversation-123",
    summary: "A concise capture summary.",
    tags: ["capture", "knowledge"],
    title: "Capture title",
  });

  assert.equal(client.executedSql.length, 1);
  assert.match(client.executedSql[0]!, /^UPDATE "Inspiration"/);
  assert.match(client.executedSql[0]!, /"embedding" = '\[/);
  assert.match(client.executedSql[0]!, /::vector/);
  assert.match(
    client.executedSql[0]!,
    /"title" = COALESCE\("title", 'Capture title'\)/,
  );
  assert.match(
    client.executedSql[0]!,
    /"rawContent" = 'Keep the extracted article body intact for downstream AI fields\.'/,
  );
  assert.ok(
    client.executedSql[0]!.includes(
      `"sourceMeta" = COALESCE("sourceMeta", '{}'::jsonb) || '${JSON.stringify(persistedSourceMeta)}'::jsonb,`,
    ),
  );
  assert.match(
    client.executedSql[0]!,
    /"summary" = 'A concise capture summary\.'/,
  );
  assert.match(
    client.executedSql[0]!,
    /"sourceConversationRef" = COALESCE\("sourceConversationRef", 'ai-conversation-ref:v1:chatgpt:conversation=conversation-123'\)/,
  );
  assert.match(
    client.executedSql[0]!,
    /"tags" = ARRAY\['capture', 'knowledge'\]::text\[]/,
  );
  assert.match(client.executedSql[0]!, /"domain" = 'technology'/);
  assert.match(client.executedSql[0]!, /"mood" = 'curious'/);
  assert.match(client.executedSql[0]!, /"actionability" = 'idea'/);
  assert.match(
    client.executedSql[0]!,
    /"enrichmentCompletedAt" = CURRENT_TIMESTAMP/,
  );
  assert.match(client.executedSql[0]!, /"enrichmentFields" = '/);
  assert.match(
    client.executedSql[0]!,
    /"summary":\{"attemptCount":1,"completedAt":"2026-04-10T14:00:00.000Z"/,
  );
  assert.match(client.executedSql[0]!, /"enrichmentFailedAt" = NULL/);
  assert.match(
    client.executedSql[0]!,
    /"enrichmentLastFailureReason" = NULL/,
  );
  assert.match(
    client.executedSql[0]!,
    /"enrichmentLastFailureRetryability" = NULL/,
  );
  assert.match(client.executedSql[0]!, /"enrichmentStatus" = 'COMPLETED'/);
  assert.match(client.executedSql[0]!, /"enrichmentLastError" = NULL/);
  assert.match(client.executedSql[0]!, /"enrichmentResumeState" = '/);
  assert.match(
    client.executedSql[0]!,
    /"remainingFieldNames":\[\]/,
  );
  assert.match(
    client.executedSql[0]!,
    /WHERE "id" = 'insp_123'\n  AND "rawContent" IS NOT DISTINCT FROM 'Keep the original capture intact\.'$/m,
  );
});

test("persistInspirationEnrichment treats zero-row stale writes as a safe no-op when source capture guards are enabled", async () => {
  const client = new StubInspirationEmbeddingPersistenceClient(0);

  const persisted = await persistInspirationEnrichment(client, {
    inspirationId: "insp_stale",
    enrichmentFields: createCompletedEnrichmentFields(
      new Date("2026-04-10T14:10:00.000Z"),
    ),
    expectedRawContent: "A capture that has already been edited elsewhere.",
    enrichmentStatus: "COMPLETED",
    ignoreIfSourceCaptureChanged: true,
    summary: "Stale summary should not overwrite the edited capture.",
  });

  assert.equal(persisted, false);
  assert.equal(client.executedSql.length, 1);
});

test("persistInspirationEnrichment rejects when the DB update does not touch any rows", async () => {
  const client = new StubInspirationEmbeddingPersistenceClient(0);

  await assert.rejects(
    async () =>
      persistInspirationEnrichment(client, {
        inspirationId: "missing_inspiration",
        actionability: "idea",
        domain: "technology",
        embedding: createEmbeddingVector(),
        enrichmentFields: createCompletedEnrichmentFields(
          new Date("2026-04-10T14:05:00.000Z"),
        ),
        enrichmentStatus: "COMPLETED",
        mood: "curious",
        summary: "A concise capture summary.",
        tags: ["capture"],
      }),
    /missing_inspiration was not found while saving its enrichment payload/,
  );
});
