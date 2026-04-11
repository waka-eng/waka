export const WORKSPACE_HOME_VOICE_CAPTURE_UNSUPPORTED_ERROR =
  "Voice capture is unavailable in this browser.";
export const WORKSPACE_HOME_VOICE_CAPTURE_PERMISSION_DENIED_ERROR =
  "Microphone access is blocked. Allow it in the browser and try again.";
export const WORKSPACE_HOME_VOICE_CAPTURE_DEVICE_MISSING_ERROR =
  "No microphone is available for voice capture.";
export const WORKSPACE_HOME_VOICE_CAPTURE_START_ERROR =
  "Voice capture couldn't start. Try again.";
export const WORKSPACE_HOME_VOICE_CAPTURE_STOP_ERROR =
  "Voice capture couldn't stop cleanly. Try again.";
export const WORKSPACE_HOME_VOICE_CAPTURE_DEFAULT_MIME_TYPE = "audio/webm";

export type WorkspaceHomeVoiceCaptureStatus = "idle" | "recording" | "error";

export interface WorkspaceHomeVoiceCaptureState {
  errorMessage?: string;
  status: WorkspaceHomeVoiceCaptureStatus;
}

export interface WorkspaceHomeVoiceCaptureTrackLike {
  stop(): void;
}

export interface WorkspaceHomeVoiceCaptureStreamLike {
  getTracks(): readonly WorkspaceHomeVoiceCaptureTrackLike[];
}

export interface WorkspaceHomeVoiceCaptureRecorderLike {
  addEventListener?(
    type: "dataavailable",
    listener: WorkspaceHomeVoiceCaptureDataAvailableListener,
  ): void;
  addEventListener?(
    type: "stop",
    listener: WorkspaceHomeVoiceCaptureStopListener,
  ): void;
  ondataavailable?: WorkspaceHomeVoiceCaptureDataAvailableListener | null;
  onstop?: WorkspaceHomeVoiceCaptureStopListener | null;
  mimeType?: string;
  start(): void;
  stop(): void;
  state?: string;
}

export interface WorkspaceHomeVoiceCaptureDataAvailableEventLike {
  data: Blob;
}

export type WorkspaceHomeVoiceCaptureDataAvailableListener = (
  event: WorkspaceHomeVoiceCaptureDataAvailableEventLike,
) => void;

export type WorkspaceHomeVoiceCaptureStopListener = () => void;

export interface WorkspaceHomeVoiceCaptureRecorderConstructorLike {
  new (
    stream: WorkspaceHomeVoiceCaptureStreamLike,
  ): WorkspaceHomeVoiceCaptureRecorderLike;
}

export interface WorkspaceHomeVoiceCaptureMediaDevicesLike {
  getUserMedia(
    constraints: MediaStreamConstraints,
  ): Promise<WorkspaceHomeVoiceCaptureStreamLike>;
}

export interface WorkspaceHomeVoiceCaptureSession {
  audioChunks: Blob[];
  recorder: WorkspaceHomeVoiceCaptureRecorderLike;
  startedAt?: number;
  stopPromise?: Promise<WorkspaceHomeVoiceCaptureCompletedPayload>;
  stream: WorkspaceHomeVoiceCaptureStreamLike;
}

export interface WorkspaceHomeVoiceCaptureCompletedPayload {
  audioBlob: Blob;
  audioChunks: Blob[];
  durationMs: number;
  durationSeconds: number;
  mimeType: string;
  sizeBytes: number;
  sourceMeta: WorkspaceHomeVoiceCaptureUploadSourceMeta;
  sourceType: "VOICE_NOTE";
  uploadHandoff: WorkspaceHomeVoiceCaptureUploadHandoffPayload;
}

export interface WorkspaceHomeVoiceCaptureUploadSourceMeta {
  durationSeconds: number;
  mimeType: string;
  sizeBytes: number;
}

export interface WorkspaceHomeVoiceCaptureUploadHandoffPayload {
  audioBlob: Blob;
  audioDurationSeconds: number;
  audioMimeType: string;
  audioSizeBytes: number;
  mimeType: string;
  sizeBytes: number;
  sourceMeta: WorkspaceHomeVoiceCaptureUploadSourceMeta;
  sourceType: "VOICE_NOTE";
}

export interface InitializeWorkspaceHomeVoiceCaptureSessionOptions {
  MediaRecorder?: WorkspaceHomeVoiceCaptureRecorderConstructorLike;
  mediaDevices?: WorkspaceHomeVoiceCaptureMediaDevicesLike;
}

export interface StartWorkspaceHomeVoiceCaptureOptions
  extends InitializeWorkspaceHomeVoiceCaptureSessionOptions {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stopWorkspaceHomeVoiceCaptureTracks(
  stream: WorkspaceHomeVoiceCaptureStreamLike,
): void {
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

function registerWorkspaceHomeVoiceCaptureDataHandler(
  recorder: WorkspaceHomeVoiceCaptureRecorderLike,
  audioChunks: Blob[],
): void {
  const handleDataAvailable: WorkspaceHomeVoiceCaptureDataAvailableListener = (
    event,
  ) => {
    if (!(event.data instanceof Blob) || event.data.size < 1) {
      return;
    }

    audioChunks.push(event.data);
  };

  if (typeof recorder.addEventListener === "function") {
    recorder.addEventListener("dataavailable", handleDataAvailable);
    return;
  }

  recorder.ondataavailable = handleDataAvailable;
}

function registerWorkspaceHomeVoiceCaptureStopHandler(
  recorder: WorkspaceHomeVoiceCaptureRecorderLike,
  onStop: WorkspaceHomeVoiceCaptureStopListener,
): void {
  if (typeof recorder.addEventListener === "function") {
    recorder.addEventListener("stop", onStop);
    return;
  }

  const existingStopListener = recorder.onstop;

  recorder.onstop = () => {
    existingStopListener?.();
    onStop();
  };
}

function readWorkspaceHomeVoiceCaptureMimeType(
  session: WorkspaceHomeVoiceCaptureSession,
): string {
  if (
    typeof session.recorder.mimeType === "string" &&
    session.recorder.mimeType.trim().length > 0
  ) {
    return session.recorder.mimeType.trim();
  }

  for (const audioChunk of session.audioChunks) {
    if (audioChunk.type.trim().length > 0) {
      return audioChunk.type.trim();
    }
  }

  return WORKSPACE_HOME_VOICE_CAPTURE_DEFAULT_MIME_TYPE;
}

function assembleWorkspaceHomeVoiceCaptureAudioBlob(
  audioChunks: readonly Blob[],
  mimeType: string,
): Blob {
  return new Blob([...audioChunks], {
    type: mimeType,
  });
}

export function createWorkspaceHomeVoiceCaptureUploadHandoffPayload(
  payload: Pick<
    WorkspaceHomeVoiceCaptureCompletedPayload,
    "audioBlob" | "durationSeconds" | "mimeType" | "sizeBytes"
  >,
): WorkspaceHomeVoiceCaptureUploadHandoffPayload {
  return {
    audioBlob: payload.audioBlob,
    audioDurationSeconds: payload.durationSeconds,
    audioMimeType: payload.mimeType,
    audioSizeBytes: payload.sizeBytes,
    mimeType: payload.mimeType,
    sizeBytes: payload.sizeBytes,
    sourceMeta: {
      durationSeconds: payload.durationSeconds,
      mimeType: payload.mimeType,
      sizeBytes: payload.sizeBytes,
    },
    sourceType: "VOICE_NOTE",
  };
}

function createWorkspaceHomeVoiceCaptureCompletedPayload(
  session: WorkspaceHomeVoiceCaptureSession,
): WorkspaceHomeVoiceCaptureCompletedPayload {
  const mimeType = readWorkspaceHomeVoiceCaptureMimeType(session);
  const recordedAt = Date.now();
  const durationMs = Math.max(
    recordedAt - (session.startedAt ?? recordedAt),
    0,
  );
  const audioBlob = assembleWorkspaceHomeVoiceCaptureAudioBlob(
    session.audioChunks,
    mimeType,
  );
  const sizeBytes = audioBlob.size;
  const uploadHandoff = createWorkspaceHomeVoiceCaptureUploadHandoffPayload({
    audioBlob,
    durationSeconds: durationMs / 1000,
    mimeType,
    sizeBytes,
  });

  return {
    audioBlob,
    audioChunks: [...session.audioChunks],
    durationMs,
    durationSeconds: durationMs / 1000,
    mimeType,
    sizeBytes,
    sourceMeta: uploadHandoff.sourceMeta,
    sourceType: uploadHandoff.sourceType,
    uploadHandoff,
  };
}

function readStartErrorName(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.name !== "string") {
    return undefined;
  }

  return error.name;
}

function resolveMediaDevices(
  options: InitializeWorkspaceHomeVoiceCaptureSessionOptions,
): WorkspaceHomeVoiceCaptureMediaDevicesLike | undefined {
  if (options.mediaDevices !== undefined) {
    return options.mediaDevices;
  }

  return globalThis.navigator?.mediaDevices;
}

function resolveMediaRecorderConstructor(
  options: InitializeWorkspaceHomeVoiceCaptureSessionOptions,
): WorkspaceHomeVoiceCaptureRecorderConstructorLike | undefined {
  if (options.MediaRecorder !== undefined) {
    return options.MediaRecorder;
  }

  return globalThis.MediaRecorder as unknown as
    | WorkspaceHomeVoiceCaptureRecorderConstructorLike
    | undefined;
}

export function getWorkspaceHomeVoiceCaptureIdleState(): WorkspaceHomeVoiceCaptureState {
  return {
    status: "idle",
  };
}

export function getWorkspaceHomeVoiceCaptureRecordingState(): WorkspaceHomeVoiceCaptureState {
  return {
    status: "recording",
  };
}

export function createWorkspaceHomeVoiceCaptureErrorState(
  errorMessage: string,
): WorkspaceHomeVoiceCaptureState {
  return {
    errorMessage,
    status: "error",
  };
}

export function getWorkspaceHomeVoiceCaptureStatusLabel(
  state: WorkspaceHomeVoiceCaptureState,
): string {
  switch (state.status) {
    case "recording":
      return "Recording";
    case "error":
      return "Error";
    default:
      return "Idle";
  }
}

export function getWorkspaceHomeVoiceCaptureHelperText(
  state: WorkspaceHomeVoiceCaptureState,
): string {
  switch (state.status) {
    case "recording":
      return "Recording from your microphone. Stop when the note is ready.";
    case "error":
      return state.errorMessage ?? WORKSPACE_HOME_VOICE_CAPTURE_START_ERROR;
    default:
      return "Tap the mic to start a voice note without leaving the capture bar.";
  }
}

export function readWorkspaceHomeVoiceCaptureErrorMessage(
  error: unknown,
): string {
  const errorName = readStartErrorName(error);

  if (errorName === "NotAllowedError" || errorName === "SecurityError") {
    return WORKSPACE_HOME_VOICE_CAPTURE_PERMISSION_DENIED_ERROR;
  }

  if (errorName === "NotFoundError") {
    return WORKSPACE_HOME_VOICE_CAPTURE_DEVICE_MISSING_ERROR;
  }

  if (
    error instanceof Error &&
    (error.message === WORKSPACE_HOME_VOICE_CAPTURE_UNSUPPORTED_ERROR ||
      error.message === WORKSPACE_HOME_VOICE_CAPTURE_STOP_ERROR)
  ) {
    return error.message;
  }

  return WORKSPACE_HOME_VOICE_CAPTURE_START_ERROR;
}

export async function startWorkspaceHomeVoiceCapture(
  options: StartWorkspaceHomeVoiceCaptureOptions = {},
): Promise<WorkspaceHomeVoiceCaptureSession> {
  const session = await initializeWorkspaceHomeVoiceCaptureSession(options);

  try {
    session.recorder.start();
    session.startedAt = Date.now();

    return session;
  } catch (error) {
    stopWorkspaceHomeVoiceCaptureTracks(session.stream);
    throw new Error(readWorkspaceHomeVoiceCaptureErrorMessage(error), {
      cause: error,
    });
  }
}

export async function initializeWorkspaceHomeVoiceCaptureSession(
  options: InitializeWorkspaceHomeVoiceCaptureSessionOptions = {},
): Promise<WorkspaceHomeVoiceCaptureSession> {
  const mediaDevices = resolveMediaDevices(options);
  const MediaRecorderConstructor = resolveMediaRecorderConstructor(options);

  if (
    mediaDevices === undefined ||
    typeof mediaDevices.getUserMedia !== "function" ||
    MediaRecorderConstructor === undefined
  ) {
    throw new Error(WORKSPACE_HOME_VOICE_CAPTURE_UNSUPPORTED_ERROR);
  }

  try {
    const stream = await mediaDevices.getUserMedia({
      audio: true,
    });

    try {
      const recorder = new MediaRecorderConstructor(stream);
      const audioChunks: Blob[] = [];

      registerWorkspaceHomeVoiceCaptureDataHandler(recorder, audioChunks);

      return {
        audioChunks,
        recorder,
        stream,
      };
    } catch (error) {
      stopWorkspaceHomeVoiceCaptureTracks(stream);
      throw error;
    }
  } catch (error) {
    throw new Error(readWorkspaceHomeVoiceCaptureErrorMessage(error), {
      cause: error,
    });
  }
}

export function stopWorkspaceHomeVoiceCapture(
  session: WorkspaceHomeVoiceCaptureSession,
): Promise<WorkspaceHomeVoiceCaptureCompletedPayload> {
  if (session.stopPromise !== undefined) {
    return session.stopPromise;
  }

  session.stopPromise = new Promise<
    WorkspaceHomeVoiceCaptureCompletedPayload
  >((resolve, reject) => {
    let isFinalized = false;

    const finalize = (): void => {
      if (isFinalized) {
        return;
      }

      isFinalized = true;

      try {
        resolve(createWorkspaceHomeVoiceCaptureCompletedPayload(session));
      } catch (error) {
        reject(error);
      } finally {
        stopWorkspaceHomeVoiceCaptureTracks(session.stream);
      }
    };

    if (session.recorder.state === "inactive") {
      finalize();
      return;
    }

    registerWorkspaceHomeVoiceCaptureStopHandler(session.recorder, finalize);

    try {
      session.recorder.stop();
    } catch (error) {
      stopWorkspaceHomeVoiceCaptureTracks(session.stream);
      reject(
        new Error(WORKSPACE_HOME_VOICE_CAPTURE_STOP_ERROR, {
          cause: error,
        }),
      );
    }
  });

  return session.stopPromise;
}
