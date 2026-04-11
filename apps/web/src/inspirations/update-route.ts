import { randomUUID } from "node:crypto";

import type {
  AiEnrichmentFieldName,
  AiEnrichmentSqsJobPayload,
  ReflectionReembeddingSqsJobPayload,
  SupportedSqsJobPayload,
} from "../../../../packages/shared/types.ts";
import type {
  ClusterReassignmentDiscoveryEventPersistenceClient,
  DiscoveryEventInspirationClusterRecord,
} from "../discoveries/cluster-reassignment-persistence.ts";
import {
  createClusterReassignmentDiscoveryEvent,
  findDiscoveryEventInspirationCluster,
  shouldCreateClusterReassignmentDiscoveryEvent,
} from "../discoveries/cluster-reassignment-persistence.ts";
import {
  buildFindSelectiveInspirationEnrichmentArgs,
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  enqueueInspirationEnrichmentJob,
  INSPIRATION_ENRICHMENT_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_STATUS_FAILED,
  INSPIRATION_ENRICHMENT_STATUS_PENDING,
  INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
  type InspirationEnrichmentPipelinePersistenceClient,
  type SelectiveInspirationEnrichmentRerunPersistenceClient,
} from "./enrichment-pipeline.ts";
import type {
  InspirationAudioUploadMetadata,
  InspirationSourceType,
} from "./create-route.ts";
import {
  buildCompletedInspirationEnrichmentFields,
  normalizeInspirationEnrichmentFields,
  type InspirationEnrichmentFields,
} from "./enrichment-field-metadata.ts";
import { buildInspirationEnrichmentResumeState } from "./enrichment-resume-state.ts";
import {
  resolveInspirationEnrichmentExecutionPlan,
  type InspirationEnrichmentExecutionRecord,
} from "./enrichment-selective-execution.ts";
import {
  createInspirationRouteNotFoundResponse,
  InspirationRouteNotFoundError,
  INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  INSPIRATION_ROUTE_NOT_FOUND_STATUS,
  isInspirationRouteNotFoundError,
} from "./not-found-response.ts";

export const UPDATE_INSPIRATION_ROUTE_OK_STATUS = 200;
export const UPDATE_INSPIRATION_ROUTE_BAD_REQUEST_STATUS = 400;
export const UPDATE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS = 401;
export const UPDATE_INSPIRATION_ROUTE_NOT_FOUND_STATUS =
  INSPIRATION_ROUTE_NOT_FOUND_STATUS;
export const UPDATE_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const UPDATE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const UPDATE_INSPIRATION_ROUTE_NOT_FOUND_ERROR =
  INSPIRATION_ROUTE_NOT_FOUND_ERROR;
export const UPDATE_INSPIRATION_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const UPDATE_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Update inspiration route dependencies have not been configured.";
export const UPDATE_INSPIRATION_REQUEST_BODY_INVALID_ERROR =
  "Request body must be a JSON object.";
export const UPDATE_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR =
  "Request body must be valid JSON.";
export const UPDATE_INSPIRATION_REQUEST_BODY_EMPTY_ERROR =
  "At least one updatable field must be provided.";
export const UPDATE_INSPIRATION_ID_REQUIRED_ERROR =
  "inspirationId must be a non-empty string.";
export const UPDATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR =
  "rawContent must be at least 1 character.";
export const UPDATE_INSPIRATION_SOURCE_URL_INVALID_ERROR =
  "sourceUrl must be a valid absolute URL.";
export const UPDATE_INSPIRATION_MEDIA_URL_INVALID_ERROR =
  "mediaUrl must be a valid absolute URL.";
export const UPDATE_INSPIRATION_AUDIO_STORAGE_URL_INVALID_ERROR =
  "audioStorageUrl must be a valid absolute URL.";
export const UPDATE_INSPIRATION_AUDIO_SIZE_BYTES_INVALID_ERROR =
  "audioSizeBytes must be a non-negative integer when provided.";
export const UPDATE_INSPIRATION_AUDIO_DURATION_SECONDS_INVALID_ERROR =
  "audioDurationSeconds must be a non-negative number when provided.";
export const UPDATE_INSPIRATION_TAGS_INVALID_ERROR =
  "tags must be an array of strings when provided.";
export const UPDATE_INSPIRATION_IS_PUBLIC_INVALID_ERROR =
  "isPublic must be a boolean when provided.";
export const UPDATE_INSPIRATION_REFLECTION_ANSWER_INVALID_ERROR =
  "reflectionAnswer must be a non-empty string when provided.";
export const INSPIRATION_SHARE_SLUG_GENERATION_MAX_ATTEMPTS = 5;
export const INSPIRATION_SHARE_SLUG_PREFIX = "insp_";

const MANUALLY_COMPLETABLE_INSPIRATION_FIELD_NAMES = [
  "actionability",
  "domain",
  "mood",
  "summary",
  "tags",
  "title",
] as const;

type ManuallyCompletableInspirationFieldName =
  (typeof MANUALLY_COMPLETABLE_INSPIRATION_FIELD_NAMES)[number];

export interface UpdateInspirationRequestBody {
  actionability?: string | null;
  audioDurationSeconds?: number | null;
  audioMimeType?: string | null;
  audioSizeBytes?: number | null;
  audioStorageKey?: string | null;
  audioStorageUrl?: string | null;
  clusterId?: string | null;
  domain?: string | null;
  isPublic?: boolean;
  mediaUrl?: string | null;
  mood?: string | null;
  rawContent?: string;
  reflectionAnswer?: string;
  shareSlug?: string | null;
  sourceMeta?: Record<string, unknown> | null;
  sourceUrl?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  title?: string | null;
  transcript?: string | null;
}

export interface UpdateInspirationResponseBody
  extends InspirationAudioUploadMetadata {
  id: string;
  isPublic?: boolean;
  rawContent: string;
  shareSlug?: string | null;
  sourceType: InspirationSourceType;
}

export interface UpdatedInspirationRecord {
  audioDurationSeconds?: number | null;
  audioMimeType?: string | null;
  audioSizeBytes?: number | null;
  audioStorageKey?: string | null;
  audioStorageUrl?: string | null;
  id: string;
  isPublic?: boolean;
  rawContent: string;
  rawContentChanged: boolean;
  shareSlug?: string | null;
  sourceType: InspirationSourceType;
}

export interface UpdateInspirationPersistenceData {
  actionability?: string | null;
  audioDurationSeconds?: number | null;
  audioMimeType?: string | null;
  audioSizeBytes?: number | null;
  audioStorageKey?: string | null;
  audioStorageUrl?: string | null;
  clusterId?: string | null;
  domain?: string | null;
  enrichmentFields?: InspirationEnrichmentFields;
  enrichmentResumeState?: ReturnType<typeof buildInspirationEnrichmentResumeState> | null;
  enrichmentStatus?: string;
  isPublic?: boolean;
  mediaUrl?: string | null;
  mood?: string | null;
  rawContent?: string;
  reflectionAnswer?: string;
  reflectionStatus?: "ANSWERED";
  shareSlug?: string | null;
  sourceMeta?: Record<string, unknown> | null;
  sourceUrl?: string | null;
  summary?: string | null;
  tags?: string[] | null;
  title?: string | null;
  transcript?: string | null;
}

export interface UpdateInspirationPersistenceArgs {
  data: UpdateInspirationPersistenceData;
  select: {
    audioDurationSeconds: true;
    audioMimeType: true;
    audioSizeBytes: true;
    audioStorageKey: true;
    audioStorageUrl: true;
    id: true;
    rawContent: true;
    sourceType: true;
  };
  where: {
    userId_id: {
      id: string;
      userId: string;
    };
  };
}

function buildUpdateInspirationAudioUploadResponseFields(
  record: UpdatedInspirationRecord,
): InspirationAudioUploadMetadata {
  return {
    ...(record.audioStorageKey == null
      ? {}
      : { audioStorageKey: record.audioStorageKey }),
    ...(record.audioStorageUrl == null
      ? {}
      : { audioStorageUrl: record.audioStorageUrl }),
    ...(record.audioMimeType == null
      ? {}
      : { audioMimeType: record.audioMimeType }),
    ...(record.audioSizeBytes == null
      ? {}
      : { audioSizeBytes: record.audioSizeBytes }),
    ...(record.audioDurationSeconds == null
      ? {}
      : { audioDurationSeconds: record.audioDurationSeconds }),
  };
}

export interface UpdateInspirationPersistenceClient<
  TRecord extends UpdatedInspirationRecord = UpdatedInspirationRecord,
  TClusterAssignmentRecord extends DiscoveryEventInspirationClusterRecord = DiscoveryEventInspirationClusterRecord,
> extends ClusterReassignmentDiscoveryEventPersistenceClient<TClusterAssignmentRecord> {
  inspiration: ClusterReassignmentDiscoveryEventPersistenceClient<TClusterAssignmentRecord>["inspiration"] & {
    update(args: UpdateInspirationPersistenceArgs): Promise<TRecord>;
  };
}

export interface UpdateInspirationRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface UpdateInspirationQueuePublisher {
  enqueue(
    payload: AiEnrichmentSqsJobPayload | ReflectionReembeddingSqsJobPayload,
  ): Promise<void>;
}

export type InspirationShareSlugGenerator = () => string;

export type UpdateInspirationBackgroundScheduler = (
  task: () => Promise<void>,
) => void;

export interface UpdateInspirationRouteDependencies<
  TRecord extends UpdatedInspirationRecord = UpdatedInspirationRecord,
> {
  auth: UpdateInspirationRouteAuthResolver;
  backgroundScheduler?: UpdateInspirationBackgroundScheduler;
  enrichmentPipeline: SelectiveInspirationEnrichmentRerunPersistenceClient;
  logger?: Pick<Console, "error">;
  persistence: UpdateInspirationPersistenceClient<TRecord>;
  queuePublisher: UpdateInspirationQueuePublisher;
  shareSlugGenerator?: InspirationShareSlugGenerator;
}

export interface UpdateInspirationRouteParams {
  inspirationId: string;
}

export interface HandleUpdateInspirationRouteRequestOptions<
  TRecord extends UpdatedInspirationRecord = UpdatedInspirationRecord,
> {
  dependencies?: UpdateInspirationRouteDependencies<TRecord>;
  params: UpdateInspirationRouteParams;
}

let defaultUpdateInspirationRouteDependencies:
  | UpdateInspirationRouteDependencies
  | null = null;

export class UpdateInspirationNotFoundError extends InspirationRouteNotFoundError {
  constructor() {
    super();
    this.name = "UpdateInspirationNotFoundError";
  }
}

function createJsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, {
    status,
  });
}

function hasOwn(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripUpdateOwnershipFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const {
    ownerId: _ownerId,
    userId: _userId,
    tenantId: _tenantId,
    workspaceId: _workspaceId,
    ...sanitizedPayload
  } = payload;

  return sanitizedPayload;
}

function readNullableTrimmedString(
  payload: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!hasOwn(payload, key)) {
    return undefined;
  }

  const value = payload[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new TypeError(`${key} must be a string when provided.`);
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : null;
}

function readNullableStringArray(
  payload: Record<string, unknown>,
  key: string,
): string[] | null | undefined {
  if (!hasOwn(payload, key)) {
    return undefined;
  }

  const value = payload[key];

  if (value === null) {
    return null;
  }

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new TypeError(UPDATE_INSPIRATION_TAGS_INVALID_ERROR);
  }

  return [...new Set(value.map((entry) => entry.trim()).filter((entry) => entry.length > 0))];
}

function readOptionalBoolean(
  payload: Record<string, unknown>,
  key: string,
  errorMessage: string,
): boolean | undefined {
  if (!hasOwn(payload, key)) {
    return undefined;
  }

  const value = payload[key];

  if (typeof value !== "boolean") {
    throw new TypeError(errorMessage);
  }

  return value;
}

function readReflectionAnswer(
  payload: Record<string, unknown>,
): string | undefined {
  if (!hasOwn(payload, "reflectionAnswer")) {
    return undefined;
  }

  const value = payload.reflectionAnswer;

  if (typeof value !== "string") {
    throw new TypeError(UPDATE_INSPIRATION_REFLECTION_ANSWER_INVALID_ERROR);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(UPDATE_INSPIRATION_REFLECTION_ANSWER_INVALID_ERROR);
  }

  return normalizedValue;
}

function readRawContent(
  payload: Record<string, unknown>,
): string | undefined {
  if (!hasOwn(payload, "rawContent")) {
    return undefined;
  }

  const value = payload.rawContent;

  if (typeof value !== "string" || value.length < 1) {
    throw new TypeError(UPDATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR);
  }

  return value;
}

function readNullableAbsoluteUrl(
  payload: Record<string, unknown>,
  key: "audioStorageUrl" | "mediaUrl" | "sourceUrl",
  errorMessage: string,
): string | null | undefined {
  const value = readNullableTrimmedString(payload, key);

  if (value === undefined || value === null) {
    return value;
  }

  try {
    return new URL(value).toString();
  } catch {
    throw new TypeError(errorMessage);
  }
}

function readOptionalSourceMeta(
  payload: Record<string, unknown>,
): Record<string, unknown> | null | undefined {
  if (!hasOwn(payload, "sourceMeta")) {
    return undefined;
  }

  const value = payload.sourceMeta;

  if (value === null) {
    return null;
  }

  if (!isRecord(value)) {
    throw new TypeError("sourceMeta must be a JSON object when provided.");
  }

  return value;
}

function readNullableNonNegativeInteger(
  payload: Record<string, unknown>,
  key: string,
  errorMessage: string,
): number | null | undefined {
  if (!hasOwn(payload, key)) {
    return undefined;
  }

  const value = payload[key];

  if (value === null) {
    return null;
  }

  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new TypeError(errorMessage);
  }

  return Number(value);
}

function readNullableNonNegativeNumber(
  payload: Record<string, unknown>,
  key: string,
  errorMessage: string,
): number | null | undefined {
  if (!hasOwn(payload, key)) {
    return undefined;
  }

  const value = payload[key];

  if (value === null) {
    return null;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(errorMessage);
  }

  return value;
}

export function buildUpdateInspirationPersistenceArgs(
  userId: string,
  inspirationId: string,
  input: UpdateInspirationRequestBody,
  options: {
    enrichmentFields?: InspirationEnrichmentFields;
    enrichmentResumeState?: ReturnType<typeof buildInspirationEnrichmentResumeState> | null;
    enrichmentStatus?: string;
  } = {},
): UpdateInspirationPersistenceArgs {
  return {
    data: {
      ...(input.actionability === undefined
        ? {}
        : { actionability: input.actionability }),
      ...(input.audioStorageKey === undefined
        ? {}
        : { audioStorageKey: input.audioStorageKey }),
      ...(input.audioStorageUrl === undefined
        ? {}
        : { audioStorageUrl: input.audioStorageUrl }),
      ...(input.audioMimeType === undefined
        ? {}
        : { audioMimeType: input.audioMimeType }),
      ...(input.audioSizeBytes === undefined
        ? {}
        : { audioSizeBytes: input.audioSizeBytes }),
      ...(input.audioDurationSeconds === undefined
        ? {}
        : { audioDurationSeconds: input.audioDurationSeconds }),
      ...(input.rawContent === undefined ? {} : { rawContent: input.rawContent }),
      ...(input.domain === undefined ? {} : { domain: input.domain }),
      ...(input.isPublic === undefined ? {} : { isPublic: input.isPublic }),
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(input.tags === undefined ? {} : { tags: input.tags }),
      ...(input.mood === undefined ? {} : { mood: input.mood }),
      ...(input.reflectionAnswer === undefined
        ? {}
        : {
            reflectionAnswer: input.reflectionAnswer,
            reflectionStatus: "ANSWERED" as const,
          }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
      ...(input.shareSlug === undefined ? {} : { shareSlug: input.shareSlug }),
      ...(input.sourceMeta === undefined ? {} : { sourceMeta: input.sourceMeta }),
      ...(input.mediaUrl === undefined ? {} : { mediaUrl: input.mediaUrl }),
      ...(input.transcript === undefined ? {} : { transcript: input.transcript }),
      ...(input.clusterId === undefined ? {} : { clusterId: input.clusterId }),
      ...(options.enrichmentFields === undefined
        ? {}
        : { enrichmentFields: options.enrichmentFields }),
      ...(options.enrichmentResumeState === undefined
        ? {}
        : { enrichmentResumeState: options.enrichmentResumeState }),
      ...(options.enrichmentStatus === undefined
        ? {}
        : { enrichmentStatus: options.enrichmentStatus }),
    },
    select: {
      audioDurationSeconds: true,
      audioMimeType: true,
      audioSizeBytes: true,
      audioStorageKey: true,
      audioStorageUrl: true,
      id: true,
      rawContent: true,
      sourceType: true,
    },
    where: {
      userId_id: {
        id: inspirationId,
        userId,
      },
    },
  };
}

function resolveBackgroundScheduler(
  dependencies: UpdateInspirationRouteDependencies,
): UpdateInspirationBackgroundScheduler {
  if (dependencies.backgroundScheduler) {
    return dependencies.backgroundScheduler;
  }

  return (task) => {
    // Defer to the next macrotask so the route can resolve before queue I/O starts.
    setTimeout(() => {
      void task();
    }, 0);
  };
}

function resolveUpdateInspirationRouteDependencies<
  TRecord extends UpdatedInspirationRecord = UpdatedInspirationRecord,
>(
  override?: UpdateInspirationRouteDependencies<TRecord>,
): UpdateInspirationRouteDependencies<TRecord> {
  if (override) {
    return override;
  }

  if (defaultUpdateInspirationRouteDependencies) {
    return defaultUpdateInspirationRouteDependencies as UpdateInspirationRouteDependencies<TRecord>;
  }

  throw new Error(UPDATE_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isUpdateInspirationBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.message === UPDATE_INSPIRATION_ID_REQUIRED_ERROR ||
      error.message === UPDATE_INSPIRATION_REQUEST_BODY_INVALID_ERROR ||
      error.message.startsWith(
        UPDATE_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR,
      ) ||
      error.message === UPDATE_INSPIRATION_REQUEST_BODY_EMPTY_ERROR ||
      error.message === UPDATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR ||
      error.message === UPDATE_INSPIRATION_SOURCE_URL_INVALID_ERROR ||
      error.message === UPDATE_INSPIRATION_TAGS_INVALID_ERROR ||
      error.message === UPDATE_INSPIRATION_IS_PUBLIC_INVALID_ERROR ||
      error.message === UPDATE_INSPIRATION_MEDIA_URL_INVALID_ERROR ||
      error.message === UPDATE_INSPIRATION_AUDIO_STORAGE_URL_INVALID_ERROR ||
      error.message === UPDATE_INSPIRATION_AUDIO_SIZE_BYTES_INVALID_ERROR ||
      error.message === UPDATE_INSPIRATION_AUDIO_DURATION_SECONDS_INVALID_ERROR ||
      error.message === UPDATE_INSPIRATION_REFLECTION_ANSWER_INVALID_ERROR ||
      error.message === "sourceMeta must be a JSON object when provided." ||
      error.message.endsWith(" must be a string when provided."))
  );
}

export function configureUpdateInspirationRouteDependencies(
  dependencies: UpdateInspirationRouteDependencies | null,
): void {
  defaultUpdateInspirationRouteDependencies = dependencies;
}

export function generateInspirationShareSlug(
  generateUuid: () => string = randomUUID,
): string {
  return `${INSPIRATION_SHARE_SLUG_PREFIX}${generateUuid().replaceAll("-", "")}`;
}

function resolveShareSlugGenerator(
  dependencies: UpdateInspirationRouteDependencies,
): InspirationShareSlugGenerator {
  return dependencies.shareSlugGenerator ?? generateInspirationShareSlug;
}

function isShareSlugConstraintTarget(target: unknown): boolean {
  if (Array.isArray(target)) {
    return target.includes("shareSlug");
  }

  return typeof target === "string" && target.includes("shareSlug");
}

function isShareSlugConflictError(error: unknown): boolean {
  if (
    typeof error !== "object" ||
    error === null ||
    !("code" in error) ||
    error.code !== "P2002"
  ) {
    return false;
  }

  if (
    "meta" in error &&
    typeof error.meta === "object" &&
    error.meta !== null &&
    "target" in error.meta &&
    isShareSlugConstraintTarget(error.meta.target)
  ) {
    return true;
  }

  return "message" in error &&
    typeof error.message === "string" &&
    error.message.includes("shareSlug");
}

export async function parseUpdateInspirationRequestBody(
  request: Request,
): Promise<UpdateInspirationRequestBody> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    throw new TypeError(
      `${UPDATE_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new TypeError(UPDATE_INSPIRATION_REQUEST_BODY_INVALID_ERROR);
  }

  const sanitizedPayload = stripUpdateOwnershipFields(payload);
  const actionability = readNullableTrimmedString(
    sanitizedPayload,
    "actionability",
  );
  const rawContent = readRawContent(sanitizedPayload);
  const domain = readNullableTrimmedString(sanitizedPayload, "domain");
  const isPublic = readOptionalBoolean(
    sanitizedPayload,
    "isPublic",
    UPDATE_INSPIRATION_IS_PUBLIC_INVALID_ERROR,
  );
  const summary = readNullableTrimmedString(sanitizedPayload, "summary");
  const tags = readNullableStringArray(sanitizedPayload, "tags");
  const mood = readNullableTrimmedString(sanitizedPayload, "mood");
  const reflectionAnswer = readReflectionAnswer(sanitizedPayload);
  const title = readNullableTrimmedString(sanitizedPayload, "title");
  const audioStorageKey = readNullableTrimmedString(
    sanitizedPayload,
    "audioStorageKey",
  );
  const audioStorageUrl = readNullableAbsoluteUrl(
    sanitizedPayload,
    "audioStorageUrl",
    UPDATE_INSPIRATION_AUDIO_STORAGE_URL_INVALID_ERROR,
  );
  const audioMimeType = readNullableTrimmedString(
    sanitizedPayload,
    "audioMimeType",
  );
  const audioSizeBytes = readNullableNonNegativeInteger(
    sanitizedPayload,
    "audioSizeBytes",
    UPDATE_INSPIRATION_AUDIO_SIZE_BYTES_INVALID_ERROR,
  );
  const audioDurationSeconds = readNullableNonNegativeNumber(
    sanitizedPayload,
    "audioDurationSeconds",
    UPDATE_INSPIRATION_AUDIO_DURATION_SECONDS_INVALID_ERROR,
  );
  const sourceUrl = readNullableAbsoluteUrl(
    sanitizedPayload,
    "sourceUrl",
    UPDATE_INSPIRATION_SOURCE_URL_INVALID_ERROR,
  );
  const sourceMeta = readOptionalSourceMeta(sanitizedPayload);
  const mediaUrl = readNullableAbsoluteUrl(
    sanitizedPayload,
    "mediaUrl",
    UPDATE_INSPIRATION_MEDIA_URL_INVALID_ERROR,
  );
  const transcript = readNullableTrimmedString(sanitizedPayload, "transcript");
  const clusterId = readNullableTrimmedString(sanitizedPayload, "clusterId");

  const parsedBody = {
    ...(actionability === undefined ? {} : { actionability }),
    ...(rawContent === undefined ? {} : { rawContent }),
    ...(domain === undefined ? {} : { domain }),
    ...(isPublic === undefined ? {} : { isPublic }),
    ...(summary === undefined ? {} : { summary }),
    ...(tags === undefined ? {} : { tags }),
    ...(mood === undefined ? {} : { mood }),
    ...(reflectionAnswer === undefined ? {} : { reflectionAnswer }),
    ...(title === undefined ? {} : { title }),
    ...(audioStorageKey === undefined ? {} : { audioStorageKey }),
    ...(audioStorageUrl === undefined ? {} : { audioStorageUrl }),
    ...(audioMimeType === undefined ? {} : { audioMimeType }),
    ...(audioSizeBytes === undefined ? {} : { audioSizeBytes }),
    ...(audioDurationSeconds === undefined ? {} : { audioDurationSeconds }),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(sourceMeta === undefined ? {} : { sourceMeta }),
    ...(mediaUrl === undefined ? {} : { mediaUrl }),
    ...(transcript === undefined ? {} : { transcript }),
    ...(clusterId === undefined ? {} : { clusterId }),
  } satisfies UpdateInspirationRequestBody;

  if (Object.keys(parsedBody).length === 0) {
    throw new TypeError(UPDATE_INSPIRATION_REQUEST_BODY_EMPTY_ERROR);
  }

  return parsedBody;
}

function readInspirationId(params: UpdateInspirationRouteParams): string {
  const normalizedValue = params.inspirationId.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(UPDATE_INSPIRATION_ID_REQUIRED_ERROR);
  }

  return normalizedValue;
}

function deriveInspirationEnrichmentStatus(
  enrichmentFields: InspirationEnrichmentFields,
): string {
  const fieldStates = Object.values(enrichmentFields);

  if (fieldStates.every((field) => field.status === "COMPLETED")) {
    return INSPIRATION_ENRICHMENT_STATUS_COMPLETED;
  }

  if (fieldStates.some((field) => field.status === "PROCESSING")) {
    return INSPIRATION_ENRICHMENT_STATUS_PROCESSING;
  }

  if (fieldStates.some((field) => field.status === "PENDING")) {
    return INSPIRATION_ENRICHMENT_STATUS_PENDING;
  }

  return INSPIRATION_ENRICHMENT_STATUS_FAILED;
}

function buildReflectionReembeddingJobPayload(
  inspirationId: string,
): ReflectionReembeddingSqsJobPayload {
  return {
    jobType: "reflection_reembedding",
    inspirationId,
  };
}

function resolveManualCompletionFieldNames(
  input: UpdateInspirationRequestBody,
): ManuallyCompletableInspirationFieldName[] {
  if (input.rawContent !== undefined) {
    return [];
  }

  return MANUALLY_COMPLETABLE_INSPIRATION_FIELD_NAMES.filter((fieldName) => {
    switch (fieldName) {
      case "actionability":
        return input.actionability !== undefined;
      case "domain":
        return input.domain !== undefined;
      case "mood":
        return input.mood !== undefined;
      case "summary":
        return input.summary !== undefined;
      case "tags":
        return input.tags !== undefined;
      case "title":
        return input.title !== undefined;
    }
  });
}

function resolveExistingEnrichmentMaxAttemptCount(
  enrichmentFields: InspirationEnrichmentFields | undefined,
): number {
  if (!enrichmentFields) {
    return INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT;
  }

  return Math.max(
    ...Object.values(enrichmentFields).map((field) => field.maxAttemptCount),
  );
}

function buildManualFieldExecutionRecord(
  inspiration: InspirationEnrichmentExecutionRecord,
  input: UpdateInspirationRequestBody,
  enrichmentFields: InspirationEnrichmentFields,
): InspirationEnrichmentExecutionRecord {
  return {
    ...inspiration,
    ...(input.actionability === undefined
      ? {}
      : { actionability: input.actionability }),
    ...(input.domain === undefined ? {} : { domain: input.domain }),
    enrichmentFields,
    ...(input.mood === undefined ? {} : { mood: input.mood }),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.tags === undefined ? {} : { tags: input.tags }),
    ...(input.title === undefined ? {} : { title: input.title }),
  };
}

function buildManualFieldRecoveryPersistenceOptions(
  inspiration: InspirationEnrichmentExecutionRecord,
  input: UpdateInspirationRequestBody,
  completedAt: Date,
): {
  enrichmentFields: InspirationEnrichmentFields;
  enrichmentResumeState: ReturnType<typeof buildInspirationEnrichmentResumeState> | null;
  enrichmentStatus: string;
} {
  const existingFields = normalizeInspirationEnrichmentFields(
    inspiration.enrichmentFields,
    `Inspiration ${inspiration.id} enrichmentFields`,
  );
  const completedFieldNames = resolveManualCompletionFieldNames(
    input,
  ) as AiEnrichmentFieldName[];
  const enrichmentFields = buildCompletedInspirationEnrichmentFields({
    completedAt,
    completedFieldNames,
    existingFields,
    maxAttemptCount: resolveExistingEnrichmentMaxAttemptCount(existingFields),
  });
  const executionPlan = resolveInspirationEnrichmentExecutionPlan(
    buildManualFieldExecutionRecord(inspiration, input, enrichmentFields),
  );
  const enrichmentStatus = deriveInspirationEnrichmentStatus(enrichmentFields);

  if (executionPlan.remainingFieldNames.length === 0) {
    return {
      enrichmentFields,
      enrichmentResumeState: null,
      enrichmentStatus,
    };
  }

  return {
    enrichmentFields,
    enrichmentResumeState:
      executionPlan.resumeState ??
      buildInspirationEnrichmentResumeState({
        capture: executionPlan.capture,
        completedFieldNames: executionPlan.completedFieldNames,
        completedOutputs: executionPlan.completedOutputs,
        remainingFieldNames: executionPlan.remainingFieldNames,
        updatedAt: completedAt,
      }),
    enrichmentStatus,
  };
}

async function updateInspirationWithResolvedShareSlug<
  TRecord extends UpdatedInspirationRecord = UpdatedInspirationRecord,
>(
  dependencies: UpdateInspirationRouteDependencies<TRecord>,
  userId: string,
  inspirationId: string,
  input: UpdateInspirationRequestBody,
  persistenceOptions?: {
    enrichmentFields?: InspirationEnrichmentFields;
    enrichmentResumeState?: ReturnType<typeof buildInspirationEnrichmentResumeState> | null;
    enrichmentStatus?: string;
  },
): Promise<{
  shareSlug: string | null | undefined;
  updatedInspiration: TRecord;
}> {
  if (input.isPublic === undefined) {
    return {
      shareSlug: undefined,
      updatedInspiration: await dependencies.persistence.inspiration.update(
        buildUpdateInspirationPersistenceArgs(
          userId,
          inspirationId,
          input,
          persistenceOptions,
        ),
      ),
    };
  }

  if (input.isPublic === false) {
    return {
      shareSlug: null,
      updatedInspiration: await dependencies.persistence.inspiration.update(
        buildUpdateInspirationPersistenceArgs(
          userId,
          inspirationId,
          {
            ...input,
            shareSlug: null,
          },
          persistenceOptions,
        ),
      ),
    };
  }

  const shareSlugGenerator = resolveShareSlugGenerator(dependencies);
  let latestError: unknown;

  for (
    let attempt = 0;
    attempt < INSPIRATION_SHARE_SLUG_GENERATION_MAX_ATTEMPTS;
    attempt += 1
  ) {
    const shareSlug = shareSlugGenerator();

    try {
      return {
        shareSlug,
        updatedInspiration: await dependencies.persistence.inspiration.update(
          buildUpdateInspirationPersistenceArgs(
            userId,
            inspirationId,
            {
              ...input,
              shareSlug,
            },
            persistenceOptions,
          ),
        ),
      };
    } catch (error) {
      if (!isShareSlugConflictError(error)) {
        throw error;
      }

      latestError = error;
    }
  }

  throw latestError;
}

export async function handleUpdateInspirationRouteRequest<
  TRecord extends UpdatedInspirationRecord = UpdatedInspirationRecord,
>(
  request: Request,
  options: HandleUpdateInspirationRouteRequestOptions<TRecord>,
): Promise<Response> {
  let dependencies: UpdateInspirationRouteDependencies<TRecord>;

  try {
    dependencies = resolveUpdateInspirationRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: UPDATE_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      UPDATE_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: UPDATE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
      },
      UPDATE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const inspirationId = readInspirationId(options.params);
    const input = await parseUpdateInspirationRequestBody(request);
    const previousClusterAssignment =
      input.clusterId === undefined
        ? undefined
        : await findDiscoveryEventInspirationCluster(
            dependencies.persistence,
            authenticatedUserId,
            inspirationId,
          );

    if (input.clusterId !== undefined && previousClusterAssignment === null) {
      throw new UpdateInspirationNotFoundError();
    }

    const manualCompletionFieldNames = resolveManualCompletionFieldNames(input);
    const manualRecoveryOptions =
      manualCompletionFieldNames.length === 0
        ? undefined
        : (() => {
            const completedAt = new Date();

            return dependencies.enrichmentPipeline.inspiration
              .findFirst(
                buildFindSelectiveInspirationEnrichmentArgs(
                  authenticatedUserId,
                  inspirationId,
                ),
              )
              .then((inspiration) => {
                if (!inspiration) {
                  throw new UpdateInspirationNotFoundError();
                }

                return buildManualFieldRecoveryPersistenceOptions(
                  inspiration,
                  input,
                  completedAt,
                );
              });
          })();
    const { shareSlug, updatedInspiration } =
      await updateInspirationWithResolvedShareSlug(
        dependencies,
        authenticatedUserId,
        inspirationId,
        input,
        manualRecoveryOptions === undefined
          ? undefined
          : await manualRecoveryOptions,
      );
    const previousClusterId = previousClusterAssignment?.clusterId ?? null;
    const newClusterId = input.clusterId ?? null;

    if (
      previousClusterId !== null &&
      newClusterId !== null &&
      shouldCreateClusterReassignmentDiscoveryEvent(
        previousClusterId,
        newClusterId,
      )
    ) {
      await createClusterReassignmentDiscoveryEvent(
        dependencies.persistence,
        {
          inspirationId,
          newClusterId,
          previousClusterId,
          userId: authenticatedUserId,
        },
      );
    }

    const queuedJobPayload: SupportedSqsJobPayload | null =
      updatedInspiration.rawContentChanged
        ? {
            jobType: "ai_enrichment",
            inspirationId: updatedInspiration.id,
          }
        : input.reflectionAnswer !== undefined
          ? buildReflectionReembeddingJobPayload(updatedInspiration.id)
          : null;

    if (queuedJobPayload !== null) {
      const scheduler = resolveBackgroundScheduler(dependencies);
      const logger = dependencies.logger ?? console;

      scheduler(async () => {
        try {
          if (queuedJobPayload.jobType === "ai_enrichment") {
            await enqueueInspirationEnrichmentJob({
              inspirationId: updatedInspiration.id,
              userId: authenticatedUserId,
            }, {
              pipelinePersistence:
                dependencies.enrichmentPipeline as unknown as InspirationEnrichmentPipelinePersistenceClient,
              queuePublisher: dependencies.queuePublisher,
            });
          } else {
            await dependencies.queuePublisher.enqueue(queuedJobPayload);
          }
        } catch (error) {
          logger.error(error);
        }
      });
    }

    return createJsonResponse<UpdateInspirationResponseBody>(
      {
        ...buildUpdateInspirationAudioUploadResponseFields(updatedInspiration),
        id: updatedInspiration.id,
        ...(input.isPublic === undefined ? {} : { isPublic: input.isPublic }),
        rawContent: updatedInspiration.rawContent,
        ...(input.isPublic === undefined ? {} : { shareSlug }),
        sourceType: updatedInspiration.sourceType,
      },
      UPDATE_INSPIRATION_ROUTE_OK_STATUS,
    );
  } catch (error) {
    if (isInspirationRouteNotFoundError(error)) {
      return createInspirationRouteNotFoundResponse();
    }

    if (isUpdateInspirationBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        UPDATE_INSPIRATION_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: UPDATE_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      UPDATE_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
