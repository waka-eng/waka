import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSignedSqsSendMessageRequest,
  createEnvironmentInspirationQueueDeadLetterPublisher,
  createInspirationQueueDeadLetterMessage,
  type InspirationQueueDeadLetterMessage,
} from "../apps/web/src/jobs/inspiration-dead-letter.ts";
import { JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY } from "../packages/shared/types.ts";
import {
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";

function createTerminalDeadLetterMessage(): InspirationQueueDeadLetterMessage {
  return createInspirationQueueDeadLetterMessage(
    {
      attemptCount: 1,
      error: new TypeError("Reject this malformed payload permanently."),
      failureKind: "non-dispatch",
      maxAttemptCount: 3,
      record: {
        body: JSON.stringify({ inspirationId: "insp_dead_letter" }),
        messageId: "message-dead-letter",
      },
      retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
      terminalReason: "non_retryable",
    },
    new Date("2026-04-10T00:00:00.000Z"),
  );
}

test("dead-letter message preserves the original payload snapshot and serialized failure metadata", () => {
  const message = createInspirationQueueDeadLetterMessage(
    {
      attemptCount: 3,
      error: new Error("Retries were exhausted."),
      failureKind: "dispatch",
      maxAttemptCount: 3,
      processingRequest: {
        body: JSON.stringify({ inspirationId: "insp_retry_exhausted" }),
        jobType: "ai_enrichment",
        metadata: {
          messageId: "message-retry-exhausted",
        },
        payload: {
          jobType: "ai_enrichment",
          inspirationId: "insp_retry_exhausted",
        },
        record: {
          body: JSON.stringify({ inspirationId: "insp_retry_exhausted" }),
          messageId: "message-retry-exhausted",
        },
      },
      record: {
        body: JSON.stringify({ inspirationId: "insp_retry_exhausted" }),
        messageId: "message-retry-exhausted",
      },
      retryability: "RETRYABLE",
      terminalReason: "max_attempts_exhausted",
    },
    new Date("2026-04-10T00:01:00.000Z"),
  );

  assert.equal(message.schemaVersion, 1);
  assert.equal(message.deadLetteredAt, "2026-04-10T00:01:00.000Z");
  assert.equal(message.failure.kind, "dispatch");
  assert.equal(message.failure.terminalReason, "max_attempts_exhausted");
  assert.equal(message.failure.retryability, "RETRYABLE");
  assert.equal(message.failure.attemptCount, 3);
  assert.equal(message.failure.maxAttemptCount, 3);
  assert.equal(message.failure.error.reason, "Retries were exhausted.");
  assert.deepEqual(message.processingRequest?.payload, {
    jobType: "ai_enrichment",
    inspirationId: "insp_retry_exhausted",
  });
});

test("signed SQS dead-letter requests include the queue body and inspection attributes", () => {
  const request = buildSignedSqsSendMessageRequest({
    credentials: {
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "secret",
      sessionToken: "session-token",
    },
    message: createTerminalDeadLetterMessage(),
    now: new Date("2026-04-10T00:00:00.000Z"),
    queueUrl:
      "https://sqs.us-east-1.amazonaws.com/123456789012/JobsDeadLetterQueue",
    region: "us-east-1",
  });

  assert.equal(
    request.url,
    "https://sqs.us-east-1.amazonaws.com/123456789012/JobsDeadLetterQueue",
  );
  assert.equal(request.headers["Content-Type"], "application/x-www-form-urlencoded; charset=utf-8");
  assert.match(request.headers.Authorization, /Credential=AKIAEXAMPLE\/20260410\/us-east-1\/sqs\/aws4_request/);
  assert.equal(request.headers["X-Amz-Date"], "20260410T000000Z");
  assert.equal(request.headers["X-Amz-Security-Token"], "session-token");
  assert.match(
    decodeURIComponent(request.body),
    /Action=SendMessage/,
  );
  assert.match(
    decodeURIComponent(request.body),
    /MessageAttribute\.1\.Name=failureKind/,
  );
  assert.match(
    decodeURIComponent(request.body),
    /"terminalReason":"non_retryable"/,
  );
});

test("environment-backed dead-letter publisher sends the signed request through fetch", async () => {
  const fetchCalls: Array<{
    body: string;
    headers: Record<string, string>;
    method: string;
    url: string;
  }> = [];
  const publisher = createEnvironmentInspirationQueueDeadLetterPublisher({
    env: {
      AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
      AWS_SECRET_ACCESS_KEY: "secret",
      AWS_SESSION_TOKEN: "session-token",
      AWS_REGION: "us-east-1",
      [JOBS_DEAD_LETTER_QUEUE_URL_ENVIRONMENT_KEY]:
        "https://sqs.us-east-1.amazonaws.com/123456789012/JobsDeadLetterQueue",
    },
    fetch: async (url, init) => {
      fetchCalls.push({
        body: String(init?.body ?? ""),
        headers: init?.headers as Record<string, string>,
        method: String(init?.method ?? ""),
        url: String(url),
      });

      return {
        ok: true,
        status: 200,
        async text() {
          return "<SendMessageResponse />";
        },
      } as Response;
    },
    now: () => new Date("2026-04-10T00:02:00.000Z"),
  });

  await publisher.publish(createTerminalDeadLetterMessage());

  assert.equal(fetchCalls.length, 1);
  assert.equal(
    fetchCalls[0]?.url,
    "https://sqs.us-east-1.amazonaws.com/123456789012/JobsDeadLetterQueue",
  );
  assert.equal(fetchCalls[0]?.method, "POST");
  assert.match(
    String(fetchCalls[0]?.headers.Authorization),
    /AWS4-HMAC-SHA256/,
  );
  assert.match(decodeURIComponent(fetchCalls[0]?.body ?? ""), /SendMessage/);
});
