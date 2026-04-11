import {
  buildInitialInspirationEnrichmentPersistenceData,
  type InitialInspirationEnrichmentPersistenceData,
} from "../inspirations/enrichment-pipeline.ts";
import {
  buildPendingPhotoAnalysisProcessingState,
  type PhotoAnalysisProcessingState,
} from "../inspirations/photo-analysis-processing-state.ts";

export const PHOTO_CAPTURE_SOURCE_TYPE = "PHOTO";
export const PHOTO_CAPTURE_PENDING_UPLOAD_STATUS = "PENDING_UPLOAD";
export const PHOTO_CAPTURE_UPLOADED_STATUS = "UPLOADED";
export const PHOTO_CAPTURE_FAILED_STATUS = "FAILED";

export interface PhotoCaptureOwnershipScope {
  tenantId?: string;
  userId: string;
  workspaceId?: string;
}

export interface PhotoCaptureOwnershipScopeResolver {
  resolvePhotoCaptureOwnershipScope(): Promise<PhotoCaptureOwnershipScope | null>;
}

export interface CreatePhotoCaptureInput {
  contentType: string;
  fileName: string;
  mediaUrl: string;
  objectKey: string;
  sizeBytes: number;
}

export interface PhotoCaptureSourceMeta {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface CreatePhotoCapturePersistenceData
  extends InitialInspirationEnrichmentPersistenceData {
  mediaUrl: string;
  originalMediaUrl: string;
  originalRawContent: string;
  originalSourceMeta: PhotoCaptureSourceMeta;
  photoFileName: string;
  photoMimeType: string;
  photoSizeBytes: number;
  photoStorageKey: string;
  photoStorageUrl: string;
  photoUploadStatus: typeof PHOTO_CAPTURE_PENDING_UPLOAD_STATUS;
  processingState: PhotoAnalysisProcessingState;
  rawContent: string;
  sourceMeta: PhotoCaptureSourceMeta;
  sourceType: typeof PHOTO_CAPTURE_SOURCE_TYPE;
  tags: string[];
  userId: string;
}

export interface CreatePhotoCapturePersistenceArgs {
  data: CreatePhotoCapturePersistenceData;
  select: {
    id: true;
    rawContent: true;
    sourceType: true;
  };
}

export interface CreatedPhotoCaptureRecord {
  id: string;
  rawContent: string;
  sourceType: typeof PHOTO_CAPTURE_SOURCE_TYPE;
}

export interface CreatePhotoCapturePersistenceClient<
  TRecord extends CreatedPhotoCaptureRecord = CreatedPhotoCaptureRecord,
> {
  inspiration: {
    create(args: CreatePhotoCapturePersistenceArgs): Promise<TRecord>;
  };
}

export interface PhotoCaptureCreationServiceDependencies<
  TRecord extends CreatedPhotoCaptureRecord,
> {
  photoCaptureRepository: CreatePhotoCapturePersistenceClient<TRecord>;
  photoCaptureOwnershipScopeResolver: PhotoCaptureOwnershipScopeResolver;
}

export interface PhotoCaptureCreationService<
  TRecord extends CreatedPhotoCaptureRecord,
> {
  create(input: CreatePhotoCaptureInput): Promise<TRecord>;
}

export class MissingPhotoCaptureOwnershipScopeError extends Error {
  constructor() {
    super(
      "An authenticated ownership scope is required before persisting photo captures.",
    );
    this.name = "MissingPhotoCaptureOwnershipScopeError";
  }
}

function readRequiredNonEmptyString(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readRequiredAbsoluteUrl(value: string, fieldName: string): string {
  const normalizedValue = readRequiredNonEmptyString(value, fieldName);

  try {
    return new URL(normalizedValue).toString();
  } catch {
    throw new TypeError(`${fieldName} must be a valid absolute URL.`);
  }
}

function readRequiredPositiveInteger(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer.`);
  }

  return value;
}

function normalizePhotoCaptureOwnershipScope(
  scope: PhotoCaptureOwnershipScope,
): PhotoCaptureOwnershipScope {
  const userId = readRequiredNonEmptyString(scope.userId, "userId");
  const tenantId =
    scope.tenantId === undefined
      ? undefined
      : readRequiredNonEmptyString(scope.tenantId, "tenantId");
  const workspaceId =
    scope.workspaceId === undefined
      ? undefined
      : readRequiredNonEmptyString(scope.workspaceId, "workspaceId");

  if ((tenantId === undefined) !== (workspaceId === undefined)) {
    throw new TypeError(
      "tenantId and workspaceId must be provided together when workspace ownership is used.",
    );
  }

  return {
    userId,
    ...(tenantId === undefined || workspaceId === undefined
      ? {}
      : {
          tenantId,
          workspaceId,
        }),
  };
}

function normalizeCreatePhotoCaptureInput(
  input: CreatePhotoCaptureInput,
): CreatePhotoCaptureInput {
  return {
    contentType: readRequiredNonEmptyString(input.contentType, "contentType")
      .toLowerCase(),
    fileName: readRequiredNonEmptyString(input.fileName, "fileName"),
    mediaUrl: readRequiredAbsoluteUrl(input.mediaUrl, "mediaUrl"),
    objectKey: readRequiredNonEmptyString(input.objectKey, "objectKey"),
    sizeBytes: readRequiredPositiveInteger(input.sizeBytes, "sizeBytes"),
  };
}

export function buildPhotoCaptureSourceMeta(
  input: CreatePhotoCaptureInput,
): PhotoCaptureSourceMeta {
  const normalizedInput = normalizeCreatePhotoCaptureInput(input);

  return {
    fileName: normalizedInput.fileName,
    mimeType: normalizedInput.contentType,
    sizeBytes: normalizedInput.sizeBytes,
  };
}

export function buildCreatePhotoCapturePersistenceArgs(
  ownershipScope: PhotoCaptureOwnershipScope,
  input: CreatePhotoCaptureInput,
): CreatePhotoCapturePersistenceArgs {
  const normalizedOwnershipScope =
    normalizePhotoCaptureOwnershipScope(ownershipScope);
  const normalizedInput = normalizeCreatePhotoCaptureInput(input);
  const sourceMeta = buildPhotoCaptureSourceMeta(normalizedInput);

  return {
    data: {
      userId: normalizedOwnershipScope.userId,
      originalRawContent: normalizedInput.fileName,
      rawContent: normalizedInput.fileName,
      sourceType: PHOTO_CAPTURE_SOURCE_TYPE,
      tags: [],
      ...buildInitialInspirationEnrichmentPersistenceData(),
      originalSourceMeta: sourceMeta,
      sourceMeta,
      originalMediaUrl: normalizedInput.mediaUrl,
      mediaUrl: normalizedInput.mediaUrl,
      photoStorageKey: normalizedInput.objectKey,
      photoStorageUrl: normalizedInput.mediaUrl,
      photoFileName: normalizedInput.fileName,
      photoMimeType: normalizedInput.contentType,
      photoSizeBytes: normalizedInput.sizeBytes,
      photoUploadStatus: PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
      processingState: buildPendingPhotoAnalysisProcessingState(),
    },
    select: {
      id: true,
      rawContent: true,
      sourceType: true,
    },
  };
}

export async function createPhotoCapture<
  TRecord extends CreatedPhotoCaptureRecord,
>(
  client: CreatePhotoCapturePersistenceClient<TRecord>,
  ownershipScope: PhotoCaptureOwnershipScope,
  input: CreatePhotoCaptureInput,
): Promise<TRecord> {
  return client.inspiration.create(
    buildCreatePhotoCapturePersistenceArgs(ownershipScope, input),
  );
}

export async function requirePhotoCaptureOwnershipScope(
  resolver: PhotoCaptureOwnershipScopeResolver,
): Promise<PhotoCaptureOwnershipScope> {
  const ownershipScope = await resolver.resolvePhotoCaptureOwnershipScope();

  if (ownershipScope === null) {
    throw new MissingPhotoCaptureOwnershipScopeError();
  }

  return normalizePhotoCaptureOwnershipScope(ownershipScope);
}

export async function createPhotoCaptureForOwnershipScope<
  TRecord extends CreatedPhotoCaptureRecord,
>(
  dependencies: PhotoCaptureCreationServiceDependencies<TRecord>,
  input: CreatePhotoCaptureInput,
): Promise<TRecord> {
  const ownershipScope = await requirePhotoCaptureOwnershipScope(
    dependencies.photoCaptureOwnershipScopeResolver,
  );

  return createPhotoCapture(
    dependencies.photoCaptureRepository,
    ownershipScope,
    input,
  );
}

export function createPhotoCaptureCreationService<
  TRecord extends CreatedPhotoCaptureRecord,
>(
  dependencies: PhotoCaptureCreationServiceDependencies<TRecord>,
): PhotoCaptureCreationService<TRecord> {
  return {
    async create(input: CreatePhotoCaptureInput): Promise<TRecord> {
      return createPhotoCaptureForOwnershipScope(dependencies, input);
    },
  };
}
