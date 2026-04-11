import assert from "node:assert/strict";
import test from "node:test";

import {
  createInspirationQueueRecordProcessingRequest,
} from "../apps/web/src/jobs/inspiration-queue.ts";
import {
  PhotoAnalysisStorageRetrievalError,
  PhotoAnalysisStorageValidationError,
  type PhotoAnalysisStorageImageObject,
} from "../apps/web/src/jobs/photo-analysis-storage.ts";
import type {
  PhotoAnalysisPersistenceClient,
} from "../apps/web/src/jobs/photo-analysis-persistence.ts";
import { buildMarkPhotoAnalysisProcessingStartedArgs } from "../apps/web/src/jobs/photo-analysis-persistence.ts";
import { PHOTO_ANALYSIS_EXTRACTION_EMPTY_ERROR } from "../apps/web/src/jobs/photo-analysis-text.ts";
import {
  preparePhotoAnalysisWorkerProcessing,
  processPhotoAnalysisQueueMessage,
} from "../apps/web/src/jobs/process-photo-analysis-message.ts";

const TEST_ENV = {
  APP_URL: "https://waka.app",
  AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
  AWS_REGION: "ap-northeast-2",
  AWS_SECRET_ACCESS_KEY: "secret-access-key",
  AWS_SESSION_TOKEN: "session-token",
  SST_RESOURCE_MediaBucket_name: "waka-dev-media-bucket",
} as const;

function createPhotoAnalysisProcessingRequest() {
  const payload = {
    inspirationId: "insp_photo",
    jobType: "photo_analysis" as const,
    mediaUrl: "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.png",
  };
  const record = {
    body: JSON.stringify(payload),
    messageId: "message-photo-analysis",
  };

  return {
    ...createInspirationQueueRecordProcessingRequest(record),
    jobType: "photo_analysis" as const,
    payload,
  };
}

function createValidatedImage(
  mediaUrl = "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.png",
): PhotoAnalysisStorageImageObject {
  return {
    bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
    headers: {
      contentLength: 4,
      contentType: "image/png",
    },
    image: {
      height: 720,
      mimeType: "image/png",
      sizeBytes: 4,
      width: 1280,
    },
    mediaUrl,
    storageKey: "users/user-photo/photos/moodboard.png",
  };
}

function toAsciiBytes(value: string): number[] {
  return [...Buffer.from(value, "ascii")];
}

function toUint32BigEndianBytes(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function createPngBytes(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0x89,
    ...toAsciiBytes("PNG"),
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0x00,
    0x00,
    0x00,
    0x0d,
    ...toAsciiBytes("IHDR"),
    ...toUint32BigEndianBytes(width),
    ...toUint32BigEndianBytes(height),
  ]);
}

test("preparePhotoAnalysisWorkerProcessing returns the stable validated image interface for downstream worker steps", async () => {
  const request = createPhotoAnalysisProcessingRequest();
  const result = await preparePhotoAnalysisWorkerProcessing(request, {
    retrieveValidatedImage: async (mediaUrl) => ({
      image: createValidatedImage(mediaUrl),
      status: "validated",
    }),
  });

  assert.equal(result.status, "ready");

  if (result.status !== "ready") {
    throw new Error("Expected a ready photo-analysis worker input.");
  }

  assert.equal(result.input.message.inspirationId, "insp_photo");
  assert.equal(
    result.input.processingRequest.metadata.messageId,
    "message-photo-analysis",
  );
  assert.deepEqual(result.input.validatedImage.image, {
    height: 720,
    mimeType: "image/png",
    sizeBytes: 4,
    width: 1280,
  });
});

test("processPhotoAnalysisQueueMessage forwards the validated image interface to the downstream processor", async () => {
  const request = createPhotoAnalysisProcessingRequest();
  const downstreamCalls: Array<{
    inspirationId: string;
    mediaUrl: string;
    storageKey: string;
    width: number;
  }> = [];

  const result = await processPhotoAnalysisQueueMessage(request, {
    processor: async (input) => {
      downstreamCalls.push({
        inspirationId: input.message.inspirationId,
        mediaUrl: input.validatedImage.mediaUrl,
        storageKey: input.validatedImage.storageKey,
        width: input.validatedImage.image.width,
      });
    },
    retrieveValidatedImage: async (mediaUrl) => ({
      image: {
        ...createValidatedImage(mediaUrl),
        image: {
          ...createValidatedImage(mediaUrl).image,
          height: 256,
          width: 512,
        },
      },
      status: "validated",
    }),
  });

  assert.equal(result.message.inspirationId, "insp_photo");
  assert.deepEqual(downstreamCalls, [
    {
      inspirationId: "insp_photo",
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.png",
      storageKey: "users/user-photo/photos/moodboard.png",
      width: 512,
    },
  ]);
});

test("processPhotoAnalysisQueueMessage describes newly fetched photo objects and persists the generated description onto the inspiration", async () => {
  const request = createPhotoAnalysisProcessingRequest();
  const readCalls: string[] = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const describeImageCalls: Array<Record<string, unknown>> = [];
  const persistenceClient: PhotoAnalysisPersistenceClient = {
    inspiration: {
      async findUnique(args) {
        readCalls.push(args.where.id);
        return {
          id: args.where.id,
          rawContent: "moodboard.png",
          sourceMeta: {
            fileName: "moodboard.png",
            mimeType: "image/png",
          },
          sourceType: "PHOTO",
          transcript: null,
        };
      },
      async update(args) {
        updateCalls.push({
          data: args.data,
          where: args.where,
        });
        return {
          id: args.where.id,
        };
      },
    },
  };

  const result = await processPhotoAnalysisQueueMessage(request, {
    nonEmbeddingClient: {
      async describeImage(describeImageRequest) {
        describeImageCalls.push({
          generation: describeImageRequest.generation,
          imageUrl: describeImageRequest.input.imageUrl,
          model: describeImageRequest.input.model,
          operation: describeImageRequest.operation,
          requestId: describeImageRequest.requestId,
        });

        return {
          operation: "describeImage",
          provider: "openai",
          model: "gpt-4.1-mini",
          requestId: describeImageRequest.requestId,
          traceId: describeImageRequest.traceId,
          output: {
            description:
              "  Queue   retries \r\n\tOffline   capture\u00A0\r\n\r\n\r\n  Saved for later  ",
          },
        };
      },
    },
    persistenceClient,
    retrieveValidatedImage: async (mediaUrl) => ({
      image: createValidatedImage(mediaUrl),
      status: "validated",
    }),
  });

  assert.equal(result.message.inspirationId, "insp_photo");
  assert.deepEqual(readCalls, ["insp_photo"]);
  assert.deepEqual(describeImageCalls, [
    {
      generation: {
        seed: 0,
        temperature: 0,
      },
      imageUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.png",
      model: "vision",
      operation: "describeImage",
      requestId: "message-photo-analysis",
    },
  ]);
  assert.deepEqual(updateCalls, [
    {
      data: buildMarkPhotoAnalysisProcessingStartedArgs("insp_photo").data,
      where: {
        id: "insp_photo",
      },
    },
    {
      data: {
        generatedDescription: "Queue retries\nOffline capture\n\nSaved for later",
        ocrText: "Queue retries\nOffline capture\n\nSaved for later",
        processingState: {
          fields: {
            generatedDescription: {
              status: "COMPLETED",
            },
            ocrText: {
              status: "COMPLETED",
            },
          },
          status: "COMPLETED",
        },
        rawContent: "Queue retries\nOffline capture\n\nSaved for later",
        sourceMeta: {
          description: "Queue retries\nOffline capture\n\nSaved for later",
          fileName: "moodboard.png",
          height: 720,
          mimeType: "image/png",
          ocrText: "Queue retries\nOffline capture\n\nSaved for later",
          sizeBytes: 4,
          width: 1280,
        },
        transcript: "Queue retries\nOffline capture\n\nSaved for later",
      },
      where: {
        id: "insp_photo",
      },
    },
  ]);
});

test("processPhotoAnalysisQueueMessage covers the fetch-to-persist flow and preserves authored rawContent while backfilling the generated photo description", async () => {
  const request = createPhotoAnalysisProcessingRequest();
  const pngBytes = createPngBytes(1440, 900);
  const fetchCalls: Array<{
    init?: RequestInit;
    input: string | URL | Request;
  }> = [];
  const describeImageCalls: Array<Record<string, unknown>> = [];
  const updateCalls: Array<Record<string, unknown>> = [];
  const persistenceClient: PhotoAnalysisPersistenceClient = {
    inspiration: {
      async findUnique(args) {
        return {
          id: args.where.id,
          rawContent: "Original photo caption",
          sourceMeta: {
            fileName: "moodboard.png",
            mimeType: "image/png",
            source: "camera",
          },
          sourceType: "PHOTO",
          transcript: null,
        };
      },
      async update(args) {
        updateCalls.push({
          data: args.data,
          where: args.where,
        });
        return {
          id: args.where.id,
        };
      },
    },
  };

  const result = await processPhotoAnalysisQueueMessage(request, {
    env: TEST_ENV,
    nonEmbeddingClient: {
      async describeImage(describeImageRequest) {
        describeImageCalls.push({
          imageUrl: describeImageRequest.input.imageUrl,
          requestId: describeImageRequest.requestId,
        });

        return {
          operation: "describeImage",
          provider: "openai",
          model: "gpt-4.1-mini",
          requestId: describeImageRequest.requestId,
          traceId: describeImageRequest.traceId,
          output: {
            description: "  Whiteboard  sync \r\n   retry  plan\u00A0  ",
          },
        };
      },
    },
    persistenceClient,
    retrieval: {
      env: TEST_ENV,
      fetch: async (input, init) => {
        fetchCalls.push({
          init,
          input,
        });

        return new Response(pngBytes, {
          headers: {
            "content-length": String(pngBytes.byteLength),
            "content-type": "image/png",
          },
          status: 200,
          statusText: "OK",
        });
      },
    },
  });

  assert.equal(result.validatedImage.storageKey, "users/user-photo/photos/moodboard.png");
  assert.deepEqual(result.validatedImage.image, {
    height: 900,
    mimeType: "image/png",
    sizeBytes: pngBytes.byteLength,
    width: 1440,
  });
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.init?.method, "GET");

  const fetchRequestUrl = new URL(String(fetchCalls[0]?.input));

  assert.equal(
    fetchRequestUrl.origin,
    "https://waka-dev-media-bucket.s3.ap-northeast-2.amazonaws.com",
  );
  assert.equal(fetchRequestUrl.pathname, "/users/user-photo/photos/moodboard.png");
  assert.deepEqual(describeImageCalls, [
    {
      imageUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.png",
      requestId: "message-photo-analysis",
    },
  ]);
  assert.deepEqual(updateCalls, [
    {
      data: buildMarkPhotoAnalysisProcessingStartedArgs("insp_photo").data,
      where: {
        id: "insp_photo",
      },
    },
    {
      data: {
        generatedDescription: "Whiteboard sync\nretry plan",
        ocrText: "Whiteboard sync\nretry plan",
        processingState: {
          fields: {
            generatedDescription: {
              status: "COMPLETED",
            },
            ocrText: {
              status: "COMPLETED",
            },
          },
          status: "COMPLETED",
        },
        sourceMeta: {
          description: "Whiteboard sync\nretry plan",
          fileName: "moodboard.png",
          height: 900,
          mimeType: "image/png",
          ocrText: "Whiteboard sync\nretry plan",
          sizeBytes: pngBytes.byteLength,
          source: "camera",
          width: 1440,
        },
        transcript: "Whiteboard sync\nretry plan",
      },
      where: {
        id: "insp_photo",
      },
    },
  ]);
});

test("processPhotoAnalysisQueueMessage rejects OCR output that becomes empty after canonical whitespace cleanup", async () => {
  const request = createPhotoAnalysisProcessingRequest();
  let didReadForCompletion = false;
  const updateCalls: Array<Record<string, unknown>> = [];

  await assert.rejects(
    processPhotoAnalysisQueueMessage(request, {
      nonEmbeddingClient: {
        async describeImage(describeImageRequest) {
          return {
            operation: "describeImage",
            provider: "openai",
            model: "gpt-4.1-mini",
            requestId: describeImageRequest.requestId,
            traceId: describeImageRequest.traceId,
            output: {
              description: " \r\n\t\u00A0\r\n\u200B ",
            },
          };
        },
      },
      persistenceClient: {
        inspiration: {
          async findUnique() {
            didReadForCompletion = true;
            return null;
          },
          async update(args) {
            updateCalls.push({
              data: args.data,
              where: args.where,
            });
            return {
              id: "insp_photo",
            };
          },
        },
      },
      retrieveValidatedImage: async (mediaUrl) => ({
        image: createValidatedImage(mediaUrl),
        status: "validated",
      }),
    }),
    new TypeError(PHOTO_ANALYSIS_EXTRACTION_EMPTY_ERROR),
  );

  assert.equal(didReadForCompletion, false);
  assert.deepEqual(updateCalls, [
    {
      data: buildMarkPhotoAnalysisProcessingStartedArgs("insp_photo").data,
      where: {
        id: "insp_photo",
      },
    },
  ]);
});

test("processPhotoAnalysisQueueMessage preserves explicit retrieval and validation errors from image preparation", async () => {
  const request = createPhotoAnalysisProcessingRequest();
  const retrievalError = new PhotoAnalysisStorageRetrievalError(
    'Failed to download photo object "users/user-photo/photos/moodboard.png" from S3 (503 Service Unavailable).',
    {
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.png",
      storageKey: "users/user-photo/photos/moodboard.png",
    },
  );
  const validationError = new PhotoAnalysisStorageValidationError(
    "photo_analysis storage object must contain a valid image payload.",
    {
      mediaUrl:
        "https://waka.app/api/media/photos/users/user-photo/photos/moodboard.png",
      storageKey: "users/user-photo/photos/moodboard.png",
    },
  );

  const retrievalResult = await preparePhotoAnalysisWorkerProcessing(request, {
    retrieveValidatedImage: async () => ({
      error: retrievalError,
      status: "error",
    }),
  });
  const validationPromise = processPhotoAnalysisQueueMessage(request, {
    retrieveValidatedImage: async () => ({
      error: validationError,
      status: "error",
    }),
  });

  assert.equal(retrievalResult.status, "error");

  if (retrievalResult.status !== "error") {
    throw new Error("Expected a retrieval preparation error.");
  }

  assert.equal(retrievalResult.error, retrievalError);
  await assert.rejects(validationPromise, (error: unknown) => {
    assert.equal(error, validationError);
    return true;
  });
});
