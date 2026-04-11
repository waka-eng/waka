import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompletePhotoCapturePersistenceArgs,
  buildReadCompletedPhotoCaptureArgs,
  buildReadPhotoCaptureFinalizationStatusArgs,
  completePhotoCapture,
  createCompletePhotoCaptureService,
  didCompletePhotoCaptureClaimFinalization,
  resolvePhotoCaptureFinalizeSuccessStatus,
  type CompletePhotoCapturePersistenceClient,
  type CompletedPhotoCaptureRecord,
} from "../apps/web/src/media/complete-photo-capture.ts";
import {
  PHOTO_CAPTURE_FAILED_STATUS,
  PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
  PHOTO_CAPTURE_UPLOADED_STATUS,
} from "../apps/web/src/media/create-photo-capture.ts";

function createPersistenceClient(
  initialStatus: string | null,
): {
  client: CompletePhotoCapturePersistenceClient;
  readCompletedCalls: Array<ReturnType<typeof buildReadCompletedPhotoCaptureArgs>>;
  readStatusCalls: Array<ReturnType<typeof buildReadPhotoCaptureFinalizationStatusArgs>>;
  updateCalls: Array<ReturnType<typeof buildCompletePhotoCapturePersistenceArgs>>;
  uploadedRecord: CompletedPhotoCaptureRecord;
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
    uploadedRecord,
  };
}

test("resolvePhotoCaptureFinalizeSuccessStatus always converges supported pending states to uploaded", () => {
  assert.equal(
    resolvePhotoCaptureFinalizeSuccessStatus(
      PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
    ),
    PHOTO_CAPTURE_UPLOADED_STATUS,
  );
  assert.equal(
    resolvePhotoCaptureFinalizeSuccessStatus(PHOTO_CAPTURE_UPLOADED_STATUS),
    PHOTO_CAPTURE_UPLOADED_STATUS,
  );
  assert.equal(
    resolvePhotoCaptureFinalizeSuccessStatus(PHOTO_CAPTURE_FAILED_STATUS),
    PHOTO_CAPTURE_UPLOADED_STATUS,
  );
  assert.equal(
    resolvePhotoCaptureFinalizeSuccessStatus(undefined),
    PHOTO_CAPTURE_UPLOADED_STATUS,
  );
});

test("buildCompletePhotoCapturePersistenceArgs persists uploaded photo metadata against the authenticated capture owner", () => {
  assert.deepEqual(
    buildCompletePhotoCapturePersistenceArgs(
      "user-photo",
      {
        contentType: " IMAGE/PNG ",
        fileName: " conference-shot.PNG ",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/conference-shot.PNG",
        objectKey: " users/user-photo/photos/conference-shot.PNG ",
        photoCaptureId: " photo-capture-42 ",
        sizeBytes: 2048,
      },
      PHOTO_CAPTURE_FAILED_STATUS,
    ),
    {
      data: {
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/conference-shot.PNG",
        photoFileName: "conference-shot.PNG",
        photoMimeType: "image/png",
        photoSizeBytes: 2048,
        photoStorageKey: "users/user-photo/photos/conference-shot.PNG",
        photoStorageUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/conference-shot.PNG",
        photoUploadStatus: PHOTO_CAPTURE_UPLOADED_STATUS,
        rawContent: "conference-shot.PNG",
        sourceMeta: {
          fileName: "conference-shot.PNG",
          mimeType: "image/png",
          sizeBytes: 2048,
        },
      },
      select: {
        id: true,
        photoFileName: true,
        photoMimeType: true,
        photoSizeBytes: true,
        photoStorageKey: true,
        photoStorageUrl: true,
        photoUploadStatus: true,
        rawContent: true,
        sourceType: true,
      },
      where: {
        userId_id: {
          id: "photo-capture-42",
          userId: "user-photo",
        },
      },
    },
  );
});

for (const startingStatus of [
  PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
  PHOTO_CAPTURE_FAILED_STATUS,
] as const) {
  test(`completePhotoCapture reconciles ${startingStatus} records to uploaded once and treats repeated finalize attempts as a no-op`, async () => {
    const { client, readCompletedCalls, readStatusCalls, updateCalls } =
      createPersistenceClient(startingStatus);

    const firstCompletedCapture = await completePhotoCapture(client, "user-photo", {
      contentType: "image/webp",
      fileName: "moodboard.webp",
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
      objectKey: "users/user-photo/photos/moodboard.webp",
      photoCaptureId: "photo-capture-final",
      sizeBytes: 4096,
    });
    const retriedCapture = await completePhotoCapture(client, "user-photo", {
      contentType: "image/webp",
      fileName: "moodboard.webp",
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
      objectKey: "users/user-photo/photos/moodboard.webp",
      photoCaptureId: "photo-capture-final",
      sizeBytes: 4096,
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
        startingStatus,
      ),
    ]);
    assert.equal(
      firstCompletedCapture.photoUploadStatus,
      PHOTO_CAPTURE_UPLOADED_STATUS,
    );
    assert.equal(didCompletePhotoCaptureClaimFinalization(firstCompletedCapture), true);
    assert.deepEqual(retriedCapture, firstCompletedCapture);
    assert.equal(
      retriedCapture.photoUploadStatus,
      PHOTO_CAPTURE_UPLOADED_STATUS,
    );
  });
}

test("completePhotoCapture treats already-uploaded captures as a read-only no-op", async () => {
  const { client, readCompletedCalls, readStatusCalls, updateCalls, uploadedRecord } =
    createPersistenceClient(PHOTO_CAPTURE_UPLOADED_STATUS);

  const completedCapture = await completePhotoCapture(client, "user-photo", {
    contentType: "image/webp",
    fileName: "moodboard.webp",
    mediaUrl:
      "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.webp",
    objectKey: "users/user-photo/photos/moodboard.webp",
    photoCaptureId: "photo-capture-final",
    sizeBytes: 4096,
  });

  assert.deepEqual(readStatusCalls, [
    buildReadPhotoCaptureFinalizationStatusArgs(
      "user-photo",
      "photo-capture-final",
    ),
  ]);
  assert.deepEqual(readCompletedCalls, [
    buildReadCompletedPhotoCaptureArgs("user-photo", "photo-capture-final"),
  ]);
  assert.deepEqual(updateCalls, []);
  assert.deepEqual(completedCapture, uploadedRecord);
  assert.equal(didCompletePhotoCaptureClaimFinalization(completedCapture), false);
});

test("createCompletePhotoCaptureService delegates finalization through the repository-backed completion flow", async () => {
  const { client, updateCalls } = createPersistenceClient(
    PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
  );
  const service = createCompletePhotoCaptureService({
    photoCaptureRepository: client,
  });

  const completedCapture = await service.complete("user-photo", {
    contentType: "image/jpeg",
    fileName: "whiteboard.jpg",
    mediaUrl:
      "https://waka.app/api/media/photos/users/user-photo/photos/whiteboard.jpg",
    objectKey: "users/user-photo/photos/whiteboard.jpg",
    photoCaptureId: "photo-capture-service",
    sizeBytes: 1024,
  });

  assert.deepEqual(updateCalls, [
    buildCompletePhotoCapturePersistenceArgs(
      "user-photo",
      {
        contentType: "image/jpeg",
        fileName: "whiteboard.jpg",
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/whiteboard.jpg",
        objectKey: "users/user-photo/photos/whiteboard.jpg",
        photoCaptureId: "photo-capture-service",
        sizeBytes: 1024,
      },
      PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
    ),
  ]);
  assert.equal(service.didClaimFinalization?.(completedCapture), true);
});
