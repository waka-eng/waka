import type { ConnectionAnalysisSqsJobPayload } from "../../../../packages/shared/types.ts";

export const DEFAULT_INSPIRATION_CONNECTION_ANALYSIS_LIMIT = 5;
export const DEFAULT_INSPIRATION_CONNECTION_SIMILARITY_THRESHOLD = 0.78;

export interface ConnectionAnalysisJobPublisher {
  enqueue(payload: ConnectionAnalysisSqsJobPayload): Promise<void>;
}

function readRequiredNonEmptyString(value: string, label: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }

  return value;
}

function readUnitIntervalNumber(value: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite number between 0 and 1.`);
  }

  return value;
}

export interface BuildConnectionAnalysisJobPayloadInput {
  inspirationId: string;
  maxConnections?: number;
  similarityThreshold?: number;
  userId: string;
}

export function buildConnectionAnalysisJobPayload(
  input: BuildConnectionAnalysisJobPayloadInput,
): ConnectionAnalysisSqsJobPayload {
  return {
    inspirationId: readRequiredNonEmptyString(
      input.inspirationId,
      "Connection analysis inspiration id",
    ),
    jobType: "connection_analysis",
    maxConnections: readPositiveInteger(
      input.maxConnections ?? DEFAULT_INSPIRATION_CONNECTION_ANALYSIS_LIMIT,
      "Connection analysis maxConnections",
    ),
    similarityThreshold: readUnitIntervalNumber(
      input.similarityThreshold ??
        DEFAULT_INSPIRATION_CONNECTION_SIMILARITY_THRESHOLD,
      "Connection analysis similarityThreshold",
    ),
    userId: readRequiredNonEmptyString(input.userId, "Connection analysis user id"),
  };
}
