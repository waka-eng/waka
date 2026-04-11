import { parseSqsJobPayload } from "../../../../packages/shared/schemas.ts";
import type { SqsJobPayloadByType } from "../../../../packages/shared/types.ts";
import {
  buildDeleteEmptyClustersArgs,
  buildFindClusterRebuildClustersArgs,
  buildFindClusterRebuildInspirationsArgs,
  resolveEmptyClusterIds,
  type ClusterRebuildPersistenceClient,
  type ClusterRebuildTrackedClusterRecord,
  type ClusterRebuildTrackedInspirationRecord,
} from "./cluster-rebuild-persistence.ts";
import {
  createInspirationQueueRecordProcessingRequest,
  type InspirationQueueRecord,
  type InspirationQueueRecordProcessingRequest,
} from "./inspiration-queue.ts";

export type ClusterRebuildQueueMessageBody =
  SqsJobPayloadByType<"cluster_rebuild">;

export interface ClusterRebuildWorkerProcessingInput {
  clusters: readonly ClusterRebuildTrackedClusterRecord[];
  emptyClusterIds: readonly string[];
  inspirations: readonly ClusterRebuildTrackedInspirationRecord[];
  message: ClusterRebuildQueueMessageBody;
  processingRequest: InspirationQueueRecordProcessingRequest;
}

export type ClusterRebuildWorkerProcessor = (
  input: ClusterRebuildWorkerProcessingInput,
) => Promise<void> | void;

export interface ClusterRebuildQueueMessageDependencies {
  persistenceClient?: ClusterRebuildPersistenceClient;
}

export interface ProcessClusterRebuildQueueMessageOptions
  extends ClusterRebuildQueueMessageDependencies {
  processor?: ClusterRebuildWorkerProcessor;
}

export const PROCESS_CLUSTER_REBUILD_QUEUE_MESSAGE_DEPENDENCIES_MISSING_ERROR =
  "Cluster rebuild queue processor dependencies have not been configured.";

let defaultClusterRebuildQueueMessageDependencies:
  | ClusterRebuildQueueMessageDependencies
  | null = null;

function readClusterRebuildQueueBody(body: string): Record<string, unknown> {
  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new TypeError(
      `Cluster rebuild queue body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Cluster rebuild queue body must be a JSON object.");
  }

  return payload as Record<string, unknown>;
}

function createUnsupportedClusterRebuildQueueMessageJobTypeError(
  jobType: string,
): TypeError {
  return new TypeError(
    `Cluster rebuild queue processor only supports cluster_rebuild jobs; received ${jobType}.`,
  );
}

function resolveClusterRebuildQueueMessage(
  request: InspirationQueueRecordProcessingRequest,
): ClusterRebuildQueueMessageBody {
  if (request.jobType !== undefined && request.jobType !== "cluster_rebuild") {
    throw createUnsupportedClusterRebuildQueueMessageJobTypeError(
      request.jobType,
    );
  }

  if (request.jobType === "cluster_rebuild" && request.payload) {
    return parseSqsJobPayload("cluster_rebuild", request.payload);
  }

  return parseSqsJobPayload(
    "cluster_rebuild",
    readClusterRebuildQueueBody(request.body),
  );
}

function normalizeClusterRebuildWorkerRequest(
  request: InspirationQueueRecordProcessingRequest | InspirationQueueRecord,
): InspirationQueueRecordProcessingRequest {
  if ("record" in request) {
    return request;
  }

  return createInspirationQueueRecordProcessingRequest(request);
}

function resolveClusterRebuildQueueMessageDependencies(
  options: ClusterRebuildQueueMessageDependencies,
): ClusterRebuildQueueMessageDependencies {
  if (options.persistenceClient !== undefined) {
    return {
      ...(defaultClusterRebuildQueueMessageDependencies ?? {}),
      ...options,
    };
  }

  return defaultClusterRebuildQueueMessageDependencies ?? {};
}

function resolveClusterRebuildPersistenceClient(
  override: ClusterRebuildPersistenceClient | undefined,
): ClusterRebuildPersistenceClient {
  if (override) {
    return override;
  }

  if (defaultClusterRebuildQueueMessageDependencies?.persistenceClient) {
    return defaultClusterRebuildQueueMessageDependencies.persistenceClient;
  }

  throw new Error(PROCESS_CLUSTER_REBUILD_QUEUE_MESSAGE_DEPENDENCIES_MISSING_ERROR);
}

async function runDefaultClusterRebuildWorkerProcessor(
  input: ClusterRebuildWorkerProcessingInput,
  options: ProcessClusterRebuildQueueMessageOptions,
): Promise<void> {
  if (input.emptyClusterIds.length === 0) {
    return;
  }

  const persistenceClient = resolveClusterRebuildPersistenceClient(
    options.persistenceClient,
  );

  await persistenceClient.cluster.deleteMany(
    buildDeleteEmptyClustersArgs(input.message.userId, input.emptyClusterIds),
  );
}

export function configureClusterRebuildQueueMessageDependencies(
  dependencies: ClusterRebuildQueueMessageDependencies | null,
): void {
  defaultClusterRebuildQueueMessageDependencies = dependencies;
}

export async function prepareClusterRebuildWorkerProcessing(
  request: InspirationQueueRecordProcessingRequest | InspirationQueueRecord,
  options: ClusterRebuildQueueMessageDependencies = {},
): Promise<ClusterRebuildWorkerProcessingInput> {
  const processingRequest = normalizeClusterRebuildWorkerRequest(request);
  const message = resolveClusterRebuildQueueMessage(processingRequest);
  const dependencies = resolveClusterRebuildQueueMessageDependencies(options);
  const persistenceClient = resolveClusterRebuildPersistenceClient(
    dependencies.persistenceClient,
  );
  const [clusters, inspirations] = await Promise.all([
    persistenceClient.cluster.findMany(
      buildFindClusterRebuildClustersArgs(message.userId),
    ),
    persistenceClient.inspiration.findMany(
      buildFindClusterRebuildInspirationsArgs(message.userId),
    ),
  ]);

  return {
    clusters,
    emptyClusterIds: resolveEmptyClusterIds(clusters, inspirations),
    inspirations,
    message,
    processingRequest,
  };
}

export async function processClusterRebuildQueueMessage(
  request: InspirationQueueRecordProcessingRequest | InspirationQueueRecord,
  options: ProcessClusterRebuildQueueMessageOptions = {},
): Promise<ClusterRebuildWorkerProcessingInput> {
  const input = await prepareClusterRebuildWorkerProcessing(request, options);

  if (options.processor) {
    await options.processor(input);
    return input;
  }

  await runDefaultClusterRebuildWorkerProcessor(input, options);

  return input;
}
