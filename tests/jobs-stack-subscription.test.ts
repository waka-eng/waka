import assert from "node:assert/strict";
import test from "node:test";

import {
  JOBS_QUEUE_REDRIVE_RETRY_LIMIT,
  INSPIRATION_PROCESSOR_DEAD_LETTER_QUEUE_ACCESS_ACTIONS,
  INSPIRATION_PROCESSOR_EVENT_SOURCE_BATCH_SIZE,
  INSPIRATION_PROCESSOR_EVENT_SOURCE_BATCH_WINDOW,
  INSPIRATION_PROCESSOR_EVENT_SOURCE_FUNCTION_RESPONSE_TYPES,
  INSPIRATION_PROCESSOR_EVENT_SOURCE_MAX_CONCURRENCY,
  INSPIRATION_PROCESSOR_EXECUTION_ROLE_NAME,
  INSPIRATION_PROCESSOR_QUEUE_ACCESS_ACTIONS,
  resolveInspirationProcessorExecutionRole,
  resolveJobsQueueDeadLetterConfiguration,
  resolveInspirationProcessorEventSourceMapping,
  resolveInspirationProcessorQueuePermissions,
} from "../infra/jobs-stack.ts";
import { INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT } from "../apps/web/src/inspirations/enrichment-pipeline.ts";

test("jobs subscriber config processes one message at a time", () => {
  assert.equal(INSPIRATION_PROCESSOR_EVENT_SOURCE_BATCH_SIZE, 1);
  assert.equal(INSPIRATION_PROCESSOR_EVENT_SOURCE_BATCH_WINDOW, "0 seconds");
  assert.deepEqual(
    INSPIRATION_PROCESSOR_EVENT_SOURCE_FUNCTION_RESPONSE_TYPES,
    ["ReportBatchItemFailures"],
  );
  assert.equal(INSPIRATION_PROCESSOR_EVENT_SOURCE_MAX_CONCURRENCY, 10);
  assert.deepEqual(resolveInspirationProcessorEventSourceMapping(), {
    batch: {
      size: 1,
      window: "0 seconds",
    },
    transform: {
      eventSourceMapping: {
        functionResponseTypes: ["ReportBatchItemFailures"],
        scalingConfig: {
          maximumConcurrency: 10,
        },
      },
    },
  });
});

test("jobs subscriber permissions grant the minimal SQS consumer actions", () => {
  const queueArn = "arn:aws:sqs:us-east-1:123456789012:JobsQueue";
  const deadLetterQueueArn =
    "arn:aws:sqs:us-east-1:123456789012:JobsDeadLetterQueue";

  assert.deepEqual(INSPIRATION_PROCESSOR_QUEUE_ACCESS_ACTIONS, [
    "sqs:DeleteMessage",
    "sqs:GetQueueAttributes",
    "sqs:ReceiveMessage",
  ]);
  assert.deepEqual(INSPIRATION_PROCESSOR_DEAD_LETTER_QUEUE_ACCESS_ACTIONS, [
    "sqs:SendMessage",
  ]);
  assert.deepEqual(
    resolveInspirationProcessorQueuePermissions(queueArn, deadLetterQueueArn),
    [
      {
        actions: [
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
          "sqs:ReceiveMessage",
        ],
        resources: [queueArn],
      },
      {
        actions: ["sqs:SendMessage"],
        resources: [deadLetterQueueArn],
      },
    ],
  );
});

test("jobs subscriber execution role resolves to the queue-scoped permissions", () => {
  const queueArn = "arn:aws:sqs:us-east-1:123456789012:JobsQueue";
  const deadLetterQueueArn =
    "arn:aws:sqs:us-east-1:123456789012:JobsDeadLetterQueue";

  assert.equal(
    INSPIRATION_PROCESSOR_EXECUTION_ROLE_NAME,
    "InspirationProcessorExecutionRole",
  );
  assert.deepEqual(
    resolveInspirationProcessorExecutionRole(queueArn, deadLetterQueueArn),
    {
      name: "InspirationProcessorExecutionRole",
      permissions: [
        {
          actions: [
            "sqs:DeleteMessage",
            "sqs:GetQueueAttributes",
            "sqs:ReceiveMessage",
          ],
          resources: [queueArn],
        },
        {
          actions: ["sqs:SendMessage"],
          resources: [deadLetterQueueArn],
        },
      ],
    },
  );
});

test("jobs queue redrives failed messages to a dead-letter queue after three attempts", () => {
  const deadLetterQueueArn =
    "arn:aws:sqs:us-east-1:123456789012:JobsDeadLetterQueue";

  assert.equal(JOBS_QUEUE_REDRIVE_RETRY_LIMIT, 3);
  assert.deepEqual(
    resolveJobsQueueDeadLetterConfiguration(deadLetterQueueArn),
    {
      queue: deadLetterQueueArn,
      retry: 3,
    },
  );
});

test("application failure metadata stays aligned with the queue redrive retry limit", () => {
  assert.equal(
    INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    JOBS_QUEUE_REDRIVE_RETRY_LIMIT,
  );
});
