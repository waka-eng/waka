import {
  SUPPORTED_INSPIRATION_SOURCE_TYPES,
  type InspirationAudioUploadMetadata,
  type InspirationSourceType,
} from "./create-route.ts";
import {
  INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
  type InspirationEnrichmentFieldMetadata,
  type InspirationEnrichmentFieldStatus,
  normalizeInspirationEnrichmentFields,
  type InspirationEnrichmentFields,
} from "./enrichment-field-metadata.ts";
import {
  INSPIRATION_ENRICHMENT_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_STATUS_FAILED,
  INSPIRATION_ENRICHMENT_STATUS_PENDING,
  INSPIRATION_ENRICHMENT_STATUS_PROCESSING,
} from "./enrichment-pipeline.ts";
import {
  createInspirationRouteNotFoundResponse,
  InspirationRouteNotFoundError,
  INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  INSPIRATION_ROUTE_NOT_FOUND_STATUS,
} from "./not-found-response.ts";

export const READ_INSPIRATION_ROUTE_OK_STATUS = 200;
export const READ_INSPIRATION_ROUTE_BAD_REQUEST_STATUS = 400;
export const READ_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS = 401;
export const READ_INSPIRATION_ROUTE_NOT_FOUND_STATUS =
  INSPIRATION_ROUTE_NOT_FOUND_STATUS;
export const READ_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const READ_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const READ_INSPIRATION_ROUTE_NOT_FOUND_ERROR =
  INSPIRATION_ROUTE_NOT_FOUND_ERROR;
export const READ_INSPIRATION_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const READ_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Read inspiration route dependencies have not been configured.";
export const READ_INSPIRATION_ID_REQUIRED_ERROR =
  "inspirationId must be a non-empty string.";

export type ReadInspirationProcessingStatus =
  | typeof INSPIRATION_ENRICHMENT_STATUS_PENDING
  | typeof INSPIRATION_ENRICHMENT_STATUS_PROCESSING
  | typeof INSPIRATION_ENRICHMENT_STATUS_COMPLETED
  | typeof INSPIRATION_ENRICHMENT_STATUS_FAILED;

export interface ReadInspirationProcessingFieldState<
  TValue = string | string[],
> {
  isReady: boolean;
  status: InspirationEnrichmentFieldStatus;
  value?: TValue;
}

export interface ReadInspirationProcessingState {
  fields: {
    actionability: ReadInspirationProcessingFieldState<string>;
    domain: ReadInspirationProcessingFieldState<string>;
    embedding: ReadInspirationProcessingFieldState;
    mood: ReadInspirationProcessingFieldState<string>;
    summary: ReadInspirationProcessingFieldState<string>;
    tags: ReadInspirationProcessingFieldState<string[]>;
    title: ReadInspirationProcessingFieldState<string>;
  };
  status: ReadInspirationProcessingStatus;
}

export interface ReadInspirationPhotoProcessingState {
  fields: {
    generatedDescription: ReadInspirationProcessingFieldState<string>;
    ocrText: ReadInspirationProcessingFieldState<string>;
  };
  status: ReadInspirationProcessingStatus;
}

export type ReadInspirationCaptureProcessingState =
  | ReadInspirationProcessingState
  | ReadInspirationPhotoProcessingState;

export interface ReadInspirationClusterResponseBody {
  description?: string;
  id: string;
  label: string;
}

export type ReadInspirationReflectionStatus =
  | "PENDING"
  | "PROMPTED"
  | "ANSWERED"
  | "SKIPPED"
  | "NOT_NEEDED";

export interface ReadInspirationResponseBody
  extends InspirationAudioUploadMetadata {
  actionability?: string;
  cluster?: ReadInspirationClusterResponseBody;
  domain?: string;
  generatedDescription?: string;
  id: string;
  ocrText?: string;
  rawContent: string;
  sourceType: InspirationSourceType;
  sourceParentId?: string;
  expansions?: ReadInspirationExpansionResponseBody[];
  enrichmentFields?: InspirationEnrichmentFields;
  mood?: string;
  processingState?: ReadInspirationCaptureProcessingState;
  reflectionAnswer?: string;
  reflectionPrompt?: string;
  reflectionStatus?: ReadInspirationReflectionStatus;
  summary?: string;
  tags?: string[];
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReadInspirationExpansionResponseBody {
  actionability?: string;
  domain?: string;
  id: string;
  rawContent: string;
  sourceType: InspirationSourceType;
  sourceParentId?: string;
  enrichmentFields?: InspirationEnrichmentFields;
  mood?: string;
  processingState?: ReadInspirationProcessingState;
  summary?: string;
  tags?: string[];
  title?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReadInspirationRecord {
  actionability?: unknown;
  audioDurationSeconds?: unknown;
  audioMimeType?: unknown;
  audioSizeBytes?: unknown;
  audioStorageKey?: unknown;
  audioStorageUrl?: unknown;
  cluster?: unknown;
  createdAt: unknown;
  domain?: unknown;
  enrichmentStatus?: unknown;
  expansions?: unknown;
  generatedDescription?: unknown;
  id: unknown;
  mood?: unknown;
  ocrText?: unknown;
  processingState?: unknown;
  rawContent: unknown;
  reflectionAnswer?: unknown;
  reflectionPrompt?: unknown;
  reflectionStatus?: unknown;
  sourceType: unknown;
  sourceParentId?: unknown;
  enrichmentFields?: unknown;
  tags?: unknown;
  summary?: unknown;
  title?: unknown;
  updatedAt: unknown;
}

export interface ReadInspirationPersistenceArgs {
  select: {
    actionability: true;
    audioDurationSeconds: true;
    audioMimeType: true;
    audioSizeBytes: true;
    audioStorageKey: true;
    audioStorageUrl: true;
    cluster: {
      select: {
        description: true;
        id: true;
        label: true;
      };
    };
    createdAt: true;
    domain: true;
    enrichmentStatus: true;
    expansions: {
      orderBy: Array<{
        createdAt: "asc" | "desc";
      }>;
      select: {
        actionability: true;
        createdAt: true;
        domain: true;
        enrichmentFields: true;
        enrichmentStatus: true;
        id: true;
        mood: true;
        rawContent: true;
        sourceType: true;
        sourceParentId: true;
        summary: true;
        tags: true;
        title: true;
        updatedAt: true;
      };
      where: {
        deletedAt: null;
        userId: string;
      };
    };
    generatedDescription: true;
    enrichmentFields: true;
    id: true;
    mood: true;
    ocrText: true;
    processingState: true;
    rawContent: true;
    reflectionAnswer: true;
    reflectionPrompt: true;
    reflectionStatus: true;
    sourceType: true;
    sourceParentId: true;
    summary: true;
    tags: true;
    title: true;
    updatedAt: true;
  };
  where: {
    deletedAt: null;
    id: string;
    userId: string;
  };
}

export interface ReadInspirationPersistenceClient<
  TRecord extends ReadInspirationRecord = ReadInspirationRecord,
> {
  inspiration: {
    findFirst(args: ReadInspirationPersistenceArgs): Promise<TRecord | null>;
  };
}

export interface ReadInspirationRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface ReadInspirationRouteDependencies<
  TRecord extends ReadInspirationRecord = ReadInspirationRecord,
> {
  auth: ReadInspirationRouteAuthResolver;
  persistence: ReadInspirationPersistenceClient<TRecord>;
}

export interface ReadInspirationRouteParams {
  inspirationId: string;
}

export interface HandleReadInspirationRouteRequestOptions<
  TRecord extends ReadInspirationRecord = ReadInspirationRecord,
> {
  dependencies?: ReadInspirationRouteDependencies<TRecord>;
  params: ReadInspirationRouteParams;
}

let defaultReadInspirationRouteDependencies:
  | ReadInspirationRouteDependencies
  | null = null;

function createJsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, {
    status,
  });
}

function readRequiredTrimmedString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readRequiredRawContent(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new TypeError("Expected an optional string inspiration detail field.");
  }

  return value;
}

function normalizeOptionalAbsoluteUrl(
  value: unknown,
  label: string,
): string | undefined {
  const normalizedValue = normalizeOptionalString(value);

  if (normalizedValue === undefined) {
    return undefined;
  }

  try {
    return new URL(normalizedValue).toString();
  } catch {
    throw new TypeError(`${label} must be a valid absolute URL.`);
  }
}

function normalizeOptionalNonNegativeInteger(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new TypeError(`${label} must be a non-negative integer.`);
  }

  return Number(value);
}

function normalizeOptionalNonNegativeNumber(
  value: unknown,
  label: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative number.`);
  }

  return value;
}

function normalizeOptionalStringArray(
  value: unknown,
  label: string,
): string[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
    throw new TypeError(`${label} must be an array of strings.`);
  }

  return [...value];
}

function normalizeReadInspirationReflectionStatus(
  value: unknown,
  label: string,
): ReadInspirationReflectionStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  switch (value) {
    case "PENDING":
    case "PROMPTED":
    case "ANSWERED":
    case "SKIPPED":
    case "NOT_NEEDED":
      return value as ReadInspirationReflectionStatus;
    default:
      throw new TypeError(`${label} must be a valid reflection status.`);
  }
}

function normalizeSourceType(
  value: unknown,
  inspirationId: string,
): InspirationSourceType {
  if (
    typeof value === "string" &&
    SUPPORTED_INSPIRATION_SOURCE_TYPES.includes(value as InspirationSourceType)
  ) {
    return value as InspirationSourceType;
  }

  throw new TypeError(
    `Inspiration ${inspirationId} returned an invalid sourceType value.`,
  );
}

function normalizeTimestamp(
  value: unknown,
  inspirationId: string,
  fieldName: "createdAt" | "updatedAt",
): string {
  const date =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;

  if (date === null || Number.isNaN(date.getTime())) {
    throw new TypeError(
      `Inspiration ${inspirationId} returned an invalid ${fieldName} value.`,
    );
  }

  return date.toISOString();
}

function normalizeReadInspirationProcessingStatus(
  value: unknown,
  label: string,
): ReadInspirationProcessingStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (
    value === INSPIRATION_ENRICHMENT_STATUS_PENDING ||
    value === INSPIRATION_ENRICHMENT_STATUS_PROCESSING ||
    value === INSPIRATION_ENRICHMENT_STATUS_COMPLETED ||
    value === INSPIRATION_ENRICHMENT_STATUS_FAILED
  ) {
    return value;
  }

  throw new TypeError(`${label} must be a valid enrichment status.`);
}

function deriveReadInspirationProcessingStatus(
  enrichmentFields: InspirationEnrichmentFields,
): ReadInspirationProcessingStatus {
  const fieldStates = Object.values(enrichmentFields);

  if (
    fieldStates.every(
      (field) =>
        field.status === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
    )
  ) {
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

function isReadInspirationFieldReady(
  field: InspirationEnrichmentFieldMetadata,
): boolean {
  return field.status === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED;
}

function buildReadInspirationProcessingFieldState<TValue extends string>(
  field: InspirationEnrichmentFieldMetadata,
  value?: TValue,
): ReadInspirationProcessingFieldState<TValue> {
  const isReady = isReadInspirationFieldReady(field);

  return {
    isReady,
    status: field.status,
    ...(value === undefined ? {} : { value }),
  };
}

function buildReadInspirationProcessingArrayFieldState(
  field: InspirationEnrichmentFieldMetadata,
  value?: string[],
): ReadInspirationProcessingFieldState<string[]> {
  const isReady = isReadInspirationFieldReady(field);
  const shouldIncludeValue =
    value !== undefined && (isReady || value.length > 0);

  return {
    isReady,
    status: field.status,
    ...(shouldIncludeValue ? { value: [...value] } : {}),
  };
}

function normalizeReadInspirationProcessingFieldStatus(
  value: unknown,
  label: string,
): InspirationEnrichmentFieldStatus | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${label} must be an object.`);
  }

  const fieldState = value as {
    status?: unknown;
  };

  switch (fieldState.status) {
    case "PENDING":
    case "PROCESSING":
    case "COMPLETED":
    case "FAILED":
    case "TIMEOUT":
      return fieldState.status;
    default:
      throw new TypeError(`${label} must include a valid field status.`);
  }
}

function buildReadInspirationPhotoProcessingFieldState(
  status: InspirationEnrichmentFieldStatus,
  value?: string,
): ReadInspirationProcessingFieldState<string> {
  const isReady =
    status === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED;

  return {
    isReady,
    status,
    ...(value === undefined ? {} : { value }),
  };
}

function deriveReadPhotoAnalysisProcessingStatus(
  fieldStatuses: readonly InspirationEnrichmentFieldStatus[],
): ReadInspirationProcessingStatus {
  if (
    fieldStatuses.every(
      (status) => status === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
    )
  ) {
    return INSPIRATION_ENRICHMENT_STATUS_COMPLETED;
  }

  if (
    fieldStatuses.some(
      (status) => status === INSPIRATION_ENRICHMENT_FIELD_STATUS_PROCESSING,
    )
  ) {
    return INSPIRATION_ENRICHMENT_STATUS_PROCESSING;
  }

  if (
    fieldStatuses.some(
      (status) => status === INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING,
    )
  ) {
    return INSPIRATION_ENRICHMENT_STATUS_PENDING;
  }

  return INSPIRATION_ENRICHMENT_STATUS_FAILED;
}

interface NormalizedReadInspirationAiValues {
  actionability?: string;
  domain?: string;
  mood?: string;
  summary?: string;
  tags?: string[];
  title?: string;
}

interface NormalizedReadInspirationPhotoValues {
  generatedDescription?: string;
  ocrText?: string;
}

interface NormalizedReadInspirationReflectionValues {
  reflectionAnswer?: string;
  reflectionPrompt?: string;
  reflectionStatus?: ReadInspirationReflectionStatus;
}

function normalizeReadInspirationAiValues(
  record: ReadInspirationRecord,
  labelPrefix: string,
): NormalizedReadInspirationAiValues {
  const actionability = normalizeOptionalString(record.actionability);
  const domain = normalizeOptionalString(record.domain);
  const mood = normalizeOptionalString(record.mood);
  const summary = normalizeOptionalString(record.summary);
  const tags = normalizeOptionalStringArray(record.tags, `${labelPrefix} tags`);
  const title = normalizeOptionalString(record.title);

  return {
    ...(actionability === undefined ? {} : { actionability }),
    ...(domain === undefined ? {} : { domain }),
    ...(mood === undefined ? {} : { mood }),
    ...(summary === undefined ? {} : { summary }),
    ...(tags === undefined ? {} : { tags }),
    ...(title === undefined ? {} : { title }),
  };
}

function normalizeReadInspirationPhotoValues(
  record: ReadInspirationRecord,
): NormalizedReadInspirationPhotoValues {
  const generatedDescription = normalizeOptionalString(
    record.generatedDescription,
  );
  const ocrText = normalizeOptionalString(record.ocrText);

  return {
    ...(generatedDescription === undefined ? {} : { generatedDescription }),
    ...(ocrText === undefined ? {} : { ocrText }),
  };
}

function normalizeReadInspirationReflectionValues(
  record: ReadInspirationRecord,
  labelPrefix: string,
): NormalizedReadInspirationReflectionValues {
  const reflectionAnswer = normalizeOptionalString(record.reflectionAnswer);
  const reflectionPrompt = normalizeOptionalString(record.reflectionPrompt);
  const reflectionStatus = normalizeReadInspirationReflectionStatus(
    record.reflectionStatus,
    `${labelPrefix} reflectionStatus`,
  );

  return {
    ...(reflectionAnswer === undefined ? {} : { reflectionAnswer }),
    ...(reflectionPrompt === undefined ? {} : { reflectionPrompt }),
    ...(reflectionStatus === undefined ? {} : { reflectionStatus }),
  };
}

function buildReadInspirationPhotoProcessingState(
  processingStateValue: unknown,
  values: NormalizedReadInspirationPhotoValues,
  labelPrefix: string,
): ReadInspirationPhotoProcessingState | undefined {
  const stateRecord =
    typeof processingStateValue === "object" &&
    processingStateValue !== null &&
    !Array.isArray(processingStateValue)
      ? (processingStateValue as {
          fields?: unknown;
          status?: unknown;
        })
      : undefined;
  const fieldRecord =
    stateRecord !== undefined &&
    typeof stateRecord.fields === "object" &&
    stateRecord.fields !== null &&
    !Array.isArray(stateRecord.fields)
      ? (stateRecord.fields as {
          generatedDescription?: unknown;
          ocrText?: unknown;
        })
      : undefined;

  const generatedDescriptionStatus =
    normalizeReadInspirationProcessingFieldStatus(
      fieldRecord?.generatedDescription,
      `${labelPrefix} processingState.fields.generatedDescription`,
    ) ??
    (values.generatedDescription === undefined
      ? INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING
      : INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED);
  const ocrTextStatus =
    normalizeReadInspirationProcessingFieldStatus(
      fieldRecord?.ocrText,
      `${labelPrefix} processingState.fields.ocrText`,
    ) ??
    (values.ocrText === undefined
      ? INSPIRATION_ENRICHMENT_FIELD_STATUS_PENDING
      : INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED);

  if (
    stateRecord === undefined &&
    values.generatedDescription === undefined &&
    values.ocrText === undefined
  ) {
    return undefined;
  }

  return {
    fields: {
      generatedDescription: buildReadInspirationPhotoProcessingFieldState(
        generatedDescriptionStatus,
        values.generatedDescription,
      ),
      ocrText: buildReadInspirationPhotoProcessingFieldState(
        ocrTextStatus,
        values.ocrText,
      ),
    },
    status:
      normalizeReadInspirationProcessingStatus(
        stateRecord?.status,
        `${labelPrefix} processingState.status`,
      ) ??
      deriveReadPhotoAnalysisProcessingStatus([
        generatedDescriptionStatus,
        ocrTextStatus,
      ]),
  };
}

function normalizeReadInspirationAudioUploadMetadata(
  record: ReadInspirationRecord,
  labelPrefix: string,
): InspirationAudioUploadMetadata {
  const audioStorageKey = normalizeOptionalString(record.audioStorageKey);
  const audioStorageUrl = normalizeOptionalAbsoluteUrl(
    record.audioStorageUrl,
    `${labelPrefix} audioStorageUrl`,
  );
  const audioMimeType = normalizeOptionalString(record.audioMimeType);
  const audioSizeBytes = normalizeOptionalNonNegativeInteger(
    record.audioSizeBytes,
    `${labelPrefix} audioSizeBytes`,
  );
  const audioDurationSeconds = normalizeOptionalNonNegativeNumber(
    record.audioDurationSeconds,
    `${labelPrefix} audioDurationSeconds`,
  );

  return {
    ...(audioStorageKey === undefined ? {} : { audioStorageKey }),
    ...(audioStorageUrl === undefined ? {} : { audioStorageUrl }),
    ...(audioMimeType === undefined ? {} : { audioMimeType }),
    ...(audioSizeBytes === undefined ? {} : { audioSizeBytes }),
    ...(audioDurationSeconds === undefined ? {} : { audioDurationSeconds }),
  };
}

function normalizeReadInspirationCluster(
  value: unknown,
  labelPrefix: string,
): ReadInspirationClusterResponseBody | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "object") {
    throw new TypeError(`${labelPrefix} cluster must be an object.`);
  }

  const clusterRecord = value as {
    description?: unknown;
    id?: unknown;
    label?: unknown;
  };
  const description = normalizeOptionalString(clusterRecord.description);

  return {
    ...(description === undefined ? {} : { description }),
    id: readRequiredTrimmedString(clusterRecord.id, `${labelPrefix} cluster id`),
    label: readRequiredTrimmedString(
      clusterRecord.label,
      `${labelPrefix} cluster label`,
    ),
  };
}

function shouldExposeReadInspirationTags(
  tags: string[] | undefined,
  enrichmentFields: InspirationEnrichmentFields | undefined,
): tags is string[] {
  if (tags === undefined) {
    return false;
  }

  return (
    tags.length > 0 ||
    enrichmentFields?.tags.status === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED
  );
}

function buildReadInspirationProcessingState(
  enrichmentFields: InspirationEnrichmentFields,
  values: NormalizedReadInspirationAiValues,
  status: ReadInspirationProcessingStatus | undefined,
): ReadInspirationProcessingState {
  return {
    fields: {
      actionability: buildReadInspirationProcessingFieldState(
        enrichmentFields.actionability,
        values.actionability,
      ),
      domain: buildReadInspirationProcessingFieldState(
        enrichmentFields.domain,
        values.domain,
      ),
      embedding: buildReadInspirationProcessingFieldState(
        enrichmentFields.embedding,
      ),
      mood: buildReadInspirationProcessingFieldState(
        enrichmentFields.mood,
        values.mood,
      ),
      summary: buildReadInspirationProcessingFieldState(
        enrichmentFields.summary,
        values.summary,
      ),
      tags: buildReadInspirationProcessingArrayFieldState(
        enrichmentFields.tags,
        values.tags,
      ),
      title: buildReadInspirationProcessingFieldState(
        enrichmentFields.title,
        values.title,
      ),
    },
    status: status ?? deriveReadInspirationProcessingStatus(enrichmentFields),
  };
}

function normalizeReadInspirationExpansion(
  value: unknown,
  inspirationId: string,
  expansionIndex: number,
): ReadInspirationExpansionResponseBody {
  const labelPrefix = `Inspiration ${inspirationId} expansion ${expansionIndex}`;

  if (typeof value !== "object" || value === null) {
    throw new TypeError(`${labelPrefix} must be an object.`);
  }

  const record = value as ReadInspirationRecord;
  const normalizedId = readRequiredTrimmedString(record.id, `${labelPrefix} id`);
  const sourceParentId = normalizeOptionalString(record.sourceParentId);
  const enrichmentFields = normalizeInspirationEnrichmentFields(
    record.enrichmentFields,
    `${labelPrefix} enrichmentFields`,
  );
  const aiValues = normalizeReadInspirationAiValues(record, labelPrefix);
  const processingState =
    enrichmentFields === undefined
      ? undefined
      : buildReadInspirationProcessingState(
          enrichmentFields,
          aiValues,
          normalizeReadInspirationProcessingStatus(
            record.enrichmentStatus,
            `${labelPrefix} enrichmentStatus`,
          ),
        );

  return {
    id: normalizedId,
    rawContent: readRequiredRawContent(
      record.rawContent,
      `${labelPrefix} rawContent`,
    ),
    sourceType: normalizeSourceType(record.sourceType, normalizedId),
    ...(sourceParentId === undefined ? {} : { sourceParentId }),
    ...(aiValues.actionability === undefined
      ? {}
      : { actionability: aiValues.actionability }),
    ...(aiValues.domain === undefined ? {} : { domain: aiValues.domain }),
    ...(enrichmentFields === undefined ? {} : { enrichmentFields }),
    ...(aiValues.mood === undefined ? {} : { mood: aiValues.mood }),
    ...(processingState === undefined ? {} : { processingState }),
    ...(aiValues.summary === undefined ? {} : { summary: aiValues.summary }),
    ...(shouldExposeReadInspirationTags(aiValues.tags, enrichmentFields)
      ? { tags: aiValues.tags }
      : {}),
    ...(aiValues.title === undefined ? {} : { title: aiValues.title }),
    createdAt: normalizeTimestamp(record.createdAt, normalizedId, "createdAt"),
    updatedAt: normalizeTimestamp(record.updatedAt, normalizedId, "updatedAt"),
  };
}

function normalizeReadInspirationExpansions(
  value: unknown,
  inspirationId: string,
): ReadInspirationExpansionResponseBody[] | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new TypeError(`Inspiration ${inspirationId} expansions must be an array.`);
  }

  return value.map((expansion, expansionIndex) =>
    normalizeReadInspirationExpansion(
      expansion,
      inspirationId,
      expansionIndex,
    ),
  );
}

function buildReadInspirationExpansionsSelection(
  userId: string,
): ReadInspirationPersistenceArgs["select"]["expansions"] {
  return {
    where: {
      userId,
      deletedAt: null,
    },
    orderBy: [{ createdAt: "desc" }],
    select: {
      actionability: true,
      id: true,
      rawContent: true,
      sourceType: true,
      sourceParentId: true,
      domain: true,
      enrichmentFields: true,
      enrichmentStatus: true,
      mood: true,
      summary: true,
      tags: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  };
}

function resolveReadInspirationRouteDependencies<
  TRecord extends ReadInspirationRecord = ReadInspirationRecord,
>(
  override?: ReadInspirationRouteDependencies<TRecord>,
): ReadInspirationRouteDependencies<TRecord> {
  if (override) {
    return override;
  }

  if (defaultReadInspirationRouteDependencies) {
    return defaultReadInspirationRouteDependencies as ReadInspirationRouteDependencies<TRecord>;
  }

  throw new Error(READ_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isReadInspirationBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message === READ_INSPIRATION_ID_REQUIRED_ERROR
  );
}

export function configureReadInspirationRouteDependencies(
  dependencies: ReadInspirationRouteDependencies | null,
): void {
  defaultReadInspirationRouteDependencies = dependencies;
}

export function buildReadInspirationPersistenceArgs(
  userId: string,
  inspirationId: string,
): ReadInspirationPersistenceArgs {
  const normalizedUserId = readRequiredTrimmedString(userId, "User id");

  return {
    where: {
      id: readRequiredTrimmedString(inspirationId, "inspirationId"),
      userId: normalizedUserId,
      deletedAt: null,
    },
    select: {
      actionability: true,
      audioDurationSeconds: true,
      audioMimeType: true,
      audioSizeBytes: true,
      audioStorageKey: true,
      audioStorageUrl: true,
      cluster: {
        select: {
          description: true,
          id: true,
          label: true,
        },
      },
      generatedDescription: true,
      id: true,
      rawContent: true,
      ocrText: true,
      processingState: true,
      reflectionAnswer: true,
      reflectionPrompt: true,
      reflectionStatus: true,
      sourceType: true,
      sourceParentId: true,
      domain: true,
      expansions: buildReadInspirationExpansionsSelection(normalizedUserId),
      enrichmentFields: true,
      enrichmentStatus: true,
      mood: true,
      summary: true,
      tags: true,
      title: true,
      createdAt: true,
      updatedAt: true,
    },
  };
}

export async function readInspiration<
  TRecord extends ReadInspirationRecord = ReadInspirationRecord,
>(
  client: ReadInspirationPersistenceClient<TRecord>,
  userId: string,
  inspirationId: string,
): Promise<ReadInspirationResponseBody> {
  const record = await client.inspiration.findFirst(
    buildReadInspirationPersistenceArgs(userId, inspirationId),
  );

  if (record === null) {
    throw new InspirationRouteNotFoundError();
  }

  const normalizedId = readRequiredTrimmedString(
    record.id,
    "Inspiration detail id",
  );
  const sourceType = normalizeSourceType(record.sourceType, normalizedId);
  const sourceParentId = normalizeOptionalString(record.sourceParentId);
  const expansions = normalizeReadInspirationExpansions(
    record.expansions,
    normalizedId,
  );
  const enrichmentFields = normalizeInspirationEnrichmentFields(
    record.enrichmentFields,
    `Inspiration ${normalizedId} enrichmentFields`,
  );
  const cluster = normalizeReadInspirationCluster(
    record.cluster,
    `Inspiration ${normalizedId}`,
  );
  const audioUploadMetadata = normalizeReadInspirationAudioUploadMetadata(
    record,
    `Inspiration ${normalizedId}`,
  );
  const aiValues = normalizeReadInspirationAiValues(
    record,
    `Inspiration ${normalizedId}`,
  );
  const reflectionValues = normalizeReadInspirationReflectionValues(
    record,
    `Inspiration ${normalizedId}`,
  );
  const photoValues: NormalizedReadInspirationPhotoValues =
    sourceType === "PHOTO"
      ? normalizeReadInspirationPhotoValues(record)
      : {};
  const processingState =
    sourceType === "PHOTO"
      ? buildReadInspirationPhotoProcessingState(
          record.processingState,
          photoValues,
          `Inspiration ${normalizedId}`,
        )
      : enrichmentFields === undefined
        ? undefined
        : buildReadInspirationProcessingState(
            enrichmentFields,
            aiValues,
            normalizeReadInspirationProcessingStatus(
              record.enrichmentStatus,
              `Inspiration ${normalizedId} enrichmentStatus`,
            ),
          );

  return {
    ...audioUploadMetadata,
    ...(cluster === undefined ? {} : { cluster }),
    id: normalizedId,
    rawContent: readRequiredRawContent(
      record.rawContent,
      `Inspiration ${normalizedId} rawContent`,
    ),
    sourceType,
    ...(sourceParentId === undefined ? {} : { sourceParentId }),
    ...(expansions === undefined || expansions.length === 0 ? {} : { expansions }),
    ...(aiValues.actionability === undefined
      ? {}
      : { actionability: aiValues.actionability }),
    ...(aiValues.domain === undefined ? {} : { domain: aiValues.domain }),
    ...(photoValues.generatedDescription === undefined
      ? {}
      : { generatedDescription: photoValues.generatedDescription }),
    ...(enrichmentFields === undefined ? {} : { enrichmentFields }),
    ...(aiValues.mood === undefined ? {} : { mood: aiValues.mood }),
    ...(photoValues.ocrText === undefined ? {} : { ocrText: photoValues.ocrText }),
    ...(processingState === undefined ? {} : { processingState }),
    ...(reflectionValues.reflectionAnswer === undefined
      ? {}
      : { reflectionAnswer: reflectionValues.reflectionAnswer }),
    ...(reflectionValues.reflectionPrompt === undefined
      ? {}
      : { reflectionPrompt: reflectionValues.reflectionPrompt }),
    ...(reflectionValues.reflectionStatus === undefined
      ? {}
      : { reflectionStatus: reflectionValues.reflectionStatus }),
    ...(aiValues.summary === undefined ? {} : { summary: aiValues.summary }),
    ...(shouldExposeReadInspirationTags(aiValues.tags, enrichmentFields)
      ? { tags: aiValues.tags }
      : {}),
    ...(aiValues.title === undefined ? {} : { title: aiValues.title }),
    createdAt: normalizeTimestamp(
      record.createdAt,
      normalizedId,
      "createdAt",
    ),
    updatedAt: normalizeTimestamp(
      record.updatedAt,
      normalizedId,
      "updatedAt",
    ),
  };
}

export async function handleReadInspirationRouteRequest<
  TRecord extends ReadInspirationRecord = ReadInspirationRecord,
>(
  request: Request,
  options: HandleReadInspirationRouteRequestOptions<TRecord>,
): Promise<Response> {
  let dependencies: ReadInspirationRouteDependencies<TRecord>;

  try {
    dependencies = resolveReadInspirationRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: READ_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      READ_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: READ_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
      },
      READ_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const inspiration = await readInspiration(
      dependencies.persistence,
      authenticatedUserId,
      options.params.inspirationId,
    );

    return createJsonResponse<ReadInspirationResponseBody>(
      inspiration,
      READ_INSPIRATION_ROUTE_OK_STATUS,
    );
  } catch (error) {
    if (error instanceof InspirationRouteNotFoundError) {
      return createInspirationRouteNotFoundResponse();
    }

    if (isReadInspirationBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        READ_INSPIRATION_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: READ_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      READ_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
