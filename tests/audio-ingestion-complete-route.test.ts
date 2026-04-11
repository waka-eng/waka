import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPLETE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
  COMPLETE_AUDIO_INGESTION_DURATION_SECONDS_INVALID_ERROR,
  COMPLETE_AUDIO_INGESTION_MEDIA_URL_INVALID_ERROR,
  COMPLETE_AUDIO_INGESTION_OBJECT_KEY_REQUIRED_ERROR,
  COMPLETE_AUDIO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR,
  COMPLETE_AUDIO_INGESTION_REQUEST_BODY_INVALID_ERROR,
  COMPLETE_AUDIO_INGESTION_ROUTE_BAD_REQUEST_STATUS,
  COMPLETE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR,
  COMPLETE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
  COMPLETE_AUDIO_INGESTION_ROUTE_NOT_FOUND_ERROR,
  COMPLETE_AUDIO_INGESTION_ROUTE_NOT_FOUND_STATUS,
  COMPLETE_AUDIO_INGESTION_ROUTE_OK_STATUS,
  COMPLETE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
  COMPLETE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_STATUS,
  COMPLETE_AUDIO_INGESTION_SIZE_BYTES_INVALID_ERROR,
  COMPLETE_AUDIO_INGESTION_VOICE_CAPTURE_ID_REQUIRED_ERROR,
  configureCompleteAudioIngestionRouteDependencies,
  createCompleteAudioIngestionRouteDependencies,
  handleCompleteAudioIngestionRouteRequest,
  parseCompleteAudioIngestionRequestBody,
} from "../apps/web/src/media/audio-ingestion-complete-route.ts";
import {
  buildClaimCompleteAudioCapturePersistenceArgs,
  buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs,
  buildReadCompletedAudioCaptureArgs,
  createCompleteAudioCaptureService,
  type CompleteAudioCapturePersistenceClient,
  type CompletedAudioCaptureRecord,
} from "../apps/web/src/media/complete-audio-capture.ts";
import type { VoiceTranscriptionSqsJobPayload } from "../packages/shared/types.ts";

function createPersistenceClient(): {
  claimCalls: Array<ReturnType<typeof buildClaimCompleteAudioCapturePersistenceArgs>>;
  client: CompleteAudioCapturePersistenceClient;
  readCalls: Array<ReturnType<typeof buildReadCompletedAudioCaptureArgs>>;
  updateCalls: Array<
    ReturnType<typeof buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs>
  >;
} {
  const claimCalls: Array<
    ReturnType<typeof buildClaimCompleteAudioCapturePersistenceArgs>
  > = [];
  const readCalls: Array<ReturnType<typeof buildReadCompletedAudioCaptureArgs>> =
    [];
  const updateCalls: Array<
    ReturnType<typeof buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs>
  > = [];
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
          persistedState.userId = args.where.userId_id.userId;
          persistedState.id = args.where.userId_id.id;
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

          persistedState.userId = args.where.userId;
          persistedState.id = args.where.id;
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

function createQueuePublisher() {
  const enqueueCalls: VoiceTranscriptionSqsJobPayload[] = [];

  return {
    enqueueCalls,
    queuePublisher: {
      async enqueue(payload: VoiceTranscriptionSqsJobPayload) {
        enqueueCalls.push(payload);
      },
    },
  };
}

test("parseCompleteAudioIngestionRequestBody accepts valid uploaded-audio metadata and strips spoofed ownership fields", async () => {
  const parsed = await parseCompleteAudioIngestionRequestBody(
    new Request("https://waka.app/api/media/audio", {
      method: "POST",
      body: JSON.stringify({
        contentType: " AUDIO/WEBM; codecs=opus ",
        durationSeconds: 7.3,
        mediaUrl:
          "https://waka.app/api/media/audio/users/user-voice/voice-notes/capture.webm",
        objectKey: " users/user-voice/voice-notes/capture.webm ",
        ownerId: "forged-owner",
        sizeBytes: 2048,
        tenantId: "forged-tenant",
        userId: "forged-user",
        voiceCaptureId: " voice-capture-42 ",
        workspaceId: "forged-workspace",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsed, {
    contentType: "audio/webm",
    durationSeconds: 7.3,
    mediaUrl:
      "https://waka.app/api/media/audio/users/user-voice/voice-notes/capture.webm",
    objectKey: "users/user-voice/voice-notes/capture.webm",
    sizeBytes: 2048,
    voiceCaptureId: "voice-capture-42",
  });
  assert.equal("ownerId" in parsed, false);
  assert.equal("tenantId" in parsed, false);
  assert.equal("userId" in parsed, false);
  assert.equal("workspaceId" in parsed, false);
});

test("parseCompleteAudioIngestionRequestBody rejects invalid JSON and invalid uploaded-audio payloads", async () => {
  await assert.rejects(
    async () =>
      parseCompleteAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio", {
          method: "POST",
          body: "{",
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new RegExp(COMPLETE_AUDIO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompleteAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio", {
          method: "POST",
          body: JSON.stringify("not-an-object"),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_AUDIO_INGESTION_REQUEST_BODY_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompleteAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio", {
          method: "POST",
          body: JSON.stringify({
            contentType: "application/pdf",
            durationSeconds: 2.4,
            mediaUrl: "https://waka.app/api/media/audio/users/user/bad.pdf",
            objectKey: "users/user/bad.pdf",
            sizeBytes: 2048,
            voiceCaptureId: "voice-capture-bad",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompleteAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio", {
          method: "POST",
          body: JSON.stringify({
            contentType: "audio/webm",
            durationSeconds: -1,
            mediaUrl: "https://waka.app/api/media/audio/users/user/capture.webm",
            objectKey: "users/user/capture.webm",
            sizeBytes: 2048,
            voiceCaptureId: "voice-capture-bad",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_AUDIO_INGESTION_DURATION_SECONDS_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompleteAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio", {
          method: "POST",
          body: JSON.stringify({
            contentType: "audio/webm",
            durationSeconds: 2.4,
            mediaUrl: "not-a-url",
            objectKey: "users/user/capture.webm",
            sizeBytes: 2048,
            voiceCaptureId: "voice-capture-bad",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_AUDIO_INGESTION_MEDIA_URL_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompleteAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio", {
          method: "POST",
          body: JSON.stringify({
            contentType: "audio/webm",
            durationSeconds: 2.4,
            mediaUrl: "https://waka.app/api/media/audio/users/user/capture.webm",
            objectKey: "   ",
            sizeBytes: 2048,
            voiceCaptureId: "voice-capture-bad",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_AUDIO_INGESTION_OBJECT_KEY_REQUIRED_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompleteAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio", {
          method: "POST",
          body: JSON.stringify({
            contentType: "audio/webm",
            durationSeconds: 2.4,
            mediaUrl: "https://waka.app/api/media/audio/users/user/capture.webm",
            objectKey: "users/user/capture.webm",
            sizeBytes: 0,
            voiceCaptureId: "voice-capture-bad",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_AUDIO_INGESTION_SIZE_BYTES_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompleteAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio", {
          method: "POST",
          body: JSON.stringify({
            contentType: "audio/webm",
            durationSeconds: 2.4,
            mediaUrl: "https://waka.app/api/media/audio/users/user/capture.webm",
            objectKey: "users/user/capture.webm",
            sizeBytes: 2048,
            voiceCaptureId: "   ",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_AUDIO_INGESTION_VOICE_CAPTURE_ID_REQUIRED_ERROR),
  );
});

test("handleCompleteAudioIngestionRouteRequest returns 401 when the caller is not authenticated", async () => {
  let voiceCaptureLookupCount = 0;
  let completionCallCount = 0;
  const { queuePublisher } = createQueuePublisher();

  const response = await handleCompleteAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio", {
      method: "POST",
      body: JSON.stringify({
        contentType: "audio/webm",
        durationSeconds: 4.2,
        mediaUrl: "https://waka.app/api/media/audio/users/user/capture.webm",
        objectKey: "users/user/capture.webm",
        sizeBytes: 2048,
        voiceCaptureId: "voice-capture-unauthenticated",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return null;
          },
        },
        completionService: {
          async complete() {
            completionCallCount += 1;
            throw new Error("completion should not run when unauthenticated");
          },
        },
        queuePublisher,
        voiceCaptureAccess: {
          inspiration: {
            async findFirst() {
              voiceCaptureLookupCount += 1;
              return {
                id: "voice-capture-unauthenticated",
              };
            },
          },
        },
      },
    },
  );

  assert.equal(response.status, COMPLETE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: COMPLETE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(voiceCaptureLookupCount, 0);
  assert.equal(completionCallCount, 0);
});

test("handleCompleteAudioIngestionRouteRequest validates input, enforces access, and persists uploaded audio metadata", async () => {
  const voiceCaptureLookups: Array<Record<string, unknown>> = [];
  const completionInputs: Array<Record<string, unknown>> = [];
  const transcriptionProcessingInputs: Array<Record<string, unknown>> = [];
  const { enqueueCalls, queuePublisher } = createQueuePublisher();
  const scheduledTasks: Array<() => Promise<void>> = [];

  const response = await handleCompleteAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio", {
      method: "POST",
      body: JSON.stringify({
        contentType: " AUDIO/MP4 ",
        durationSeconds: 6.8,
        mediaUrl:
          "https://waka.app/api/media/audio/users/user-authenticated/voice-notes/capture.m4a",
        objectKey: " users/user-authenticated/voice-notes/capture.m4a ",
        sizeBytes: 4096,
        userId: "forged-user",
        voiceCaptureId: " voice-capture-authenticated ",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-authenticated";
          },
        },
        backgroundScheduler(task) {
          scheduledTasks.push(task);
        },
        completionService: {
          async complete(userId, input) {
            completionInputs.push({
              ...input,
              userId,
            });

            return {
              audioDurationSeconds: input.durationSeconds,
              audioMimeType: input.contentType,
              audioSizeBytes: input.sizeBytes,
              audioStorageKey:
                "persisted/users/user-authenticated/voice-notes/capture.m4a",
              audioStorageUrl:
                "https://media.waka.app/users/user-authenticated/voice-notes/persisted-capture.m4a",
              id: input.voiceCaptureId,
              rawContent: "Existing voice capture transcript",
              sourceType: "VOICE_NOTE",
            };
          },
          async markTranscriptionProcessing(userId, voiceCaptureId) {
            transcriptionProcessingInputs.push({
              userId,
              voiceCaptureId,
            });
          },
        },
        queuePublisher,
        voiceCaptureAccess: {
          inspiration: {
            async findFirst(args) {
              voiceCaptureLookups.push(args as Record<string, unknown>);
              return {
                id: args.where.id,
              };
            },
          },
        },
      },
    },
  );

  assert.equal(response.status, COMPLETE_AUDIO_INGESTION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    audioDurationSeconds: 6.8,
    audioMimeType: "audio/mp4",
    audioSizeBytes: 4096,
    audioStorageKey:
      "persisted/users/user-authenticated/voice-notes/capture.m4a",
    audioStorageUrl:
      "https://media.waka.app/users/user-authenticated/voice-notes/persisted-capture.m4a",
    id: "voice-capture-authenticated",
    rawContent: "Existing voice capture transcript",
    sourceType: "VOICE_NOTE",
  });
  assert.deepEqual(completionInputs, [
    {
      contentType: "audio/mp4",
      durationSeconds: 6.8,
      mediaUrl:
        "https://waka.app/api/media/audio/users/user-authenticated/voice-notes/capture.m4a",
      objectKey: "users/user-authenticated/voice-notes/capture.m4a",
      sizeBytes: 4096,
      userId: "user-authenticated",
      voiceCaptureId: "voice-capture-authenticated",
    },
  ]);
  assert.equal(voiceCaptureLookups.length, 1);
  assert.equal(enqueueCalls.length, 0);
  assert.equal(scheduledTasks.length, 1);
  assert.deepEqual(transcriptionProcessingInputs, []);
  await scheduledTasks[0]?.();
  assert.deepEqual(enqueueCalls, [
    {
      inspirationId: "voice-capture-authenticated",
      jobType: "voice_transcription",
      audio: {
        mediaUrl:
          "https://media.waka.app/users/user-authenticated/voice-notes/persisted-capture.m4a",
        storageKey:
          "persisted/users/user-authenticated/voice-notes/capture.m4a",
      },
    },
  ]);
  assert.deepEqual(transcriptionProcessingInputs, [
    {
      userId: "user-authenticated",
      voiceCaptureId: "voice-capture-authenticated",
    },
  ]);
});

test("handleCompleteAudioIngestionRouteRequest persists the final uploaded file reference on the voice note via the repository-backed service", async () => {
  const { claimCalls, client, readCalls, updateCalls } =
    createPersistenceClient();
  const { enqueueCalls, queuePublisher } = createQueuePublisher();
  const scheduledTasks: Array<() => Promise<void>> = [];

  const response = await handleCompleteAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio", {
      method: "POST",
      body: JSON.stringify({
        contentType: "audio/webm",
        durationSeconds: 8.1,
        mediaUrl:
          "https://waka.app/api/media/audio/users/user-voice/voice-notes/final.webm",
        objectKey: "users/user-voice/voice-notes/final.webm",
        sizeBytes: 8192,
        voiceCaptureId: "voice-capture-final",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: createCompleteAudioIngestionRouteDependencies({
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-voice";
          },
        },
        backgroundScheduler(task) {
          scheduledTasks.push(task);
        },
        queuePublisher,
        voiceCaptureAccess: {
          inspiration: {
            async findFirst(args) {
              return {
                id: args.where.id,
              };
            },
          },
        },
        voiceCaptureRepository: client,
      }),
    },
  );

  assert.equal(response.status, COMPLETE_AUDIO_INGESTION_ROUTE_OK_STATUS);
  assert.deepEqual(claimCalls, [
    buildClaimCompleteAudioCapturePersistenceArgs("user-voice", {
      contentType: "audio/webm",
      durationSeconds: 8.1,
      mediaUrl:
        "https://waka.app/api/media/audio/users/user-voice/voice-notes/final.webm",
      objectKey: "users/user-voice/voice-notes/final.webm",
      sizeBytes: 8192,
      voiceCaptureId: "voice-capture-final",
    }),
  ]);
  assert.deepEqual(readCalls, [
    buildReadCompletedAudioCaptureArgs("user-voice", "voice-capture-final"),
  ]);
  assert.deepEqual(updateCalls, []);
  assert.equal(scheduledTasks.length, 1);
  await scheduledTasks[0]?.();
  assert.deepEqual(updateCalls, [
    buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs(
      "user-voice",
      "voice-capture-final",
    ),
  ]);
  assert.deepEqual(enqueueCalls, [
    {
      inspirationId: "voice-capture-final",
      jobType: "voice_transcription",
      audio: {
        mediaUrl:
          "https://waka.app/api/media/audio/users/user-voice/voice-notes/final.webm",
        storageKey: "users/user-voice/voice-notes/final.webm",
      },
    },
  ]);
});

test("handleCompleteAudioIngestionRouteRequest skips duplicate queue side effects when the same finalize request is retried", async () => {
  const { claimCalls, client, readCalls, updateCalls } =
    createPersistenceClient();
  const { enqueueCalls, queuePublisher } = createQueuePublisher();
  const scheduledTasks: Array<() => Promise<void>> = [];

  const buildRequest = () =>
    new Request("https://waka.app/api/media/audio", {
      method: "POST",
      body: JSON.stringify({
        contentType: "audio/webm",
        durationSeconds: 8.1,
        mediaUrl:
          "https://waka.app/api/media/audio/users/user-voice/voice-notes/final.webm",
        objectKey: "users/user-voice/voice-notes/final.webm",
        sizeBytes: 8192,
        voiceCaptureId: "voice-capture-final",
      }),
      headers: {
        "content-type": "application/json",
      },
    });

  const dependencies = createCompleteAudioIngestionRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-voice";
      },
    },
    backgroundScheduler(task) {
      scheduledTasks.push(task);
    },
    queuePublisher,
    voiceCaptureAccess: {
      inspiration: {
        async findFirst(args) {
          return {
            id: args.where.id,
          };
        },
      },
    },
    voiceCaptureRepository: client,
  });

  const firstResponse = await handleCompleteAudioIngestionRouteRequest(buildRequest(), {
    dependencies,
  });
  const retriedResponse = await handleCompleteAudioIngestionRouteRequest(
    buildRequest(),
    {
      dependencies,
    },
  );

  assert.equal(firstResponse.status, COMPLETE_AUDIO_INGESTION_ROUTE_OK_STATUS);
  assert.equal(retriedResponse.status, COMPLETE_AUDIO_INGESTION_ROUTE_OK_STATUS);
  assert.deepEqual(await retriedResponse.json(), {
    audioDurationSeconds: 8.1,
    audioMimeType: "audio/webm",
    audioSizeBytes: 8192,
    audioStorageKey: "users/user-voice/voice-notes/final.webm",
    audioStorageUrl:
      "https://waka.app/api/media/audio/users/user-voice/voice-notes/final.webm",
    id: "voice-capture-final",
    rawContent: "Existing voice capture transcript",
    sourceType: "VOICE_NOTE",
  });
  assert.deepEqual(claimCalls, [
    buildClaimCompleteAudioCapturePersistenceArgs("user-voice", {
      contentType: "audio/webm",
      durationSeconds: 8.1,
      mediaUrl:
        "https://waka.app/api/media/audio/users/user-voice/voice-notes/final.webm",
      objectKey: "users/user-voice/voice-notes/final.webm",
      sizeBytes: 8192,
      voiceCaptureId: "voice-capture-final",
    }),
    buildClaimCompleteAudioCapturePersistenceArgs("user-voice", {
      contentType: "audio/webm",
      durationSeconds: 8.1,
      mediaUrl:
        "https://waka.app/api/media/audio/users/user-voice/voice-notes/final.webm",
      objectKey: "users/user-voice/voice-notes/final.webm",
      sizeBytes: 8192,
      voiceCaptureId: "voice-capture-final",
    }),
  ]);
  assert.deepEqual(readCalls, [
    buildReadCompletedAudioCaptureArgs("user-voice", "voice-capture-final"),
    buildReadCompletedAudioCaptureArgs("user-voice", "voice-capture-final"),
  ]);
  assert.deepEqual(updateCalls, []);
  assert.equal(scheduledTasks.length, 1);

  await scheduledTasks[0]?.();

  assert.deepEqual(updateCalls, [
    buildMarkAudioCaptureTranscriptionProcessingPersistenceArgs(
      "user-voice",
      "voice-capture-final",
    ),
  ]);
  assert.deepEqual(enqueueCalls, [
    {
      inspirationId: "voice-capture-final",
      jobType: "voice_transcription",
      audio: {
        mediaUrl:
          "https://waka.app/api/media/audio/users/user-voice/voice-notes/final.webm",
        storageKey: "users/user-voice/voice-notes/final.webm",
      },
    },
  ]);
});

test("handleCompleteAudioIngestionRouteRequest leaves transcription pending when queue dispatch fails", async () => {
  const { claimCalls, client, readCalls, updateCalls } =
    createPersistenceClient();
  const loggedErrors: unknown[] = [];
  const scheduledTasks: Array<() => Promise<void>> = [];

  const response = await handleCompleteAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio", {
      method: "POST",
      body: JSON.stringify({
        contentType: "audio/webm",
        durationSeconds: 8.1,
        mediaUrl:
          "https://waka.app/api/media/audio/users/user-voice/voice-notes/final.webm",
        objectKey: "users/user-voice/voice-notes/final.webm",
        sizeBytes: 8192,
        voiceCaptureId: "voice-capture-final",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: createCompleteAudioIngestionRouteDependencies({
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-voice";
          },
        },
        backgroundScheduler(task) {
          scheduledTasks.push(task);
        },
        logger: {
          error(error) {
            loggedErrors.push(error);
          },
        },
        queuePublisher: {
          async enqueue() {
            throw new Error("queue dispatch failed");
          },
        },
        voiceCaptureAccess: {
          inspiration: {
            async findFirst(args) {
              return {
                id: args.where.id,
              };
            },
          },
        },
        voiceCaptureRepository: client,
      }),
    },
  );

  assert.equal(response.status, COMPLETE_AUDIO_INGESTION_ROUTE_OK_STATUS);
  assert.deepEqual(claimCalls, [
    buildClaimCompleteAudioCapturePersistenceArgs("user-voice", {
      contentType: "audio/webm",
      durationSeconds: 8.1,
      mediaUrl:
        "https://waka.app/api/media/audio/users/user-voice/voice-notes/final.webm",
      objectKey: "users/user-voice/voice-notes/final.webm",
      sizeBytes: 8192,
      voiceCaptureId: "voice-capture-final",
    }),
  ]);
  assert.deepEqual(readCalls, [
    buildReadCompletedAudioCaptureArgs("user-voice", "voice-capture-final"),
  ]);
  assert.deepEqual(updateCalls, []);
  assert.equal(scheduledTasks.length, 1);
  await scheduledTasks[0]?.();
  assert.deepEqual(updateCalls, []);
  assert.equal(loggedErrors.length, 1);
  assert.match(String(loggedErrors[0]), /queue dispatch failed/);
});

test("handleCompleteAudioIngestionRouteRequest returns 404 when the signed-in user cannot access the referenced voice capture", async () => {
  let completionCallCount = 0;
  const { queuePublisher } = createQueuePublisher();

  const response = await handleCompleteAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio", {
      method: "POST",
      body: JSON.stringify({
        contentType: "audio/webm",
        durationSeconds: 4.2,
        mediaUrl:
          "https://waka.app/api/media/audio/users/user-route/voice-notes/inaccessible.webm",
        objectKey: "users/user-route/voice-notes/inaccessible.webm",
        sizeBytes: 2048,
        voiceCaptureId: "voice-capture-inaccessible",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-route";
          },
        },
        completionService: {
          async complete() {
            completionCallCount += 1;
            throw new Error("completion should not run when access is denied");
          },
        },
        queuePublisher,
        voiceCaptureAccess: {
          inspiration: {
            async findFirst() {
              return null;
            },
          },
        },
      },
    },
  );

  assert.equal(response.status, COMPLETE_AUDIO_INGESTION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: COMPLETE_AUDIO_INGESTION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.equal(completionCallCount, 0);
});

test("handleCompleteAudioIngestionRouteRequest returns 400 for invalid payloads and 500 for unexpected persistence failures", async () => {
  const { queuePublisher } = createQueuePublisher();
  const badRequestResponse = await handleCompleteAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio", {
      method: "POST",
      body: JSON.stringify({
        contentType: "text/plain",
        durationSeconds: 1.2,
        mediaUrl: "https://waka.app/api/media/audio/users/user-route/bad.txt",
        objectKey: "users/user-route/bad.txt",
        sizeBytes: 2048,
        voiceCaptureId: "voice-capture-bad",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-route";
          },
        },
        completionService: {
          async complete() {
            throw new Error("completion should not run for bad requests");
          },
        },
        queuePublisher,
        voiceCaptureAccess: {
          inspiration: {
            async findFirst() {
              return {
                id: "voice-capture-bad",
              };
            },
          },
        },
      },
    },
  );

  assert.equal(badRequestResponse.status, COMPLETE_AUDIO_INGESTION_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await badRequestResponse.json(), {
    error: COMPLETE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
  });

  const internalErrorResponse = await handleCompleteAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio", {
      method: "POST",
      body: JSON.stringify({
        contentType: "audio/webm",
        durationSeconds: 3.5,
        mediaUrl:
          "https://waka.app/api/media/audio/users/user-route/voice-notes/failure.webm",
        objectKey: "users/user-route/voice-notes/failure.webm",
        sizeBytes: 2048,
        voiceCaptureId: "voice-capture-failure",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-route";
          },
        },
        completionService: {
          async complete() {
            throw new Error("database offline");
          },
        },
        queuePublisher,
        voiceCaptureAccess: {
          inspiration: {
            async findFirst() {
              return {
                id: "voice-capture-failure",
              };
            },
          },
        },
      },
    },
  );

  assert.equal(
    internalErrorResponse.status,
    COMPLETE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
  );
  assert.deepEqual(await internalErrorResponse.json(), {
    error: COMPLETE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR,
  });
});

test("app/api/media/audio/route.ts delegates POST requests to the configured audio upload completion handler", async () => {
  const { client } = createPersistenceClient();
  const { queuePublisher } = createQueuePublisher();

  configureCompleteAudioIngestionRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    completionService: createCompleteAudioCaptureService({
      voiceCaptureRepository: client,
    }),
    queuePublisher,
    voiceCaptureAccess: {
      inspiration: {
        async findFirst(args) {
          return {
            id: args.where.id,
          };
        },
      },
    },
  });

  try {
    const { POST } = await import("../apps/web/app/api/media/audio/route.ts");
    const response = await POST(
      new Request("https://waka.app/api/media/audio", {
        method: "POST",
        body: JSON.stringify({
          contentType: "audio/webm",
          durationSeconds: 5.4,
          mediaUrl:
            "https://waka.app/api/media/audio/users/user-route/voice-notes/route.webm",
          objectKey: "users/user-route/voice-notes/route.webm",
          sizeBytes: 3072,
          voiceCaptureId: "voice-capture-route",
        }),
        headers: {
          "content-type": "application/json",
        },
      }) as never,
    );

    assert.equal(response.status, COMPLETE_AUDIO_INGESTION_ROUTE_OK_STATUS);
    assert.deepEqual(await response.json(), {
      audioDurationSeconds: 5.4,
      audioMimeType: "audio/webm",
      audioSizeBytes: 3072,
      audioStorageKey: "users/user-route/voice-notes/route.webm",
      audioStorageUrl:
        "https://waka.app/api/media/audio/users/user-route/voice-notes/route.webm",
      id: "voice-capture-route",
      rawContent: "Existing voice capture transcript",
      sourceType: "VOICE_NOTE",
    });
  } finally {
    configureCompleteAudioIngestionRouteDependencies(null);
  }
});

test("app/api/media/audio/route.ts preserves the shared 404 contract when the target voice capture is inaccessible", async () => {
  const { queuePublisher } = createQueuePublisher();

  configureCompleteAudioIngestionRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    completionService: {
      async complete() {
        throw new Error("completion should not run when access is denied");
      },
    },
    queuePublisher,
    voiceCaptureAccess: {
      inspiration: {
        async findFirst() {
          return null;
        },
      },
    },
  });

  try {
    const { POST } = await import("../apps/web/app/api/media/audio/route.ts");
    const response = await POST(
      new Request("https://waka.app/api/media/audio", {
        method: "POST",
        body: JSON.stringify({
          contentType: "audio/webm",
          durationSeconds: 5.4,
          mediaUrl:
            "https://waka.app/api/media/audio/users/user-route/voice-notes/route.webm",
          objectKey: "users/user-route/voice-notes/route.webm",
          sizeBytes: 3072,
          voiceCaptureId: "voice-capture-route",
        }),
        headers: {
          "content-type": "application/json",
        },
      }) as never,
    );

    assert.equal(response.status, COMPLETE_AUDIO_INGESTION_ROUTE_NOT_FOUND_STATUS);
    assert.deepEqual(await response.json(), {
      error: COMPLETE_AUDIO_INGESTION_ROUTE_NOT_FOUND_ERROR,
    });
  } finally {
    configureCompleteAudioIngestionRouteDependencies(null);
  }
});
