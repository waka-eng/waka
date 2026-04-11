import {
  parseSqsJobPayload,
  parseSupportedSqsJobType,
} from "../../../../packages/shared/schemas.ts";
import type {
  SupportedSqsJobPayload,
  SupportedSqsJobType,
} from "../../../../packages/shared/types.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
} from "../inspirations/enrichment-pipeline.ts";
import type { InspirationJobFailureRetryability } from "./inspiration-job-failure.ts";

export interface InspirationQueueMessageAttribute {
  binaryValue?: string;
  dataType?: string;
  stringValue?: string;
}

export interface InspirationQueueRecord {
  attributes?: Record<string, string>;
  awsRegion?: string;
  body: string;
  eventSource?: string;
  eventSourceARN?: string;
  messageAttributes?: Record<string, InspirationQueueMessageAttribute>;
  messageId: string;
  receiptHandle?: string;
}

export interface InspirationQueueEvent {
  Records: InspirationQueueRecord[];
}

export interface InspirationQueueJobMetadata {
  attributes?: Record<string, string>;
  awsRegion?: string;
  eventSource?: string;
  eventSourceARN?: string;
  messageAttributes?: Record<string, InspirationQueueMessageAttribute>;
  messageId: string;
  receiptHandle?: string;
}

export interface InspirationQueueRecordProcessingRequest {
  body: string;
  jobType?: SupportedSqsJobType;
  metadata: InspirationQueueJobMetadata;
  payload?: SupportedSqsJobPayload;
  record: InspirationQueueRecord;
}

export interface InspirationQueueMessageProcessingSuccess {
  outcome: "success";
}

export interface InspirationQueueMessageProcessingAttemptContext {
  attemptCount?: number;
  maxAttemptCount?: number;
}

export interface InspirationQueueMessageProcessingFailureResult {
  attemptCount?: number;
  error: unknown;
  maxAttemptCount?: number;
  outcome: "failure";
  retryability: InspirationJobFailureRetryability;
}

export type InspirationQueueMessageProcessingResult =
  | InspirationQueueMessageProcessingSuccess
  | InspirationQueueMessageProcessingFailureResult;

export type InspirationQueueMessageProcessor = (
  request: InspirationQueueRecordProcessingRequest,
) => Promise<InspirationQueueMessageProcessingResult>;

export const DEFAULT_INSPIRATION_QUEUE_JOB_TYPE = "ai_enrichment";

export function createInspirationQueueMessageProcessingSuccess(): InspirationQueueMessageProcessingSuccess {
  return {
    outcome: "success",
  };
}

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

export function resolveInspirationQueueAttemptCount(
  metadataOrRequest:
    | Pick<InspirationQueueJobMetadata, "attributes">
    | Pick<InspirationQueueRecordProcessingRequest, "metadata">,
): number {
  const attributes =
    "metadata" in metadataOrRequest
      ? metadataOrRequest.metadata.attributes
      : metadataOrRequest.attributes;
  const approximateReceiveCount = Number.parseInt(
    attributes?.ApproximateReceiveCount ?? "",
    10,
  );

  return readPositiveInteger(approximateReceiveCount) ?? 1;
}

export function resolveInspirationQueueMaxAttemptCount(
  value: unknown,
): number {
  return (
    readPositiveInteger(value) ?? INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT
  );
}

export function createInspirationQueueMessageProcessingFailure(
  error: unknown,
  retryability: InspirationJobFailureRetryability =
    INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE,
  attemptContext: InspirationQueueMessageProcessingAttemptContext = {},
): InspirationQueueMessageProcessingFailureResult {
  return {
    ...(readPositiveInteger(attemptContext.attemptCount) === undefined
      ? {}
      : {
          attemptCount: readPositiveInteger(attemptContext.attemptCount),
        }),
    error,
    ...(readPositiveInteger(attemptContext.maxAttemptCount) === undefined
      ? {}
      : {
          maxAttemptCount: readPositiveInteger(attemptContext.maxAttemptCount),
        }),
    outcome: "failure",
    retryability,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isInspirationQueueMessageProcessingRetryability(
  value: unknown,
): value is InspirationJobFailureRetryability {
  return (
    value === INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE ||
    value === INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE
  );
}

export function isInspirationQueueMessageProcessingResult(
  value: unknown,
): value is InspirationQueueMessageProcessingResult {
  if (!isRecord(value) || typeof value.outcome !== "string") {
    return false;
  }

  if (value.outcome === "success") {
    return true;
  }

  return (
    value.outcome === "failure" &&
    "error" in value &&
    isInspirationQueueMessageProcessingRetryability(value.retryability)
  );
}

function readRequiredNonEmptyString(
  value: unknown,
  errorMessage: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(errorMessage);
  }

  return value;
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function readStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function readMessageAttributes(
  value: unknown,
): Record<string, InspirationQueueMessageAttribute> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value).filter((entry) => isRecord(entry[1]));

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    entries.map(([key, attribute]) => {
      const normalizedAttribute = attribute as Record<string, unknown>;

      return [
        key,
        {
          binaryValue: readOptionalString(normalizedAttribute.binaryValue),
          dataType: readOptionalString(normalizedAttribute.dataType),
          stringValue: readOptionalString(normalizedAttribute.stringValue),
        },
      ];
    }),
  );
}

export function validateInspirationQueueRecord(
  record: unknown,
  index: number,
): InspirationQueueRecord {
  if (!isRecord(record)) {
    throw new TypeError(`Queue record at index ${index} must be an object.`);
  }

  return {
    attributes: readStringMap(record.attributes),
    awsRegion: readOptionalString(record.awsRegion),
    body: readRequiredNonEmptyString(
      record.body,
      `Queue record at index ${index} must include a non-empty body.`,
    ),
    eventSource: readOptionalString(record.eventSource),
    eventSourceARN: readOptionalString(record.eventSourceARN),
    messageAttributes: readMessageAttributes(record.messageAttributes),
    messageId: readRequiredNonEmptyString(
      record.messageId,
      `Queue record at index ${index} must include a non-empty messageId.`,
    ),
    receiptHandle: readOptionalString(record.receiptHandle),
  };
}

export function validateInspirationQueueEvent(
  event: unknown,
): InspirationQueueEvent {
  if (!isRecord(event) || !Array.isArray(event.Records)) {
    throw new TypeError("Queue event must include a Records array.");
  }

  return {
    Records: event.Records.map((record, index) =>
      validateInspirationQueueRecord(record, index),
    ),
  };
}

export function createInspirationQueueRecordProcessingRequest(
  record: InspirationQueueRecord,
): InspirationQueueRecordProcessingRequest {
  return {
    body: record.body,
    metadata: {
      attributes: record.attributes,
      awsRegion: record.awsRegion,
      eventSource: record.eventSource,
      eventSourceARN: record.eventSourceARN,
      messageAttributes: record.messageAttributes,
      messageId: record.messageId,
      receiptHandle: record.receiptHandle,
    },
    record,
  };
}

function parseInspirationQueueRecordBody(body: string): Record<string, unknown> {
  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new TypeError(
      `Inspiration queue body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new TypeError("Inspiration queue body must be a JSON object.");
  }

  return payload;
}

function resolveInspirationQueueRecordJobType(
  record: InspirationQueueRecord,
  payload: Record<string, unknown>,
): SupportedSqsJobType {
  const attributeJobType = readOptionalString(
    record.messageAttributes?.jobType?.stringValue,
  );

  if (attributeJobType) {
    return parseSupportedSqsJobType(
      attributeJobType,
      "Queue record jobType message attribute",
    );
  }

  if (payload.jobType !== undefined) {
    return parseSupportedSqsJobType(payload.jobType, "Inspiration queue body jobType");
  }

  return DEFAULT_INSPIRATION_QUEUE_JOB_TYPE;
}

export function createValidatedInspirationQueueRecordProcessingRequest(
  record: InspirationQueueRecord,
): InspirationQueueRecordProcessingRequest {
  const request = createInspirationQueueRecordProcessingRequest(record);
  const payload = parseInspirationQueueRecordBody(request.body);
  const jobType = resolveInspirationQueueRecordJobType(record, payload);

  return {
    ...request,
    jobType,
    payload: parseSqsJobPayload(jobType, payload),
  };
}
