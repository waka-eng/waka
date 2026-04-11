import type {
  LLMProviderErrorCode,
  LLMProviderMetadata,
  LLMProviderOperation,
} from "../../../../packages/shared/llm/provider.ts";
import {
  AI_ENRICHMENT_FIELD_NAMES,
  type AiEnrichmentFieldName,
} from "../../../../packages/shared/types.ts";

export const INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE = "RETRYABLE";
export const INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE =
  "NON_RETRYABLE";
export const INSPIRATION_ENRICHMENT_RETRYABILITY_UNKNOWN = "UNKNOWN";

export type InspirationEnrichmentRetryability =
  | typeof INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE
  | typeof INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE
  | typeof INSPIRATION_ENRICHMENT_RETRYABILITY_UNKNOWN;

export const INSPIRATION_AI_FIELD_TRANSIENT_FAILURE_CLASSES = [
  "TRANSIENT_PROVIDER_RATE_LIMITED",
  "TRANSIENT_PROVIDER_TIMEOUT",
  "TRANSIENT_PROVIDER_UNAVAILABLE",
  "TRANSIENT_PROVIDER_UNKNOWN",
  "TRANSIENT_FIELD_RUNTIME_TIMEOUT",
  "TRANSIENT_UNKNOWN",
] as const;

export const INSPIRATION_AI_FIELD_TERMINAL_FAILURE_CLASSES = [
  "TERMINAL_PROVIDER_AUTHENTICATION",
  "TERMINAL_PROVIDER_BAD_REQUEST",
  "TERMINAL_PROVIDER_INVALID_RESPONSE",
  "TERMINAL_PROVIDER_UNSUPPORTED_OPERATION",
  "TERMINAL_CAPTURE_NOT_FOUND",
  "TERMINAL_INPUT_VALIDATION",
  "TERMINAL_UNKNOWN",
] as const;

export const INSPIRATION_AI_FIELD_FAILURE_CLASSES = [
  ...INSPIRATION_AI_FIELD_TRANSIENT_FAILURE_CLASSES,
  ...INSPIRATION_AI_FIELD_TERMINAL_FAILURE_CLASSES,
] as const;

export type InspirationAiFieldFailureClass =
  (typeof INSPIRATION_AI_FIELD_FAILURE_CLASSES)[number];

export const INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING = "PENDING";
export const INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING = "PROCESSING";
export const INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED = "COMPLETED";
export const INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED = "FAILED";
export const INSPIRATION_ENRICHMENT_FIELD_STATUS_TIMEOUT = "TIMEOUT";

export type InspirationEnrichmentFieldStatus =
  | typeof INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING
  | typeof INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING
  | typeof INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED
  | typeof INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED
  | typeof INSPIRATION_ENRICHMENT_FIELD_STATUS_TIMEOUT;

export const INSPIRATION_ENRICHMENT_FIELD_NAMES = AI_ENRICHMENT_FIELD_NAMES;

export const INSPIRATION_ENRICHMENT_METADATA_FIELD_NAMES = [
  "tags",
  "domain",
  "mood",
  "actionability",
] as const;

export type InspirationEnrichmentFieldName = AiEnrichmentFieldName;

export interface InspirationEnrichmentErrorDetails {
  attemptCount?: number;
  capturedAt: string;
  code?: LLMProviderErrorCode;
  details?: LLMProviderMetadata;
  failureClass?: InspirationAiFieldFailureClass;
  maxAttemptCount?: number;
  message: string;
  name?: string;
  operation?: LLMProviderOperation;
  provider?: string;
  reason?: string;
  requestId?: string;
  retryability?: InspirationEnrichmentRetryability;
  retryable?: boolean;
  stack?: string;
  statusCode?: number;
  traceId?: string;
}

export interface InspirationEnrichmentFieldMetadata {
  attemptCount: number;
  completedAt: string | null;
  failedAt: string | null;
  lastError: InspirationEnrichmentErrorDetails | null;
  lastFailureReason: string | null;
  lastFailureRetryability: InspirationEnrichmentRetryability | null;
  maxAttemptCount: number;
  startedAt: string | null;
  status: InspirationEnrichmentFieldStatus;
}

export type InspirationEnrichmentFields = Record<
  InspirationEnrichmentFieldName,
  InspirationEnrichmentFieldMetadata
>;

export interface BuildInspirationEnrichmentFieldMetadataInput {
  attemptCount?: number;
  completedAt?: Date | null;
  failedAt?: Date | null;
  lastError?: InspirationEnrichmentErrorDetails | null;
  lastFailureReason?: string | null;
  lastFailureRetryability?: InspirationEnrichmentRetryability | null;
  maxAttemptCount: number;
  startedAt?: Date | null;
  status: InspirationEnrichmentFieldStatus;
}

export interface BuildProcessingInspirationEnrichmentFieldsInput {
  attemptCount?: number;
  completedFieldNames?: readonly InspirationEnrichmentFieldName[];
  existingFields?: InspirationEnrichmentFields;
  maxAttemptCount: number;
  processingFieldNames?: readonly InspirationEnrichmentFieldName[];
}

export interface BuildQueuedInspirationEnrichmentFieldsInput {
  completedFieldNames?: readonly InspirationEnrichmentFieldName[];
  existingFields?: InspirationEnrichmentFields;
  maxAttemptCount: number;
  pendingFieldNames?: readonly InspirationEnrichmentFieldName[];
}

export interface BuildFailedInspirationEnrichmentFieldsInput {
  attemptCount?: number;
  completedFieldNames?: readonly InspirationEnrichmentFieldName[];
  existingFields?: InspirationEnrichmentFields;
  failedAt: Date;
  failedFieldNames?: readonly InspirationEnrichmentFieldName[];
  lastError: InspirationEnrichmentErrorDetails;
  lastFailureReason: string;
  lastFailureRetryability: InspirationEnrichmentRetryability;
  maxAttemptCount: number;
  startedAt?: Date | null;
}

export interface BuildCompletedInspirationEnrichmentFieldsInput {
  completedAt: Date;
  completedFieldNames: readonly InspirationEnrichmentFieldName[];
  existingFields?: InspirationEnrichmentFields;
  maxAttemptCount: number;
}

function toIsoStringOrNull(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function fromIsoStringOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function cloneInspirationEnrichmentFieldMetadata(
  field: InspirationEnrichmentFieldMetadata,
  overrides: Partial<BuildInspirationEnrichmentFieldMetadataInput> = {},
): InspirationEnrichmentFieldMetadata {
  return buildInspirationEnrichmentFieldMetadata({
    attemptCount:
      overrides.attemptCount === undefined
        ? field.attemptCount
        : overrides.attemptCount,
    completedAt:
      overrides.completedAt === undefined
        ? fromIsoStringOrNull(field.completedAt)
        : overrides.completedAt,
    failedAt:
      overrides.failedAt === undefined
        ? fromIsoStringOrNull(field.failedAt)
        : overrides.failedAt,
    lastError:
      overrides.lastError === undefined ? field.lastError : overrides.lastError,
    lastFailureReason:
      overrides.lastFailureReason === undefined
        ? field.lastFailureReason
        : overrides.lastFailureReason,
    lastFailureRetryability:
      overrides.lastFailureRetryability === undefined
        ? field.lastFailureRetryability
        : overrides.lastFailureRetryability,
    maxAttemptCount:
      overrides.maxAttemptCount === undefined
        ? field.maxAttemptCount
        : overrides.maxAttemptCount,
    startedAt:
      overrides.startedAt === undefined
        ? fromIsoStringOrNull(field.startedAt)
        : overrides.startedAt,
    status: overrides.status ?? field.status,
  });
}

export function isInspirationEnrichmentFieldName(
  value: string,
): value is InspirationEnrichmentFieldName {
  return INSPIRATION_ENRICHMENT_FIELD_NAMES.includes(
    value as InspirationEnrichmentFieldName,
  );
}

export function isInspirationEnrichmentFieldStatus(
  value: string,
): value is InspirationEnrichmentFieldStatus {
  return (
    value === INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING ||
    value === INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING ||
    value === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED ||
    value === INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED ||
    value === INSPIRATION_ENRICHMENT_FIELD_STATUS_TIMEOUT
  );
}

export function isInspirationEnrichmentRetryability(
  value: string,
): value is InspirationEnrichmentRetryability {
  return (
    value === INSPIRATION_ENRICHMENT_RETRYABILITY_RETRYABLE ||
    value === INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE ||
      value === INSPIRATION_ENRICHMENT_RETRYABILITY_UNKNOWN
  );
}

export function isInspirationAiFieldFailureClass(
  value: string,
): value is InspirationAiFieldFailureClass {
  return INSPIRATION_AI_FIELD_FAILURE_CLASSES.includes(
    value as InspirationAiFieldFailureClass,
  );
}

export function buildInspirationEnrichmentFieldMetadata(
  input: BuildInspirationEnrichmentFieldMetadataInput,
): InspirationEnrichmentFieldMetadata {
  return {
    attemptCount: input.attemptCount ?? 0,
    completedAt: toIsoStringOrNull(input.completedAt),
    failedAt: toIsoStringOrNull(input.failedAt),
    lastError: input.lastError ?? null,
    lastFailureReason: input.lastFailureReason ?? null,
    lastFailureRetryability: input.lastFailureRetryability ?? null,
    maxAttemptCount: input.maxAttemptCount,
    startedAt: toIsoStringOrNull(input.startedAt),
    status: input.status,
  };
}

export function createInspirationEnrichmentFields(
  createField: (
    fieldName: InspirationEnrichmentFieldName,
  ) => InspirationEnrichmentFieldMetadata,
): InspirationEnrichmentFields {
  return Object.fromEntries(
    INSPIRATION_ENRICHMENT_FIELD_NAMES.map((fieldName) => [
      fieldName,
      createField(fieldName),
    ]),
  ) as InspirationEnrichmentFields;
}

export function buildPendingInspirationEnrichmentFields(
  maxAttemptCount: number,
): InspirationEnrichmentFields {
  return createInspirationEnrichmentFields(() =>
    buildInspirationEnrichmentFieldMetadata({
      maxAttemptCount,
      status: INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING,
    }),
  );
}

export function buildQueuedInspirationEnrichmentFields(
  input: BuildQueuedInspirationEnrichmentFieldsInput,
): InspirationEnrichmentFields {
  const completedFieldNames = new Set(input.completedFieldNames ?? []);
  const pendingFieldNames =
    input.pendingFieldNames === undefined
      ? new Set(INSPIRATION_ENRICHMENT_FIELD_NAMES)
      : new Set(input.pendingFieldNames);

  return createInspirationEnrichmentFields((fieldName) => {
    const existingField = input.existingFields?.[fieldName];

    if (completedFieldNames.has(fieldName)) {
      if (
        existingField &&
        existingField.status === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED
      ) {
        return cloneInspirationEnrichmentFieldMetadata(existingField, {
          maxAttemptCount: input.maxAttemptCount,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        maxAttemptCount: input.maxAttemptCount,
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
      });
    }

    if (!pendingFieldNames.has(fieldName)) {
      if (existingField) {
        return cloneInspirationEnrichmentFieldMetadata(existingField, {
          maxAttemptCount: input.maxAttemptCount,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        maxAttemptCount: input.maxAttemptCount,
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING,
      });
    }

    return buildInspirationEnrichmentFieldMetadata({
      attemptCount: 0,
      completedAt: null,
      failedAt: null,
      lastError: null,
      lastFailureReason: null,
      lastFailureRetryability: null,
      maxAttemptCount: input.maxAttemptCount,
      startedAt: null,
      status: INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING,
    });
  });
}

export function buildProcessingInspirationEnrichmentFields(
  startedAt: Date,
  input: BuildProcessingInspirationEnrichmentFieldsInput,
): InspirationEnrichmentFields {
  const completedFieldNames = new Set(input.completedFieldNames ?? []);
  const processingFieldNames =
    input.processingFieldNames === undefined
      ? null
      : new Set(input.processingFieldNames);

  return createInspirationEnrichmentFields((fieldName) => {
    const existingField = input.existingFields?.[fieldName];

    if (completedFieldNames.has(fieldName)) {
      if (
        existingField &&
        existingField.status === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED
      ) {
        return cloneInspirationEnrichmentFieldMetadata(existingField, {
          maxAttemptCount: input.maxAttemptCount,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        attemptCount: existingField?.attemptCount ?? 0,
        completedAt:
          existingField?.completedAt === null ||
          existingField?.completedAt === undefined
            ? startedAt
            : new Date(existingField.completedAt),
        failedAt: null,
        lastError: null,
        lastFailureReason: null,
        lastFailureRetryability: null,
        maxAttemptCount: input.maxAttemptCount,
        startedAt:
          existingField?.startedAt === null ||
          existingField?.startedAt === undefined
            ? startedAt
            : new Date(existingField.startedAt),
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
      });
    }

    if (
      processingFieldNames !== null &&
      !processingFieldNames.has(fieldName)
    ) {
      if (existingField) {
        return cloneInspirationEnrichmentFieldMetadata(existingField, {
          maxAttemptCount: input.maxAttemptCount,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        maxAttemptCount: input.maxAttemptCount,
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING,
      });
    }

    return buildInspirationEnrichmentFieldMetadata({
      attemptCount:
        input.attemptCount ?? Math.max(existingField?.attemptCount ?? 0, 0) + 1,
      failedAt:
        existingField?.failedAt === null || existingField?.failedAt === undefined
          ? null
          : new Date(existingField.failedAt),
      lastError: existingField?.lastError ?? null,
      lastFailureReason: existingField?.lastFailureReason ?? null,
      lastFailureRetryability: existingField?.lastFailureRetryability ?? null,
      maxAttemptCount: input.maxAttemptCount,
      startedAt,
      status: INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
    });
  });
}

export function buildFailedInspirationEnrichmentFields(
  input: BuildFailedInspirationEnrichmentFieldsInput,
): InspirationEnrichmentFields {
  const completedFieldNames = new Set(input.completedFieldNames ?? []);
  const failedFieldNames = new Set(
    input.failedFieldNames ??
      INSPIRATION_ENRICHMENT_FIELD_NAMES.filter(
        (fieldName) => !completedFieldNames.has(fieldName),
      ),
  );

  return createInspirationEnrichmentFields((fieldName) => {
    const existingField = input.existingFields?.[fieldName];

    if (completedFieldNames.has(fieldName)) {
      if (
        existingField &&
        existingField.status === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED
      ) {
        return cloneInspirationEnrichmentFieldMetadata(existingField, {
          maxAttemptCount: input.maxAttemptCount,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        attemptCount: existingField?.attemptCount ?? input.attemptCount ?? 0,
        completedAt:
          existingField?.completedAt === null ||
          existingField?.completedAt === undefined
            ? input.startedAt ?? input.failedAt
            : new Date(existingField.completedAt),
        failedAt: null,
        lastError: null,
        lastFailureReason: null,
        lastFailureRetryability: null,
        maxAttemptCount: input.maxAttemptCount,
        startedAt:
          existingField?.startedAt === null ||
          existingField?.startedAt === undefined
            ? input.startedAt ?? input.failedAt
            : new Date(existingField.startedAt),
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
      });
    }

    if (!failedFieldNames.has(fieldName)) {
      if (existingField) {
        return cloneInspirationEnrichmentFieldMetadata(existingField, {
          maxAttemptCount: input.maxAttemptCount,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        attemptCount: input.attemptCount ?? 0,
        maxAttemptCount: input.maxAttemptCount,
        startedAt: input.startedAt,
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
      });
    }

    return buildInspirationEnrichmentFieldMetadata({
      attemptCount: input.attemptCount ?? existingField?.attemptCount ?? 0,
      failedAt: input.failedAt,
      lastError: input.lastError,
      lastFailureReason: input.lastFailureReason,
      lastFailureRetryability: input.lastFailureRetryability,
      maxAttemptCount: input.maxAttemptCount,
      startedAt:
        input.startedAt ??
        (existingField?.startedAt === null ||
        existingField?.startedAt === undefined
          ? null
          : new Date(existingField.startedAt)),
      status: INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
    });
  });
}

export function buildCompletedInspirationEnrichmentFields(
  input: BuildCompletedInspirationEnrichmentFieldsInput,
): InspirationEnrichmentFields {
  const completedFieldNames = new Set(input.completedFieldNames);

  return createInspirationEnrichmentFields((fieldName) => {
    const existingField = input.existingFields?.[fieldName];

    if (!completedFieldNames.has(fieldName)) {
      if (existingField) {
        return cloneInspirationEnrichmentFieldMetadata(existingField, {
          maxAttemptCount: input.maxAttemptCount,
        });
      }

      return buildInspirationEnrichmentFieldMetadata({
        maxAttemptCount: input.maxAttemptCount,
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING,
      });
    }

    return buildInspirationEnrichmentFieldMetadata({
      attemptCount: existingField?.attemptCount ?? 0,
      completedAt: input.completedAt,
      failedAt: null,
      lastError: null,
      lastFailureReason: null,
      lastFailureRetryability: null,
      maxAttemptCount: input.maxAttemptCount,
      startedAt:
        existingField?.startedAt === null || existingField?.startedAt === undefined
          ? input.completedAt
          : new Date(existingField.startedAt),
      status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readOptionalIsoTimestamp(
  value: unknown,
  label: string,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    throw new TypeError(`${label} must be an ISO-8601 timestamp or null.`);
  }

  return value;
}

function readNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return value as number;
}

function normalizeFieldMetadata(
  value: unknown,
  label: string,
): InspirationEnrichmentFieldMetadata {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  if (
    typeof value.status !== "string" ||
    !isInspirationEnrichmentFieldStatus(value.status)
  ) {
    throw new TypeError(`${label}.status must be a valid enrichment status.`);
  }

  if (
    value.lastFailureRetryability !== null &&
    value.lastFailureRetryability !== undefined &&
    (typeof value.lastFailureRetryability !== "string" ||
      !isInspirationEnrichmentRetryability(value.lastFailureRetryability))
  ) {
    throw new TypeError(
      `${label}.lastFailureRetryability must be a valid retryability classification or null.`,
    );
  }

  if (
    value.lastFailureReason !== null &&
    value.lastFailureReason !== undefined &&
    typeof value.lastFailureReason !== "string"
  ) {
    throw new TypeError(`${label}.lastFailureReason must be a string or null.`);
  }

  if (
    value.lastError !== null &&
    value.lastError !== undefined &&
    !isRecord(value.lastError)
  ) {
    throw new TypeError(`${label}.lastError must be a JSON object or null.`);
  }

  return {
    attemptCount: readNonNegativeInteger(
      value.attemptCount,
      `${label}.attemptCount`,
    ),
    completedAt: readOptionalIsoTimestamp(
      value.completedAt,
      `${label}.completedAt`,
    ),
    failedAt: readOptionalIsoTimestamp(value.failedAt, `${label}.failedAt`),
    lastError:
      value.lastError === undefined || value.lastError === null
        ? null
        : (value.lastError as unknown as InspirationEnrichmentErrorDetails),
    lastFailureReason:
      value.lastFailureReason === undefined
        ? null
        : (value.lastFailureReason as string | null),
    lastFailureRetryability:
      value.lastFailureRetryability === undefined
        ? null
        : (value.lastFailureRetryability as InspirationEnrichmentRetryability | null),
    maxAttemptCount: readNonNegativeInteger(
      value.maxAttemptCount,
      `${label}.maxAttemptCount`,
    ),
    startedAt: readOptionalIsoTimestamp(value.startedAt, `${label}.startedAt`),
    status: value.status,
  };
}

export function normalizeInspirationEnrichmentFields(
  value: unknown,
  label: string,
): InspirationEnrichmentFields | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new TypeError(`${label} must be a JSON object.`);
  }

  return Object.fromEntries(
    INSPIRATION_ENRICHMENT_FIELD_NAMES.map((fieldName) => {
      if (!(fieldName in value)) {
        throw new TypeError(`${label}.${fieldName} is missing.`);
      }

      return [
        fieldName,
        normalizeFieldMetadata(
          value[fieldName],
          `${label}.${fieldName}`,
        ),
      ];
    }),
  ) as InspirationEnrichmentFields;
}
