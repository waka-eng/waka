import {
  PHOTO_CAPTURE_FAILED_STATUS,
  PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
  PHOTO_CAPTURE_SOURCE_TYPE,
  PHOTO_CAPTURE_UPLOADED_STATUS,
  type PhotoCaptureSourceMeta,
} from "./create-photo-capture.ts";

export type PhotoCaptureFinalizationStatus =
  | typeof PHOTO_CAPTURE_PENDING_UPLOAD_STATUS
  | typeof PHOTO_CAPTURE_UPLOADED_STATUS
  | typeof PHOTO_CAPTURE_FAILED_STATUS;

export interface CompletePhotoCaptureInput {
  contentType: string;
  fileName: string;
  mediaUrl: string;
  objectKey: string;
  photoCaptureId: string;
  sizeBytes: number;
}

const COMPLETE_PHOTO_CAPTURE_RECORD_SELECT = {
  id: true,
  photoFileName: true,
  photoMimeType: true,
  photoSizeBytes: true,
  photoStorageKey: true,
  photoStorageUrl: true,
  photoUploadStatus: true,
  rawContent: true,
  sourceType: true,
} as const;

const claimedPhotoCaptureFinalizationState = new WeakMap<object, boolean>();

export interface ReadPhotoCaptureFinalizationStatusArgs {
  select: {
    photoUploadStatus: true;
  };
  where: {
    userId_id: {
      id: string;
      userId: string;
    };
  };
}

export interface ReadPhotoCaptureFinalizationStatusRecord {
  photoUploadStatus: string | null;
}

export interface ReadCompletedPhotoCaptureArgs {
  select: typeof COMPLETE_PHOTO_CAPTURE_RECORD_SELECT;
  where: {
    userId_id: {
      id: string;
      userId: string;
    };
  };
}

export interface CompletePhotoCapturePersistenceData {
  mediaUrl: string;
  photoFileName: string;
  photoMimeType: string;
  photoSizeBytes: number;
  photoStorageKey: string;
  photoStorageUrl: string;
  photoUploadStatus: typeof PHOTO_CAPTURE_UPLOADED_STATUS;
  rawContent: string;
  sourceMeta: PhotoCaptureSourceMeta;
}

export interface CompletePhotoCapturePersistenceArgs {
  data: CompletePhotoCapturePersistenceData;
  select: typeof COMPLETE_PHOTO_CAPTURE_RECORD_SELECT;
  where: {
    userId_id: {
      id: string;
      userId: string;
    };
  };
}

export interface CompletedPhotoCaptureRecord {
  id: string;
  photoFileName: string | null;
  photoMimeType: string | null;
  photoSizeBytes: number | null;
  photoStorageKey: string | null;
  photoStorageUrl: string | null;
  photoUploadStatus: string | null;
  rawContent: string;
  sourceType: typeof PHOTO_CAPTURE_SOURCE_TYPE;
}

export interface CompletePhotoCapturePersistenceClient<
  TRecord extends CompletedPhotoCaptureRecord = CompletedPhotoCaptureRecord,
> {
  inspiration: {
    findUnique(
      args: ReadPhotoCaptureFinalizationStatusArgs,
    ): Promise<ReadPhotoCaptureFinalizationStatusRecord | null>;
    findUnique(args: ReadCompletedPhotoCaptureArgs): Promise<TRecord | null>;
    update(args: CompletePhotoCapturePersistenceArgs): Promise<TRecord>;
  };
}

export interface CompletePhotoCaptureService<
  TRecord extends CompletedPhotoCaptureRecord = CompletedPhotoCaptureRecord,
> {
  complete(userId: string, input: CompletePhotoCaptureInput): Promise<TRecord>;
  didClaimFinalization?(record: TRecord): boolean;
}

export interface CompletePhotoCaptureServiceDependencies<
  TRecord extends CompletedPhotoCaptureRecord = CompletedPhotoCaptureRecord,
> {
  photoCaptureRepository: CompletePhotoCapturePersistenceClient<TRecord>;
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

function normalizePhotoCaptureContentType(contentType: string): string {
  const normalizedContentType = readRequiredNonEmptyString(
    contentType,
    "contentType",
  ).toLowerCase();

  if (!/^image\/[a-z0-9.+-]+$/u.test(normalizedContentType)) {
    throw new TypeError("contentType must be a valid image MIME type.");
  }

  return normalizedContentType;
}

export function normalizeCompletePhotoCaptureInput(
  input: CompletePhotoCaptureInput,
): CompletePhotoCaptureInput {
  return {
    contentType: normalizePhotoCaptureContentType(input.contentType),
    fileName: readRequiredNonEmptyString(input.fileName, "fileName"),
    mediaUrl: readRequiredAbsoluteUrl(input.mediaUrl, "mediaUrl"),
    objectKey: readRequiredNonEmptyString(input.objectKey, "objectKey"),
    photoCaptureId: readRequiredNonEmptyString(
      input.photoCaptureId,
      "photoCaptureId",
    ),
    sizeBytes: readRequiredPositiveInteger(input.sizeBytes, "sizeBytes"),
  };
}

export function buildReadPhotoCaptureFinalizationStatusArgs(
  userId: string,
  photoCaptureId: string,
): ReadPhotoCaptureFinalizationStatusArgs {
  return {
    select: {
      photoUploadStatus: true,
    },
    where: {
      userId_id: {
        id: readRequiredNonEmptyString(photoCaptureId, "photoCaptureId"),
        userId: readRequiredNonEmptyString(userId, "userId"),
      },
    },
  };
}

export function buildReadCompletedPhotoCaptureArgs(
  userId: string,
  photoCaptureId: string,
): ReadCompletedPhotoCaptureArgs {
  return {
    select: COMPLETE_PHOTO_CAPTURE_RECORD_SELECT,
    where: {
      userId_id: {
        id: readRequiredNonEmptyString(photoCaptureId, "photoCaptureId"),
        userId: readRequiredNonEmptyString(userId, "userId"),
      },
    },
  };
}

export function resolvePhotoCaptureFinalizeSuccessStatus(
  currentStatus: string | null | undefined,
): typeof PHOTO_CAPTURE_UPLOADED_STATUS {
  switch (currentStatus) {
    case PHOTO_CAPTURE_PENDING_UPLOAD_STATUS:
    case PHOTO_CAPTURE_UPLOADED_STATUS:
    case PHOTO_CAPTURE_FAILED_STATUS:
    case null:
    case undefined:
      return PHOTO_CAPTURE_UPLOADED_STATUS;
    default:
      return PHOTO_CAPTURE_UPLOADED_STATUS;
  }
}

export function buildCompletePhotoCapturePersistenceArgs(
  userId: string,
  input: CompletePhotoCaptureInput,
  currentStatus?: string | null,
): CompletePhotoCapturePersistenceArgs {
  const normalizedUserId = readRequiredNonEmptyString(userId, "userId");
  const normalizedInput = normalizeCompletePhotoCaptureInput(input);
  const sourceMeta = {
    fileName: normalizedInput.fileName,
    mimeType: normalizedInput.contentType,
    sizeBytes: normalizedInput.sizeBytes,
  } satisfies PhotoCaptureSourceMeta;

  return {
    data: {
      mediaUrl: normalizedInput.mediaUrl,
      photoFileName: normalizedInput.fileName,
      photoMimeType: normalizedInput.contentType,
      photoSizeBytes: normalizedInput.sizeBytes,
      photoStorageKey: normalizedInput.objectKey,
      photoStorageUrl: normalizedInput.mediaUrl,
      photoUploadStatus:
        resolvePhotoCaptureFinalizeSuccessStatus(currentStatus),
      rawContent: normalizedInput.fileName,
      sourceMeta,
    },
    select: COMPLETE_PHOTO_CAPTURE_RECORD_SELECT,
    where: {
      userId_id: {
        id: normalizedInput.photoCaptureId,
        userId: normalizedUserId,
      },
    },
  };
}

function tagCompletedPhotoCaptureFinalizationClaim<
  TRecord extends CompletedPhotoCaptureRecord,
>(record: TRecord, didClaimFinalization: boolean): TRecord {
  const taggedRecord = {
    ...record,
  } as TRecord;

  claimedPhotoCaptureFinalizationState.set(
    taggedRecord as TRecord & object,
    didClaimFinalization,
  );

  return taggedRecord;
}

export function didCompletePhotoCaptureClaimFinalization<
  TRecord extends CompletedPhotoCaptureRecord,
>(record: TRecord): boolean {
  return (
    claimedPhotoCaptureFinalizationState.get(record as TRecord & object) ===
    true
  );
}

export async function completePhotoCapture<
  TRecord extends CompletedPhotoCaptureRecord = CompletedPhotoCaptureRecord,
>(
  client: CompletePhotoCapturePersistenceClient<TRecord>,
  userId: string,
  input: CompletePhotoCaptureInput,
): Promise<TRecord> {
  const normalizedInput = normalizeCompletePhotoCaptureInput(input);
  const currentRecord = await client.inspiration.findUnique(
    buildReadPhotoCaptureFinalizationStatusArgs(
      userId,
      normalizedInput.photoCaptureId,
    ),
  );

  if (currentRecord?.photoUploadStatus === PHOTO_CAPTURE_UPLOADED_STATUS) {
    const completedCapture = await client.inspiration.findUnique(
      buildReadCompletedPhotoCaptureArgs(userId, normalizedInput.photoCaptureId),
    );

    if (completedCapture === null) {
      throw new Error(
        `Photo capture ${normalizedInput.photoCaptureId} could not be read after upload completion.`,
      );
    }

    return tagCompletedPhotoCaptureFinalizationClaim(completedCapture, false);
  }

  const completedCapture = await client.inspiration.update(
    buildCompletePhotoCapturePersistenceArgs(
      userId,
      normalizedInput,
      currentRecord?.photoUploadStatus,
    ),
  );

  return tagCompletedPhotoCaptureFinalizationClaim(completedCapture, true);
}

export function createCompletePhotoCaptureService<
  TRecord extends CompletedPhotoCaptureRecord = CompletedPhotoCaptureRecord,
>(
  dependencies: CompletePhotoCaptureServiceDependencies<TRecord>,
): CompletePhotoCaptureService<TRecord> {
  return {
    async complete(userId, input) {
      return completePhotoCapture(
        dependencies.photoCaptureRepository,
        userId,
        input,
      );
    },
    didClaimFinalization(record) {
      return didCompletePhotoCaptureClaimFinalization(record);
    },
  };
}
