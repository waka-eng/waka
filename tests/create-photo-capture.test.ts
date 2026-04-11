import assert from "node:assert/strict";
import test from "node:test";

import {
  MissingPhotoCaptureOwnershipScopeError,
  PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
  buildCreatePhotoCapturePersistenceArgs,
  createPhotoCapture,
  createPhotoCaptureCreationService,
  requirePhotoCaptureOwnershipScope,
  type CreatePhotoCapturePersistenceClient,
  type CreatedPhotoCaptureRecord,
  type PhotoCaptureOwnershipScope,
  type PhotoCaptureOwnershipScopeResolver,
} from "../apps/web/src/media/create-photo-capture.ts";
import { buildInitialInspirationEnrichmentPersistenceData } from "../apps/web/src/inspirations/enrichment-pipeline.ts";
import { buildPendingPhotoAnalysisProcessingState } from "../apps/web/src/inspirations/photo-analysis-processing-state.ts";

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
            sourceType: args.data.sourceType as CreatedPhotoCaptureRecord["sourceType"],
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

test("buildCreatePhotoCapturePersistenceArgs constructs a PHOTO record with pending-upload metadata", () => {
  assert.deepEqual(
    buildCreatePhotoCapturePersistenceArgs(
      {
        userId: "user-photo",
      },
      {
        contentType: "  IMAGE/PNG  ",
        fileName: "  conference-shot.PNG  ",
        mediaUrl:
          "https://media.waka.app/users/user-photo/photos/conference-shot.PNG",
        objectKey: "users/user-photo/photos/conference-shot.PNG",
        sizeBytes: 2048,
      },
    ),
    {
      data: {
        userId: "user-photo",
        originalRawContent: "conference-shot.PNG",
        rawContent: "conference-shot.PNG",
        sourceType: "PHOTO",
        tags: [],
        ...buildInitialInspirationEnrichmentPersistenceData(),
        originalSourceMeta: {
          fileName: "conference-shot.PNG",
          mimeType: "image/png",
          sizeBytes: 2048,
        },
        sourceMeta: {
          fileName: "conference-shot.PNG",
          mimeType: "image/png",
          sizeBytes: 2048,
        },
        originalMediaUrl:
          "https://media.waka.app/users/user-photo/photos/conference-shot.PNG",
        mediaUrl:
          "https://media.waka.app/users/user-photo/photos/conference-shot.PNG",
        photoStorageKey: "users/user-photo/photos/conference-shot.PNG",
        photoStorageUrl:
          "https://media.waka.app/users/user-photo/photos/conference-shot.PNG",
        photoFileName: "conference-shot.PNG",
        photoMimeType: "image/png",
        photoSizeBytes: 2048,
        photoUploadStatus: PHOTO_CAPTURE_PENDING_UPLOAD_STATUS,
        processingState: buildPendingPhotoAnalysisProcessingState(),
      },
      select: {
        id: true,
        rawContent: true,
        sourceType: true,
      },
    },
  );
});

test("createPhotoCapture persists the pending-upload record using the authenticated user scope", async () => {
  const { client, createCalls } = createPersistenceClient();

  const createdCapture = await createPhotoCapture(
    client,
    {
      userId: "user-42",
    },
    {
      contentType: "image/jpeg",
      fileName: "hallway-whiteboard.jpg",
      mediaUrl:
        "https://media.waka.app/users/user-42/photos/hallway-whiteboard.jpg",
      objectKey: "users/user-42/photos/hallway-whiteboard.jpg",
      sizeBytes: 4096,
    },
  );

  assert.deepEqual(createdCapture, {
    id: "insp_photo",
    rawContent: "hallway-whiteboard.jpg",
    sourceType: "PHOTO",
  });
  assert.deepEqual(createCalls, [
    buildCreatePhotoCapturePersistenceArgs(
      {
        userId: "user-42",
      },
      {
        contentType: "image/jpeg",
        fileName: "hallway-whiteboard.jpg",
        mediaUrl:
          "https://media.waka.app/users/user-42/photos/hallway-whiteboard.jpg",
        objectKey: "users/user-42/photos/hallway-whiteboard.jpg",
        sizeBytes: 4096,
      },
    ),
  ]);
});

test("createPhotoCaptureCreationService accepts workspace ownership scope and still persists the authenticated member user id", async () => {
  const { client, createCalls } = createPersistenceClient();
  const service = createPhotoCaptureCreationService({
    photoCaptureOwnershipScopeResolver: createOwnershipScopeResolver({
      tenantId: "tenant-7",
      userId: "user-77",
      workspaceId: "workspace-design",
    }),
    photoCaptureRepository: client,
  });

  await service.create({
    contentType: "image/webp",
    fileName: "mobile-mockup.webp",
    mediaUrl:
      "https://media.waka.app/workspaces/workspace-design/photos/mobile-mockup.webp",
    objectKey: "workspaces/workspace-design/photos/mobile-mockup.webp",
    sizeBytes: 8192,
  });

  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0]?.data.userId, "user-77");
  assert.equal(createCalls[0]?.data.photoStorageKey, "workspaces/workspace-design/photos/mobile-mockup.webp");
  assert.equal(createCalls[0]?.data.photoUploadStatus, PHOTO_CAPTURE_PENDING_UPLOAD_STATUS);
  assert.equal("tenantId" in (createCalls[0]?.data ?? {}), false);
  assert.equal("workspaceId" in (createCalls[0]?.data ?? {}), false);
});

test("requirePhotoCaptureOwnershipScope rejects when no authenticated owner or workspace scope exists", async () => {
  await assert.rejects(
    requirePhotoCaptureOwnershipScope(createOwnershipScopeResolver(null)),
    MissingPhotoCaptureOwnershipScopeError,
  );
});
