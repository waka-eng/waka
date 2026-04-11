import assert from "node:assert/strict";
import test from "node:test";

import {
  createInspirationQueueRecordProcessingRequest,
} from "../apps/web/src/jobs/inspiration-queue.ts";
import type {
  ConnectionAnalysisPersistenceClient,
  UpsertConnectionAnalysisArgs,
} from "../apps/web/src/jobs/connection-analysis-persistence.ts";
import {
  prepareConnectionAnalysisWorkerProcessing,
  processConnectionAnalysisQueueMessage,
} from "../apps/web/src/jobs/process-connection-analysis-message.ts";
import type { InspirationSimilaritySearchRow } from "../apps/web/src/jobs/inspiration-similarity-search.ts";
import { OPENAI_EMBEDDING_DIMENSIONS } from "../packages/shared/llm/runtime.ts";

type SeededInspiration = {
  deletedAt?: string | null;
  embedding: readonly number[] | null;
  id: string;
  rawContent: string;
  sourceConversationRef?: string;
  userId: string;
};

function createEmbeddingVector(values: readonly number[]): number[] {
  const embedding = new Array<number>(OPENAI_EMBEDDING_DIMENSIONS).fill(0);

  values.forEach((value, index) => {
    embedding[index] = value;
  });

  return embedding;
}

function createSimilarityEmbedding(similarity: number): number[] {
  return createEmbeddingVector([
    similarity,
    Math.sqrt(1 - similarity * similarity),
    0,
  ]);
}

function parseVectorLiteral(sql: string): number[] {
  const match = sql.match(/'(\[[\d,.\-eE]+\])'::vector/);

  assert.ok(match?.[1], "Expected the similarity SQL to include a vector literal");

  return match[1]
    .slice(1, -1)
    .split(",")
    .map((value) => Number(value));
}

function parseIntegerLiteral(
  sql: string,
  pattern: RegExp,
  description: string,
): number {
  const match = sql.match(pattern);

  assert.ok(match?.[1], `Expected the similarity SQL to include ${description}`);

  return Number(match[1]);
}

function parseOptionalStringLiteral(
  sql: string,
  pattern: RegExp,
): string | undefined {
  const match = sql.match(pattern);

  return match?.[1];
}

function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;

    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

class StubConnectionAnalysisPersistenceClient
  implements ConnectionAnalysisPersistenceClient
{
  readonly executedSql: string[] = [];
  readonly findFirstCalls: Array<{ id: string; userId: string }> = [];
  private readonly inspirations: readonly SeededInspiration[];
  readonly upsertCalls: UpsertConnectionAnalysisArgs[] = [];

  constructor(inspirations: readonly SeededInspiration[]) {
    this.inspirations = inspirations;
  }

  readonly inspiration = {
    findFirst: async (args: {
      where: {
        deletedAt: null;
        id: string;
        userId: string;
      };
    }) => {
      this.findFirstCalls.push({
        id: args.where.id,
        userId: args.where.userId,
      });

      const inspiration = this.inspirations.find(
        (candidate) =>
          candidate.id === args.where.id &&
          candidate.userId === args.where.userId &&
          candidate.deletedAt == null,
      );

      return inspiration
        ? {
            embedding: inspiration.embedding,
            id: inspiration.id,
            rawContent: inspiration.rawContent,
          }
        : null;
    },
  };

  readonly connection = {
    upsert: async (args: UpsertConnectionAnalysisArgs) => {
      this.upsertCalls.push(args);

      return {
        id: `${args.where.sourceId_targetId.sourceId}:${args.where.sourceId_targetId.targetId}`,
      };
    },
  };

  async $queryRawUnsafe(sql: string): Promise<InspirationSimilaritySearchRow[]> {
    this.executedSql.push(sql);

    const queryEmbedding = parseVectorLiteral(sql);
    const limit = parseIntegerLiteral(sql, /LIMIT (\d+)$/, "a LIMIT clause");
    const userId = parseOptionalStringLiteral(sql, /WHERE "userId" = '([^']+)'/);
    const excludedInspirationId = parseOptionalStringLiteral(
      sql,
      /AND "id" <> '([^']+)'/,
    );
    const minimumSimilarityMatch = sql.match(
      /WHERE "similarity" >= ([\d.\-eE]+)/,
    );
    const minimumSimilarity =
      minimumSimilarityMatch?.[1] === undefined
        ? undefined
        : Number(minimumSimilarityMatch[1]);

    return this.inspirations
      .filter((inspiration) => inspiration.userId === userId)
      .filter((inspiration) => inspiration.deletedAt == null)
      .filter((inspiration) => inspiration.embedding !== null)
      .filter((inspiration) => inspiration.id !== excludedInspirationId)
      .map((inspiration) => ({
        id: inspiration.id,
        similarity: cosineSimilarity(
          queryEmbedding,
          inspiration.embedding as readonly number[],
        ),
        sourceConversationRef: inspiration.sourceConversationRef,
      }))
      .filter(
        (row) =>
          minimumSimilarity === undefined || row.similarity >= minimumSimilarity,
      )
      .sort(
        (left, right) =>
          right.similarity - left.similarity || left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        similarity: row.similarity.toString(),
        sourceConversationRef: row.sourceConversationRef,
      }));
  }
}

function createConnectionAnalysisProcessingRequest(
  payloadOverrides: Partial<{
    inspirationId: string;
    maxConnections: number;
    similarityThreshold: number;
    userId: string;
  }> = {},
) {
  const payload = {
    inspirationId: "insp_new",
    jobType: "connection_analysis" as const,
    userId: "user_capture",
    ...payloadOverrides,
  };
  const record = {
    body: JSON.stringify(payload),
    messageId: "message-connection-analysis",
  };

  return {
    ...createInspirationQueueRecordProcessingRequest(record),
    jobType: "connection_analysis" as const,
    payload,
  };
}

function createSeededInspirations(): SeededInspiration[] {
  return [
    {
      embedding: createEmbeddingVector([1, 0, 0]),
      id: "insp_new",
      rawContent: "Capture first, never lose the draft.",
      userId: "user_capture",
    },
    {
      embedding: createSimilarityEmbedding(0.99),
      id: "insp_1",
      rawContent: "Reliable capture keeps every draft durable.",
      sourceConversationRef: "ai-thread-1",
      userId: "user_capture",
    },
    {
      embedding: createSimilarityEmbedding(0.95),
      id: "insp_2",
      rawContent: "Offline notes should replay cleanly after reconnect.",
      userId: "user_capture",
    },
    {
      embedding: createSimilarityEmbedding(0.92),
      id: "insp_3",
      rawContent: "Queue retries matter more than fancy sync.",
      userId: "user_capture",
    },
    {
      embedding: createSimilarityEmbedding(0.89),
      id: "insp_4",
      rawContent: "Apple Notes speed is the bar for save latency.",
      userId: "user_capture",
    },
    {
      embedding: createSimilarityEmbedding(0.85),
      id: "insp_5",
      rawContent: "Prominent capture surfaces beat navigation-heavy flows.",
      userId: "user_capture",
    },
    {
      embedding: createSimilarityEmbedding(0.81),
      id: "insp_6",
      rawContent: "Last-write-wins is acceptable if the draft survives.",
      userId: "user_capture",
    },
    {
      embedding: createSimilarityEmbedding(0.77),
      id: "insp_7",
      rawContent: "This should stay below the similarity threshold.",
      userId: "user_capture",
    },
    {
      embedding: createSimilarityEmbedding(0.995),
      id: "insp_other_user",
      rawContent: "Other users must never leak into the connection set.",
      userId: "other_user",
    },
  ];
}

test("prepareConnectionAnalysisWorkerProcessing limits candidate discovery to the top five matches above the default 0.78 threshold", async () => {
  const persistenceClient = new StubConnectionAnalysisPersistenceClient(
    createSeededInspirations(),
  );

  const input = await prepareConnectionAnalysisWorkerProcessing(
    createConnectionAnalysisProcessingRequest(),
    {
      persistenceClient,
    },
  );

  assert.equal(input.maxConnections, 5);
  assert.equal(input.similarityThreshold, 0.78);
  assert.deepEqual(
    input.candidates.map((candidate) => candidate.id),
    ["insp_1", "insp_2", "insp_3", "insp_4", "insp_5"],
  );
  assert.equal(
    input.candidates.every((candidate) => candidate.similarity >= 0.78),
    true,
  );
  assert.equal(input.candidates[0]?.sourceConversationRef, "ai-thread-1");
  assert.match(persistenceClient.executedSql[0]!, /WHERE "similarity" >= 0\.78/);
  assert.match(persistenceClient.executedSql[0]!, /LIMIT 5$/);
});

test("processConnectionAnalysisQueueMessage never writes more than five connections even when the job payload requests a larger limit", async () => {
  const surfacedAt = new Date("2026-04-11T03:00:00.000Z");
  const persistenceClient = new StubConnectionAnalysisPersistenceClient(
    createSeededInspirations(),
  );
  const explainCalls: Array<{
    sourceContent: string;
    targetContent: string;
    traceId: string;
  }> = [];

  const input = await processConnectionAnalysisQueueMessage(
    createConnectionAnalysisProcessingRequest({
      maxConnections: 10,
    }),
    {
      nonEmbeddingClient: {
        async explainConnection(request) {
          explainCalls.push({
            sourceContent: request.input.sourceContent,
            targetContent: request.input.targetContent,
            traceId: request.traceId,
          });

          return {
            model: "gpt-4.1-mini",
            operation: "explainConnection",
            output: {
              explanation: `Durable capture links "${request.input.targetContent}" back to the new note.`,
            },
            provider: "openai",
            requestId: request.requestId,
            traceId: request.traceId,
          };
        },
      },
      now: () => surfacedAt,
      persistenceClient,
    },
  );

  assert.equal(input.maxConnections, 5);
  assert.equal(explainCalls.length, 5);
  assert.equal(persistenceClient.upsertCalls.length, 5);
  assert.deepEqual(
    persistenceClient.upsertCalls.map(
      (call) => call.where.sourceId_targetId.targetId,
    ),
    ["insp_1", "insp_2", "insp_3", "insp_4", "insp_5"],
  );
  assert.equal(
    persistenceClient.upsertCalls.every(
      (call) => call.create.similarityScore >= 0.78,
    ),
    true,
  );
  assert.equal(
    persistenceClient.upsertCalls.every(
      (call) => call.create.surfacedAt.toISOString() === surfacedAt.toISOString(),
    ),
    true,
  );
  assert.equal(
    persistenceClient.upsertCalls.every((call) =>
      call.create.explanation.includes("Durable capture links"),
    ),
    true,
  );
});
