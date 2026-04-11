import type { InspirationAudioUploadMetadata } from "../inspirations/create-route.ts";
import { normalizeAudioUploadContentType } from "./audio-upload-config.ts";

export const COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_PENDING = "PENDING";
export const COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_PROCESSING =
  "PROCESSING";
export const COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_COMPLETED =
  "COMPLETED";
export const COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_FAILED = "FAILED";

const COMPLETE_AUDIO_CAPTURE_RECORD_SELECT = {
  audioDurationSeconds: true,
  audioMimeType: true,
  audioSizeBytes: true,
  audioStorageKey: true,
  audioStorageUrl: true,
  id: true,
  rawContent: true,
  sourceType: true,
} as const;

const claimedAudioCaptureFinalizationState = new WeakMap<object, boolean>();

export interface CompleteAudioCaptureInput {
  contentType: string;
  durationSeconds: number;
  mediaUrl: string;
  objectKey: string;
  sizeBytes: number;
  voiceCaptureId: string;
}

export interface CompleteAudioCapturePersistenceArgs {
  data: CompleteAudioCapturePersistenceData;
  select: typeof COMPLETE_AUDIO_CAPTURE_RECORD_SELECT;
  where: {
    userId_id: {
      id: string;
      userId: string;
    };
  };
}

export interface CompleteAudioCapturePersistenceData
  extends InspirationAudioUploadMetadata {
  audioTranscriptionStatus?: string;
  mediaUrl?: string;
  rawContent?: string;
  transcript?: string;
}

export interface ClaimCompleteAudioCapturePersistenceArgs {
  data: CompleteAudioCapturePersistenceData;
  where: {
    audioTranscriptionStatus: null;
    id: string;
    userId: string;
  };
}

export interface ClaimCompleteAudioCapturePersistenceResult {
  count: number;
}

export interface ReadCompletedAudioCaptureArgs {
  select: typeof COMPLETE_AUDIO_CAPTURE_RECORD_SELECT;
  where: {
    userId_id: {
      id: string;
      userId: string;
    };
  };
}

export interface CompletedAudioCaptureRecord
  extends InspirationAudioUploadMetadata {
  id: string;
  rawContent: string;
  sourceType: "VOICE_NOTE";
}

export interface CompleteAudioCapturePersistenceClient<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
> {
  inspiration: {
    findUnique(
      args: ReadCompletedAudioCaptureArgs,
    ): Promise<TRecord | null>;
    update(args: CompleteAudioCapturePersistenceArgs): Promise<TRecord>;
    updateMany(
      args: ClaimCompleteAudioCapturePersistenceArgs,
    ): Promise<ClaimCompleteAudioCapturePersistenceResult>;
  };
}

export interface CompleteAudioCaptureService<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
> {
  complete(userId: string, input: CompleteAudioCaptureInput): Promise<TRecord>;
  didClaimFinalization?(record: TRecord): boolean;
  markTranscriptionCompleted?(
    userId: string,
    voiceCaptureId: string,
    transcript: string,
  ): Promise<void>;
  markTranscriptionFailed?(
    userId: string,
    voiceCaptureId: string,
  ): Promise<void>;
  markTranscriptionProcessing?(
    userId: string,
    voiceCaptureId: string,
  ): Promise<void>;
}

export interface CompleteAudioCaptureServiceDependencies<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
> {
  voiceCaptureRepository: CompleteAudioCapturePersistenceClient<TRecord>;
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

function readRequiredNonNegativeNumber(value: number, fieldName: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError(`${fieldName} must be a non-negative number.`);
  }

  return value;
}

export function normalizeCompleteAudioCaptureInput(
  input: CompleteAudioCaptureInput,
): CompleteAudioCaptureInput {
  return {
    contentType: normalizeAudioUploadContentType(
      readRequiredNonEmptyString(input.contentType, "contentType"),
    ),
    durationSeconds: readRequiredNonNegativeNumber(
      input.durationSeconds,
      "durationSeconds",
    ),
    mediaUrl: readRequiredAbsoluteUrl(input.mediaUrl, "mediaUrl"),
    objectKey: readRequiredNonEmptyString(input.objectKey, "objectKey"),
    sizeBytes: readRequiredPositiveInteger(input.sizeBytes, "sizeBytes"),
    voiceCaptureId: readRequiredNonEmptyString(
      input.voiceCaptureId,
      "voiceCaptureId",
    ),
  };
}

export function buildCompleteAudioCapturePersistenceArgs(
  userId: string,
  input: CompleteAudioCaptureInput,
): CompleteAudioCapturePersistenceArgs {
  const normalizedInput = normalizeCompleteAudioCaptureInput(input);
  const normalizedUserId = readRequiredNonEmptyString(userId, "userId");

  return {
    data: {
      audioDurationSeconds: normalizedInput.durationSeconds,
      audioMimeType: normalizedInput.contentType,
      audioSizeBytes: normalizedInput.sizeBytes,
      audioStorageKey: normalizedInput.objectKey,
      audioStorageUrl: normalizedInput.mediaUrl,
      audioTranscriptionStatus:
        COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_PENDING,
      mediaUrl: normalizedInput.mediaUrl,
    },
    select: COMPLETE_AUDIO_CAPTURE_RECORD_SELECT,
    where: {
      userId_id: {
        id: normalizedInput.voiceCaptureId,
        userId: normalizedUserId,
      },
    },
  };
}

export function buildClaimCompleteAudioCapturePersistenceArgs(
  userId: string,
  input: CompleteAudioCaptureInput,
): ClaimCompleteAudioCapturePersistenceArgs {
  const completeArgs = buildCompleteAudioCapturePersistenceArgs(userId, input);

  return {
    data: completeArgs.data,
    where: {
      audioTranscriptionStatus: null,
      id: completeArgs.where.userId_id.id,
      userId: completeArgs.where.userId_id.userId,
    },
  };
}

export function buildReadCompletedAudioCaptureArgs(
  userId: string,
  voiceCaptureId: string,
): ReadCompletedAudioCaptureArgs {
  const normalizedUserId = readRequiredNonEmptyString(userId, "userId");
  const normalizedVoiceCaptureId = readRequiredNonEmptyString(
    voiceCaptureId,
    "voiceCaptureId",
  );

  return {
    select: COMPLETE_AUDIO_CAPTURE_RECORD_SELECT,
    where: {
      userId_id: {
        id: normalizedVoiceCaptureId,
        userId: normalizedUserId,
      },
    },
  };
}

export function buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs(
  userId: string,
  voiceCaptureId: string,
): CompleteAudioCapturePersistenceArgs {
  const normalizedUserId = readRequiredNonEmptyString(userId, "userId");
  const normalizedVoiceCaptureId = readRequiredNonEmptyString(
    voiceCaptureId,
    "voiceCaptureId",
  );

  return {
    data: {
      audioTranscriptionStatus:
        COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_PROCESSING,
    },
    select: COMPLETE_AUDIO_CAPTURE_RECORD_SELECT,
    where: {
      userId_id: {
        id: normalizedVoiceCaptureId,
        userId: normalizedUserId,
      },
    },
  };
}

export function buildMarkAudioCaptureTranscriptionCompletedPersistenceArgs(
  userId: string,
  voiceCaptureId: string,
  transcript: string,
): CompleteAudioCapturePersistenceArgs {
  const normalizedUserId = readRequiredNonEmptyString(userId, "userId");
  const normalizedVoiceCaptureId = readRequiredNonEmptyString(
    voiceCaptureId,
    "voiceCaptureId",
  );
  const normalizedTranscript = readRequiredNonEmptyString(
    transcript,
    "transcript",
  );

  return {
    data: {
      audioTranscriptionStatus:
        COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_COMPLETED,
      rawContent: normalizedTranscript,
      transcript: normalizedTranscript,
    },
    select: COMPLETE_AUDIO_CAPTURE_RECORD_SELECT,
    where: {
      userId_id: {
        id: normalizedVoiceCaptureId,
        userId: normalizedUserId,
      },
    },
  };
}

export function buildMarkAudioCaptureTranscriptionFailedPersistenceArgs(
  userId: string,
  voiceCaptureId: string,
): CompleteAudioCapturePersistenceArgs {
  const normalizedUserId = readRequiredNonEmptyString(userId, "userId");
  const normalizedVoiceCaptureId = readRequiredNonEmptyString(
    voiceCaptureId,
    "voiceCaptureId",
  );

  return {
    data: {
      audioTranscriptionStatus:
        COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_FAILED,
    },
    select: COMPLETE_AUDIO_CAPTURE_RECORD_SELECT,
    where: {
      userId_id: {
        id: normalizedVoiceCaptureId,
        userId: normalizedUserId,
      },
    },
  };
}

function tagCompletedAudioCaptureFinalizationClaim<
  TRecord extends CompletedAudioCaptureRecord,
>(record: TRecord, didClaimFinalization: boolean): TRecord {
  claimedAudioCaptureFinalizationState.set(
    record as TRecord & object,
    didClaimFinalization,
  );

  return record;
}

export function didCompleteAudioCaptureClaimFinalization<
  TRecord extends CompletedAudioCaptureRecord,
>(record: TRecord): boolean {
  return (
    claimedAudioCaptureFinalizationState.get(record as TRecord & object) ===
    true
  );
}

export async function completeAudioCapture<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
>(
  client: CompleteAudioCapturePersistenceClient<TRecord>,
  userId: string,
  input: CompleteAudioCaptureInput,
): Promise<TRecord> {
  const normalizedInput = normalizeCompleteAudioCaptureInput(input);
  const claimResult = await client.inspiration.updateMany(
    buildClaimCompleteAudioCapturePersistenceArgs(userId, normalizedInput),
  );

  const completedCapture = await client.inspiration.findUnique(
    buildReadCompletedAudioCaptureArgs(
      userId,
      normalizedInput.voiceCaptureId,
    ),
  );

  if (completedCapture === null) {
    throw new Error(
      `Voice capture ${normalizedInput.voiceCaptureId} could not be read after upload completion.`,
    );
  }

  return tagCompletedAudioCaptureFinalizationClaim(
    completedCapture,
    claimResult.count > 0,
  );
}

export async function markAudioCaptureTranscriptionProcessing<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
>(
  client: CompleteAudioCapturePersistenceClient<TRecord>,
  userId: string,
  voiceCaptureId: string,
): Promise<void> {
  await client.inspiration.update(
    buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs(
      userId,
      voiceCaptureId,
    ),
  );
}

export async function markAudioCaptureTranscriptionCompleted<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
>(
  client: CompleteAudioCapturePersistenceClient<TRecord>,
  userId: string,
  voiceCaptureId: string,
  transcript: string,
): Promise<void> {
  await client.inspiration.update(
    buildMarkAudioCaptureTranscriptionCompletedPersistenceArgs(
      userId,
      voiceCaptureId,
      transcript,
    ),
  );
}

export async function markAudioCaptureTranscriptionFailed<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
>(
  client: CompleteAudioCapturePersistenceClient<TRecord>,
  userId: string,
  voiceCaptureId: string,
): Promise<void> {
  await client.inspiration.update(
    buildMarkAudioCaptureTranscriptionFailedPersistenceArgs(
      userId,
      voiceCaptureId,
    ),
  );
}

export function createCompleteAudioCaptureService<
  TRecord extends CompletedAudioCaptureRecord = CompletedAudioCaptureRecord,
>(
  dependencies: CompleteAudioCaptureServiceDependencies<TRecord>,
): CompleteAudioCaptureService<TRecord> {
  return {
    async complete(userId, input) {
      return completeAudioCapture(
        dependencies.voiceCaptureRepository,
        userId,
        input,
      );
    },
    didClaimFinalization(record) {
      return didCompleteAudioCaptureClaimFinalization(record);
    },
    async markTranscriptionProcessing(userId, voiceCaptureId) {
      await markAudioCaptureTranscriptionProcessing(
        dependencies.voiceCaptureRepository,
        userId,
        voiceCaptureId,
      );
    },
    async markTranscriptionCompleted(userId, voiceCaptureId, transcript) {
      await markAudioCaptureTranscriptionCompleted(
        dependencies.voiceCaptureRepository,
        userId,
        voiceCaptureId,
        transcript,
      );
    },
    async markTranscriptionFailed(userId, voiceCaptureId) {
      await markAudioCaptureTranscriptionFailed(
        dependencies.voiceCaptureRepository,
        userId,
        voiceCaptureId,
      );
    },
  };
}
