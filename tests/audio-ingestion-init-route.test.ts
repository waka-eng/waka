import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIATE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
  INITIATE_AUDIO_INGESTION_FILE_NAME_INVALID_ERROR,
  INITIATE_AUDIO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR,
  INITIATE_AUDIO_INGESTION_REQUEST_BODY_INVALID_ERROR,
  INITIATE_AUDIO_INGESTION_ROUTE_BAD_REQUEST_STATUS,
  INITIATE_AUDIO_INGESTION_ROUTE_CREATED_STATUS,
  INITIATE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR,
  INITIATE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
  INITIATE_AUDIO_INGESTION_ROUTE_NOT_FOUND_ERROR,
  INITIATE_AUDIO_INGESTION_ROUTE_NOT_FOUND_STATUS,
  INITIATE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
  INITIATE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_STATUS,
  INITIATE_AUDIO_INGESTION_VOICE_CAPTURE_ID_REQUIRED_ERROR,
  buildInitiateAudioIngestionVoiceCaptureAccessArgs,
  configureInitiateAudioIngestionRouteDependencies,
  handleInitiateAudioIngestionRouteRequest,
  parseInitiateAudioIngestionRequestBody,
} from "../apps/web/src/media/audio-ingestion-init-route.ts";

test("parseInitiateAudioIngestionRequestBody accepts valid audio metadata and strips spoofed ownership fields", async () => {
  const parsed = await parseInitiateAudioIngestionRequestBody(
    new Request("https://waka.app/api/media/audio/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "  AUDIO/WEBM; codecs=opus  ",
        fileName: "  memo.WEBM  ",
        ownerId: "forged-owner",
        tenantId: "forged-tenant",
        userId: "forged-user",
        voiceCaptureId: "  voice-capture-42  ",
        workspaceId: "forged-workspace",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsed, {
    contentType: "audio/webm",
    fileName: "memo.WEBM",
    voiceCaptureId: "voice-capture-42",
  });
  assert.equal("ownerId" in parsed, false);
  assert.equal("tenantId" in parsed, false);
  assert.equal("userId" in parsed, false);
  assert.equal("workspaceId" in parsed, false);
});

test("parseInitiateAudioIngestionRequestBody accepts a missing filename and rejects invalid audio payloads", async () => {
  const parsed = await parseInitiateAudioIngestionRequestBody(
    new Request("https://waka.app/api/media/audio/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "audio/mp4",
        voiceCaptureId: "voice-capture-audio",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
  );

  assert.deepEqual(parsed, {
    contentType: "audio/mp4",
    voiceCaptureId: "voice-capture-audio",
  });

  await assert.rejects(
    async () =>
      parseInitiateAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio/initiate", {
          method: "POST",
          body: "{",
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new RegExp(INITIATE_AUDIO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseInitiateAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio/initiate", {
          method: "POST",
          body: JSON.stringify("not-an-object"),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(INITIATE_AUDIO_INGESTION_REQUEST_BODY_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseInitiateAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio/initiate", {
          method: "POST",
          body: JSON.stringify({
            contentType: "application/pdf",
            voiceCaptureId: "voice-capture-audio",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(INITIATE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseInitiateAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio/initiate", {
          method: "POST",
          body: JSON.stringify({
            contentType: "audio/webm",
            fileName: "capture.mp3",
            voiceCaptureId: "voice-capture-audio",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(INITIATE_AUDIO_INGESTION_FILE_NAME_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseInitiateAudioIngestionRequestBody(
        new Request("https://waka.app/api/media/audio/initiate", {
          method: "POST",
          body: JSON.stringify({
            contentType: "audio/webm",
            voiceCaptureId: "   ",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(INITIATE_AUDIO_INGESTION_VOICE_CAPTURE_ID_REQUIRED_ERROR),
  );
});

test("handleInitiateAudioIngestionRouteRequest returns 401 when the caller is not authenticated", async () => {
  let generatorCallCount = 0;
  let voiceCaptureLookupCount = 0;

  const response = await handleInitiateAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "audio/webm",
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
        uploadSetupGenerator: {
          async generateUploadSetup() {
            generatorCallCount += 1;

            return {};
          },
        },
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

  assert.equal(response.status, INITIATE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: INITIATE_AUDIO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(generatorCallCount, 0);
  assert.equal(voiceCaptureLookupCount, 0);
});

test("handleInitiateAudioIngestionRouteRequest returns validated upload setup using the authenticated user scope", async () => {
  const authorizationLookups: Array<Record<string, unknown>> = [];
  const setupInputs: Array<Record<string, unknown>> = [];
  const callOrder: string[] = [];

  const response = await handleInitiateAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "AUDIO/WEBM; codecs=opus",
        fileName: "memo.webm",
        userId: "forged-user",
        voiceCaptureId: "voice-capture-authenticated",
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
        voiceCaptureAccess: {
          inspiration: {
            async findFirst(args) {
              authorizationLookups.push(args);
              callOrder.push("authorize");

              return {
                id: "voice-capture-authenticated",
              };
            },
          },
        },
        uploadSetupGenerator: {
          async generateUploadSetup(input) {
            callOrder.push("upload");
            setupInputs.push(input);

            return {
              mediaUrl:
                "https://media.waka.app/api/media/audio/users/user-authenticated/voice-notes/memo.webm",
              objectKey:
                "users/user-authenticated/voice-notes/memo.webm",
              upload: {
                headers: {
                  "content-type": "audio/webm",
                },
                method: "PUT",
                url: "https://uploads.waka.app/presigned/audio",
              },
            };
          },
        },
      },
    },
  );

  assert.equal(response.status, INITIATE_AUDIO_INGESTION_ROUTE_CREATED_STATUS);
  assert.deepEqual(await response.json(), {
    mediaUrl:
      "https://media.waka.app/api/media/audio/users/user-authenticated/voice-notes/memo.webm",
    objectKey: "users/user-authenticated/voice-notes/memo.webm",
    upload: {
      headers: {
        "content-type": "audio/webm",
      },
      method: "PUT",
      url: "https://uploads.waka.app/presigned/audio",
    },
  });
  assert.deepEqual(setupInputs, [
    {
      contentType: "audio/webm",
      fileName: "memo.webm",
      userId: "user-authenticated",
      voiceCaptureId: "voice-capture-authenticated",
    },
  ]);
  assert.deepEqual(authorizationLookups, [
    buildInitiateAudioIngestionVoiceCaptureAccessArgs(
      "user-authenticated",
      "voice-capture-authenticated",
    ),
  ]);
  assert.deepEqual(callOrder, ["authorize", "upload"]);
});

test("handleInitiateAudioIngestionRouteRequest returns 404 when the signed-in user cannot access the referenced voice capture", async () => {
  let generatorCallCount = 0;
  const authorizationLookups: Array<Record<string, unknown>> = [];

  const response = await handleInitiateAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "audio/webm",
        voiceCaptureId: "voice-capture-foreign",
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
        voiceCaptureAccess: {
          inspiration: {
            async findFirst(args) {
              authorizationLookups.push(args);
              return null;
            },
          },
        },
        uploadSetupGenerator: {
          async generateUploadSetup() {
            generatorCallCount += 1;

            return {};
          },
        },
      },
    },
  );

  assert.equal(response.status, INITIATE_AUDIO_INGESTION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: INITIATE_AUDIO_INGESTION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.deepEqual(authorizationLookups, [
    buildInitiateAudioIngestionVoiceCaptureAccessArgs(
      "user-authenticated",
      "voice-capture-foreign",
    ),
  ]);
  assert.equal(generatorCallCount, 0);
});

test("handleInitiateAudioIngestionRouteRequest maps Prisma-style not-found failures from voice-capture access to the shared 404 contract", async () => {
  let generatorCallCount = 0;

  const response = await handleInitiateAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "audio/webm",
        voiceCaptureId: "voice-capture-prisma-missing",
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
        voiceCaptureAccess: {
          inspiration: {
            async findFirst() {
              throw Object.assign(
                new Error("voice capture access lookup could not find a row"),
                {
                  code: "P2025",
                },
              );
            },
          },
        },
        uploadSetupGenerator: {
          async generateUploadSetup() {
            generatorCallCount += 1;

            return {};
          },
        },
      },
    },
  );

  assert.equal(response.status, INITIATE_AUDIO_INGESTION_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: INITIATE_AUDIO_INGESTION_ROUTE_NOT_FOUND_ERROR,
  });
  assert.equal(generatorCallCount, 0);
});

test("handleInitiateAudioIngestionRouteRequest returns 400 for invalid request payloads and 500 for invalid upload setup responses", async () => {
  let voiceCaptureLookupCount = 0;
  const badRequestResponse = await handleInitiateAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "text/plain",
        voiceCaptureId: "voice-capture-invalid",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-1";
          },
        },
        voiceCaptureAccess: {
          inspiration: {
            async findFirst() {
              voiceCaptureLookupCount += 1;
              return {
                id: "voice-capture-invalid",
              };
            },
          },
        },
        uploadSetupGenerator: {
          async generateUploadSetup() {
            throw new Error("generator should not be called for bad requests");
          },
        },
      },
    },
  );

  assert.equal(badRequestResponse.status, INITIATE_AUDIO_INGESTION_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await badRequestResponse.json(), {
    error: INITIATE_AUDIO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
  });
  assert.equal(voiceCaptureLookupCount, 0);

  const internalErrorResponse = await handleInitiateAudioIngestionRouteRequest(
    new Request("https://waka.app/api/media/audio/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "audio/webm",
        voiceCaptureId: "voice-capture-invalid-response",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-1";
          },
        },
        voiceCaptureAccess: {
          inspiration: {
            async findFirst() {
              voiceCaptureLookupCount += 1;
              return {
                id: "voice-capture-invalid-response",
              };
            },
          },
        },
        uploadSetupGenerator: {
          async generateUploadSetup() {
            return {
              mediaUrl: "not-a-url",
              objectKey: "users/user-1/voice-notes/capture.webm",
              upload: {
                headers: {
                  "content-type": "audio/webm",
                },
                method: "PUT",
                url: "https://uploads.waka.app/presigned/audio",
              },
            };
          },
        },
      },
    },
  );

  assert.equal(
    internalErrorResponse.status,
    INITIATE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
  );
  assert.deepEqual(await internalErrorResponse.json(), {
    error: INITIATE_AUDIO_INGESTION_ROUTE_INTERNAL_ERROR,
  });
  assert.equal(voiceCaptureLookupCount, 1);
});

test("app/api/media/audio/initiate/route.ts delegates POST requests to the configured audio-ingestion handler", async () => {
  configureInitiateAudioIngestionRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
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
    uploadSetupGenerator: {
      async generateUploadSetup(input) {
        return {
          mediaUrl:
            `https://media.waka.app/api/media/audio/users/${input.userId}/voice-notes/route.webm`,
          objectKey: `users/${input.userId}/voice-notes/route.webm`,
          upload: {
            headers: {
              "content-type": input.contentType,
            },
            method: "PUT",
            url: "https://uploads.waka.app/presigned/route-audio",
          },
        };
      },
    },
  });

  try {
    const { POST } = await import(
      "../apps/web/app/api/media/audio/initiate/route.ts"
    );
    const response = await POST(
      new Request("https://waka.app/api/media/audio/initiate", {
        method: "POST",
        body: JSON.stringify({
          contentType: "audio/webm",
          voiceCaptureId: "voice-capture-route",
        }),
        headers: {
          "content-type": "application/json",
        },
      }) as never,
    );

    assert.equal(response.status, INITIATE_AUDIO_INGESTION_ROUTE_CREATED_STATUS);
    assert.deepEqual(await response.json(), {
      mediaUrl:
        "https://media.waka.app/api/media/audio/users/user-route/voice-notes/route.webm",
      objectKey: "users/user-route/voice-notes/route.webm",
      upload: {
        headers: {
          "content-type": "audio/webm",
        },
        method: "PUT",
        url: "https://uploads.waka.app/presigned/route-audio",
      },
    });
  } finally {
    configureInitiateAudioIngestionRouteDependencies(null);
  }
});

test("app/api/media/audio/initiate/route.ts preserves the shared 404 contract when the target voice capture is inaccessible", async () => {
  configureInitiateAudioIngestionRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    voiceCaptureAccess: {
      inspiration: {
        async findFirst() {
          return null;
        },
      },
    },
    uploadSetupGenerator: {
      async generateUploadSetup() {
        throw new Error("upload setup should not run when access is denied");
      },
    },
  });

  try {
    const { POST } = await import(
      "../apps/web/app/api/media/audio/initiate/route.ts"
    );
    const response = await POST(
      new Request("https://waka.app/api/media/audio/initiate", {
        method: "POST",
        body: JSON.stringify({
          contentType: "audio/webm",
          voiceCaptureId: "voice-capture-inaccessible",
        }),
        headers: {
          "content-type": "application/json",
        },
      }) as never,
    );

    assert.equal(response.status, INITIATE_AUDIO_INGESTION_ROUTE_NOT_FOUND_STATUS);
    assert.deepEqual(await response.json(), {
      error: INITIATE_AUDIO_INGESTION_ROUTE_NOT_FOUND_ERROR,
    });
  } finally {
    configureInitiateAudioIngestionRouteDependencies(null);
  }
});
