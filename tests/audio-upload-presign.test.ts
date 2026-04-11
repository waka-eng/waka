import assert from "node:assert/strict";
import test from "node:test";

import {
  AUDIO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY,
  AUDIO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY,
  AUDIO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY,
  buildAudioUploadSetup,
  createAudioUploadSetupGenerator,
  resolveAudioUploadAwsCredentials,
} from "../apps/web/src/media/audio-upload-presign.ts";
import {
  AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY,
  AUDIO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY,
  AUDIO_UPLOAD_REGION_ENVIRONMENT_KEY,
} from "../apps/web/src/media/audio-upload-config.ts";

const TEST_ENV = {
  [AUDIO_UPLOAD_APP_URL_ENVIRONMENT_KEY]: "https://waka.app",
  [AUDIO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY]: "AKIAEXAMPLE",
  [AUDIO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY]:
    "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  [AUDIO_UPLOAD_AWS_SESSION_TOKEN_ENVIRONMENT_KEY]: "session-token",
  [AUDIO_UPLOAD_BUCKET_NAME_ENVIRONMENT_KEY]: "waka-dev-media-bucket",
  [AUDIO_UPLOAD_REGION_ENVIRONMENT_KEY]: "us-east-1",
} satisfies NodeJS.ProcessEnv;

test("resolveAudioUploadAwsCredentials returns the Lambda-style AWS signing credentials", () => {
  assert.deepEqual(resolveAudioUploadAwsCredentials(TEST_ENV), {
    accessKeyId: "AKIAEXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
    sessionToken: "session-token",
  });
});

test("resolveAudioUploadAwsCredentials rejects missing signing credentials", () => {
  assert.throws(
    () =>
      resolveAudioUploadAwsCredentials({
        [AUDIO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY]:
          "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      }),
    new RegExp(AUDIO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY),
  );

  assert.throws(
    () =>
      resolveAudioUploadAwsCredentials({
        [AUDIO_UPLOAD_AWS_ACCESS_KEY_ID_ENVIRONMENT_KEY]: "AKIAEXAMPLE",
      }),
    new RegExp(AUDIO_UPLOAD_AWS_SECRET_ACCESS_KEY_ENVIRONMENT_KEY),
  );
});

test("buildAudioUploadSetup returns a deterministic direct-upload contract for voice-note captures", () => {
  const setup = buildAudioUploadSetup(
    {
      contentType: "AUDIO/WEBM; codecs=opus",
      userId: "user-audio",
      voiceCaptureId: "voice-capture-audio",
    },
    {
      env: TEST_ENV,
      keyId: "upload-01",
      now: new Date("2026-04-10T04:05:06.000Z"),
    },
  );

  assert.deepEqual(setup, {
    mediaUrl:
      "https://waka.app/api/media/audio/users/user-audio/voice-notes/1775793906000-voice-note-upload-01.webm",
    objectKey:
      "users/user-audio/voice-notes/1775793906000-voice-note-upload-01.webm",
    upload: {
      headers: {
        "content-type": "audio/webm",
      },
      method: "PUT",
      url:
        "https://waka-dev-media-bucket.s3.us-east-1.amazonaws.com/users/user-audio/voice-notes/1775793906000-voice-note-upload-01.webm?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20260410%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260410T040506Z&X-Amz-Expires=900&X-Amz-Security-Token=session-token&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=e121803c3bc824ecf283017c70649c249346db45cecdf72bc34305fa9cef1efe",
    },
  });
});

test("buildAudioUploadSetup rejects a missing target voice capture id", () => {
  assert.throws(
    () =>
      buildAudioUploadSetup(
        {
          contentType: "audio/webm",
          userId: "user-audio",
          voiceCaptureId: "   ",
        },
        {
          env: TEST_ENV,
          keyId: "upload-01",
          now: new Date("2026-04-10T04:05:06.000Z"),
        },
      ),
    /voiceCaptureId/i,
  );
});

test("createAudioUploadSetupGenerator implements the route dependency contract", async () => {
  const generator = createAudioUploadSetupGenerator({
    env: TEST_ENV,
    keyIdFactory: () => "upload-fixed",
    now: () => new Date("2026-04-10T04:05:06.000Z"),
  });

  const setup = await generator.generateUploadSetup({
    contentType: "audio/mp4",
    fileName: "capture.m4a",
    userId: "user-route",
    voiceCaptureId: "voice-capture-route",
  });

  assert.deepEqual(setup, {
    mediaUrl:
      "https://waka.app/api/media/audio/users/user-route/voice-notes/1775793906000-capture-upload-fixed.m4a",
    objectKey:
      "users/user-route/voice-notes/1775793906000-capture-upload-fixed.m4a",
    upload: {
      headers: {
        "content-type": "audio/mp4",
      },
      method: "PUT",
      url:
        "https://waka-dev-media-bucket.s3.us-east-1.amazonaws.com/users/user-route/voice-notes/1775793906000-capture-upload-fixed.m4a?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAEXAMPLE%2F20260410%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20260410T040506Z&X-Amz-Expires=900&X-Amz-Security-Token=session-token&X-Amz-SignedHeaders=content-type%3Bhost&X-Amz-Signature=429cce9447555b847e0d0f243bb5b7a2ea304435630dbf61f273c7beb51f4326",
    },
  });
});
