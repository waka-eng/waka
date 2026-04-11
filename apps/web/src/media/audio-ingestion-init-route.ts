import {
  normalizeAudioUploadContentType,
  validateAudioUploadFormat,
} from "./audio-upload-config.ts";
import {
  createInspirationRouteNotFoundResponse,
  InspirationRouteNotFoundError,
  INSPIRATION_ROUTE_NOT_FOUND_ERROR,
  INSPIRATION_ROUTE_NOT_FOUND_STATUS,
  isInspirationRouteNotFoundError,
} from "../inspirations/not-found-response.ts";

export const INITIATE_AUDIO_INGESTION_ROUTE_CREATED_STATUS = 201;
export const INITIATE_AUDIO_INGESTION_ROUTE_BAD_REQUEST_STATUS = 400;
export const INITIATE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_STATUS = 401;
export const INITIATE_AUDIO_INGESTION_ROUTE_NOT_FOUND_STATUS =
  INSPIRATION_ROUTE_NOT_FOUND_STATUS;
export const INITIATE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const INITIATE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_ERROR =
  "Unauthorized";
export const INITIATE_AUDIO_INGESTION_ROUTE_NOT_FOUND_ERROR =
  INSPIRATION_ROUTE_NOT_FOUND_ERROR;
export const INITIATE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const INITIATE_AUDIO_INGESTION_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Audio ingestion initiation route dependencies have not been configured.";
export const INITIATE_AUDIO_INGESTION_REQUEST_BODY_INVALID_ERROR =
  "Request body must be a JSON object.";
export const INITIATE_AUDIO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR =
  "Request body must be valid JSON.";
export const INITIATE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR =
  "contentType must be a supported audio MIME type.";
export const INITIATE_AUDIO_INGESTION_FILE_NAME_INVALID_ERROR =
  "fileName must be a supported audio filename when provided.";
export const INITIATE_AUDIO_INGESTION_VOICE_CAPTURE_ID_REQUIRED_ERROR =
  "voiceCaptureId must be a non-empty string.";

const INITIATE_AUDIO_INGESTION_RESPONSE_MEDIA_URL_INVALID_ERROR =
  "mediaUrl must be a valid absolute URL.";
const INITIATE_AUDIO_INGESTION_RESPONSE_BODY_INVALID_ERROR =
  "Audio ingestion upload setup response must be a JSON object.";
const INITIATE_AUDIO_INGESTION_RESPONSE_OBJECT_KEY_INVALID_ERROR =
  "objectKey must be a non-empty string.";
const INITIATE_AUDIO_INGESTION_RESPONSE_UPLOAD_INVALID_ERROR =
  "upload must be a JSON object.";
const INITIATE_AUDIO_INGESTION_RESPONSE_UPLOAD_METHOD_INVALID_ERROR =
  'upload.method must be "PUT".';
const INITIATE_AUDIO_INGESTION_RESPONSE_UPLOAD_URL_INVALID_ERROR =
  "upload.url must be a valid absolute URL.";
const INITIATE_AUDIO_INGESTION_RESPONSE_UPLOAD_HEADERS_INVALID_ERROR =
  "upload.headers must be a JSON object containing only string values.";

class InitiateAudioIngestionBadRequestError extends TypeError {}

export interface InitiateAudioIngestionRequestBody {
  contentType: string;
  fileName?: string;
  voiceCaptureId: string;
}

export interface InitiateAudioIngestionUploadSetup {
  headers: Record<string, string>;
  method: "PUT";
  url: string;
}

export interface InitiateAudioIngestionResponseBody {
  mediaUrl: string;
  objectKey: string;
  upload: InitiateAudioIngestionUploadSetup;
}

export interface InitiateAudioIngestionUploadSetupInput
  extends InitiateAudioIngestionRequestBody {
  userId: string;
}

export interface InitiateAudioIngestionRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface InitiateAudioIngestionAuthorizedVoiceCaptureRecord {
  id: unknown;
}

export interface InitiateAudioIngestionVoiceCaptureAccessArgs {
  select: {
    id: true;
  };
  where: {
    deletedAt: null;
    id: string;
    sourceType: "VOICE_NOTE";
    userId: string;
  };
}

export interface InitiateAudioIngestionVoiceCaptureAccessClient<
  TRecord extends InitiateAudioIngestionAuthorizedVoiceCaptureRecord = InitiateAudioIngestionAuthorizedVoiceCaptureRecord,
> {
  inspiration: {
    findFirst(
      args: InitiateAudioIngestionVoiceCaptureAccessArgs,
    ): Promise<TRecord | null>;
  };
}

export interface AudioIngestionUploadSetupGenerator {
  generateUploadSetup(
    input: InitiateAudioIngestionUploadSetupInput,
  ): Promise<unknown>;
}

export interface InitiateAudioIngestionRouteDependencies<
  TRecord extends InitiateAudioIngestionAuthorizedVoiceCaptureRecord = InitiateAudioIngestionAuthorizedVoiceCaptureRecord,
> {
  auth: InitiateAudioIngestionRouteAuthResolver;
  uploadSetupGenerator: AudioIngestionUploadSetupGenerator;
  voiceCaptureAccess: InitiateAudioIngestionVoiceCaptureAccessClient<TRecord>;
}

export interface HandleInitiateAudioIngestionRouteRequestOptions<
  TRecord extends InitiateAudioIngestionAuthorizedVoiceCaptureRecord = InitiateAudioIngestionAuthorizedVoiceCaptureRecord,
> {
  dependencies?: InitiateAudioIngestionRouteDependencies<TRecord>;
}

let defaultInitiateAudioIngestionRouteDependencies:
  | InitiateAudioIngestionRouteDependencies
  | null = null;

function createJsonResponse<TBody>(body: TBody, status: number): Response {
  return Response.json(body, {
    status,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredNonEmptyStringValue(
  value: unknown,
  errorMessage: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(errorMessage);
  }

  return value.trim();
}

function readRequiredAbsoluteUrl(value: unknown, errorMessage: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(errorMessage);
  }

  const normalizedValue = value.trim();

  try {
    return new URL(normalizedValue).toString();
  } catch {
    throw new TypeError(errorMessage);
  }
}

function readOptionalFileName(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new InitiateAudioIngestionBadRequestError(
      INITIATE_AUDIO_INGESTION_FILE_NAME_INVALID_ERROR,
    );
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function readAudioContentType(
  value: unknown,
  fileName?: string,
): string {
  if (typeof value !== "string") {
    throw new InitiateAudioIngestionBadRequestError(
      INITIATE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
    );
  }

  try {
    const normalizedContentType = normalizeAudioUploadContentType(value);
    validateAudioUploadFormat(normalizedContentType, fileName);

    return normalizedContentType;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.toLowerCase().includes("filename")
    ) {
      throw new InitiateAudioIngestionBadRequestError(
        INITIATE_AUDIO_INGESTION_FILE_NAME_INVALID_ERROR,
      );
    }

    throw new InitiateAudioIngestionBadRequestError(
      INITIATE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
    );
  }
}

function readUploadHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    throw new TypeError(
      INITIATE_AUDIO_INGESTION_RESPONSE_UPLOAD_HEADERS_INVALID_ERROR,
    );
  }

  const normalizedHeaders: Record<string, string> = {};

  for (const [key, headerValue] of Object.entries(value)) {
    if (key.trim().length === 0 || typeof headerValue !== "string") {
      throw new TypeError(
        INITIATE_AUDIO_INGESTION_RESPONSE_UPLOAD_HEADERS_INVALID_ERROR,
      );
    }

    normalizedHeaders[key] = headerValue;
  }

  return normalizedHeaders;
}

function normalizeUploadSetup(
  value: unknown,
): InitiateAudioIngestionUploadSetup {
  if (!isRecord(value)) {
    throw new TypeError(INITIATE_AUDIO_INGESTION_RESPONSE_UPLOAD_INVALID_ERROR);
  }

  if (value.method !== "PUT") {
    throw new TypeError(
      INITIATE_AUDIO_INGESTION_RESPONSE_UPLOAD_METHOD_INVALID_ERROR,
    );
  }

  return {
    headers: readUploadHeaders(value.headers),
    method: "PUT",
    url: readRequiredAbsoluteUrl(
      value.url,
      INITIATE_AUDIO_INGESTION_RESPONSE_UPLOAD_URL_INVALID_ERROR,
    ),
  };
}

function normalizeInitiateAudioIngestionResponseBody(
  value: unknown,
): InitiateAudioIngestionResponseBody {
  if (!isRecord(value)) {
    throw new TypeError(INITIATE_AUDIO_INGESTION_RESPONSE_BODY_INVALID_ERROR);
  }

  return {
    mediaUrl: readRequiredAbsoluteUrl(
      value.mediaUrl,
      INITIATE_AUDIO_INGESTION_RESPONSE_MEDIA_URL_INVALID_ERROR,
    ),
    objectKey: readRequiredNonEmptyStringValue(
      value.objectKey,
      INITIATE_AUDIO_INGESTION_RESPONSE_OBJECT_KEY_INVALID_ERROR,
    ),
    upload: normalizeUploadSetup(value.upload),
  };
}

function stripInitiateAudioIngestionOwnershipFields(
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

function resolveInitiateAudioIngestionRouteDependencies(
  override?: InitiateAudioIngestionRouteDependencies,
): InitiateAudioIngestionRouteDependencies {
  if (override) {
    return override;
  }

  if (defaultInitiateAudioIngestionRouteDependencies) {
    return defaultInitiateAudioIngestionRouteDependencies;
  }

  throw new Error(INITIATE_AUDIO_INGESTION_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isInitiateAudioIngestionBadRequestError(error: unknown): boolean {
  return error instanceof InitiateAudioIngestionBadRequestError;
}

export function buildInitiateAudioIngestionVoiceCaptureAccessArgs(
  userId: string,
  voiceCaptureId: string,
): InitiateAudioIngestionVoiceCaptureAccessArgs {
  return {
    select: {
      id: true,
    },
    where: {
      deletedAt: null,
      id: voiceCaptureId,
      sourceType: "VOICE_NOTE",
      userId,
    },
  };
}

export async function assertInitiateAudioIngestionVoiceCaptureAccess<
  TRecord extends InitiateAudioIngestionAuthorizedVoiceCaptureRecord = InitiateAudioIngestionAuthorizedVoiceCaptureRecord,
>(
  client: InitiateAudioIngestionVoiceCaptureAccessClient<TRecord>,
  userId: string,
  voiceCaptureId: string,
): Promise<void> {
  const voiceCaptureRecord = await client.inspiration.findFirst(
    buildInitiateAudioIngestionVoiceCaptureAccessArgs(userId, voiceCaptureId),
  );

  if (voiceCaptureRecord === null) {
    throw new InspirationRouteNotFoundError();
  }
}

export function configureInitiateAudioIngestionRouteDependencies(
  dependencies: InitiateAudioIngestionRouteDependencies | null,
): void {
  defaultInitiateAudioIngestionRouteDependencies = dependencies;
}

export async function parseInitiateAudioIngestionRequestBody(
  request: Request,
): Promise<InitiateAudioIngestionRequestBody> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    throw new InitiateAudioIngestionBadRequestError(
      `${INITIATE_AUDIO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new InitiateAudioIngestionBadRequestError(
      INITIATE_AUDIO_INGESTION_REQUEST_BODY_INVALID_ERROR,
    );
  }

  const sanitizedPayload = stripInitiateAudioIngestionOwnershipFields(payload);
  const fileName = readOptionalFileName(sanitizedPayload.fileName);

  return {
    contentType: readAudioContentType(sanitizedPayload.contentType, fileName),
    ...(fileName === undefined ? {} : { fileName }),
    voiceCaptureId: readRequiredNonEmptyStringValue(
      sanitizedPayload.voiceCaptureId,
      INITIATE_AUDIO_INGESTION_VOICE_CAPTURE_ID_REQUIRED_ERROR,
    ),
  };
}

export async function handleInitiateAudioIngestionRouteRequest(
  request: Request,
  options: HandleInitiateAudioIngestionRouteRequestOptions = {},
): Promise<Response> {
  let dependencies: InitiateAudioIngestionRouteDependencies;

  try {
    dependencies = resolveInitiateAudioIngestionRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: INITIATE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR,
      },
      INITIATE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: INITIATE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
      },
      INITIATE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const input = await parseInitiateAudioIngestionRequestBody(request);
    await assertInitiateAudioIngestionVoiceCaptureAccess(
      dependencies.voiceCaptureAccess,
      authenticatedUserId,
      input.voiceCaptureId,
    );
    const uploadSetup =
      await dependencies.uploadSetupGenerator.generateUploadSetup({
        ...input,
        userId: authenticatedUserId,
      });

    return createJsonResponse<InitiateAudioIngestionResponseBody>(
      normalizeInitiateAudioIngestionResponseBody(uploadSetup),
      INITIATE_AUDIO_INGESTION_ROUTE_CREATED_STATUS,
    );
  } catch (error) {
    if (isInitiateAudioIngestionBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        INITIATE_AUDIO_INGESTION_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    if (isInspirationRouteNotFoundError(error)) {
      return createInspirationRouteNotFoundResponse();
    }

    return createJsonResponse(
      {
        error: INITIATE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR,
      },
      INITIATE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
