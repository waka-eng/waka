import assert from "node:assert/strict";
import test from "node:test";

import {
  MissingPhotoCaptureOwnershipScopeError,
  buildCreatePhotoCapturePersistenceArgs,
  createPhotoCaptureCreationService,
  type CreatePhotoCapturePersistenceClient,
  type CreatedPhotoCaptureRecord,
  type PhotoCaptureOwnershipScope,
  type PhotoCaptureOwnershipScopeResolver,
} from "../apps/web/src/media/create-photo-capture.ts";
import {
  CREATE_PHOTO_CAPTURE_CONTENT_TYPE_INVALID_ERROR,
  CREATE_PHOTO_CAPTURE_FILE_NAME_REQUIRED_ERROR,
  CREATE_PHOTO_CAPTURE_MEDIA_URL_INVALID_ERROR,
  CREATE_PHOTO_CAPTURE_OBJECT_KEY_REQUIRED_ERROR,
  CREATE_PHOTO_CAPTURE_REQUEST_BODY_JSON_INVALID_ERROR,
  CREATE_PHOTO_CAPTURE_ROUTE_BAD_REQUEST_STATUS,
  CREATE_PHOTO_CAPTURE_ROUTE_CREATED_STATUS,
  CREATE_PHOTO_CAPTURE_ROUTE_INTERNAL_ERROR,
  CREATE_PHOTO_CAPTURE_ROUTE_INTERNAL_ERROR_STATUS,
  CREATE_PHOTO_CAPTURE_ROUTE_UNAUTHORIZED_ERROR,
  CREATE_PHOTO_CAPTURE_ROUTE_UNAUTHORIZED_STATUS,
  CREATE_PHOTO_CAPTURE_SIZE_BYTES_INVALID_ERROR,
  configureCreatePhotoCaptureRouteDependencies,
  handleCreatePhotoCaptureRouteRequest,
  parseCreatePhotoCaptureRequestBody,
} from "../apps/web/src/media/create-photo-capture-route.ts";

function createPersistenceClient(): {
  client: CreatePhotoCapturePersistenceClient;
  createCalls: Array<{
    data: Record<string, unknown>;
    select: {
      id: true;
      rawContent: true;
      sourceType: true;
    };
  }>;
} {
  const createCalls: Array<{
    data: Record<string, unknown>;
    select: {
      id: true;
      rawContent: true;
      sourceType: true;
    };
  }> = [];

  return {
    client: {
      inspiration: {
        async create(args) {
          createCalls.push(args as typeof createCalls[number]);

          return {
            id: "insp_photo",
            rawContent: String(args.data.rawContent),
            sourceType: args.data
              .sourceType as CreatedPhotoCaptureRecord["sourceType"],
          };
        },
      },
    },
    createCalls,
  };
}

function createOwnershipScopeResolver(
  scope: PhotoCaptureOwnershipScope | null,
): PhotoCaptureOwnershipScopeResolver {
  return {
    async resolvePhotoCaptureOwnershipScope() {
      return scope;
    },
  };
}

test("parseCreatePhotoCaptureRequestBody accepts valid uploaded-photo metadata and strips spoofed ownership fields", async () => {
  const parsed = await parseCreatePhotoCaptureRequestBody(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "  IMAGE/PNG  ",
        fileName: "  conference-shot.PNG  ",
        mediaUrl:
          "https://media.waka.app/users/user-photo/photos/conference-shot.PNG",
        objectKey: "  users/user-photo/photos/conference-shot.PNG  ",
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
    fileName: "conference-shot.PNG",
    mediaUrl:
      "https://media.waka.app/users/user-photo/photos/conference-shot.PNG",
    objectKey: "users/user-photo/photos/conference-shot.PNG",
    sizeBytes: 2048,
  });
  assert.equal("ownerId" in parsed, false);
  assert.equal("tenantId" in parsed, false);
  assert.equal("userId" in parsed, false);
  assert.equal("workspaceId" in parsed, false);
});

test("parseCreatePhotoCaptureRequestBody rejects invalid JSON and invalid uploaded-photo metadata", async () => {
  await assert.rejects(
    async () =>
      parseCreatePhotoCaptureRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: "{",
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new RegExp(CREATE_PHOTO_CAPTURE_REQUEST_BODY_JSON_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCreatePhotoCaptureRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify({
            contentType: "application/pdf",
            fileName: "scan.pdf",
            mediaUrl: "https://media.waka.app/photos/scan.pdf",
            objectKey: "users/user-photo/photos/scan.pdf",
            sizeBytes: 2048,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(CREATE_PHOTO_CAPTURE_CONTENT_TYPE_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCreatePhotoCaptureRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify({
            contentType: "image/jpeg",
            fileName: "   ",
            mediaUrl: "https://media.waka.app/photos/capture.jpg",
            objectKey: "users/user-photo/photos/capture.jpg",
            sizeBytes: 2048,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(CREATE_PHOTO_CAPTURE_FILE_NAME_REQUIRED_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCreatePhotoCaptureRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify({
            contentType: "image/jpeg",
            fileName: "capture.jpg",
            mediaUrl: "not-a-url",
            objectKey: "users/user-photo/photos/capture.jpg",
            sizeBytes: 2048,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(CREATE_PHOTO_CAPTURE_MEDIA_URL_INVALID_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCreatePhotoCaptureRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify({
            contentType: "image/jpeg",
            fileName: "capture.jpg",
            mediaUrl: "https://media.waka.app/photos/capture.jpg",
            objectKey: "   ",
            sizeBytes: 2048,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(CREATE_PHOTO_CAPTURE_OBJECT_KEY_REQUIRED_ERROR),
  );

  await assert.rejects(
    async () =>
      parseCreatePhotoCaptureRequestBody(
        new Request("https://waka.app/api/media/photos", {
          method: "POST",
          body: JSON.stringify({
            contentType: "image/jpeg",
            fileName: "capture.jpg",
            mediaUrl: "https://media.waka.app/photos/capture.jpg",
            objectKey: "users/user-photo/photos/capture.jpg",
            sizeBytes: 0,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      ),
    new TypeError(CREATE_PHOTO_CAPTURE_SIZE_BYTES_INVALID_ERROR),
  );
});

test("handleCreatePhotoCaptureRouteRequest returns 401 when the authenticated ownership scope is missing", async () => {
  let createCallCount = 0;

  const response = await handleCreatePhotoCaptureRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/webp",
        fileName: "offline-moodboard.webp",
        mediaUrl:
          "https://media.waka.app/users/user-photo/photos/offline-moodboard.webp",
        objectKey: "users/user-photo/photos/offline-moodboard.webp",
        sizeBytes: 8192,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        creationService: {
          async create() {
            createCallCount += 1;
            throw new MissingPhotoCaptureOwnershipScopeError();
          },
        },
      },
    },
  );

  assert.equal(response.status, CREATE_PHOTO_CAPTURE_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: CREATE_PHOTO_CAPTURE_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(createCallCount, 1);
});

test("handleCreatePhotoCaptureRouteRequest validates input, invokes the creation flow, and returns the persisted photo capture", async () => {
  const createInputs: Array<Record<string, unknown>> = [];

  const response = await handleCreatePhotoCaptureRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "IMAGE/JPEG",
        fileName: "capture.jpg",
        mediaUrl:
          "https://media.waka.app/users/user-authenticated/photos/capture.jpg",
        objectKey: "users/user-authenticated/photos/capture.jpg",
        sizeBytes: 4096,
        userId: "forged-user",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        creationService: {
          async create(input) {
            createInputs.push(input);

            return {
              id: "insp_photo",
              rawContent: input.fileName,
              sourceType: "PHOTO",
            } satisfies CreatedPhotoCaptureRecord;
          },
        },
      },
    },
  );

  assert.equal(response.status, CREATE_PHOTO_CAPTURE_ROUTE_CREATED_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp_photo",
    rawContent: "capture.jpg",
    sourceType: "PHOTO",
  });
  assert.deepEqual(createInputs, [
    {
      contentType: "image/jpeg",
      fileName: "capture.jpg",
      mediaUrl:
        "https://media.waka.app/users/user-authenticated/photos/capture.jpg",
      objectKey: "users/user-authenticated/photos/capture.jpg",
      sizeBytes: 4096,
    },
  ]);
});

test("handleCreatePhotoCaptureRouteRequest persists pending-upload metadata using the authenticated ownership scope", async () => {
  const { client, createCalls } = createPersistenceClient();

  const response = await handleCreatePhotoCaptureRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: " IMAGE/JPEG ",
        fileName: " capture.jpg ",
        mediaUrl:
          "https://media.waka.app/workspaces/workspace-authenticated/photos/capture.jpg",
        objectKey: " workspaces/workspace-authenticated/photos/capture.jpg ",
        ownerId: "forged-owner",
        sizeBytes: 4096,
        tenantId: "forged-tenant",
        userId: "forged-user",
        workspaceId: "forged-workspace",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        creationService: createPhotoCaptureCreationService({
          photoCaptureOwnershipScopeResolver: createOwnershipScopeResolver({
            tenantId: "tenant-authenticated",
            userId: "user-authenticated",
            workspaceId: "workspace-authenticated",
          }),
          photoCaptureRepository: client,
        }),
      },
    },
  );

  assert.equal(response.status, CREATE_PHOTO_CAPTURE_ROUTE_CREATED_STATUS);
  assert.deepEqual(await response.json(), {
    id: "insp_photo",
    rawContent: "capture.jpg",
    sourceType: "PHOTO",
  });
  assert.deepEqual(createCalls, [
    buildCreatePhotoCapturePersistenceArgs(
      {
        tenantId: "tenant-authenticated",
        userId: "user-authenticated",
        workspaceId: "workspace-authenticated",
      },
      {
        contentType: "image/jpeg",
        fileName: "capture.jpg",
        mediaUrl:
          "https://media.waka.app/workspaces/workspace-authenticated/photos/capture.jpg",
        objectKey: "workspaces/workspace-authenticated/photos/capture.jpg",
        sizeBytes: 4096,
      },
    ),
  ]);
  assert.equal(createCalls[0]?.data.userId, "user-authenticated");
});

test("handleCreatePhotoCaptureRouteRequest returns 400 for invalid payloads and 500 for unexpected creation failures", async () => {
  const badRequestResponse = await handleCreatePhotoCaptureRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "text/plain",
        fileName: "not-an-image.txt",
        mediaUrl: "https://media.waka.app/users/user-photo/photos/not-an-image.txt",
        objectKey: "users/user-photo/photos/not-an-image.txt",
        sizeBytes: 512,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        creationService: {
          async create() {
            throw new Error("creation should not be called for bad requests");
          },
        },
      },
    },
  );

  assert.equal(badRequestResponse.status, CREATE_PHOTO_CAPTURE_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await badRequestResponse.json(), {
    error: CREATE_PHOTO_CAPTURE_CONTENT_TYPE_INVALID_ERROR,
  });

  const internalErrorResponse = await handleCreatePhotoCaptureRouteRequest(
    new Request("https://waka.app/api/media/photos", {
      method: "POST",
      body: JSON.stringify({
        contentType: "image/png",
        fileName: "capture.png",
        mediaUrl: "https://media.waka.app/users/user-photo/photos/capture.png",
        objectKey: "users/user-photo/photos/capture.png",
        sizeBytes: 1024,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        creationService: {
          async create() {
            throw new Error("database offline");
          },
        },
      },
    },
  );

  assert.equal(
    internalErrorResponse.status,
    CREATE_PHOTO_CAPTURE_ROUTE_INTERNAL_ERROR_STATUS,
  );
  assert.deepEqual(await internalErrorResponse.json(), {
    error: CREATE_PHOTO_CAPTURE_ROUTE_INTERNAL_ERROR,
  });
});

test("app/api/media/photos/route.ts delegates POST requests to the configured photo capture handler", async () => {
  configureCreatePhotoCaptureRouteDependencies({
    creationService: {
      async create(input) {
        return {
          id: "insp_route_photo",
          rawContent: input.fileName,
          sourceType: "PHOTO",
        };
      },
    },
  });

  try {
    const { POST } = await import("../apps/web/app/api/media/photos/route.ts");
    const response = await POST(
      new Request("https://waka.app/api/media/photos", {
        method: "POST",
        body: JSON.stringify({
          contentType: "image/png",
          fileName: "route.png",
          mediaUrl: "https://media.waka.app/users/user-route/photos/route.png",
          objectKey: "users/user-route/photos/route.png",
          sizeBytes: 1024,
        }),
        headers: {
          "content-type": "application/json",
        },
      }) as never,
    );

    assert.equal(response.status, CREATE_PHOTO_CAPTURE_ROUTE_CREATED_STATUS);
    assert.deepEqual(await response.json(), {
      id: "insp_route_photo",
      rawContent: "route.png",
      sourceType: "PHOTO",
    });
  } finally {
    configureCreatePhotoCaptureRouteDependencies(null);
  }
});
