import type { VoiceTranscriptionSqsJobPayload } from "../../../../packages/shared/types.ts";
import type { InspirationAudioUploadMetadata } from "../inspirations/create-route.ts";
import {
  createInspirationRouteNotFoundResponse,
  INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  INSPIRATION_ROUTE_NOT_FOUND_STATUS,
  isInspirationRouteNotFoundError,
} from "../inspirations/not-found-response.ts";
import {
  assertInitiateAudioIngestionVoiceCaptureAccess,
  type InitiateAudioIngestionVoiceCaptureAccessClient,
} from "./audio-ingestion-init-route.ts";
import {
  createCompleteAudioCaptureService,
  type CompleteAudioCaptureInput,
  type CompleteAudioCapturePersistenceClient,
  type CompleteAudioCaptureService,
  type CompletedAudioCaptureRecord,
} from "./complete-audio-capture.ts";
import { normalizeAudioUploadContentType } from "./audio-upload-config.ts";

export const COMPLETE_AUDIO_INGESTION_ROUTE_OK_STATUS = 200;
export const COMPLETE_AUDIO_INGESTION_ROUTE_BAD_REQUEST_STATUS = 400;
export const COMPLETE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_STATUS = 401;
export const COMPLETE_AUDIO_INGESTION_ROUTE_NOT_FOUND_STATUS =
  INSPIRATION_ROUTE_NOT_FOUND_STATUS;
export const COMPLETE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const COMPLETE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_ERROR =
  "Unauthorized";
export const COMPLETE_AUDIO_INGESTION_ROUTE_NOT_FOUND_ERROR =
  INSPIRATION_ROUTE_NOT_FOUND_ERROR;
export const COMPLETE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const COMPLETE_AUDIO_INGESTION_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Audio ingestion completion route dependencies have not been configured.";
export const COMPLETE_AUDIO_INGESTION_REQUEST_BODY_INVALID_ERROR =
  "Request body must be a JSON object.";
export const COMPLETE_AUDIO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR =
  "Request body must be valid JSON.";
export const COMPLETE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR =
  "contentType must be a supported audio MIME type.";
export const COMPLETE_AUDIO_INGESTION_MEDIA_URL_INVALID_ERROR =
  "mediaUrl must be a valid absolute URL.";
export const COMPLETE_AUDIO_INGESTION_OBJECT_KEY_REQUIRED_ERROR =
  "objectKey must be a non-empty string.";
export const COMPLETE_AUDIO_INGESTION_SIZE_BYTES_INVALID_ERROR =
  "sizeBytes must be a positive integer.";
export const COMPLETE_AUDIO_INGESTION_DURATION_SECONDS_INVALID_ERROR =
  "durationSeconds must be a non-negative number.";
export const COMPLETE_AUDIO_INGESTION_VOICE_CAPTURE_ID_REQUIRED_ERROR =
  "voiceCaptureId must be a non-empty string.";
const COMPLETE_AUDIO_INGESTION_PERSISTED_AUDIO_STORAGE_KEY_INVALID_ERROR =
  "Completed audio capture must persist a non-empty audioStorageKey before transcription is queued.";
const COMPLETE_AUDIO_INGESTION_PERSISTED_AUDIO_STORAGE_URL_INVALID_ERROR =
  "Completed audio capture must persist a valid audioStorageUrl before transcription is queued.";

type CompleteAudioIngestionBadRequestError = TypeError;

export interface CompleteAudioIngestionRequestBody
  extends CompleteAudioCaptureInput {}

export interface CompleteAudioIngestionResponseBody
  extends InspirationAudioUploadMetadata {
  id: string;
  rawContent: string;
  sourceType: "VOICE_NOTE";
}

export interface CompleteAudioIngestionRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface CompleteAudioIngestionQueuePublisher {
  enqueue(payload: VoiceTranscriptionSqsJobPayload): Promise<void>;
}

export type CompleteAudioIngestionBackgroundScheduler = (
  task: () => Promise<void>,
) => void;

export interface CompleteAudioIngestionRouteDependencies<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
> {
  auth: CompleteAudioIngestionRouteAuthResolver;
  backgroundScheduler?: CompleteAudioIngestionBackgroundScheduler;
  completionService: CompleteAudioCaptureService<TRecord>;
  logger?: Pick<Console, "error">;
  queuePublisher: CompleteAudioIngestionQueuePublisher;
  voiceCaptureAccess: InitiateAudioIngestionVoiceCaptureAccessClient;
}

export interface HandleCompleteAudioIngestionRouteRequestOptions<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
> {
  dependencies?: CompleteAudioIngestionRouteDependencies<TRecord>;
}

let defaultCompleteAudioIngestionRouteDependencies:
  | CompleteAudioIngestionRouteDependencies
  | null = null;

function createJsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, {
    status,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredTrimmedString(
  value: unknown,
  errorMessage: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(errorMessage);
  }

  return value.trim();
}

function readRequiredAbsoluteUrl(
  value: unknown,
  errorMessage: string,
): string {
  const normalizedValue = readRequiredTrimmedString(value, errorMessage);

  try {
    return new URL(normalizedValue).toString();
  } catch {
    throw new TypeError(errorMessage);
  }
}

function readPositiveInteger(value: unknown, errorMessage: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new TypeError(errorMessage);
  }

  return value as number;
}

function readNonNegativeNumber(value: unknown, errorMessage: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(errorMessage);
  }

  return value;
}

function stripCompleteAudioIngestionOwnershipFields(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const {
    ownerId: _ownerId,
    tenantId: _tenantId,
    userId: _userId,
    workspaceId: _workspaceId,
    ...sanitizedPayload
  } = payload;

  return sanitizedPayload;
}

function resolveCompleteAudioIngestionRouteDependencies<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
>(
  override?: CompleteAudioIngestionRouteDependencies<TRecord>,
): CompleteAudioIngestionRouteDependencies<TRecord> {
  if (override) {
    return override;
  }

  if (defaultCompleteAudioIngestionRouteDependencies) {
    return defaultCompleteAudioIngestionRouteDependencies as CompleteAudioIngestionRouteDependencies<TRecord>;
  }

  throw new Error(COMPLETE_AUDIO_INGESTION_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isCompleteAudioIngestionBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.message === COMPLETE_AUDIO_INGESTION_REQUEST_BODY_INVALID_ERROR ||
      error.message.startsWith(
        COMPLETE_AUDIO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR,
      ) ||
      error.message === COMPLETE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR ||
      error.message === COMPLETE_AUDIO_INGESTION_MEDIA_URL_INVALID_ERROR ||
      error.message === COMPLETE_AUDIO_INGESTION_OBJECT_KEY_REQUIRED_ERROR ||
      error.message === COMPLETE_AUDIO_INGESTION_SIZE_BYTES_INVALID_ERROR ||
      error.message === COMPLETE_AUDIO_INGESTION_DURATION_SECONDS_INVALID_ERROR ||
      error.message ===
        COMPLETE_AUDIO_INGESTION_VOICE_CAPTURE_ID_REQUIRED_ERROR)
  );
}

function resolveCompleteAudioIngestionBackgroundScheduler(
  dependencies: CompleteAudioIngestionRouteDependencies,
): CompleteAudioIngestionBackgroundScheduler {
  if (dependencies.backgroundScheduler) {
    return dependencies.backgroundScheduler;
  }

  return (task) => {
    void task();
  };
}

function resolveCompletedAudioCaptureObjectReference(
  record: CompletedAudioCaptureRecord,
): VoiceTranscriptionSqsJobPayload["audio"] {
  return {
    mediaUrl: readRequiredAbsoluteUrl(
      record.audioStorageUrl,
      COMPLETE_AUDIO_INGESTION_PERSISTED_AUDIO_STORAGE_URL_INVALID_ERROR,
    ),
    storageKey: readRequiredTrimmedString(
      record.audioStorageKey,
      COMPLETE_AUDIO_INGESTION_PERSISTED_AUDIO_STORAGE_KEY_INVALID_ERROR,
    ),
  };
}

export function buildCompleteAudioIngestionVoiceTranscriptionJobPayload(
  record: CompletedAudioCaptureRecord,
): VoiceTranscriptionSqsJobPayload {
  const objectReference = resolveCompletedAudioCaptureObjectReference(record);

  return {
    jobType: "voice_transcription",
    inspirationId: readRequiredTrimmedString(
      record.id,
      "Completed audio capture id must be a non-empty string before transcription is queued.",
    ),
    audio: objectReference,
  };
}

function buildCompleteAudioIngestionResponseBody(
  record: CompletedAudioCaptureRecord,
): CompleteAudioIngestionResponseBody {
  return {
    id: record.id,
    rawContent: record.rawContent,
    sourceType: record.sourceType,
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

export function createCompleteAudioIngestionRouteDependencies<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
>(args: {
  auth: CompleteAudioIngestionRouteAuthResolver;
  backgroundScheduler?: CompleteAudioIngestionBackgroundScheduler;
  logger?: Pick<Console, "error">;
  queuePublisher: CompleteAudioIngestionQueuePublisher;
  voiceCaptureAccess: InitiateAudioIngestionVoiceCaptureAccessClient;
  voiceCaptureRepository: CompleteAudioCapturePersistenceClient<TRecord>;
}): CompleteAudioIngestionRouteDependencies<TRecord> {
  return {
    auth: args.auth,
    ...(args.backgroundScheduler === undefined
      ? {}
      : { backgroundScheduler: args.backgroundScheduler }),
    completionService: createCompleteAudioCaptureService({
      voiceCaptureRepository: args.voiceCaptureRepository,
    }),
    ...(args.logger === undefined ? {} : { logger: args.logger }),
    queuePublisher: args.queuePublisher,
    voiceCaptureAccess: args.voiceCaptureAccess,
  };
}

export function configureCompleteAudioIngestionRouteDependencies(
  dependencies: CompleteAudioIngestionRouteDependencies | null,
): void {
  defaultCompleteAudioIngestionRouteDependencies = dependencies;
}

export async function parseCompleteAudioIngestionRequestBody(
  request: Request,
): Promise<CompleteAudioIngestionRequestBody> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    throw new TypeError(
      `${COMPLETE_AUDIO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new TypeError(COMPLETE_AUDIO_INGESTION_REQUEST_BODY_INVALID_ERROR);
  }

  const sanitizedPayload =
    stripCompleteAudioIngestionOwnershipFields(payload);

  return {
    contentType: (() => {
      try {
        return normalizeAudioUploadContentType(
          readRequiredTrimmedString(
            sanitizedPayload.contentType,
            COMPLETE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
          ),
        );
      } catch {
        throw new TypeError(COMPLETE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR);
      }
    })(),
    durationSeconds: readNonNegativeNumber(
      sanitizedPayload.durationSeconds,
      COMPLETE_AUDIO_INGESTION_DURATION_SECONDS_INVALID_ERROR,
    ),
    mediaUrl: readRequiredAbsoluteUrl(
      sanitizedPayload.mediaUrl,
      COMPLETE_AUDIO_INGESTION_MEDIA_URL_INVALID_ERROR,
    ),
    objectKey: readRequiredTrimmedString(
      sanitizedPayload.objectKey,
      COMPLETE_AUDIO_INGESTION_OBJECT_KEY_REQUIRED_ERROR,
    ),
    sizeBytes: readPositiveInteger(
      sanitizedPayload.sizeBytes,
      COMPLETE_AUDIO_INGESTION_SIZE_BYTES_INVALID_ERROR,
    ),
    voiceCaptureId: readRequiredTrimmedString(
      sanitizedPayload.voiceCaptureId,
      COMPLETE_AUDIO_INGESTION_VOICE_CAPTURE_ID_REQUIRED_ERROR,
    ),
  };
}

export async function handleCompleteAudioIngestionRouteRequest(
  request: Request,
  options: HandleCompleteAudioIngestionRouteRequestOptions = {},
): Promise<Response> {
  let dependencies: CompleteAudioIngestionRouteDependencies;

  try {
    dependencies = resolveCompleteAudioIngestionRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: COMPLETE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR,
      },
      COMPLETE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: COMPLETE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
      },
      COMPLETE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const input = await parseCompleteAudioIngestionRequestBody(request);
    const scheduler =
      resolveCompleteAudioIngestionBackgroundScheduler(dependencies);
    const logger = dependencies.logger ?? console;

    await assertInitiateAudioIngestionVoiceCaptureAccess(
      dependencies.voiceCaptureAccess,
      authenticatedUserId,
      input.voiceCaptureId,
    );

    const completedCapture = await dependencies.completionService.complete(
      authenticatedUserId,
      input,
    );
    const shouldScheduleTranscription =
      dependencies.completionService.didClaimFinalization?.(completedCapture) ??
      true;

    if (shouldScheduleTranscription) {
      scheduler(async () => {
        try {
          await dependencies.queuePublisher.enqueue(
            buildCompleteAudioIngestionVoiceTranscriptionJobPayload(
              completedCapture,
            ),
          );
          await dependencies.completionService.markTranscriptionProcessing?.(
            authenticatedUserId,
            completedCapture.id,
          );
        } catch (error) {
          logger.error(error);
        }
      });
    }

    return createJsonResponse(
      buildCompleteAudioIngestionResponseBody(completedCapture),
      COMPLETE_AUDIO_INGESTION_ROUTE_OK_STATUS,
    );
  } catch (error) {
    if (isCompleteAudioIngestionBadRequestError(error)) {
      return createJsonResponse(
        {
          error: (error as CompleteAudioIngestionBadRequestError).message,
        },
        COMPLETE_AUDIO_INGESTION_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    if (isInspirationRouteNotFoundError(error)) {
      return createInspirationRouteNotFoundResponse();
    }

    return createJsonResponse(
      {
        error: COMPLETE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR,
      },
      COMPLETE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
