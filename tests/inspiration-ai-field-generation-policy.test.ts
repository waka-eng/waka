import assert from "node:assert/strict";
import test from "node:test";

import { LLMProviderError } from "../packages/shared/llm/provider.ts";
import { calculateLLMProviderRetryDelayMs } from "../packages/shared/llm/transport-retry.ts";
import {
  classifyInspirationAiFieldGenerationFailure,
  InspirationAiFieldGenerationTimeoutError,
  INSPIRATION_AI_FIELD_GENERATION_RETRY_POLICIES,
  INSPIRATION_AI_FIELD_GENERATION_STEP_NAMES,
  resolveInspirationAiFieldGenerationRetryPolicy,
} from "../apps/web/src/jobs/inspiration-ai-field-generation-policy.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";

test("field generation retry policy defines bounded attempts and exponential backoff for every step", () => {
  const expectedBackoffScheduleMs = [
    calculateLLMProviderRetryDelayMs(0),
    calculateLLMProviderRetryDelayMs(1),
    calculateLLMProviderRetryDelayMs(2),
  ];

  for (const stepName of INSPIRATION_AI_FIELD_GENERATION_STEP_NAMES) {
    const policy = resolveInspirationAiFieldGenerationRetryPolicy(stepName);

    assert.equal(
      policy,
      INSPIRATION_AI_FIELD_GENERATION_RETRY_POLICIES[stepName],
    );
    assert.equal(policy.stepName, stepName);
    assert.equal(policy.maxAttemptCount, INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT);
    assert.equal(policy.providerMaxRetries, 3);
    assert.equal(policy.backoffStrategy, "EXPONENTIAL");
    assert.deepEqual(policy.providerBackoffScheduleMs, expectedBackoffScheduleMs);
    assert.equal(policy.fieldNames.length > 0, true);
    assert.equal(policy.transientFailureClasses.length > 0, true);
    assert.equal(policy.terminalFailureClasses.length > 0, true);
  }
});

test("field generation failure classifier marks provider throttling and runtime timeouts as transient", () => {
  assert.deepEqual(
    classifyInspirationAiFieldGenerationFailure(
      new LLMProviderError({
        code: "RATE_LIMITED",
        message: "Try again shortly.",
        operation: "summarize",
        provider: "openai",
        retryable: true,
        statusCode: 429,
      }),
    ),
    {
      failureClass: "TRANSIENT_PROVIDER_RATE_LIMITED",
      retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
    },
  );

  assert.deepEqual(
    classifyInspirationAiFieldGenerationFailure(
      new InspirationAiFieldGenerationTimeoutError(["embedding"], 55_000),
    ),
    {
      failureClass: "TRANSIENT_FIELD_RUNTIME_TIMEOUT",
      retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
    },
  );
});

test("field generation failure classifier marks permanent provider and validation failures as terminal", () => {
  assert.deepEqual(
    classifyInspirationAiFieldGenerationFailure(
      new LLMProviderError({
        code: "AUTHENTICATION",
        message: "Missing API key.",
        operation: "generateTitle",
        provider: "gemini",
        retryable: false,
        statusCode: 401,
      }),
    ),
    {
      failureClass: "TERMINAL_PROVIDER_AUTHENTICATION",
      retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
    },
  );

  assert.deepEqual(
    classifyInspirationAiFieldGenerationFailure(
      new TypeError("Queue body must be valid JSON."),
    ),
    {
      failureClass: "TERMINAL_INPUT_VALIDATION",
      retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
    },
  );

  assert.deepEqual(
    classifyInspirationAiFieldGenerationFailure(
      new Error("Inspiration insp_missing was not found for embedding generation."),
    ),
    {
      failureClass: "TERMINAL_CAPTURE_NOT_FOUND",
      retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
    },
  );
});

test("aggregate failures keep the first retryable field-generation classification when any nested cause is transient", () => {
  assert.deepEqual(
    classifyInspirationAiFieldGenerationFailure(
      new AggregateError(
        [
          new TypeError("Malformed local payload."),
          new LLMProviderError({
            code: "UNAVAILABLE",
            message: "Provider is briefly unavailable.",
            operation: "classifyMetadata",
            provider: "openai",
            retryable: true,
            statusCode: 503,
          }),
        ],
        "The field generation step failed with multiple causes.",
      ),
    ),
    {
      failureClass: "TRANSIENT_PROVIDER_UNAVAILABLE",
      retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
    },
  );
});
