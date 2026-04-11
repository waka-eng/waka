import type { InspirationSimilaritySearchClient } from "./inspiration-similarity-search.ts";

export interface ConnectionAnalysisInspirationRecord {
  embedding?: readonly number[] | null;
  id: string;
  rawContent: string;
}

export interface ConnectionAnalysisPersistedConnectionRecord {
  id: string;
}

export interface FindConnectionAnalysisInspirationArgs {
  select: {
    embedding: true;
    id: true;
    rawContent: true;
  };
  where: {
    deletedAt: null;
    id: string;
    userId: string;
  };
}

export interface UpsertConnectionAnalysisMatchInput {
  explanation: string;
  similarityScore: number;
  sourceId: string;
  surfacedAt: Date;
  targetId: string;
  userId: string;
}

export interface UpsertConnectionAnalysisArgs {
  create: {
    explanation: string;
    similarityScore: number;
    sourceId: string;
    surfacedAt: Date;
    targetId: string;
    userId: string;
  };
  update: {
    explanation: string;
    similarityScore: number;
    surfacedAt: Date;
  };
  where: {
    sourceId_targetId: {
      sourceId: string;
      targetId: string;
    };
  };
}

export interface ConnectionAnalysisPersistenceClient<
  TInspirationRecord extends ConnectionAnalysisInspirationRecord = ConnectionAnalysisInspirationRecord,
  TConnectionRecord extends ConnectionAnalysisPersistedConnectionRecord = ConnectionAnalysisPersistedConnectionRecord,
> extends InspirationSimilaritySearchClient {
  inspiration: {
    findFirst(
      args: FindConnectionAnalysisInspirationArgs,
    ): Promise<TInspirationRecord | null>;
  };
  connection: {
    upsert(args: UpsertConnectionAnalysisArgs): Promise<TConnectionRecord>;
  };
}

function readRequiredNonEmptyString(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readSimilarityScore(value: number): number {
  if (!Number.isFinite(value) || value < -1 || value > 1) {
    throw new RangeError(
      "Connection similarityScore must be a finite number between -1 and 1.",
    );
  }

  return value;
}

export function buildFindConnectionAnalysisInspirationArgs(
  userId: string,
  inspirationId: string,
): FindConnectionAnalysisInspirationArgs {
  return {
    select: {
      embedding: true,
      id: true,
      rawContent: true,
    },
    where: {
      deletedAt: null,
      id: readRequiredNonEmptyString(inspirationId, "Inspiration id"),
      userId: readRequiredNonEmptyString(userId, "User id"),
    },
  };
}

export async function findInspirationForConnectionAnalysis<
  TInspirationRecord extends ConnectionAnalysisInspirationRecord,
>(
  client: ConnectionAnalysisPersistenceClient<TInspirationRecord>,
  userId: string,
  inspirationId: string,
): Promise<TInspirationRecord | null> {
  return client.inspiration.findFirst(
    buildFindConnectionAnalysisInspirationArgs(userId, inspirationId),
  );
}

export function buildUpsertConnectionAnalysisArgs(
  input: UpsertConnectionAnalysisMatchInput,
): UpsertConnectionAnalysisArgs {
  const sourceId = readRequiredNonEmptyString(input.sourceId, "Source inspiration id");
  const targetId = readRequiredNonEmptyString(input.targetId, "Target inspiration id");

  if (sourceId === targetId) {
    throw new RangeError("Connection source and target inspirations must differ.");
  }

  const explanation = readRequiredNonEmptyString(
    input.explanation,
    "Connection explanation",
  );
  const similarityScore = readSimilarityScore(input.similarityScore);

  return {
    create: {
      explanation,
      similarityScore,
      sourceId,
      surfacedAt: input.surfacedAt,
      targetId,
      userId: readRequiredNonEmptyString(input.userId, "Connection user id"),
    },
    update: {
      explanation,
      similarityScore,
      surfacedAt: input.surfacedAt,
    },
    where: {
      sourceId_targetId: {
        sourceId,
        targetId,
      },
    },
  };
}

export async function upsertConnectionAnalysisMatch<
  TInspirationRecord extends ConnectionAnalysisInspirationRecord,
  TConnectionRecord extends ConnectionAnalysisPersistedConnectionRecord,
>(
  client: ConnectionAnalysisPersistenceClient<
    TInspirationRecord,
    TConnectionRecord
  >,
  input: UpsertConnectionAnalysisMatchInput,
): Promise<TConnectionRecord> {
  return client.connection.upsert(buildUpsertConnectionAnalysisArgs(input));
}
