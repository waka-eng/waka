import assert from "node:assert/strict";
import test from "node:test";

import {
  createInspirationQueueRecordProcessingRequest,
} from "../apps/web/src/jobs/inspiration-queue.ts";
import {
  createProcessInspirationJob,
} from "../apps/web/src/jobs/process-inspiration-job.ts";
import {
  configurePhotoAnalysisQueueMessageDependencies,
} from "../apps/web/src/jobs/process-photo-analysis-message.ts";
import { buildMarkPhotoAnalysisProcessingStartedArgs } from "../apps/web/src/jobs/photo-analysis-persistence.ts";
import {
  INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
} from "../apps/web/src/inspirations/enrichment-pipeline.ts";

function createPhotoAnalysisRequest() {
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

function createConnectionAnalysisRequest() {
  const payload = {
    inspirationId: "insp_connection",
    jobType: "connection_analysis" as const,
    userId: "user_connection",
  };
  const record = {
    body: JSON.stringify(payload),
    messageId: "message-connection-analysis",
  };

  return {
    ...createInspirationQueueRecordProcessingRequest(record),
    jobType: "connection_analysis" as const,
    payload,
  };
}

function createClusterRebuildRequest() {
  const payload = {
    jobType: "cluster_rebuild" as const,
    userId: "user_cluster",
  };
  const record = {
    body: JSON.stringify(payload),
    messageId: "message-cluster-rebuild",
  };

  return {
    ...createInspirationQueueRecordProcessingRequest(record),
    jobType: "cluster_rebuild" as const,
    payload,
  };
}

test("createProcessInspirationJob routes photo_analysis jobs through the configured photo processor", async () => {
  const routedCalls: string[] = [];
  const processJob = createProcessInspirationJob({
    inspirationMessageProcessor: async () => {
      routedCalls.push("inspiration");
    },
    photoAnalysisMessageProcessor: async () => {
      routedCalls.push("photo");
    },
  });

  const result = await processJob(createPhotoAnalysisRequest());

  assert.deepEqual(routedCalls, ["photo"]);
  assert.deepEqual(result, {
    outcome: "success",
  });
});

test("createProcessInspirationJob routes connection_analysis jobs through the configured connection processor", async () => {
  const routedCalls: string[] = [];
  const processJob = createProcessInspirationJob({
    connectionAnalysisMessageProcessor: async () => {
      routedCalls.push("connection");
    },
    inspirationMessageProcessor: async () => {
      routedCalls.push("inspiration");
    },
    photoAnalysisMessageProcessor: async () => {
      routedCalls.push("photo");
    },
  });

  const result = await processJob(createConnectionAnalysisRequest());

  assert.deepEqual(routedCalls, ["connection"]);
  assert.deepEqual(result, {
    outcome: "success",
  });
});

test("createProcessInspirationJob routes cluster_rebuild jobs through the configured cluster rebuild processor", async () => {
  const routedCalls: string[] = [];
  const processJob = createProcessInspirationJob({
    clusterRebuildMessageProcessor: async () => {
      routedCalls.push("cluster");
    },
    connectionAnalysisMessageProcessor: async () => {
      routedCalls.push("connection");
    },
    inspirationMessageProcessor: async () => {
      routedCalls.push("inspiration");
    },
    photoAnalysisMessageProcessor: async () => {
      routedCalls.push("photo");
    },
  });

  const result = await processJob(createClusterRebuildRequest());

  assert.deepEqual(routedCalls, ["cluster"]);
  assert.deepEqual(result, {
    outcome: "success",
  });
});

test("createProcessInspirationJob preserves non-retryable validation failures raised by the photo worker path", async () => {
  const processJob = createProcessInspirationJob({
    photoAnalysisMessageProcessor: async () => {
      throw new TypeError(
        "photo_analysis storage object must contain a valid image payload.",
      );
    },
  });

  const result = await processJob(createPhotoAnalysisRequest());

  assert.equal(result.outcome, "failure");

  if (result.outcome !== "failure") {
    throw new Error("Expected the photo worker path to fail explicitly.");
  }

  assert.equal(
    result.retryability,
    INSPIRATION_ENRICHMENT_RETRYABILITY_NON_RETRYABLE,
  );
  assert.match(
    result.error instanceof Error ? result.error.message : String(result.error),
    /valid image payload/,
  );
});

test("createProcessInspirationJob routes photo_analysis jobs through the built-in worker when no custom photo processor is provided", async () => {
  const routedCalls: string[] = [];
  const persistedResults: Array<Record<string, unknown>> = [];

  configurePhotoAnalysisQueueMessageDependencies({
    nonEmbeddingClient: {
      async describeImage() {
        return {
          operation: "describeImage",
          provider: "openai",
          model: "gpt-4.1-mini",
          output: {
            description: "  OCR from the captured whiteboard  ",
          },
        };
      },
    },
    persistenceClient: {
      inspiration: {
        async findUnique(args) {
          return {
            id: args.where.id,
            rawContent: "moodboard.png",
            sourceMeta: {
              fileName: "moodboard.png",
            },
            sourceType: "PHOTO" as const,
            transcript: null,
          };
        },
        async update(args) {
          persistedResults.push({
            data: args.data,
            where: args.where,
          });
          return {
            id: args.where.id,
          };
        },
      },
    },
    retrieveValidatedImage: async (mediaUrl) => ({
      image: {
        bytes: Uint8Array.from([1, 2, 3, 4]),
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
      },
      status: "validated" as const,
    }),
  });

  try {
    const processJob = createProcessInspirationJob({
      inspirationMessageProcessor: async () => {
        routedCalls.push("inspiration");
      },
    });

    const result = await processJob(createPhotoAnalysisRequest());

    assert.deepEqual(routedCalls, []);
    assert.deepEqual(result, {
      outcome: "success",
    });
    assert.deepEqual(persistedResults, [
      {
        data: buildMarkPhotoAnalysisProcessingStartedArgs("insp_photo").data,
        where: {
          id: "insp_photo",
        },
      },
      {
        data: {
          generatedDescription: "OCR from the captured whiteboard",
          ocrText: "OCR from the captured whiteboard",
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
          rawContent: "OCR from the captured whiteboard",
          sourceMeta: {
            description: "OCR from the captured whiteboard",
            fileName: "moodboard.png",
            height: 720,
            mimeType: "image/png",
            ocrText: "OCR from the captured whiteboard",
            sizeBytes: 4,
            width: 1280,
          },
          transcript: "OCR from the captured whiteboard",
        },
        where: {
          id: "insp_photo",
        },
      },
    ]);
  } finally {
    configurePhotoAnalysisQueueMessageDependencies(null);
  }
});
