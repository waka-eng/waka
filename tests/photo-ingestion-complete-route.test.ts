import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPLETE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
  COMPLETE_PHOTO_INGESTION_FILE_NAME_REQUIRED_ERROR,
  COMPLETE_PHOTO_INGESTION_MEDIA_URL_INVALID_ERROR,
  COMPLETE_PHOTO_INGESTION_OBJECT_KEY_REQUIRED_ERROR,
  COMPLETE_PHOTO_INGESTION_PHOTO_CAPTURE_ID_REQUIRED_ERROR,
  COMPLETE_PHOTO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR,
  COMPLETE_PHOTO_INGESTION_REQUEST_BODY_INVALID_ERROR,
  COMPLETE_PHOTO_INGESTION_ROUTE_BAD_REQUEST_STATUS,
  COMPLETE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR,
  COMPLETE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
  COMPLETE_PHOTO_INGESTION_ROUTE_NOT_FOUND_ERROR,
  COMPLETE_PHOTO_INGESTION_ROUTE_NOT_FOUND_STATUS,
  COMPLETE_PHOTO_INGESTION_ROUTE_OK_STATUS,
  COMPLETE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
  COMPLETE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_STATUS,
  COMPLETE_PHOTO_INGESTION_SIZE_BYTES_INVALID_ERROR,
  buildCompletePhotoIngestionPhotoAnalysisJobPayload,
  buildCompletePhotoIngestionPhotoCaptureAccessArgs,
  configureCompletePhotoIngestionRouteDependencies,
  createCompletePhotoIngestionRouteDependencies,
  handleCompletePhotoIngestionRouteRequest,
  parseCompletePhotoIngestionRequestBody,
} from "../apps/web/src/media/photo-ingestion-complete-route.ts";
import {
  PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
  PHOTO_CAPTURE_UPLOADED_STATUS,
} from "../apps/web/src/media/create-photo-capture.ts";
import {
  buildCompletePhotoCapturePersistenceArgs,
  buildReadCompletedPhotoCaptureArgs,
  buildReadPhotoCaptureFinalizationStatusArgs,
  createCompletePhotoCaptureService,
  type CompletePhotoCapturePersistenceClient,
  type CompletedPhotoCaptureRecord,
} from "../apps/web/src/media/complete-photo-capture.ts";
import type { PhotoAnalysisSqsJobPayload } from "../packages/shared/types.ts";

function createPersistenceClient(
  initialStatus: string | null = PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
): {
  client: CompletePhotoCapturePersistenceClient;
  readCompletedCalls: Array<ReturnType<typeof buildReadCompletedPhotoCaptureArgs>>;
  readStatusCalls: Array<
    ReturnType<typeof buildReadPhotoCaptureFinalizationStatusArgs>
  >;
  updateCalls: Array<ReturnType<typeof buildCompletePhotoCapturePersistenceArgs>>;
} {
  const readStatusCalls: Array<
    ReturnType<typeof buildReadPhotoCaptureFinalizationStatusArgs>
  > = [];
  const readCompletedCalls: Array<
    ReturnType<typeof buildReadCompletedPhotoCaptureArgs>
  > = [];
  const updateCalls: Array<
    ReturnType<typeof buildCompletePhotoCapturePersistenceArgs>
  > = [];
  let uploadedRecord: CompletedPhotoCaptureRecord = {
    id: "photo-capture-final",
    photoFileName:
      initialStatus === PHOTO_CAPTURE_UPLOADED_STATUS
        ? "moodboard.webp"
        : null,
    photoMimeType:
      initialStatus === PHOTO_CAPTURE_UPLOADED_STATUS ? "image/webp" : null,
    photoSizeBytes:
      initialStatus === PHOTO_CAPTURE_UPLOADED_STATUS ? 4096 : null,
    photoStorageKey:
      initialStatus === PHOTO_CAPTURE_UPLOADED_STATUS
        ? "users/user-photo/photos/moodboard.webp"
        : null,
    photoStorageUrl:
      initialStatus === PHOTO_CAPTURE_UPLOADED_STATUS
        ? "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp"
        : null,
    photoUploadStatus: initialStatus,
    rawContent:
      initialStatus === PHOTO_CAPTURE_UPLOADED_STATUS
        ? "moodboard.webp"
        : "draft-photo",
    sourceType: "PHOTO",
  };

  return {
    client: {
      inspiration: {
        async findUnique(args) {
          if ("photoFileName" in args.select) {
            readCompletedCalls.push(args);
            return uploadedRecord;
          }

          readStatusCalls.push(args);
          return {
            photoUploadStatus: uploadedRecord.photoUploadStatus,
          };
        },
        async update(args) {
          updateCalls.push(args);
          uploadedRecord = {
            ...uploadedRecord,
            id: args.where.userId_id.id,
            photoFileName: String(args.data.photoFileName),
            photoMimeType: String(args.data.photoMimeType),
            photoSizeBytes: Number(args.data.photoSizeBytes),
            photoStorageKey: String(args.data.photoStorageKey),
            photoStorageUrl: String(args.data.photoStorageUrl),
            photoUploadStatus: String(args.data.photoUploadStatus),
            rawContent: String(args.data.rawContent),
            sourceType: "PHOTO",
          } satisfies CompletedPhotoCaptureRecord;

          return uploadedRecord;
        },
      },
    },
    readCompletedCalls,
    readStatusCalls,
    updateCalls,
  };
}

function createQueuePublisher() {
  const enqueueCalls: PhotoAnalysisSqsJobPayload[] = [];

  return {
    enqueueCalls,
    queuePublisher: {
      async enqueue(payload: PhotoAnalysisSqsJobPayload) {
        enqueueCalls.push(payload);
      },
    },
  };
}

test("parseCompletePhotoIngestionRequestBody accepts valid uploaded-photo metadata and strips spoofed ownership fields", async () => {
  const parsed = await parseCompletePhotoIngestionRequestBody(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: " IMAGE/PNG ",
        fileName: " conference-shot.PNG ",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/conference-shot.PNG",
        objectKey: " users/user-photo/photos/conference-shot.PNG ",
        ownerId: "forged-owner",
        photoCaptureId: " photo-capture-42 ",
        sizeBytes: 2048,
        tenantId: "forged-tenant",
        userId: "forged-user",
        workspaceId: "forged-workspace",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsed, {
    contentType: "image/png",
    fileName: "conference-shot.PNG",
    mediaUrl:
      "https://waka.app/api/media/photos/users/user-photo/photos/conference-shot.PNG",
    objectKey: "users/user-photo/photos/conference-shot.PNG",
    photoCaptureId: "photo-capture-42",
    sizeBytes: 2048,
  });
  assert.equal("ownerId" in parsed, false);
  assert.equal("tenantId" in parsed, false);
  assert.equal("userId" in parsed, false);
  assert.equal("workspaceId" in parsed, false);
});

test("parseCompletePhotoIngestionRequestBody rejects invalid JSON and invalid uploaded-photo payloads", async () => {
  await assert.rejects(
    async () =>
      parseCompletePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: "{",
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new RegExp(COMPLETE_PHOTO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompletePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify("not-an-object"),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_PHOTO_INGESTION_REQUEST_BODY_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompletePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify({
            contentType: "application/pdf",
            fileName: "scan.pdf",
            mediaUrl: "https://waka.app/api/media/photos/users/user/scan.pdf",
            objectKey: "users/user/scan.pdf",
            photoCaptureId: "photo-capture-bad",
            sizeBytes: 2048,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompletePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify({
            contentType: "image/webp",
            fileName: "   ",
            mediaUrl:
              "https://waka.app/api/media/photos/users/user/moodboard.webp",
            objectKey: "users/user/moodboard.webp",
            photoCaptureId: "photo-capture-bad",
            sizeBytes: 2048,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_PHOTO_INGESTION_FILE_NAME_REQUIRED_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompletePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify({
            contentType: "image/webp",
            fileName: "moodboard.webp",
            mediaUrl: "not-a-url",
            objectKey: "users/user/moodboard.webp",
            photoCaptureId: "photo-capture-bad",
            sizeBytes: 2048,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_PHOTO_INGESTION_MEDIA_URL_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompletePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify({
            contentType: "image/webp",
            fileName: "moodboard.webp",
            mediaUrl:
              "https://waka.app/api/media/photos/users/user/moodboard.webp",
            objectKey: "   ",
            photoCaptureId: "photo-capture-bad",
            sizeBytes: 2048,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_PHOTO_INGESTION_OBJECT_KEY_REQUIRED_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompletePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify({
            contentType: "image/webp",
            fileName: "moodboard.webp",
            mediaUrl:
              "https://waka.app/api/media/photos/users/user/moodboard.webp",
            objectKey: "users/user/moodboard.webp",
            photoCaptureId: "photo-capture-bad",
            sizeBytes: 0,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_PHOTO_INGESTION_SIZE_BYTES_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCompletePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify({
            contentType: "image/webp",
            fileName: "moodboard.webp",
            mediaUrl:
              "https://waka.app/api/media/photos/users/user/moodboard.webp",
            objectKey: "users/user/moodboard.webp",
            photoCaptureId: "   ",
            sizeBytes: 2048,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(COMPLETE_PHOTO_INGESTION_PHOTO_CAPTURE_ID_REQUIRED_ERROR),
  );
});

test("buildCompletePhotoIngestionPhotoAnalysisJobPayload uses the persisted photo capture as queue input", () => {
  assert.deepEqual(
    buildCompletePhotoIngestionPhotoAnalysisJobPayload({
      id: "photo-capture-final",
      photoFileName: "moodboard.webp",
      photoMimeType: "image/webp",
      photoSizeBytes: 4096,
      photoStorageKey: "users/user-photo/photos/moodboard.webp",
      photoStorageUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
      photoUploadStatus: PHOTO_CAPTURE_UPLOADED_STATUS,
      rawContent: "moodboard.webp",
      sourceType: "PHOTO",
    }),
    {
      inspirationId: "photo-capture-final",
      jobType: "photo_analysis",
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
    },
  );
});

test("handleCompletePhotoIngestionRouteRequest returns 401 when the caller is not authenticated", async () => {
  let photoCaptureLookupCount = 0;
  let completionCallCount = 0;
  const { queuePublisher } = createQueuePublisher();

  const response = await handleCompletePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/webp",
        fileName: "moodboard.webp",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
        objectKey: "users/user-photo/photos/moodboard.webp",
        photoCaptureId: "photo-capture-unauthenticated",
        sizeBytes: 2048,
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
        photoCaptureAccess: {
          inspiration: {
            async findFirst() {
              photoCaptureLookupCount += 1;
              return {
                id: "photo-capture-unauthenticated",
              };
            },
          },
        },
        queuePublisher,
      },
    },
  );

  assert.equal(response.status, COMPLETE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: COMPLETE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(photoCaptureLookupCount, 0);
  assert.equal(completionCallCount, 0);
});

test("handleCompletePhotoIngestionRouteRequest validates input, enforces access, and schedules photo analysis for the finalized capture", async () => {
  const photoCaptureLookups: Array<Record<string, unknown>> = [];
  const completionInputs: Array<Record<string, unknown>> = [];
  const { enqueueCalls, queuePublisher } = createQueuePublisher();
  const scheduledTasks: Array<() => Promise<void>> = [];

  const response = await handleCompletePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: " IMAGE/WEBP ",
        fileName: " moodboard.webp ",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-authenticated/photos/moodboard.webp",
        objectKey: " users/user-authenticated/photos/moodboard.webp ",
        photoCaptureId: " photo-capture-authenticated ",
        sizeBytes: 4096,
        userId: "forged-user",
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
              id: input.photoCaptureId,
              photoFileName: input.fileName,
              photoMimeType: input.contentType,
              photoSizeBytes: input.sizeBytes,
              photoStorageKey:
                "persisted/users/user-authenticated/photos/moodboard.webp",
              photoStorageUrl:
                "https://media.waka.app/users/user-authenticated/photos/persisted-moodboard.webp",
              photoUploadStatus: PHOTO_CAPTURE_UPLOADED_STATUS,
              rawContent: input.fileName,
              sourceType: "PHOTO",
            };
          },
        },
        photoCaptureAccess: {
          inspiration: {
            async findFirst(args) {
              photoCaptureLookups.push(args as Record<string, unknown>);
              return {
                id: args.where.id,
              };
            },
          },
        },
        queuePublisher,
      },
    },
  );

  assert.equal(response.status, COMPLETE_PHOTO_INGESTION_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "photo-capture-authenticated",
    photoFileName: "moodboard.webp",
    photoMimeType: "image/webp",
    photoSizeBytes: 4096,
    photoStorageKey:
      "persisted/users/user-authenticated/photos/moodboard.webp",
    photoStorageUrl:
      "https://media.waka.app/users/user-authenticated/photos/persisted-moodboard.webp",
    photoUploadStatus: PHOTO_CAPTURE_UPLOADED_STATUS,
    rawContent: "moodboard.webp",
    sourceType: "PHOTO",
  });
  assert.deepEqual(completionInputs, [
    {
      contentType: "image/webp",
      fileName: "moodboard.webp",
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-authenticated/photos/moodboard.webp",
      objectKey: "users/user-authenticated/photos/moodboard.webp",
      photoCaptureId: "photo-capture-authenticated",
      sizeBytes: 4096,
      userId: "user-authenticated",
    },
  ]);
  assert.deepEqual(photoCaptureLookups, [
    buildCompletePhotoIngestionPhotoCaptureAccessArgs(
      "user-authenticated",
      "photo-capture-authenticated",
    ),
  ]);
  assert.equal(enqueueCalls.length, 0);
  assert.equal(scheduledTasks.length, 1);
  await scheduledTasks[0]?.();
  assert.deepEqual(enqueueCalls, [
    {
      inspirationId: "photo-capture-authenticated",
      jobType: "photo_analysis",
      mediaUrl:
        "https://media.waka.app/users/user-authenticated/photos/persisted-moodboard.webp",
    },
  ]);
});

test("handleCompletePhotoIngestionRouteRequest persists the final uploaded file reference on the photo capture via the repository-backed service", async () => {
  const { client, readCompletedCalls, readStatusCalls, updateCalls } =
    createPersistenceClient();
  const { enqueueCalls, queuePublisher } = createQueuePublisher();
  const scheduledTasks: Array<() => Promise<void>> = [];

  const response = await handleCompletePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/webp",
        fileName: "moodboard.webp",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
        objectKey: "users/user-photo/photos/moodboard.webp",
        photoCaptureId: "photo-capture-final",
        sizeBytes: 4096,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: createCompletePhotoIngestionRouteDependencies({
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-photo";
          },
        },
        backgroundScheduler(task) {
          scheduledTasks.push(task);
        },
        photoCaptureAccess: {
          inspiration: {
            async findFirst(args) {
              return {
                id: args.where.id,
              };
            },
          },
        },
        photoCaptureRepository: client,
        queuePublisher,
      }),
    },
  );

  assert.equal(response.status, COMPLETE_PHOTO_INGESTION_ROUTE_OK_STATUS);
  assert.deepEqual(readStatusCalls, [
    buildReadPhotoCaptureFinalizationStatusArgs(
      "user-photo",
      "photo-capture-final",
    ),
  ]);
  assert.deepEqual(readCompletedCalls, []);
  assert.deepEqual(updateCalls, [
    buildCompletePhotoCapturePersistenceArgs(
      "user-photo",
      {
        contentType: "image/webp",
        fileName: "moodboard.webp",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
        objectKey: "users/user-photo/photos/moodboard.webp",
        photoCaptureId: "photo-capture-final",
        sizeBytes: 4096,
      },
      PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
    ),
  ]);
  assert.equal(scheduledTasks.length, 1);
  await scheduledTasks[0]?.();
  assert.deepEqual(enqueueCalls, [
    {
      inspirationId: "photo-capture-final",
      jobType: "photo_analysis",
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
    },
  ]);
});

test("handleCompletePhotoIngestionRouteRequest skips duplicate queue side effects when the same finalize request is retried", async () => {
  const { client, readCompletedCalls, readStatusCalls, updateCalls } =
    createPersistenceClient();
  const { enqueueCalls, queuePublisher } = createQueuePublisher();
  const scheduledTasks: Array<() => Promise<void>> = [];

  const buildRequest = () =>
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/webp",
        fileName: "moodboard.webp",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
        objectKey: "users/user-photo/photos/moodboard.webp",
        photoCaptureId: "photo-capture-final",
        sizeBytes: 4096,
      }),
      headers: {
        "content-type": "application/json",
      },
    });

  const dependencies = createCompletePhotoIngestionRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-photo";
      },
    },
    backgroundScheduler(task) {
      scheduledTasks.push(task);
    },
    photoCaptureAccess: {
      inspiration: {
        async findFirst(args) {
          return {
            id: args.where.id,
          };
        },
      },
    },
    photoCaptureRepository: client,
    queuePublisher,
  });

  const firstResponse = await handleCompletePhotoIngestionRouteRequest(
    buildRequest(),
    {
      dependencies,
    },
  );
  const retriedResponse = await handleCompletePhotoIngestionRouteRequest(
    buildRequest(),
    {
      dependencies,
    },
  );

  assert.equal(firstResponse.status, COMPLETE_PHOTO_INGESTION_ROUTE_OK_STATUS);
  assert.equal(retriedResponse.status, COMPLETE_PHOTO_INGESTION_ROUTE_OK_STATUS);
  assert.deepEqual(await retriedResponse.json(), {
    id: "photo-capture-final",
    photoFileName: "moodboard.webp",
    photoMimeType: "image/webp",
    photoSizeBytes: 4096,
    photoStorageKey: "users/user-photo/photos/moodboard.webp",
    photoStorageUrl:
      "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
    photoUploadStatus: PHOTO_CAPTURE_UPLOADED_STATUS,
    rawContent: "moodboard.webp",
    sourceType: "PHOTO",
  });
  assert.deepEqual(readStatusCalls, [
    buildReadPhotoCaptureFinalizationStatusArgs(
      "user-photo",
      "photo-capture-final",
    ),
    buildReadPhotoCaptureFinalizationStatusArgs(
      "user-photo",
      "photo-capture-final",
    ),
  ]);
  assert.deepEqual(readCompletedCalls, [
    buildReadCompletedPhotoCaptureArgs("user-photo", "photo-capture-final"),
  ]);
  assert.deepEqual(updateCalls, [
    buildCompletePhotoCapturePersistenceArgs(
      "user-photo",
      {
        contentType: "image/webp",
        fileName: "moodboard.webp",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
        objectKey: "users/user-photo/photos/moodboard.webp",
        photoCaptureId: "photo-capture-final",
        sizeBytes: 4096,
      },
      PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
    ),
  ]);
  assert.equal(scheduledTasks.length, 1);
  await scheduledTasks[0]?.();
  assert.deepEqual(enqueueCalls, [
    {
      inspirationId: "photo-capture-final",
      jobType: "photo_analysis",
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
    },
  ]);
});

test("handleCompletePhotoIngestionRouteRequest logs queue dispatch failures without failing the upload completion response", async () => {
  const { client } = createPersistenceClient();
  const loggedErrors: unknown[] = [];
  const scheduledTasks: Array<() => Promise<void>> = [];

  const response = await handleCompletePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/webp",
        fileName: "moodboard.webp",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
        objectKey: "users/user-photo/photos/moodboard.webp",
        photoCaptureId: "photo-capture-final",
        sizeBytes: 4096,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: createCompletePhotoIngestionRouteDependencies({
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-photo";
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
        photoCaptureAccess: {
          inspiration: {
            async findFirst(args) {
              return {
                id: args.where.id,
              };
            },
          },
        },
        photoCaptureRepository: client,
        queuePublisher: {
          async enqueue() {
            throw new Error("queue dispatch failed");
          },
        },
      }),
    },
  );

  assert.equal(response.status, COMPLETE_PHOTO_INGESTION_ROUTE_OK_STATUS);
  assert.equal(scheduledTasks.length, 1);
  await scheduledTasks[0]?.();
  assert.equal(loggedErrors.length, 1);
  assert.match(String(loggedErrors[0]), /queue dispatch failed/);
});

test("handleCompletePhotoIngestionRouteRequest returns 404 when the signed-in user cannot access the referenced photo capture", async () => {
  let completionCallCount = 0;
  const { queuePublisher } = createQueuePublisher();

  const response = await handleCompletePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/webp",
        fileName: "moodboard.webp",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-route/photos/inaccessible.webp",
        objectKey: "users/user-route/photos/inaccessible.webp",
        photoCaptureId: "photo-capture-inaccessible",
        sizeBytes: 2048,
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
        photoCaptureAccess: {
          inspiration: {
            async findFirst() {
              return null;
            },
          },
        },
        queuePublisher,
      },
    },
  );

  assert.equal(response.status, COMPLETE_PHOTO_INGESTION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: COMPLETE_PHOTO_INGESTION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.equal(completionCallCount, 0);
});

test("handleCompletePhotoIngestionRouteRequest returns 400 for invalid payloads and 500 for unexpected persistence failures", async () => {
  const { queuePublisher } = createQueuePublisher();
  const badRequestResponse = await handleCompletePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "text/plain",
        fileName: "not-an-image.txt",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-route/not-an-image.txt",
        objectKey: "users/user-route/not-an-image.txt",
        photoCaptureId: "photo-capture-bad",
        sizeBytes: 512,
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
        photoCaptureAccess: {
          inspiration: {
            async findFirst() {
              return {
                id: "photo-capture-bad",
              };
            },
          },
        },
        queuePublisher,
      },
    },
  );

  assert.equal(badRequestResponse.status, COMPLETE_PHOTO_INGESTION_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await badRequestResponse.json(), {
    error: COMPLETE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
  });

  const internalErrorResponse = await handleCompletePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/webp",
        fileName: "moodboard.webp",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-route/moodboard.webp",
        objectKey: "users/user-route/moodboard.webp",
        photoCaptureId: "photo-capture-failure",
        sizeBytes: 2048,
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
        photoCaptureAccess: {
          inspiration: {
            async findFirst() {
              return {
                id: "photo-capture-failure",
              };
            },
          },
        },
        queuePublisher,
      },
    },
  );

  assert.equal(
    internalErrorResponse.status,
    COMPLETE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
  );
  assert.deepEqual(await internalErrorResponse.json(), {
    error: COMPLETE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR,
  });
});

test("app/api/media/photos/route.ts delegates photo upload completion requests to the configured completion handler", async () => {
  const { client } = createPersistenceClient();
  const { queuePublisher } = createQueuePublisher();

  configureCompletePhotoIngestionRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    completionService: createCompletePhotoCaptureService({
      photoCaptureRepository: client,
    }),
    photoCaptureAccess: {
      inspiration: {
        async findFirst(args) {
          return {
            id: args.where.id,
          };
        },
      },
    },
    queuePublisher,
  });

  try {
    const { POST } = await import("../apps/web/app/api/media/photos/route.ts");
    const response = await POST(
      new Request("https://waka.app/api/media/photos", {
        method: "POST",
        body: JSON.stringify({
          contentType: "image/webp",
          fileName: "route.webp",
          mediaUrl:
            "https://waka.app/api/media/photos/users/user-route/photos/route.webp",
          objectKey: "users/user-route/photos/route.webp",
          photoCaptureId: "photo-capture-route",
          sizeBytes: 3072,
        }),
        headers: {
          "content-type": "application/json",
        },
      }) as never,
    );

    assert.equal(response.status, COMPLETE_PHOTO_INGESTION_ROUTE_OK_STATUS);
    assert.deepEqual(await response.json(), {
      id: "photo-capture-route",
      photoFileName: "route.webp",
      photoMimeType: "image/webp",
      photoSizeBytes: 3072,
      photoStorageKey: "users/user-route/photos/route.webp",
      photoStorageUrl:
        "https://waka.app/api/media/photos/users/user-route/photos/route.webp",
      photoUploadStatus: PHOTO_CAPTURE_UPLOADED_STATUS,
      rawContent: "route.webp",
      sourceType: "PHOTO",
    });
  } finally {
    configureCompletePhotoIngestionRouteDependencies(null);
  }
});

test("app/api/media/photos/route.ts preserves the shared 404 contract when the target photo capture is inaccessible", async () => {
  const { queuePublisher } = createQueuePublisher();

  configureCompletePhotoIngestionRouteDependencies({
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
    photoCaptureAccess: {
      inspiration: {
        async findFirst() {
          return null;
        },
      },
    },
    queuePublisher,
  });

  try {
    const { POST } = await import("../apps/web/app/api/media/photos/route.ts");
    const response = await POST(
      new Request("https://waka.app/api/media/photos", {
        method: "POST",
        body: JSON.stringify({
          contentType: "image/webp",
          fileName: "route.webp",
          mediaUrl:
            "https://waka.app/api/media/photos/users/user-route/photos/route.webp",
          objectKey: "users/user-route/photos/route.webp",
          photoCaptureId: "photo-capture-route",
          sizeBytes: 3072,
        }),
        headers: {
          "content-type": "application/json",
        },
      }) as never,
    );

    assert.equal(response.status, COMPLETE_PHOTO_INGESTION_ROUTE_NOT_FOUND_STATUS);
    assert.deepEqual(await response.json(), {
      error: COMPLETE_PHOTO_INGESTION_ROUTE_NOT_FOUND_ERROR,
    });
  } finally {
    configureCompletePhotoIngestionRouteDependencies(null);
  }
});
