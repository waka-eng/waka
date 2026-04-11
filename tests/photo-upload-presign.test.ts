import assert from "node:assert/strict";
import test from "node:test";

import {
  PHOTO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY,
  PHOTO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY,
  PHOTO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY,
  buildPhotoUploadSetup,
  createPhotoUploadSetupGenerator,
  resolvePhotoUploadAwsCredentials,
} from "../apps/web/src/media/photo-upload-presign.ts";
import {
  INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_MEDIA_URL_MISMATCH_ERROR,
  INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_SCOPE_INVALID_ERROR,
} from "../apps/web/src/media/photo-ingestion-init-route.ts";
import {
  PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY,
  PHOTO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY,
  PHOTO_UPLOAD_REGION_ENVIRONMENT_KEY,
} from "../apps/web/src/media/photo-upload-config.ts";

const TEST_ENV = {
  [PHOTO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: "https://waka.app",
  [PHOTO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY]: "AKIAEXAMPLE",
  [PHOTO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY]:
    "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  [PHOTO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY]: "session-token",
  [PHOTO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY]: "waka-dev-media-bucket",
  [PHOTO_UPLOAD_REGION_ENVIRONMENT_KEY]: "us-east-1",
} satisfies NodeJS.ProcessEnv;

test("resolvePhotoUploadAwsCredentials returns the Lambda-style AWS signing credentials", () => {
  assert.deepEqual(resolvePhotoUploadAwsCredentials(TEST_ENV), {
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    sessionToken: "session-token",
  });
});

test("resolvePhotoUploadAwsCredentials rejects missing signing credentials", () => {
  assert.throws(
    () =>
      resolvePhotoUploadAwsCredentials({
        [PHOTO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY]:
          "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      }),
    new RegExp(PHOTO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY),
  );

  assert.throws(
    () =>
      resolvePhotoUploadAwsCredentials({
        [PHOTO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY]: "AKIAEXAMPLE",
      }),
    new RegExp(PHOTO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY),
  );
});

test("buildPhotoUploadSetup returns a deterministic direct-upload contract for photo captures", () => {
  const setup = buildPhotoUploadSetup(
    {
      contentType: "IMAGE/PNG",
      fileName: "Moodboard Final.PNG",
      sizeBytes: 4096,
      userId: "user-photo",
    },
    {
      env: TEST_ENV,
      keyId: "upload-01",
      now: new Date("2026-04-10T04:05:06.000Z"),
    },
  );

  assert.deepEqual(setup, {
    image: {
      contentType: "image/png",
      fileName: "Moodboard Final.PNG",
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
      sizeBytes: 4096,
      storageKey:
        "users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
    },
    mediaUrl:
      "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
    objectKey:
      "users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
    storageKey:
      "users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
    upload: {
      fields: {},
      headers: {
        "content-type": "image/png",
      },
      method: "PUT",
      url:
        "https://waka-dev-media-bucket.s3.us-east-1.amazonaws.com/users/user-photo/photos/1775793906000-moodboard-final-upload-01.png?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20260410%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260410T040506Z&X-Amz-Expires=900&X-Amz-Security-Token=session-token&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=80ecf8d23ca75d05f4185d1440e01042131fa625e17686df2b4699cd48be4481",
    },
  });
});

test("buildPhotoUploadSetup reuses an existing draft upload identity instead of minting a duplicate blob key", () => {
  const setup = buildPhotoUploadSetup(
    {
      contentType: "image/png",
      existingUpload: {
        mediaUrl:
          "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
        objectKey:
          "users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
        storageKey:
          "users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
      },
      fileName: "Moodboard Final.PNG",
      sizeBytes: 4096,
      userId: "user-photo",
    },
    {
      env: TEST_ENV,
      keyId: "upload-02",
      now: new Date("2026-04-10T04:06:06.000Z"),
    },
  );

  assert.equal(
    setup.objectKey,
    "users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
  );
  assert.equal(
    setup.mediaUrl,
    "https://waka.app/api/media/photos/users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
  );
  assert.match(setup.upload.url, /X-Amz-Date=20260410T040606Z/u);
});

test("buildPhotoUploadSetup rejects existing draft upload identities outside the authenticated user scope or derived media path", () => {
  assert.throws(
    () =>
      buildPhotoUploadSetup(
        {
          contentType: "image/png",
          existingUpload: {
            mediaUrl:
              "https://waka.app/api/media/photos/users/other-user/photos/1775793906000-moodboard-final-upload-01.png",
            objectKey:
              "users/other-user/photos/1775793906000-moodboard-final-upload-01.png",
            storageKey:
              "users/other-user/photos/1775793906000-moodboard-final-upload-01.png",
          },
          fileName: "Moodboard Final.PNG",
          sizeBytes: 4096,
          userId: "user-photo",
        },
        {
          env: TEST_ENV,
          now: new Date("2026-04-10T04:06:06.000Z"),
        },
      ),
    new TypeError(INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_SCOPE_INVALID_ERROR),
  );

  assert.throws(
    () =>
      buildPhotoUploadSetup(
        {
          contentType: "image/png",
          existingUpload: {
            mediaUrl: "https://waka.app/api/media/photos/wrong-path.png",
            objectKey:
              "users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
            storageKey:
              "users/user-photo/photos/1775793906000-moodboard-final-upload-01.png",
          },
          fileName: "Moodboard Final.PNG",
          sizeBytes: 4096,
          userId: "user-photo",
        },
        {
          env: TEST_ENV,
          now: new Date("2026-04-10T04:06:06.000Z"),
        },
      ),
    new TypeError(
      INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_MEDIA_URL_MISMATCH_ERROR,
    ),
  );
});

test("createPhotoUploadSetupGenerator implements the route dependency contract", async () => {
  const generator = createPhotoUploadSetupGenerator({
    env: TEST_ENV,
    keyIdFactory: () => "upload-fixed",
    now: () => new Date("2026-04-10T04:05:06.000Z"),
  });

  const setup = await generator.generateUploadSetup({
    contentType: "image/jpeg",
    fileName: "capture.jpg",
    sizeBytes: 1024,
    userId: "user-route",
  });

  assert.deepEqual(setup, {
    image: {
      contentType: "image/jpeg",
      fileName: "capture.jpg",
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-route/photos/1775793906000-capture-upload-fixed.jpg",
      sizeBytes: 1024,
      storageKey:
        "users/user-route/photos/1775793906000-capture-upload-fixed.jpg",
    },
    mediaUrl:
      "https://waka.app/api/media/photos/users/user-route/photos/1775793906000-capture-upload-fixed.jpg",
    objectKey:
      "users/user-route/photos/1775793906000-capture-upload-fixed.jpg",
    storageKey:
      "users/user-route/photos/1775793906000-capture-upload-fixed.jpg",
    upload: {
      fields: {},
      headers: {
        "content-type": "image/jpeg",
      },
      method: "PUT",
      url:
        "https://waka-dev-media-bucket.s3.us-east-1.amazonaws.com/users/user-route/photos/1775793906000-capture-upload-fixed.jpg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20260410%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260410T040506Z&X-Amz-Expires=900&X-Amz-Security-Token=session-token&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=05c9fb583422d2fc67ceb2c4a05fa10cfe03b38d9ed750ecb542ce865d6b2daf",
    },
  });
});
