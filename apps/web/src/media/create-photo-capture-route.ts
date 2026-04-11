import {
  MissingPhotoCaptureOwnershipScopeError,
  type CreatePhotoCaptureInput,
  type CreatedPhotoCaptureRecord,
  type PhotoCaptureCreationService,
} from "./create-photo-capture.ts";

export const CREATE_PHOTO_CAPTURE_ROUTE_CREATED_STATUS = 201;
export const CREATE_PHOTO_CAPTURE_ROUTE_BAD_REQUEST_STATUS = 400;
export const CREATE_PHOTO_CAPTURE_ROUTE_UNAUTHORIZED_STATUS = 401;
export const CREATE_PHOTO_CAPTURE_ROUTE_INTERNAL_ERROR_STATUS = 500;

export const CREATE_PHOTO_CAPTURE_ROUTE_UNAUTHORIZED_ERROR = "Unauthorized";
export const CREATE_PHOTO_CAPTURE_ROUTE_INTERNAL_ERROR =
  "Internal Server Error";
export const CREATE_PHOTO_CAPTURE_ROUTE_DEPENDENCIES_MISSING_ERROR =
  "Create photo capture route dependencies have not been configured.";
export const CREATE_PHOTO_CAPTURE_REQUEST_BODY_INVALID_ERROR =
  "Request body must be a JSON object.";
export const CREATE_PHOTO_CAPTURE_REQUEST_BODY_JSON_INVALID_ERROR =
  "Request body must be valid JSON.";
export const CREATE_PHOTO_CAPTURE_CONTENT_TYPE_INVALID_ERROR =
  "contentType must be a valid image MIME type.";
export const CREATE_PHOTO_CAPTURE_FILE_NAME_REQUIRED_ERROR =
  "fileName must be a non-empty string.";
export const CREATE_PHOTO_CAPTURE_MEDIA_URL_INVALID_ERROR =
  "mediaUrl must be a valid absolute URL.";
export const CREATE_PHOTO_CAPTURE_OBJECT_KEY_REQUIRED_ERROR =
  "objectKey must be a non-empty string.";
export const CREATE_PHOTO_CAPTURE_SIZE_BYTES_INVALID_ERROR =
  "sizeBytes must be a positive integer.";

export interface CreatePhotoCaptureRequestBody extends CreatePhotoCaptureInput {}

export interface CreatePhotoCaptureRouteDependencies<
  TRecord extends CreatedPhotoCaptureRecord = CreatedPhotoCaptureRecord,
> {
  creationService: PhotoCaptureCreationService<TRecord>;
}

export interface HandleCreatePhotoCaptureRouteRequestOptions<
  TRecord extends CreatedPhotoCaptureRecord = CreatedPhotoCaptureRecord,
> {
  dependencies?: CreatePhotoCaptureRouteDependencies<TRecord>;
}

let defaultCreatePhotoCaptureRouteDependencies:
  | CreatePhotoCaptureRouteDependencies
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

function readImageContentType(value: unknown): string {
  if (typeof value !== "string") {
    throw new TypeError(CREATE_PHOTO_CAPTURE_CONTENT_TYPE_INVALID_ERROR);
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!/^image\/[a-z0-9.+-]+$/u.test(normalizedValue)) {
    throw new TypeError(CREATE_PHOTO_CAPTURE_CONTENT_TYPE_INVALID_ERROR);
  }

  return normalizedValue;
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

function readPositiveInteger(value: unknown, errorMessage: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw new TypeError(errorMessage);
  }

  return Number(value);
}

function stripCreatePhotoCaptureOwnershipFields(
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

function resolveCreatePhotoCaptureRouteDependencies<
  TRecord extends CreatedPhotoCaptureRecord = CreatedPhotoCaptureRecord,
>(
  override?: CreatePhotoCaptureRouteDependencies<TRecord>,
): CreatePhotoCaptureRouteDependencies<TRecord> {
  if (override) {
    return override;
  }

  if (defaultCreatePhotoCaptureRouteDependencies) {
    return defaultCreatePhotoCaptureRouteDependencies as CreatePhotoCaptureRouteDependencies<TRecord>;
  }

  throw new Error(CREATE_PHOTO_CAPTURE_ROUTE_DEPENDENCIES_MISSING_ERROR);
}

function isCreatePhotoCaptureBadRequestError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    (error.message === CREATE_PHOTO_CAPTURE_REQUEST_BODY_INVALID_ERROR ||
      error.message.startsWith(CREATE_PHOTO_CAPTURE_REQUEST_BODY_JSON_INVALID_ERROR) ||
      error.message === CREATE_PHOTO_CAPTURE_CONTENT_TYPE_INVALID_ERROR ||
      error.message === CREATE_PHOTO_CAPTURE_FILE_NAME_REQUIRED_ERROR ||
      error.message === CREATE_PHOTO_CAPTURE_MEDIA_URL_INVALID_ERROR ||
      error.message === CREATE_PHOTO_CAPTURE_OBJECT_KEY_REQUIRED_ERROR ||
      error.message === CREATE_PHOTO_CAPTURE_SIZE_BYTES_INVALID_ERROR)
  );
}

export function configureCreatePhotoCaptureRouteDependencies(
  dependencies: CreatePhotoCaptureRouteDependencies | null,
): void {
  defaultCreatePhotoCaptureRouteDependencies = dependencies;
}

export async function parseCreatePhotoCaptureRequestBody(
  request: Request,
): Promise<CreatePhotoCaptureRequestBody> {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    throw new TypeError(
      `${CREATE_PHOTO_CAPTURE_REQUEST_BODY_JSON_INVALID_ERROR}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!isRecord(payload)) {
    throw new TypeError(CREATE_PHOTO_CAPTURE_REQUEST_BODY_INVALID_ERROR);
  }

  const sanitizedPayload = stripCreatePhotoCaptureOwnershipFields(payload);

  return {
    contentType: readImageContentType(sanitizedPayload.contentType),
    fileName: readRequiredTrimmedString(
      sanitizedPayload.fileName,
      CREATE_PHOTO_CAPTURE_FILE_NAME_REQUIRED_ERROR,
    ),
    mediaUrl: readRequiredAbsoluteUrl(
      sanitizedPayload.mediaUrl,
      CREATE_PHOTO_CAPTURE_MEDIA_URL_INVALID_ERROR,
    ),
    objectKey: readRequiredTrimmedString(
      sanitizedPayload.objectKey,
      CREATE_PHOTO_CAPTURE_OBJECT_KEY_REQUIRED_ERROR,
    ),
    sizeBytes: readPositiveInteger(
      sanitizedPayload.sizeBytes,
      CREATE_PHOTO_CAPTURE_SIZE_BYTES_INVALID_ERROR,
    ),
  };
}

export async function handleCreatePhotoCaptureRouteRequest<
  TRecord extends CreatedPhotoCaptureRecord = CreatedPhotoCaptureRecord,
>(
  request: Request,
  options: HandleCreatePhotoCaptureRouteRequestOptions<TRecord> = {},
): Promise<Response> {
  let dependencies: CreatePhotoCaptureRouteDependencies<TRecord>;

  try {
    dependencies = resolveCreatePhotoCaptureRouteDependencies(
      options.dependencies,
    );
  } catch {
    return createJsonResponse(
      {
        error: CREATE_PHOTO_CAPTURE_ROUTE_INTERNAL_ERROR,
      },
      CREATE_PHOTO_CAPTURE_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }

  try {
    const input = await parseCreatePhotoCaptureRequestBody(request);
    const createdCapture = await dependencies.creationService.create(input);

    return createJsonResponse<TRecord>(
      createdCapture,
      CREATE_PHOTO_CAPTURE_ROUTE_CREATED_STATUS,
    );
  } catch (error) {
    if (error instanceof MissingPhotoCaptureOwnershipScopeError) {
      return createJsonResponse(
        {
          error: CREATE_PHOTO_CAPTURE_ROUTE_UNAUTHORIZED_ERROR,
        },
        CREATE_PHOTO_CAPTURE_ROUTE_UNAUTHORIZED_STATUS,
      );
    }

    if (isCreatePhotoCaptureBadRequestError(error)) {
      return createJsonResponse(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        CREATE_PHOTO_CAPTURE_ROUTE_BAD_REQUEST_STATUS,
      );
    }

    return createJsonResponse(
      {
        error: CREATE_PHOTO_CAPTURE_ROUTE_INTERNAL_ERROR,
      },
      CREATE_PHOTO_CAPTURE_ROUTE_INTERNAL_ERROR_STATUS,
    );
  }
}
