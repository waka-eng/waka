import {
  CREATE_INSPIRATION_ROUTE_CREATED_STATUS,
  SUPPORTED_INSPIRATION_SOURCE_TYPES,
  handleCreateInspirationRouteRequest,
  type CreateInspirationBackgroundScheduler,
  type CreateInspirationPersistenceArgs,
  type CreateInspirationPersistenceClient,
  type CreateInspirationRequestBody,
  type CreateInspirationResponseBody,
  type CreatedInspirationRecord,
} from "../../apps/web/src/inspirations/create-route.ts";
import {
  INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  type InspirationEnrichmentFields,
} from "../../apps/web/src/inspirations/enrichment-field-metadata.ts";
import type { MarkInspirationEnrichmentEnqueuedPersistenceArgs } from "../../apps/web/src/inspirations/enrichment-pipeline.ts";
import {
  INSPIRATION_ENRICHMENT_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_STATUS_FAILED,
} from "../../apps/web/src/inspirations/enrichment-pipeline.ts";
import type {
  InspirationEmbeddingPersistenceClient,
  InspirationEmbeddingRecord,
  UpdateInspirationEnrichmentLifecycleArgs,
} from "../../apps/web/src/jobs/inspiration-embedding-persistence.ts";
import {
  processInspirationQueueMessage,
  type InspirationEmbeddingClient,
  type InspirationNonEmbeddingClient,
} from "../../apps/web/src/jobs/process-inspiration-message.ts";
import {
  createValidatedInspirationQueueRecordProcessingRequest,
  type InspirationQueueRecord,
  type InspirationQueueRecordProcessingRequest,
} from "../../apps/web/src/jobs/inspiration-queue.ts";
import { OPENAI_EMBEDDING_DIMENSIONS } from "../../packages/shared/llm/runtime.ts";
import {
  type AiEnrichmentFieldName,
  type AiEnrichmentSqsJobPayload,
} from "../../packages/shared/types.ts";
import {
  createExpectedEnrichmentLoadFixture,
  EXPECTED_ENRICHMENT_LOAD_REQUIRED_AI_FIELDS,
  type ExpectedEnrichmentLoadCaptureRecord,
  type ExpectedEnrichmentLoadFixture,
  type ExpectedEnrichmentLoadFixtureOptions,
} from "./expected-enrichment-load-fixture.ts";

export * from "./expected-enrichment-load-fixture.ts";

export const END_TO_END_ENRICHMENT_CORRELATION_ID_SOURCE_META_KEY =
  "correlationId";
export const DEFAULT_END_TO_END_ENRICHMENT_REQUEST_URL =
  "https://waka.test/api/inspirations";
export const DEFAULT_END_TO_END_ENRICHMENT_QUEUE_REGION = "us-east-1";
export const DEFAULT_END_TO_END_ENRICHMENT_QUEUE_ARN =
  "arn:aws:sqs:local:000000000000:waka-inspirations";
export const DEFAULT_END_TO_END_ENRICHMENT_VERIFICATION_MAX_ATTEMPTS = 10;
export const DEFAULT_END_TO_END_ENRICHMENT_VERIFICATION_POLL_INTERVAL_MS = 50;

export interface EndToEndEnrichmentLoadSubmission {
  capture: ExpectedEnrichmentLoadCaptureRecord;
  completedAt: string;
  correlationId: string;
  createArgs: CreateInspirationPersistenceArgs;
  pipelineUpdateArgs: MarkInspirationEnrichmentEnqueuedPersistenceArgs;
  processingCompletedAt: string;
  processingRequest: InspirationQueueRecordProcessingRequest;
  processingStartedAt: string;
  queuePayload: AiEnrichmentSqsJobPayload;
  queueRecord: InspirationQueueRecord;
  requestBody: CreateInspirationRequestBody;
  responseBody: CreateInspirationResponseBody;
  responseStatus: number;
  startedProcessingAt: string;
  submittedAt: string;
}

export interface ExpectedEnrichmentLoadRequestPayloadContext {
  captureId: string;
  payload: CreateInspirationRequestBody;
  requiredFieldNames: readonly (keyof CreateInspirationRequestBody)[];
  sourceType: ExpectedEnrichmentLoadCaptureRecord["sourceType"];
}

export interface ExpectedEnrichmentLoadMissingRequiredRequestFieldDiagnostic {
  missingFieldNames: readonly (keyof CreateInspirationRequestBody)[];
  payloadContext: ExpectedEnrichmentLoadRequestPayloadContext;
}

export interface EndToEndEnrichmentPipelineCompletion {
  capture: ExpectedEnrichmentLoadCaptureRecord;
  completedAt: string;
  correlationId: string;
  processingCompletedAt: string;
  processingStartedAt: string;
  startedProcessingAt: string;
  submittedAt: string;
}

export interface EndToEndEnrichmentLoadRunResult {
  completionTracking: readonly EndToEndEnrichmentPipelineCompletion[];
  finalRecords: readonly EndToEndEnrichmentLoadFinalRecord[];
  fixture: ExpectedEnrichmentLoadFixture;
  latencyReport: EndToEndEnrichmentLoadLatencyReport;
  pipelineCompletions: readonly EndToEndEnrichmentPipelineCompletion[];
  report: EndToEndEnrichmentLoadRunReport;
  submissions: readonly EndToEndEnrichmentLoadSubmission[];
}

export interface EndToEndEnrichmentLoadFinalRecord {
  actionability?: string | null;
  domain?: string | null;
  embedding?: readonly number[] | null;
  enrichmentCompletedAt?: string | null;
  enrichmentFailedAt?: string | null;
  enrichmentFields?: InspirationEnrichmentFields | null;
  enrichmentStartedAt?: string | null;
  enrichmentStatus?: string | null;
  id: string;
  mood?: string | null;
  rawContent: string;
  summary?: string | null;
  tags?: readonly string[] | null;
  title?: string | null;
}

export interface EndToEndEnrichmentLoadRunReportItem {
  captureId: string;
  captureOrdinal: number;
  completed: boolean;
  completedFieldCount: number;
  correlationId: string;
  expectedFieldCount: number;
  incompleteFieldNames: readonly AiEnrichmentFieldName[];
  missing: boolean;
  processingCompletedAt: string | null;
  processingDurationMs: number | null;
  processingStartedAt: string | null;
  processed: boolean;
  successfulTerminalState: boolean;
  semanticGroupKey: string;
  sourceType: ExpectedEnrichmentLoadCaptureRecord["sourceType"];
  submittedAt: string | null;
  submitToCompleteMs: number | null;
  submitToProcessStartMs: number | null;
  terminalStatus: string | null;
}

export interface EndToEndEnrichmentLoadRunReportMetrics {
  averageProcessingDurationMs: number | null;
  averageSubmitToCompleteMs: number | null;
  averageSubmitToProcessStartMs: number | null;
  completedItemCount: number;
  completionRate: number;
  expectedItemCount: number;
  incompleteItemCount: number;
  missingCaptureIds: readonly string[];
  missingItemCount: number;
  nonTerminalCaptureIds: readonly string[];
  nonTerminalItemCount: number;
  processedItemCount: number;
  processingRate: number;
  successfulTerminalItemCount: number;
  submittedItemCount: number;
  unprocessedCaptureIds: readonly string[];
  unprocessedItemCount: number;
}

export interface EndToEndEnrichmentLoadRunReport {
  incompleteItems: readonly Array<{
    captureId: string;
    incompleteFieldNames: readonly AiEnrichmentFieldName[];
  }>;
  items: readonly EndToEndEnrichmentLoadRunReportItem[];
  metrics: EndToEndEnrichmentLoadRunReportMetrics;
}

export const DEFAULT_END_TO_END_ENRICHMENT_FULL_AI_POPULATION_LATENCY_BUDGET_MS =
  30_000;

export type EndToEndEnrichmentLoadLatencyReportStatus = "PASS" | "FAIL";
export type EndToEndEnrichmentLoadLatencyStepName =
  | "capture_to_processing_start"
  | "processing_duration";
export type EndToEndEnrichmentLoadLatencyFocusArea =
  | "QUEUE_HANDOFF"
  | "AI_PROCESSING"
  | "UNKNOWN";

export interface EndToEndEnrichmentLoadLatencyStepDiagnostic {
  durationMs: number | null;
  label: string;
  stepName: EndToEndEnrichmentLoadLatencyStepName;
}

export interface EndToEndEnrichmentLoadLatencyThresholdMissDiagnostics {
  budgetExceededMs: number;
  focusArea: EndToEndEnrichmentLoadLatencyFocusArea;
  focusMessage: string;
  slowestStepDurationMs: number | null;
  slowestStepName: EndToEndEnrichmentLoadLatencyStepName | null;
  stepDiagnostics: readonly EndToEndEnrichmentLoadLatencyStepDiagnostic[];
}

export interface EndToEndEnrichmentLoadLatencyReportItem {
  captureId: string;
  captureOrdinal: number;
  correlationId: string;
  failureReason: string | null;
  latencyBudgetMs: number;
  passed: boolean;
  status: EndToEndEnrichmentLoadLatencyReportStatus;
  thresholdMissDiagnostics: EndToEndEnrichmentLoadLatencyThresholdMissDiagnostics | null;
  timeToFullAiPopulationMs: number | null;
}

export interface EndToEndEnrichmentLoadLatencyReportSummary {
  averageTimeToFullAiPopulationMs: number | null;
  failedCaptureIds: readonly string[];
  failedItemCount: number;
  latencyBudgetMs: number;
  maxTimeToFullAiPopulationMs: number | null;
  measuredItemCount: number;
  passed: boolean;
  passedItemCount: number;
  status: EndToEndEnrichmentLoadLatencyReportStatus;
  totalItemCount: number;
}

export interface EndToEndEnrichmentLoadLatencyReport {
  items: readonly EndToEndEnrichmentLoadLatencyReportItem[];
  summary: EndToEndEnrichmentLoadLatencyReportSummary;
}

export class EndToEndEnrichmentLoadLatencyReportError extends Error {
  readonly latencyReport: EndToEndEnrichmentLoadLatencyReport;
  readonly runReport: EndToEndEnrichmentLoadRunReport | null;

  constructor(args: {
    latencyReport: EndToEndEnrichmentLoadLatencyReport;
    runReport?: EndToEndEnrichmentLoadRunReport | null;
  }) {
    super(buildEndToEndEnrichmentLoadLatencyReportFailureMessage(args.latencyReport));
    this.name = "EndToEndEnrichmentLoadLatencyReportError";
    this.latencyReport = args.latencyReport;
    this.runReport = args.runReport ?? null;
  }
}

export class ExpectedEnrichmentLoadMissingRequiredRequestFieldsError extends Error {
  readonly diagnostic: ExpectedEnrichmentLoadMissingRequiredRequestFieldDiagnostic;

  constructor(diagnostic: ExpectedEnrichmentLoadMissingRequiredRequestFieldDiagnostic) {
    super(
      `Expected-load capture ${diagnostic.payloadContext.captureId} (${diagnostic.payloadContext.sourceType}) request payload is missing required fields: ${diagnostic.missingFieldNames.join(", ")}.`,
    );
    this.name = "ExpectedEnrichmentLoadMissingRequiredRequestFieldsError";
    this.diagnostic = diagnostic;
  }
}

export interface WaitForEndToEndEnrichmentLoadRunTerminalStateOptions {
  fixture: ExpectedEnrichmentLoadFixture;
  latencyBudgetMs?: number;
  loadFinalRecords: () => Promise<readonly EndToEndEnrichmentLoadFinalRecord[]>;
  maxAttempts?: number;
  pipelineCompletions: readonly EndToEndEnrichmentPipelineCompletion[];
  pollIntervalMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  submissions: readonly EndToEndEnrichmentLoadSubmission[];
}

export interface WaitForEndToEndEnrichmentLoadRunTerminalStateResult {
  attemptCount: number;
  finalRecords: readonly EndToEndEnrichmentLoadFinalRecord[];
  report: EndToEndEnrichmentLoadRunReport;
}

interface StoredEndToEndInspirationRecord extends InspirationEmbeddingRecord {
  enrichmentAttemptCount?: number;
  enrichmentCompletedAt?: Date | null;
  enrichmentEnqueuedAt?: Date | null;
  enrichmentFailedAt?: Date | null;
  enrichmentLastError?: unknown;
  enrichmentLastFailureReason?: string | null;
  enrichmentLastFailureRetryability?: string | null;
  enrichmentMaxAttemptCount?: number;
  enrichmentStatus?: string;
  enrichmentStartedAt?: Date | null;
}

export interface RunEndToEndEnrichmentLoadFixtureOptions
  extends ExpectedEnrichmentLoadFixtureOptions {
  authenticatedUserId?: string;
  fixture?: ExpectedEnrichmentLoadFixture;
  requestUrl?: string;
}

function createAsyncTaskHarness(): {
  flushScheduledTasks(): Promise<void>;
  schedule: CreateInspirationBackgroundScheduler;
} {
  const tasks: Array<() => Promise<void>> = [];

  return {
    async flushScheduledTasks() {
      while (tasks.length > 0) {
        const task = tasks.shift();

        if (task) {
          await task();
        }
      }
    },
    schedule(task) {
      tasks.push(task);
    },
  };
}

function buildCreatedInspirationRecord(
  captureId: string,
  args: CreateInspirationPersistenceArgs,
): CreatedInspirationRecord {
  return {
    ...(typeof args.data.audioStorageKey === "string"
      ? {
          audioStorageKey: args.data.audioStorageKey,
        }
      : {}),
    ...(typeof args.data.audioStorageUrl === "string"
      ? {
          audioStorageUrl: args.data.audioStorageUrl,
        }
      : {}),
    ...(typeof args.data.audioMimeType === "string"
      ? {
          audioMimeType: args.data.audioMimeType,
        }
      : {}),
    ...(typeof args.data.audioSizeBytes === "number"
      ? {
          audioSizeBytes: args.data.audioSizeBytes,
        }
      : {}),
    ...(typeof args.data.audioDurationSeconds === "number"
      ? {
          audioDurationSeconds: args.data.audioDurationSeconds,
        }
      : {}),
    id: captureId,
    rawContent: String(args.data.rawContent),
    sourceType: args.data.sourceType as CreatedInspirationRecord["sourceType"],
  };
}

function requireSingleNewItem<TValue>(
  label: string,
  values: readonly TValue[],
  startIndex: number,
): TValue {
  const newValues = values.slice(startIndex);

  if (newValues.length !== 1) {
    throw new Error(
      `${label} expected exactly 1 new record but observed ${newValues.length}.`,
    );
  }

  return newValues[0]!;
}

function readResponseErrorMessage(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }

  return "Unknown response payload.";
}

function hasNonEmptyTrimmedString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function hasNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRequestPayloadRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createEmbeddingVector(): number[] {
  return Array.from(
    { length: OPENAI_EMBEDDING_DIMENSIONS },
    (_, index) => Number((index / OPENAI_EMBEDDING_DIMENSIONS).toFixed(6)),
  );
}

function readMilliseconds(value: string): number {
  const timestamp = new Date(value);

  if (Number.isNaN(timestamp.getTime())) {
    throw new TypeError(`Expected a valid ISO-8601 timestamp, received "${value}".`);
  }

  return timestamp.getTime();
}

function calculateDurationMs(
  startedAt: string | null,
  completedAt: string | null,
): number | null {
  if (startedAt === null || completedAt === null) {
    return null;
  }

  return readMilliseconds(completedAt) - readMilliseconds(startedAt);
}

function calculateAverageDurationMs(values: readonly (number | null)[]): number | null {
  const resolvedValues = values.filter((value): value is number => value !== null);

  if (resolvedValues.length === 0) {
    return null;
  }

  return resolvedValues.reduce((total, value) => total + value, 0) / resolvedValues.length;
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function createSequencedNow(timestamps: readonly string[]): () => Date {
  let index = 0;

  return () => {
    const resolvedTimestamp =
      timestamps[Math.min(index, timestamps.length - 1)] ?? timestamps[0];
    index += 1;
    return new Date(resolvedTimestamp);
  };
}

function parseSqlStringLiteral(expression: string): string {
  const match = /^'((?:[^']|'')*)'(?:\:\:[a-z0-9_]+)?$/i.exec(expression.trim());

  if (!match) {
    throw new Error(`Unsupported SQL string literal: ${expression}`);
  }

  return match[1]!.replaceAll("''", "'");
}

function parseSqlTextArray(expression: string): string[] {
  const normalizedExpression = expression.trim();

  if (normalizedExpression === "ARRAY[]::text[]") {
    return [];
  }

  const arrayMatch = /^ARRAY\[(.*)\]::text\[\]$/s.exec(normalizedExpression);

  if (!arrayMatch) {
    throw new Error(`Unsupported SQL text array literal: ${expression}`);
  }

  const values: string[] = [];
  const itemPattern = /'((?:[^']|'')*)'/g;

  for (const match of arrayMatch[1]!.matchAll(itemPattern)) {
    values.push(match[1]!.replaceAll("''", "'"));
  }

  return values;
}

function parseSqlJsonLiteral(expression: string): unknown {
  return JSON.parse(parseSqlStringLiteral(expression));
}

function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSqlAssignmentLines(sql: string): string[] {
  const lines = sql
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const setLineIndex = lines.indexOf("SET");
  const whereLineIndex = lines.findIndex((line) => line.startsWith("WHERE "));

  if (setLineIndex === -1 || whereLineIndex === -1 || whereLineIndex <= setLineIndex) {
    throw new Error(`Unsupported enrichment SQL statement: ${sql}`);
  }

  return lines.slice(setLineIndex + 1, whereLineIndex);
}

function readTimestampExtremaFromFields(
  enrichmentFields: InspirationEnrichmentFields | null | undefined,
  key: "completedAt" | "failedAt" | "startedAt",
  direction: "min" | "max",
): Date | null {
  if (!enrichmentFields) {
    return null;
  }

  let resolvedTimestamp: Date | null = null;

  for (const metadata of Object.values(enrichmentFields)) {
    const value = metadata[key];

    if (typeof value !== "string") {
      continue;
    }

    const timestamp = new Date(value);

    if (Number.isNaN(timestamp.getTime())) {
      continue;
    }

    if (
      resolvedTimestamp === null ||
      (direction === "min"
        ? timestamp.getTime() < resolvedTimestamp.getTime()
        : timestamp.getTime() > resolvedTimestamp.getTime())
    ) {
      resolvedTimestamp = timestamp;
    }
  }

  return resolvedTimestamp;
}

function applyPersistedEnrichmentSql(
  sql: string,
  storedInspirations: Map<string, StoredEndToEndInspirationRecord>,
): number {
  const inspirationIdMatch = /WHERE "id" = '((?:[^']|'')*)'/m.exec(sql);
  const inspirationId = inspirationIdMatch?.[1]?.replaceAll("''", "'");

  if (!inspirationId) {
    throw new Error(`Could not resolve the inspiration id from SQL: ${sql}`);
  }

  const record = storedInspirations.get(inspirationId);

  if (!record) {
    return 0;
  }

  const expectedRawContentMatch =
    /"rawContent" IS NOT DISTINCT FROM '((?:[^']|'')*)'/m.exec(sql);

  if (
    expectedRawContentMatch &&
    record.rawContent !== expectedRawContentMatch[1]!.replaceAll("''", "'")
  ) {
    return 0;
  }

  const assignmentLines = readSqlAssignmentLines(sql);

  for (const line of assignmentLines) {
    const assignmentMatch = /^"([^"]+)" = (.+?)(?:,)?$/.exec(line);

    if (!assignmentMatch) {
      continue;
    }

    const [, fieldName, rawExpression] = assignmentMatch;
    const expression = rawExpression.trim();

    switch (fieldName) {
      case "embedding":
        record.embedding = JSON.parse(parseSqlStringLiteral(expression));
        break;
      case "title":
        if (record.title == null) {
          const titleMatch = /^COALESCE\("title", ('(?:[^']|'')*')\)$/.exec(
            expression,
          );

          if (!titleMatch) {
            throw new Error(`Unsupported title persistence expression: ${expression}`);
          }

          record.title = parseSqlStringLiteral(titleMatch[1]!);
        }
        break;
      case "summary":
        record.summary = parseSqlStringLiteral(expression);
        break;
      case "reflectionPrompt":
        record.reflectionPrompt =
          expression === "NULL" ? null : parseSqlStringLiteral(expression);
        break;
      case "reflectionStatus":
        record.reflectionStatus = parseSqlStringLiteral(expression);
        break;
      case "sourceMeta": {
        const sourceMetaMatch =
          /^COALESCE\("sourceMeta", '\{\}'::jsonb\) \|\| ('(?:[^']|'')*')::jsonb$/.exec(
            expression,
          );

        if (!sourceMetaMatch) {
          throw new Error(
            `Unsupported source metadata persistence expression: ${expression}`,
          );
        }

        const persistedSourceMeta = parseSqlJsonLiteral(sourceMetaMatch[1]!);

        if (!isPlainRecord(persistedSourceMeta)) {
          throw new Error(
            `Persisted source metadata must be a JSON object: ${expression}`,
          );
        }

        record.sourceMeta = {
          ...(isPlainRecord(record.sourceMeta) ? record.sourceMeta : {}),
          ...persistedSourceMeta,
        };
        break;
      }
      case "sourceConversationRef":
        if (record.sourceConversationRef == null) {
          const sourceConversationRefMatch =
            /^COALESCE\("sourceConversationRef", ('(?:[^']|'')*')\)$/.exec(
              expression,
            );

          if (!sourceConversationRefMatch) {
            throw new Error(
              `Unsupported source conversation reference persistence expression: ${expression}`,
            );
          }

          record.sourceConversationRef = parseSqlStringLiteral(
            sourceConversationRefMatch[1]!,
          );
        }
        break;
      case "tags":
        record.tags = parseSqlTextArray(expression);
        break;
      case "domain":
        record.domain = parseSqlStringLiteral(expression);
        break;
      case "mood":
        record.mood = parseSqlStringLiteral(expression);
        break;
      case "actionability":
        record.actionability = parseSqlStringLiteral(expression);
        break;
      case "enrichmentFields":
        record.enrichmentFields =
          parseSqlJsonLiteral(expression) as InspirationEnrichmentFields;
        break;
      case "enrichmentCompletedAt":
        record.enrichmentCompletedAt =
          expression === "NULL"
            ? null
            : readTimestampExtremaFromFields(record.enrichmentFields, "completedAt", "max");
        break;
      case "enrichmentFailedAt":
        record.enrichmentFailedAt =
          expression === "NULL"
            ? null
            : readTimestampExtremaFromFields(record.enrichmentFields, "failedAt", "max");
        break;
      case "enrichmentLastFailureReason":
        record.enrichmentLastFailureReason =
          expression === "NULL" ? null : parseSqlStringLiteral(expression);
        break;
      case "enrichmentLastFailureRetryability":
        record.enrichmentLastFailureRetryability =
          expression === "NULL" ? null : parseSqlStringLiteral(expression);
        break;
      case "enrichmentLastError":
        record.enrichmentLastError =
          expression === "NULL" ? null : parseSqlJsonLiteral(expression);
        break;
      case "enrichmentResumeState":
        record.enrichmentResumeState =
          expression === "NULL" ? null : parseSqlJsonLiteral(expression);
        break;
      case "enrichmentStatus":
        record.enrichmentStatus = parseSqlStringLiteral(expression);
        break;
      case "updatedAt":
        break;
      default:
        throw new Error(`Unsupported enrichment persistence assignment: ${fieldName}`);
    }
  }

  return 1;
}

function serializeOptionalDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function cloneEnrichmentFields(
  value: InspirationEnrichmentFields | null | undefined,
): InspirationEnrichmentFields | null {
  if (!value) {
    return null;
  }

  return structuredClone(value);
}

function snapshotStoredInspirationRecord(
  record: StoredEndToEndInspirationRecord,
): EndToEndEnrichmentLoadFinalRecord {
  return {
    actionability: record.actionability ?? null,
    domain: record.domain ?? null,
    embedding: record.embedding ?? null,
    enrichmentCompletedAt: serializeOptionalDate(record.enrichmentCompletedAt),
    enrichmentFailedAt: serializeOptionalDate(record.enrichmentFailedAt),
    enrichmentFields: cloneEnrichmentFields(record.enrichmentFields),
    enrichmentStartedAt: serializeOptionalDate(record.enrichmentStartedAt),
    enrichmentStatus: record.enrichmentStatus ?? null,
    id: record.id,
    mood: record.mood ?? null,
    rawContent: record.rawContent,
    summary: record.summary ?? null,
    tags: record.tags ? [...record.tags] : null,
    title: record.title ?? null,
  };
}

function readProcessingStartedAt(
  completion: EndToEndEnrichmentPipelineCompletion | undefined,
  finalRecord: EndToEndEnrichmentLoadFinalRecord | undefined,
): string | null {
  return (
    completion?.processingStartedAt ??
    finalRecord?.enrichmentStartedAt ??
    readTimestampExtremaFromFields(finalRecord?.enrichmentFields, "startedAt", "min")?.toISOString() ??
    null
  );
}

function readProcessingCompletedAt(
  completion: EndToEndEnrichmentPipelineCompletion | undefined,
  finalRecord: EndToEndEnrichmentLoadFinalRecord | undefined,
): string | null {
  return (
    completion?.processingCompletedAt ??
    finalRecord?.enrichmentCompletedAt ??
    readTimestampExtremaFromFields(finalRecord?.enrichmentFields, "completedAt", "max")?.toISOString() ??
    null
  );
}

function hasSuccessfulTerminalEnrichmentState(
  finalRecord: EndToEndEnrichmentLoadFinalRecord | undefined,
): boolean {
  return finalRecord?.enrichmentStatus === INSPIRATION_ENRICHMENT_STATUS_COMPLETED;
}

function readExpectedEnrichmentLoadFieldValue(
  finalRecord: EndToEndEnrichmentLoadFinalRecord,
  fieldName: AiEnrichmentFieldName,
): readonly number[] | readonly string[] | string | null | undefined {
  switch (fieldName) {
    case "embedding":
      return finalRecord.embedding;
    case "title":
      return finalRecord.title;
    case "summary":
      return finalRecord.summary;
    case "tags":
      return finalRecord.tags;
    case "domain":
      return finalRecord.domain;
    case "mood":
      return finalRecord.mood;
    case "actionability":
      return finalRecord.actionability;
  }
}

function hasExpectedEnrichmentLoadFieldValue(
  fieldName: AiEnrichmentFieldName,
  finalRecord: EndToEndEnrichmentLoadFinalRecord,
): boolean {
  const value = readExpectedEnrichmentLoadFieldValue(finalRecord, fieldName);

  if (fieldName === "embedding") {
    return Array.isArray(value) && value.length > 0;
  }

  if (fieldName === "tags") {
    return (
      Array.isArray(value) &&
      value.some((entry) => typeof entry === "string" && entry.trim().length > 0)
    );
  }

  return typeof value === "string" && value.trim().length > 0;
}

function hasExpectedEnrichmentLoadRequiredRequestFieldValue(
  fieldName: keyof CreateInspirationRequestBody,
  payload: CreateInspirationRequestBody,
): boolean {
  const value = payload[fieldName];

  switch (fieldName) {
    case "rawContent":
      return typeof value === "string" && value.length >= 1;
    case "sourceType":
      return (
        typeof value === "string" &&
        SUPPORTED_INSPIRATION_SOURCE_TYPES.includes(value)
      );
    case "sourceMeta":
      return isRequestPayloadRecord(value);
    case "audioDurationSeconds":
      return hasNonNegativeNumber(value);
    case "audioSizeBytes":
      return hasNonNegativeInteger(value);
    case "audioMimeType":
    case "audioStorageKey":
    case "audioStorageUrl":
    case "clusterId":
    case "mediaUrl":
    case "parentId":
    case "sourceParentId":
    case "sourceUrl":
    case "title":
    case "transcript":
      return hasNonEmptyTrimmedString(value);
    default:
      return value !== undefined && value !== null;
  }
}

function buildExpectedEnrichmentLoadMissingRequiredRequestFieldDiagnostic(args: {
  capture: ExpectedEnrichmentLoadCaptureRecord;
  missingFieldNames: readonly (keyof CreateInspirationRequestBody)[];
  payload: CreateInspirationRequestBody;
  requiredFieldNames: readonly (keyof CreateInspirationRequestBody)[];
}): ExpectedEnrichmentLoadMissingRequiredRequestFieldDiagnostic {
  return {
    missingFieldNames: args.missingFieldNames,
    payloadContext: {
      captureId: args.capture.id,
      payload: args.payload,
      requiredFieldNames: args.requiredFieldNames,
      sourceType: args.capture.sourceType,
    },
  };
}

export function resolveExpectedEnrichmentLoadMissingRequiredRequestFieldNames(
  payload: CreateInspirationRequestBody,
  requiredFieldNames: readonly (keyof CreateInspirationRequestBody)[],
): readonly (keyof CreateInspirationRequestBody)[] {
  return requiredFieldNames.filter(
    (fieldName) =>
      !hasExpectedEnrichmentLoadRequiredRequestFieldValue(fieldName, payload),
  );
}

export function assertExpectedEnrichmentLoadRequiredRequestFields(
  capture: ExpectedEnrichmentLoadCaptureRecord,
  payload: CreateInspirationRequestBody,
  requiredFieldNames: readonly (keyof CreateInspirationRequestBody)[] = capture.expected
    .requiredRequestFields,
): CreateInspirationRequestBody {
  const missingFieldNames =
    resolveExpectedEnrichmentLoadMissingRequiredRequestFieldNames(
      payload,
      requiredFieldNames,
    );

  if (missingFieldNames.length > 0) {
    throw new ExpectedEnrichmentLoadMissingRequiredRequestFieldsError(
      buildExpectedEnrichmentLoadMissingRequiredRequestFieldDiagnostic({
        capture,
        missingFieldNames,
        payload,
        requiredFieldNames,
      }),
    );
  }

  return payload;
}

export function resolveExpectedEnrichmentLoadMissingRequiredAiFieldNames(
  finalRecord: EndToEndEnrichmentLoadFinalRecord | undefined,
  requiredFieldNames: readonly AiEnrichmentFieldName[] = EXPECTED_ENRICHMENT_LOAD_REQUIRED_AI_FIELDS,
): readonly AiEnrichmentFieldName[] {
  if (!finalRecord) {
    return [...requiredFieldNames];
  }

  return requiredFieldNames.filter(
    (fieldName) => !hasExpectedEnrichmentLoadFieldValue(fieldName, finalRecord),
  );
}

export function assertExpectedEnrichmentLoadRequiredAiFields(
  finalRecord: EndToEndEnrichmentLoadFinalRecord,
  requiredFieldNames: readonly AiEnrichmentFieldName[] = EXPECTED_ENRICHMENT_LOAD_REQUIRED_AI_FIELDS,
): EndToEndEnrichmentLoadFinalRecord {
  const missingFieldNames = resolveExpectedEnrichmentLoadMissingRequiredAiFieldNames(
    finalRecord,
    requiredFieldNames,
  );

  if (missingFieldNames.length > 0) {
    throw new Error(
      `Expected-load final record ${finalRecord.id} is missing required AI enrichment fields: ${missingFieldNames.join(", ")}.`,
    );
  }

  return finalRecord;
}

export function assertExpectedEnrichmentLoadRunFinalRecords(
  finalRecords: readonly EndToEndEnrichmentLoadFinalRecord[],
  requiredFieldNames: readonly AiEnrichmentFieldName[] = EXPECTED_ENRICHMENT_LOAD_REQUIRED_AI_FIELDS,
): readonly EndToEndEnrichmentLoadFinalRecord[] {
  for (const finalRecord of finalRecords) {
    assertExpectedEnrichmentLoadRequiredAiFields(finalRecord, requiredFieldNames);
  }

  return finalRecords;
}

function resolveIncompleteFieldNames(
  finalRecord: EndToEndEnrichmentLoadFinalRecord | undefined,
  expectedFieldNames: readonly AiEnrichmentFieldName[],
  successfulTerminalState: boolean,
): readonly AiEnrichmentFieldName[] {
  if (!successfulTerminalState) {
    return [];
  }

  const enrichmentFields = finalRecord?.enrichmentFields;

  if (!enrichmentFields) {
    return [...expectedFieldNames];
  }

  const missingRequiredFieldNames =
    resolveExpectedEnrichmentLoadMissingRequiredAiFieldNames(
      finalRecord,
      expectedFieldNames,
    );
  const missingRequiredFieldNameSet = new Set(missingRequiredFieldNames);

  return expectedFieldNames.filter(
    (fieldName) =>
      missingRequiredFieldNameSet.has(fieldName) ||
      enrichmentFields[fieldName]?.status !==
      INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  );
}

export function generateEndToEndEnrichmentLoadRunReport(args: {
  finalRecords: readonly EndToEndEnrichmentLoadFinalRecord[];
  fixture: ExpectedEnrichmentLoadFixture;
  pipelineCompletions: readonly EndToEndEnrichmentPipelineCompletion[];
  submissions: readonly EndToEndEnrichmentLoadSubmission[];
}): EndToEndEnrichmentLoadRunReport {
  const finalRecordsById = new Map(args.finalRecords.map((record) => [record.id, record]));
  const completionsById = new Map(
    args.pipelineCompletions.map((completion) => [completion.capture.id, completion]),
  );
  const submissionsById = new Map(
    args.submissions.map((submission) => [submission.capture.id, submission]),
  );

  const items = args.fixture.captures.map((capture) => {
    const submission = submissionsById.get(capture.id);
    const completion = completionsById.get(capture.id);
    const finalRecord = finalRecordsById.get(capture.id);
    const missing = !submission && !completion && !finalRecord;
    const submittedAt = submission?.submittedAt ?? null;
    const processingStartedAt = readProcessingStartedAt(completion, finalRecord);
    const processingCompletedAt = readProcessingCompletedAt(completion, finalRecord);
    const successfulTerminalState =
      !missing && hasSuccessfulTerminalEnrichmentState(finalRecord);
    const processed =
      processingStartedAt !== null ||
      finalRecord?.enrichmentStatus === INSPIRATION_ENRICHMENT_STATUS_COMPLETED;
    const incompleteFieldNames = resolveIncompleteFieldNames(
      finalRecord,
      capture.expected.aiFieldNames,
      successfulTerminalState,
    );
    const completed =
      successfulTerminalState &&
      incompleteFieldNames.length === 0 &&
      processingCompletedAt !== null;

    return {
      captureId: capture.id,
      captureOrdinal: capture.captureOrdinal,
      completed,
      completedFieldCount:
        capture.expected.aiFieldNames.length - incompleteFieldNames.length,
      correlationId:
        submission?.correlationId ?? buildEndToEndEnrichmentCorrelationId(capture),
      expectedFieldCount: capture.expected.aiFieldNames.length,
      incompleteFieldNames,
      missing,
      processingCompletedAt,
      processingDurationMs: calculateDurationMs(
        processingStartedAt,
        processingCompletedAt,
      ),
      processingStartedAt,
      processed,
      successfulTerminalState,
      semanticGroupKey: capture.semanticGroup.key,
      sourceType: capture.sourceType,
      submittedAt,
      submitToCompleteMs: calculateDurationMs(submittedAt, processingCompletedAt),
      submitToProcessStartMs: calculateDurationMs(submittedAt, processingStartedAt),
      terminalStatus: finalRecord?.enrichmentStatus ?? null,
    } satisfies EndToEndEnrichmentLoadRunReportItem;
  });

  const missingCaptureIds = items
    .filter((item) => item.missing)
    .map((item) => item.captureId);
  const nonTerminalCaptureIds = items
    .filter(
      (item) =>
        !item.missing &&
        item.submittedAt !== null &&
        !item.successfulTerminalState,
    )
    .map((item) => item.captureId);
  const unprocessedCaptureIds = items
    .filter((item) => !item.missing && !item.processed)
    .map((item) => item.captureId);
  const incompleteItems = items
    .filter((item) => item.successfulTerminalState && !item.completed)
    .map((item) => ({
      captureId: item.captureId,
      incompleteFieldNames: item.incompleteFieldNames,
    }));
  const expectedItemCount = items.length;
  const submittedItemCount = items.filter((item) => item.submittedAt !== null).length;
  const processedItemCount = items.filter((item) => item.processed).length;
  const successfulTerminalItemCount = items.filter(
    (item) => item.successfulTerminalState,
  ).length;
  const completedItemCount = items.filter((item) => item.completed).length;

  return {
    incompleteItems,
    items,
    metrics: {
      averageProcessingDurationMs: calculateAverageDurationMs(
        items.map((item) => item.processingDurationMs),
      ),
      averageSubmitToCompleteMs: calculateAverageDurationMs(
        items.map((item) => item.submitToCompleteMs),
      ),
      averageSubmitToProcessStartMs: calculateAverageDurationMs(
        items.map((item) => item.submitToProcessStartMs),
      ),
      completedItemCount,
      completionRate:
        expectedItemCount === 0 ? 1 : completedItemCount / expectedItemCount,
      expectedItemCount,
      incompleteItemCount: incompleteItems.length,
      missingCaptureIds,
      missingItemCount: missingCaptureIds.length,
      nonTerminalCaptureIds,
      nonTerminalItemCount: nonTerminalCaptureIds.length,
      processedItemCount,
      processingRate:
        expectedItemCount === 0 ? 1 : processedItemCount / expectedItemCount,
      successfulTerminalItemCount,
      submittedItemCount,
      unprocessedCaptureIds,
      unprocessedItemCount: unprocessedCaptureIds.length,
    },
  };
}

function hasEndToEndEnrichmentLoadRunReachedSuccessfulTerminalState(
  report: EndToEndEnrichmentLoadRunReport,
): boolean {
  return report.items.every(
    (item) =>
      item.missing ||
      item.submittedAt === null ||
      item.successfulTerminalState ||
      item.terminalStatus === INSPIRATION_ENRICHMENT_STATUS_FAILED,
  );
}

export async function waitForEndToEndEnrichmentLoadRunTerminalState(
  options: WaitForEndToEndEnrichmentLoadRunTerminalStateOptions,
): Promise<WaitForEndToEndEnrichmentLoadRunTerminalStateResult> {
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? DEFAULT_END_TO_END_ENRICHMENT_VERIFICATION_MAX_ATTEMPTS,
  );
  const pollIntervalMs = Math.max(
    0,
    options.pollIntervalMs ??
      DEFAULT_END_TO_END_ENRICHMENT_VERIFICATION_POLL_INTERVAL_MS,
  );
  const sleepImpl = options.sleep ?? sleep;
  let attemptCount = 0;
  let finalRecords: readonly EndToEndEnrichmentLoadFinalRecord[] = [];
  let report = generateEndToEndEnrichmentLoadRunReport({
    finalRecords,
    fixture: options.fixture,
    pipelineCompletions: options.pipelineCompletions,
    submissions: options.submissions,
  });

  while (attemptCount < maxAttempts) {
    attemptCount += 1;
    finalRecords = await options.loadFinalRecords();
    report = generateEndToEndEnrichmentLoadRunReport({
      finalRecords,
      fixture: options.fixture,
      pipelineCompletions: options.pipelineCompletions,
      submissions: options.submissions,
    });

    if (hasEndToEndEnrichmentLoadRunReachedSuccessfulTerminalState(report)) {
      assertEndToEndEnrichmentLoadLatencyReport(
        generateEndToEndEnrichmentLoadLatencyReport({
          latencyBudgetMs: options.latencyBudgetMs,
          report,
        }),
        {
          runReport: report,
        },
      );

      return {
        attemptCount,
        finalRecords,
        report,
      };
    }

    if (attemptCount < maxAttempts) {
      await sleepImpl(pollIntervalMs);
    }
  }

  return {
    attemptCount,
    finalRecords,
    report,
  };
}

export function assertEndToEndEnrichmentLoadRunReport(
  report: EndToEndEnrichmentLoadRunReport,
): EndToEndEnrichmentLoadRunReport {
  const failureReasons: string[] = [];

  if (report.metrics.missingItemCount > 0) {
    failureReasons.push(
      `missing captures: ${report.metrics.missingCaptureIds.join(", ")}`,
    );
  }

  if (report.metrics.unprocessedItemCount > 0) {
    failureReasons.push(
      `unprocessed captures: ${report.metrics.unprocessedCaptureIds.join(", ")}`,
    );
  }

  if (report.metrics.nonTerminalItemCount > 0) {
    failureReasons.push(
      `captures missing successful terminal state: ${report.metrics.nonTerminalCaptureIds
        .map((captureId) => {
          const item = report.items.find(
            (candidate) => candidate.captureId === captureId,
          );

          return `${captureId} [${item?.terminalStatus ?? "UNKNOWN"}]`;
        })
        .join(", ")}`,
    );
  }

  if (report.metrics.incompleteItemCount > 0) {
    failureReasons.push(
      `incomplete captures: ${report.incompleteItems
        .map(
          (item) =>
            `${item.captureId} [${item.incompleteFieldNames.join(", ")}]`,
        )
        .join("; ")}`,
    );
  }

  if (failureReasons.length > 0) {
    throw new Error(
      `End-to-end enrichment load run report validation failed: ${failureReasons.join(" | ")}`,
    );
  }

  return report;
}

function resolveLatencyBudgetMs(value: number | undefined): number {
  const resolvedValue =
    value ?? DEFAULT_END_TO_END_ENRICHMENT_FULL_AI_POPULATION_LATENCY_BUDGET_MS;

  if (!Number.isFinite(resolvedValue) || resolvedValue < 0) {
    throw new RangeError("latencyBudgetMs must be a non-negative finite number.");
  }

  return resolvedValue;
}

function buildEndToEndEnrichmentLoadLatencyStepDiagnostics(
  item: EndToEndEnrichmentLoadRunReportItem,
): readonly EndToEndEnrichmentLoadLatencyStepDiagnostic[] {
  return [
    {
      durationMs: item.submitToProcessStartMs,
      label: "capture-to-processing-start",
      stepName: "capture_to_processing_start",
    },
    {
      durationMs: item.processingDurationMs,
      label: "processing-duration",
      stepName: "processing_duration",
    },
  ];
}

function resolveEndToEndEnrichmentLoadLatencyFocusArea(
  stepName: EndToEndEnrichmentLoadLatencyStepName | null,
): EndToEndEnrichmentLoadLatencyFocusArea {
  switch (stepName) {
    case "capture_to_processing_start":
      return "QUEUE_HANDOFF";
    case "processing_duration":
      return "AI_PROCESSING";
    default:
      return "UNKNOWN";
  }
}

function resolveEndToEndEnrichmentLoadLatencyFocusMessage(
  focusArea: EndToEndEnrichmentLoadLatencyFocusArea,
): string {
  switch (focusArea) {
    case "QUEUE_HANDOFF":
      return "Investigate queue handoff, subscriber concurrency, or Lambda cold starts before processing begins.";
    case "AI_PROCESSING":
      return "Investigate in-worker AI generation and persistence latency during enrichment processing.";
    default:
      return "Investigate both queue handoff and in-worker processing because step timings were incomplete.";
  }
}

function formatEndToEndEnrichmentLoadLatencyStepDiagnostics(
  stepDiagnostics: readonly EndToEndEnrichmentLoadLatencyStepDiagnostic[],
): string {
  return stepDiagnostics
    .map((step) =>
      step.durationMs === null
        ? `${step.label}=unmeasured`
        : `${step.label}=${step.durationMs}ms`,
    )
    .join(", ");
}

function resolveEndToEndEnrichmentLoadLatencyThresholdMissDiagnostics(
  item: EndToEndEnrichmentLoadRunReportItem,
  latencyBudgetMs: number,
): EndToEndEnrichmentLoadLatencyThresholdMissDiagnostics | null {
  if (item.submitToCompleteMs === null || item.submitToCompleteMs <= latencyBudgetMs) {
    return null;
  }

  const stepDiagnostics = buildEndToEndEnrichmentLoadLatencyStepDiagnostics(item);
  const measuredSteps = stepDiagnostics.filter(
    (
      step,
    ): step is EndToEndEnrichmentLoadLatencyStepDiagnostic & { durationMs: number } =>
      step.durationMs !== null,
  );
  const slowestStep =
    measuredSteps.length === 0
      ? null
      : measuredSteps.reduce((currentSlowest, candidate) =>
          candidate.durationMs > currentSlowest.durationMs ? candidate : currentSlowest,
        );
  const focusArea = resolveEndToEndEnrichmentLoadLatencyFocusArea(
    slowestStep?.stepName ?? null,
  );

  return {
    budgetExceededMs: item.submitToCompleteMs - latencyBudgetMs,
    focusArea,
    focusMessage: resolveEndToEndEnrichmentLoadLatencyFocusMessage(focusArea),
    slowestStepDurationMs: slowestStep?.durationMs ?? null,
    slowestStepName: slowestStep?.stepName ?? null,
    stepDiagnostics,
  };
}

function resolveEndToEndEnrichmentLoadLatencyFailureReason(
  item: EndToEndEnrichmentLoadRunReportItem,
  latencyBudgetMs: number,
  thresholdMissDiagnostics: EndToEndEnrichmentLoadLatencyThresholdMissDiagnostics | null,
): string | null {
  if (item.missing) {
    return "Capture was missing from the expected-load run.";
  }

  if (!item.successfulTerminalState) {
    return `Capture did not reach a successful terminal enrichment state (${item.terminalStatus ?? "UNKNOWN"}).`;
  }

  if (!item.completed) {
    return item.incompleteFieldNames.length > 0
      ? `Capture did not fully populate AI fields: ${item.incompleteFieldNames.join(", ")}.`
      : "Capture did not fully populate all required AI fields.";
  }

  if (item.submitToCompleteMs === null) {
    return "Time to full AI population could not be measured.";
  }

  if (thresholdMissDiagnostics !== null) {
    return `Time to full AI population ${item.submitToCompleteMs}ms exceeds the ${latencyBudgetMs}ms budget by ${thresholdMissDiagnostics.budgetExceededMs}ms. Slowest step: ${thresholdMissDiagnostics.slowestStepName ?? "unknown"}${thresholdMissDiagnostics.slowestStepDurationMs === null ? "" : `=${thresholdMissDiagnostics.slowestStepDurationMs}ms`}. Step timings: ${formatEndToEndEnrichmentLoadLatencyStepDiagnostics(thresholdMissDiagnostics.stepDiagnostics)}. Focus: ${thresholdMissDiagnostics.focusMessage}`;
  }

  return null;
}

export function generateEndToEndEnrichmentLoadLatencyReport(args: {
  latencyBudgetMs?: number;
  report: EndToEndEnrichmentLoadRunReport;
}): EndToEndEnrichmentLoadLatencyReport {
  const latencyBudgetMs = resolveLatencyBudgetMs(args.latencyBudgetMs);
  const items = args.report.items.map((item) => {
    const thresholdMissDiagnostics =
      resolveEndToEndEnrichmentLoadLatencyThresholdMissDiagnostics(
        item,
        latencyBudgetMs,
      );
    const failureReason = resolveEndToEndEnrichmentLoadLatencyFailureReason(
      item,
      latencyBudgetMs,
      thresholdMissDiagnostics,
    );
    const timeToFullAiPopulationMs = item.completed ? item.submitToCompleteMs : null;
    const passed = failureReason === null;

    return {
      captureId: item.captureId,
      captureOrdinal: item.captureOrdinal,
      correlationId: item.correlationId,
      failureReason,
      latencyBudgetMs,
      passed,
      status: passed ? "PASS" : "FAIL",
      thresholdMissDiagnostics,
      timeToFullAiPopulationMs,
    } satisfies EndToEndEnrichmentLoadLatencyReportItem;
  });
  const measuredValues = items
    .map((item) => item.timeToFullAiPopulationMs)
    .filter((value): value is number => value !== null);
  const failedCaptureIds = items
    .filter((item) => !item.passed)
    .map((item) => item.captureId);
  const passedItemCount = items.length - failedCaptureIds.length;
  const passed = failedCaptureIds.length === 0;

  return {
    items,
    summary: {
      averageTimeToFullAiPopulationMs: calculateAverageDurationMs(measuredValues),
      failedCaptureIds,
      failedItemCount: failedCaptureIds.length,
      latencyBudgetMs,
      maxTimeToFullAiPopulationMs:
        measuredValues.length === 0 ? null : Math.max(...measuredValues),
      measuredItemCount: measuredValues.length,
      passed,
      passedItemCount,
      status: passed ? "PASS" : "FAIL",
      totalItemCount: items.length,
    },
  };
}

function buildEndToEndEnrichmentLoadLatencyReportFailureMessage(
  report: EndToEndEnrichmentLoadLatencyReport,
): string {
  return `Expected-load latency report failed: ${report.items
    .filter((item) => !item.passed)
    .map(
      (item) =>
        `${item.captureId} [${item.failureReason ?? "Unknown latency failure."}]`,
    )
    .join("; ")}`;
}

export function assertEndToEndEnrichmentLoadLatencyReport(
  report: EndToEndEnrichmentLoadLatencyReport,
  context: {
    runReport?: EndToEndEnrichmentLoadRunReport | null;
  } = {},
): EndToEndEnrichmentLoadLatencyReport {
  if (report.summary.passed) {
    return report;
  }

  throw new EndToEndEnrichmentLoadLatencyReportError({
    latencyReport: report,
    runReport: context.runReport ?? null,
  });
}

function buildStoredInspirationRecord(
  captureId: string,
  args: CreateInspirationPersistenceArgs,
): StoredEndToEndInspirationRecord {
  return {
    ...(args.data.enrichmentAttemptCount === undefined
      ? {}
      : {
          enrichmentAttemptCount: args.data.enrichmentAttemptCount,
        }),
    ...(args.data.enrichmentCompletedAt === undefined
      ? {}
      : {
          enrichmentCompletedAt: args.data.enrichmentCompletedAt,
        }),
    ...(args.data.enrichmentFailedAt === undefined
      ? {}
      : {
          enrichmentFailedAt: args.data.enrichmentFailedAt,
        }),
    ...(args.data.enrichmentFields === undefined
      ? {}
      : {
          enrichmentFields: args.data.enrichmentFields,
        }),
    ...(args.data.enrichmentResumeState === undefined
      ? {}
      : {
          enrichmentResumeState: args.data.enrichmentResumeState,
        }),
    ...(args.data.enrichmentStartedAt === undefined
      ? {}
      : {
          enrichmentStartedAt: args.data.enrichmentStartedAt,
        }),
    ...(args.data.enrichmentStatus === undefined
      ? {}
      : {
          enrichmentStatus: args.data.enrichmentStatus,
        }),
    ...(args.data.reflectionPrompt === undefined
      ? {}
      : {
          reflectionPrompt: args.data.reflectionPrompt,
        }),
    ...(args.data.reflectionStatus === undefined
      ? {}
      : {
          reflectionStatus: args.data.reflectionStatus,
        }),
    ...(typeof args.data.mediaUrl === "string"
      ? {
          mediaUrl: args.data.mediaUrl,
        }
      : {}),
    ...(typeof args.data.sourceMeta === "object" &&
    args.data.sourceMeta !== null
      ? {
          sourceMeta: args.data.sourceMeta,
        }
      : {}),
    ...(typeof args.data.sourceUrl === "string"
      ? {
          sourceUrl: args.data.sourceUrl,
        }
      : {}),
    ...(typeof args.data.sourceConversationRef === "string"
      ? {
          sourceConversationRef: args.data.sourceConversationRef,
        }
      : {}),
    ...(Array.isArray(args.data.tags)
      ? {
          tags: [...args.data.tags],
        }
      : {}),
    ...(typeof args.data.title === "string"
      ? {
          title: args.data.title,
        }
      : {}),
    ...(typeof args.data.transcript === "string"
      ? {
          transcript: args.data.transcript,
        }
      : {}),
    id: captureId,
    rawContent: String(args.data.rawContent),
    sourceExpansions: [],
  };
}

function applyLifecycleUpdate(
  record: StoredEndToEndInspirationRecord,
  args: UpdateInspirationEnrichmentLifecycleArgs,
): void {
  const { data } = args;

  if (data.enrichmentAttemptCount !== undefined) {
    record.enrichmentAttemptCount =
      (record.enrichmentAttemptCount ?? 0) + data.enrichmentAttemptCount.increment;
  }

  if (data.enrichmentCompletedAt !== undefined) {
    record.enrichmentCompletedAt = data.enrichmentCompletedAt;
  }

  if (data.enrichmentFailedAt !== undefined) {
    record.enrichmentFailedAt = data.enrichmentFailedAt;
  }

  if (data.enrichmentFields !== undefined) {
    record.enrichmentFields = data.enrichmentFields;
  }

  if (data.enrichmentLastError !== undefined) {
    record.enrichmentLastError = data.enrichmentLastError;
  }

  if (data.enrichmentLastFailureReason !== undefined) {
    record.enrichmentLastFailureReason = data.enrichmentLastFailureReason;
  }

  if (data.enrichmentLastFailureRetryability !== undefined) {
    record.enrichmentLastFailureRetryability =
      data.enrichmentLastFailureRetryability;
  }

  if (data.enrichmentMaxAttemptCount !== undefined) {
    record.enrichmentMaxAttemptCount = data.enrichmentMaxAttemptCount;
  }

  if (data.enrichmentResumeState !== undefined) {
    record.enrichmentResumeState = data.enrichmentResumeState;
  }

  if (data.enrichmentStartedAt !== undefined) {
    record.enrichmentStartedAt = data.enrichmentStartedAt;
  }

  record.enrichmentStatus = data.enrichmentStatus;
}

class StubEndToEndEmbeddingClient implements InspirationEmbeddingClient {
  async generateEmbedding(request) {
    return {
      model: "embedding",
      operation: "generateEmbedding",
      output: {
        dimensions: OPENAI_EMBEDDING_DIMENSIONS,
        embedding: createEmbeddingVector(),
      },
      provider: "openai",
      requestId: request.requestId,
      traceId: request.traceId,
    };
  }
}

class StubEndToEndNonEmbeddingClient implements InspirationNonEmbeddingClient {
  async classify(request) {
    return {
      model: "gpt-5-mini",
      operation: "classify",
      output: {
        classification: "PROMPTED",
      },
      provider: "openai",
      requestId: request.requestId,
      traceId: request.traceId,
    };
  }

  async summarize(request) {
    return {
      model: "gpt-5-mini",
      operation: "summarize",
      output: {
        summary: "A deterministic enrichment summary for the correlated capture.",
      },
      provider: "openai",
      requestId: request.requestId,
      traceId: request.traceId,
    };
  }

  async generateReflection(request) {
    return {
      model: "gpt-5-mini",
      operation: "generateReflection",
      output: {
        reflectionPrompt: "What connection made this capture feel important?",
      },
      provider: "openai",
      requestId: request.requestId,
      traceId: request.traceId,
    };
  }

  async generateTitle(request) {
    return {
      model: "gpt-5-mini",
      operation: "generateTitle",
      output: {
        title: "Deterministic enriched title",
      },
      provider: "openai",
      requestId: request.requestId,
      traceId: request.traceId,
    };
  }

  async classifyMetadata(request) {
    return {
      model: "gpt-5-mini",
      operation: "classifyMetadata",
      output: {
        actionability: "action",
        domain: "knowledge-management",
        mood: "curious",
        tags: ["capture", "cluster", "connection"],
      },
      provider: "openai",
      requestId: request.requestId,
      traceId: request.traceId,
    };
  }
}

export function buildEndToEndEnrichmentCorrelationId(
  capture: Pick<ExpectedEnrichmentLoadCaptureRecord, "id">,
): string {
  return `e2e-enrichment:${capture.id}`;
}

export const createEndToEndEnrichmentCorrelationId =
  buildEndToEndEnrichmentCorrelationId;

export function buildEndToEndEnrichmentCaptureRequest(
  capture: ExpectedEnrichmentLoadCaptureRecord,
  options: {
    authenticatedUserId?: string;
  } = {},
): CreateInspirationRequestBody {
  const correlationId = buildEndToEndEnrichmentCorrelationId(capture);

  return {
    ...capture.request,
    sourceMeta: {
      ...(capture.request.sourceMeta ?? {}),
      [END_TO_END_ENRICHMENT_CORRELATION_ID_SOURCE_META_KEY]: correlationId,
      userId: options.authenticatedUserId ?? capture.request.sourceMeta?.userId,
    },
  };
}

export const createEndToEndEnrichmentCaptureRequest =
  buildEndToEndEnrichmentCaptureRequest;

export function buildEndToEndEnrichmentQueueRecord(
  payload: AiEnrichmentSqsJobPayload,
  correlationId: string,
): InspirationQueueRecord {
  return {
    attributes: {
      ApproximateReceiveCount: "1",
    },
    awsRegion: DEFAULT_END_TO_END_ENRICHMENT_QUEUE_REGION,
    body: JSON.stringify(payload),
    eventSource: "aws:sqs",
    eventSourceARN: DEFAULT_END_TO_END_ENRICHMENT_QUEUE_ARN,
    messageAttributes: {
      correlationId: {
        dataType: "String",
        stringValue: correlationId,
      },
      inspirationId: {
        dataType: "String",
        stringValue: payload.inspirationId,
      },
      jobType: {
        dataType: "String",
        stringValue: payload.jobType,
      },
    },
    messageId: correlationId,
  };
}

export const createEndToEndEnrichmentQueueRecord =
  buildEndToEndEnrichmentQueueRecord;

export function buildEndToEndEnrichmentProcessingRequest(
  payload: AiEnrichmentSqsJobPayload,
  correlationId: string,
): InspirationQueueRecordProcessingRequest {
  return createValidatedInspirationQueueRecordProcessingRequest(
    buildEndToEndEnrichmentQueueRecord(payload, correlationId),
  );
}

export const createEndToEndEnrichmentProcessingRequest =
  buildEndToEndEnrichmentProcessingRequest;

export async function runEndToEndEnrichmentLoadFixture(
  options: RunEndToEndEnrichmentLoadFixtureOptions = {},
): Promise<EndToEndEnrichmentLoadRunResult> {
  const {
    authenticatedUserId,
    fixture: providedFixture,
    requestUrl = DEFAULT_END_TO_END_ENRICHMENT_REQUEST_URL,
    ...fixtureOptions
  } = options;
  const fixture =
    providedFixture ?? createExpectedEnrichmentLoadFixture(fixtureOptions);
  const resolvedAuthenticatedUserId =
    authenticatedUserId ?? fixture.options.userId;
  const asyncTasks = createAsyncTaskHarness();
  const createCalls: CreateInspirationPersistenceArgs[] = [];
  const completions: EndToEndEnrichmentPipelineCompletion[] = [];
  const enqueuedPayloads: AiEnrichmentSqsJobPayload[] = [];
  const pipelineUpdates: MarkInspirationEnrichmentEnqueuedPersistenceArgs[] = [];
  const storedInspirations = new Map<string, StoredEndToEndInspirationRecord>();
  let activeCapture: ExpectedEnrichmentLoadCaptureRecord | null = null;
  const embeddingClient = new StubEndToEndEmbeddingClient();
  const nonEmbeddingClient = new StubEndToEndNonEmbeddingClient();

  const persistence: CreateInspirationPersistenceClient = {
    inspiration: {
      async create(args) {
        if (!activeCapture) {
          throw new Error(
            "The end-to-end enrichment load harness attempted to persist without an active capture.",
          );
        }

        createCalls.push(args);
        storedInspirations.set(
          activeCapture.id,
          buildStoredInspirationRecord(activeCapture.id, args),
        );
        return buildCreatedInspirationRecord(activeCapture.id, args);
      },
    },
  };

  const processingPersistence: InspirationEmbeddingPersistenceClient<StoredEndToEndInspirationRecord> =
    {
      inspiration: {
        async findUnique(args) {
          return storedInspirations.get(args.where.id) ?? null;
        },
        async update(args) {
          const existingRecord = storedInspirations.get(args.where.id);

          if (!existingRecord) {
            throw new Error(
              `The end-to-end enrichment harness could not find inspiration ${args.where.id} for lifecycle update.`,
            );
          }

          applyLifecycleUpdate(existingRecord, args);

          return {
            id: args.where.id,
          };
        },
      },
      async $executeRawUnsafe(sql) {
        return applyPersistedEnrichmentSql(sql, storedInspirations);
      },
    };

  const submissions: EndToEndEnrichmentLoadSubmission[] = [];

  for (const capture of fixture.captures) {
    activeCapture = capture;
    const createCallStartIndex = createCalls.length;
    const queuePayloadStartIndex = enqueuedPayloads.length;
    const pipelineUpdateStartIndex = pipelineUpdates.length;
    const requestBody = assertExpectedEnrichmentLoadRequiredRequestFields(
      capture,
      buildEndToEndEnrichmentCaptureRequest(capture, {
        authenticatedUserId: resolvedAuthenticatedUserId,
      }),
    );
    const response = await handleCreateInspirationRouteRequest(
      new Request(requestUrl, {
        body: JSON.stringify(requestBody),
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
      {
        dependencies: {
          auth: {
            async resolveAuthenticatedUserId() {
              return resolvedAuthenticatedUserId;
            },
          },
          backgroundScheduler: asyncTasks.schedule,
          enrichmentPipeline: {
            inspiration: {
              async update(args) {
                pipelineUpdates.push(args);
                const storedRecord = storedInspirations.get(
                  args.where.userId_id.id,
                );

                if (storedRecord) {
                  storedRecord.enrichmentAttemptCount =
                    args.data.enrichmentAttemptCount;
                  storedRecord.enrichmentCompletedAt =
                    args.data.enrichmentCompletedAt;
                  storedRecord.enrichmentEnqueuedAt =
                    args.data.enrichmentEnqueuedAt;
                  storedRecord.enrichmentFailedAt = args.data.enrichmentFailedAt;
                  storedRecord.enrichmentFields = args.data.enrichmentFields;
                  storedRecord.enrichmentLastError =
                    args.data.enrichmentLastError;
                  storedRecord.enrichmentLastFailureReason =
                    args.data.enrichmentLastFailureReason;
                  storedRecord.enrichmentLastFailureRetryability =
                    args.data.enrichmentLastFailureRetryability;
                  storedRecord.enrichmentMaxAttemptCount =
                    args.data.enrichmentMaxAttemptCount;
                  storedRecord.enrichmentResumeState =
                    args.data.enrichmentResumeState;
                  storedRecord.enrichmentStartedAt =
                    args.data.enrichmentStartedAt;
                  storedRecord.enrichmentStatus = args.data.enrichmentStatus;
                }

                return {
                  id: args.where.userId_id.id,
                };
              },
            },
          },
          persistence,
          queuePublisher: {
            async enqueue(payload) {
              enqueuedPayloads.push(payload);
            },
          },
        },
      },
    );
    const responseBody = (await response.json()) as
      | CreateInspirationResponseBody
      | {
          error?: string;
        };

    if (response.status !== CREATE_INSPIRATION_ROUTE_CREATED_STATUS) {
      throw new Error(
        `Capture ${capture.id} failed with ${response.status}: ${readResponseErrorMessage(responseBody)}`,
      );
    }

    await asyncTasks.flushScheduledTasks();

    const createArgs = requireSingleNewItem(
      `create args for capture ${capture.id}`,
      createCalls,
      createCallStartIndex,
    );
    const queuePayload = requireSingleNewItem(
      `queue payload for capture ${capture.id}`,
      enqueuedPayloads,
      queuePayloadStartIndex,
    );
    const pipelineUpdateArgs = requireSingleNewItem(
      `pipeline update for capture ${capture.id}`,
      pipelineUpdates,
      pipelineUpdateStartIndex,
    );
    const correlationId = buildEndToEndEnrichmentCorrelationId(capture);
    const queueRecord = buildEndToEndEnrichmentQueueRecord(
      queuePayload,
      correlationId,
    );
    const processingRequest =
      createValidatedInspirationQueueRecordProcessingRequest(queueRecord);
    const submittedAt = capture.timestamps.captureStartedAt;
    const processingStartedAt = capture.timestamps.ingestStartedAt;
    const processingCompletedAt = capture.timestamps.aiFieldsCompletedAt;

    await processInspirationQueueMessage(processingRequest, {
      embeddingClient,
      nonEmbeddingClient,
      now: createSequencedNow([
        processingStartedAt,
        processingCompletedAt,
      ]),
      persistenceClient: processingPersistence,
    });

    const completion = {
      capture,
      completedAt: processingCompletedAt,
      correlationId,
      processingCompletedAt,
      processingStartedAt,
      startedProcessingAt: processingStartedAt,
      submittedAt,
    } satisfies EndToEndEnrichmentPipelineCompletion;

    completions.push(completion);

    submissions.push({
      capture,
      completedAt: completion.completedAt,
      correlationId,
      createArgs,
      pipelineUpdateArgs,
      processingCompletedAt: completion.processingCompletedAt,
      processingRequest,
      processingStartedAt: completion.processingStartedAt,
      queuePayload,
      queueRecord,
      requestBody,
      responseBody,
      responseStatus: response.status,
      startedProcessingAt: completion.startedProcessingAt,
      submittedAt: completion.submittedAt,
    });
  }

  activeCapture = null;
  const verification = await waitForEndToEndEnrichmentLoadRunTerminalState({
    fixture,
    loadFinalRecords: async () =>
      fixture.captures
        .map((capture) => storedInspirations.get(capture.id))
        .filter(
          (record): record is StoredEndToEndInspirationRecord =>
            record !== undefined,
        )
        .map((record) => snapshotStoredInspirationRecord(record)),
    pipelineCompletions: completions,
    submissions,
  });
  const finalRecords = verification.finalRecords;
  assertExpectedEnrichmentLoadRunFinalRecords(finalRecords);
  const report = assertEndToEndEnrichmentLoadRunReport(
    verification.report,
  );
  const latencyReport = assertEndToEndEnrichmentLoadLatencyReport(
    generateEndToEndEnrichmentLoadLatencyReport({
      report,
    }),
    {
      runReport: report,
    },
  );

  return {
    completionTracking: completions,
    finalRecords,
    fixture,
    latencyReport,
    pipelineCompletions: completions,
    report,
    submissions,
  };
}

export const createEndToEndEnrichmentLoadRunner =
  runEndToEndEnrichmentLoadFixture;
export const executeEndToEndEnrichmentLoadFixture =
  runEndToEndEnrichmentLoadFixture;
export const runEndToEndEnrichmentHarness =
  runEndToEndEnrichmentLoadFixture;
