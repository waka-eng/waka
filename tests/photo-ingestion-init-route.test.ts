import assert from "node:assert/strict";
import test from "node:test";

import {
  INITIATE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
  INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_SCOPE_INVALID_ERROR,
  INITIATE_PHOTO_INGESTION_FILE_NAME_REQUIRED_ERROR,
  INITIATE_PHOTO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR,
  INITIATE_PHOTO_INGESTION_ROUTE_BAD_REQUEST_STATUS,
  INITIATE_PHOTO_INGESTION_ROUTE_CREATED_STATUS,
  INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR,
  INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
  INITIATE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
  INITIATE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_STATUS,
  INITIATE_PHOTO_INGESTION_SIZE_BYTES_INVALID_ERROR,
  configureInitiatePhotoIngestionRouteDependencies,
  handleInitiatePhotoIngestionRouteRequest,
  parseInitiatePhotoIngestionRequestBody,
} from "../apps/web/src/media/photo-ingestion-init-route.ts";
import { createPhotoUploadSetupGenerator } from "../apps/web/src/media/photo-upload-presign.ts";

const TEST_PHOTO_UPLOAD_ENV = {
  APP_URL: "https://waka.app",
  AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
  AWS_REGION: "us-east-1",
  AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
  AWS_SESSION_TOKEN: "session-token",
  SST_RESOURCE_MediaBucket_name: "waka-dev-media-bucket",
} satisfies NodeJS.ProcessEnv;

test("parseInitiatePhotoIngestionRequestBody accepts valid image metadata and strips spoofed ownership fields", async () => {
  const parsed = await parseInitiatePhotoIngestionRequestBody(
    new Request("https://waka.app/api/media/photos/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "  IMAGE/PNG  ",
        existingUpload: {
          mediaUrl:
            "https://waka.app/api/media/photos/users/forged-user/photos/1775793906000-conference-shot-existing.png",
          objectKey:
            "users/forged-user/photos/1775793906000-conference-shot-existing.png",
          storageKey:
            "users/forged-user/photos/1775793906000-conference-shot-existing.png",
        },
        fileName: "  conference-shot.PNG  ",
        ownerId: "forged-owner",
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
    existingUpload: {
      mediaUrl:
        "https://waka.app/api/media/photos/users/forged-user/photos/1775793906000-conference-shot-existing.png",
      objectKey:
        "users/forged-user/photos/1775793906000-conference-shot-existing.png",
      storageKey:
        "users/forged-user/photos/1775793906000-conference-shot-existing.png",
    },
    fileName: "conference-shot.PNG",
    sizeBytes: 2048,
  });
  assert.equal("ownerId" in parsed, false);
  assert.equal("tenantId" in parsed, false);
  assert.equal("userId" in parsed, false);
  assert.equal("workspaceId" in parsed, false);
});

test("parseInitiatePhotoIngestionRequestBody rejects invalid JSON and invalid image metadata", async () => {
  await assert.rejects(
    async () =>
      parseInitiatePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos/initiate", {
          method: "POST",
          body: "{",
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new RegExp(INITIATE_PHOTO_INGESTION_REQUEST_BODY_JSON_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseInitiatePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos/initiate", {
          method: "POST",
          body: JSON.stringify({
            contentType: "application/pdf",
            fileName: "scan.pdf",
            sizeBytes: 2048,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(INITIATE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseInitiatePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos/initiate", {
          method: "POST",
          body: JSON.stringify({
            contentType: "image/jpeg",
            fileName: "   ",
            sizeBytes: 2048,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(INITIATE_PHOTO_INGESTION_FILE_NAME_REQUIRED_ERROR),
  );

  await assert.rejects(
    async () =>
      parseInitiatePhotoIngestionRequestBody(
        new Request("https://waka.app/api/media/photos/initiate", {
          method: "POST",
          body: JSON.stringify({
            contentType: "image/jpeg",
            fileName: "capture.jpg",
            sizeBytes: 0,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(INITIATE_PHOTO_INGESTION_SIZE_BYTES_INVALID_ERROR),
  );
});

test("handleInitiatePhotoIngestionRouteRequest returns 401 when the caller is not authenticated", async () => {
  let generatorCallCount = 0;

  const response = await handleInitiatePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/webp",
        fileName: "offline-moodboard.webp",
        sizeBytes: 8192,
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

            return {
              image: {
                contentType: "image/webp",
                fileName: "offline-moodboard.webp",
                mediaUrl:
                  "https://media.waka.app/users/user-authenticated/photos/offline-moodboard.webp",
                sizeBytes: 8192,
                storageKey:
                  "users/user-authenticated/photos/offline-moodboard.webp",
              },
              mediaUrl:
                "https://media.waka.app/users/user-authenticated/photos/offline-moodboard.webp",
              objectKey:
                "users/user-authenticated/photos/offline-moodboard.webp",
              storageKey:
                "users/user-authenticated/photos/offline-moodboard.webp",
              upload: {
                fields: {},
                headers: {
                  "content-type": "image/webp",
                },
                method: "PUT",
                url: "https://uploads.waka.app/presigned/offline-moodboard",
              },
            };
          },
        },
      },
    },
  );

  assert.equal(response.status, INITIATE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: INITIATE_PHOTO_INGESTION_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(generatorCallCount, 0);
});

test("handleInitiatePhotoIngestionRouteRequest returns validated upload setup using the authenticated user scope", async () => {
  const setupInputs: Array<Record<string, unknown>> = [];

  const response = await handleInitiatePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "IMAGE/JPEG",
        fileName: "capture.jpg",
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
        uploadSetupGenerator: {
          async generateUploadSetup(input) {
            setupInputs.push(input);

            return {
              image: {
                contentType: input.contentType,
                fileName: input.fileName,
                mediaUrl:
                  "https://media.waka.app/users/user-authenticated/photos/capture.jpg",
                sizeBytes: input.sizeBytes,
                storageKey: "users/user-authenticated/photos/capture.jpg",
              },
              mediaUrl:
                "https://media.waka.app/users/user-authenticated/photos/capture.jpg",
              objectKey: "users/user-authenticated/photos/capture.jpg",
              storageKey: "users/user-authenticated/photos/capture.jpg",
              upload: {
                fields: {},
                headers: {
                  "content-type": "image/jpeg",
                },
                method: "PUT",
                url: "https://uploads.waka.app/presigned/capture",
              },
            };
          },
        },
      },
    },
  );

  assert.equal(response.status, INITIATE_PHOTO_INGESTION_ROUTE_CREATED_STATUS);
  assert.deepEqual(await response.json(), {
    image: {
      contentType: "image/jpeg",
      fileName: "capture.jpg",
      mediaUrl:
        "https://media.waka.app/users/user-authenticated/photos/capture.jpg",
      sizeBytes: 4096,
      storageKey: "users/user-authenticated/photos/capture.jpg",
    },
    mediaUrl:
      "https://media.waka.app/users/user-authenticated/photos/capture.jpg",
    objectKey: "users/user-authenticated/photos/capture.jpg",
    storageKey: "users/user-authenticated/photos/capture.jpg",
    upload: {
      fields: {},
      headers: {
        "content-type": "image/jpeg",
      },
      method: "PUT",
      url: "https://uploads.waka.app/presigned/capture",
    },
  });
  assert.deepEqual(setupInputs, [
    {
      contentType: "image/jpeg",
      fileName: "capture.jpg",
      sizeBytes: 4096,
      userId: "user-authenticated",
    },
  ]);
});

test("handleInitiatePhotoIngestionRouteRequest can use the real S3 photo upload generator", async () => {
  const response = await handleInitiatePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "IMAGE/PNG",
        fileName: "camera-roll.png",
        sizeBytes: 4096,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-camera";
          },
        },
        uploadSetupGenerator: createPhotoUploadSetupGenerator({
          env: TEST_PHOTO_UPLOAD_ENV,
          keyIdFactory: () => "route-upload",
          now: () => new Date("2026-04-10T04:05:06.000Z"),
        }),
      },
    },
  );

  assert.equal(response.status, INITIATE_PHOTO_INGESTION_ROUTE_CREATED_STATUS);

  const body = await response.json();

  assert.deepEqual(body, {
    image: {
      contentType: "image/png",
      fileName: "camera-roll.png",
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-camera/photos/1775793906000-camera-roll-route-upload.png",
      sizeBytes: 4096,
      storageKey:
        "users/user-camera/photos/1775793906000-camera-roll-route-upload.png",
    },
    mediaUrl:
      "https://waka.app/api/media/photos/users/user-camera/photos/1775793906000-camera-roll-route-upload.png",
    objectKey:
      "users/user-camera/photos/1775793906000-camera-roll-route-upload.png",
    storageKey:
      "users/user-camera/photos/1775793906000-camera-roll-route-upload.png",
    upload: {
      fields: {},
      headers: {
        "content-type": "image/png",
      },
      method: "PUT",
      url: body.upload.url,
    },
  });

  const uploadUrl = new URL(body.upload.url);

  assert.equal(
    uploadUrl.origin,
    "https://waka-dev-media-bucket.s3.us-east-1.amazonaws.com",
  );
  assert.equal(
    uploadUrl.pathname,
    "/users/user-camera/photos/1775793906000-camera-roll-route-upload.png",
  );
  assert.equal(
    uploadUrl.searchParams.get("X-Amz-Algorithm"),
    "AWS4-HMAC-SHA256",
  );
  assert.equal(
    uploadUrl.searchParams.get("X-Amz-Credential"),
    "AKIAEXAMPLE/20260410/us-east-1/s3/aws4_request",
  );
  assert.equal(uploadUrl.searchParams.get("X-Amz-Date"), "20260410T040506Z");
  assert.equal(uploadUrl.searchParams.get("X-Amz-Expires"), "900");
  assert.equal(uploadUrl.searchParams.get("X-Amz-Security-Token"), "session-token");
  assert.equal(
    uploadUrl.searchParams.get("X-Amz-SignedHeaders"),
    "content-type;host",
  );
  assert.match(
    uploadUrl.searchParams.get("X-Amz-Signature") ?? "",
    /^[a-f0-9]{64}$/u,
  );
});

test("handleInitiatePhotoIngestionRouteRequest refreshes upload metadata against the existing draft upload identity", async () => {
  const response = await handleInitiatePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/png",
        existingUpload: {
          mediaUrl:
            "https://waka.app/api/media/photos/users/user-camera/photos/1775793906000-camera-roll-route-upload.png",
          objectKey:
            "users/user-camera/photos/1775793906000-camera-roll-route-upload.png",
          storageKey:
            "users/user-camera/photos/1775793906000-camera-roll-route-upload.png",
        },
        fileName: "camera-roll.png",
        sizeBytes: 4096,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-camera";
          },
        },
        uploadSetupGenerator: createPhotoUploadSetupGenerator({
          env: TEST_PHOTO_UPLOAD_ENV,
          keyIdFactory: () => "unused-new-upload-id",
          now: () => new Date("2026-04-10T04:06:06.000Z"),
        }),
      },
    },
  );

  assert.equal(response.status, INITIATE_PHOTO_INGESTION_ROUTE_CREATED_STATUS);

  const body = await response.json();

  assert.equal(
    body.objectKey,
    "users/user-camera/photos/1775793906000-camera-roll-route-upload.png",
  );
  assert.equal(
    body.mediaUrl,
    "https://waka.app/api/media/photos/users/user-camera/photos/1775793906000-camera-roll-route-upload.png",
  );
  assert.match(body.upload.url, /X-Amz-Date=20260410T040606Z/u);
});

test("handleInitiatePhotoIngestionRouteRequest returns 400 for invalid request payloads and 500 for invalid upload setup responses", async () => {
  const badRequestResponse = await handleInitiatePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "text/plain",
        fileName: "not-an-image.txt",
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
            return "user-1";
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

  assert.equal(badRequestResponse.status, INITIATE_PHOTO_INGESTION_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await badRequestResponse.json(), {
    error: INITIATE_PHOTO_INGESTION_CONTENT_TYPE_INVALID_ERROR,
  });

  const outOfScopeExistingUploadResponse =
    await handleInitiatePhotoIngestionRouteRequest(
      new Request("https://waka.app/api/media/photos/initiate", {
        method: "POST",
        body: JSON.stringify({
          contentType: "image/png",
          existingUpload: {
            mediaUrl:
              "https://waka.app/api/media/photos/users/user-2/photos/capture.png",
            objectKey: "users/user-2/photos/capture.png",
            storageKey: "users/user-2/photos/capture.png",
          },
          fileName: "capture.png",
          sizeBytes: 1024,
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
          uploadSetupGenerator: createPhotoUploadSetupGenerator({
            env: TEST_PHOTO_UPLOAD_ENV,
            now: () => new Date("2026-04-10T04:05:06.000Z"),
          }),
        },
      },
    );

  assert.equal(
    outOfScopeExistingUploadResponse.status,
    INITIATE_PHOTO_INGESTION_ROUTE_BAD_REQUEST_STATUS,
  );
  assert.deepEqual(await outOfScopeExistingUploadResponse.json(), {
    error: INITIATE_PHOTO_INGESTION_EXISTING_UPLOAD_SCOPE_INVALID_ERROR,
  });

  const internalErrorResponse = await handleInitiatePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/png",
        fileName: "capture.png",
        sizeBytes: 1024,
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
        uploadSetupGenerator: {
          async generateUploadSetup() {
            return {
              image: {
                contentType: "image/png",
                fileName: "capture.png",
                mediaUrl: "not-a-url",
                sizeBytes: 1024,
                storageKey: "users/user-1/photos/capture.png",
              },
              mediaUrl: "not-a-url",
              objectKey: "users/user-1/photos/capture.png",
              storageKey: "users/user-1/photos/capture.png",
              upload: {
                fields: {},
                headers: {
                  "content-type": "image/png",
                },
                method: "PUT",
                url: "https://uploads.waka.app/presigned/capture",
              },
            };
          },
        },
      },
    },
  );

  assert.equal(
    internalErrorResponse.status,
    INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
  );
  assert.deepEqual(await internalErrorResponse.json(), {
    error: INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR,
  });

  const missingImageResponse = await handleInitiatePhotoIngestionRouteRequest(
    new Request("https://waka.app/api/media/photos/initiate", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/png",
        fileName: "capture.png",
        sizeBytes: 1024,
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
        uploadSetupGenerator: {
          async generateUploadSetup() {
            return {
              mediaUrl:
                "https://media.waka.app/users/user-1/photos/capture.png",
              objectKey: "users/user-1/photos/capture.png",
              upload: {
                fields: {},
                headers: {
                  "content-type": "image/png",
                },
                method: "PUT",
                url: "https://uploads.waka.app/presigned/capture",
              },
            } as never;
          },
        },
      },
    },
  );

  assert.equal(
    missingImageResponse.status,
    INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR_STATUS,
  );
  assert.deepEqual(await missingImageResponse.json(), {
    error: INITIATE_PHOTO_INGESTION_ROUTE_INTERNAL_ERROR,
  });
});

test("app/api/media/photos/initiate/route.ts delegates POST requests to the configured photo-ingestion handler", async () => {
  configureInitiatePhotoIngestionRouteDependencies({
    auth: {
      async resolveAuthenticatedUserId() {
        return "user-route";
      },
    },
    uploadSetupGenerator: {
      async generateUploadSetup(input) {
        return {
          image: {
            contentType: input.contentType,
            fileName: input.fileName,
            mediaUrl: `https://media.waka.app/users/${input.userId}/photos/${input.fileName}`,
            sizeBytes: input.sizeBytes,
            storageKey: `users/${input.userId}/photos/${input.fileName}`,
          },
          mediaUrl: `https://media.waka.app/users/${input.userId}/photos/${input.fileName}`,
          objectKey: `users/${input.userId}/photos/${input.fileName}`,
          storageKey: `users/${input.userId}/photos/${input.fileName}`,
          upload: {
            fields: {},
            headers: {
              "content-type": input.contentType,
            },
            method: "PUT",
            url: "https://uploads.waka.app/presigned/route",
          },
        };
      },
    },
  });

  try {
    const { POST } = await import(
      "../apps/web/app/api/media/photos/initiate/route.ts"
    );
    const response = await POST(
      new Request("https://waka.app/api/media/photos/initiate", {
        method: "POST",
        body: JSON.stringify({
          contentType: "image/png",
          fileName: "route.png",
          sizeBytes: 1024,
        }),
        headers: {
          "content-type": "application/json",
        },
      }) as never,
    );

    assert.equal(response.status, INITIATE_PHOTO_INGESTION_ROUTE_CREATED_STATUS);
    assert.deepEqual(await response.json(), {
      image: {
        contentType: "image/png",
        fileName: "route.png",
        mediaUrl: "https://media.waka.app/users/user-route/photos/route.png",
        sizeBytes: 1024,
        storageKey: "users/user-route/photos/route.png",
      },
      mediaUrl: "https://media.waka.app/users/user-route/photos/route.png",
      objectKey: "users/user-route/photos/route.png",
      storageKey: "users/user-route/photos/route.png",
      upload: {
        fields: {},
        headers: {
          "content-type": "image/png",
        },
        method: "PUT",
        url: "https://uploads.waka.app/presigned/route",
      },
    });
  } finally {
    configureInitiatePhotoIngestionRouteDependencies(null);
  }
});
