import assert from "node:assert/strict";
import test from "node:test";

import { LLMProviderError } from "../packages/shared/llm/provider.ts";
import {
  classifyInspirationJobFailureRetryability,
  isInspirationJobFailureTerminal,
  isInspirationJobFailureRetryable,
} from "../apps/web/src/jobs/inspiration-job-failure.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";

test("worker failure classifier treats typed transient provider failures as retryable", () => {
  const retryability = classifyInspirationJobFailureRetryability(
    new LLMProviderError({
      code: "RATE_LIMITED",
      message: "Try again shortly.",
      operation: "summarize",
      provider: "openai",
      retryable: true,
      statusCode: 429,
    }),
  );

  assert.equal(retryability, INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE);
  assert.equal(isInspirationJobFailureRetryable(retryability), true);
});

test("worker failure classifier treats typed permanent provider failures as non-retryable", () => {
  const retryability = classifyInspirationJobFailureRetryability(
    new LLMProviderError({
      code: "INVALID_RESPONSE",
      message: "Provider returned malformed JSON.",
      operation: "classifyMetadata",
      provider: "openai",
      retryable: false,
    }),
  );

  assert.equal(
    retryability,
    INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  );
  assert.equal(isInspirationJobFailureRetryable(retryability), false);
});

test("worker failure classifier treats validation and not-found failures as non-retryable", () => {
  assert.equal(
    classifyInspirationJobFailureRetryability(
      new TypeError("Queue body must be valid JSON."),
    ),
    INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  );
  assert.equal(
    classifyInspirationJobFailureRetryability(
      new Error("Inspiration insp_missing was not found for embedding generation."),
    ),
    INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  );
});

test("worker failure classifier treats unknown runtime errors as retryable", () => {
  assert.equal(
    classifyInspirationJobFailureRetryability(
      new Error("Embedding provider timed out."),
    ),
    INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  );
});

test("worker failure classifier keeps aggregate failures retryable when any nested cause is retryable", () => {
  const retryability = classifyInspirationJobFailureRetryability(
    new AggregateError(
      [
        new LLMProviderError({
          code: "RATE_LIMITED",
          message: "Provider throttled this request.",
          operation: "generateEmbedding",
          provider: "openai",
          retryable: true,
          statusCode: 429,
        }),
        new Error("Failure state persistence also failed."),
      ],
      "The worker failed and could not persist the failure state.",
    ),
  );

  assert.equal(retryability, INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE);
});

test("worker failure classifier keeps aggregate failures non-retryable when every nested cause is terminal", () => {
  const retryability = classifyInspirationJobFailureRetryability(
    new AggregateError(
      [
        new TypeError("Queue body must be valid JSON."),
        new Error("Inspiration insp_missing was not found for embedding generation."),
      ],
      "The worker failed with terminal validation errors.",
    ),
  );

  assert.equal(
    retryability,
    INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  );
  assert.equal(isInspirationJobFailureRetryable(retryability), false);
});

test("worker failure terminal classifier marks non-retryable provider failures as terminal immediately", () => {
  assert.equal(
    isInspirationJobFailureTerminal(
      new LLMProviderError({
        code: "INVALID_RESPONSE",
        message: "Provider returned malformed JSON.",
        operation: "classifyMetadata",
        provider: "openai",
        retryable: false,
      }),
      {
        attemptCount: 1,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      },
    ),
    true,
  );
});

test("worker failure terminal classifier marks retryable failures as terminal once max attempts are exhausted", () => {
  const retryableFailure = new LLMProviderError({
    code: "TIMEOUT",
    message: "Provider timed out.",
    operation: "generateEmbedding",
    provider: "openai",
    retryable: true,
  });

  assert.equal(
    isInspirationJobFailureTerminal(retryableFailure, {
      attemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT - 1,
      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    }),
    false,
  );
  assert.equal(
    isInspirationJobFailureTerminal(retryableFailure, {
      attemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    }),
    true,
  );
});
