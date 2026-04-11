import type { AiEnrichmentSqsJobPayload } from "../../../../packages/shared/types.ts";
import {
  buildPendingInspirationEnrichmentFields,
  buildQueuedInspirationEnrichmentFields,
  type InspirationEnrichmentFieldName,
  type InspirationEnrichmentFields,
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  INSPIRATION_ENRICHMENT_RETRYABILITY_UNKNOWN,
  type InspirationEnrichmentRetryability,
} from "./enrichment-field-metadata.ts";
import { buildInspirationEnrichmentResumeState } from "./enrichment-resume-state.ts";
import {
  resolveInspirationEnrichmentExecutionPlan,
  type InspirationEnrichmentExecutionRecord,
} from "./enrichment-selective-execution.ts";

export const INSPIRATION_ENRICHMENT_STATUS_PENDING = "PENDING";
export const INSPIRATION_ENRICHMENT_STATUS_PROCESSING = "PROCESSING";
export const INSPIRATION_ENRICHMENT_STATUS_COMPLETED = "COMPLETED";
export const INSPIRATION_ENRICHMENT_STATUS_FAILED = "FAILED";
export const INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT = 3;

export const INITIAL_INSPIRATION_ENRICHMENT_STATUS =
  INSPIRATION_ENRICHMENT_STATUS_PENDING;
export {
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  INSPIRATION_ENRICHMENT_RETRYABILITY_UNKNOWN,
};
export type { InspirationEnrichmentRetryability };

export interface EnqueueInspirationEnrichmentJobInput {
  inspirationId: string;
  userId: string;
}

export interface EnqueueSelectedInspirationEnrichmentJobInput
  extends EnqueueInspirationEnrichmentJobInput {
  fieldNames?: readonly InspirationEnrichmentFieldName[];
}

export interface InspirationEnrichmentPipelineRecord {
  id: string;
}

export interface SelectiveInspirationEnrichmentRerunRecord
  extends InspirationEnrichmentExecutionRecord {}

export interface InitialInspirationEnrichmentPersistenceData {
  enrichmentAttemptCount: number;
  enrichmentCompletedAt: null;
  enrichmentFailedAt: null;
  enrichmentFields: InspirationEnrichmentFields;
  enrichmentLastError: null;
  enrichmentLastFailureReason: null;
  enrichmentLastFailureRetryability: null;
  enrichmentMaxAttemptCount: number;
  enrichmentResumeState: null;
  enrichmentStartedAt: null;
  enrichmentStatus: string;
}

export interface MarkInspirationEnrichmentEnqueuedPersistenceArgs {
  data: InitialInspirationEnrichmentPersistenceData & {
    enrichmentEnqueuedAt: Date;
  };
  select: {
    id: true;
  };
  where: {
    userId_id: {
      id: string;
      userId: string;
    };
  };
}

export interface InspirationEnrichmentPipelinePersistenceClient<
  TRecord extends InspirationEnrichmentPipelineRecord = InspirationEnrichmentPipelineRecord,
> {
  inspiration: {
    update(
      args: MarkInspirationEnrichmentEnqueuedPersistenceArgs,
    ): Promise<TRecord>;
  };
}

export interface FindSelectiveInspirationEnrichmentArgs {
  select: {
    actionability: true;
    domain: true;
    embedding: true;
    enrichmentFields: true;
    enrichmentResumeState: true;
    id: true;
    mediaUrl: true;
    mood: true;
    rawContent: true;
    sourceMeta: true;
    sourceUrl: true;
    summary: true;
    tags: true;
    title: true;
    transcript: true;
  };
  where: {
    deletedAt: null;
    id: string;
    userId: string;
  };
}

export interface MarkSelectiveInspirationEnrichmentEnqueuedPersistenceData {
  enrichmentAttemptCount: number;
  enrichmentCompletedAt: null;
  enrichmentEnqueuedAt: Date;
  enrichmentFailedAt: null;
  enrichmentFields: InspirationEnrichmentFields;
  enrichmentLastError: null;
  enrichmentLastFailureReason: null;
  enrichmentLastFailureRetryability: null;
  enrichmentMaxAttemptCount: number;
  enrichmentResumeState: ReturnType<typeof buildInspirationEnrichmentResumeState>;
  enrichmentStartedAt: null;
  enrichmentStatus: string;
}

export interface MarkSelectiveInspirationEnrichmentEnqueuedPersistenceArgs {
  data: MarkSelectiveInspirationEnrichmentEnqueuedPersistenceData;
  select: {
    id: true;
  };
  where: {
    userId_id: {
      id: string;
      userId: string;
    };
  };
}

export interface SelectiveInspirationEnrichmentRerunPersistenceClient<
  TRecord extends SelectiveInspirationEnrichmentRerunRecord = SelectiveInspirationEnrichmentRerunRecord,
> {
  inspiration: {
    findFirst(
      args: FindSelectiveInspirationEnrichmentArgs,
    ): Promise<TRecord | null>;
    update(
      args: MarkSelectiveInspirationEnrichmentEnqueuedPersistenceArgs,
    ): Promise<InspirationEnrichmentPipelineRecord>;
  };
}

export interface InspirationEnrichmentQueuePublisher {
  enqueue(payload: AiEnrichmentSqsJobPayload): Promise<void>;
}

export interface EnqueueInspirationEnrichmentJobDependencies {
  pipelinePersistence: InspirationEnrichmentPipelinePersistenceClient;
  queuePublisher: InspirationEnrichmentQueuePublisher;
  now?: () => Date;
}

export interface EnqueueSelectedInspirationEnrichmentJobDependencies {
  pipelinePersistence: SelectiveInspirationEnrichmentRerunPersistenceClient;
  queuePublisher: InspirationEnrichmentQueuePublisher;
  now?: () => Date;
}

export interface EnqueueSelectedInspirationEnrichmentJobResult {
  queuedFieldNames: InspirationEnrichmentFieldName[];
  remainingFieldNames: InspirationEnrichmentFieldName[];
}

export const ENQUEUE_SELECTED_INSPIRATION_ENRICHMENT_NO_FIELDS_ERROR =
  "Selected rerun fields must include at least one incomplete AI enrichment field.";

export class SelectiveInspirationEnrichmentNotFoundError extends Error {
  constructor(inspirationId: string) {
    super(`Inspiration ${inspirationId} was not found for enrichment rerun.`);
    this.name = "SelectiveInspirationEnrichmentNotFoundError";
  }
}

export function buildInitialInspirationEnrichmentPersistenceData(): InitialInspirationEnrichmentPersistenceData {
  return {
    enrichmentAttemptCount: 0,
    enrichmentCompletedAt: null,
    enrichmentFailedAt: null,
    enrichmentFields: buildPendingInspirationEnrichmentFields(
      INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    ),
    enrichmentLastError: null,
    enrichmentLastFailureReason: null,
    enrichmentLastFailureRetryability: null,
    enrichmentMaxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    enrichmentResumeState: null,
    enrichmentStartedAt: null,
    enrichmentStatus: INITIAL_INSPIRATION_ENRICHMENT_STATUS,
  };
}

export function buildMarkInspirationEnrichmentEnqueuedArgs(
  userId: string,
  inspirationId: string,
  enqueuedAt: Date,
): MarkInspirationEnrichmentEnqueuedPersistenceArgs {
  return {
    data: {
      ...buildInitialInspirationEnrichmentPersistenceData(),
      enrichmentEnqueuedAt: enqueuedAt,
    },
    select: {
      id: true,
    },
    where: {
      userId_id: {
        id: inspirationId,
        userId,
      },
    },
  };
}

export async function markInspirationEnrichmentEnqueued(
  pipelinePersistence: InspirationEnrichmentPipelinePersistenceClient,
  input: EnqueueInspirationEnrichmentJobInput,
  enqueuedAt: Date,
): Promise<void> {
  await pipelinePersistence.inspiration.update(
    buildMarkInspirationEnrichmentEnqueuedArgs(
      input.userId,
      input.inspirationId,
      enqueuedAt,
    ),
  );
}

export async function enqueueInspirationEnrichmentJob(
  input: EnqueueInspirationEnrichmentJobInput,
  dependencies: EnqueueInspirationEnrichmentJobDependencies,
): Promise<void> {
  await dependencies.queuePublisher.enqueue({
    jobType: "ai_enrichment",
    inspirationId: input.inspirationId,
  });

  await markInspirationEnrichmentEnqueued(
    dependencies.pipelinePersistence,
    input,
    dependencies.now?.() ?? new Date(),
  );
}

export function buildFindSelectiveInspirationEnrichmentArgs(
  userId: string,
  inspirationId: string,
): FindSelectiveInspirationEnrichmentArgs {
  return {
    select: {
      actionability: true,
      domain: true,
      embedding: true,
      enrichmentFields: true,
      enrichmentResumeState: true,
      id: true,
      mediaUrl: true,
      mood: true,
      rawContent: true,
      sourceMeta: true,
      sourceUrl: true,
      summary: true,
      tags: true,
      title: true,
      transcript: true,
    },
    where: {
      deletedAt: null,
      id: inspirationId,
      userId,
    },
  };
}

export function buildMarkSelectedInspirationEnrichmentEnqueuedArgs(
  userId: string,
  inspirationId: string,
  inspiration: SelectiveInspirationEnrichmentRerunRecord,
  enqueuedAt: Date,
  fieldNames?: readonly InspirationEnrichmentFieldName[],
): MarkSelectiveInspirationEnrichmentEnqueuedPersistenceArgs {
  const executionPlan = resolveInspirationEnrichmentExecutionPlan(inspiration, {
    requestedFieldNames: fieldNames,
  });

  if (executionPlan.fieldNamesToProcess.length === 0) {
    throw new TypeError(ENQUEUE_SELECTED_INSPIRATION_ENRICHMENT_NO_FIELDS_ERROR);
  }

  return {
    data: {
      enrichmentAttemptCount: 0,
      enrichmentCompletedAt: null,
      enrichmentEnqueuedAt: enqueuedAt,
      enrichmentFailedAt: null,
      enrichmentFields: buildQueuedInspirationEnrichmentFields({
        completedFieldNames: executionPlan.completedFieldNames,
        existingFields: executionPlan.existingFields,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        pendingFieldNames: executionPlan.fieldNamesToProcess,
      }),
      enrichmentLastError: null,
      enrichmentLastFailureReason: null,
      enrichmentLastFailureRetryability: null,
      enrichmentMaxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      enrichmentResumeState: buildInspirationEnrichmentResumeState({
        capture: executionPlan.capture,
        completedFieldNames: executionPlan.completedFieldNames,
        completedOutputs: executionPlan.completedOutputs,
        remainingFieldNames: executionPlan.remainingFieldNames,
        updatedAt: enqueuedAt,
      }),
      enrichmentStartedAt: null,
      enrichmentStatus: INITIAL_INSPIRATION_ENRICHMENT_STATUS,
    },
    select: {
      id: true,
    },
    where: {
      userId_id: {
        id: inspirationId,
        userId,
      },
    },
  };
}

export async function enqueueSelectedInspirationEnrichmentJob(
  input: EnqueueSelectedInspirationEnrichmentJobInput,
  dependencies: EnqueueSelectedInspirationEnrichmentJobDependencies,
): Promise<EnqueueSelectedInspirationEnrichmentJobResult> {
  const inspiration = await dependencies.pipelinePersistence.inspiration.findFirst(
    buildFindSelectiveInspirationEnrichmentArgs(
      input.userId,
      input.inspirationId,
    ),
  );

  if (!inspiration) {
    throw new SelectiveInspirationEnrichmentNotFoundError(input.inspirationId);
  }

  const executionPlan = resolveInspirationEnrichmentExecutionPlan(inspiration, {
    requestedFieldNames: input.fieldNames,
  });

  if (executionPlan.fieldNamesToProcess.length === 0) {
    throw new TypeError(ENQUEUE_SELECTED_INSPIRATION_ENRICHMENT_NO_FIELDS_ERROR);
  }

  const enqueuedAt = dependencies.now?.() ?? new Date();
  const updateArgs = buildMarkSelectedInspirationEnrichmentEnqueuedArgs(
    input.userId,
    input.inspirationId,
    inspiration,
    enqueuedAt,
    input.fieldNames,
  );
  const queuedFieldNames = executionPlan.fieldNamesToProcess;

  await dependencies.queuePublisher.enqueue({
    fieldNames: queuedFieldNames,
    jobType: "ai_enrichment",
    inspirationId: input.inspirationId,
  });
  await dependencies.pipelinePersistence.inspiration.update(updateArgs);

  return {
    queuedFieldNames,
    remainingFieldNames: updateArgs.data.enrichmentResumeState.remainingFieldNames,
  };
}
