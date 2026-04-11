import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
} from "../inspirations/enrichment-pipeline.ts";
import { classifyInspirationAiFieldGenerationFailure } from "./inspiration-ai-field-generation-policy.ts";

export type InspirationJobFailureRetryability =
  | typeof INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE
  | typeof INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE;

export interface InspirationJobFailureTerminalContext {
  attemptCount?: number;
  maxAttemptCount?: number;
}

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

export function classifyInspirationJobFailureRetryability(
  error: unknown,
): InspirationJobFailureRetryability {
  const classification = classifyInspirationAiFieldGenerationFailure(error);

  return classification.retryability ===
    INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE
    ? INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE
    : INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE;
}

export function isInspirationJobFailureRetryable(
  retryability: InspirationJobFailureRetryability,
): boolean {
  return retryability === INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE;
}

export function isInspirationJobFailureTerminal(
  error: unknown,
  context: InspirationJobFailureTerminalContext = {},
): boolean {
  const retryability = classifyInspirationJobFailureRetryability(error);

  if (!isInspirationJobFailureRetryable(retryability)) {
    return true;
  }

  const attemptCount = readPositiveInteger(context.attemptCount);
  const maxAttemptCount =
    readPositiveInteger(context.maxAttemptCount) ??
    INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT;

  return attemptCount !== undefined && attemptCount >= maxAttemptCount;
}
