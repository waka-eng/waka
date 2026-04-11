import type {
  WorkspaceHomePhotoDraft,
  WorkspaceHomePhotoDraftUploadIdentity,
  WorkspaceHomePhotoDraftUploadImageMetadata,
  WorkspaceHomePhotoDraftUploadState,
  WorkspaceHomePhotoDraftUploadRequest,
  WorkspaceHomePhotoDraftUploadToken,
} from "./photo-capture.ts";
import {
  applyWorkspaceHomePhotoDraftUploadProgress,
  markWorkspaceHomePhotoDraftUploadCompleted,
  markWorkspaceHomePhotoDraftUploadFailed,
  markWorkspaceHomePhotoDraftUploadPending,
  resolveWorkspaceHomePhotoDraftUploadIdentity,
} from "./photo-capture.ts";

export const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_INITIATE_PATH =
  "/api/media/photos/initiate";
export const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_RESPONSE_INVALID_ERROR =
  "Photo upload initiation response must be a JSON object.";
export const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_TOKEN_MISMATCH_ERROR =
  "Photo upload initiation response does not match the selected draft.";
export const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_TRANSPORT_UNAVAILABLE_ERROR =
  "Photo uploads are unavailable in this browser.";
export const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_ABORTED_ERROR =
  "Photo upload was interrupted before completion.";
export const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_REQUEST_FAILED_ERROR =
  "Photo upload request failed before completion.";

const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_MEDIA_URL_INVALID_ERROR =
  "Photo upload initiation response mediaUrl must be a valid absolute URL.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_OBJECT_KEY_INVALID_ERROR =
  "Photo upload initiation response objectKey must be a non-empty string.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_STORAGE_KEY_INVALID_ERROR =
  "Photo upload initiation response storageKey must be a non-empty string.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_INVALID_ERROR =
  "Photo upload initiation response image must be a JSON object.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_CONTENT_TYPE_INVALID_ERROR =
  "Photo upload initiation response image.contentType must be a valid image MIME type.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_FILE_NAME_INVALID_ERROR =
  "Photo upload initiation response image.fileName must be a non-empty string.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_MEDIA_URL_INVALID_ERROR =
  "Photo upload initiation response image.mediaUrl must be a valid absolute URL.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_SIZE_BYTES_INVALID_ERROR =
  "Photo upload initiation response image.sizeBytes must be a positive integer.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_STORAGE_KEY_INVALID_ERROR =
  "Photo upload initiation response image.storageKey must be a non-empty string.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_SETUP_INVALID_ERROR =
  "Photo upload initiation response upload must be a JSON object.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_SETUP_METHOD_INVALID_ERROR =
  'Photo upload initiation response upload.method must be "PUT".';
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_SETUP_URL_INVALID_ERROR =
  "Photo upload initiation response upload.url must be a valid absolute URL.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_SETUP_HEADERS_INVALID_ERROR =
  "Photo upload initiation response upload.headers must be a JSON object containing only string values.";
const WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_SETUP_FIELDS_INVALID_ERROR =
  "Photo upload initiation response upload.fields must be a JSON object containing only string values.";

export interface WorkspaceHomePhotoDraftUploadProgress {
  loadedBytes: number;
  progressPercent: number;
  totalBytes: number;
}

export interface WorkspaceHomePhotoDraftUploadProgressEventLike {
  lengthComputable?: boolean;
  loaded?: number;
  total?: number;
}

export interface WorkspaceHomePhotoDraftUploadEventTargetLike {
  addEventListener(
    type: "progress",
    listener: (event: WorkspaceHomePhotoDraftUploadProgressEventLike) => void,
  ): void;
}

export interface WorkspaceHomePhotoDraftUploadTransportLike {
  addEventListener(
    type: "abort" | "error" | "load",
    listener: () => void,
  ): void;
  abort?(): void;
  open(method: string, url: string): void;
  send(body: Blob): void;
  setRequestHeader(name: string, value: string): void;
  status: number;
  upload: WorkspaceHomePhotoDraftUploadEventTargetLike;
}

export interface UploadWorkspaceHomePhotoDraftOptions {
  createUploadTransport?: () => WorkspaceHomePhotoDraftUploadTransportLike;
  fetchImplementation?: typeof fetch;
  onProgress?: (
    progress: WorkspaceHomePhotoDraftUploadProgress,
    draft: WorkspaceHomePhotoDraft,
  ) => void;
  signal?: AbortSignal;
  onStateChange?: (
    draft: WorkspaceHomePhotoDraft,
    uploadState: WorkspaceHomePhotoDraftUploadState,
  ) => void;
}

class WorkspaceHomePhotoDraftUploadStatusError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Photo upload failed with status ${status}.`);
    this.name = "WorkspaceHomePhotoDraftUploadStatusError";
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredNonEmptyString(
  value: unknown,
  errorMessage: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(errorMessage);
  }

  return value.trim();
}

function readRequiredAbsoluteUrl(value: unknown, errorMessage: string): string {
  const normalizedValue = readRequiredNonEmptyString(value, errorMessage);

  try {
    return new URL(normalizedValue).toString();
  } catch {
    throw new TypeError(errorMessage);
  }
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

function readPositiveInteger(value: unknown, errorMessage: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(errorMessage);
  }

  return value;
}

function readStringMap(
  value: unknown,
  errorMessage: string,
): Record<string, string> {
  if (!isRecord(value)) {
    throw new TypeError(errorMessage);
  }

  const normalizedMap: Record<string, string> = {};

  for (const [key, mapValue] of Object.entries(value)) {
    if (key.trim().length === 0 || typeof mapValue !== "string") {
      throw new TypeError(errorMessage);
    }

    normalizedMap[key] = mapValue;
  }

  return normalizedMap;
}

function parseWorkspaceHomePhotoDraftUploadRequest(
  value: unknown,
): WorkspaceHomePhotoDraftUploadRequest {
  if (!isRecord(value)) {
    throw new TypeError(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_SETUP_INVALID_ERROR);
  }

  if (value.method !== "PUT") {
    throw new TypeError(
      WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_SETUP_METHOD_INVALID_ERROR,
    );
  }

  return {
    fields:
      value.fields === undefined
        ? {}
        : readStringMap(
            value.fields,
            WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_SETUP_FIELDS_INVALID_ERROR,
          ),
    headers: readStringMap(
      value.headers,
      WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_SETUP_HEADERS_INVALID_ERROR,
    ),
    method: "PUT",
    url: readRequiredAbsoluteUrl(
      value.url,
      WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_SETUP_URL_INVALID_ERROR,
    ),
  };
}

function parseWorkspaceHomePhotoDraftUploadImageMetadata(
  value: unknown,
): WorkspaceHomePhotoDraftUploadImageMetadata {
  if (!isRecord(value)) {
    throw new TypeError(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_INVALID_ERROR);
  }

  return {
    contentType: readImageContentType(
      value.contentType,
      WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_CONTENT_TYPE_INVALID_ERROR,
    ),
    fileName: readRequiredNonEmptyString(
      value.fileName,
      WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_FILE_NAME_INVALID_ERROR,
    ),
    mediaUrl: readRequiredAbsoluteUrl(
      value.mediaUrl,
      WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_MEDIA_URL_INVALID_ERROR,
    ),
    sizeBytes: readPositiveInteger(
      value.sizeBytes,
      WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_SIZE_BYTES_INVALID_ERROR,
    ),
    storageKey: readRequiredNonEmptyString(
      value.storageKey,
      WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_IMAGE_STORAGE_KEY_INVALID_ERROR,
    ),
  };
}

function readHeaderValue(
  headers: Record<string, string>,
  headerName: string,
): string | undefined {
  const normalizedHeaderName = headerName.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalizedHeaderName) {
      return value;
    }
  }

  return undefined;
}

function buildWorkspaceHomePhotoDraftUploadIdentity(
  uploadToken: WorkspaceHomePhotoDraftUploadToken,
): WorkspaceHomePhotoDraftUploadIdentity {
  return {
    mediaUrl: uploadToken.mediaUrl,
    objectKey: uploadToken.objectKey,
    storageKey: uploadToken.storageKey,
  };
}

function assertWorkspaceHomePhotoDraftUploadTokenMatchesDraft(
  uploadToken: WorkspaceHomePhotoDraftUploadToken,
  draft: WorkspaceHomePhotoDraft,
): WorkspaceHomePhotoDraftUploadToken {
  if (
    uploadToken.image.fileName !== draft.fileName ||
    uploadToken.image.contentType !== draft.mimeType ||
    uploadToken.image.sizeBytes !== draft.sizeBytes ||
    uploadToken.image.mediaUrl !== uploadToken.mediaUrl ||
    uploadToken.image.storageKey !== uploadToken.storageKey
  ) {
    throw new TypeError(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_TOKEN_MISMATCH_ERROR);
  }

  const existingUploadIdentity =
    resolveWorkspaceHomePhotoDraftUploadIdentity(draft);

  if (
    existingUploadIdentity !== undefined &&
    (existingUploadIdentity.mediaUrl !== uploadToken.mediaUrl ||
      existingUploadIdentity.objectKey !== uploadToken.objectKey ||
      existingUploadIdentity.storageKey !== uploadToken.storageKey)
  ) {
    throw new TypeError(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_TOKEN_MISMATCH_ERROR);
  }

  const uploadContentType = readHeaderValue(
    uploadToken.upload.headers,
    "content-type",
  );

  if (
    uploadContentType !== undefined &&
    uploadContentType.trim().toLowerCase() !== draft.mimeType
  ) {
    throw new TypeError(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_TOKEN_MISMATCH_ERROR);
  }

  return uploadToken;
}

function emitWorkspaceHomePhotoDraftState(
  draft: WorkspaceHomePhotoDraft,
  onStateChange?: UploadWorkspaceHomePhotoDraftOptions["onStateChange"],
): WorkspaceHomePhotoDraft {
  onStateChange?.(draft, draft.uploadState);
  return draft;
}

function readWorkspaceHomePhotoDraftUploadLoadedBytes(
  value: number | undefined,
): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value ?? 0));
}

function calculateWorkspaceHomePhotoDraftUploadProgress(
  draft: WorkspaceHomePhotoDraft,
  event: WorkspaceHomePhotoDraftUploadProgressEventLike,
): WorkspaceHomePhotoDraftUploadProgress {
  const totalBytes =
    event.lengthComputable === true &&
    Number.isFinite(event.total) &&
    Number(event.total) > 0
      ? Math.floor(Number(event.total))
      : draft.sizeBytes;
  const loadedBytes = Math.min(
    totalBytes,
    readWorkspaceHomePhotoDraftUploadLoadedBytes(event.loaded),
  );

  return {
    loadedBytes,
    progressPercent:
      totalBytes > 0 ? (loadedBytes / totalBytes) * 100 : 0,
    totalBytes,
  };
}

function readWorkspaceHomePhotoDraftUploadErrorMessage(error: unknown): string {
  if (
    isRecord(error) &&
    typeof error.name === "string" &&
    error.name === "AbortError"
  ) {
    return WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_ABORTED_ERROR;
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_REQUEST_FAILED_ERROR;
}

function resolveWorkspaceHomePhotoDraftUploadTransportFactory(
  options: UploadWorkspaceHomePhotoDraftOptions,
): () => WorkspaceHomePhotoDraftUploadTransportLike {
  if (options.createUploadTransport) {
    return options.createUploadTransport;
  }

  if (typeof globalThis.XMLHttpRequest === "function") {
    return () => new globalThis.XMLHttpRequest();
  }

  throw new Error(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_TRANSPORT_UNAVAILABLE_ERROR);
}

async function uploadWorkspaceHomePhotoDraftFile(
  draft: WorkspaceHomePhotoDraft,
  uploadToken: WorkspaceHomePhotoDraftUploadToken,
  options: UploadWorkspaceHomePhotoDraftOptions,
): Promise<WorkspaceHomePhotoDraft> {
  const createUploadTransport =
    resolveWorkspaceHomePhotoDraftUploadTransportFactory(options);

  return new Promise<WorkspaceHomePhotoDraft>((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new Error(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_ABORTED_ERROR));
      return;
    }

    const uploadTransport = createUploadTransport();
    let currentDraft = draft;
    let isSettled = false;

    const handleAbortSignal = (): void => {
      if (typeof uploadTransport.abort === "function") {
        uploadTransport.abort();
        return;
      }

      settle(
        "reject",
        new Error(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_ABORTED_ERROR),
      );
    };

    const cleanup = (): void => {
      options.signal?.removeEventListener("abort", handleAbortSignal);
    };

    function settle(
      action: "reject" | "resolve",
      value: Error | WorkspaceHomePhotoDraft,
    ): void {
      if (isSettled) {
        return;
      }

      isSettled = true;
      cleanup();

      if (action === "resolve") {
        resolve(value as WorkspaceHomePhotoDraft);
        return;
      }

      reject(value as Error);
    }

    uploadTransport.upload.addEventListener("progress", (event) => {
      const progress = calculateWorkspaceHomePhotoDraftUploadProgress(
        currentDraft,
        event,
      );

      currentDraft = emitWorkspaceHomePhotoDraftState(
        applyWorkspaceHomePhotoDraftUploadProgress(currentDraft, progress),
        options.onStateChange,
      );
      options.onProgress?.(progress, currentDraft);
    });

    uploadTransport.addEventListener("abort", () => {
      settle(
        "reject",
        new Error(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_ABORTED_ERROR),
      );
    });

    uploadTransport.addEventListener("error", () => {
      settle(
        "reject",
        new Error(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_REQUEST_FAILED_ERROR),
      );
    });

    uploadTransport.addEventListener("load", () => {
      if (uploadTransport.status >= 200 && uploadTransport.status < 300) {
        const completedDraft = emitWorkspaceHomePhotoDraftState(
          markWorkspaceHomePhotoDraftUploadCompleted(currentDraft),
          options.onStateChange,
        );

        settle("resolve", completedDraft);
        return;
      }

      settle(
        "reject",
        new WorkspaceHomePhotoDraftUploadStatusError(uploadTransport.status),
      );
    });

    options.signal?.addEventListener("abort", handleAbortSignal, {
      once: true,
    });

    uploadTransport.open(uploadToken.upload.method, uploadToken.upload.url);

    for (const [headerName, headerValue] of Object.entries(
      uploadToken.upload.headers,
    )) {
      uploadTransport.setRequestHeader(headerName, headerValue);
    }

    uploadTransport.send(draft.uploadHandoff.imageFile);
  });
}

export function parseWorkspaceHomePhotoDraftUploadToken(
  value: unknown,
): WorkspaceHomePhotoDraftUploadToken {
  if (!isRecord(value)) {
    throw new TypeError(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_RESPONSE_INVALID_ERROR);
  }

  const objectKey = readRequiredNonEmptyString(
    value.objectKey,
    WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_OBJECT_KEY_INVALID_ERROR,
  );

  return {
    image: parseWorkspaceHomePhotoDraftUploadImageMetadata(value.image),
    mediaUrl: readRequiredAbsoluteUrl(
      value.mediaUrl,
      WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_MEDIA_URL_INVALID_ERROR,
    ),
    objectKey,
    storageKey:
      value.storageKey === undefined
        ? objectKey
        : readRequiredNonEmptyString(
            value.storageKey,
            WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_STORAGE_KEY_INVALID_ERROR,
          ),
    upload: parseWorkspaceHomePhotoDraftUploadRequest(value.upload),
  };
}

export function attachWorkspaceHomePhotoDraftUploadToken(
  draft: WorkspaceHomePhotoDraft,
  uploadToken: WorkspaceHomePhotoDraftUploadToken,
): WorkspaceHomePhotoDraft {
  const validatedUploadToken = assertWorkspaceHomePhotoDraftUploadTokenMatchesDraft(
    uploadToken,
    draft,
  );

  return {
    ...draft,
    uploadIdentity: buildWorkspaceHomePhotoDraftUploadIdentity(
      validatedUploadToken,
    ),
    uploadToken: validatedUploadToken,
  };
}

export async function initiateWorkspaceHomePhotoDraftUpload(
  draft: WorkspaceHomePhotoDraft,
  fetchImplementation: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<WorkspaceHomePhotoDraft> {
  const existingUpload = resolveWorkspaceHomePhotoDraftUploadIdentity(draft);
  const response = await fetchImplementation(
    WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_INITIATE_PATH,
    {
      body: JSON.stringify({
        contentType: draft.mimeType,
        ...(existingUpload === undefined ? {} : { existingUpload }),
        fileName: draft.fileName,
        sizeBytes: draft.sizeBytes,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "POST",
      signal,
    },
  );

  if (!response.ok) {
    throw new Error(
      `Photo upload initiation failed with status ${response.status}`,
    );
  }

  return attachWorkspaceHomePhotoDraftUploadToken(
    draft,
    parseWorkspaceHomePhotoDraftUploadToken(await response.json()),
  );
}

function isWorkspaceHomePhotoDraftUploadMetadataRefreshableError(
  error: unknown,
): error is WorkspaceHomePhotoDraftUploadStatusError {
  return (
    error instanceof WorkspaceHomePhotoDraftUploadStatusError &&
    (error.status === 401 || error.status === 403)
  );
}

export async function uploadWorkspaceHomePhotoDraft(
  draft: WorkspaceHomePhotoDraft,
  options: UploadWorkspaceHomePhotoDraftOptions = {},
): Promise<WorkspaceHomePhotoDraft> {
  let currentDraft = emitWorkspaceHomePhotoDraftState(
    markWorkspaceHomePhotoDraftUploadPending(draft),
    options.onStateChange,
  );

  try {
    if (currentDraft.uploadToken === undefined) {
      currentDraft = emitWorkspaceHomePhotoDraftState(
        markWorkspaceHomePhotoDraftUploadPending(
          await initiateWorkspaceHomePhotoDraftUpload(
            currentDraft,
            options.fetchImplementation,
            options.signal,
          ),
        ),
        options.onStateChange,
      );
    }

    if (currentDraft.uploadToken === undefined) {
      throw new Error(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_RESPONSE_INVALID_ERROR);
    }

    try {
      return await uploadWorkspaceHomePhotoDraftFile(
        currentDraft,
        currentDraft.uploadToken,
        options,
      );
    } catch (error) {
      if (
        !isWorkspaceHomePhotoDraftUploadMetadataRefreshableError(error) ||
        resolveWorkspaceHomePhotoDraftUploadIdentity(currentDraft) === undefined
      ) {
        throw error;
      }

      currentDraft = emitWorkspaceHomePhotoDraftState(
        markWorkspaceHomePhotoDraftUploadPending(
          await initiateWorkspaceHomePhotoDraftUpload(
            currentDraft,
            options.fetchImplementation,
            options.signal,
          ),
        ),
        options.onStateChange,
      );

      if (currentDraft.uploadToken === undefined) {
        throw new Error(WORKSPACE_HOME_PHOTO_DRAFT_UPLOAD_RESPONSE_INVALID_ERROR);
      }

      return await uploadWorkspaceHomePhotoDraftFile(
        currentDraft,
        currentDraft.uploadToken,
        options,
      );
    }
  } catch (error) {
    currentDraft = emitWorkspaceHomePhotoDraftState(
      markWorkspaceHomePhotoDraftUploadFailed(
        currentDraft,
        readWorkspaceHomePhotoDraftUploadErrorMessage(error),
      ),
      options.onStateChange,
    );
    throw error;
  }
}
