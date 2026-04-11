import {
  isLLMProviderError,
} from "../../../../packages/shared/llm/provider.ts";
import { OPENAI_EMBEDDING_DIMENSIONS } from "../../../../packages/shared/llm/runtime.ts";
import {
  buildFailedInspirationEnrichmentFields,
  buildProcessingInspirationEnrichmentFields,
  type InspirationEnrichmentErrorDetails,
  type InspirationEnrichmentFieldName,
  type InspirationEnrichmentFields,
} from "../inspirations/enrichment-field-metadata.ts";
import type { InspirationEnrichmentResumeState } from "../inspirations/enrichment-resume-state.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INSPIRATION_ENRICHMENT_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_STATUS_FAILED,
  INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
  type InspirationEnrichmentRetryability,
} from "../inspirations/enrichment-pipeline.ts";
import { classifyInspirationAiFieldGenerationFailure } from "./inspiration-ai-field-generation-policy.ts";
import { classifyInspirationJobFailureRetryability } from "./inspiration-job-failure.ts";

export interface InspirationEmbeddingRecord {
  actionability?: string | null;
  domain?: string | null;
  embedding?: number[] | null;
  enrichmentFields?: InspirationEnrichmentFields | null;
  id: string;
  mediaUrl?: string | null;
  mood?: string | null;
  rawContent: string;
  reflectionAnswer?: string | null;
  reflectionPrompt?: string | null;
  reflectionStatus?: string | null;
  sourceConversationRef?: string | null;
  sourceMeta?: Record<string, unknown> | null;
  sourceExpansions?:
    | readonly InspirationEmbeddingSourceExpansionRecord[]
    | null;
  sourceType?: string | null;
  sourceUrl?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  title?: string | null;
  transcript?: string | null;
  enrichmentResumeState?: InspirationEnrichmentResumeState | null;
  userId?: string | null;
}

export interface InspirationEmbeddingSourceExpansionRecord {
  rawContent: string;
}

export interface InspirationEnrichmentLifecycleRecord {
  id: string;
}

export interface FindInspirationForEmbeddingArgs {
  where: {
    id: string;
  };
  select: {
    actionability: true;
    domain: true;
    embedding: true;
    enrichmentFields: true;
    id: true;
    mediaUrl: true;
    mood: true;
    rawContent: true;
    reflectionAnswer: true;
    reflectionPrompt: true;
    reflectionStatus: true;
    sourceConversationRef: true;
    sourceMeta: true;
    sourceExpansions: {
      orderBy: Array<{
        createdAt: "asc";
      }>;
      select: {
        rawContent: true;
      };
      where: {
        deletedAt: null;
      };
    };
    sourceType: true;
    sourceUrl: true;
    summary: true;
    tags: true;
    title: true;
    transcript: true;
    enrichmentResumeState: true;
    userId: true;
  };
}

export interface PersistInspirationEnrichmentInput {
  actionability?: string;
  domain?: string;
  embedding?: readonly number[];
  enrichmentFields: InspirationEnrichmentFields;
  expectedRawContent?: string;
  enrichmentLastError?: InspirationEnrichmentErrorDetails | null;
  enrichmentLastFailureReason?: string | null;
  enrichmentLastFailureRetryability?: InspirationEnrichmentRetryability | null;
  enrichmentResumeState?: InspirationEnrichmentResumeState | null;
  enrichmentStatus: string;
  ignoreIfSourceCaptureChanged?: boolean;
  inspirationId: string;
  mood?: string;
  rawContent?: string;
  reflectionPrompt?: string | null;
  reflectionStatus?: string;
  sourceMeta?: Record<string, unknown>;
  sourceConversationRef?: string;
  summary?: string;
  tags?: readonly string[];
  title?: string;
}

export interface IncrementIntegerFieldOperation {
  increment: number;
}

export interface UpdateInspirationEnrichmentLifecycleArgs {
  data: {
    enrichmentAttemptCount?: IncrementIntegerFieldOperation;
    enrichmentCompletedAt?: Date | null;
    enrichmentFailedAt?: Date | null;
    enrichmentFields?: InspirationEnrichmentFields;
    enrichmentLastError?: InspirationEnrichmentErrorDetails | null;
    enrichmentLastFailureReason?: string | null;
    enrichmentLastFailureRetryability?: InspirationEnrichmentRetryability | null;
    enrichmentMaxAttemptCount?: number;
    enrichmentResumeState?: InspirationEnrichmentResumeState | null;
    enrichmentStartedAt?: Date | null;
    enrichmentStatus: string;
  };
  select: {
    id: true;
  };
  where: {
    id: string;
  };
}

export interface InspirationEmbeddingPersistenceClient<
  TRecord extends InspirationEmbeddingRecord = InspirationEmbeddingRecord,
> {
  inspiration: {
    findUnique(args: FindInspirationForEmbeddingArgs): Promise<TRecord | null>;
    update(
      args: UpdateInspirationEnrichmentLifecycleArgs,
    ): Promise<InspirationEnrichmentLifecycleRecord>;
  };
  $executeRawUnsafe(sql: string): Promise<number>;
}

export interface InspirationEnrichmentAttemptStartContext {
  attemptCount?: number;
  completedFieldNames?: readonly InspirationEnrichmentFieldName[];
  enrichmentFields?: InspirationEnrichmentFields;
  processingFieldNames?: readonly InspirationEnrichmentFieldName[];
  enrichmentResumeState?: InspirationEnrichmentResumeState | null;
}

export interface InspirationEnrichmentFailureContext {
  attemptCount?: number;
  completedFieldNames?: readonly InspirationEnrichmentFieldName[];
  enrichmentFields?: InspirationEnrichmentFields;
  enrichmentResumeState?: InspirationEnrichmentResumeState | null;
  failedFieldNames?: readonly InspirationEnrichmentFieldName[];
  maxAttemptCount?: number;
  startedAt?: Date | null;
}

function readRequiredNonEmptyString(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readRequiredRawContentString(value: string, label: string): string {
  if (value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function escapePostgresStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function escapePostgresJsonLiteral(value: unknown): string {
  return `${escapePostgresStringLiteral(JSON.stringify(value))}::jsonb`;
}

function readRequiredJsonObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function readReflectionStatus(value: string): string {
  switch (value) {
    case "PENDING":
    case "PROMPTED":
    case "ANSWERED":
    case "SKIPPED":
    case "NOT_NEEDED":
      return value;
    default:
      throw new TypeError("reflectionStatus must be a valid reflection status.");
  }
}

function serializePostgresTextArray(values: readonly string[]): string {
  if (values.length === 0) {
    return "ARRAY[]::text[]";
  }

  return `ARRAY[${values.map((value) => escapePostgresStringLiteral(value)).join(", ")}]::text[]`;
}

function readErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string") {
    const message = error.trim();
    return message.length > 0 ? message : "Unknown enrichment error.";
  }

  return `Unknown enrichment error (${typeof error}).`;
}

export function serializeInspirationEnrichmentError(
  error: unknown,
  occurredAt: Date,
  context: InspirationEnrichmentFailureContext = {},
): InspirationEnrichmentErrorDetails {
  const message = readErrorMessage(error);
  const classification = classifyInspirationAiFieldGenerationFailure(error);
  const serializedError: InspirationEnrichmentErrorDetails = {
    capturedAt: occurredAt.toISOString(),
    failureClass: classification.failureClass,
    message,
    reason: message,
    retryability: classification.retryability,
  };

  if (typeof context.attemptCount === "number") {
    serializedError.attemptCount = context.attemptCount;
  }

  if (typeof context.maxAttemptCount === "number") {
    serializedError.maxAttemptCount = context.maxAttemptCount;
  }

  if (error instanceof Error) {
    serializedError.name = error.name;

    if (error.stack) {
      serializedError.stack = error.stack;
    }
  }

  if (isLLMProviderError(error)) {
    serializedError.code = error.code;
    serializedError.operation = error.operation;
    serializedError.provider = error.provider;
    serializedError.retryable = error.retryable;

    if (error.requestId) {
      serializedError.requestId = error.requestId;
    }

    if (error.traceId) {
      serializedError.traceId = error.traceId;
    }

    if (typeof error.statusCode === "number") {
      serializedError.statusCode = error.statusCode;
    }

    if (error.details) {
      serializedError.details = error.details;
    }
  }

  return serializedError;
}

export function buildFindInspirationForEmbeddingArgs(
  inspirationId: string,
): FindInspirationForEmbeddingArgs {
  return {
    where: {
      id: readRequiredNonEmptyString(inspirationId, "Inspiration id"),
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
  };
}

export async function findInspirationForEmbedding<
  TRecord extends InspirationEmbeddingRecord,
>(
  client: InspirationEmbeddingPersistenceClient<TRecord>,
  inspirationId: string,
): Promise<TRecord | null> {
  return client.inspiration.findUnique(
    buildFindInspirationForEmbeddingArgs(inspirationId),
  );
}

export function serializeEmbeddingVector(embedding: readonly number[]): string {
  if (embedding.length !== OPENAI_EMBEDDING_DIMENSIONS) {
    throw new RangeError(
      `Embedding must contain ${OPENAI_EMBEDDING_DIMENSIONS} dimensions.`,
    );
  }

  if (!embedding.every((value) => Number.isFinite(value))) {
    throw new TypeError("Embedding must contain only finite numeric values.");
  }

  return `[${embedding.join(",")}]`;
}

function buildPersistInspirationEnrichmentAssignments(
  input: PersistInspirationEnrichmentInput,
): string[] {
  const assignments: string[] = [];

  if (input.embedding !== undefined) {
    assignments.push(
      `    "embedding" = ${escapePostgresStringLiteral(serializeEmbeddingVector(input.embedding))}::vector,`,
    );
  }

  if (input.title !== undefined) {
    assignments.push(
      `    "title" = COALESCE("title", ${escapePostgresStringLiteral(readRequiredNonEmptyString(input.title, "Title"))}),`,
    );
  }

  if (input.rawContent !== undefined) {
    assignments.push(
      `    "rawContent" = ${escapePostgresStringLiteral(readRequiredRawContentString(input.rawContent, "rawContent"))},`,
    );
  }

  if (input.reflectionPrompt !== undefined) {
    assignments.push(
      `    "reflectionPrompt" = ${input.reflectionPrompt === null ? "NULL" : escapePostgresStringLiteral(readRequiredNonEmptyString(input.reflectionPrompt, "reflectionPrompt"))},`,
    );
  }

  if (input.reflectionStatus !== undefined) {
    assignments.push(
      `    "reflectionStatus" = ${escapePostgresStringLiteral(readReflectionStatus(input.reflectionStatus))},`,
    );
  }

  if (input.sourceMeta !== undefined) {
    assignments.push(
      `    "sourceMeta" = COALESCE("sourceMeta", '{}'::jsonb) || ${escapePostgresJsonLiteral(readRequiredJsonObject(input.sourceMeta, "sourceMeta"))},`,
    );
  }

  if (input.summary !== undefined) {
    assignments.push(
      `    "summary" = ${escapePostgresStringLiteral(readRequiredNonEmptyString(input.summary, "Summary"))},`,
    );
  }

  if (input.sourceConversationRef !== undefined) {
    assignments.push(
      `    "sourceConversationRef" = COALESCE("sourceConversationRef", ${escapePostgresStringLiteral(readRequiredNonEmptyString(input.sourceConversationRef, "Source conversation reference"))}),`,
    );
  }

  if (input.tags !== undefined) {
    assignments.push(`    "tags" = ${serializePostgresTextArray(input.tags)},`);
  }

  if (input.domain !== undefined) {
    assignments.push(
      `    "domain" = ${escapePostgresStringLiteral(readRequiredNonEmptyString(input.domain, "Domain"))},`,
    );
  }

  if (input.mood !== undefined) {
    assignments.push(
      `    "mood" = ${escapePostgresStringLiteral(readRequiredNonEmptyString(input.mood, "Mood"))},`,
    );
  }

  if (input.actionability !== undefined) {
    assignments.push(
      `    "actionability" = ${escapePostgresStringLiteral(readRequiredNonEmptyString(input.actionability, "Actionability"))},`,
    );
  }

  assignments.push(
    `    "enrichmentFields" = ${escapePostgresJsonLiteral(input.enrichmentFields)},`,
  );
  assignments.push(
    `    "enrichmentCompletedAt" = ${input.enrichmentStatus === INSPIRATION_ENRICHMENT_STATUS_COMPLETED ? "CURRENT_TIMESTAMP" : "NULL"},`,
  );
  assignments.push(
    `    "enrichmentFailedAt" = ${input.enrichmentStatus === INSPIRATION_ENRICHMENT_STATUS_FAILED ? "CURRENT_TIMESTAMP" : "NULL"},`,
  );
  assignments.push(
    `    "enrichmentLastFailureReason" = ${input.enrichmentLastFailureReason == null ? "NULL" : escapePostgresStringLiteral(input.enrichmentLastFailureReason)},`,
  );
  assignments.push(
    `    "enrichmentLastFailureRetryability" = ${input.enrichmentLastFailureRetryability == null ? "NULL" : escapePostgresStringLiteral(input.enrichmentLastFailureRetryability)},`,
  );
  assignments.push(
    `    "enrichmentLastError" = ${input.enrichmentLastError == null ? "NULL" : escapePostgresJsonLiteral(input.enrichmentLastError)},`,
  );
  assignments.push(
    `    "enrichmentResumeState" = ${input.enrichmentResumeState == null ? "NULL" : escapePostgresJsonLiteral(input.enrichmentResumeState)},`,
  );
  assignments.push(
    `    "enrichmentStatus" = ${escapePostgresStringLiteral(input.enrichmentStatus)},`,
  );

  return assignments;
}

export function buildPersistInspirationEnrichmentSql(
  input: PersistInspirationEnrichmentInput,
): string {
  const inspirationId = readRequiredNonEmptyString(
    input.inspirationId,
    "Inspiration id",
  );
  const whereConditions = [
    `"id" = ${escapePostgresStringLiteral(inspirationId)}`,
  ];

  if (input.expectedRawContent !== undefined) {
    whereConditions.push(
      `"rawContent" IS NOT DISTINCT FROM ${escapePostgresStringLiteral(readRequiredRawContentString(input.expectedRawContent, "Expected rawContent"))}`,
    );
  }

  return [
    'UPDATE "Inspiration"',
    "SET",
    ...buildPersistInspirationEnrichmentAssignments(input),
    '    "updatedAt" = CURRENT_TIMESTAMP',
    `WHERE ${whereConditions.join("\n  AND ")}`,
  ].join("\n");
}

export function buildMarkInspirationEnrichmentAttemptStartedArgs(
  inspirationId: string,
  occurredAt: Date,
  context: InspirationEnrichmentAttemptStartContext = {},
): UpdateInspirationEnrichmentLifecycleArgs {
  return {
    data: {
      enrichmentAttemptCount: {
        increment: 1,
      },
      enrichmentCompletedAt: null,
      enrichmentFailedAt: null,
      enrichmentFields: buildProcessingInspirationEnrichmentFields(occurredAt, {
        attemptCount: context.attemptCount ?? 1,
        completedFieldNames: context.completedFieldNames,
        existingFields: context.enrichmentFields,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        processingFieldNames: context.processingFieldNames,
      }),
      enrichmentLastError: null,
      enrichmentLastFailureReason: null,
      enrichmentLastFailureRetryability: null,
      enrichmentMaxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      ...(context.enrichmentResumeState === undefined
        ? {}
        : {
            enrichmentResumeState: context.enrichmentResumeState,
          }),
      enrichmentStartedAt: occurredAt,
      enrichmentStatus: INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
    },
    select: {
      id: true,
    },
    where: {
      id: readRequiredNonEmptyString(inspirationId, "Inspiration id"),
    },
  };
}

export async function markInspirationEnrichmentAttemptStarted<
  TRecord extends InspirationEmbeddingRecord,
>(
  client: InspirationEmbeddingPersistenceClient<TRecord>,
  inspirationId: string,
  occurredAt: Date = new Date(),
  context: InspirationEnrichmentAttemptStartContext = {},
): Promise<void> {
  await client.inspiration.update(
    buildMarkInspirationEnrichmentAttemptStartedArgs(
      inspirationId,
      occurredAt,
      context,
    ),
  );
}

export function buildMarkInspirationEnrichmentFailedArgs(
  inspirationId: string,
  error: unknown,
  occurredAt: Date,
  context: InspirationEnrichmentFailureContext = {},
): UpdateInspirationEnrichmentLifecycleArgs {
  const failureReason = readErrorMessage(error);
  const failureContext: InspirationEnrichmentFailureContext = {
    attemptCount: context.attemptCount,
    completedFieldNames: context.completedFieldNames,
    failedFieldNames: context.failedFieldNames,
    maxAttemptCount:
      context.maxAttemptCount ?? INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    startedAt: context.startedAt,
  };
  const serializedError = serializeInspirationEnrichmentError(
    error,
    occurredAt,
    failureContext,
  );

  return {
    data: {
      enrichmentCompletedAt: null,
      enrichmentFailedAt: occurredAt,
      enrichmentFields:
        context.enrichmentFields ??
        buildFailedInspirationEnrichmentFields({
          attemptCount: failureContext.attemptCount,
          completedFieldNames: failureContext.completedFieldNames,
          failedAt: occurredAt,
          failedFieldNames: failureContext.failedFieldNames,
          lastError: serializedError,
          lastFailureReason: failureReason,
          lastFailureRetryability:
            classifyInspirationJobFailureRetryability(error),
          maxAttemptCount:
            failureContext.maxAttemptCount ??
            INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          startedAt: failureContext.startedAt,
        }),
      enrichmentLastFailureReason: failureReason,
      enrichmentLastFailureRetryability:
        classifyInspirationJobFailureRetryability(error),
      enrichmentMaxAttemptCount:
        failureContext.maxAttemptCount ??
        INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      enrichmentLastError: serializedError,
      ...(context.enrichmentResumeState === undefined
        ? {}
        : {
            enrichmentResumeState: context.enrichmentResumeState,
          }),
      enrichmentStatus: INSPIRATION_ENRICHMENT_STATUS_FAILED,
    },
    select: {
      id: true,
    },
    where: {
      id: readRequiredNonEmptyString(inspirationId, "Inspiration id"),
    },
  };
}

export async function markInspirationEnrichmentFailed<
  TRecord extends InspirationEmbeddingRecord,
>(
  client: InspirationEmbeddingPersistenceClient<TRecord>,
  inspirationId: string,
  error: unknown,
  occurredAt: Date = new Date(),
  context: InspirationEnrichmentFailureContext = {},
): Promise<void> {
  await client.inspiration.update(
    buildMarkInspirationEnrichmentFailedArgs(
      inspirationId,
      error,
      occurredAt,
      context,
    ),
  );
}

export async function persistInspirationEnrichment<
  TRecord extends InspirationEmbeddingRecord,
>(
  client: InspirationEmbeddingPersistenceClient<TRecord>,
  input: PersistInspirationEnrichmentInput,
): Promise<boolean> {
  const updatedRowCount = await client.$executeRawUnsafe(
    buildPersistInspirationEnrichmentSql(input),
  );

  if (updatedRowCount < 1) {
    if (
      input.ignoreIfSourceCaptureChanged === true &&
      input.expectedRawContent !== undefined
    ) {
      return false;
    }

    throw new Error(
      `Inspiration ${input.inspirationId} was not found while saving its enrichment payload.`,
    );
  }

  return true;
}
