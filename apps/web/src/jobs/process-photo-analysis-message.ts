import type {
  DescribeImageRequest,
  DescribeImageResponse,
} from "../../../../packages/shared/llm/provider.ts";
import { GeminiProvider } from "../../../../packages/shared/llm/gemini-provider.ts";
import { OpenAIProvider } from "../../../../packages/shared/llm/openai-provider.ts";
import {
  resolveNonEmbeddingProviderName,
  type LLMRuntimeEnvironment,
} from "../../../../packages/shared/llm/runtime.ts";
import { parseSqsJobPayload } from "../../../../packages/shared/schemas.ts";
import type { SqsJobPayloadByType } from "../../../../packages/shared/types.ts";
import {
  createInspirationQueueRecordProcessingRequest,
  type InspirationQueueRecord,
  type InspirationQueueRecordProcessingRequest,
} from "./inspiration-queue.ts";
import {
  markPhotoAnalysisProcessingStarted,
  persistPhotoAnalysisResult,
  type PhotoAnalysisPersistenceClient,
} from "./photo-analysis-persistence.ts";
import {
  normalizePhotoAnalysisPlainText,
  PHOTO_ANALYSIS_EXTRACTION_EMPTY_ERROR,
} from "./photo-analysis-text.ts";
import {
  retrievePhotoAnalysisStorageImageResult,
  type PhotoAnalysisStorageImageObject,
  type PhotoAnalysisStorageImageResultError,
  type RetrievePhotoAnalysisStorageImageResult,
  type RetrievePhotoAnalysisStorageObjectOptions,
} from "./photo-analysis-storage.ts";

export type PhotoAnalysisQueueMessageBody =
  SqsJobPayloadByType<"photo_analysis">;

export interface PhotoAnalysisWorkerProcessingInput {
  message: PhotoAnalysisQueueMessageBody;
  processingRequest: InspirationQueueRecordProcessingRequest;
  validatedImage: PhotoAnalysisStorageImageObject;
}

export interface PreparePhotoAnalysisWorkerProcessingReadyResult {
  input: PhotoAnalysisWorkerProcessingInput;
  status: "ready";
}

export interface PreparePhotoAnalysisWorkerProcessingErrorResult {
  error: PhotoAnalysisStorageImageResultError;
  status: "error";
}

export type PreparePhotoAnalysisWorkerProcessingResult =
  | PreparePhotoAnalysisWorkerProcessingReadyResult
  | PreparePhotoAnalysisWorkerProcessingErrorResult;

export type RetrievePhotoAnalysisValidatedImage = (
  mediaUrl: string,
  options?: RetrievePhotoAnalysisStorageObjectOptions,
) => Promise<RetrievePhotoAnalysisStorageImageResult>;

export type PhotoAnalysisWorkerProcessor = (
  input: PhotoAnalysisWorkerProcessingInput,
) => Promise<void> | void;

export interface PhotoAnalysisNonEmbeddingClient {
  describeImage(
    request: DescribeImageRequest,
  ): Promise<DescribeImageResponse>;
}

export interface PhotoAnalysisQueueMessageDependencies {
  env?: NodeJS.ProcessEnv;
  nonEmbeddingClient?: PhotoAnalysisNonEmbeddingClient;
  now?: () => Date;
  persistenceClient?: PhotoAnalysisPersistenceClient;
  retrieveValidatedImage?: RetrievePhotoAnalysisValidatedImage;
}

export interface PreparePhotoAnalysisWorkerProcessingOptions {
  retrieveValidatedImage?: RetrievePhotoAnalysisValidatedImage;
  retrieval?: RetrievePhotoAnalysisStorageObjectOptions;
}

export interface ProcessPhotoAnalysisQueueMessageOptions
  extends PreparePhotoAnalysisWorkerProcessingOptions,
    PhotoAnalysisQueueMessageDependencies {
  processor?: PhotoAnalysisWorkerProcessor;
}

export const PROCESS_PHOTO_ANALYSIS_QUEUE_MESSAGE_DEPENDENCIES_MISSING_ERROR =
  "Photo analysis queue processor dependencies have not been configured.";

let defaultPhotoAnalysisQueueMessageDependencies:
  | PhotoAnalysisQueueMessageDependencies
  | null = null;

function readPhotoAnalysisQueueBody(body: string): Record<string, unknown> {
  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new TypeError(
      `Photo analysis queue body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Photo analysis queue body must be a JSON object.");
  }

  return payload as Record<string, unknown>;
}

function readRequiredMessageString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function readRequiredPhotoAnalysisExtractionText(value: unknown): string {
  return normalizePhotoAnalysisPlainText(value);
}

function createUnsupportedPhotoAnalysisQueueMessageJobTypeError(
  jobType: string,
): TypeError {
  return new TypeError(
    `Photo analysis queue processor only supports photo_analysis jobs; received ${jobType}.`,
  );
}

function resolvePhotoAnalysisQueueMessage(
  request: InspirationQueueRecordProcessingRequest,
): PhotoAnalysisQueueMessageBody {
  if (request.jobType !== undefined && request.jobType !== "photo_analysis") {
    throw createUnsupportedPhotoAnalysisQueueMessageJobTypeError(request.jobType);
  }

  if (request.jobType === "photo_analysis" && request.payload) {
    return parseSqsJobPayload("photo_analysis", request.payload);
  }

  return parseSqsJobPayload(
    "photo_analysis",
    readPhotoAnalysisQueueBody(request.body),
  );
}

function normalizePhotoAnalysisWorkerRequest(
  request: InspirationQueueRecordProcessingRequest | InspirationQueueRecord,
): InspirationQueueRecordProcessingRequest {
  if ("record" in request) {
    return request;
  }

  return createInspirationQueueRecordProcessingRequest(request);
}

function resolvePhotoAnalysisQueueMessageDependencies(
  options: PhotoAnalysisQueueMessageDependencies,
): PhotoAnalysisQueueMessageDependencies {
  if (
    options.env !== undefined ||
    options.nonEmbeddingClient !== undefined ||
    options.now !== undefined ||
    options.persistenceClient !== undefined ||
    options.retrieveValidatedImage !== undefined
  ) {
    return {
      ...(defaultPhotoAnalysisQueueMessageDependencies ?? {}),
      ...options,
    };
  }

  if (defaultPhotoAnalysisQueueMessageDependencies) {
    return defaultPhotoAnalysisQueueMessageDependencies;
  }

  return {};
}

function resolvePhotoAnalysisValidatedImageRetriever(
  options: PreparePhotoAnalysisWorkerProcessingOptions,
): RetrievePhotoAnalysisValidatedImage {
  const dependencies = resolvePhotoAnalysisQueueMessageDependencies(options);

  return (
    dependencies.retrieveValidatedImage ?? retrievePhotoAnalysisStorageImageResult
  );
}

function resolvePhotoAnalysisWorkerEnvironment(
  override: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  return override ?? defaultPhotoAnalysisQueueMessageDependencies?.env ?? process.env;
}

function resolvePhotoAnalysisNonEmbeddingClient(
  override: PhotoAnalysisNonEmbeddingClient | undefined,
  env: NodeJS.ProcessEnv & LLMRuntimeEnvironment,
): PhotoAnalysisNonEmbeddingClient {
  if (override) {
    return override;
  }

  if (defaultPhotoAnalysisQueueMessageDependencies?.nonEmbeddingClient) {
    return defaultPhotoAnalysisQueueMessageDependencies.nonEmbeddingClient;
  }

  switch (resolveNonEmbeddingProviderName(env)) {
    case "gemini":
      return new GeminiProvider({
        apiKey: env.GEMINI_API_KEY ?? "",
      });
    case "openai":
      return new OpenAIProvider({
        apiKey: env.OPENAI_API_KEY ?? "",
        baseUrl: env.OPENAI_BASE_URL,
      });
  }
}

function resolvePhotoAnalysisPersistenceClient(
  override: PhotoAnalysisPersistenceClient | undefined,
): PhotoAnalysisPersistenceClient {
  if (override) {
    return override;
  }

  if (defaultPhotoAnalysisQueueMessageDependencies?.persistenceClient) {
    return defaultPhotoAnalysisQueueMessageDependencies.persistenceClient;
  }

  throw new Error(PROCESS_PHOTO_ANALYSIS_QUEUE_MESSAGE_DEPENDENCIES_MISSING_ERROR);
}

function resolvePhotoAnalysisClock(override?: () => Date): () => Date {
  return (
    override ??
    defaultPhotoAnalysisQueueMessageDependencies?.now ??
    (() => new Date())
  );
}

function createDeterministicGenerationOptions() {
  return {
    seed: 0,
    temperature: 0,
  } as const;
}

async function extractPhotoAnalysisText(
  input: PhotoAnalysisWorkerProcessingInput,
  client: PhotoAnalysisNonEmbeddingClient,
  now: () => Date,
): Promise<string> {
  const requestId = input.processingRequest.metadata.messageId;
  const response = await client.describeImage({
    generation: createDeterministicGenerationOptions(),
    operation: "describeImage",
    requestId,
    traceId: `photo-analysis:${input.message.inspirationId}:${now().toISOString()}`,
    input: {
      imageUrl: input.message.mediaUrl,
      model: "vision",
    },
  });

  return readRequiredPhotoAnalysisExtractionText(response.output.description);
}

async function runDefaultPhotoAnalysisWorkerProcessor(
  input: PhotoAnalysisWorkerProcessingInput,
  options: ProcessPhotoAnalysisQueueMessageOptions,
): Promise<void> {
  const env = resolvePhotoAnalysisWorkerEnvironment(options.env);
  const now = resolvePhotoAnalysisClock(options.now);
  const nonEmbeddingClient = resolvePhotoAnalysisNonEmbeddingClient(
    options.nonEmbeddingClient,
    env,
  );
  const persistenceClient = resolvePhotoAnalysisPersistenceClient(
    options.persistenceClient,
  );

  await markPhotoAnalysisProcessingStarted(
    persistenceClient,
    input.message.inspirationId,
  );

  const extractionText = await extractPhotoAnalysisText(
    input,
    nonEmbeddingClient,
    now,
  );

  await persistPhotoAnalysisResult(
    persistenceClient,
    input.message.inspirationId,
    input.validatedImage,
    extractionText,
  );
}

export function configurePhotoAnalysisQueueMessageDependencies(
  dependencies: PhotoAnalysisQueueMessageDependencies | null,
): void {
  defaultPhotoAnalysisQueueMessageDependencies = dependencies;
}

export async function preparePhotoAnalysisWorkerProcessing(
  request: InspirationQueueRecordProcessingRequest | InspirationQueueRecord,
  options: PreparePhotoAnalysisWorkerProcessingOptions = {},
): Promise<PreparePhotoAnalysisWorkerProcessingResult> {
  const processingRequest = normalizePhotoAnalysisWorkerRequest(request);
  const message = resolvePhotoAnalysisQueueMessage(processingRequest);
  const retrieveValidatedImage =
    resolvePhotoAnalysisValidatedImageRetriever(options);
  const retrievalResult = await retrieveValidatedImage(
    message.mediaUrl,
    options.retrieval,
  );

  if (retrievalResult.status === "error") {
    return retrievalResult;
  }

  return {
    input: {
      message,
      processingRequest,
      validatedImage: retrievalResult.image,
    },
    status: "ready",
  };
}

export async function processPhotoAnalysisQueueMessage(
  request: InspirationQueueRecordProcessingRequest | InspirationQueueRecord,
  options: ProcessPhotoAnalysisQueueMessageOptions = {},
): Promise<PhotoAnalysisWorkerProcessingInput> {
  const result = await preparePhotoAnalysisWorkerProcessing(request, options);

  if (result.status === "error") {
    throw result.error;
  }

  if (options.processor) {
    await options.processor(result.input);
    return result.input;
  }

  await runDefaultPhotoAnalysisWorkerProcessor(result.input, options);

  return result.input;
}
