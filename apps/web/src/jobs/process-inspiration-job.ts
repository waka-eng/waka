import type {
  InspirationQueueMessageProcessingResult,
  InspirationQueueMessageProcessor,
  InspirationQueueRecordProcessingRequest,
} from "./inspiration-queue.ts";
import {
  createInspirationQueueMessageProcessingFailure,
  createInspirationQueueMessageProcessingSuccess,
  resolveInspirationQueueAttemptCount,
} from "./inspiration-queue.ts";
import { INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT } from "../inspirations/enrichment-pipeline.ts";
import { classifyInspirationJobFailureRetryability } from "./inspiration-job-failure.ts";
import { processInspirationQueueMessage } from "./process-inspiration-message.ts";
import { processConnectionAnalysisQueueMessage } from "./process-connection-analysis-message.ts";
import { processClusterRebuildQueueMessage } from "./process-cluster-rebuild-message.ts";
import { processPhotoAnalysisQueueMessage } from "./process-photo-analysis-message.ts";

export type InspirationJobProcessingResult =
  InspirationQueueMessageProcessingResult;

export type InspirationJobProcessingService = (
  request: InspirationQueueRecordProcessingRequest,
) => Promise<InspirationJobProcessingResult>;

export interface CreateProcessInspirationJobOptions {
  clusterRebuildMessageProcessor?: (
    request: InspirationQueueRecordProcessingRequest,
  ) => Promise<unknown>;
  connectionAnalysisMessageProcessor?: (
    request: InspirationQueueRecordProcessingRequest,
  ) => Promise<unknown>;
  inspirationMessageProcessor?: (
    request: InspirationQueueRecordProcessingRequest,
  ) => Promise<unknown>;
  photoAnalysisMessageProcessor?: (
    request: InspirationQueueRecordProcessingRequest,
  ) => Promise<unknown>;
}

function resolveInspirationJobProcessor(
  request: InspirationQueueRecordProcessingRequest,
  options: CreateProcessInspirationJobOptions,
): ((
  request: InspirationQueueRecordProcessingRequest,
) => Promise<unknown>) {
  if (
    request.jobType === "connection_analysis" &&
    options.connectionAnalysisMessageProcessor !== undefined
  ) {
    return options.connectionAnalysisMessageProcessor;
  }

  if (request.jobType === "connection_analysis") {
    return processConnectionAnalysisQueueMessage;
  }

  if (
    request.jobType === "cluster_rebuild" &&
    options.clusterRebuildMessageProcessor !== undefined
  ) {
    return options.clusterRebuildMessageProcessor;
  }

  if (request.jobType === "cluster_rebuild") {
    return processClusterRebuildQueueMessage;
  }

  if (
    request.jobType === "photo_analysis" &&
    options.photoAnalysisMessageProcessor !== undefined
  ) {
    return options.photoAnalysisMessageProcessor;
  }

  if (request.jobType === "photo_analysis") {
    return processPhotoAnalysisQueueMessage;
  }

  return options.inspirationMessageProcessor ?? processInspirationQueueMessage;
}

export function createProcessInspirationJob(
  options: CreateProcessInspirationJobOptions = {},
): InspirationQueueMessageProcessor {
  return async (request) => {
    try {
      await resolveInspirationJobProcessor(request, options)(request);

      return createInspirationQueueMessageProcessingSuccess();
    } catch (error) {
      return createInspirationQueueMessageProcessingFailure(
        error,
        classifyInspirationJobFailureRetryability(error),
        {
          attemptCount: resolveInspirationQueueAttemptCount(request),
          maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        },
      );
    }
  };
}

export const processInspirationJob = createProcessInspirationJob();
