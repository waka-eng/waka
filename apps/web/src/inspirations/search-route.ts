import type {
  GenerateEmbeddingRequest,
  GenerateEmbeddingResponse,
} from "../../../../packages/shared/llm/provider.ts";
import { serializeEmbeddingVector } from "../jobs/inspiration-embedding-persistence.ts";
import {
  SUPPORTED_INSPIRATION_SOURCE_TYPES,
  type InspirationSourceType,
} from "./create-route.ts";

export const SEARCH_INSPIRATIONS_ROUTE_OK_STATUS = 200;
export const SEARCH_INSPIRATIONS_ROUTE_BAD_REQUEST_STATUS = 400;
export const SEARCH_INSPIRATIONS_ROUTE_UNAUTHORIZED_STATUS = 401;
export const SEARCH_INSPIRATIONS_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const SEARCH_INSPIRATIONS_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const SEARCH_INSPIRATIONS_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const SEARCH_INSPIRATIONS_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Search inspirations route dependencies have not been configured.";
export const SEARCH_INSPIRATIONS_QUERY_REQUIRED_ERROR =
  "q must be at least 1 character.";

export const DEFAULT_SEMANTIC_SEARCH_LIMIT = 20;

export interface SemanticSearchResult {
  id: string;
  rawContent: string;
  similarity: number;
  sourceConversationRef?: string;
  sourceType: InspirationSourceType;
  summary?: string;
  title?: string;
}

export interface SemanticSearchResponseBody {
  results: SemanticSearchResult[];
}

export interface SearchInspirationsSqlInput {
  embedding: readonly number[];
  limit: number;
  userId: string;
}

export interface SemanticSearchPersistenceRow {
  id: unknown;
  rawContent: unknown;
  similarity: unknown;
  sourceConversationRef?: unknown;
  sourceType: unknown;
  summary?: unknown;
  title?: unknown;
  userId?: unknown;
}

export interface SearchInspirationsPersistenceClient<
  TRow extends SemanticSearchPersistenceRow = SemanticSearchPersistenceRow,
> {
  $queryRawUnsafe(sql: string): Promise<TRow[]>;
}

export interface SearchInspirationsEmbeddingClient {
  generateEmbedding(
    request: GenerateEmbeddingRequest,
  ): Promise<GenerateEmbeddingResponse>;
}

export interface SearchInspirationsRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface SearchInspirationsRouteDependencies<
  TRow extends SemanticSearchPersistenceRow = SemanticSearchPersistenceRow,
> {
  auth: SearchInspirationsRouteAuthResolver;
  embeddingClient: SearchInspirationsEmbeddingClient;
  persistence: SearchInspirationsPersistenceClient<TRow>;
}

export interface HandleSearchInspirationsRouteRequestOptions<
  TRow extends SemanticSearchPersistenceRow = SemanticSearchPersistenceRow,
> {
  dependencies?: SearchInspirationsRouteDependencies<TRow>;
}

let defaultSearchInspirationsRouteDependencies:
  | SearchInspirationsRouteDependencies
  | null = null;

function createJsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, {
    status,
  });
}

function readRequiredNonEmptyString(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }

  return value;
}

function escapePostgresStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError("Expected an optional string search result field.");
  }

  return value;
}

function normalizeSourceType(
  value: unknown,
  rowIndex: number,
): InspirationSourceType {
  if (
    typeof value === "string" &&
    SUPPORTED_INSPIRATION_SOURCE_TYPES.includes(value as InspirationSourceType)
  ) {
    return value as InspirationSourceType;
  }

  throw new TypeError(
    `Semantic search row ${rowIndex} returned an invalid sourceType value.`,
  );
}

function normalizeSimilarity(value: unknown, rowIndex: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsedValue = Number(value);

    if (Number.isFinite(parsedValue)) {
      return parsedValue;
    }
  }

  throw new TypeError(
    `Semantic search row ${rowIndex} returned a non-numeric similarity value.`,
  );
}

function normalizeOwnedUserId(value: unknown, rowIndex: number): string {
  return readRequiredNonEmptyString(
    typeof value === "string" ? value : "",
    `Semantic search row ${rowIndex} userId`,
  );
}

function readSemanticSearchQuery(request: Request): string {
  const query = new URL(request.url).searchParams.get("q")?.trim();

  if (!query) {
    throw new TypeError(SEARCH_INSPIRATIONS_QUERY_REQUIRED_ERROR);
  }

  return query;
}

function buildSemanticSearchEmbeddingRequest(
  query: string,
  userId: string,
): GenerateEmbeddingRequest {
  return {
    operation: "generateEmbedding",
    requestId: `semantic-search:${userId}`,
    traceId: query,
    input: {
      model: "embedding",
      text: query,
    },
  };
}

function resolveSearchInspirationsRouteDependencies<
  TRow extends SemanticSearchPersistenceRow = SemanticSearchPersistenceRow,
>(
  override?: SearchInspirationsRouteDependencies<TRow>,
): SearchInspirationsRouteDependencies<TRow> {
  if (override) {
    return override;
  }

  if (defaultSearchInspirationsRouteDependencies) {
    return defaultSearchInspirationsRouteDependencies as SearchInspirationsRouteDependencies<TRow>;
  }

  throw new Error(SEARCH_INSPIRATIONS_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isSearchInspirationsBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message === SEARCH_INSPIRATIONS_QUERY_REQUIRED_ERROR
  );
}

export function configureSearchInspirationsRouteDependencies(
  dependencies: SearchInspirationsRouteDependencies | null,
): void {
  defaultSearchInspirationsRouteDependencies = dependencies;
}

export function buildSearchInspirationsSql(
  input: SearchInspirationsSqlInput,
): string {
  const userId = readRequiredNonEmptyString(input.userId, "User id");
  const limit = readPositiveInteger(input.limit, "Limit");
  const vectorLiteral = escapePostgresStringLiteral(
    serializeEmbeddingVector(input.embedding),
  );
  const cteWhereClauses = [
    `  WHERE "userId" = ${escapePostgresStringLiteral(userId)}`,
    '    AND "embedding" IS NOT NULL',
    '    AND "deletedAt" IS NULL',
  ];

  return [
    'WITH "ranked_inspirations" AS (',
    "  SELECT",
    '    "id",',
    '    "userId",',
    '    "title",',
    '    "rawContent",',
    '    "summary",',
    '    "sourceConversationRef",',
    '    "sourceType",',
    `    1 - ("embedding" <=> ${vectorLiteral}::vector) AS "similarity"`,
    '  FROM "Inspiration"',
    ...cteWhereClauses,
    ")",
    "SELECT",
    '  "id",',
    '  "userId",',
    '  "title",',
    '  "rawContent",',
    '  "summary",',
    '  "sourceConversationRef",',
    '  "sourceType",',
    '  "similarity"',
    'FROM "ranked_inspirations"',
    'ORDER BY "similarity" DESC, "id" ASC',
    `LIMIT ${limit}`,
  ].join("\n");
}

export async function searchInspirationsByEmbedding<
  TRow extends SemanticSearchPersistenceRow,
>(
  client: SearchInspirationsPersistenceClient<TRow>,
  input: SearchInspirationsSqlInput,
): Promise<SemanticSearchResult[]> {
  const userId = readRequiredNonEmptyString(input.userId, "User id");
  const rows = await client.$queryRawUnsafe(
    buildSearchInspirationsSql({
      ...input,
      userId,
    }),
  );

  return rows.flatMap((row, index) => {
    if (normalizeOwnedUserId(row.userId, index) !== userId) {
      return [];
    }

    const sourceConversationRef = normalizeOptionalString(
      row.sourceConversationRef,
    );

    return [
      {
        id: readRequiredNonEmptyString(
          typeof row.id === "string" ? row.id : "",
          `Semantic search row ${index} id`,
        ),
        title: normalizeOptionalString(row.title),
        rawContent: readRequiredNonEmptyString(
          typeof row.rawContent === "string" ? row.rawContent : "",
          `Semantic search row ${index} rawContent`,
        ),
        summary: normalizeOptionalString(row.summary),
        ...(sourceConversationRef === undefined ? {} : { sourceConversationRef }),
        sourceType: normalizeSourceType(row.sourceType, index),
        similarity: normalizeSimilarity(row.similarity, index),
      },
    ];
  });
}

export async function handleSearchInspirationsRouteRequest<
  TRow extends SemanticSearchPersistenceRow = SemanticSearchPersistenceRow,
>(
  request: Request,
  options: HandleSearchInspirationsRouteRequestOptions<TRow> = {},
): Promise<Response> {
  let dependencies: SearchInspirationsRouteDependencies<TRow>;

  try {
    dependencies = resolveSearchInspirationsRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: SEARCH_INSPIRATIONS_ROUTE_INTERNAL_ERROR,
      },
      SEARCH_INSPIRATIONS_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: SEARCH_INSPIRATIONS_ROUTE_UNAUTHORIZED_ERROR,
      },
      SEARCH_INSPIRATIONS_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const query = readSemanticSearchQuery(request);
    const embeddingResponse =
      await dependencies.embeddingClient.generateEmbedding(
        buildSemanticSearchEmbeddingRequest(query, authenticatedUserId),
      );
    const results = await searchInspirationsByEmbedding(
      dependencies.persistence,
      {
        embedding: embeddingResponse.output.embedding,
        limit: DEFAULT_SEMANTIC_SEARCH_LIMIT,
        userId: authenticatedUserId,
      },
    );

    return createJsonResponse<SemanticSearchResponseBody>(
      {
        results,
      },
      SEARCH_INSPIRATIONS_ROUTE_OK_STATUS,
    );
  } catch (error) {
    if (isSearchInspirationsBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        SEARCH_INSPIRATIONS_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: SEARCH_INSPIRATIONS_ROUTE_INTERNAL_ERROR,
      },
      SEARCH_INSPIRATIONS_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
