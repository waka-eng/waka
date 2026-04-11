import assert from "node:assert/strict";
import test from "node:test";

import { JOBS_QUEUE_REDRIVE_RETRY_LIMIT } from "../infra/jobs-stack.ts";
import {
  createInspirationQueuePartialBatchResponse,
  createInspirationQueueSubscriber,
  processInspirationQueueEvent,
  type InspirationQueueProcessingFailure,
} from "../apps/web/src/jobs/inspiration-queue-subscriber.ts";
import type {
  InspirationQueueDeadLetterMessage,
} from "../apps/web/src/jobs/inspiration-dead-letter.ts";
import {
  createInspirationQueueMessageProcessingFailure,
  createInspirationQueueMessageProcessingSuccess,
  type InspirationQueueRecordProcessingRequest,
} from "../apps/web/src/jobs/inspiration-queue.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";

test("queue subscriber validates the batch, extracts each body, and forwards requests in order", async () => {
  const handledRequests: InspirationQueueRecordProcessingRequest[] = [];
  const subscriber = createInspirationQueueSubscriber(async (request) => {
    handledRequests.push(request);

    return createInspirationQueueMessageProcessingSuccess();
  });

  const response = await subscriber({
    Records: [
      {
        body: JSON.stringify({ inspirationId: "insp_1" }),
        messageId: "message-1",
      },
      {
        body: JSON.stringify({ inspirationId: "insp_2" }),
        messageAttributes: {
          jobType: {
            dataType: "String",
            stringValue: "ai_enrichment",
          },
        },
        messageId: "message-2",
      },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [],
  });
  assert.deepEqual(
    handledRequests.map((request) => request.record.messageId),
    ["message-1", "message-2"],
  );
  assert.deepEqual(
    handledRequests.map((request) => request.metadata.messageId),
    ["message-1", "message-2"],
  );
  assert.deepEqual(handledRequests.map((request) => request.body), [
    JSON.stringify({ inspirationId: "insp_1" }),
    JSON.stringify({ inspirationId: "insp_2" }),
  ]);
  assert.equal(handledRequests[0]?.jobType, "ai_enrichment");
  assert.deepEqual(handledRequests[0]?.payload, {
    jobType: "ai_enrichment",
    inspirationId: "insp_1",
  });
  assert.equal(
    handledRequests[1]?.record.messageAttributes?.jobType?.stringValue,
    "ai_enrichment",
  );
  assert.equal(handledRequests[1]?.jobType, "ai_enrichment");
  assert.deepEqual(handledRequests[1]?.payload, {
    jobType: "ai_enrichment",
    inspirationId: "insp_2",
  });
});

test("queue processing marks successful records as acknowledged for partial batch handling", async () => {
  const outcomes = await processInspirationQueueEvent(
    {
      Records: [
        {
          body: JSON.stringify({ inspirationId: "insp_acknowledged" }),
          messageId: "message-acknowledged",
        },
        {
          body: JSON.stringify({ inspirationId: "insp_failed" }),
          messageId: "message-failed",
        },
      ],
    },
    async (request) =>
      request.record.messageId === "message-failed"
        ? createInspirationQueueMessageProcessingFailure(
            new Error("processor returned failure"),
          )
        : createInspirationQueueMessageProcessingSuccess(),
    {
      dispatchFailureHandler() {},
      logger: {
        error() {},
      },
      nonDispatchFailureHandler() {},
    },
  );

  assert.deepEqual(
    outcomes.map((outcome) => ({
      messageId: outcome.record.messageId,
      status: outcome.status,
    })),
    [
      {
        messageId: "message-acknowledged",
        status: "acknowledged",
      },
      {
        messageId: "message-failed",
        status: "failure",
      },
    ],
  );
});

test("queue processing acknowledges only successful mixed-batch messages and returns failed identifiers for reprocessing", async () => {
  const handledMessageIds: string[] = [];
  const outcomes = await processInspirationQueueEvent(
    {
      Records: [
        {
          body: JSON.stringify({ inspirationId: "insp_acknowledged_before" }),
          messageId: "message-acknowledged-before",
        },
        {
          body: JSON.stringify({ inspirationId: "   " }),
          messageId: "message-invalid-payload",
        },
        {
          body: JSON.stringify({ inspirationId: "insp_processor_failure" }),
          messageId: "message-processor-failure",
        },
        {
          body: JSON.stringify({ inspirationId: "insp_acknowledged_after" }),
          messageId: "message-acknowledged-after",
        },
      ],
    },
    async (request) => {
      handledMessageIds.push(request.record.messageId);

      return request.record.messageId === "message-processor-failure"
        ? createInspirationQueueMessageProcessingFailure(
            new Error("processor returned failure"),
          )
        : createInspirationQueueMessageProcessingSuccess();
    },
    {
      dispatchFailureHandler() {},
      logger: {
        error() {},
      },
      nonDispatchFailureHandler() {},
    },
  );

  assert.deepEqual(
    handledMessageIds,
    [
      "message-acknowledged-before",
      "message-processor-failure",
      "message-acknowledged-after",
    ],
  );
  assert.deepEqual(
    outcomes.map((outcome) => ({
      failureKind: outcome.status === "failure" ? outcome.failureKind : undefined,
      messageId: outcome.record.messageId,
      retryability: outcome.status === "failure" ? outcome.retryability : undefined,
      status: outcome.status,
    })),
    [
      {
        failureKind: undefined,
        messageId: "message-acknowledged-before",
        retryability: undefined,
        status: "acknowledged",
      },
      {
        failureKind: "non-dispatch",
        messageId: "message-invalid-payload",
        retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
        status: "failure",
      },
      {
        failureKind: "dispatch",
        messageId: "message-processor-failure",
        retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        status: "failure",
      },
      {
        failureKind: undefined,
        messageId: "message-acknowledged-after",
        retryability: undefined,
        status: "acknowledged",
      },
    ],
  );
  assert.deepEqual(createInspirationQueuePartialBatchResponse(outcomes), {
    batchItemFailures: [{ itemIdentifier: "message-processor-failure" }],
  });
});

test("queue subscriber excludes already acknowledged mixed-batch successes from the retry set", async () => {
  const handledMessageIds: string[] = [];
  let remainingProcessorFailures = 1;
  const originalRecords = [
    {
      body: JSON.stringify({ inspirationId: "insp_acknowledged_before_retry" }),
      messageId: "message-acknowledged-before-retry",
    },
    {
      body: JSON.stringify({ inspirationId: "insp_retry_once" }),
      messageId: "message-retry-once",
    },
    {
      body: JSON.stringify({ inspirationId: "insp_acknowledged_after_retry" }),
      messageId: "message-acknowledged-after-retry",
    },
  ];
  const subscriber = createInspirationQueueSubscriber(
    async (request) => {
      handledMessageIds.push(request.record.messageId);

      if (
        request.record.messageId === "message-retry-once" &&
        remainingProcessorFailures > 0
      ) {
        remainingProcessorFailures -= 1;

        return createInspirationQueueMessageProcessingFailure(
          new Error("processor returned failure"),
        );
      }

      return createInspirationQueueMessageProcessingSuccess();
    },
    {
      dispatchFailureHandler() {},
      logger: {
        error() {},
      },
      nonDispatchFailureHandler() {},
    },
  );

  const firstResponse = await subscriber({
    Records: originalRecords,
  });
  const retriedMessageIds = new Set(
    firstResponse.batchItemFailures.map((failure) => failure.itemIdentifier),
  );
  const retryRecords = originalRecords.filter((record) =>
    retriedMessageIds.has(record.messageId),
  );
  const secondResponse = await subscriber({
    Records: retryRecords,
  });

  assert.deepEqual(firstResponse, {
    batchItemFailures: [{ itemIdentifier: "message-retry-once" }],
  });
  assert.deepEqual(
    retryRecords.map((record) => record.messageId),
    ["message-retry-once"],
  );
  assert.deepEqual(secondResponse, {
    batchItemFailures: [],
  });
  assert.deepEqual(handledMessageIds, [
    "message-acknowledged-before-retry",
    "message-retry-once",
    "message-acknowledged-after-retry",
    "message-retry-once",
  ]);
  assert.equal(
    handledMessageIds.filter(
      (messageId) => messageId === "message-acknowledged-before-retry",
    ).length,
    1,
  );
  assert.equal(
    handledMessageIds.filter(
      (messageId) => messageId === "message-acknowledged-after-retry",
    ).length,
    1,
  );
});

test("queue subscriber retries only failed messages across repeated mixed-success batches", async () => {
  const handledMessageIds: string[] = [];
  const remainingFailuresByMessageId = new Map([
    ["message-retry-once", 1],
    ["message-retry-twice", 2],
  ]);
  const originalRecords = [
    {
      body: JSON.stringify({ inspirationId: "insp_acknowledged_before_retries" }),
      messageId: "message-acknowledged-before-retries",
    },
    {
      body: JSON.stringify({ inspirationId: "insp_retry_once_then_acknowledge" }),
      messageId: "message-retry-once",
    },
    {
      body: JSON.stringify({ inspirationId: "insp_retry_twice_then_acknowledge" }),
      messageId: "message-retry-twice",
    },
    {
      body: JSON.stringify({ inspirationId: "insp_acknowledged_after_retries" }),
      messageId: "message-acknowledged-after-retries",
    },
  ];
  const subscriber = createInspirationQueueSubscriber(
    async (request) => {
      handledMessageIds.push(request.record.messageId);

      const remainingFailures =
        remainingFailuresByMessageId.get(request.record.messageId) ?? 0;

      if (remainingFailures > 0) {
        remainingFailuresByMessageId.set(
          request.record.messageId,
          remainingFailures - 1,
        );

        return createInspirationQueueMessageProcessingFailure(
          new Error("processor returned failure"),
        );
      }

      return createInspirationQueueMessageProcessingSuccess();
    },
    {
      dispatchFailureHandler() {},
      logger: {
        error() {},
      },
      nonDispatchFailureHandler() {},
    },
  );

  const firstResponse = await subscriber({
    Records: originalRecords,
  });
  const firstRetryMessageIds = new Set(
    firstResponse.batchItemFailures.map((failure) => failure.itemIdentifier),
  );
  const firstRetryRecords = originalRecords.filter((record) =>
    firstRetryMessageIds.has(record.messageId),
  );

  const secondResponse = await subscriber({
    Records: firstRetryRecords,
  });
  const secondRetryMessageIds = new Set(
    secondResponse.batchItemFailures.map((failure) => failure.itemIdentifier),
  );
  const secondRetryRecords = firstRetryRecords.filter((record) =>
    secondRetryMessageIds.has(record.messageId),
  );

  const thirdResponse = await subscriber({
    Records: secondRetryRecords,
  });

  assert.deepEqual(firstResponse, {
    batchItemFailures: [
      { itemIdentifier: "message-retry-once" },
      { itemIdentifier: "message-retry-twice" },
    ],
  });
  assert.deepEqual(
    firstRetryRecords.map((record) => record.messageId),
    ["message-retry-once", "message-retry-twice"],
  );
  assert.deepEqual(secondResponse, {
    batchItemFailures: [{ itemIdentifier: "message-retry-twice" }],
  });
  assert.deepEqual(
    secondRetryRecords.map((record) => record.messageId),
    ["message-retry-twice"],
  );
  assert.deepEqual(thirdResponse, {
    batchItemFailures: [],
  });
  assert.deepEqual(handledMessageIds, [
    "message-acknowledged-before-retries",
    "message-retry-once",
    "message-retry-twice",
    "message-acknowledged-after-retries",
    "message-retry-once",
    "message-retry-twice",
    "message-retry-twice",
  ]);
  assert.equal(
    handledMessageIds.filter(
      (messageId) => messageId === "message-acknowledged-before-retries",
    ).length,
    1,
  );
  assert.equal(
    handledMessageIds.filter(
      (messageId) => messageId === "message-acknowledged-after-retries",
    ).length,
    1,
  );
  assert.equal(
    handledMessageIds.filter((messageId) => messageId === "message-retry-once")
      .length,
    2,
  );
  assert.equal(
    handledMessageIds.filter((messageId) => messageId === "message-retry-twice")
      .length,
    3,
  );
});

test("default queue subscriber isolates structurally invalid records and continues processing later messages", async () => {
  const handledRequests: InspirationQueueRecordProcessingRequest[] = [];
  const subscriber = createInspirationQueueSubscriber(
    async (request) => {
      handledRequests.push(request);

      return createInspirationQueueMessageProcessingSuccess();
    },
    {
      logger: {
        error() {},
      },
    },
  );

  const response = await subscriber({
    Records: [
      {
        messageId: "message-missing-body",
      },
      {
        body: JSON.stringify({
          inspirationId: "insp_valid_after_structural_failure",
        }),
        messageId: "message-valid-after-structural-failure",
      },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [],
  });
  assert.equal(handledRequests.length, 1);
  assert.equal(
    handledRequests[0]?.record.messageId,
    "message-valid-after-structural-failure",
  );
});

test("default queue subscriber records per-message processor failures without aborting the rest of the batch", async () => {
  const handledMessageIds: string[] = [];
  const subscriber = createInspirationQueueSubscriber(
    async (request) => {
      handledMessageIds.push(request.record.messageId);

      if (request.record.messageId === "message-processor-failure") {
        return createInspirationQueueMessageProcessingFailure(
          new Error("processor returned failure"),
        );
      }

      return createInspirationQueueMessageProcessingSuccess();
    },
    {
      logger: {
        error() {},
      },
    },
  );

  const response = await subscriber({
    Records: [
      {
        body: JSON.stringify({ inspirationId: "insp_before_failure" }),
        messageId: "message-before-failure",
      },
      {
        body: JSON.stringify({ inspirationId: "insp_processor_failure" }),
        messageId: "message-processor-failure",
      },
      {
        body: JSON.stringify({ inspirationId: "insp_after_failure" }),
        messageId: "message-after-failure",
      },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [{ itemIdentifier: "message-processor-failure" }],
  });
  assert.deepEqual(handledMessageIds, [
    "message-before-failure",
    "message-processor-failure",
    "message-after-failure",
  ]);
});

test("queue subscriber terminally acknowledges non-retryable processor failures", async () => {
  const subscriber = createInspirationQueueSubscriber(
    async () =>
      createInspirationQueueMessageProcessingFailure(
        new TypeError("The worker rejected this payload as permanently invalid."),
        INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
      ),
    {
      dispatchFailureHandler() {},
      logger: {
        error() {},
      },
      nonDispatchFailureHandler() {},
    },
  );

  const response = await subscriber({
    Records: [
      {
        body: JSON.stringify({ inspirationId: "insp_terminal_failure" }),
        messageId: "message-terminal-failure",
      },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [],
  });
});

test("queue subscriber routes non-retryable processor failures to the dead-letter publisher before acknowledging them", async () => {
  const deadLetters: InspirationQueueDeadLetterMessage[] = [];
  const subscriber = createInspirationQueueSubscriber(
    async () =>
      createInspirationQueueMessageProcessingFailure(
        new TypeError("The worker rejected this payload as permanently invalid."),
        INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
      ),
    {
      deadLetterPublisher: {
        async publish(message) {
          deadLetters.push(message);
        },
      },
      dispatchFailureHandler() {},
      logger: {
        error() {},
      },
      nonDispatchFailureHandler() {},
      now: () => new Date("2026-04-10T00:00:00.000Z"),
    },
  );

  const response = await subscriber({
    Records: [
      {
        body: JSON.stringify({ inspirationId: "insp_terminal_failure" }),
        messageId: "message-terminal-failure",
      },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [],
  });
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0]?.failure.kind, "dispatch");
  assert.equal(deadLetters[0]?.failure.terminalReason, "non_retryable");
  assert.equal(deadLetters[0]?.failure.retryability, "NON_RETRYABLE");
  assert.deepEqual(deadLetters[0]?.processingRequest?.payload, {
    jobType: "ai_enrichment",
    inspirationId: "insp_terminal_failure",
  });
});

test("queue subscriber routes terminal non-dispatch failures to the dead-letter publisher without invoking the processor", async () => {
  const deadLetters: InspirationQueueDeadLetterMessage[] = [];
  let processorCalls = 0;

  const subscriber = createInspirationQueueSubscriber(
    async () => {
      processorCalls += 1;

      return createInspirationQueueMessageProcessingSuccess();
    },
    {
      deadLetterPublisher: {
        async publish(message) {
          deadLetters.push(message);
        },
      },
      dispatchFailureHandler() {},
      logger: {
        error() {},
      },
      nonDispatchFailureHandler() {},
      now: () => new Date("2026-04-10T00:02:00.000Z"),
    },
  );

  const response = await subscriber({
    Records: [
      {
        body: JSON.stringify({ inspirationId: "   " }),
        messageId: "message-invalid-payload",
      },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [],
  });
  assert.equal(processorCalls, 0);
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0]?.failure.kind, "non-dispatch");
  assert.equal(deadLetters[0]?.failure.terminalReason, "non_retryable");
  assert.equal(deadLetters[0]?.failure.retryability, "NON_RETRYABLE");
  assert.equal(deadLetters[0]?.processingRequest, undefined);
  assert.equal(deadLetters[0]?.record.messageId, "message-invalid-payload");
});

test("queue subscriber stops requeueing retryable processor failures once the max attempt count is exhausted", async () => {
  const subscriber = createInspirationQueueSubscriber(
    async () =>
      createInspirationQueueMessageProcessingFailure(
        new Error("The embedding provider timed out again."),
        INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        {
          attemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        },
      ),
    {
      dispatchFailureHandler() {},
      logger: {
        error() {},
      },
      nonDispatchFailureHandler() {},
    },
  );

  const response = await subscriber({
    Records: [
      {
        attributes: {
          ApproximateReceiveCount: String(
            INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          ),
        },
        body: JSON.stringify({ inspirationId: "insp_retry_exhausted" }),
        messageId: "message-retry-exhausted",
      },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [],
  });
});

test("queue subscriber routes retryable processor failures that exhaust max attempts to the dead-letter publisher", async () => {
  const deadLetters: InspirationQueueDeadLetterMessage[] = [];
  const subscriber = createInspirationQueueSubscriber(
    async () =>
      createInspirationQueueMessageProcessingFailure(
        new Error("The embedding provider timed out again."),
        INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        {
          attemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        },
      ),
    {
      deadLetterPublisher: {
        async publish(message) {
          deadLetters.push(message);
        },
      },
      dispatchFailureHandler() {},
      logger: {
        error() {},
      },
      nonDispatchFailureHandler() {},
      now: () => new Date("2026-04-10T00:05:00.000Z"),
    },
  );

  const response = await subscriber({
    Records: [
      {
        attributes: {
          ApproximateReceiveCount: String(
            INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          ),
        },
        body: JSON.stringify({ inspirationId: "insp_retry_exhausted" }),
        messageId: "message-retry-exhausted",
      },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [],
  });
  assert.equal(deadLetters.length, 1);
  assert.equal(deadLetters[0]?.failure.kind, "dispatch");
  assert.equal(
    deadLetters[0]?.failure.terminalReason,
    "max_attempts_exhausted",
  );
  assert.equal(deadLetters[0]?.failure.attemptCount, 3);
  assert.equal(deadLetters[0]?.failure.maxAttemptCount, 3);
});

test("queue subscriber keeps requeueing retryable failures until the queue receive-count limit and dead-letters only the terminal attempt", async () => {
  const deadLetters: InspirationQueueDeadLetterMessage[] = [];
  const subscriber = createInspirationQueueSubscriber(
    async () =>
      createInspirationQueueMessageProcessingFailure(
        new Error("The embedding provider timed out again."),
        INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
      ),
    {
      deadLetterPublisher: {
        async publish(message) {
          deadLetters.push(message);
        },
      },
      dispatchFailureHandler() {},
      logger: {
        error() {},
      },
      nonDispatchFailureHandler() {},
      now: () => new Date("2026-04-10T00:06:00.000Z"),
    },
  );

  const firstAttemptResponse = await subscriber({
    Records: [
      {
        attributes: {
          ApproximateReceiveCount: "1",
        },
        body: JSON.stringify({ inspirationId: "insp_retry_until_limit" }),
        messageId: "message-retry-attempt-1",
      },
    ],
  });
  const secondAttemptResponse = await subscriber({
    Records: [
      {
        attributes: {
          ApproximateReceiveCount: "2",
        },
        body: JSON.stringify({ inspirationId: "insp_retry_until_limit" }),
        messageId: "message-retry-attempt-2",
      },
    ],
  });
  const thirdAttemptResponse = await subscriber({
    Records: [
      {
        attributes: {
          ApproximateReceiveCount: String(
            INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
          ),
        },
        body: JSON.stringify({ inspirationId: "insp_retry_until_limit" }),
        messageId: "message-retry-attempt-3",
      },
    ],
  });

  assert.deepEqual(firstAttemptResponse, {
    batchItemFailures: [{ itemIdentifier: "message-retry-attempt-1" }],
  });
  assert.deepEqual(secondAttemptResponse, {
    batchItemFailures: [{ itemIdentifier: "message-retry-attempt-2" }],
  });
  assert.deepEqual(thirdAttemptResponse, {
    batchItemFailures: [],
  });
  assert.equal(deadLetters.length, 1);
  assert.equal(
    deadLetters[0]?.failure.terminalReason,
    "max_attempts_exhausted",
  );
  assert.equal(deadLetters[0]?.failure.attemptCount, 3);
  assert.equal(deadLetters[0]?.failure.maxAttemptCount, 3);
  assert.equal(deadLetters[0]?.record.messageId, "message-retry-attempt-3");
});

test("queue subscriber routes a repeatedly failing message to the dead-letter queue after the configured retry limit", async () => {
  const deadLetters: InspirationQueueDeadLetterMessage[] = [];
  const handledAttemptCounts: number[] = [];
  const subscriber = createInspirationQueueSubscriber(
    async (request) => {
      const attemptCount = Number.parseInt(
        request.metadata.attributes?.ApproximateReceiveCount ?? "1",
        10,
      );

      handledAttemptCounts.push(attemptCount);

      return createInspirationQueueMessageProcessingFailure(
        new Error(`The embedding provider timed out on attempt ${attemptCount}.`),
        INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        {
          attemptCount,
          maxAttemptCount: JOBS_QUEUE_REDRIVE_RETRY_LIMIT,
        },
      );
    },
    {
      deadLetterPublisher: {
        async publish(message) {
          deadLetters.push(message);
        },
      },
      dispatchFailureHandler() {},
      logger: {
        error() {},
      },
      nonDispatchFailureHandler() {},
      now: () => new Date("2026-04-10T00:06:30.000Z"),
    },
  );

  const responses = [];

  for (
    let attemptCount = 1;
    attemptCount <= JOBS_QUEUE_REDRIVE_RETRY_LIMIT;
    attemptCount += 1
  ) {
    responses.push(
      await subscriber({
        Records: [
          {
            attributes: {
              ApproximateReceiveCount: String(attemptCount),
            },
            body: JSON.stringify({
              inspirationId: "insp_retry_limit_dead_letter",
            }),
            messageId: "message-retry-limit-dead-letter",
          },
        ],
      }),
    );
  }

  assert.deepEqual(
    handledAttemptCounts,
    Array.from(
      { length: JOBS_QUEUE_REDRIVE_RETRY_LIMIT },
      (_, index) => index + 1,
    ),
  );
  assert.deepEqual(
    responses.slice(0, -1),
    Array.from(
      { length: JOBS_QUEUE_REDRIVE_RETRY_LIMIT - 1 },
      () => ({
        batchItemFailures: [
          { itemIdentifier: "message-retry-limit-dead-letter" },
        ],
      }),
    ),
  );
  assert.deepEqual(responses.at(-1), {
    batchItemFailures: [],
  });
  assert.equal(deadLetters.length, 1);
  assert.equal(
    deadLetters[0]?.failure.terminalReason,
    "max_attempts_exhausted",
  );
  assert.equal(
    deadLetters[0]?.failure.attemptCount,
    JOBS_QUEUE_REDRIVE_RETRY_LIMIT,
  );
  assert.equal(
    deadLetters[0]?.failure.maxAttemptCount,
    JOBS_QUEUE_REDRIVE_RETRY_LIMIT,
  );
  assert.equal(
    deadLetters[0]?.record.messageId,
    "message-retry-limit-dead-letter",
  );
});

test("queue subscriber requeues terminal failures when dead-letter publishing fails so the payload is not lost", async () => {
  const loggedErrors: unknown[] = [];
  const subscriber = createInspirationQueueSubscriber(
    async () =>
      createInspirationQueueMessageProcessingFailure(
        new TypeError("The worker rejected this payload as permanently invalid."),
        INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
      ),
    {
      deadLetterPublisher: {
        async publish() {
          throw new Error("DLQ unavailable");
        },
      },
      dispatchFailureHandler() {},
      logger: {
        error(error) {
          loggedErrors.push(error);
        },
      },
      nonDispatchFailureHandler() {},
      now: () => new Date("2026-04-10T00:10:00.000Z"),
    },
  );

  const response = await subscriber({
    Records: [
      {
        body: JSON.stringify({ inspirationId: "insp_terminal_failure" }),
        messageId: "message-terminal-failure",
      },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [{ itemIdentifier: "message-terminal-failure" }],
  });
  assert.equal(loggedErrors.length, 2);
  assert.match(String(loggedErrors[1]), /DLQ unavailable/);
});

test("queue subscriber keeps processing when a custom failure hook throws", async () => {
  const loggedErrors: unknown[] = [];
  const handledMessageIds: string[] = [];
  const subscriber = createInspirationQueueSubscriber(
    async (request) => {
      handledMessageIds.push(request.record.messageId);

      if (request.record.messageId === "message-hook-failure") {
        return createInspirationQueueMessageProcessingFailure(
          new Error("processor returned failure"),
        );
      }

      return createInspirationQueueMessageProcessingSuccess();
    },
    {
      dispatchFailureHandler() {
        throw new Error("dispatch hook failed");
      },
      logger: {
        error(error) {
          loggedErrors.push(error);
        },
      },
    },
  );

  const response = await subscriber({
    Records: [
      {
        body: JSON.stringify({ inspirationId: "insp_before_hook_failure" }),
        messageId: "message-before-hook-failure",
      },
      {
        body: JSON.stringify({ inspirationId: "insp_hook_failure" }),
        messageId: "message-hook-failure",
      },
      {
        body: JSON.stringify({ inspirationId: "insp_after_hook_failure" }),
        messageId: "message-after-hook-failure",
      },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [{ itemIdentifier: "message-hook-failure" }],
  });
  assert.deepEqual(handledMessageIds, [
    "message-before-hook-failure",
    "message-hook-failure",
    "message-after-hook-failure",
  ]);
  assert.equal(loggedErrors.length, 2);
  assert.match(String(loggedErrors[0]), /processor returned failure/);
  assert.match(String(loggedErrors[1]), /dispatch hook failed/);
});

test("queue subscriber dispatches a valid typed SQS message after schema validation", async () => {
  const handledRequests: InspirationQueueRecordProcessingRequest[] = [];

  await processInspirationQueueEvent(
    {
      Records: [
        {
          body: JSON.stringify({
            jobType: "url_import",
            inspirationId: "insp_url_import",
            sourceUrl: "https://example.com/article",
          }),
          messageId: "message-url-import",
        },
      ],
    },
    async (request) => {
      handledRequests.push(request);

      return createInspirationQueueMessageProcessingSuccess();
    },
  );

  assert.equal(handledRequests.length, 1);
  assert.equal(handledRequests[0]?.record.messageId, "message-url-import");
  assert.equal(handledRequests[0]?.jobType, "url_import");
  assert.deepEqual(handledRequests[0]?.payload, {
    jobType: "url_import",
    inspirationId: "insp_url_import",
    sourceUrl: "https://example.com/article",
  });
});

test("queue subscriber forwards validated job payloads with normalized queue metadata once per valid job", async () => {
  const handledRequests: InspirationQueueRecordProcessingRequest[] = [];

  await processInspirationQueueEvent(
    {
      Records: [
        {
          attributes: {
            ApproximateReceiveCount: "1",
          },
          awsRegion: "us-east-1",
          body: JSON.stringify({
            jobType: "url_import",
            inspirationId: "insp_url_import_metadata",
            sourceUrl: "https://example.com/metadata",
          }),
          eventSource: "aws:sqs",
          eventSourceARN:
            "arn:aws:sqs:us-east-1:123456789012:JobsQueue",
          messageAttributes: {
            jobType: {
              dataType: "String",
              stringValue: "url_import",
            },
          },
          messageId: "message-url-import-metadata",
          receiptHandle: "receipt-handle-1",
        },
      ],
    },
    async (request) => {
      handledRequests.push(request);

      return createInspirationQueueMessageProcessingSuccess();
    },
  );

  assert.equal(handledRequests.length, 1);
  assert.deepEqual(handledRequests[0]?.payload, {
    jobType: "url_import",
    inspirationId: "insp_url_import_metadata",
    sourceUrl: "https://example.com/metadata",
  });
  assert.deepEqual(handledRequests[0]?.metadata, {
    attributes: {
      ApproximateReceiveCount: "1",
    },
    awsRegion: "us-east-1",
    eventSource: "aws:sqs",
    eventSourceARN: "arn:aws:sqs:us-east-1:123456789012:JobsQueue",
    messageAttributes: {
      jobType: {
        binaryValue: undefined,
        dataType: "String",
        stringValue: "url_import",
      },
    },
    messageId: "message-url-import-metadata",
    receiptHandle: "receipt-handle-1",
  });
});

test("queue subscriber rejects events without a Records array", async () => {
  await assert.rejects(
    async () => processInspirationQueueEvent({}),
    /Queue event must include a Records array\./,
  );
});

test("queue subscriber rejects records without a message body", async () => {
  await assert.rejects(
    async () =>
      processInspirationQueueEvent({
        Records: [
          {
            messageId: "message-1",
          },
        ],
      }),
    /Queue record at index 0 must include a non-empty body\./,
  );
});

test("queue subscriber rejects SQS messages with an unsupported jobType schema before dispatch", async () => {
  let processorCalls = 0;

  await assert.rejects(
    async () =>
      processInspirationQueueEvent(
        {
          Records: [
            {
              body: JSON.stringify({
                jobType: "totally_unknown_job",
                inspirationId: "insp_invalid_schema",
              }),
              messageId: "message-invalid-schema",
            },
          ],
        },
        async () => {
          processorCalls += 1;

          return createInspirationQueueMessageProcessingSuccess();
        },
        {
          logger: {
            error() {},
          },
        },
      ),
    /Inspiration queue body jobType must be one of:/,
  );

  assert.equal(processorCalls, 0);
});

test("queue subscriber logs invalid SQS payloads and routes them through the non-dispatch failure path before invoking the processor", async () => {
  let processorCalls = 0;
  let dispatchFailureCalls = 0;
  const loggedErrors: unknown[] = [];
  const nonDispatchFailures: InspirationQueueProcessingFailure[] = [];

  await assert.rejects(
    async () =>
      processInspirationQueueEvent(
        {
          Records: [
            {
              body: JSON.stringify({ inspirationId: "   " }),
              messageId: "message-invalid",
            },
          ],
        },
        async () => {
          processorCalls += 1;

          return createInspirationQueueMessageProcessingSuccess();
        },
        {
          dispatchFailureHandler() {
            dispatchFailureCalls += 1;
          },
          logger: {
            error(error) {
              loggedErrors.push(error);
            },
          },
          nonDispatchFailureHandler(failure) {
            nonDispatchFailures.push(failure);
            throw failure.error;
          },
        },
      ),
    /ai_enrichment SQS job payload inspirationId must be a non-empty string/,
  );

  assert.equal(processorCalls, 0);
  assert.equal(dispatchFailureCalls, 0);
  assert.equal(loggedErrors.length, 1);
  assert.match(
    String(loggedErrors[0]),
    /ai_enrichment SQS job payload inspirationId must be a non-empty string/,
  );
  assert.equal(nonDispatchFailures.length, 1);
  assert.equal(nonDispatchFailures[0]?.record.messageId, "message-invalid");
  assert.equal(nonDispatchFailures[0]?.processingRequest, undefined);
  assert.equal(
    nonDispatchFailures[0]?.retryability,
    INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  );
});

test("queue subscriber continues dispatching later SQS messages after an invalid payload is handled as a non-dispatch failure", async () => {
  let dispatchFailureCalls = 0;
  const handledRequests: InspirationQueueRecordProcessingRequest[] = [];
  const loggedErrors: unknown[] = [];
  const nonDispatchFailures: InspirationQueueProcessingFailure[] = [];

  await processInspirationQueueEvent(
    {
      Records: [
        {
          body: JSON.stringify({ inspirationId: "   " }),
          messageId: "message-invalid-payload",
        },
        {
          body: JSON.stringify({ inspirationId: "insp_valid_after_failure" }),
          messageId: "message-valid-after-failure",
        },
      ],
    },
    async (request) => {
      handledRequests.push(request);

      return createInspirationQueueMessageProcessingSuccess();
    },
    {
      dispatchFailureHandler() {
        dispatchFailureCalls += 1;
      },
      logger: {
        error(error) {
          loggedErrors.push(error);
        },
      },
      nonDispatchFailureHandler(failure) {
        nonDispatchFailures.push(failure);
      },
    },
  );

  assert.equal(dispatchFailureCalls, 0);
  assert.equal(loggedErrors.length, 1);
  assert.match(
    String(loggedErrors[0]),
    /ai_enrichment SQS job payload inspirationId must be a non-empty string/,
  );
  assert.equal(nonDispatchFailures.length, 1);
  assert.equal(
    nonDispatchFailures[0]?.record.messageId,
    "message-invalid-payload",
  );
  assert.equal(handledRequests.length, 1);
  assert.equal(
    handledRequests[0]?.record.messageId,
    "message-valid-after-failure",
  );
  assert.deepEqual(handledRequests[0]?.payload, {
    jobType: "ai_enrichment",
    inspirationId: "insp_valid_after_failure",
  });
});

test("queue subscriber routes processor exceptions through the dispatch failure path", async () => {
  let nonDispatchFailureCalls = 0;
  const loggedErrors: unknown[] = [];
  const dispatchFailures: InspirationQueueProcessingFailure[] = [];

  await assert.rejects(
    async () =>
      processInspirationQueueEvent(
        {
          Records: [
            {
              body: JSON.stringify({ inspirationId: "insp_dispatch_failure" }),
              messageId: "message-dispatch-failure",
            },
          ],
        },
        async () => {
          throw new Error("processor failed");
        },
        {
          dispatchFailureHandler(failure) {
            dispatchFailures.push(failure);
            throw failure.error;
          },
          logger: {
            error(error) {
              loggedErrors.push(error);
            },
          },
          nonDispatchFailureHandler() {
            nonDispatchFailureCalls += 1;
          },
        },
      ),
    /processor failed/,
  );

  assert.equal(nonDispatchFailureCalls, 0);
  assert.equal(loggedErrors.length, 1);
  assert.match(String(loggedErrors[0]), /processor failed/);
  assert.equal(dispatchFailures.length, 1);
  assert.equal(
    dispatchFailures[0]?.record.messageId,
    "message-dispatch-failure",
  );
  assert.equal(
    dispatchFailures[0]?.retryability,
    INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  );
  assert.deepEqual(dispatchFailures[0]?.processingRequest?.payload, {
    jobType: "ai_enrichment",
    inspirationId: "insp_dispatch_failure",
  });
});

test("queue subscriber routes explicit processor failure outcomes through the dispatch failure path", async () => {
  let nonDispatchFailureCalls = 0;
  const loggedErrors: unknown[] = [];
  const dispatchFailures: InspirationQueueProcessingFailure[] = [];

  await assert.rejects(
    async () =>
      processInspirationQueueEvent(
        {
          Records: [
            {
              body: JSON.stringify({ inspirationId: "insp_failure_result" }),
              messageId: "message-failure-result",
            },
          ],
        },
        async () =>
          createInspirationQueueMessageProcessingFailure(
            new Error("processor returned failure"),
          ),
        {
          dispatchFailureHandler(failure) {
            dispatchFailures.push(failure);
            throw failure.error;
          },
          logger: {
            error(error) {
              loggedErrors.push(error);
            },
          },
          nonDispatchFailureHandler() {
            nonDispatchFailureCalls += 1;
          },
        },
      ),
    /processor returned failure/,
  );

  assert.equal(nonDispatchFailureCalls, 0);
  assert.equal(loggedErrors.length, 1);
  assert.match(String(loggedErrors[0]), /processor returned failure/);
  assert.equal(dispatchFailures.length, 1);
  assert.equal(
    dispatchFailures[0]?.record.messageId,
    "message-failure-result",
  );
  assert.equal(
    dispatchFailures[0]?.retryability,
    INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  );
  assert.deepEqual(dispatchFailures[0]?.processingRequest?.payload, {
    jobType: "ai_enrichment",
    inspirationId: "insp_failure_result",
  });
});

test("queue subscriber rejects processor results that do not explicitly declare success or failure", async () => {
  const loggedErrors: unknown[] = [];
  const dispatchFailures: InspirationQueueProcessingFailure[] = [];

  await assert.rejects(
    async () =>
      processInspirationQueueEvent(
        {
          Records: [
            {
              body: JSON.stringify({ inspirationId: "insp_ambiguous_result" }),
              messageId: "message-ambiguous-result",
            },
          ],
        },
        async () => undefined as never,
        {
          dispatchFailureHandler(failure) {
            dispatchFailures.push(failure);
            throw failure.error;
          },
          logger: {
            error(error) {
              loggedErrors.push(error);
            },
          },
        },
      ),
    /Queue processor must return an explicit success or failure outcome/,
  );

  assert.equal(loggedErrors.length, 1);
  assert.equal(dispatchFailures.length, 1);
  assert.equal(
    dispatchFailures[0]?.record.messageId,
    "message-ambiguous-result",
  );
});

test("queue subscriber returns only failed message identifiers in the SQS partial batch response", async () => {
  const loggedErrors: unknown[] = [];
  const subscriber = createInspirationQueueSubscriber(
    async (request) => {
      if (request.record.messageId === "message-processor-failure") {
        return createInspirationQueueMessageProcessingFailure(
          new Error("processor returned failure"),
        );
      }

      return createInspirationQueueMessageProcessingSuccess();
    },
    {
      dispatchFailureHandler() {},
      logger: {
        error(error) {
          loggedErrors.push(error);
        },
      },
      nonDispatchFailureHandler() {},
    },
  );

  const response = await subscriber({
    Records: [
      {
        body: JSON.stringify({ inspirationId: "insp_success" }),
        messageId: "message-success",
      },
      {
        body: JSON.stringify({ inspirationId: "   " }),
        messageId: "message-invalid-payload",
      },
      {
        body: JSON.stringify({ inspirationId: "insp_processor_failure" }),
        messageId: "message-processor-failure",
      },
    ],
  });

  assert.deepEqual(response, {
    batchItemFailures: [{ itemIdentifier: "message-processor-failure" }],
  });
  assert.equal(loggedErrors.length, 2);
});

test("partial batch response helper omits acknowledged records", () => {
  assert.deepEqual(
    createInspirationQueuePartialBatchResponse([
      {
        processingRequest: {
          body: JSON.stringify({ inspirationId: "insp_success" }),
          metadata: {
            messageId: "message-success",
          },
          payload: {
            jobType: "ai_enrichment",
            inspirationId: "insp_success",
          },
          record: {
            body: JSON.stringify({ inspirationId: "insp_success" }),
            messageId: "message-success",
          },
        },
        record: {
          body: JSON.stringify({ inspirationId: "insp_success" }),
          messageId: "message-success",
        },
        status: "acknowledged",
      },
      {
        error: new Error("failed"),
        failureKind: "dispatch",
        record: {
          body: JSON.stringify({ inspirationId: "insp_failure" }),
          messageId: "message-failure",
        },
        retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        status: "failure",
      },
    ]),
    {
      batchItemFailures: [{ itemIdentifier: "message-failure" }],
    },
  );
});

test("partial batch response helper only requeues retryable failures that remain below the max attempt count", () => {
  assert.deepEqual(
    createInspirationQueuePartialBatchResponse([
      {
        attemptCount: 2,
        error: new Error("retry this"),
        failureKind: "dispatch",
        maxAttemptCount: 3,
        record: {
          body: JSON.stringify({ inspirationId: "insp_retry" }),
          messageId: "message-retry",
        },
        retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        status: "failure",
      },
      {
        attemptCount: 3,
        error: new Error("stop retrying"),
        failureKind: "dispatch",
        maxAttemptCount: 3,
        record: {
          body: JSON.stringify({ inspirationId: "insp_terminal" }),
          messageId: "message-terminal",
        },
        retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        status: "failure",
      },
    ]),
    {
      batchItemFailures: [{ itemIdentifier: "message-retry" }],
    },
  );
});
