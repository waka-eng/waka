import type {
  LLMProviderErrorCode,
} from "../../../../packages/shared/llm/provider.ts";
import {
  isLLMProviderError,
} from "../../../../packages/shared/llm/provider.ts";
import {
  calculateLLMProviderRetryDelayMs,
  DEFAULT_LLM_PROVIDER_MAX_RETRIES,
} from "../../../../packages/shared/llm/transport-retry.ts";
import {
  INSPIRATION_AI_FIELD_TERMINAL_FAILURE_CLASSES,
  INSPIRATION_AI_FIELD_TRANSIENT_FAILURE_CLASSES,
  INSPIRATION_ENRICHMENT_METADATA_FIELD_NAMES,
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  type InspirationAiFieldFailureClass,
  type InspirationEnrichmentFieldName,
  type InspirationEnrichmentRetryability,
} from "../inspirations/enrichment-field-metadata.ts";
import { INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT } from "../inspirations/enrichment-pipeline.ts";

export const INSPIRATION_AI_FIELD_GENERATION_STEP_NAMES = [
  "embedding",
  "summary",
  "metadata",
  "title",
] as const;

export type InspirationAiFieldGenerationStepName =
  (typeof INSPIRATION_AI_FIELD_GENERATION_STEP_NAMES)[number];

export const INSPIRATION_AI_FIELD_GENERATION_BACKOFF_STRATEGY =
  "EXPONENTIAL";

export interface InspirationAiFieldGenerationRetryPolicy {
  backoffStrategy: typeof INSPIRATION_AI_FIELD_GENERATION_BACKOFF_STRATEGY;
  fieldNames: readonly InspirationEnrichmentFieldName[];
  maxAttemptCount: number;
  providerBackoffScheduleMs: readonly number[];
  providerMaxRetries: number;
  stepName: InspirationAiFieldGenerationStepName;
  terminalFailureClasses: readonly InspirationAiFieldFailureClass[];
  transientFailureClasses: readonly InspirationAiFieldFailureClass[];
}

export interface InspirationAiFieldFailureClassification {
  failureClass: InspirationAiFieldFailureClass;
  retryability: InspirationEnrichmentRetryability;
}

const NOT_FOUND_ERROR_PATTERN = /\bnot found\b/i;
const SINGLE_FIELD_POLICIES = {
  embedding: ["embedding"],
  summary: ["summary"],
  title: ["title"],
} as const satisfies Record<
  Exclude<InspirationAiFieldGenerationStepName, "metadata">,
  readonly InspirationEnrichmentFieldName[]
>;

function buildProviderBackoffScheduleMs(maxRetries: number): number[] {
  return Array.from({ length: maxRetries }, (_, attempt) =>
    calculateLLMProviderRetryDelayMs(attempt),
  );
}

function buildRetryPolicy(
  stepName: InspirationAiFieldGenerationStepName,
  fieldNames: readonly InspirationEnrichmentFieldName[],
): InspirationAiFieldGenerationRetryPolicy {
  return {
    backoffStrategy: INSPIRATION_AI_FIELD_GENERATION_BACKOFF_STRATEGY,
    fieldNames,
    maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
    providerBackoffScheduleMs: buildProviderBackoffScheduleMs(
      DEFAULT_LLM_PROVIDER_MAX_RETRIES,
    ),
    providerMaxRetries: DEFAULT_LLM_PROVIDER_MAX_RETRIES,
    stepName,
    terminalFailureClasses: INSPIRATION_AI_FIELD_TERMINAL_FAILURE_CLASSES,
    transientFailureClasses: INSPIRATION_AI_FIELD_TRANSIENT_FAILURE_CLASSES,
  };
}

function retryable(
  failureClass: InspirationAiFieldFailureClass,
): InspirationAiFieldFailureClassification {
  return {
    failureClass,
    retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  };
}

function nonRetryable(
  failureClass: InspirationAiFieldFailureClass,
): InspirationAiFieldFailureClassification {
  return {
    failureClass,
    retryability: INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  };
}

function readAggregateErrors(error: AggregateError): readonly unknown[] {
  return Array.isArray(error.errors) ? error.errors : [];
}

function isNonRetryableErrorType(error: unknown): boolean {
  return (
    error instanceof RangeError ||
    error instanceof SyntaxError ||
    error instanceof TypeError
  );
}

function isNonRetryableErrorMessage(error: Error): boolean {
  return NOT_FOUND_ERROR_PATTERN.test(error.message);
}

function mapProviderErrorCode(
  code: LLMProviderErrorCode,
  retryableError: boolean,
): InspirationAiFieldFailureClassification {
  switch (code) {
    case "AUTHENTICATION":
      return nonRetryable("TERMINAL_PROVIDER_AUTHENTICATION");
    case "BAD_REQUEST":
      return nonRetryable("TERMINAL_PROVIDER_BAD_REQUEST");
    case "INVALID_RESPONSE":
      return nonRetryable("TERMINAL_PROVIDER_INVALID_RESPONSE");
    case "RATE_LIMITED":
      return retryable("TRANSIENT_PROVIDER_RATE_LIMITED");
    case "TIMEOUT":
      return retryable("TRANSIENT_PROVIDER_TIMEOUT");
    case "UNAVAILABLE":
      return retryable("TRANSIENT_PROVIDER_UNAVAILABLE");
    case "UNSUPPORTED_OPERATION":
      return nonRetryable("TERMINAL_PROVIDER_UNSUPPORTED_OPERATION");
    case "UNKNOWN":
      return retryableError
        ? retryable("TRANSIENT_PROVIDER_UNKNOWN")
        : nonRetryable("TERMINAL_UNKNOWN");
  }
}

export class InspirationAiFieldGenerationTimeoutError extends Error {
  readonly allowedRuntimeMs: number;
  readonly fieldNames: readonly InspirationEnrichmentFieldName[];

  constructor(
    fieldNames: readonly InspirationEnrichmentFieldName[],
    allowedRuntimeMs: number,
  ) {
    super(
      `AI field generation exceeded the allowed runtime of ${allowedRuntimeMs}ms. Timed out unfinished fields: ${fieldNames.join(", ")}.`,
    );

    this.allowedRuntimeMs = allowedRuntimeMs;
    this.fieldNames = fieldNames;
    this.name = "InspirationAiFieldGenerationTimeoutError";
  }
}

export const INSPIRATION_AI_FIELD_GENERATION_RETRY_POLICIES = {
  embedding: buildRetryPolicy("embedding", SINGLE_FIELD_POLICIES.embedding),
  metadata: buildRetryPolicy(
    "metadata",
    INSPIRATION_ENRICHMENT_METADATA_FIELD_NAMES,
  ),
  summary: buildRetryPolicy("summary", SINGLE_FIELD_POLICIES.summary),
  title: buildRetryPolicy("title", SINGLE_FIELD_POLICIES.title),
} as const satisfies Record<
  InspirationAiFieldGenerationStepName,
  InspirationAiFieldGenerationRetryPolicy
>;

export function resolveInspirationAiFieldGenerationRetryPolicy(
  stepName: InspirationAiFieldGenerationStepName,
): InspirationAiFieldGenerationRetryPolicy {
  return INSPIRATION_AI_FIELD_GENERATION_RETRY_POLICIES[stepName];
}

export function classifyInspirationAiFieldGenerationFailure(
  error: unknown,
): InspirationAiFieldFailureClassification {
  if (error instanceof AggregateError) {
    const aggregateErrors = readAggregateErrors(error);

    if (aggregateErrors.length > 0) {
      const retryableClassification = aggregateErrors
        .map((aggregateError) =>
          classifyInspirationAiFieldGenerationFailure(aggregateError),
        )
        .find(
          (classification) =>
            classification.retryability ===
            INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
        );

      return (
        retryableClassification ??
        classifyInspirationAiFieldGenerationFailure(aggregateErrors[0])
      );
    }
  }

  if (error instanceof InspirationAiFieldGenerationTimeoutError) {
    return retryable("TRANSIENT_FIELD_RUNTIME_TIMEOUT");
  }

  if (isLLMProviderError(error)) {
    return mapProviderErrorCode(error.code, error.retryable);
  }

  if (isNonRetryableErrorType(error)) {
    return nonRetryable("TERMINAL_INPUT_VALIDATION");
  }

  if (error instanceof Error && isNonRetryableErrorMessage(error)) {
    return nonRetryable("TERMINAL_CAPTURE_NOT_FOUND");
  }

  return retryable("TRANSIENT_UNKNOWN");
}
