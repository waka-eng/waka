import assert from "node:assert/strict";
import test from "node:test";

import type {
  InspirationSimilaritySearchClient,
  InspirationSimilaritySearchRow,
} from "../apps/web/src/jobs/inspiration-similarity-search.ts";
import {
  buildFindNearestInspirationsSql,
  findNearestInspirations,
} from "../apps/web/src/jobs/inspiration-similarity-search.ts";
import { OPENAI_EMBEDDING_DIMENSIONS } from "../packages/shared/llm/runtime.ts";

type SeededInspiration = {
  deletedAt?: string | null;
  embedding: readonly number[];
  id: string;
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

function parseVectorLiteral(sql: string): number[] {
  const match = sql.match(/'(\[[\d,.\-eE]+\])'::vector/);

  assert.ok(match?.[1], "Expected the similarity SQL to include a vector literal");

  return match[1]
    .slice(1, -1)
    .split(",")
    .map((value) => Number(value));
}

function parseIntegerLiteral(sql: string, pattern: RegExp, description: string): number {
  const match = sql.match(pattern);

  assert.ok(match?.[1], `Expected the similarity SQL to include ${description}`);

  return Number(match[1]);
}

function parseOptionalStringLiteral(sql: string, pattern: RegExp): string | undefined {
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

class StubInspirationSimilaritySearchClient
  implements InspirationSimilaritySearchClient<InspirationSimilaritySearchRow>
{
  readonly executedSql: string[] = [];
  private readonly inspirations: readonly SeededInspiration[];

  constructor(inspirations: readonly SeededInspiration[]) {
    this.inspirations = inspirations;
  }

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
      .filter((inspiration) => inspiration.id !== excludedInspirationId)
      .map((inspiration) => ({
        id: inspiration.id,
        similarity: cosineSimilarity(queryEmbedding, inspiration.embedding),
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

test("buildFindNearestInspirationsSql emits a pgvector cosine-similarity query", () => {
  const sql = buildFindNearestInspirationsSql({
    embedding: createEmbeddingVector([1, 0, 0]),
    excludeInspirationId: "insp_self",
    limit: 3,
    minSimilarity: 0.78,
    userId: "user_capture",
  });

  assert.match(sql, /^WITH "ranked_inspirations" AS \(/m);
  assert.match(sql, /1 - \("embedding" <=> '\[/);
  assert.match(sql, /FROM "Inspiration"/);
  assert.match(sql, /SELECT[\s\S]*"sourceConversationRef"/);
  assert.match(sql, /WHERE "userId" = 'user_capture'/);
  assert.match(sql, /AND "embedding" IS NOT NULL/);
  assert.match(sql, /AND "deletedAt" IS NULL/);
  assert.match(sql, /AND "id" <> 'insp_self'/);
  assert.match(sql, /WHERE "similarity" >= 0\.78/);
  assert.match(sql, /ORDER BY "similarity" DESC, "id" ASC/);
  assert.match(sql, /LIMIT 3$/);
});

test("findNearestInspirations returns the top-K nearest vectors for the same user", async () => {
  const queryEmbedding = createEmbeddingVector([1, 0, 0]);
  const client = new StubInspirationSimilaritySearchClient([
    {
      id: "insp_1",
      userId: "user_capture",
      embedding: createEmbeddingVector([1, 0, 0]),
    },
    {
      id: "insp_2",
      userId: "user_capture",
      embedding: createEmbeddingVector([0.97, 0.03, 0]),
    },
    {
      id: "insp_3",
      userId: "user_capture",
      embedding: createEmbeddingVector([0.92, 0.08, 0]),
    },
    {
      id: "insp_4",
      userId: "user_capture",
      embedding: createEmbeddingVector([0.8, 0.2, 0]),
    },
    {
      id: "insp_5",
      userId: "user_capture",
      embedding: createEmbeddingVector([0.65, 0.35, 0]),
    },
    {
      id: "insp_6",
      userId: "user_capture",
      embedding: createEmbeddingVector([0.35, 0.65, 0]),
    },
    {
      id: "insp_7",
      userId: "user_capture",
      embedding: createEmbeddingVector([0, 1, 0]),
    },
    {
      id: "insp_8",
      userId: "user_capture",
      embedding: createEmbeddingVector([-1, 0, 0]),
    },
    {
      id: "insp_9",
      userId: "other_user",
      embedding: createEmbeddingVector([1, 0, 0]),
    },
    {
      id: "insp_10",
      userId: "user_capture",
      deletedAt: "2026-04-10T00:00:00.000Z",
      embedding: createEmbeddingVector([0.999, 0.001, 0]),
    },
  ]);

  const matches = await findNearestInspirations(client, {
    embedding: queryEmbedding,
    limit: 3,
    userId: "user_capture",
  });

  assert.deepEqual(
    matches.map((match) => match.id),
    ["insp_1", "insp_2", "insp_3"],
  );
  assert.equal(matches.length, 3);
  assert.equal(matches.every((match) => typeof match.similarity === "number"), true);
  assert.equal(matches[0]!.similarity >= matches[1]!.similarity, true);
  assert.equal(matches[1]!.similarity >= matches[2]!.similarity, true);
  assert.match(client.executedSql[0]!, /<=>/);
});

test("findNearestInspirations exposes the persisted AI conversation linkage when present", async () => {
  const client = new StubInspirationSimilaritySearchClient([
    {
      id: "insp_ai_thread",
      userId: "user_capture",
      sourceConversationRef:
        "ai-conversation-ref:v1:chatgpt:conversation=thread-123",
      embedding: createEmbeddingVector([1, 0, 0]),
    },
  ]);

  const matches = await findNearestInspirations(client, {
    embedding: createEmbeddingVector([1, 0, 0]),
    limit: 1,
    userId: "user_capture",
  });

  assert.deepEqual(matches, [
    {
      id: "insp_ai_thread",
      similarity: 1,
      sourceConversationRef:
        "ai-conversation-ref:v1:chatgpt:conversation=thread-123",
    },
  ]);
});

test("findNearestInspirations applies exclusion and minimum similarity filters", async () => {
  const client = new StubInspirationSimilaritySearchClient([
    {
      id: "insp_1",
      userId: "user_capture",
      embedding: createEmbeddingVector([1, 0, 0]),
    },
    {
      id: "insp_2",
      userId: "user_capture",
      embedding: createEmbeddingVector([0.9, 0.1, 0]),
    },
    {
      id: "insp_3",
      userId: "user_capture",
      embedding: createEmbeddingVector([0.5, 0.5, 0]),
    },
  ]);

  const matches = await findNearestInspirations(client, {
    embedding: createEmbeddingVector([1, 0, 0]),
    excludeInspirationId: "insp_1",
    limit: 3,
    minSimilarity: 0.95,
    userId: "user_capture",
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.id, "insp_2");
  assert.equal(matches[0]!.similarity >= 0.95, true);
});
