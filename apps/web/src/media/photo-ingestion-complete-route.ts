import type { PhotoAnalysisSqsJobPayload } from "../../../../packages/shared/types.ts";
import {
  createInspirationRouteNotFoundResponse,
  INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  INSPIRATION_ROUTE_NOT_FOUND_STATUS,
  InspirationRouteNotFoundError,
  isInspirationRouteNotFoundError,
} from "../inspirations/not-found-response.ts";
import {
  createCompletePhotoCaptureService,
  type CompletePhotoCaptureInput,
  type CompletePhotoCapturePersistenceClient,
  type CompletePhotoCaptureService,
  type CompletedPhotoCaptureRecord,
} from "./complete-photo-capture.ts";

export const COMPLETE_PHOTO_INGESTION_ROUTE_OK_STATUS = 200;
export const COMPLETE_PHOTO_INGESTION_ROUTE_BAD_REQUEST_STATUS = 400;
export const COMPLETE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_STATUS = 401;
export const COMPLETE_PHOTO_INGESTION_ROUTE_NOT_FOUND_STATUS =
  INSPIRATION_ROUTE_NOT_FOUND_STATUS;
export const COMPLETE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const COMPLETE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_ERROR =
  "Unauthorized";
export const COMPLETE_PHOTO_INGESTION_ROUTE_NOT_FOUND_ERROR =
  INSPIRATION_ROUTE_NOT_FOUND_ERROR;
export const COMPLETE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const COMPLETE_PHOTO_INGESTION_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Photo ingestion completion route dependencies have not been configured.";
export const COMPLETE_PHOTO_INGESTION_REQUEST_BODY_INVALID_ERROR =
  "Request body must be a JSON object.";
export const COMPLETE_PHOTO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR =
  "Request body must be valid JSON.";
export const COMPLETE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR =
  "contentType must be a valid image MIME type.";
export const COMPLETE_PHOTO_INGESTION_FILE_NAME_REQUIRED_ERROR =
  "fileName must be a non-empty string.";
export const COMPLETE_PHOTO_INGESTION_MEDIA_URL_INVALID_ERROR =
  "mediaUrl must be a valid absolute URL.";
export const COMPLETE_PHOTO_INGESTION_OBJECT_KEY_REQUIRED_ERROR =
  "objectKey must be a non-empty string.";
export const COMPLETE_PHOTO_INGESTION_SIZE_BYTES_INVALID_ERROR =
  "sizeBytes must be a positive integer.";
export const COMPLETE_PHOTO_INGESTION_PHOTO_CAPTURE_ID_REQUIRED_ERROR =
  "photoCaptureId must be a non-empty string.";

const COMPLETE_PHOTO_INGESTION_PERSISTED_PHOTO_STORAGE_URL_INVALID_ERROR =
  "Completed photo capture must persist a valid photoStorageUrl before photo analysis is queued.";

type CompletePhotoIngestionBadRequestError = TypeError;

export interface CompletePhotoIngestionRequestBody
  extends CompletePhotoCaptureInput {}

export interface CompletePhotoIngestionResponseBody {
  id: string;
  photoFileName?: string;
  photoMimeType?: string;
  photoSizeBytes?: number;
  photoStorageKey?: string;
  photoStorageUrl?: string;
  photoUploadStatus?: string;
  rawContent: string;
  sourceType: "PHOTO";
}

export interface CompletePhotoIngestionRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface CompletePhotoIngestionAuthorizedPhotoCaptureRecord {
  id: string;
}

export interface CompletePhotoIngestionPhotoCaptureAccessArgs {
  select: {
    id: true;
  };
  where: {
    deletedAt: null;
    id: string;
    sourceType: "PHOTO";
    userId: string;
  };
}

export interface CompletePhotoIngestionPhotoCaptureAccessClient<
  TRecord extends CompletePhotoIngestionAuthorizedPhotoCaptureRecord = CompletePhotoIngestionAuthorizedPhotoCaptureRecord,
> {
  inspiration: {
    findFirst(
      args: CompletePhotoIngestionPhotoCaptureAccessArgs,
    ): Promise<TRecord | null>;
  };
}

export interface CompletePhotoIngestionQueuePublisher {
  enqueue(payload: PhotoAnalysisSqsJobPayload): Promise<void>;
}

export type CompletePhotoIngestionBackgroundScheduler = (
  task: () => Promise<void>,
) => void;

export interface CompletePhotoIngestionRouteDependencies<
  TRecord extends CompletedPhotoCaptureRecord = CompletedPhotoCaptureRecord,
> {
  auth: CompletePhotoIngestionRouteAuthResolver;
  backgroundScheduler?: CompletePhotoIngestionBackgroundScheduler;
  completionService: CompletePhotoCaptureService<TRecord>;
  logger?: Pick<Console, "error">;
  photoCaptureAccess: CompletePhotoIngestionPhotoCaptureAccessClient;
  queuePublisher: CompletePhotoIngestionQueuePublisher;
}

export interface HandleCompletePhotoIngestionRouteRequestOptions<
  TRecord extends CompletedPhotoCaptureRecord = CompletedPhotoCaptureRecord,
> {
  dependencies?: CompletePhotoIngestionRouteDependencies<TRecord>;
}

let defaultCompletePhotoIngestionRouteDependencies:
  | CompletePhotoIngestionRouteDependencies
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

function readImageContentType(value: unknown, errorMessage: string): string {
  if (typeof value !== "string") {
    throw new TypeError(errorMessage);
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!/^image\/[a-z0-9.+-]+$/u.test(normalizedValue)) {
    throw new TypeError(errorMessage);
  }

  return normalizedValue;
}

function stripCompletePhotoIngestionOwnershipFields(
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

function resolveCompletePhotoIngestionRouteDependencies<
  TRecord extends CompletedPhotoCaptureRecord = CompletedPhotoCaptureRecord,
>(
  override?: CompletePhotoIngestionRouteDependencies<TRecord>,
): CompletePhotoIngestionRouteDependencies<TRecord> {
  if (override) {
    return override;
  }

  if (defaultCompletePhotoIngestionRouteDependencies) {
    return defaultCompletePhotoIngestionRouteDependencies as CompletePhotoIngestionRouteDependencies<TRecord>;
  }

  throw new Error(COMPLETE_PHOTO_INGESTION_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isCompletePhotoIngestionBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.message === COMPLETE_PHOTO_INGESTION_REQUEST_BODY_INVALID_ERROR ||
      error.message.startsWith(
        COMPLETE_PHOTO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR,
      ) ||
      error.message === COMPLETE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR ||
      error.message === COMPLETE_PHOTO_INGESTION_FILE_NAME_REQUIRED_ERROR ||
      error.message === COMPLETE_PHOTO_INGESTION_MEDIA_URL_INVALID_ERROR ||
      error.message === COMPLETE_PHOTO_INGESTION_OBJECT_KEY_REQUIRED_ERROR ||
      error.message === COMPLETE_PHOTO_INGESTION_SIZE_BYTES_INVALID_ERROR ||
      error.message ===
        COMPLETE_PHOTO_INGESTION_PHOTO_CAPTURE_ID_REQUIRED_ERROR)
  );
}

function resolveCompletePhotoIngestionBackgroundScheduler(
  dependencies: CompletePhotoIngestionRouteDependencies,
): CompletePhotoIngestionBackgroundScheduler {
  if (dependencies.backgroundScheduler) {
    return dependencies.backgroundScheduler;
  }

  return (task) => {
    void task();
  };
}

function resolveCompletedPhotoCaptureMediaUrl(
  record: CompletedPhotoCaptureRecord,
): string {
  return readRequiredAbsoluteUrl(
    record.photoStorageUrl,
    COMPLETE_PHOTO_INGESTION_PERSISTED_PHOTO_STORAGE_URL_INVALID_ERROR,
  );
}

export function buildCompletePhotoIngestionPhotoAnalysisJobPayload(
  record: CompletedPhotoCaptureRecord,
): PhotoAnalysisSqsJobPayload {
  return {
    inspirationId: readRequiredTrimmedString(
      record.id,
      "Completed photo capture id must be a non-empty string before photo analysis is queued.",
    ),
    jobType: "photo_analysis",
    mediaUrl: resolveCompletedPhotoCaptureMediaUrl(record),
  };
}

function buildCompletePhotoIngestionResponseBody(
  record: CompletedPhotoCaptureRecord,
): CompletePhotoIngestionResponseBody {
  return {
    id: record.id,
    ...(record.photoFileName === null
      ? {}
      : { photoFileName: record.photoFileName }),
    ...(record.photoMimeType === null
      ? {}
      : { photoMimeType: record.photoMimeType }),
    ...(record.photoSizeBytes === null
      ? {}
      : { photoSizeBytes: record.photoSizeBytes }),
    ...(record.photoStorageKey === null
      ? {}
      : { photoStorageKey: record.photoStorageKey }),
    ...(record.photoStorageUrl === null
      ? {}
      : { photoStorageUrl: record.photoStorageUrl }),
    ...(record.photoUploadStatus === null
      ? {}
      : { photoUploadStatus: record.photoUploadStatus }),
    rawContent: record.rawContent,
    sourceType: record.sourceType,
  };
}

export function buildCompletePhotoIngestionPhotoCaptureAccessArgs(
  userId: string,
  photoCaptureId: string,
): CompletePhotoIngestionPhotoCaptureAccessArgs {
  return {
    select: {
      id: true,
    },
    where: {
      deletedAt: null,
      id: readRequiredTrimmedString(
        photoCaptureId,
        COMPLETE_PHOTO_INGESTION_PHOTO_CAPTURE_ID_REQUIRED_ERROR,
      ),
      sourceType: "PHOTO",
      userId: readRequiredTrimmedString(
        userId,
        "Authenticated user id must be a non-empty string.",
      ),
    },
  };
}

export async function assertCompletePhotoIngestionPhotoCaptureAccess<
  TRecord extends CompletePhotoIngestionAuthorizedPhotoCaptureRecord = CompletePhotoIngestionAuthorizedPhotoCaptureRecord,
>(
  client: CompletePhotoIngestionPhotoCaptureAccessClient<TRecord>,
  userId: string,
  photoCaptureId: string,
): Promise<void> {
  const photoCaptureRecord = await client.inspiration.findFirst(
    buildCompletePhotoIngestionPhotoCaptureAccessArgs(userId, photoCaptureId),
  );

  if (photoCaptureRecord === null) {
    throw new InspirationRouteNotFoundError();
  }
}

export function createCompletePhotoIngestionRouteDependencies<
  TRecord extends CompletedPhotoCaptureRecord = CompletedPhotoCaptureRecord,
>(args: {
  auth: CompletePhotoIngestionRouteAuthResolver;
  backgroundScheduler?: CompletePhotoIngestionBackgroundScheduler;
  logger?: Pick<Console, "error">;
  photoCaptureAccess: CompletePhotoIngestionPhotoCaptureAccessClient;
  photoCaptureRepository: CompletePhotoCapturePersistenceClient<TRecord>;
  queuePublisher: CompletePhotoIngestionQueuePublisher;
}): CompletePhotoIngestionRouteDependencies<TRecord> {
  return {
    auth: args.auth,
    ...(args.backgroundScheduler === undefined
      ? {}
      : { backgroundScheduler: args.backgroundScheduler }),
    completionService: createCompletePhotoCaptureService({
      photoCaptureRepository: args.photoCaptureRepository,
    }),
    ...(args.logger === undefined ? {} : { logger: args.logger }),
    photoCaptureAccess: args.photoCaptureAccess,
    queuePublisher: args.queuePublisher,
  };
}

export function configureCompletePhotoIngestionRouteDependencies(
  dependencies: CompletePhotoIngestionRouteDependencies | null,
): void {
  defaultCompletePhotoIngestionRouteDependencies = dependencies;
}

export async function parseCompletePhotoIngestionRequestBody(
  request: Request,
): Promise<CompletePhotoIngestionRequestBody> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    throw new TypeError(
      `${COMPLETE_PHOTO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new TypeError(COMPLETE_PHOTO_INGESTION_REQUEST_BODY_INVALID_ERROR);
  }

  const sanitizedPayload = stripCompletePhotoIngestionOwnershipFields(payload);

  return {
    contentType: readImageContentType(
      sanitizedPayload.contentType,
      COMPLETE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
    ),
    fileName: readRequiredTrimmedString(
      sanitizedPayload.fileName,
      COMPLETE_PHOTO_INGESTION_FILE_NAME_REQUIRED_ERROR,
    ),
    mediaUrl: readRequiredAbsoluteUrl(
      sanitizedPayload.mediaUrl,
      COMPLETE_PHOTO_INGESTION_MEDIA_URL_INVALID_ERROR,
    ),
    objectKey: readRequiredTrimmedString(
      sanitizedPayload.objectKey,
      COMPLETE_PHOTO_INGESTION_OBJECT_KEY_REQUIRED_ERROR,
    ),
    photoCaptureId: readRequiredTrimmedString(
      sanitizedPayload.photoCaptureId,
      COMPLETE_PHOTO_INGESTION_PHOTO_CAPTURE_ID_REQUIRED_ERROR,
    ),
    sizeBytes: readPositiveInteger(
      sanitizedPayload.sizeBytes,
      COMPLETE_PHOTO_INGESTION_SIZE_BYTES_INVALID_ERROR,
    ),
  };
}

export async function handleCompletePhotoIngestionRouteRequest(
  request: Request,
  options: HandleCompletePhotoIngestionRouteRequestOptions = {},
): Promise<Response> {
  let dependencies: CompletePhotoIngestionRouteDependencies;

  try {
    dependencies = resolveCompletePhotoIngestionRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: COMPLETE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR,
      },
      COMPLETE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: COMPLETE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
      },
      COMPLETE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const input = await parseCompletePhotoIngestionRequestBody(request);
    const scheduler =
      resolveCompletePhotoIngestionBackgroundScheduler(dependencies);
    const logger = dependencies.logger ?? console;

    await assertCompletePhotoIngestionPhotoCaptureAccess(
      dependencies.photoCaptureAccess,
      authenticatedUserId,
      input.photoCaptureId,
    );

    const completedCapture = await dependencies.completionService.complete(
      authenticatedUserId,
      input,
    );
    const shouldSchedulePhotoAnalysis =
      dependencies.completionService.didClaimFinalization?.(completedCapture) ??
      true;

    if (shouldSchedulePhotoAnalysis) {
      scheduler(async () => {
        try {
          await dependencies.queuePublisher.enqueue(
            buildCompletePhotoIngestionPhotoAnalysisJobPayload(
              completedCapture,
            ),
          );
        } catch (error) {
          logger.error(error);
        }
      });
    }

    return createJsonResponse(
      buildCompletePhotoIngestionResponseBody(completedCapture),
      COMPLETE_PHOTO_INGESTION_ROUTE_OK_STATUS,
    );
  } catch (error) {
    if (isCompletePhotoIngestionBadRequestError(error)) {
      return createJsonResponse(
        {
          error: (error as CompletePhotoIngestionBadRequestError).message,
        },
        COMPLETE_PHOTO_INGESTION_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    if (isInspirationRouteNotFoundError(error)) {
      return createInspirationRouteNotFoundResponse();
    }

    return createJsonResponse(
      {
        error: COMPLETE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR,
      },
      COMPLETE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
