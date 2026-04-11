import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_COMPLETED,
  COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_FAILED,
  COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_PENDING,
  COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_PROCESSING,
  buildClaimCompleteAudioCapturePersistenceArgs,
  buildCompleteAudioCapturePersistenceArgs,
  buildMarkAudioCaptureTranscriptionCompletedPersistenceArgs,
  buildMarkAudioCaptureTranscriptionFailedPersistenceArgs,
  buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs,
  buildReadCompletedAudioCaptureArgs,
  completeAudioCapture,
  createCompleteAudioCaptureService,
  didCompleteAudioCaptureClaimFinalization,
  markAudioCaptureTranscriptionCompleted,
  markAudioCaptureTranscriptionFailed,
  markAudioCaptureTranscriptionProcessing,
  type CompleteAudioCapturePersistenceClient,
  type CompletedAudioCaptureRecord,
} from "../apps/web/src/media/complete-audio-capture.ts";

type AudioCaptureMutationArgs =
  ReturnType<typeof buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs>;

function createPersistenceClient(): {
  claimCalls: Array<ReturnType<typeof buildClaimCompleteAudioCapturePersistenceArgs>>;
  client: CompleteAudioCapturePersistenceClient;
  readCalls: Array<ReturnType<typeof buildReadCompletedAudioCaptureArgs>>;
  updateCalls: AudioCaptureMutationArgs[];
} {
  const claimCalls: Array<
    ReturnType<typeof buildClaimCompleteAudioCapturePersistenceArgs>
  > = [];
  const readCalls: Array<ReturnType<typeof buildReadCompletedAudioCaptureArgs>> =
    [];
  const updateCalls: AudioCaptureMutationArgs[] = [];
  const persistedState = {
    audioDurationSeconds: 0,
    audioMimeType: "",
    audioSizeBytes: 0,
    audioStorageKey: "",
    audioStorageUrl: "",
    audioTranscriptionStatus: null as string | null,
    id: "",
    rawContent: "Existing voice capture transcript",
    sourceType: "VOICE_NOTE" as const,
    userId: "",
  };

  function applyPersistedData(data: Record<string, unknown>): void {
    if (typeof data.audioDurationSeconds === "number") {
      persistedState.audioDurationSeconds = Number(data.audioDurationSeconds);
    }

    if (typeof data.audioMimeType === "string") {
      persistedState.audioMimeType = String(data.audioMimeType);
    }

    if (typeof data.audioSizeBytes === "number") {
      persistedState.audioSizeBytes = Number(data.audioSizeBytes);
    }

    if (typeof data.audioStorageKey === "string") {
      persistedState.audioStorageKey = String(data.audioStorageKey);
    }

    if (typeof data.audioStorageUrl === "string") {
      persistedState.audioStorageUrl = String(data.audioStorageUrl);
    }

    if (typeof data.audioTranscriptionStatus === "string") {
      persistedState.audioTranscriptionStatus = String(
        data.audioTranscriptionStatus,
      );
    }

    if (typeof data.rawContent === "string") {
      persistedState.rawContent = String(data.rawContent);
    }
  }

  function buildRecord(): CompletedAudioCaptureRecord | null {
    if (persistedState.id.length === 0 || persistedState.userId.length === 0) {
      return null;
    }

    return {
      audioDurationSeconds: persistedState.audioDurationSeconds,
      audioMimeType: persistedState.audioMimeType,
      audioSizeBytes: persistedState.audioSizeBytes,
      audioStorageKey: persistedState.audioStorageKey,
      audioStorageUrl: persistedState.audioStorageUrl,
      id: persistedState.id,
      rawContent: persistedState.rawContent,
      sourceType: persistedState.sourceType,
    } satisfies CompletedAudioCaptureRecord;
  }

  return {
    claimCalls,
    client: {
      inspiration: {
        async findUnique(args) {
          readCalls.push(args);

          if (
            persistedState.id !== args.where.userId_id.id ||
            persistedState.userId !== args.where.userId_id.userId
          ) {
            return null;
          }

          return buildRecord();
        },
        async update(args) {
          updateCalls.push(args);
          persistedState.id = args.where.userId_id.id;
          persistedState.userId = args.where.userId_id.userId;
          applyPersistedData(args.data);

          return buildRecord() as CompletedAudioCaptureRecord;
        },
        async updateMany(args) {
          claimCalls.push(args);

          if (
            persistedState.id.length > 0 &&
            (persistedState.id !== args.where.id ||
              persistedState.userId !== args.where.userId)
          ) {
            return {
              count: 0,
            };
          }

          if (
            persistedState.audioTranscriptionStatus !==
            args.where.audioTranscriptionStatus
          ) {
            return {
              count: 0,
            };
          }

          persistedState.id = args.where.id;
          persistedState.userId = args.where.userId;
          applyPersistedData(args.data);

          return {
            count: 1,
          };
        },
      },
    },
    readCalls,
    updateCalls,
  };
}

test("buildCompleteAudioCapturePersistenceArgs scopes the upload completion update to the authenticated voice note", () => {
  assert.deepEqual(
    buildCompleteAudioCapturePersistenceArgs("user-voice", {
      contentType: " AUDIO/WEBM; codecs=opus ",
      durationSeconds: 12.4,
      mediaUrl:
        "https://waka.app/api/media/audio/users/user-voice/voice-notes/voice-note.webm",
      objectKey: " users/user-voice/voice-notes/voice-note.webm ",
      sizeBytes: 4096,
      voiceCaptureId: " voice-capture-42 ",
    }),
    {
      data: {
        audioDurationSeconds: 12.4,
        audioMimeType: "audio/webm",
        audioSizeBytes: 4096,
        audioStorageKey: "users/user-voice/voice-notes/voice-note.webm",
        audioStorageUrl:
          "https://waka.app/api/media/audio/users/user-voice/voice-notes/voice-note.webm",
        audioTranscriptionStatus:
          COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_PENDING,
        mediaUrl:
          "https://waka.app/api/media/audio/users/user-voice/voice-notes/voice-note.webm",
      },
      select: {
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        id: true,
        rawContent: true,
        sourceType: true,
      },
      where: {
        userId_id: {
          id: "voice-capture-42",
          userId: "user-voice",
        },
      },
    },
  );
});

test("buildClaimCompleteAudioCapturePersistenceArgs only claims upload finalization while transcription is still unset", () => {
  assert.deepEqual(
    buildClaimCompleteAudioCapturePersistenceArgs("user-voice", {
      contentType: " AUDIO/WEBM; codecs=opus ",
      durationSeconds: 12.4,
      mediaUrl:
        "https://waka.app/api/media/audio/users/user-voice/voice-notes/voice-note.webm",
      objectKey: " users/user-voice/voice-notes/voice-note.webm ",
      sizeBytes: 4096,
      voiceCaptureId: " voice-capture-42 ",
    }),
    {
      data: {
        audioDurationSeconds: 12.4,
        audioMimeType: "audio/webm",
        audioSizeBytes: 4096,
        audioStorageKey: "users/user-voice/voice-notes/voice-note.webm",
        audioStorageUrl:
          "https://waka.app/api/media/audio/users/user-voice/voice-notes/voice-note.webm",
        audioTranscriptionStatus:
          COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_PENDING,
        mediaUrl:
          "https://waka.app/api/media/audio/users/user-voice/voice-notes/voice-note.webm",
      },
      where: {
        audioTranscriptionStatus: null,
        id: "voice-capture-42",
        userId: "user-voice",
      },
    },
  );
});

test("buildReadCompletedAudioCaptureArgs scopes the finalized voice-note read to the authenticated owner", () => {
  assert.deepEqual(
    buildReadCompletedAudioCaptureArgs("user-voice", " voice-capture-42 "),
    {
      select: {
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        id: true,
        rawContent: true,
        sourceType: true,
      },
      where: {
        userId_id: {
          id: "voice-capture-42",
          userId: "user-voice",
        },
      },
    },
  );
});

test("buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs scopes the processing transition to the authenticated voice note", () => {
  assert.deepEqual(
    buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs(
      "user-voice",
      " voice-capture-42 ",
    ),
    {
      data: {
        audioTranscriptionStatus:
          COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_PROCESSING,
      },
      select: {
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        id: true,
        rawContent: true,
        sourceType: true,
      },
      where: {
        userId_id: {
          id: "voice-capture-42",
          userId: "user-voice",
        },
      },
    },
  );
});

test("buildMarkAudioCaptureTranscriptionCompletedPersistenceArgs scopes the transcript completion update to the authenticated voice note", () => {
  assert.deepEqual(
    buildMarkAudioCaptureTranscriptionCompletedPersistenceArgs(
      "user-voice",
      " voice-capture-42 ",
      "  Captured transcript from the finished voice note.  ",
    ),
    {
      data: {
        audioTranscriptionStatus:
          COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_COMPLETED,
        rawContent: "Captured transcript from the finished voice note.",
        transcript: "Captured transcript from the finished voice note.",
      },
      select: {
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        id: true,
        rawContent: true,
        sourceType: true,
      },
      where: {
        userId_id: {
          id: "voice-capture-42",
          userId: "user-voice",
        },
      },
    },
  );
});

test("buildMarkAudioCaptureTranscriptionFailedPersistenceArgs scopes the failed transition to the authenticated voice note", () => {
  assert.deepEqual(
    buildMarkAudioCaptureTranscriptionFailedPersistenceArgs(
      "user-voice",
      " voice-capture-42 ",
    ),
    {
      data: {
        audioTranscriptionStatus:
          COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_FAILED,
      },
      select: {
        audioDurationSeconds: true,
        audioMimeType: true,
        audioSizeBytes: true,
        audioStorageKey: true,
        audioStorageUrl: true,
        id: true,
        rawContent: true,
        sourceType: true,
      },
      where: {
        userId_id: {
          id: "voice-capture-42",
          userId: "user-voice",
        },
      },
    },
  );
});

test("completeAudioCapture persists the uploaded audio reference on the existing voice note", async () => {
  const { claimCalls, client, readCalls, updateCalls } =
    createPersistenceClient();

  const completedCapture = await completeAudioCapture(client, "user-77", {
    contentType: "audio/mp4",
    durationSeconds: 4.2,
    mediaUrl:
      "https://waka.app/api/media/audio/users/user-77/voice-notes/capture.m4a",
    objectKey: "users/user-77/voice-notes/capture.m4a",
    sizeBytes: 2048,
    voiceCaptureId: "voice-capture-77",
  });

  assert.deepEqual(completedCapture, {
    audioDurationSeconds: 4.2,
    audioMimeType: "audio/mp4",
    audioSizeBytes: 2048,
    audioStorageKey: "users/user-77/voice-notes/capture.m4a",
    audioStorageUrl:
      "https://waka.app/api/media/audio/users/user-77/voice-notes/capture.m4a",
    id: "voice-capture-77",
    rawContent: "Existing voice capture transcript",
    sourceType: "VOICE_NOTE",
  });
  assert.deepEqual(claimCalls, [
    buildClaimCompleteAudioCapturePersistenceArgs("user-77", {
      contentType: "audio/mp4",
      durationSeconds: 4.2,
      mediaUrl:
        "https://waka.app/api/media/audio/users/user-77/voice-notes/capture.m4a",
      objectKey: "users/user-77/voice-notes/capture.m4a",
      sizeBytes: 2048,
      voiceCaptureId: "voice-capture-77",
    }),
  ]);
  assert.deepEqual(readCalls, [
    buildReadCompletedAudioCaptureArgs("user-77", "voice-capture-77"),
  ]);
  assert.deepEqual(updateCalls, []);
  assert.equal(didCompleteAudioCaptureClaimFinalization(completedCapture), true);
});

test("completeAudioCapture treats repeated finalize requests as idempotent reads after the first claim", async () => {
  const { claimCalls, client, readCalls } = createPersistenceClient();

  const firstCapture = await completeAudioCapture(client, "user-77", {
    contentType: "audio/mp4",
    durationSeconds: 4.2,
    mediaUrl:
      "https://waka.app/api/media/audio/users/user-77/voice-notes/capture.m4a",
    objectKey: "users/user-77/voice-notes/capture.m4a",
    sizeBytes: 2048,
    voiceCaptureId: "voice-capture-77",
  });
  const retriedCapture = await completeAudioCapture(client, "user-77", {
    contentType: "audio/mp4",
    durationSeconds: 4.2,
    mediaUrl:
      "https://waka.app/api/media/audio/users/user-77/voice-notes/capture.m4a",
    objectKey: "users/user-77/voice-notes/capture.m4a",
    sizeBytes: 2048,
    voiceCaptureId: "voice-capture-77",
  });

  assert.deepEqual(claimCalls, [
    buildClaimCompleteAudioCapturePersistenceArgs("user-77", {
      contentType: "audio/mp4",
      durationSeconds: 4.2,
      mediaUrl:
        "https://waka.app/api/media/audio/users/user-77/voice-notes/capture.m4a",
      objectKey: "users/user-77/voice-notes/capture.m4a",
      sizeBytes: 2048,
      voiceCaptureId: "voice-capture-77",
    }),
    buildClaimCompleteAudioCapturePersistenceArgs("user-77", {
      contentType: "audio/mp4",
      durationSeconds: 4.2,
      mediaUrl:
        "https://waka.app/api/media/audio/users/user-77/voice-notes/capture.m4a",
      objectKey: "users/user-77/voice-notes/capture.m4a",
      sizeBytes: 2048,
      voiceCaptureId: "voice-capture-77",
    }),
  ]);
  assert.deepEqual(readCalls, [
    buildReadCompletedAudioCaptureArgs("user-77", "voice-capture-77"),
    buildReadCompletedAudioCaptureArgs("user-77", "voice-capture-77"),
  ]);
  assert.deepEqual(retriedCapture, firstCapture);
  assert.equal(didCompleteAudioCaptureClaimFinalization(firstCapture), true);
  assert.equal(
    didCompleteAudioCaptureClaimFinalization(retriedCapture),
    false,
  );
});

test("markAudioCaptureTranscriptionProcessing advances the persisted voice note into the processing state", async () => {
  const { client, updateCalls } = createPersistenceClient();

  await markAudioCaptureTranscriptionProcessing(
    client,
    "user-77",
    " voice-capture-77 ",
  );

  assert.deepEqual(updateCalls, [
    buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs(
      "user-77",
      " voice-capture-77 ",
    ),
  ]);
});

test("markAudioCaptureTranscriptionCompleted persists the finished transcript and completed status on the voice note", async () => {
  const { client, updateCalls } = createPersistenceClient();

  await markAudioCaptureTranscriptionCompleted(
    client,
    "user-77",
    " voice-capture-77 ",
    "  Transcript from the finished voice note.  ",
  );

  assert.deepEqual(updateCalls, [
    buildMarkAudioCaptureTranscriptionCompletedPersistenceArgs(
      "user-77",
      " voice-capture-77 ",
      "  Transcript from the finished voice note.  ",
    ),
  ]);
});

test("markAudioCaptureTranscriptionFailed persists the failed status on the voice note", async () => {
  const { client, updateCalls } = createPersistenceClient();

  await markAudioCaptureTranscriptionFailed(
    client,
    "user-77",
    " voice-capture-77 ",
  );

  assert.deepEqual(updateCalls, [
    buildMarkAudioCaptureTranscriptionFailedPersistenceArgs(
      "user-77",
      " voice-capture-77 ",
    ),
  ]);
});

test("createCompleteAudioCaptureService delegates completion and transcription lifecycle transitions through the configured repository", async () => {
  const { claimCalls, client, readCalls, updateCalls } =
    createPersistenceClient();
  const service = createCompleteAudioCaptureService({
    voiceCaptureRepository: client,
  });

  const completedCapture = await service.complete("user-service", {
    contentType: "audio/webm",
    durationSeconds: 9.8,
    mediaUrl:
      "https://waka.app/api/media/audio/users/user-service/voice-notes/service.webm",
    objectKey: "users/user-service/voice-notes/service.webm",
    sizeBytes: 8192,
    voiceCaptureId: "voice-capture-service",
  });

  assert.equal(completedCapture.id, "voice-capture-service");
  assert.equal(service.didClaimFinalization?.(completedCapture), true);
  await service.markTranscriptionProcessing?.(
    "user-service",
    "voice-capture-service",
  );
  await service.markTranscriptionCompleted?.(
    "user-service",
    "voice-capture-service",
    "  The service persisted the finished transcript.  ",
  );
  await service.markTranscriptionFailed?.(
    "user-service",
    "voice-capture-service",
  );

  assert.deepEqual(claimCalls, [
    buildClaimCompleteAudioCapturePersistenceArgs("user-service", {
      contentType: "audio/webm",
      durationSeconds: 9.8,
      mediaUrl:
        "https://waka.app/api/media/audio/users/user-service/voice-notes/service.webm",
      objectKey: "users/user-service/voice-notes/service.webm",
      sizeBytes: 8192,
      voiceCaptureId: "voice-capture-service",
    }),
  ]);
  assert.deepEqual(readCalls, [
    buildReadCompletedAudioCaptureArgs(
      "user-service",
      "voice-capture-service",
    ),
  ]);
  assert.equal(updateCalls.length, 3);
  assert.equal(
    updateCalls[0]?.data.audioTranscriptionStatus,
    COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_PROCESSING,
  );
  assert.equal(
    updateCalls[1]?.data.audioTranscriptionStatus,
    COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_COMPLETED,
  );
  assert.equal(
    updateCalls[1]?.data.rawContent,
    "The service persisted the finished transcript.",
  );
  assert.equal(
    updateCalls[1]?.data.transcript,
    "The service persisted the finished transcript.",
  );
  assert.equal(
    updateCalls[2]?.data.audioTranscriptionStatus,
    COMPLETE_AUDIO_CAPTURE_TRANSCRIPTION_STATUS_FAILED,
  );
});
