import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY,
  AUDIO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY,
  AUDIO_UPLOAD_MEDIA_ROUTE_PREFIX,
  AUDIO_UPLOAD_OBJECT_KEY_COLLECTION,
  AUDIO_UPLOAD_OBJECT_KEY_ROOT,
  AUDIO_UPLOAD_REGION_ENVIRONMENT_KEY,
  AUDIO_UPLOAD_SIGNING_EXPIRES_IN_SECONDS,
  AUDIO_UPLOAD_SIGNING_METHOD,
  buildAudioUploadMediaUrl,
  buildAudioUploadObjectKey,
  resolveAudioUploadFileExtension,
  resolveAudioUploadStorageConfig,
  validateAudioUploadFormat,
} from "../apps/web/src/media/audio-upload-config.ts";

test("resolveAudioUploadStorageConfig returns the linked bucket, AWS region, and signing defaults", () => {
  assert.deepEqual(
    resolveAudioUploadStorageConfig({
      [AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: "https://waka.app",
      [AUDIO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY]: "waka-dev-media-bucket",
      [AUDIO_UPLOAD_REGION_ENVIRONMENT_KEY]: "us-east-1",
    }),
    {
      appUrl: "https://waka.app",
      bucketName: "waka-dev-media-bucket",
      region: "us-east-1",
      signing: {
        expiresInSeconds: AUDIO_UPLOAD_SIGNING_EXPIRES_IN_SECONDS,
        method: AUDIO_UPLOAD_SIGNING_METHOD,
      },
    },
  );
});

test("resolveAudioUploadStorageConfig rejects missing bucket bindings and invalid AWS regions", () => {
  assert.throws(
    () =>
      resolveAudioUploadStorageConfig({
        [AUDIO_UPLOAD_REGION_ENVIRONMENT_KEY]: "us-east-1",
      }),
    new RegExp(AUDIO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY),
  );

  assert.throws(
    () =>
      resolveAudioUploadStorageConfig({
        [AUDIO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY]: "waka-dev-media-bucket",
        [AUDIO_UPLOAD_REGION_ENVIRONMENT_KEY]: "not-a-region",
      }),
    /not a valid AWS region/i,
  );
});

test("buildAudioUploadObjectKey creates a sanitized user-scoped voice-note key", () => {
  assert.equal(
    buildAudioUploadObjectKey({
      contentType: " audio/webm ",
      fileName: "../Brainstorm Take 1.WEBM",
      keyId: "Capture 01",
      now: 1_712_800_000_123,
      userId: "user-42",
    }),
    `${AUDIO_UPLOAD_OBJECT_KEY_ROOT}/user-42/${AUDIO_UPLOAD_OBJECT_KEY_COLLECTION}/1712800000123-brainstorm-take-1-capture-01.webm`,
  );
});

test("buildAudioUploadObjectKey falls back to MIME-derived extensions and the default voice-note stem", () => {
  assert.equal(
    buildAudioUploadObjectKey({
      contentType: "audio/mp4; codecs=mp4a.40.2",
      fileName: "   ",
      keyId: "@@@",
      now: 42,
      userId: "user-recorder",
    }),
    `${AUDIO_UPLOAD_OBJECT_KEY_ROOT}/user-recorder/${AUDIO_UPLOAD_OBJECT_KEY_COLLECTION}/42-voice-note-upload.m4a`,
  );
});

test("resolveAudioUploadFileExtension rejects non-audio MIME types", () => {
  assert.throws(
    () => resolveAudioUploadFileExtension("image/png", "capture.png"),
    /valid audio MIME type/i,
  );
});

test("validateAudioUploadFormat rejects unsupported audio MIME types before signing", () => {
  assert.throws(
    () => validateAudioUploadFormat("audio/amr", "capture.amr"),
    /supported audio MIME type/i,
  );
});

test("validateAudioUploadFormat rejects unsupported audio filename extensions before signing", () => {
  assert.throws(
    () => validateAudioUploadFormat("audio/webm", "capture.mp4"),
    /supported audio extension/i,
  );

  assert.throws(
    () => validateAudioUploadFormat("audio/webm", "capture.png"),
    /supported audio extension/i,
  );
});

test("validateAudioUploadFormat rejects supported audio extensions that do not match the MIME type", () => {
  assert.throws(
    () => validateAudioUploadFormat("audio/webm", "capture.ogg"),
    /does not match contentType/i,
  );
});

test("resolveAudioUploadFileExtension preserves supported filename extensions that match the MIME type", () => {
  assert.equal(resolveAudioUploadFileExtension("audio/webm", "capture.webm"), "webm");
});

test("buildAudioUploadMediaUrl resolves media URLs from APP_URL without hardcoding the domain", () => {
  assert.equal(
    buildAudioUploadMediaUrl(
      "users/user-audio/voice-notes/1775793906000-voice-note-upload.webm",
      {
        [AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: "https://waka.app",
      },
    ),
    `https://waka.app${AUDIO_UPLOAD_MEDIA_ROUTE_PREFIX}/users/user-audio/voice-notes/1775793906000-voice-note-upload.webm`,
  );
});
