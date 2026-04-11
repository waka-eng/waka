import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWorkspaceHomePhotoDraftUploadProgress,
  captureWorkspaceHomeCameraPhoto,
  createWorkspaceHomePhotoDraft,
  createWorkspaceHomePhotoDraftErrorState,
  createWorkspaceHomeLocalImagePayload,
  createWorkspaceHomeSelectedLocalImagePayload,
  markWorkspaceHomePhotoDraftUploadCompleted,
  markWorkspaceHomePhotoDraftUploadFailed,
  markWorkspaceHomePhotoDraftUploadPending,
  prepareWorkspaceHomeSelectedPhotoDraft,
  readWorkspaceHomePhotoCaptureErrorMessage,
  resetWorkspaceHomePhotoDraftUploadState,
  releaseWorkspaceHomePhotoDraftPreview,
  WORKSPACE_HOME_PHOTO_CAPTURE_DEFAULT_MIME_TYPE,
  WORKSPACE_HOME_PHOTO_CAPTURE_DEFAULT_QUALITY,
  WORKSPACE_HOME_PHOTO_CAPTURE_DEVICE_MISSING_ERROR,
  WORKSPACE_HOME_PHOTO_CAPTURE_IMAGE_ERROR,
  WORKSPACE_HOME_PHOTO_CAPTURE_PERMISSION_DENIED_ERROR,
  WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR,
  WORKSPACE_HOME_PHOTO_CAPTURE_START_ERROR,
  WORKSPACE_HOME_PHOTO_CAPTURE_UNSUPPORTED_ERROR,
} from "../apps/web/src/home/photo-capture.ts";

test("createWorkspaceHomeLocalImagePayload normalizes a captured image into the photo intake contract", async () => {
  const payload = createWorkspaceHomeLocalImagePayload(
    {
      fileName: "camera-capture-1775793906000.jpg",
      imageBlob: new Blob(["camera-frame"], {
        type: "IMAGE/JPEG",
      }),
      intakePath: "camera-capture",
      source: "camera",
    },
    {
      now: () => new Date("2026-04-10T04:05:06.000Z"),
    },
  );

  assert.equal(payload.fileName, "camera-capture-1775793906000.jpg");
  assert.equal(payload.imageFile.name, "camera-capture-1775793906000.jpg");
  assert.equal(payload.imageFile.type, "image/jpeg");
  assert.equal(payload.intakePath, "camera-capture");
  assert.equal(payload.mimeType, "image/jpeg");
  assert.equal(payload.source, "camera");
  assert.equal(payload.sourceType, "PHOTO");
  assert.equal(payload.sizeBytes, payload.imageFile.size);
  assert.deepEqual(payload.sourceMeta, {
    fileName: "camera-capture-1775793906000.jpg",
    mimeType: "image/jpeg",
    sizeBytes: payload.imageFile.size,
  });
  assert.equal(await payload.imageFile.text(), "camera-frame");
});

test("createWorkspaceHomeSelectedLocalImagePayload normalizes a gallery selection into the photo intake contract", async () => {
  const payload = createWorkspaceHomeSelectedLocalImagePayload(
    {
      imageFile: new File(["gallery-frame"], "  whiteboard.PNG  ", {
        type: "IMAGE/PNG",
      }),
      source: "gallery",
    },
    {
      now: () => new Date("2026-04-10T04:05:06.000Z"),
    },
  );

  assert.equal(payload.fileName, "whiteboard.PNG");
  assert.equal(payload.imageFile.name, "whiteboard.PNG");
  assert.equal(payload.imageFile.type, "image/png");
  assert.equal(payload.intakePath, "gallery-selection");
  assert.equal(payload.mimeType, "image/png");
  assert.equal(payload.source, "gallery");
  assert.equal(payload.sourceType, "PHOTO");
  assert.equal(payload.sizeBytes, payload.imageFile.size);
  assert.deepEqual(payload.sourceMeta, {
    fileName: "whiteboard.PNG",
    mimeType: "image/png",
    sizeBytes: payload.imageFile.size,
  });
  assert.equal(await payload.imageFile.text(), "gallery-frame");
});

test("createWorkspaceHomeSelectedLocalImagePayload infers a valid image MIME type from the file extension when the browser omits it", () => {
  const payload = createWorkspaceHomeSelectedLocalImagePayload({
    imageFile: new File(["gallery-frame"], "whiteboard.png", {
      type: "",
    }),
    source: "gallery",
  });

  assert.equal(payload.mimeType, "image/png");
  assert.equal(payload.imageFile.type, "image/png");
});

test("createWorkspaceHomeSelectedLocalImagePayload rejects non-image gallery files", () => {
  assert.throws(
    () =>
      createWorkspaceHomeSelectedLocalImagePayload({
        imageFile: new File(["plain-text"], "notes.txt", {
          type: "text/plain",
        }),
        source: "gallery",
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR,
  );
});

test("createWorkspaceHomePhotoDraft wraps a validated local image with preview and upload handoff metadata", async () => {
  const localImagePayload = createWorkspaceHomeSelectedLocalImagePayload({
    imageFile: new File(["draft-preview"], "moodboard.webp", {
      type: "image/webp",
    }),
    source: "gallery",
  });

  const photoDraft = createWorkspaceHomePhotoDraft(localImagePayload, {
    createObjectUrl: (blob) => `blob:photo-draft/${(blob as File).name}`,
  });

  assert.equal(photoDraft.preview.objectUrl, "blob:photo-draft/moodboard.webp");
  assert.equal(photoDraft.preview.altText, "Photo preview for moodboard.webp");
  assert.deepEqual(photoDraft.uploadState, {
    progressPercent: 0,
    status: "idle",
    uploadedBytes: 0,
  });
  assert.deepEqual(photoDraft.uploadHandoff, {
    fileName: "moodboard.webp",
    imageFile: photoDraft.imageFile,
    mimeType: "image/webp",
    sizeBytes: photoDraft.imageFile.size,
    sourceMeta: {
      fileName: "moodboard.webp",
      mimeType: "image/webp",
      sizeBytes: photoDraft.imageFile.size,
    },
    sourceType: "PHOTO",
  });
  assert.equal(await photoDraft.uploadHandoff.imageFile.text(), "draft-preview");
});

test("photo draft upload state helpers preserve byte progress and terminal status", () => {
  const draft = createWorkspaceHomePhotoDraft(
    createWorkspaceHomeSelectedLocalImagePayload({
      imageFile: new File(["draft-preview"], "moodboard.webp", {
        type: "image/webp",
      }),
      source: "gallery",
    }),
    {
      createObjectUrl: () => "blob:photo-draft/moodboard.webp",
    },
  );

  const pendingDraft = markWorkspaceHomePhotoDraftUploadPending(draft);
  const uploadingDraft = applyWorkspaceHomePhotoDraftUploadProgress(
    pendingDraft,
    {
      loadedBytes: 7,
      progressPercent: 53.8,
    },
  );
  const failedDraft = markWorkspaceHomePhotoDraftUploadFailed(
    uploadingDraft,
    "Network stalled.",
  );
  const completedDraft = markWorkspaceHomePhotoDraftUploadCompleted(
    uploadingDraft,
  );

  assert.deepEqual(pendingDraft.uploadState, {
    progressPercent: 0,
    status: "pending",
    uploadedBytes: 0,
  });
  assert.deepEqual(uploadingDraft.uploadState, {
    progressPercent: 54,
    status: "uploading",
    uploadedBytes: 7,
  });
  assert.deepEqual(failedDraft.uploadState, {
    errorMessage: "Network stalled.",
    progressPercent: 54,
    status: "failed",
    uploadedBytes: 7,
  });
  assert.deepEqual(completedDraft.uploadState, {
    progressPercent: 100,
    status: "uploaded",
    uploadedBytes: draft.sizeBytes,
  });
});

test("resetWorkspaceHomePhotoDraftUploadState preserves the local draft while clearing retry-blocking upload metadata", () => {
  const draft = createWorkspaceHomePhotoDraft(
    createWorkspaceHomeSelectedLocalImagePayload({
      imageFile: new File(["draft-preview"], "moodboard.webp", {
        type: "image/webp",
      }),
      source: "gallery",
    }),
    {
      createObjectUrl: () => "blob:photo-draft/moodboard.webp",
    },
  );
  const failedDraft = markWorkspaceHomePhotoDraftUploadFailed(
    {
      ...draft,
      uploadToken: {
        image: {
          contentType: "image/webp",
          fileName: draft.fileName,
          mediaUrl: "https://waka.app/media/photos/moodboard.webp",
          sizeBytes: draft.sizeBytes,
          storageKey: "users/user-photo/photos/moodboard.webp",
        },
        mediaUrl: "https://waka.app/media/photos/moodboard.webp",
        objectKey: "users/user-photo/photos/moodboard.webp",
        storageKey: "users/user-photo/photos/moodboard.webp",
        upload: {
          fields: {},
          headers: {
            "content-type": "image/webp",
          },
          method: "PUT",
          url: "https://uploads.waka.app/presigned/moodboard",
        },
      },
    },
    "Photo upload failed with status 500.",
  );

  const retryDraft = resetWorkspaceHomePhotoDraftUploadState(failedDraft);

  assert.equal(retryDraft.preview.objectUrl, draft.preview.objectUrl);
  assert.equal(retryDraft.imageFile, draft.imageFile);
  assert.deepEqual(retryDraft.uploadIdentity, {
    mediaUrl: "https://waka.app/media/photos/moodboard.webp",
    objectKey: "users/user-photo/photos/moodboard.webp",
    storageKey: "users/user-photo/photos/moodboard.webp",
  });
  assert.equal(retryDraft.uploadToken, undefined);
  assert.deepEqual(retryDraft.uploadState, {
    progressPercent: 0,
    status: "idle",
    uploadedBytes: 0,
  });
});

test("prepareWorkspaceHomeSelectedPhotoDraft returns an actionable error state for invalid gallery files", () => {
  const result = prepareWorkspaceHomeSelectedPhotoDraft({
    imageFile: new File(["plain-text"], "notes.txt", {
      type: "text/plain",
    }),
    source: "gallery",
  });

  assert.deepEqual(result, {
    code: "selection-invalid",
    feedbackMessage: WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR,
    intakePath: "gallery-selection",
    nextStep: "Choose a different image file and try again.",
    source: "gallery",
    status: "error",
  });
});

test("createWorkspaceHomePhotoDraftErrorState maps permission failures to an actionable retry hint", () => {
  assert.deepEqual(
    createWorkspaceHomePhotoDraftErrorState(
      "camera",
      new Error(WORKSPACE_HOME_PHOTO_CAPTURE_PERMISSION_DENIED_ERROR),
    ),
    {
      code: "permission-denied",
      feedbackMessage: WORKSPACE_HOME_PHOTO_CAPTURE_PERMISSION_DENIED_ERROR,
      intakePath: "camera-capture",
      nextStep:
        "Allow camera access in the browser, then try the photo capture again.",
      source: "camera",
      status: "error",
    },
  );
});

test("releaseWorkspaceHomePhotoDraftPreview disposes an existing preview URL", () => {
  const revokedObjectUrls: string[] = [];
  const photoDraft = createWorkspaceHomePhotoDraft(
    createWorkspaceHomeSelectedLocalImagePayload({
      imageFile: new File(["draft-preview"], "moodboard.webp", {
        type: "image/webp",
      }),
      source: "gallery",
    }),
    {
      createObjectUrl: () => "blob:photo-draft/moodboard.webp",
    },
  );

  releaseWorkspaceHomePhotoDraftPreview(photoDraft, {
    revokeObjectUrl(objectUrl) {
      revokedObjectUrls.push(objectUrl);
    },
  });

  assert.deepEqual(revokedObjectUrls, ["blob:photo-draft/moodboard.webp"]);
});

test("captureWorkspaceHomeCameraPhoto requests environment-facing camera access, captures a frame, and returns a normalized local image payload", async () => {
  const requestedConstraints: MediaStreamConstraints[] = [];
  let playCallCount = 0;
  let pauseCallCount = 0;
  let stopTrackCallCount = 0;
  let drawImageCall:
    | [unknown, number, number, number, number]
    | undefined;
  const stream = {
    getTracks() {
      return [
        {
          stop() {
            stopTrackCallCount += 1;
          },
        },
      ];
    },
  };
  const videoElement = {
    autoplay: false,
    muted: false,
    playsInline: false,
    srcObject: null as unknown,
    videoHeight: 720,
    videoWidth: 1280,
    async play() {
      playCallCount += 1;
    },
    pause() {
      pauseCallCount += 1;
    },
  };
  const canvasElement = {
    height: 0,
    width: 0,
    getContext() {
      return {
        drawImage(
          image: unknown,
          dx: number,
          dy: number,
          dWidth: number,
          dHeight: number,
        ) {
          drawImageCall = [image, dx, dy, dWidth, dHeight];
        },
      };
    },
    toBlob(callback: BlobCallback, type?: string, quality?: number) {
      assert.equal(type, WORKSPACE_HOME_PHOTO_CAPTURE_DEFAULT_MIME_TYPE);
      assert.equal(quality, WORKSPACE_HOME_PHOTO_CAPTURE_DEFAULT_QUALITY);
      callback(
        new Blob(["camera-frame"], {
          type,
        }),
      );
    },
  };

  const payload = await captureWorkspaceHomeCameraPhoto({
    createCanvasElement: () => canvasElement,
    createVideoElement: () => videoElement,
    mediaDevices: {
      async getUserMedia(constraints) {
        requestedConstraints.push(constraints);
        return stream;
      },
    },
    now: () => new Date("2026-04-10T04:05:06.000Z"),
  });

  assert.equal(requestedConstraints.length, 1);
  assert.equal(requestedConstraints[0]?.audio, false);
  assert.deepEqual(requestedConstraints[0]?.video, {
    facingMode: {
      ideal: "environment",
    },
  });
  assert.equal(videoElement.autoplay, true);
  assert.equal(videoElement.muted, true);
  assert.equal(videoElement.playsInline, true);
  assert.equal(playCallCount, 1);
  assert.equal(pauseCallCount, 1);
  assert.equal(stopTrackCallCount, 1);
  assert.equal(videoElement.srcObject, null);
  assert.equal(canvasElement.width, 1280);
  assert.equal(canvasElement.height, 720);
  assert.deepEqual(drawImageCall, [videoElement, 0, 0, 1280, 720]);
  assert.equal(payload.fileName, "camera-capture-1775793906000.jpg");
  assert.equal(payload.imageFile.name, "camera-capture-1775793906000.jpg");
  assert.equal(payload.imageFile.type, "image/jpeg");
  assert.equal(payload.intakePath, "camera-capture");
  assert.equal(payload.source, "camera");
  assert.equal(payload.sourceType, "PHOTO");
  assert.equal(await payload.imageFile.text(), "camera-frame");
});

test("captureWorkspaceHomeCameraPhoto maps camera permission errors to an explicit capture message", async () => {
  await assert.rejects(
    () =>
      captureWorkspaceHomeCameraPhoto({
        createVideoElement: () => ({
          autoplay: false,
          muted: false,
          playsInline: false,
          srcObject: null,
          videoHeight: 0,
          videoWidth: 0,
          async play() {},
        }),
        mediaDevices: {
          async getUserMedia() {
            throw {
              name: "NotAllowedError",
            };
          },
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === WORKSPACE_HOME_PHOTO_CAPTURE_PERMISSION_DENIED_ERROR,
  );
});

test("readWorkspaceHomePhotoCaptureErrorMessage preserves already-normalized camera capture messages", () => {
  assert.equal(
    readWorkspaceHomePhotoCaptureErrorMessage(
      new Error(WORKSPACE_HOME_PHOTO_CAPTURE_PERMISSION_DENIED_ERROR),
    ),
    WORKSPACE_HOME_PHOTO_CAPTURE_PERMISSION_DENIED_ERROR,
  );
  assert.equal(
    readWorkspaceHomePhotoCaptureErrorMessage(
      new Error(WORKSPACE_HOME_PHOTO_CAPTURE_DEVICE_MISSING_ERROR),
    ),
    WORKSPACE_HOME_PHOTO_CAPTURE_DEVICE_MISSING_ERROR,
  );
  assert.equal(
    readWorkspaceHomePhotoCaptureErrorMessage(
      new Error(WORKSPACE_HOME_PHOTO_CAPTURE_START_ERROR),
    ),
    WORKSPACE_HOME_PHOTO_CAPTURE_START_ERROR,
  );
  assert.equal(
    readWorkspaceHomePhotoCaptureErrorMessage(
      new Error(WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR),
    ),
    WORKSPACE_HOME_PHOTO_CAPTURE_SELECTION_ERROR,
  );
});

test("captureWorkspaceHomeCameraPhoto rejects unsupported environments before requesting a frame", async () => {
  await assert.rejects(
    () => captureWorkspaceHomeCameraPhoto({}),
    (error: unknown) =>
      error instanceof Error &&
      error.message === WORKSPACE_HOME_PHOTO_CAPTURE_UNSUPPORTED_ERROR,
  );
});

test("captureWorkspaceHomeCameraPhoto stops camera tracks when frame extraction fails", async () => {
  let stopTrackCallCount = 0;

  await assert.rejects(
    () =>
      captureWorkspaceHomeCameraPhoto({
        createCanvasElement: () => ({
          height: 0,
          width: 0,
          getContext() {
            return {
              drawImage() {},
            };
          },
          toBlob(callback: BlobCallback) {
            callback(null);
          },
        }),
        createVideoElement: () => ({
          autoplay: false,
          muted: false,
          playsInline: false,
          srcObject: null,
          videoHeight: 720,
          videoWidth: 1280,
          async play() {},
          pause() {},
        }),
        mediaDevices: {
          async getUserMedia() {
            return {
              getTracks() {
                return [
                  {
                    stop() {
                      stopTrackCallCount += 1;
                    },
                  },
                ];
              },
            };
          },
        },
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === WORKSPACE_HOME_PHOTO_CAPTURE_IMAGE_ERROR,
  );

  assert.equal(stopTrackCallCount, 1);
});
