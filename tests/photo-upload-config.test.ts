import assert from "node:assert/strict";
import test from "node:test";

import {
  PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY,
  PHOTO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY,
  PHOTO_UPLOAD_MEDIA_ROUTE_PREFIX,
  PHOTO_UPLOAD_OBJECT_KEY_COLLECTION,
  PHOTO_UPLOAD_OBJECT_KEY_ROOT,
  PHOTO_UPLOAD_REGION_ENVIRONMENT_KEY,
  PHOTO_UPLOAD_SIGNING_EXPIRES_IN_SECONDS,
  PHOTO_UPLOAD_SIGNING_METHOD,
  buildPhotoUploadMediaUrl,
  buildPhotoUploadObjectKey,
  resolvePhotoUploadFileExtension,
  resolvePhotoUploadStorageConfig,
} from "../apps/web/src/media/photo-upload-config.ts";

test("resolvePhotoUploadStorageConfig returns the linked bucket, AWS region, app URL, and signing defaults", () => {
  assert.deepEqual(
    resolvePhotoUploadStorageConfig({
      [PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: "https://waka.app",
      [PHOTO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY]: "waka-dev-media-bucket",
      [PHOTO_UPLOAD_REGION_ENVIRONMENT_KEY]: "us-east-1",
    }),
    {
      appUrl: "https://waka.app",
      bucketName: "waka-dev-media-bucket",
      region: "us-east-1",
      signing: {
        expiresInSeconds: PHOTO_UPLOAD_SIGNING_EXPIRES_IN_SECONDS,
        method: PHOTO_UPLOAD_SIGNING_METHOD,
      },
    },
  );
});

test("resolvePhotoUploadStorageConfig rejects missing bucket bindings, invalid regions, and invalid app origins", () => {
  assert.throws(
    () =>
      resolvePhotoUploadStorageConfig({
        [PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: "https://waka.app",
        [PHOTO_UPLOAD_REGION_ENVIRONMENT_KEY]: "us-east-1",
      }),
    new RegExp(PHOTO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY),
  );

  assert.throws(
    () =>
      resolvePhotoUploadStorageConfig({
        [PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: "https://waka.app",
        [PHOTO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY]: "waka-dev-media-bucket",
        [PHOTO_UPLOAD_REGION_ENVIRONMENT_KEY]: "not-a-region",
      }),
    /not a valid AWS region/i,
  );

  assert.throws(
    () =>
      resolvePhotoUploadStorageConfig({
        [PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: "https://waka.app/dashboard",
        [PHOTO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY]: "waka-dev-media-bucket",
        [PHOTO_UPLOAD_REGION_ENVIRONMENT_KEY]: "us-east-1",
      }),
    new RegExp(PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY),
  );
});

test("buildPhotoUploadObjectKey creates a sanitized user-scoped photo key", () => {
  assert.equal(
    buildPhotoUploadObjectKey({
      contentType: " image/png ",
      fileName: "../Brainstorm Wall.Final.PNG",
      keyId: "Capture 01",
      now: 1_712_800_000_123,
      userId: "user-42",
    }),
    `${PHOTO_UPLOAD_OBJECT_KEY_ROOT}/user-42/${PHOTO_UPLOAD_OBJECT_KEY_COLLECTION}/1712800000123-brainstorm-wall-final-capture-01.png`,
  );
});

test("buildPhotoUploadObjectKey falls back to MIME-derived extensions and the default photo stem", () => {
  assert.equal(
    buildPhotoUploadObjectKey({
      contentType: "image/jpeg; charset=binary",
      fileName: "   ",
      keyId: "@@@",
      now: 42,
      userId: "user-camera",
    }),
    `${PHOTO_UPLOAD_OBJECT_KEY_ROOT}/user-camera/${PHOTO_UPLOAD_OBJECT_KEY_COLLECTION}/42-photo-upload.jpg`,
  );
});

test("buildPhotoUploadMediaUrl derives the retrieval URL from APP_URL and the object key path", () => {
  assert.equal(
    buildPhotoUploadMediaUrl(
      "users/user-42/photos/1712800000123-brainstorm-wall-final-capture-01.png",
      {
        [PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: "https://waka.app",
      },
    ),
    `https://waka.app${PHOTO_UPLOAD_MEDIA_ROUTE_PREFIX}/users/user-42/photos/1712800000123-brainstorm-wall-final-capture-01.png`,
  );
});

test("resolvePhotoUploadFileExtension rejects non-image MIME types", () => {
  assert.throws(
    () => resolvePhotoUploadFileExtension("audio/webm", "capture.webm"),
    /valid image MIME type/i,
  );
});
