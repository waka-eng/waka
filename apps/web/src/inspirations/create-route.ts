import type { AiEnrichmentSqsJobPayload } from "../../../../packages/shared/types.ts";
import {
  buildAiConversationSourceReference,
  createCanonicalAiConversationImport,
  type CanonicalAiConversationSourceMeta,
} from "../import/ai-conversation.ts";
import type { HistoricalAiConversationParticipantIdentityResolver } from "../import/ai-conversation-participant-identity.ts";
import {
  buildInitialInspirationEnrichmentPersistenceData,
  enqueueInspirationEnrichmentJob,
  type InitialInspirationEnrichmentPersistenceData,
  type InspirationEnrichmentPipelinePersistenceClient,
} from "./enrichment-pipeline.ts";
import { normalizeUrlDetectedCapture } from "./url-detection.ts";

export const CREATE_INSPIRATION_ROUTE_CREATED_STATUS = 201;
export const CREATE_INSPIRATION_ROUTE_BAD_REQUEST_STATUS = 400;
export const CREATE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS = 401;
export const CREATE_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const CREATE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const CREATE_INSPIRATION_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const CREATE_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Create inspiration route dependencies have not been configured.";
export const CREATE_INSPIRATION_REQUEST_BODY_INVALID_ERROR =
  "Request body must be a JSON object.";
export const CREATE_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR =
  "Request body must be valid JSON.";
export const CREATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR =
  "rawContent must be at least 1 character.";
export const CREATE_INSPIRATION_SOURCE_TYPE_INVALID_ERROR =
  "sourceType must be one of: CLI_CONVERSATION, VOICE_NOTE, TEXT_NOTE, URL_IMPORT, PHOTO, AI_CONVERSATION.";
export const CREATE_INSPIRATION_SOURCE_URL_INVALID_ERROR =
  "sourceUrl must be a valid absolute URL.";
export const CREATE_INSPIRATION_MEDIA_URL_INVALID_ERROR =
  "mediaUrl must be a valid absolute URL.";
export const CREATE_INSPIRATION_AUDIO_STORAGE_URL_INVALID_ERROR =
  "audioStorageUrl must be a valid absolute URL.";
export const CREATE_INSPIRATION_AUDIO_SIZE_BYTES_INVALID_ERROR =
  "audioSizeBytes must be a non-negative integer when provided.";
export const CREATE_INSPIRATION_AUDIO_DURATION_SECONDS_INVALID_ERROR =
  "audioDurationSeconds must be a non-negative number when provided.";
export const CREATE_INSPIRATION_AI_CONVERSATION_SOURCE_META_REQUIRED_ERROR =
  "AI_CONVERSATION sourceMeta is required.";
export const CREATE_INSPIRATION_AI_CONVERSATION_PROVIDER_REQUIRED_ERROR =
  "AI_CONVERSATION sourceMeta.provider is required.";
export const CREATE_INSPIRATION_AI_CONVERSATION_PROVIDER_INVALID_ERROR =
  "AI_CONVERSATION sourceMeta.provider must be one of: claude, chatgpt, gemini, other.";
export const CREATE_INSPIRATION_AI_CONVERSATION_CONVERSATION_TITLE_INVALID_ERROR =
  "AI_CONVERSATION sourceMeta.conversationTitle must be a non-empty string when provided.";
export const CREATE_INSPIRATION_AI_CONVERSATION_CONVERSATION_URL_INVALID_ERROR =
  "AI_CONVERSATION sourceMeta.conversationUrl must be a valid absolute URL when provided.";
export const CREATE_INSPIRATION_AI_CONVERSATION_CONVERSATION_URL_MISMATCH_ERROR =
  "AI_CONVERSATION sourceMeta.conversationUrl must match sourceUrl when both are provided.";
export const CREATE_INSPIRATION_AI_CONVERSATION_TURN_COUNT_INVALID_ERROR =
  "AI_CONVERSATION sourceMeta.turnCount must be a positive integer when provided.";
export const CREATE_INSPIRATION_AI_CONVERSATION_MODEL_INVALID_ERROR =
  "AI_CONVERSATION sourceMeta.model must be a non-empty string when provided.";
export const CREATE_INSPIRATION_AI_CONVERSATION_SHARE_LINK_PROVIDER_UNSUPPORTED_ERROR =
  "AI_CONVERSATION share links are only supported for providers: claude, chatgpt, gemini.";
export const CREATE_INSPIRATION_AI_CONVERSATION_SHARE_LINK_INVALID_ERROR =
  "AI_CONVERSATION sourceUrl must be a supported provider share URL.";

export const SUPPORTED_INSPIRATION_SOURCE_TYPES = [
  "CLI_CONVERSATION",
  "VOICE_NOTE",
  "TEXT_NOTE",
  "URL_IMPORT",
  "PHOTO",
  "AI_CONVERSATION",
] as const;

export const SUPPORTED_AI_CONVERSATION_PROVIDERS = [
  "claude",
  "chatgpt",
  "gemini",
  "other",
] as const;

export const SUPPORTED_AI_CONVERSATION_IMPORT_SOURCE_TYPES = [
  "transcript",
  "share_link",
] as const;

export type InspirationSourceType =
  (typeof SUPPORTED_INSPIRATION_SOURCE_TYPES)[number];
export type AiConversationProvider =
  (typeof SUPPORTED_AI_CONVERSATION_PROVIDERS)[number];
export type AiConversationImportSourceType =
  (typeof SUPPORTED_AI_CONVERSATION_IMPORT_SOURCE_TYPES)[number];

export interface CreateInspirationRequestBody {
  audioDurationSeconds?: number;
  audioMimeType?: string;
  audioSizeBytes?: number;
  audioStorageKey?: string;
  audioStorageUrl?: string;
  clusterId?: string;
  mediaUrl?: string;
  parentId?: string;
  rawContent: string;
  sourceConversationRef?: string;
  sourceParentId?: string;
  sourceMeta?: Record<string, unknown>;
  sourceType: InspirationSourceType;
  sourceUrl?: string;
  title?: string;
  transcript?: string;
}

export interface InspirationAudioUploadMetadata {
  audioDurationSeconds?: number;
  audioMimeType?: string;
  audioSizeBytes?: number;
  audioStorageKey?: string;
  audioStorageUrl?: string;
}

export interface CreateInspirationResponseBody
  extends InspirationAudioUploadMetadata {
  id: string;
  processingState: CreateInspirationProcessingState;
  rawContent: string;
  sourceType: InspirationSourceType;
}

export interface CreateInspirationProcessingState {
  fields: InitialInspirationEnrichmentPersistenceData["enrichmentFields"];
  status: InitialInspirationEnrichmentPersistenceData["enrichmentStatus"];
}

export interface CreatedInspirationRecord {
  audioDurationSeconds?: number;
  audioMimeType?: string;
  audioSizeBytes?: number;
  audioStorageKey?: string;
  audioStorageUrl?: string;
  id: string;
  rawContent: string;
  sourceType: InspirationSourceType;
}

export interface CreateInspirationPersistenceData
  extends InitialInspirationEnrichmentPersistenceData {
  audioDurationSeconds?: number;
  audioMimeType?: string;
  audioSizeBytes?: number;
  audioStorageKey?: string;
  audioStorageUrl?: string;
  audioTranscriptionStatus?: string;
  clusterId?: string;
  mediaUrl?: string;
  originalMediaUrl?: string;
  originalRawContent: string;
  originalSourceMeta?: Record<string, unknown>;
  originalSourceUrl?: string;
  originalTitle?: string;
  originalTranscript?: string;
  parentId?: string;
  rawContent: string;
  reflectionStatus?: "NOT_NEEDED";
  sourceParentId?: string;
  sourceMeta?: Record<string, unknown>;
  sourceType: InspirationSourceType;
  sourceUrl?: string;
  tags: string[];
  title?: string;
  transcript?: string;
  userId: string;
}

export interface CreateInspirationPersistenceArgs {
  data: CreateInspirationPersistenceData;
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
}

export interface CreateInspirationPersistenceClient<
  TRecord extends CreatedInspirationRecord = CreatedInspirationRecord,
> {
  inspiration: {
    create(args: CreateInspirationPersistenceArgs): Promise<TRecord>;
  };
}

export interface CreateInspirationRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface CreateInspirationQueuePublisher {
  enqueue(payload: AiEnrichmentSqsJobPayload): Promise<void>;
}

export type CreateInspirationBackgroundScheduler = (
  task: () => Promise<void>,
) => void;

export interface CreateInspirationRouteDependencies<
  TRecord extends CreatedInspirationRecord = CreatedInspirationRecord,
> {
  auth: CreateInspirationRouteAuthResolver;
  backgroundScheduler?: CreateInspirationBackgroundScheduler;
  enrichmentPipeline: InspirationEnrichmentPipelinePersistenceClient;
  logger?: Pick<Console, "error">;
  participantIdentityResolver?: HistoricalAiConversationParticipantIdentityResolver;
  persistence: CreateInspirationPersistenceClient<TRecord>;
  queuePublisher: CreateInspirationQueuePublisher;
}

export interface HandleCreateInspirationRouteRequestOptions<
  TRecord extends CreatedInspirationRecord = CreatedInspirationRecord,
> {
  dependencies?: CreateInspirationRouteDependencies<TRecord>;
}

let defaultCreateInspirationRouteDependencies:
  | CreateInspirationRouteDependencies
  | null = null;

function createJsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, {
    status,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripCreateOwnershipFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const {
    userId: _userId,
    tenantId: _tenantId,
    workspaceId: _workspaceId,
    sourceParentId: _sourceParentId,
    ...sanitizedPayload
  } = payload;

  return sanitizedPayload;
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function readRequiredRawContent(value: unknown): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new TypeError(CREATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR);
  }

  return value;
}

function readAbsoluteUrl(
  value: unknown,
  errorMessage: string,
): string | undefined {
  const normalizedValue = readOptionalTrimmedString(value);

  if (normalizedValue === undefined) {
    return undefined;
  }

  try {
    return new URL(normalizedValue).toString();
  } catch {
    throw new TypeError(errorMessage);
  }
}

function readSourceType(value: unknown): InspirationSourceType {
  if (
    typeof value !== "string" ||
    !SUPPORTED_INSPIRATION_SOURCE_TYPES.includes(
      value as InspirationSourceType,
    )
  ) {
    throw new TypeError(CREATE_INSPIRATION_SOURCE_TYPE_INVALID_ERROR);
  }

  return value as InspirationSourceType;
}

function readOptionalSourceMeta(
  value: unknown,
): Record<string, unknown> | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new TypeError("sourceMeta must be a JSON object when provided.");
  }

  return value;
}

function readRequiredTrimmedString(
  value: unknown,
  errorMessage: string,
): string {
  if (typeof value !== "string") {
    throw new TypeError(errorMessage);
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(errorMessage);
  }

  return normalizedValue;
}

function readOptionalStrictTrimmedString(
  value: unknown,
  errorMessage: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return readRequiredTrimmedString(value, errorMessage);
}

function readOptionalStrictAbsoluteUrl(
  value: unknown,
  errorMessage: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalizedValue = readRequiredTrimmedString(value, errorMessage);

  try {
    return new URL(normalizedValue).toString();
  } catch {
    throw new TypeError(errorMessage);
  }
}

function readOptionalNonNegativeInteger(
  value: unknown,
  errorMessage: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Number.isInteger(value) || Number(value) < 0) {
    throw new TypeError(errorMessage);
  }

  return Number(value);
}

function readOptionalPositiveInteger(
  value: unknown,
  errorMessage: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new TypeError(errorMessage);
  }

  return Number(value);
}

function readOptionalNonNegativeNumber(
  value: unknown,
  errorMessage: string,
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(errorMessage);
  }

  return value;
}

function readSourceMetaString(
  sourceMeta: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = sourceMeta?.[key];

  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readSourceMetaNonNegativeInteger(
  sourceMeta: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = sourceMeta?.[key];

  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function readSourceMetaNonNegativeNumber(
  sourceMeta: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = sourceMeta?.[key];

  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function readAiConversationProvider(value: unknown): AiConversationProvider {
  if (value === undefined || value === null) {
    throw new TypeError(
      CREATE_INSPIRATION_AI_CONVERSATION_PROVIDER_REQUIRED_ERROR,
    );
  }

  const normalizedValue = readRequiredTrimmedString(
    value,
    CREATE_INSPIRATION_AI_CONVERSATION_PROVIDER_REQUIRED_ERROR,
  ).toLowerCase();

  if (
    !SUPPORTED_AI_CONVERSATION_PROVIDERS.includes(
      normalizedValue as AiConversationProvider,
    )
  ) {
    throw new TypeError(
      CREATE_INSPIRATION_AI_CONVERSATION_PROVIDER_INVALID_ERROR,
    );
  }

  return normalizedValue as AiConversationProvider;
}

function resolveAiConversationImportSourceType(
  sourceUrl: string | undefined,
): AiConversationImportSourceType {
  return sourceUrl === undefined ? "transcript" : "share_link";
}

function isSupportedAiConversationShareUrl(
  provider: Exclude<AiConversationProvider, "other">,
  sourceUrl: string,
): boolean {
  const normalizedHost = new URL(sourceUrl).hostname.toLowerCase();
  const supportedHosts = {
    claude: ["claude.ai", "www.claude.ai"],
    chatgpt: ["chat.openai.com", "chatgpt.com", "www.chatgpt.com"],
    gemini: ["gemini.google.com"],
  } satisfies Record<
    Exclude<AiConversationProvider, "other">,
    readonly string[]
  >;

  return supportedHosts[provider].includes(normalizedHost);
}

function normalizeAiConversationCapture(
  input: Pick<CreateInspirationRequestBody, "sourceMeta" | "sourceUrl">,
): Pick<CreateInspirationRequestBody, "sourceMeta" | "sourceUrl"> {
  if (input.sourceMeta === undefined) {
    throw new TypeError(
      CREATE_INSPIRATION_AI_CONVERSATION_SOURCE_META_REQUIRED_ERROR,
    );
  }

  const provider = readAiConversationProvider(input.sourceMeta.provider);
  const conversationTitle = readOptionalStrictTrimmedString(
    input.sourceMeta.conversationTitle,
    CREATE_INSPIRATION_AI_CONVERSATION_CONVERSATION_TITLE_INVALID_ERROR,
  );
  const conversationUrl = readOptionalStrictAbsoluteUrl(
    input.sourceMeta.conversationUrl,
    CREATE_INSPIRATION_AI_CONVERSATION_CONVERSATION_URL_INVALID_ERROR,
  );
  const turnCount = readOptionalPositiveInteger(
    input.sourceMeta.turnCount,
    CREATE_INSPIRATION_AI_CONVERSATION_TURN_COUNT_INVALID_ERROR,
  );
  const model = readOptionalStrictTrimmedString(
    input.sourceMeta.model,
    CREATE_INSPIRATION_AI_CONVERSATION_MODEL_INVALID_ERROR,
  );
  const normalizedSourceUrl = input.sourceUrl ?? conversationUrl;

  if (
    input.sourceUrl !== undefined &&
    conversationUrl !== undefined &&
    input.sourceUrl !== conversationUrl
  ) {
    throw new TypeError(
      CREATE_INSPIRATION_AI_CONVERSATION_CONVERSATION_URL_MISMATCH_ERROR,
    );
  }

  if (resolveAiConversationImportSourceType(normalizedSourceUrl) === "share_link") {
    if (provider === "other") {
      throw new TypeError(
        CREATE_INSPIRATION_AI_CONVERSATION_SHARE_LINK_PROVIDER_UNSUPPORTED_ERROR,
      );
    }

    if (!isSupportedAiConversationShareUrl(provider, normalizedSourceUrl!)) {
      throw new TypeError(
        CREATE_INSPIRATION_AI_CONVERSATION_SHARE_LINK_INVALID_ERROR,
      );
    }
  }

  return {
    sourceMeta: {
      ...input.sourceMeta,
      provider,
      ...(conversationTitle === undefined ? {} : { conversationTitle }),
      ...(normalizedSourceUrl === undefined
        ? {}
        : { conversationUrl: normalizedSourceUrl }),
      ...(turnCount === undefined ? {} : { turnCount }),
      ...(model === undefined ? {} : { model }),
    },
    ...(normalizedSourceUrl === undefined ? {} : { sourceUrl: normalizedSourceUrl }),
  };
}

function resolvePersistedMediaUrl(
  input: Pick<CreateInspirationRequestBody, "audioStorageUrl" | "mediaUrl">,
): string | undefined {
  return input.mediaUrl ?? input.audioStorageUrl;
}

function buildCreateInspirationAudioUploadResponseFields(
  record: CreatedInspirationRecord,
): InspirationAudioUploadMetadata {
  return {
    ...(record.audioStorageKey === undefined
      ? {}
      : { audioStorageKey: record.audioStorageKey }),
    ...(record.audioStorageUrl === undefined
      ? {}
      : { audioStorageUrl: record.audioStorageUrl }),
    ...(record.audioMimeType === undefined
      ? {}
      : { audioMimeType: record.audioMimeType }),
    ...(record.audioSizeBytes === undefined
      ? {}
      : { audioSizeBytes: record.audioSizeBytes }),
    ...(record.audioDurationSeconds === undefined
      ? {}
      : { audioDurationSeconds: record.audioDurationSeconds }),
  };
}

function resolveVoiceCaptureTranscriptionStatus(
  input: Pick<
    CreateInspirationRequestBody,
    "audioStorageUrl" | "mediaUrl" | "sourceType" | "transcript"
  >,
): string | undefined {
  if (input.sourceType !== "VOICE_NOTE") {
    return undefined;
  }

  if (input.transcript !== undefined) {
    return "COMPLETED";
  }

  if (resolvePersistedMediaUrl(input) !== undefined) {
    return "PENDING";
  }

  return undefined;
}

function resolvePersistedTranscript(
  input: Pick<
    CreateInspirationRequestBody,
    "rawContent" | "sourceType" | "sourceUrl" | "transcript"
  >,
): string | undefined {
  if (input.transcript !== undefined) {
    return input.transcript;
  }

  if (
    input.sourceType === "AI_CONVERSATION" &&
    input.rawContent !== input.sourceUrl
  ) {
    return input.rawContent;
  }

  return undefined;
}

function resolvePersistedAiConversationSourceReference(
  input: Pick<
    CreateInspirationRequestBody,
    "sourceMeta" | "sourceType" | "sourceUrl"
  >,
): string | undefined {
  if (input.sourceType !== "AI_CONVERSATION" || input.sourceMeta === undefined) {
    return undefined;
  }

  return buildAiConversationSourceReference(
    input.sourceMeta as CanonicalAiConversationSourceMeta,
    input.sourceUrl,
  );
}

export function buildCreateInspirationPersistenceArgs(
  userId: string,
  input: CreateInspirationRequestBody,
): CreateInspirationPersistenceArgs {
  const persistedMediaUrl = resolvePersistedMediaUrl(input);
  const audioStorageUrl = input.audioStorageUrl ?? input.mediaUrl;
  const audioMimeType =
    input.audioMimeType ?? readSourceMetaString(input.sourceMeta, "mimeType");
  const audioSizeBytes =
    input.audioSizeBytes ?? readSourceMetaNonNegativeInteger(input.sourceMeta, "sizeBytes");
  const audioDurationSeconds =
    input.audioDurationSeconds ??
    readSourceMetaNonNegativeNumber(input.sourceMeta, "durationSeconds");
  const audioTranscriptionStatus =
    resolveVoiceCaptureTranscriptionStatus(input);
  const persistedTranscript = resolvePersistedTranscript(input);
  const sourceConversationRef =
    resolvePersistedAiConversationSourceReference(input);
  const persistedSourceMeta =
    input.sourceMeta === undefined
      ? undefined
      : sourceConversationRef === undefined
        ? input.sourceMeta
        : {
            ...input.sourceMeta,
            sourceConversationRef,
          };

  return {
    data: {
      userId,
      originalRawContent: input.rawContent,
      rawContent: input.rawContent,
      sourceType: input.sourceType,
      tags: [],
      ...buildInitialInspirationEnrichmentPersistenceData(),
      ...(input.sourceType === "URL_IMPORT"
        ? { reflectionStatus: "NOT_NEEDED" as const }
        : {}),
      ...(input.title === undefined ? {} : { originalTitle: input.title }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.sourceUrl === undefined
        ? {}
        : { originalSourceUrl: input.sourceUrl }),
      ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
      ...(persistedSourceMeta === undefined
        ? {}
        : { originalSourceMeta: persistedSourceMeta }),
      ...(persistedSourceMeta === undefined
        ? {}
        : { sourceMeta: persistedSourceMeta }),
      ...(sourceConversationRef === undefined ? {} : { sourceConversationRef }),
      ...(persistedMediaUrl === undefined
        ? {}
        : { originalMediaUrl: persistedMediaUrl }),
      ...(persistedMediaUrl === undefined ? {} : { mediaUrl: persistedMediaUrl }),
      ...(input.audioStorageKey === undefined
        ? {}
        : { audioStorageKey: input.audioStorageKey }),
      ...(audioStorageUrl === undefined
        ? {}
        : { audioStorageUrl }),
      ...(audioMimeType === undefined ? {} : { audioMimeType }),
      ...(audioSizeBytes === undefined ? {} : { audioSizeBytes }),
      ...(audioDurationSeconds === undefined ? {} : { audioDurationSeconds }),
      ...(audioTranscriptionStatus === undefined
        ? {}
        : { audioTranscriptionStatus }),
      ...(persistedTranscript === undefined
        ? {}
        : { originalTranscript: persistedTranscript }),
      ...(persistedTranscript === undefined
        ? {}
        : { transcript: persistedTranscript }),
      ...(input.parentId === undefined ? {} : { parentId: input.parentId }),
      ...(input.sourceParentId === undefined
        ? {}
        : { sourceParentId: input.sourceParentId }),
      ...(input.clusterId === undefined ? {} : { clusterId: input.clusterId }),
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
  };
}

export function buildCreateInspirationProcessingState(): CreateInspirationProcessingState {
  const initialEnrichmentState =
    buildInitialInspirationEnrichmentPersistenceData();

  return {
    fields: initialEnrichmentState.enrichmentFields,
    status: initialEnrichmentState.enrichmentStatus,
  };
}

function resolveBackgroundScheduler(
  dependencies: CreateInspirationRouteDependencies,
): CreateInspirationBackgroundScheduler {
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

function resolveCreateInspirationRouteDependencies<
  TRecord extends CreatedInspirationRecord = CreatedInspirationRecord,
>(
  override?: CreateInspirationRouteDependencies<TRecord>,
): CreateInspirationRouteDependencies<TRecord> {
  if (override) {
    return override;
  }

  if (defaultCreateInspirationRouteDependencies) {
    return defaultCreateInspirationRouteDependencies as CreateInspirationRouteDependencies<TRecord>;
  }

  throw new Error(CREATE_INSPIRATION_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isCreateInspirationBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.message === CREATE_INSPIRATION_REQUEST_BODY_INVALID_ERROR ||
      error.message.startsWith(
        CREATE_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR,
      ) ||
      error.message === CREATE_INSPIRATION_RAW_CONTENT_REQUIRED_ERROR ||
      error.message === CREATE_INSPIRATION_SOURCE_TYPE_INVALID_ERROR ||
      error.message === CREATE_INSPIRATION_SOURCE_URL_INVALID_ERROR ||
      error.message === CREATE_INSPIRATION_MEDIA_URL_INVALID_ERROR ||
      error.message === CREATE_INSPIRATION_AUDIO_STORAGE_URL_INVALID_ERROR ||
      error.message === CREATE_INSPIRATION_AUDIO_SIZE_BYTES_INVALID_ERROR ||
      error.message === CREATE_INSPIRATION_AUDIO_DURATION_SECONDS_INVALID_ERROR ||
      error.message ===
        CREATE_INSPIRATION_AI_CONVERSATION_SOURCE_META_REQUIRED_ERROR ||
      error.message ===
        CREATE_INSPIRATION_AI_CONVERSATION_PROVIDER_REQUIRED_ERROR ||
      error.message ===
        CREATE_INSPIRATION_AI_CONVERSATION_PROVIDER_INVALID_ERROR ||
      error.message ===
        CREATE_INSPIRATION_AI_CONVERSATION_CONVERSATION_TITLE_INVALID_ERROR ||
      error.message ===
        CREATE_INSPIRATION_AI_CONVERSATION_CONVERSATION_URL_INVALID_ERROR ||
      error.message ===
        CREATE_INSPIRATION_AI_CONVERSATION_CONVERSATION_URL_MISMATCH_ERROR ||
      error.message ===
        CREATE_INSPIRATION_AI_CONVERSATION_TURN_COUNT_INVALID_ERROR ||
      error.message === CREATE_INSPIRATION_AI_CONVERSATION_MODEL_INVALID_ERROR ||
      error.message ===
        CREATE_INSPIRATION_AI_CONVERSATION_SHARE_LINK_PROVIDER_UNSUPPORTED_ERROR ||
      error.message ===
        CREATE_INSPIRATION_AI_CONVERSATION_SHARE_LINK_INVALID_ERROR ||
      error.message === "sourceMeta must be a JSON object when provided.")
  );
}

export function configureCreateInspirationRouteDependencies(
  dependencies: CreateInspirationRouteDependencies | null,
): void {
  defaultCreateInspirationRouteDependencies = dependencies;
}

export async function parseCreateInspirationRequestBody(
  request: Request,
): Promise<CreateInspirationRequestBody> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    throw new TypeError(
      `${CREATE_INSPIRATION_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new TypeError(CREATE_INSPIRATION_REQUEST_BODY_INVALID_ERROR);
  }

  const sanitizedPayload = stripCreateOwnershipFields(payload);
  const requestedSourceType = readSourceType(sanitizedPayload.sourceType);
  const normalizedRawContent = readRequiredRawContent(sanitizedPayload.rawContent);
  const title = readOptionalTrimmedString(sanitizedPayload.title);
  const requestedSourceUrl = readAbsoluteUrl(
    sanitizedPayload.sourceUrl,
    CREATE_INSPIRATION_SOURCE_URL_INVALID_ERROR,
  );
  const sourceMeta = readOptionalSourceMeta(sanitizedPayload.sourceMeta);
  const mediaUrl = readAbsoluteUrl(
    sanitizedPayload.mediaUrl,
    CREATE_INSPIRATION_MEDIA_URL_INVALID_ERROR,
  );
  const audioStorageKey = readOptionalTrimmedString(
    sanitizedPayload.audioStorageKey,
  );
  const audioStorageUrl = readAbsoluteUrl(
    sanitizedPayload.audioStorageUrl,
    CREATE_INSPIRATION_AUDIO_STORAGE_URL_INVALID_ERROR,
  );
  const audioMimeType = readOptionalTrimmedString(
    sanitizedPayload.audioMimeType,
  );
  const audioSizeBytes = readOptionalNonNegativeInteger(
    sanitizedPayload.audioSizeBytes,
    CREATE_INSPIRATION_AUDIO_SIZE_BYTES_INVALID_ERROR,
  );
  const audioDurationSeconds = readOptionalNonNegativeNumber(
    sanitizedPayload.audioDurationSeconds,
    CREATE_INSPIRATION_AUDIO_DURATION_SECONDS_INVALID_ERROR,
  );
  const transcript = readOptionalTrimmedString(sanitizedPayload.transcript);
  const parentId = readOptionalTrimmedString(sanitizedPayload.parentId);
  const clusterId = readOptionalTrimmedString(sanitizedPayload.clusterId);
  const normalizedAiConversationCapture =
    requestedSourceType === "AI_CONVERSATION"
      ? normalizeAiConversationCapture({
          ...(sourceMeta === undefined ? {} : { sourceMeta }),
          ...(requestedSourceUrl === undefined
            ? {}
            : { sourceUrl: requestedSourceUrl }),
        })
      : null;
  const normalizedSourceUrl =
    normalizedAiConversationCapture?.sourceUrl ?? requestedSourceUrl;
  const normalizedCapture =
    requestedSourceType === "TEXT_NOTE" || requestedSourceType === "URL_IMPORT"
      ? normalizeUrlDetectedCapture({
          rawContent: normalizedRawContent,
          sourceType: requestedSourceType,
          ...(normalizedSourceUrl === undefined
            ? {}
            : { sourceUrl: normalizedSourceUrl }),
        })
      : {
          rawContent: normalizedRawContent,
          sourceType: requestedSourceType,
          ...(normalizedSourceUrl === undefined
            ? {}
            : { sourceUrl: normalizedSourceUrl }),
        };

  if (requestedSourceType === "AI_CONVERSATION") {
    const canonicalAiConversationImport = createCanonicalAiConversationImport({
      rawContent: normalizedCapture.rawContent,
      ...(normalizedCapture.sourceUrl === undefined
        ? {}
        : { sourceUrl: normalizedCapture.sourceUrl }),
      sourceMeta:
        normalizedAiConversationCapture?.sourceMeta as CanonicalAiConversationSourceMeta,
    });

    return {
      ...canonicalAiConversationImport,
      ...(title === undefined ? {} : { title }),
      ...(mediaUrl === undefined ? {} : { mediaUrl }),
      ...(audioStorageKey === undefined ? {} : { audioStorageKey }),
      ...(audioStorageUrl === undefined ? {} : { audioStorageUrl }),
      ...(audioMimeType === undefined ? {} : { audioMimeType }),
      ...(audioSizeBytes === undefined ? {} : { audioSizeBytes }),
      ...(audioDurationSeconds === undefined ? {} : { audioDurationSeconds }),
      ...(transcript === undefined ? {} : { transcript }),
      ...(parentId === undefined ? {} : { parentId }),
      ...(clusterId === undefined ? {} : { clusterId }),
    };
  }

  return {
    rawContent: normalizedCapture.rawContent,
    sourceType: normalizedCapture.sourceType,
    ...(title === undefined ? {} : { title }),
    ...(normalizedCapture.sourceUrl === undefined
      ? {}
      : { sourceUrl: normalizedCapture.sourceUrl }),
    ...(normalizedAiConversationCapture?.sourceMeta === undefined
      ? sourceMeta === undefined
        ? {}
        : { sourceMeta }
      : { sourceMeta: normalizedAiConversationCapture.sourceMeta }),
    ...(mediaUrl === undefined ? {} : { mediaUrl }),
    ...(audioStorageKey === undefined ? {} : { audioStorageKey }),
    ...(audioStorageUrl === undefined ? {} : { audioStorageUrl }),
    ...(audioMimeType === undefined ? {} : { audioMimeType }),
    ...(audioSizeBytes === undefined ? {} : { audioSizeBytes }),
    ...(audioDurationSeconds === undefined ? {} : { audioDurationSeconds }),
    ...(transcript === undefined ? {} : { transcript }),
    ...(parentId === undefined ? {} : { parentId }),
    ...(clusterId === undefined ? {} : { clusterId }),
  };
}

export async function handleCreateInspirationRouteRequest<
  TRecord extends CreatedInspirationRecord = CreatedInspirationRecord,
>(
  request: Request,
  options: HandleCreateInspirationRouteRequestOptions<TRecord> = {},
): Promise<Response> {
  let dependencies: CreateInspirationRouteDependencies<TRecord>;

  try {
    dependencies = resolveCreateInspirationRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: CREATE_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      CREATE_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: CREATE_INSPIRATION_ROUTE_UNAUTHORIZED_ERROR,
      },
      CREATE_INSPIRATION_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const parsedInput = await parseCreateInspirationRequestBody(request);
    const input =
      parsedInput.sourceType === "AI_CONVERSATION" &&
      dependencies.participantIdentityResolver &&
      parsedInput.sourceMeta
        ? {
            ...parsedInput,
            sourceMeta: await dependencies.participantIdentityResolver.resolve({
              sourceMeta:
                parsedInput.sourceMeta as CanonicalAiConversationSourceMeta,
              userId: authenticatedUserId,
            }),
          }
        : parsedInput;
    const createdInspiration = await dependencies.persistence.inspiration.create(
      buildCreateInspirationPersistenceArgs(authenticatedUserId, input),
    );
    const scheduler = resolveBackgroundScheduler(dependencies);
    const logger = dependencies.logger ?? console;

    scheduler(async () => {
      try {
        await enqueueInspirationEnrichmentJob({
          inspirationId: createdInspiration.id,
          userId: authenticatedUserId,
        }, {
          pipelinePersistence: dependencies.enrichmentPipeline,
          queuePublisher: dependencies.queuePublisher,
        });
      } catch (error) {
        logger.error(error);
      }
    });

    return createJsonResponse<CreateInspirationResponseBody>(
      {
        ...buildCreateInspirationAudioUploadResponseFields(createdInspiration),
        id: createdInspiration.id,
        processingState: buildCreateInspirationProcessingState(),
        rawContent: createdInspiration.rawContent,
        sourceType: createdInspiration.sourceType,
      },
      CREATE_INSPIRATION_ROUTE_CREATED_STATUS,
    );
  } catch (error) {
    if (isCreateInspirationBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        CREATE_INSPIRATION_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: CREATE_INSPIRATION_ROUTE_INTERNAL_ERROR,
      },
      CREATE_INSPIRATION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
