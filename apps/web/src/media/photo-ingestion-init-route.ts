export const INITIATE_PHOTO_INGESTION_ROUTE_CREATED_STATUS = 201;
export const INITIATE_PHOTO_INGESTION_ROUTE_BAD_REQUEST_STATUS = 400;
export const INITIATE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_STATUS = 401;
export const INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const INITIATE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_ERROR =
  "Unauthorized";
export const INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const INITIATE_PHOTO_INGESTION_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Photo ingestion initiation route dependencies have not been configured.";
export const INITIATE_PHOTO_INGESTION_REQUEST_BODY_INVALID_ERROR =
  "Request body must be a JSON object.";
export const INITIATE_PHOTO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR =
  "Request body must be valid JSON.";
export const INITIATE_PHOTO_INGESTION_FILE_NAME_REQUIRED_ERROR =
  "fileName must be a non-empty string.";
export const INITIATE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR =
  "contentType must be a valid image MIME type.";
export const INITIATE_PHOTO_INGESTION_SIZE_BYTES_INVALID_ERROR =
  "sizeBytes must be a positive integer.";
export const INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_INVALID_ERROR =
  "existingUpload must be a JSON object.";
export const INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_MEDIA_URL_INVALID_ERROR =
  "existingUpload.mediaUrl must be a valid absolute URL.";
export const INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_OBJECT_KEY_INVALID_ERROR =
  "existingUpload.objectKey must be a non-empty string.";
export const INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_SCOPE_INVALID_ERROR =
  "existingUpload must reference the authenticated user's photo upload.";
export const INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_STORAGE_KEY_INVALID_ERROR =
  "existingUpload.storageKey must be a non-empty string.";
export const INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_STORAGE_KEY_MISMATCH_ERROR =
  "existingUpload.storageKey must match existingUpload.objectKey.";
export const INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_MEDIA_URL_MISMATCH_ERROR =
  "existingUpload.mediaUrl must match the derived APP_URL media path.";

const INITIATE_PHOTO_INGESTION_RESPONSE_MEDIA_URL_INVALID_ERROR =
  "mediaUrl must be a valid absolute URL.";
const INITIATE_PHOTO_INGESTION_RESPONSE_BODY_INVALID_ERROR =
  "Photo ingestion upload setup response must be a JSON object.";
const INITIATE_PHOTO_INGESTION_RESPONSE_OBJECT_KEY_INVALID_ERROR =
  "objectKey must be a non-empty string.";
const INITIATE_PHOTO_INGESTION_RESPONSE_STORAGE_KEY_INVALID_ERROR =
  "storageKey must be a non-empty string.";
const INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_INVALID_ERROR =
  "image must be a JSON object.";
const INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_FILE_NAME_INVALID_ERROR =
  "image.fileName must be a non-empty string.";
const INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_CONTENT_TYPE_INVALID_ERROR =
  "image.contentType must be a valid image MIME type.";
const INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_MEDIA_URL_INVALID_ERROR =
  "image.mediaUrl must be a valid absolute URL.";
const INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_SIZE_BYTES_INVALID_ERROR =
  "image.sizeBytes must be a positive integer.";
const INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_STORAGE_KEY_INVALID_ERROR =
  "image.storageKey must be a non-empty string.";
const INITIATE_PHOTO_INGESTION_RESPONSE_UPLOAD_INVALID_ERROR =
  "upload must be a JSON object.";
const INITIATE_PHOTO_INGESTION_RESPONSE_UPLOAD_METHOD_INVALID_ERROR =
  'upload.method must be "PUT".';
const INITIATE_PHOTO_INGESTION_RESPONSE_UPLOAD_URL_INVALID_ERROR =
  "upload.url must be a valid absolute URL.";
const INITIATE_PHOTO_INGESTION_RESPONSE_UPLOAD_HEADERS_INVALID_ERROR =
  "upload.headers must be a JSON object containing only string values.";
const INITIATE_PHOTO_INGESTION_RESPONSE_UPLOAD_FIELDS_INVALID_ERROR =
  "upload.fields must be a JSON object containing only string values.";

export interface InitiatePhotoIngestionExistingUploadIdentity {
  mediaUrl: string;
  objectKey: string;
  storageKey: string;
}

export interface InitiatePhotoIngestionRequestBody {
  contentType: string;
  existingUpload?: InitiatePhotoIngestionExistingUploadIdentity;
  fileName: string;
  sizeBytes: number;
}

export interface InitiatePhotoIngestionUploadSetup {
  fields: Record<string, string>;
  headers: Record<string, string>;
  method: "PUT";
  url: string;
}

export interface InitiatePhotoIngestionImageObjectMetadata {
  contentType: string;
  fileName: string;
  mediaUrl: string;
  sizeBytes: number;
  storageKey: string;
}

export interface InitiatePhotoIngestionResponseBody {
  image: InitiatePhotoIngestionImageObjectMetadata;
  mediaUrl: string;
  objectKey: string;
  storageKey: string;
  upload: InitiatePhotoIngestionUploadSetup;
}

export interface InitiatePhotoIngestionUploadSetupInput
  extends InitiatePhotoIngestionRequestBody {
  userId: string;
}

export interface InitiatePhotoIngestionRouteAuthResolver {
  resolveAuthenticatedUserId(request: Request): Promise<string | null>;
}

export interface PhotoIngestionUploadSetupGenerator {
  generateUploadSetup(
    input: InitiatePhotoIngestionUploadSetupInput,
  ): Promise<InitiatePhotoIngestionResponseBody>;
}

export interface InitiatePhotoIngestionRouteDependencies {
  auth: InitiatePhotoIngestionRouteAuthResolver;
  uploadSetupGenerator: PhotoIngestionUploadSetupGenerator;
}

export interface HandleInitiatePhotoIngestionRouteRequestOptions {
  dependencies?: InitiatePhotoIngestionRouteDependencies;
}

let defaultInitiatePhotoIngestionRouteDependencies:
  | InitiatePhotoIngestionRouteDependencies
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

function readImageContentType(
  value: unknown,
  errorMessage: string = INITIATE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
): string {
  if (typeof value !== "string") {
    throw new TypeError(errorMessage);
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!/^image\/[a-z0-9.+-]+$/u.test(normalizedValue)) {
    throw new TypeError(errorMessage);
  }

  return normalizedValue;
}

function readPositiveInteger(
  value: unknown,
  errorMessage: string = INITIATE_PHOTO_INGESTION_SIZE_BYTES_INVALID_ERROR,
): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new TypeError(errorMessage);
  }

  return value as number;
}

function normalizeInitiatePhotoIngestionExistingUploadIdentity(
  value: unknown,
): InitiatePhotoIngestionExistingUploadIdentity {
  if (!isRecord(value)) {
    throw new TypeError(INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_INVALID_ERROR);
  }

  const objectKey = readRequiredNonEmptyStringValue(
    value.objectKey,
    INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_OBJECT_KEY_INVALID_ERROR,
  );
  const storageKey =
    value.storageKey === undefined
      ? objectKey
      : readRequiredNonEmptyStringValue(
          value.storageKey,
          INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_STORAGE_KEY_INVALID_ERROR,
        );

  if (storageKey !== objectKey) {
    throw new TypeError(
      INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_STORAGE_KEY_MISMATCH_ERROR,
    );
  }

  return {
    mediaUrl: readRequiredAbsoluteUrl(
      value.mediaUrl,
      INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_MEDIA_URL_INVALID_ERROR,
    ),
    objectKey,
    storageKey,
  };
}

function readUploadHeaders(value: unknown): Record<string, string> {
  return readStringMap(
    value,
    INITIATE_PHOTO_INGESTION_RESPONSE_UPLOAD_HEADERS_INVALID_ERROR,
  );
}

function readOptionalUploadFields(value: unknown): Record<string, string> {
  if (value === undefined) {
    return {};
  }

  return readStringMap(
    value,
    INITIATE_PHOTO_INGESTION_RESPONSE_UPLOAD_FIELDS_INVALID_ERROR,
  );
}

function readStringMap(
  value: unknown,
  errorMessage: string,
): Record<string, string> {
  if (!isRecord(value)) {
    throw new TypeError(errorMessage);
  }

  const normalizedHeaders: Record<string, string> = {};

  for (const [key, headerValue] of Object.entries(value)) {
    if (key.trim().length === 0 || typeof headerValue !== "string") {
      throw new TypeError(errorMessage);
    }

    normalizedHeaders[key] = headerValue;
  }

  return normalizedHeaders;
}

function normalizeUploadSetup(
  value: unknown,
): InitiatePhotoIngestionUploadSetup {
  if (!isRecord(value)) {
    throw new TypeError(INITIATE_PHOTO_INGESTION_RESPONSE_UPLOAD_INVALID_ERROR);
  }

  if (value.method !== "PUT") {
    throw new TypeError(
      INITIATE_PHOTO_INGESTION_RESPONSE_UPLOAD_METHOD_INVALID_ERROR,
    );
  }

  return {
    fields: readOptionalUploadFields(value.fields),
    headers: readUploadHeaders(value.headers),
    method: "PUT",
    url: readRequiredAbsoluteUrl(
      value.url,
      INITIATE_PHOTO_INGESTION_RESPONSE_UPLOAD_URL_INVALID_ERROR,
    ),
  };
}

function normalizeInitiatePhotoIngestionImageObjectMetadata(
  value: unknown,
): InitiatePhotoIngestionImageObjectMetadata {
  if (!isRecord(value)) {
    throw new TypeError(INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_INVALID_ERROR);
  }

  return {
    contentType: readImageContentType(
      value.contentType,
      INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_CONTENT_TYPE_INVALID_ERROR,
    ),
    fileName: readRequiredNonEmptyStringValue(
      value.fileName,
      INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_FILE_NAME_INVALID_ERROR,
    ),
    mediaUrl: readRequiredAbsoluteUrl(
      value.mediaUrl,
      INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_MEDIA_URL_INVALID_ERROR,
    ),
    sizeBytes: readPositiveInteger(
      value.sizeBytes,
      INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_SIZE_BYTES_INVALID_ERROR,
    ),
    storageKey: readRequiredNonEmptyStringValue(
      value.storageKey,
      INITIATE_PHOTO_INGESTION_RESPONSE_IMAGE_STORAGE_KEY_INVALID_ERROR,
    ),
  };
}

function normalizeInitiatePhotoIngestionResponseBody(
  value: unknown,
): InitiatePhotoIngestionResponseBody {
  if (!isRecord(value)) {
    throw new TypeError(INITIATE_PHOTO_INGESTION_RESPONSE_BODY_INVALID_ERROR);
  }

  const mediaUrl = readRequiredAbsoluteUrl(
    value.mediaUrl,
    INITIATE_PHOTO_INGESTION_RESPONSE_MEDIA_URL_INVALID_ERROR,
  );
  const objectKey = readRequiredNonEmptyStringValue(
    value.objectKey,
    INITIATE_PHOTO_INGESTION_RESPONSE_OBJECT_KEY_INVALID_ERROR,
  );
  const storageKey =
    value.storageKey === undefined
      ? objectKey
      : readRequiredNonEmptyStringValue(
          value.storageKey,
          INITIATE_PHOTO_INGESTION_RESPONSE_STORAGE_KEY_INVALID_ERROR,
        );

  return {
    image: normalizeInitiatePhotoIngestionImageObjectMetadata(value.image),
    mediaUrl,
    objectKey,
    storageKey,
    upload: normalizeUploadSetup(value.upload),
  };
}

function stripInitiatePhotoIngestionOwnershipFields(
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

function resolveInitiatePhotoIngestionRouteDependencies(
  override?: InitiatePhotoIngestionRouteDependencies,
): InitiatePhotoIngestionRouteDependencies {
  if (override) {
    return override;
  }

  if (defaultInitiatePhotoIngestionRouteDependencies) {
    return defaultInitiatePhotoIngestionRouteDependencies;
  }

  throw new Error(INITIATE_PHOTO_INGESTION_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isInitiatePhotoIngestionBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.message === INITIATE_PHOTO_INGESTION_REQUEST_BODY_INVALID_ERROR ||
      error.message.startsWith(
        INITIATE_PHOTO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR,
      ) ||
      error.message === INITIATE_PHOTO_INGESTION_FILE_NAME_REQUIRED_ERROR ||
      error.message === INITIATE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR ||
      error.message === INITIATE_PHOTO_INGESTION_SIZE_BYTES_INVALID_ERROR ||
      error.message === INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_INVALID_ERROR ||
      error.message ===
        INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_MEDIA_URL_INVALID_ERROR ||
      error.message ===
        INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_OBJECT_KEY_INVALID_ERROR ||
      error.message ===
        INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_SCOPE_INVALID_ERROR ||
      error.message ===
        INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_STORAGE_KEY_INVALID_ERROR ||
      error.message ===
        INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_STORAGE_KEY_MISMATCH_ERROR ||
      error.message ===
        INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_MEDIA_URL_MISMATCH_ERROR)
  );
}

export function configureInitiatePhotoIngestionRouteDependencies(
  dependencies: InitiatePhotoIngestionRouteDependencies | null,
): void {
  defaultInitiatePhotoIngestionRouteDependencies = dependencies;
}

export async function parseInitiatePhotoIngestionRequestBody(
  request: Request,
): Promise<InitiatePhotoIngestionRequestBody> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    throw new TypeError(
      `${INITIATE_PHOTO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new TypeError(INITIATE_PHOTO_INGESTION_REQUEST_BODY_INVALID_ERROR);
  }

  const sanitizedPayload = stripInitiatePhotoIngestionOwnershipFields(payload);
  const fileName =
    typeof sanitizedPayload.fileName === "string" &&
    sanitizedPayload.fileName.trim().length > 0
      ? sanitizedPayload.fileName.trim()
      : null;

  if (fileName === null) {
    throw new TypeError(INITIATE_PHOTO_INGESTION_FILE_NAME_REQUIRED_ERROR);
  }

  return {
    contentType: readImageContentType(sanitizedPayload.contentType),
    ...(sanitizedPayload.existingUpload === undefined
      ? {}
      : {
          existingUpload: normalizeInitiatePhotoIngestionExistingUploadIdentity(
            sanitizedPayload.existingUpload,
          ),
        }),
    fileName,
    sizeBytes: readPositiveInteger(sanitizedPayload.sizeBytes),
  };
}

export async function handleInitiatePhotoIngestionRouteRequest(
  request: Request,
  options: HandleInitiatePhotoIngestionRouteRequestOptions = {},
): Promise<Response> {
  let dependencies: InitiatePhotoIngestionRouteDependencies;

  try {
    dependencies = resolveInitiatePhotoIngestionRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR,
      },
      INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  const authenticatedUserId =
    await dependencies.auth.resolveAuthenticatedUserId(request);

  if (authenticatedUserId === null) {
    return createJsonResponse(
      {
        error: INITIATE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
      },
      INITIATE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_STATUS,
    );
  }

  try {
    const input = await parseInitiatePhotoIngestionRequestBody(request);
    const uploadSetup =
      await dependencies.uploadSetupGenerator.generateUploadSetup({
        ...input,
        userId: authenticatedUserId,
      });

    return createJsonResponse<InitiatePhotoIngestionResponseBody>(
      normalizeInitiatePhotoIngestionResponseBody(uploadSetup),
      INITIATE_PHOTO_INGESTION_ROUTE_CREATED_STATUS,
    );
  } catch (error) {
    if (isInitiatePhotoIngestionBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        INITIATE_PHOTO_INGESTION_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR,
      },
      INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
