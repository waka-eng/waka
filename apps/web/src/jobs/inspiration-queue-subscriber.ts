import {
  createValidatedInspirationQueueRecordProcessingRequest,
  isInspirationQueueMessageProcessingResult,
  resolveInspirationQueueAttemptCount,
  resolveInspirationQueueMaxAttemptCount,
  validateInspirationQueueRecord,
  type InspirationQueueEvent,
  type InspirationQueueMessageProcessingResult,
  type InspirationQueueRecord,
  type InspirationQueueMessageProcessor,
  type InspirationQueueRecordProcessingRequest,
} from "./inspiration-queue.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
} from "../inspirations/enrichment-pipeline.ts";
import {
  classifyInspirationJobFailureRetryability,
  isInspirationJobFailureRetryable,
  type InspirationJobFailureRetryability,
} from "./inspiration-job-failure.ts";
import {
  createEnvironmentInspirationQueueDeadLetterPublisher,
  createInspirationQueueDeadLetterMessage,
  INSPIRATION_QUEUE_DEAD_LETTER_TERMINAL_REASON_MAX_ATTEMPTS_EXHAUSTED,
  INSPIRATION_QUEUE_DEAD_LETTER_TERMINAL_REASON_NON_RETRYABLE,
  type InspirationQueueDeadLetterPublisher,
  type InspirationQueueDeadLetterTerminalReason,
} from "./inspiration-dead-letter.ts";
import { processInspirationJob } from "./process-inspiration-job.ts";

export interface InspirationQueueProcessingFailure {
  attemptCount?: number;
  error: unknown;
  maxAttemptCount?: number;
  processingRequest?: InspirationQueueRecordProcessingRequest;
  record: InspirationQueueRecord;
  retryability: InspirationJobFailureRetryability;
}

export interface InspirationQueueRecordProcessingAcknowledgedOutcome {
  processingRequest: InspirationQueueRecordProcessingRequest;
  record: InspirationQueueRecord;
  status: "acknowledged";
}

export interface InspirationQueueRecordProcessingFailureOutcome {
  attemptCount?: number;
  deadLetter?: InspirationQueueDeadLetterRoutingOutcome;
  error: unknown;
  failureKind: "dispatch" | "non-dispatch";
  maxAttemptCount?: number;
  processingRequest?: InspirationQueueRecordProcessingRequest;
  record: InspirationQueueRecord;
  retryability: InspirationJobFailureRetryability;
  status: "failure";
}

export type InspirationQueueRecordProcessingOutcome =
  | InspirationQueueRecordProcessingAcknowledgedOutcome
  | InspirationQueueRecordProcessingFailureOutcome;

export interface InspirationQueueDeadLetterRoutingOutcome {
  error?: unknown;
  routedAt: string;
  status: "routed" | "routing-failed";
  terminalReason: InspirationQueueDeadLetterTerminalReason;
}

export interface InspirationQueueBatchItemFailure {
  itemIdentifier: string;
}

export interface InspirationQueuePartialBatchResponse {
  batchItemFailures: InspirationQueueBatchItemFailure[];
}

export type InspirationQueueProcessingFailureHandler = (
  failure: InspirationQueueProcessingFailure,
) => Promise<void> | void;

export interface ProcessInspirationQueueEventOptions {
  deadLetterPublisher?: InspirationQueueDeadLetterPublisher;
  dispatchFailureHandler?: InspirationQueueProcessingFailureHandler;
  logger?: Pick<Console, "error">;
  nonDispatchFailureHandler?: InspirationQueueProcessingFailureHandler;
  now?: () => Date;
}

function noopFailureHandler(): void {}

function defaultFailureHandler(failure: InspirationQueueProcessingFailure): never {
  throw failure.error;
}

async function handleInspirationQueueProcessingFailure(
  failure: InspirationQueueProcessingFailure,
  options: ProcessInspirationQueueEventOptions,
  failureKind: "dispatch" | "non-dispatch",
): Promise<void> {
  const logger = options.logger ?? console;
  const failureHandler =
    failureKind === "dispatch"
      ? (options.dispatchFailureHandler ?? defaultFailureHandler)
      : (options.nonDispatchFailureHandler ?? defaultFailureHandler);

  logger.error(failure.error);
  await failureHandler(failure);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readOptionalNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function readQueueEventRecords(event: unknown): unknown[] {
  if (!isRecord(event) || !Array.isArray(event.Records)) {
    throw new TypeError("Queue event must include a Records array.");
  }

  return event.Records;
}

function createRecordFailurePlaceholder(
  record: unknown,
  index: number,
): InspirationQueueRecord {
  if (isRecord(record)) {
    return {
      body:
        readOptionalNonEmptyString(record.body) ??
        `[invalid queue body at index ${index}]`,
      messageId:
        readOptionalNonEmptyString(record.messageId) ??
        `invalid-record-${index}`,
    };
  }

  return {
    body: `[invalid queue body at index ${index}]`,
    messageId: `invalid-record-${index}`,
  };
}

async function createValidatedInspirationQueueProcessingRequest(
  recordValue: unknown,
  index: number,
  options: ProcessInspirationQueueEventOptions,
): Promise<
  | InspirationQueueRecordProcessingOutcome
  | {
      processingRequest: InspirationQueueRecordProcessingRequest;
      status: "ready";
    }
> {
  let record: InspirationQueueRecord;

  try {
    record = validateInspirationQueueRecord(recordValue, index);
  } catch (error) {
    const failureRecord = createRecordFailurePlaceholder(recordValue, index);

    await handleInspirationQueueProcessingFailure(
      {
        error,
        record: failureRecord,
        retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
      },
      options,
      "non-dispatch",
    );

    return {
      error,
      failureKind: "non-dispatch",
      record: failureRecord,
      retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
      status: "failure",
    };
  }

  try {
    return {
      processingRequest: createValidatedInspirationQueueRecordProcessingRequest(
        record,
      ),
      status: "ready",
    };
  } catch (error) {
    await handleInspirationQueueProcessingFailure(
      {
        error,
        record,
        retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
      },
      options,
      "non-dispatch",
    );

    return {
      error,
      failureKind: "non-dispatch",
      record,
      retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
      status: "failure",
    };
  }
}

function createAmbiguousProcessingResultError(): TypeError {
  return new TypeError(
    "Queue processor must return an explicit success or failure outcome.",
  );
}

function createSubscriberFailureHandler(
  failureHandler: InspirationQueueProcessingFailureHandler | undefined,
  logger: Pick<Console, "error">,
): InspirationQueueProcessingFailureHandler {
  if (!failureHandler) {
    return noopFailureHandler;
  }

  return async (failure) => {
    try {
      await failureHandler(failure);
    } catch (error) {
      logger.error(error);
    }
  };
}

function resolveProcessingFailureAttemptCount(
  processingRequest: InspirationQueueRecordProcessingRequest | undefined,
  attemptCount: number | undefined,
): number | undefined {
  if (Number.isInteger(attemptCount) && Number(attemptCount) > 0) {
    return Number(attemptCount);
  }

  return processingRequest
    ? resolveInspirationQueueAttemptCount(processingRequest)
    : undefined;
}

function shouldRequeueProcessingFailure(
  outcome: InspirationQueueRecordProcessingFailureOutcome,
): boolean {
  if (outcome.deadLetter?.status === "routing-failed") {
    return true;
  }

  if (outcome.deadLetter?.status === "routed") {
    return false;
  }

  if (!isInspirationJobFailureRetryable(outcome.retryability)) {
    return false;
  }

  const attemptCount = resolveProcessingFailureAttemptCount(
    outcome.processingRequest,
    outcome.attemptCount,
  );

  if (attemptCount === undefined) {
    return true;
  }

  return (
    attemptCount <
    resolveInspirationQueueMaxAttemptCount(
      outcome.maxAttemptCount ?? INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    )
  );
}

function resolveDeadLetterTerminalReason(
  outcome: InspirationQueueRecordProcessingFailureOutcome,
): InspirationQueueDeadLetterTerminalReason | undefined {
  if (!isInspirationJobFailureRetryable(outcome.retryability)) {
    return INSPIRATION_QUEUE_DEAD_LETTER_TERMINAL_REASON_NON_RETRYABLE;
  }

  const attemptCount = resolveProcessingFailureAttemptCount(
    outcome.processingRequest,
    outcome.attemptCount,
  );

  if (attemptCount === undefined) {
    return undefined;
  }

  return attemptCount >=
    resolveInspirationQueueMaxAttemptCount(
      outcome.maxAttemptCount ?? INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    )
    ? INSPIRATION_QUEUE_DEAD_LETTER_TERMINAL_REASON_MAX_ATTEMPTS_EXHAUSTED
    : undefined;
}

async function routeTerminalProcessingFailureOutcome(
  outcome: InspirationQueueRecordProcessingFailureOutcome,
  options: ProcessInspirationQueueEventOptions,
): Promise<InspirationQueueRecordProcessingFailureOutcome> {
  const terminalReason = resolveDeadLetterTerminalReason(outcome);
  const deadLetterPublisher = options.deadLetterPublisher;

  if (!terminalReason || !deadLetterPublisher) {
    return outcome;
  }

  const routedAt = options.now?.() ?? new Date();
  const attemptCount = resolveProcessingFailureAttemptCount(
    outcome.processingRequest,
    outcome.attemptCount,
  );
  const maxAttemptCount = resolveInspirationQueueMaxAttemptCount(
    outcome.maxAttemptCount ?? INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  );
  const deadLetterMessage = createInspirationQueueDeadLetterMessage(
    {
      attemptCount,
      error: outcome.error,
      failureKind: outcome.failureKind,
      maxAttemptCount,
      processingRequest: outcome.processingRequest,
      record: outcome.record,
      retryability: outcome.retryability,
      terminalReason,
    },
    routedAt,
  );

  try {
    await deadLetterPublisher.publish(deadLetterMessage);

    return {
      ...outcome,
      deadLetter: {
        routedAt: deadLetterMessage.deadLetteredAt,
        status: "routed",
        terminalReason,
      },
    };
  } catch (error) {
    (options.logger ?? console).error(error);

    return {
      ...outcome,
      deadLetter: {
        error,
        routedAt: deadLetterMessage.deadLetteredAt,
        status: "routing-failed",
        terminalReason,
      },
    };
  }
}

async function dispatchInspirationQueueProcessingRequest(
  processingRequest: InspirationQueueRecordProcessingRequest,
  processor: InspirationQueueMessageProcessor,
  options: ProcessInspirationQueueEventOptions,
): Promise<InspirationQueueRecordProcessingOutcome> {
  let processingResult: InspirationQueueMessageProcessingResult;

  try {
    const result = await processor(processingRequest);

    if (!isInspirationQueueMessageProcessingResult(result)) {
      throw createAmbiguousProcessingResultError();
    }

    processingResult = result;
  } catch (error) {
    const retryability = classifyInspirationJobFailureRetryability(error);
    const attemptCount = resolveInspirationQueueAttemptCount(processingRequest);
    const maxAttemptCount = INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT;

    await handleInspirationQueueProcessingFailure(
      {
        attemptCount,
        error,
        maxAttemptCount,
        processingRequest,
        record: processingRequest.record,
        retryability,
      },
      options,
      "dispatch",
    );

    return {
      attemptCount,
      error,
      failureKind: "dispatch",
      maxAttemptCount,
      processingRequest,
      record: processingRequest.record,
      retryability,
      status: "failure",
    };
  }

  if (processingResult.outcome === "failure") {
    const attemptCount = resolveProcessingFailureAttemptCount(
      processingRequest,
      processingResult.attemptCount,
    );
    const maxAttemptCount = resolveInspirationQueueMaxAttemptCount(
      processingResult.maxAttemptCount ??
        INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    );

    await handleInspirationQueueProcessingFailure(
      {
        attemptCount,
        error: processingResult.error,
        maxAttemptCount,
        processingRequest,
        record: processingRequest.record,
        retryability: processingResult.retryability,
      },
      options,
      "dispatch",
    );

    return {
      attemptCount,
      error: processingResult.error,
      failureKind: "dispatch",
      maxAttemptCount,
      processingRequest,
      record: processingRequest.record,
      retryability: processingResult.retryability,
      status: "failure",
    };
  }

  return {
    processingRequest,
    record: processingRequest.record,
    status: "acknowledged",
  };
}

export function createInspirationQueuePartialBatchResponse(
  outcomes: readonly InspirationQueueRecordProcessingOutcome[],
): InspirationQueuePartialBatchResponse {
  return {
    // SQS treats omitted identifiers as acknowledged successes or terminal failures.
    batchItemFailures: outcomes.flatMap((outcome) =>
      outcome.status === "failure" &&
      shouldRequeueProcessingFailure(outcome)
        ? [{ itemIdentifier: outcome.record.messageId }]
        : [],
    ),
  };
}

export async function processInspirationQueueEvent(
  event: unknown,
  processor: InspirationQueueMessageProcessor = processInspirationJob,
  options: ProcessInspirationQueueEventOptions = {},
): Promise<InspirationQueueRecordProcessingOutcome[]> {
  const outcomes: InspirationQueueRecordProcessingOutcome[] = [];

  for (const [index, record] of readQueueEventRecords(event).entries()) {
    const validationResult =
      await createValidatedInspirationQueueProcessingRequest(record, index, options);

    if (validationResult.status === "failure") {
      outcomes.push(
        await routeTerminalProcessingFailureOutcome(validationResult, options),
      );
      continue;
    }

    const dispatchOutcome = await dispatchInspirationQueueProcessingRequest(
      validationResult.processingRequest,
      processor,
      options,
    );

    outcomes.push(
      dispatchOutcome.status === "failure"
        ? await routeTerminalProcessingFailureOutcome(
            dispatchOutcome,
            options,
          )
        : dispatchOutcome,
    );
  }

  return outcomes;
}

const defaultDeadLetterPublisher =
  createEnvironmentInspirationQueueDeadLetterPublisher();

export function createInspirationQueueSubscriber(
  processor: InspirationQueueMessageProcessor = processInspirationJob,
  options: ProcessInspirationQueueEventOptions = {},
) {
  const logger = options.logger ?? console;
  const subscriberOptions: ProcessInspirationQueueEventOptions = {
    ...options,
    dispatchFailureHandler: createSubscriberFailureHandler(
      options.dispatchFailureHandler,
      logger,
    ),
    logger,
    nonDispatchFailureHandler: createSubscriberFailureHandler(
      options.nonDispatchFailureHandler,
      logger,
    ),
  };

  return async function handler(
    event: unknown,
  ): Promise<InspirationQueuePartialBatchResponse> {
    const outcomes = await processInspirationQueueEvent(
      event,
      processor,
      subscriberOptions,
    );

    return createInspirationQueuePartialBatchResponse(outcomes);
  };
}

export const handler = createInspirationQueueSubscriber(processInspirationJob, {
  deadLetterPublisher: defaultDeadLetterPublisher,
});

export type {
  InspirationQueueEvent,
  InspirationQueueMessageProcessor,
  InspirationQueueRecordProcessingRequest,
  InspirationQueueRecord,
};
