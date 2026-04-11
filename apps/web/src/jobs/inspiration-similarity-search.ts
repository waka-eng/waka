import { serializeEmbeddingVector } from "./inspiration-embedding-persistence.ts";

export interface InspirationSimilarityMatch {
  id: string;
  similarity: number;
  sourceConversationRef?: string;
}

export interface FindNearestInspirationsInput {
  embedding: readonly number[];
  excludeInspirationId?: string;
  limit: number;
  minSimilarity?: number;
  userId: string;
}

export interface InspirationSimilaritySearchRow {
  id: unknown;
  similarity: unknown;
  sourceConversationRef?: unknown;
}

export interface InspirationSimilaritySearchClient<
  TRow extends InspirationSimilaritySearchRow = InspirationSimilaritySearchRow,
> {
  $queryRawUnsafe(sql: string): Promise<TRow[]>;
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

function readSimilarityThreshold(value: number): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new RangeError(
      "Minimum similarity must be a finite number between -1 and 1.",
    );
  }

  return value;
}

function escapePostgresStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
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
    `Similarity search row ${rowIndex} returned a non-numeric similarity value.`,
  );
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError(
      "Expected an optional string similarity search result field.",
    );
  }

  return value;
}

export function buildFindNearestInspirationsSql(
  input: FindNearestInspirationsInput,
): string {
  const userId = readRequiredNonEmptyString(input.userId, "User id");
  const limit = readPositiveInteger(input.limit, "Limit");
  const vectorLiteral = escapePostgresStringLiteral(
    serializeEmbeddingVector(input.embedding),
  );
  const excludeInspirationId =
    input.excludeInspirationId === undefined
      ? undefined
      : readRequiredNonEmptyString(
          input.excludeInspirationId,
          "Excluded inspiration id",
        );
  const minSimilarity =
    input.minSimilarity === undefined
      ? undefined
      : readSimilarityThreshold(input.minSimilarity);

  const cteWhereClauses = [
    `WHERE "userId" = ${escapePostgresStringLiteral(userId)}`,
    '  AND "embedding" IS NOT NULL',
    '  AND "deletedAt" IS NULL',
  ];

  if (excludeInspirationId) {
    cteWhereClauses.push(
      `  AND "id" <> ${escapePostgresStringLiteral(excludeInspirationId)}`,
    );
  }

  return [
    'WITH "ranked_inspirations" AS (',
    "  SELECT",
    '    "id",',
    '    "sourceConversationRef",',
    `    1 - ("embedding" <=> ${vectorLiteral}::vector) AS "similarity"`,
    '  FROM "Inspiration"',
    ...cteWhereClauses,
    ")",
    "SELECT",
    '  "id",',
    '  "sourceConversationRef",',
    '  "similarity"',
    'FROM "ranked_inspirations"',
    ...(minSimilarity === undefined
      ? []
      : [`WHERE "similarity" >= ${minSimilarity.toString()}`]),
    'ORDER BY "similarity" DESC, "id" ASC',
    `LIMIT ${limit}`,
  ].join("\n");
}

export async function findNearestInspirations<
  TRow extends InspirationSimilaritySearchRow,
>(
  client: InspirationSimilaritySearchClient<TRow>,
  input: FindNearestInspirationsInput,
): Promise<InspirationSimilarityMatch[]> {
  const rows = await client.$queryRawUnsafe(
    buildFindNearestInspirationsSql(input),
  );

  return rows.map((row, index) => {
    const sourceConversationRef = normalizeOptionalString(
      row.sourceConversationRef,
    );

    return {
      id: readRequiredNonEmptyString(
        typeof row.id === "string" ? row.id : "",
        `Similarity search row ${index} id`,
      ),
      similarity: normalizeSimilarity(row.similarity, index),
      ...(sourceConversationRef === undefined ? {} : { sourceConversationRef }),
    };
  });
}
