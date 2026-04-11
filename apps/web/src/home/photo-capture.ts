import {
  getWorkspaceHomePhotoSourceOption,
  WORKSPACE_HOME_PHOTO_SOURCE_CAMERA,
  type WorkspaceHomePhotoSource,
  type WorkspaceHomePhotoSourceIntakePath,
} from "./photo-source-entry.ts";

export const WORKSPACE_HOME_LOCAL_IMAGE_SOURCE_TYPE = "PHOTO";
export const WORKSPACE_HOME_PHOTO_CAPTURE_UNSUPPORTED_ERROR =
  "Photo capture is unavailable in this browser.";
export const WORKSPACE_HOME_PHOTO_CAPTURE_PERMISSION_DENIED_ERROR =
  "Camera access is blocked. Allow it in the browser and try again.";
export const WORKSPACE_HOME_PHOTO_CAPTURE_DEVICE_MISSING_ERROR =
  "No camera is available for photo capture.";
export const WORKSPACE_HOME_PHOTO_CAPTURE_START_ERROR =
  "Photo capture couldn't start. Try again.";
export const WORKSPACE_HOME_PHOTO_CAPTURE_IMAGE_ERROR =
  "Photo capture couldn't create an image. Try again.";
export const WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR =
  "Selected image couldn't be prepared. Try another one.";
export const WORKSPACE_HOME_PHOTO_CAPTURE_IDLE_HELPER_TEXT =
  "Choose camera for a fresh shot or gallery for an existing image without leaving the capture bar.";
export const WORKSPACE_HOME_PHOTO_CAPTURE_DEFAULT_FILE_PREFIX =
  "camera-capture";
export const WORKSPACE_HOME_PHOTO_CAPTURE_DEFAULT_MIME_TYPE = "image/jpeg";
export const WORKSPACE_HOME_PHOTO_CAPTURE_DEFAULT_QUALITY = 0.92;
export const WORKSPACE_HOME_PHOTO_CAPTURE_READY_TIMEOUT_MS = 2000;

export interface WorkspaceHomeLocalImageSourceMeta {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

export interface WorkspaceHomeLocalImagePayload {
  fileName: string;
  imageFile: File;
  intakePath: WorkspaceHomePhotoSourceIntakePath;
  mimeType: string;
  sizeBytes: number;
  source: WorkspaceHomePhotoSource;
  sourceMeta: WorkspaceHomeLocalImageSourceMeta;
  sourceType: typeof WORKSPACE_HOME_LOCAL_IMAGE_SOURCE_TYPE;
}

export interface CreateWorkspaceHomeLocalImagePayloadInput {
  fileName: string;
  imageBlob: Blob;
  intakePath: WorkspaceHomePhotoSourceIntakePath;
  mimeType?: string;
  source: WorkspaceHomePhotoSource;
}

export interface CreateWorkspaceHomeSelectedLocalImagePayloadInput {
  imageFile: File;
  source: WorkspaceHomePhotoSource;
}

export interface CreateWorkspaceHomeLocalImagePayloadOptions {
  FileConstructor?: typeof File;
  now?: () => Date;
}

export interface CreateWorkspaceHomePhotoDraftOptions
  extends CreateWorkspaceHomeLocalImagePayloadOptions {
  createObjectUrl?: (blob: Blob) => string;
}

export interface ReleaseWorkspaceHomePhotoDraftPreviewOptions {
  revokeObjectUrl?: (objectUrl: string) => void;
}

export interface PrepareWorkspaceHomeCameraPhotoDraftOptions
  extends CaptureWorkspaceHomeCameraPhotoOptions,
    CreateWorkspaceHomePhotoDraftOptions {}

export interface PrepareWorkspaceHomeSelectedPhotoDraftOptions
  extends CreateWorkspaceHomePhotoDraftOptions {}

export interface WorkspaceHomePhotoDraftPreview {
  altText: string;
  fileName: string;
  objectUrl: string;
}

export interface WorkspaceHomePhotoDraftUploadRequest {
  fields: Record<string, string>;
  headers: Record<string, string>;
  method: "PUT";
  url: string;
}

export interface WorkspaceHomePhotoDraftUploadImageMetadata {
  contentType: string;
  fileName: string;
  mediaUrl: string;
  sizeBytes: number;
  storageKey: string;
}

export interface WorkspaceHomePhotoDraftUploadIdentity {
  mediaUrl: string;
  objectKey: string;
  storageKey: string;
}

export type WorkspaceHomePhotoDraftUploadStatus =
  | "failed"
  | "idle"
  | "pending"
  | "uploaded"
  | "uploading";

export interface WorkspaceHomePhotoDraftUploadState {
  errorMessage?: string;
  progressPercent: number;
  status: WorkspaceHomePhotoDraftUploadStatus;
  uploadedBytes: number;
}

export interface WorkspaceHomePhotoDraftUploadToken
  extends WorkspaceHomePhotoDraftUploadIdentity {
  image: WorkspaceHomePhotoDraftUploadImageMetadata;
  upload: WorkspaceHomePhotoDraftUploadRequest;
}

export interface WorkspaceHomePhotoUploadHandoffPayload {
  fileName: string;
  imageFile: File;
  mimeType: string;
  sizeBytes: number;
  sourceMeta: WorkspaceHomeLocalImageSourceMeta;
  sourceType: typeof WORKSPACE_HOME_LOCAL_IMAGE_SOURCE_TYPE;
}

export interface WorkspaceHomePhotoDraft extends WorkspaceHomeLocalImagePayload {
  preview: WorkspaceHomePhotoDraftPreview;
  uploadIdentity?: WorkspaceHomePhotoDraftUploadIdentity;
  uploadState: WorkspaceHomePhotoDraftUploadState;
  uploadToken?: WorkspaceHomePhotoDraftUploadToken;
  uploadHandoff: WorkspaceHomePhotoUploadHandoffPayload;
}

export type WorkspaceHomePhotoDraftErrorCode =
  | "device-missing"
  | "image-invalid"
  | "permission-denied"
  | "selection-invalid"
  | "start-failed"
  | "unsupported";

export interface WorkspaceHomePhotoDraftErrorState {
  code: WorkspaceHomePhotoDraftErrorCode;
  feedbackMessage: string;
  intakePath: WorkspaceHomePhotoSourceIntakePath;
  nextStep: string;
  source: WorkspaceHomePhotoSource;
  status: "error";
}

export interface WorkspaceHomePhotoDraftReadyState {
  draft: WorkspaceHomePhotoDraft;
  feedbackMessage: string;
  intakePath: WorkspaceHomePhotoSourceIntakePath;
  source: WorkspaceHomePhotoSource;
  status: "ready";
}

export type WorkspaceHomePhotoDraftResult =
  | WorkspaceHomePhotoDraftErrorState
  | WorkspaceHomePhotoDraftReadyState;

export interface WorkspaceHomePhotoCaptureTrackLike {
  stop(): void;
}

export interface WorkspaceHomePhotoCaptureStreamLike {
  getTracks(): readonly WorkspaceHomePhotoCaptureTrackLike[];
}

export interface WorkspaceHomePhotoCaptureMediaDevicesLike {
  getUserMedia(
    constraints: MediaStreamConstraints,
  ): Promise<WorkspaceHomePhotoCaptureStreamLike>;
}

export type WorkspaceHomePhotoCaptureVideoEvent = "canplay" | "loadedmetadata";

export interface WorkspaceHomePhotoCaptureVideoElementLike {
  addEventListener?(
    type: WorkspaceHomePhotoCaptureVideoEvent,
    listener: () => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  autoplay: boolean;
  muted: boolean;
  pause?(): void;
  play(): Promise<void>;
  playsInline: boolean;
  removeEventListener?(
    type: WorkspaceHomePhotoCaptureVideoEvent,
    listener: () => void,
  ): void;
  srcObject: unknown;
  videoHeight: number;
  videoWidth: number;
}

export interface WorkspaceHomePhotoCaptureCanvasRenderingContextLike {
  drawImage(
    image: unknown,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number,
  ): void;
}

export interface WorkspaceHomePhotoCaptureCanvasElementLike {
  getContext(
    contextId: "2d",
  ): WorkspaceHomePhotoCaptureCanvasRenderingContextLike | null;
  height: number;
  toBlob(
    callback: BlobCallback,
    type?: string,
    quality?: number,
  ): void;
  width: number;
}

export interface CaptureWorkspaceHomeCameraPhotoOptions {
  createCanvasElement?: () => WorkspaceHomePhotoCaptureCanvasElementLike;
  createVideoElement?: () => WorkspaceHomePhotoCaptureVideoElementLike;
  mediaDevices?: WorkspaceHomePhotoCaptureMediaDevicesLike;
  now?: () => Date;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredNonEmptyString(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string.`);
  }

  return normalizedValue;
}

function readNormalizedMimeType(value: string): string {
  return readRequiredNonEmptyString(value, "mimeType").toLowerCase();
}

function stopWorkspaceHomePhotoCaptureTracks(
  stream: WorkspaceHomePhotoCaptureStreamLike,
): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function readWorkspaceHomePhotoCaptureErrorName(
  error: unknown,
): string | undefined {
  if (!isRecord(error) || typeof error.name !== "string") {
    return undefined;
  }

  return error.name;
}

function readWorkspaceHomeExplicitBlobMimeType(
  imageBlob: Blob,
): string | undefined {
  const normalizedMimeType = imageBlob.type.trim().toLowerCase();

  return normalizedMimeType.length > 0 ? normalizedMimeType : undefined;
}

function readWorkspaceHomeCameraImageMimeType(imageBlob: Blob): string {
  return (
    readWorkspaceHomeExplicitBlobMimeType(imageBlob) ??
    WORKSPACE_HOME_PHOTO_CAPTURE_DEFAULT_MIME_TYPE
  );
}

function isWorkspaceHomeLocalImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

function inferWorkspaceHomeLocalImageMimeTypeFromFileName(
  fileName: string,
): string | undefined {
  const normalizedFileName = readRequiredNonEmptyString(fileName, "fileName")
    .replaceAll("\\", "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .at(-1)
    ?.toLowerCase();

  if (normalizedFileName === undefined) {
    return undefined;
  }

  if (normalizedFileName.endsWith(".avif")) {
    return "image/avif";
  }

  if (normalizedFileName.endsWith(".gif")) {
    return "image/gif";
  }

  if (normalizedFileName.endsWith(".heic")) {
    return "image/heic";
  }

  if (normalizedFileName.endsWith(".heif")) {
    return "image/heif";
  }

  if (normalizedFileName.endsWith(".jpeg") || normalizedFileName.endsWith(".jpg")) {
    return "image/jpeg";
  }

  if (normalizedFileName.endsWith(".png")) {
    return "image/png";
  }

  if (normalizedFileName.endsWith(".webp")) {
    return "image/webp";
  }

  return undefined;
}

function resolveWorkspaceHomeSelectedImageMimeType(imageFile: File): string {
  const explicitMimeType = readWorkspaceHomeExplicitBlobMimeType(imageFile);

  if (explicitMimeType !== undefined) {
    if (isWorkspaceHomeLocalImageMimeType(explicitMimeType)) {
      return explicitMimeType;
    }

    throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR);
  }

  const inferredMimeType = inferWorkspaceHomeLocalImageMimeTypeFromFileName(
    imageFile.name,
  );

  if (inferredMimeType !== undefined) {
    return inferredMimeType;
  }

  throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR);
}

function resolveWorkspaceHomeFileConstructor(
  options: CreateWorkspaceHomeLocalImagePayloadOptions,
): typeof File {
  if (options.FileConstructor !== undefined) {
    return options.FileConstructor;
  }

  if (typeof globalThis.File === "function") {
    return globalThis.File;
  }

  throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_UNSUPPORTED_ERROR);
}

function createWorkspaceHomeCameraCaptureFileName(now: Date): string {
  return `${WORKSPACE_HOME_PHOTO_CAPTURE_DEFAULT_FILE_PREFIX}-${now.getTime()}.jpg`;
}

function resolveWorkspaceHomePhotoDraftObjectUrlCreator(
  options: CreateWorkspaceHomePhotoDraftOptions,
): (blob: Blob) => string {
  if (options.createObjectUrl !== undefined) {
    return options.createObjectUrl;
  }

  if (typeof globalThis.URL?.createObjectURL === "function") {
    return (blob) => globalThis.URL.createObjectURL(blob);
  }

  throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_UNSUPPORTED_ERROR);
}

function resolveWorkspaceHomePhotoDraftObjectUrlRevoker(
  options: ReleaseWorkspaceHomePhotoDraftPreviewOptions,
): (objectUrl: string) => void {
  if (options.revokeObjectUrl !== undefined) {
    return options.revokeObjectUrl;
  }

  if (typeof globalThis.URL?.revokeObjectURL === "function") {
    return (objectUrl) => globalThis.URL.revokeObjectURL(objectUrl);
  }

  return () => undefined;
}

function hasWorkspaceHomePhotoCaptureDimensions(
  videoElement: WorkspaceHomePhotoCaptureVideoElementLike,
): boolean {
  return (
    Number.isFinite(videoElement.videoWidth) &&
    Number.isFinite(videoElement.videoHeight) &&
    videoElement.videoWidth > 0 &&
    videoElement.videoHeight > 0
  );
}

async function waitForWorkspaceHomePhotoCaptureVideoReady(
  videoElement: WorkspaceHomePhotoCaptureVideoElementLike,
): Promise<void> {
  if (hasWorkspaceHomePhotoCaptureDimensions(videoElement)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    if (
      typeof videoElement.addEventListener !== "function" ||
      typeof videoElement.removeEventListener !== "function"
    ) {
      reject(new Error(WORKSPACE_HOME_PHOTO_CAPTURE_IMAGE_ERROR));
      return;
    }

    const timeoutId = globalThis.setTimeout(() => {
      cleanup();
      reject(new Error(WORKSPACE_HOME_PHOTO_CAPTURE_IMAGE_ERROR));
    }, WORKSPACE_HOME_PHOTO_CAPTURE_READY_TIMEOUT_MS);

    const handleReady = (): void => {
      if (!hasWorkspaceHomePhotoCaptureDimensions(videoElement)) {
        return;
      }

      cleanup();
      resolve();
    };

    const cleanup = (): void => {
      globalThis.clearTimeout(timeoutId);
      videoElement.removeEventListener?.("loadedmetadata", handleReady);
      videoElement.removeEventListener?.("canplay", handleReady);
    };

    videoElement.addEventListener("loadedmetadata", handleReady, {
      once: true,
    });
    videoElement.addEventListener("canplay", handleReady, {
      once: true,
    });
  });
}

function resolveWorkspaceHomeMediaDevices(
  options: CaptureWorkspaceHomeCameraPhotoOptions,
): WorkspaceHomePhotoCaptureMediaDevicesLike | undefined {
  if (options.mediaDevices !== undefined) {
    return options.mediaDevices;
  }

  return globalThis.navigator?.mediaDevices;
}

function resolveWorkspaceHomePhotoCaptureVideoElement(
  options: CaptureWorkspaceHomeCameraPhotoOptions,
): WorkspaceHomePhotoCaptureVideoElementLike {
  if (options.createVideoElement !== undefined) {
    return options.createVideoElement();
  }

  if (typeof globalThis.document?.createElement !== "function") {
    throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_UNSUPPORTED_ERROR);
  }

  return globalThis.document.createElement("video");
}

function clampWorkspaceHomePhotoDraftUploadProgressPercent(
  progressPercent: number,
): number {
  if (!Number.isFinite(progressPercent)) {
    return 0;
  }

  return Math.min(100, Math.max(0, Math.round(progressPercent)));
}

function clampWorkspaceHomePhotoDraftUploadedBytes(
  uploadedBytes: number,
): number {
  if (!Number.isFinite(uploadedBytes)) {
    return 0;
  }

  return Math.max(0, Math.floor(uploadedBytes));
}

function resolveWorkspaceHomePhotoCaptureCanvasElement(
  options: CaptureWorkspaceHomeCameraPhotoOptions,
): WorkspaceHomePhotoCaptureCanvasElementLike {
  if (options.createCanvasElement !== undefined) {
    return options.createCanvasElement();
  }

  if (typeof globalThis.document?.createElement !== "function") {
    throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_UNSUPPORTED_ERROR);
  }

  return globalThis.document.createElement("canvas");
}

async function captureWorkspaceHomePhotoBlob(
  videoElement: WorkspaceHomePhotoCaptureVideoElementLike,
  options: CaptureWorkspaceHomeCameraPhotoOptions,
): Promise<Blob> {
  const canvasElement = resolveWorkspaceHomePhotoCaptureCanvasElement(options);
  const captureContext = canvasElement.getContext("2d");

  if (captureContext === null) {
    throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_IMAGE_ERROR);
  }

  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;
  captureContext.drawImage(
    videoElement,
    0,
    0,
    canvasElement.width,
    canvasElement.height,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvasElement.toBlob(
      (imageBlob) => {
        if (!(imageBlob instanceof Blob) || imageBlob.size < 1) {
          reject(new Error(WORKSPACE_HOME_PHOTO_CAPTURE_IMAGE_ERROR));
          return;
        }

        resolve(imageBlob);
      },
      WORKSPACE_HOME_PHOTO_CAPTURE_DEFAULT_MIME_TYPE,
      WORKSPACE_HOME_PHOTO_CAPTURE_DEFAULT_QUALITY,
    );
  });
}

export function createWorkspaceHomeLocalImagePayload(
  input: CreateWorkspaceHomeLocalImagePayloadInput,
  options: CreateWorkspaceHomeLocalImagePayloadOptions = {},
): WorkspaceHomeLocalImagePayload {
  const FileConstructor = resolveWorkspaceHomeFileConstructor(options);
  const fileName = readRequiredNonEmptyString(input.fileName, "fileName");
  const expectedIntakePath = getWorkspaceHomePhotoSourceOption(
    input.source,
  ).intakePath;

  if (!(input.imageBlob instanceof Blob) || input.imageBlob.size < 1) {
    throw new TypeError("imageBlob must contain at least 1 byte.");
  }

  if (input.intakePath !== expectedIntakePath) {
    throw new TypeError(`intakePath must match the ${input.source} source.`);
  }

  const mimeType =
    input.mimeType === undefined
      ? readWorkspaceHomeCameraImageMimeType(input.imageBlob)
      : readNormalizedMimeType(input.mimeType);

  if (!isWorkspaceHomeLocalImageMimeType(mimeType)) {
    throw new TypeError("mimeType must be an image MIME type.");
  }

  const imageFile = new FileConstructor([input.imageBlob], fileName, {
    lastModified: (options.now ?? (() => new Date()))().getTime(),
    type: mimeType,
  });
  const sizeBytes = imageFile.size;

  return {
    fileName,
    imageFile,
    intakePath: input.intakePath,
    mimeType,
    sizeBytes,
    source: input.source,
    sourceMeta: {
      fileName,
      mimeType,
      sizeBytes,
    },
    sourceType: WORKSPACE_HOME_LOCAL_IMAGE_SOURCE_TYPE,
  };
}

export function createWorkspaceHomeSelectedLocalImagePayload(
  input: CreateWorkspaceHomeSelectedLocalImagePayloadInput,
  options: CreateWorkspaceHomeLocalImagePayloadOptions = {},
): WorkspaceHomeLocalImagePayload {
  if (!(input.imageFile instanceof File) || input.imageFile.size < 1) {
    throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR);
  }

  const sourceOption = getWorkspaceHomePhotoSourceOption(input.source);

  try {
    return createWorkspaceHomeLocalImagePayload(
      {
        fileName: input.imageFile.name,
        imageBlob: input.imageFile,
        intakePath: sourceOption.intakePath,
        mimeType: resolveWorkspaceHomeSelectedImageMimeType(input.imageFile),
        source: sourceOption.source,
      },
      options,
    );
  } catch (error) {
    throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR, {
      cause: error,
    });
  }
}

export function validateWorkspaceHomePhotoDraft(
  localImagePayload: WorkspaceHomeLocalImagePayload,
): WorkspaceHomeLocalImagePayload {
  const sourceOption = getWorkspaceHomePhotoSourceOption(localImagePayload.source);
  const imageFile = localImagePayload.imageFile;

  if (!(imageFile instanceof File) || imageFile.size < 1) {
    throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR);
  }

  const mimeType =
    localImagePayload.source === WORKSPACE_HOME_PHOTO_SOURCE_CAMERA
      ? readWorkspaceHomeCameraImageMimeType(imageFile)
      : resolveWorkspaceHomeSelectedImageMimeType(imageFile);

  if (!isWorkspaceHomeLocalImageMimeType(mimeType)) {
    throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR);
  }

  if (localImagePayload.intakePath !== sourceOption.intakePath) {
    throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR);
  }

  return {
    ...localImagePayload,
    fileName: readRequiredNonEmptyString(localImagePayload.fileName, "fileName"),
    imageFile,
    intakePath: sourceOption.intakePath,
    mimeType,
    sizeBytes: imageFile.size,
    sourceMeta: {
      fileName: readRequiredNonEmptyString(localImagePayload.fileName, "fileName"),
      mimeType,
      sizeBytes: imageFile.size,
    },
  };
}

export function createWorkspaceHomePhotoUploadHandoffPayload(
  localImagePayload: WorkspaceHomeLocalImagePayload,
): WorkspaceHomePhotoUploadHandoffPayload {
  const validatedLocalImagePayload =
    validateWorkspaceHomePhotoDraft(localImagePayload);

  return {
    fileName: validatedLocalImagePayload.fileName,
    imageFile: validatedLocalImagePayload.imageFile,
    mimeType: validatedLocalImagePayload.mimeType,
    sizeBytes: validatedLocalImagePayload.sizeBytes,
    sourceMeta: validatedLocalImagePayload.sourceMeta,
    sourceType: validatedLocalImagePayload.sourceType,
  };
}

export function createWorkspaceHomePhotoDraftUploadIdleState(): WorkspaceHomePhotoDraftUploadState {
  return {
    progressPercent: 0,
    status: "idle",
    uploadedBytes: 0,
  };
}

export function markWorkspaceHomePhotoDraftUploadPending(
  draft: WorkspaceHomePhotoDraft,
): WorkspaceHomePhotoDraft {
  return {
    ...draft,
    uploadState: {
      progressPercent: 0,
      status: "pending",
      uploadedBytes: 0,
    },
  };
}

export function applyWorkspaceHomePhotoDraftUploadProgress(
  draft: WorkspaceHomePhotoDraft,
  progress: {
    loadedBytes: number;
    progressPercent: number;
  },
): WorkspaceHomePhotoDraft {
  return {
    ...draft,
    uploadState: {
      progressPercent: clampWorkspaceHomePhotoDraftUploadProgressPercent(
        progress.progressPercent,
      ),
      status: "uploading",
      uploadedBytes: Math.min(
        draft.sizeBytes,
        clampWorkspaceHomePhotoDraftUploadedBytes(progress.loadedBytes),
      ),
    },
  };
}

export function markWorkspaceHomePhotoDraftUploadCompleted(
  draft: WorkspaceHomePhotoDraft,
): WorkspaceHomePhotoDraft {
  return {
    ...draft,
    uploadState: {
      progressPercent: 100,
      status: "uploaded",
      uploadedBytes: draft.sizeBytes,
    },
  };
}

export function markWorkspaceHomePhotoDraftUploadFailed(
  draft: WorkspaceHomePhotoDraft,
  errorMessage: string,
): WorkspaceHomePhotoDraft {
  return {
    ...draft,
    uploadState: {
      ...draft.uploadState,
      errorMessage,
      progressPercent: clampWorkspaceHomePhotoDraftUploadProgressPercent(
        draft.uploadState.progressPercent,
      ),
      status: "failed",
      uploadedBytes: Math.min(
        draft.sizeBytes,
        clampWorkspaceHomePhotoDraftUploadedBytes(draft.uploadState.uploadedBytes),
      ),
    },
  };
}

export function resolveWorkspaceHomePhotoDraftUploadIdentity(
  draft: Pick<WorkspaceHomePhotoDraft, "uploadIdentity" | "uploadToken">,
): WorkspaceHomePhotoDraftUploadIdentity | undefined {
  if (draft.uploadIdentity !== undefined) {
    return draft.uploadIdentity;
  }

  if (draft.uploadToken === undefined) {
    return undefined;
  }

  return {
    mediaUrl: draft.uploadToken.mediaUrl,
    objectKey: draft.uploadToken.objectKey,
    storageKey: draft.uploadToken.storageKey,
  };
}

export function resetWorkspaceHomePhotoDraftUploadState(
  draft: WorkspaceHomePhotoDraft,
): WorkspaceHomePhotoDraft {
  const uploadIdentity = resolveWorkspaceHomePhotoDraftUploadIdentity(draft);
  const { uploadToken: _uploadToken, ...draftWithoutUploadToken } = draft;

  return {
    ...draftWithoutUploadToken,
    ...(uploadIdentity === undefined ? {} : { uploadIdentity }),
    uploadState: createWorkspaceHomePhotoDraftUploadIdleState(),
  };
}

export function createWorkspaceHomePhotoDraft(
  localImagePayload: WorkspaceHomeLocalImagePayload,
  options: CreateWorkspaceHomePhotoDraftOptions = {},
): WorkspaceHomePhotoDraft {
  const validatedLocalImagePayload =
    validateWorkspaceHomePhotoDraft(localImagePayload);
  const createObjectUrl = resolveWorkspaceHomePhotoDraftObjectUrlCreator(options);
  const objectUrl = createObjectUrl(validatedLocalImagePayload.imageFile).trim();

  if (objectUrl.length < 1) {
    throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_IMAGE_ERROR);
  }

  return {
    ...validatedLocalImagePayload,
    preview: {
      altText: `Photo preview for ${validatedLocalImagePayload.fileName}`,
      fileName: validatedLocalImagePayload.fileName,
      objectUrl,
    },
    uploadState: createWorkspaceHomePhotoDraftUploadIdleState(),
    uploadHandoff: createWorkspaceHomePhotoUploadHandoffPayload(
      validatedLocalImagePayload,
    ),
  };
}

function createWorkspaceHomePhotoDraftFeedbackMessage(
  source: WorkspaceHomePhotoSource,
  fileName: string,
): string {
  return source === WORKSPACE_HOME_PHOTO_SOURCE_CAMERA
    ? `Camera photo captured locally: ${fileName}.`
    : `Gallery photo selected locally: ${fileName}.`;
}

function resolveWorkspaceHomePhotoDraftErrorCode(
  feedbackMessage: string,
): WorkspaceHomePhotoDraftErrorCode {
  switch (feedbackMessage) {
    case WORKSPACE_HOME_PHOTO_CAPTURE_UNSUPPORTED_ERROR:
      return "unsupported";
    case WORKSPACE_HOME_PHOTO_CAPTURE_PERMISSION_DENIED_ERROR:
      return "permission-denied";
    case WORKSPACE_HOME_PHOTO_CAPTURE_DEVICE_MISSING_ERROR:
      return "device-missing";
    case WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR:
      return "selection-invalid";
    case WORKSPACE_HOME_PHOTO_CAPTURE_IMAGE_ERROR:
      return "image-invalid";
    default:
      return "start-failed";
  }
}

function resolveWorkspaceHomePhotoDraftNextStep(
  code: WorkspaceHomePhotoDraftErrorCode,
  source: WorkspaceHomePhotoSource,
): string {
  switch (code) {
    case "unsupported":
      return "Use a browser that supports local file previews and camera access.";
    case "permission-denied":
      return "Allow camera access in the browser, then try the photo capture again.";
    case "device-missing":
      return source === WORKSPACE_HOME_PHOTO_SOURCE_CAMERA
        ? "Switch to a device with a camera or choose from gallery instead."
        : "Switch to a device that can provide a photo, then try again.";
    case "selection-invalid":
      return "Choose a different image file and try again.";
    case "image-invalid":
      return "Retry the capture, or choose another image if this one is corrupted.";
    default:
      return "Retry the photo intake. If it keeps failing, switch to the other photo source.";
  }
}

export function createWorkspaceHomePhotoDraftReadyState(
  draft: WorkspaceHomePhotoDraft,
): WorkspaceHomePhotoDraftReadyState {
  return {
    draft,
    feedbackMessage: createWorkspaceHomePhotoDraftFeedbackMessage(
      draft.source,
      draft.fileName,
    ),
    intakePath: draft.intakePath,
    source: draft.source,
    status: "ready",
  };
}

export function createWorkspaceHomePhotoDraftErrorState(
  source: WorkspaceHomePhotoSource,
  error: unknown,
): WorkspaceHomePhotoDraftErrorState {
  const feedbackMessage = readWorkspaceHomePhotoCaptureErrorMessage(error);
  const intakePath = getWorkspaceHomePhotoSourceOption(source).intakePath;
  const code = resolveWorkspaceHomePhotoDraftErrorCode(feedbackMessage);

  return {
    code,
    feedbackMessage,
    intakePath,
    nextStep: resolveWorkspaceHomePhotoDraftNextStep(code, source),
    source,
    status: "error",
  };
}

export function releaseWorkspaceHomePhotoDraftPreview(
  draft: WorkspaceHomePhotoDraft | null | undefined,
  options: ReleaseWorkspaceHomePhotoDraftPreviewOptions = {},
): void {
  if (draft === null || draft === undefined) {
    return;
  }

  const objectUrl = draft.preview.objectUrl.trim();

  if (objectUrl.length < 1) {
    return;
  }

  resolveWorkspaceHomePhotoDraftObjectUrlRevoker(options)(objectUrl);
}

export async function prepareWorkspaceHomeCameraPhotoDraft(
  options: PrepareWorkspaceHomeCameraPhotoDraftOptions = {},
): Promise<WorkspaceHomePhotoDraftResult> {
  try {
    return createWorkspaceHomePhotoDraftReadyState(
      createWorkspaceHomePhotoDraft(
        await captureWorkspaceHomeCameraPhoto(options),
        options,
      ),
    );
  } catch (error) {
    return createWorkspaceHomePhotoDraftErrorState(
      WORKSPACE_HOME_PHOTO_SOURCE_CAMERA,
      error,
    );
  }
}

export function prepareWorkspaceHomeSelectedPhotoDraft(
  input: CreateWorkspaceHomeSelectedLocalImagePayloadInput,
  options: PrepareWorkspaceHomeSelectedPhotoDraftOptions = {},
): WorkspaceHomePhotoDraftResult {
  try {
    return createWorkspaceHomePhotoDraftReadyState(
      createWorkspaceHomePhotoDraft(
        createWorkspaceHomeSelectedLocalImagePayload(input, options),
        options,
      ),
    );
  } catch (error) {
    return createWorkspaceHomePhotoDraftErrorState(input.source, error);
  }
}

export function readWorkspaceHomePhotoCaptureErrorMessage(
  error: unknown,
): string {
  const errorName = readWorkspaceHomePhotoCaptureErrorName(error);

  if (errorName === "NotAllowedError" || errorName === "SecurityError") {
    return WORKSPACE_HOME_PHOTO_CAPTURE_PERMISSION_DENIED_ERROR;
  }

  if (errorName === "NotFoundError" || errorName === "OverconstrainedError") {
    return WORKSPACE_HOME_PHOTO_CAPTURE_DEVICE_MISSING_ERROR;
  }

  if (
    error instanceof Error &&
    (error.message === WORKSPACE_HOME_PHOTO_CAPTURE_UNSUPPORTED_ERROR ||
      error.message === WORKSPACE_HOME_PHOTO_CAPTURE_PERMISSION_DENIED_ERROR ||
      error.message === WORKSPACE_HOME_PHOTO_CAPTURE_DEVICE_MISSING_ERROR ||
      error.message === WORKSPACE_HOME_PHOTO_CAPTURE_START_ERROR ||
      error.message === WORKSPACE_HOME_PHOTO_CAPTURE_IMAGE_ERROR ||
      error.message === WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR)
  ) {
    return error.message;
  }

  return WORKSPACE_HOME_PHOTO_CAPTURE_START_ERROR;
}

export async function captureWorkspaceHomeCameraPhoto(
  options: CaptureWorkspaceHomeCameraPhotoOptions = {},
): Promise<WorkspaceHomeLocalImagePayload> {
  const mediaDevices = resolveWorkspaceHomeMediaDevices(options);

  if (
    mediaDevices === undefined ||
    typeof mediaDevices.getUserMedia !== "function"
  ) {
    throw new Error(WORKSPACE_HOME_PHOTO_CAPTURE_UNSUPPORTED_ERROR);
  }

  const videoElement = resolveWorkspaceHomePhotoCaptureVideoElement(options);
  let stream: WorkspaceHomePhotoCaptureStreamLike | undefined;

  try {
    stream = await mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: {
          ideal: "environment",
        },
      },
    });
    videoElement.autoplay = true;
    videoElement.muted = true;
    videoElement.playsInline = true;
    videoElement.srcObject = stream;

    await videoElement.play();
    await waitForWorkspaceHomePhotoCaptureVideoReady(videoElement);

    const imageBlob = await captureWorkspaceHomePhotoBlob(videoElement, options);
    const now = (options.now ?? (() => new Date()))();

    return createWorkspaceHomeLocalImagePayload(
      {
        fileName: createWorkspaceHomeCameraCaptureFileName(now),
        imageBlob,
        intakePath: "camera-capture",
        source: WORKSPACE_HOME_PHOTO_SOURCE_CAMERA,
      },
      {
        now: () => now,
      },
    );
  } catch (error) {
    throw new Error(readWorkspaceHomePhotoCaptureErrorMessage(error), {
      cause: error,
    });
  } finally {
    videoElement.pause?.();
    videoElement.srcObject = null;

    if (stream !== undefined) {
      stopWorkspaceHomePhotoCaptureTracks(stream);
    }
  }
}
