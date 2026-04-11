import assert from "node:assert/strict";
import test from "node:test";

import type { GenerateEmbeddingRequest } from "../packages/shared/llm/provider.ts";
import { OPENAI_EMBEDDING_DIMENSIONS } from "../packages/shared/llm/runtime.ts";
import type {
  SearchInspirationsEmbeddingClient,
  SearchInspirationsPersistenceClient,
  SemanticSearchPersistenceRow,
} from "../apps/web/src/inspirations/search-route.ts";
import {
  DEFAULT_SEMANTIC_SEARCH_LIMIT,
  SEARCH_INSPIRATIONS_QUERY_REQUIRED_ERROR,
  SEARCH_INSPIRATIONS_ROUTE_BAD_REQUEST_STATUS,
  SEARCH_INSPIRATIONS_ROUTE_OK_STATUS,
  SEARCH_INSPIRATIONS_ROUTE_UNAUTHORIZED_ERROR,
  SEARCH_INSPIRATIONS_ROUTE_UNAUTHORIZED_STATUS,
  buildSearchInspirationsSql,
  configureSearchInspirationsRouteDependencies,
  handleSearchInspirationsRouteRequest,
  searchInspirationsByEmbedding,
} from "../apps/web/src/inspirations/search-route.ts";

type SeededInspiration = {
  deletedAt?: string | null;
  embedding: readonly number[];
  id: string;
  rawContent: string;
  sourceConversationRef?: string;
  sourceType:
    | "AI_CONVERSATION"
    | "CLI_CONVERSATION"
    | "PHOTO"
    | "TEXT_NOTE"
    | "URL_IMPORT"
    | "VOICE_NOTE";
  summary?: string;
  title?: string;
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

  assert.ok(match?.[1], "Expected the search SQL to include a vector literal");

  return match[1]
    .slice(1, -1)
    .split(",")
    .map((value) => Number(value));
}

function parseIntegerLiteral(sql: string, pattern: RegExp, description: string): number {
  const match = sql.match(pattern);

  assert.ok(match?.[1], `Expected the search SQL to include ${description}`);

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

class StubSemanticSearchPersistenceClient
  implements SearchInspirationsPersistenceClient<SemanticSearchPersistenceRow>
{
  readonly executedSql: string[] = [];
  private readonly inspirations: readonly SeededInspiration[];

  constructor(inspirations: readonly SeededInspiration[]) {
    this.inspirations = inspirations;
  }

  async $queryRawUnsafe(sql: string): Promise<SemanticSearchPersistenceRow[]> {
    this.executedSql.push(sql);

    const queryEmbedding = parseVectorLiteral(sql);
    const limit = parseIntegerLiteral(sql, /LIMIT (\d+)$/, "a LIMIT clause");
    const userId = parseOptionalStringLiteral(sql, /WHERE "userId" = '([^']+)'/);

    return this.inspirations
      .filter((inspiration) => inspiration.userId === userId)
      .filter((inspiration) => inspiration.deletedAt == null)
      .map((inspiration) => ({
        id: inspiration.id,
        userId: inspiration.userId,
        title: inspiration.title,
        rawContent: inspiration.rawContent,
        summary: inspiration.summary,
        sourceConversationRef: inspiration.sourceConversationRef,
        sourceType: inspiration.sourceType,
        similarity: cosineSimilarity(queryEmbedding, inspiration.embedding),
      }))
      .sort(
        (left, right) =>
          Number(right.similarity) - Number(left.similarity) ||
          String(left.id).localeCompare(String(right.id)),
      )
      .slice(0, limit)
      .map((row) => ({
        ...row,
        similarity: String(row.similarity),
      }));
  }
}

class StubSemanticSearchEmbeddingClient
  implements SearchInspirationsEmbeddingClient
{
  readonly requests: GenerateEmbeddingRequest[] = [];
  private readonly embeddingByText: Map<string, readonly number[]>;

  constructor(embeddingByText: Record<string, readonly number[]>) {
    this.embeddingByText = new Map(Object.entries(embeddingByText));
  }

  async generateEmbedding(request: GenerateEmbeddingRequest) {
    this.requests.push(request);

    const embedding = this.embeddingByText.get(request.input.text);

    assert.ok(
      embedding,
      `No embedding fixture was configured for "${request.input.text}".`,
    );

    return {
      operation: "generateEmbedding" as const,
      model: "text-embedding-3-small",
      output: {
        embedding: [...embedding],
        dimensions: embedding.length,
      },
      provider: "openai" as const,
      requestId: request.requestId,
      traceId: request.traceId,
    };
  }
}

test("buildSearchInspirationsSql emits a user-scoped pgvector search query ordered by similarity", () => {
  const sql = buildSearchInspirationsSql({
    embedding: createEmbeddingVector([1, 0, 0]),
    limit: DEFAULT_SEMANTIC_SEARCH_LIMIT,
    userId: "user_ai",
  });

  assert.match(sql, /^WITH "ranked_inspirations" AS \(/m);
  assert.match(sql, /1 - \("embedding" <=> '\[/);
  assert.match(sql, /FROM "Inspiration"/);
  assert.match(
    sql,
    /SELECT[\s\S]*"userId",[\s\S]*"title",[\s\S]*"rawContent",[\s\S]*"summary",[\s\S]*"sourceConversationRef"/,
  );
  assert.match(sql, /WHERE "userId" = 'user_ai'/);
  assert.match(sql, /AND "embedding" IS NOT NULL/);
  assert.match(sql, /AND "deletedAt" IS NULL/);
  assert.match(sql, /ORDER BY "similarity" DESC, "id" ASC/);
  assert.match(sql, new RegExp(`LIMIT ${DEFAULT_SEMANTIC_SEARCH_LIMIT}$`));
});

test("searchInspirationsByEmbedding returns typed results sorted by similarity", async () => {
  const persistence = new StubSemanticSearchPersistenceClient([
    {
      id: "insp_machine_learning",
      userId: "user_ai",
      rawContent: "Machine learning systems for creative tools.",
      summary: "Machine learning ideas",
      sourceType: "TEXT_NOTE",
      title: "Machine learning",
      embedding: createEmbeddingVector([0.99, 0.01, 0]),
    },
    {
      id: "insp_ai_safety",
      userId: "user_ai",
      rawContent: "AI safety checkpoints for product launches.",
      sourceType: "TEXT_NOTE",
      embedding: createEmbeddingVector([0.94, 0.06, 0]),
    },
    {
      id: "insp_design",
      userId: "user_ai",
      rawContent: "Design references for gallery layouts.",
      sourceType: "TEXT_NOTE",
      embedding: createEmbeddingVector([0, 1, 0]),
    },
  ]);

  const results = await searchInspirationsByEmbedding(persistence, {
    embedding: createEmbeddingVector([1, 0, 0]),
    limit: 2,
    userId: "user_ai",
  });

  assert.deepEqual(
    results.map((result) => result.id),
    ["insp_machine_learning", "insp_ai_safety"],
  );
  assert.equal(results[0]?.title, "Machine learning");
  assert.equal(results[0]!.similarity >= results[1]!.similarity, true);
});

test("searchInspirationsByEmbedding preserves AI conversation linkage for downstream resurfacing consumers", async () => {
  const persistence = new StubSemanticSearchPersistenceClient([
    {
      id: "insp_ai_thread",
      userId: "user_ai",
      rawContent: "Imported AI conversation about durable capture.",
      sourceConversationRef:
        "ai-conversation-ref:v1:chatgpt:conversation=thread-456",
      sourceType: "AI_CONVERSATION",
      embedding: createEmbeddingVector([1, 0, 0]),
    },
  ]);

  const results = await searchInspirationsByEmbedding(persistence, {
    embedding: createEmbeddingVector([1, 0, 0]),
    limit: 1,
    userId: "user_ai",
  });

  assert.deepEqual(results, [
    {
      id: "insp_ai_thread",
      rawContent: "Imported AI conversation about durable capture.",
      similarity: 1,
      sourceConversationRef:
        "ai-conversation-ref:v1:chatgpt:conversation=thread-456",
      sourceType: "AI_CONVERSATION",
      summary: undefined,
      title: undefined,
    },
  ]);
});

test("handleSearchInspirationsRouteRequest includes sourceConversationRef in resurfaced AI conversation results", async () => {
  const embeddingClient = new StubSemanticSearchEmbeddingClient({
    AI: createEmbeddingVector([1, 0, 0]),
  });
  const persistence = new StubSemanticSearchPersistenceClient([
    {
      id: "insp_ai_import",
      userId: "user_ai",
      rawContent: "Imported thread about clustering notes.",
      sourceConversationRef:
        "ai-conversation-ref:v1:claude:url=https://claude.ai/share/thread-789",
      sourceType: "AI_CONVERSATION",
      embedding: createEmbeddingVector([1, 0, 0]),
    },
  ]);

  const response = await handleSearchInspirationsRouteRequest(
    new Request("https://waka.app/api/inspirations/search?q=AI"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user_ai";
          },
        },
        embeddingClient,
        persistence,
      },
    },
  );

  assert.equal(response.status, SEARCH_INSPIRATIONS_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    results: [
      {
        id: "insp_ai_import",
        rawContent: "Imported thread about clustering notes.",
        similarity: 1,
        sourceConversationRef:
          "ai-conversation-ref:v1:claude:url=https://claude.ai/share/thread-789",
        sourceType: "AI_CONVERSATION",
      },
    ],
  });
});

test("searchInspirationsByEmbedding discards rows outside the authenticated user scope", async () => {
  const persistence: SearchInspirationsPersistenceClient<SemanticSearchPersistenceRow> =
    {
      async $queryRawUnsafe() {
        return [
          {
            id: "insp_owned",
            userId: "user_ai",
            rawContent: "Keep this result.",
            sourceType: "TEXT_NOTE",
            similarity: "0.98",
          },
          {
            id: "insp_other_user",
            userId: "user_other",
            rawContent: "This result should never leak.",
            sourceType: "TEXT_NOTE",
            similarity: "0.99",
          },
        ];
      },
    };

  const results = await searchInspirationsByEmbedding(persistence, {
    embedding: createEmbeddingVector([1, 0, 0]),
    limit: 2,
    userId: "user_ai",
  });

  assert.deepEqual(results, [
    {
      id: "insp_owned",
      rawContent: "Keep this result.",
      similarity: 0.98,
      sourceType: "TEXT_NOTE",
      summary: undefined,
      title: undefined,
    },
  ]);
});

test("handleSearchInspirationsRouteRequest returns 401 when the caller is not authenticated", async () => {
  const embeddingClient = new StubSemanticSearchEmbeddingClient({
    AI: createEmbeddingVector([1, 0, 0]),
  });
  const persistence = new StubSemanticSearchPersistenceClient([]);

  const response = await handleSearchInspirationsRouteRequest(
    new Request("https://waka.app/api/inspirations/search?q=AI"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return null;
          },
        },
        embeddingClient,
        persistence,
      },
    },
  );

  assert.equal(response.status, SEARCH_INSPIRATIONS_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: SEARCH_INSPIRATIONS_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(embeddingClient.requests.length, 0);
  assert.equal(persistence.executedSql.length, 0);
});

test("handleSearchInspirationsRouteRequest rejects missing or blank q values", async () => {
  const embeddingClient = new StubSemanticSearchEmbeddingClient({
    AI: createEmbeddingVector([1, 0, 0]),
  });
  const persistence = new StubSemanticSearchPersistenceClient([]);

  const response = await handleSearchInspirationsRouteRequest(
    new Request("https://waka.app/api/inspirations/search?q=%20%20%20"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user_ai";
          },
        },
        embeddingClient,
        persistence,
      },
    },
  );

  assert.equal(response.status, SEARCH_INSPIRATIONS_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await response.json(), {
    error: SEARCH_INSPIRATIONS_QUERY_REQUIRED_ERROR,
  });
  assert.equal(embeddingClient.requests.length, 0);
  assert.equal(persistence.executedSql.length, 0);
});

test("handleSearchInspirationsRouteRequest returns semantically relevant results for the current user only", async () => {
  const embeddingClient = new StubSemanticSearchEmbeddingClient({
    AI: createEmbeddingVector([1, 0, 0]),
  });
  const persistence = new StubSemanticSearchPersistenceClient([
    {
      id: "insp_machine_learning",
      userId: "user_ai",
      rawContent: "Machine learning note from the research backlog.",
      summary: "Relevant AI note",
      sourceType: "TEXT_NOTE",
      title: "Machine learning",
      embedding: createEmbeddingVector([0.995, 0.005, 0]),
    },
    {
      id: "insp_agents",
      userId: "user_ai",
      rawContent: "Autonomous agents orchestration ideas.",
      sourceType: "TEXT_NOTE",
      title: "Agents",
      embedding: createEmbeddingVector([0.96, 0.04, 0]),
    },
    {
      id: "insp_architecture",
      userId: "user_ai",
      rawContent: "Warehouse architecture sketches.",
      sourceType: "TEXT_NOTE",
      embedding: createEmbeddingVector([0.1, 0.9, 0]),
    },
    {
      id: "insp_other_user",
      userId: "user_other",
      rawContent: "Machine learning note that must stay private.",
      sourceType: "TEXT_NOTE",
      embedding: createEmbeddingVector([1, 0, 0]),
    },
    {
      id: "insp_deleted",
      userId: "user_ai",
      deletedAt: "2026-04-10T00:00:00.000Z",
      rawContent: "Deleted machine learning note.",
      sourceType: "TEXT_NOTE",
      embedding: createEmbeddingVector([0.999, 0.001, 0]),
    },
  ]);

  const response = await handleSearchInspirationsRouteRequest(
    new Request("https://waka.app/api/inspirations/search?q=AI"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user_ai";
          },
        },
        embeddingClient,
        persistence,
      },
    },
  );

  assert.equal(response.status, SEARCH_INSPIRATIONS_ROUTE_OK_STATUS);

  const payload = (await response.json()) as {
    results: Array<{
      id: string;
      rawContent: string;
      similarity: number;
      title?: string;
    }>;
  };

  assert.deepEqual(
    payload.results.map((result) => result.id),
    ["insp_machine_learning", "insp_agents", "insp_architecture"],
  );
  assert.equal(
    payload.results[0]?.rawContent,
    "Machine learning note from the research backlog.",
  );
  assert.equal(
    payload.results[0]!.similarity >= payload.results[1]!.similarity,
    true,
  );
  assert.equal(
    payload.results[1]!.similarity >= payload.results[2]!.similarity,
    true,
  );
  assert.deepEqual(embeddingClient.requests.map((request) => request.input.text), [
    "AI",
  ]);
  assert.match(persistence.executedSql[0]!, /WHERE "userId" = 'user_ai'/);
});

test("handleSearchInspirationsRouteRequest excludes matching inspirations owned by another account", async () => {
  const embeddingClient = new StubSemanticSearchEmbeddingClient({
    "launch notes": createEmbeddingVector([1, 0, 0]),
  });
  const persistence: SearchInspirationsPersistenceClient<SemanticSearchPersistenceRow> =
    {
      async $queryRawUnsafe() {
        return [
          {
            id: "insp_owned_match",
            userId: "user_owner",
            rawContent: "Launch notes for the capture rollout.",
            sourceType: "TEXT_NOTE",
            similarity: "0.99",
            title: "Owned launch notes",
          },
          {
            id: "insp_foreign_match",
            userId: "user_other",
            rawContent: "Launch notes for the capture rollout.",
            sourceType: "TEXT_NOTE",
            similarity: "0.999",
            title: "Foreign launch notes",
          },
        ];
      },
    };

  const response = await handleSearchInspirationsRouteRequest(
    new Request("https://waka.app/api/inspirations/search?q=launch%20notes"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user_owner";
          },
        },
        embeddingClient,
        persistence,
      },
    },
  );

  assert.equal(response.status, SEARCH_INSPIRATIONS_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    results: [
      {
        id: "insp_owned_match",
        rawContent: "Launch notes for the capture rollout.",
        similarity: 0.99,
        sourceType: "TEXT_NOTE",
        title: "Owned launch notes",
      },
    ],
  });
  assert.deepEqual(embeddingClient.requests.map((request) => request.input.text), [
    "launch notes",
  ]);
});

test("app/api/inspirations/search/route.ts delegates GET requests and preserves user scoping", async () => {
  configureSearchInspirationsRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    embeddingClient: new StubSemanticSearchEmbeddingClient({
      AI: createEmbeddingVector([1, 0, 0]),
    }),
    persistence: {
      async $queryRawUnsafe() {
        return [
          {
            id: "insp-route",
            userId: "user-route",
            rawContent: "Route-owned search result.",
            sourceType: "TEXT_NOTE",
            similarity: "0.97",
          },
          {
            id: "insp-foreign",
            userId: "user-foreign",
            rawContent: "Should be filtered before response serialization.",
            sourceType: "TEXT_NOTE",
            similarity: "0.99",
          },
        ];
      },
    },
  });

  try {
    const { GET } = await import("../apps/web/app/api/inspirations/search/route.ts");
    const response = await GET(
      new Request("https://waka.app/api/inspirations/search?q=AI") as never,
    );

    assert.equal(response.status, SEARCH_INSPIRATIONS_ROUTE_OK_STATUS);
    assert.deepEqual(await response.json(), {
      results: [
        {
          id: "insp-route",
          rawContent: "Route-owned search result.",
          similarity: 0.97,
          sourceType: "TEXT_NOTE",
        },
      ],
    });
  } finally {
    configureSearchInspirationsRouteDependencies(null);
  }
});
