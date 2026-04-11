import type {
  ExplainConnectionRequest,
  ExplainConnectionResponse,
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
  buildFindConnectionAnalysisInspirationArgs,
  findInspirationForConnectionAnalysis,
  type ConnectionAnalysisInspirationRecord,
  type ConnectionAnalysisPersistenceClient,
  upsertConnectionAnalysisMatch,
} from "./connection-analysis-persistence.ts";
import {
  createInspirationQueueRecordProcessingRequest,
  type InspirationQueueRecord,
  type InspirationQueueRecordProcessingRequest,
} from "./inspiration-queue.ts";
import {
  findNearestInspirations,
  type InspirationSimilarityMatch,
} from "./inspiration-similarity-search.ts";

export type ConnectionAnalysisQueueMessageBody =
  SqsJobPayloadByType<"connection_analysis">;

export interface ConnectionAnalysisCandidate {
  id: string;
  rawContent: string;
  similarity: number;
  sourceConversationRef?: string;
}

export interface ConnectionAnalysisWorkerProcessingInput {
  candidates: readonly ConnectionAnalysisCandidate[];
  maxConnections: number;
  message: ConnectionAnalysisQueueMessageBody;
  processingRequest: InspirationQueueRecordProcessingRequest;
  similarityThreshold: number;
  sourceInspiration: ConnectionAnalysisInspirationRecord & {
    embedding: readonly number[] | null;
  };
}

export type ConnectionAnalysisWorkerProcessor = (
  input: ConnectionAnalysisWorkerProcessingInput,
) => Promise<void> | void;

export interface ConnectionAnalysisNonEmbeddingClient {
  explainConnection(
    request: ExplainConnectionRequest,
  ): Promise<ExplainConnectionResponse>;
}

export interface ConnectionAnalysisQueueMessageDependencies {
  env?: NodeJS.ProcessEnv;
  nonEmbeddingClient?: ConnectionAnalysisNonEmbeddingClient;
  now?: () => Date;
  persistenceClient?: ConnectionAnalysisPersistenceClient;
}

export interface ProcessConnectionAnalysisQueueMessageOptions
  extends ConnectionAnalysisQueueMessageDependencies {
  processor?: ConnectionAnalysisWorkerProcessor;
}

export const DEFAULT_CONNECTION_ANALYSIS_MAX_CONNECTIONS = 5;
export const DEFAULT_CONNECTION_ANALYSIS_SIMILARITY_THRESHOLD = 0.78;
export const PROCESS_CONNECTION_ANALYSIS_QUEUE_MESSAGE_DEPENDENCIES_MISSING_ERROR =
  "Connection analysis queue processor dependencies have not been configured.";

let defaultConnectionAnalysisQueueMessageDependencies:
  | ConnectionAnalysisQueueMessageDependencies
  | null = null;

function readConnectionAnalysisQueueBody(
  body: string,
): Record<string, unknown> {
  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new TypeError(
      `Connection analysis queue body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Connection analysis queue body must be a JSON object.");
  }

  return payload as Record<string, unknown>;
}

function readRequiredMessageString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function normalizeOptionalEmbedding(
  value: unknown,
  label: string,
): readonly number[] | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))
  ) {
    throw new TypeError(`${label} must be an array of finite numbers when present.`);
  }

  return value;
}

function readPositiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new RangeError(`${label} must be a positive integer.`);
  }

  return Number(value);
}

function readUnitIntervalNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${label} must be a finite number between 0 and 1.`);
  }

  return value;
}

function resolveConnectionAnalysisMaxConnections(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_CONNECTION_ANALYSIS_MAX_CONNECTIONS;
  }

  return Math.min(
    readPositiveInteger(value, "Connection analysis maxConnections"),
    DEFAULT_CONNECTION_ANALYSIS_MAX_CONNECTIONS,
  );
}

function resolveConnectionAnalysisSimilarityThreshold(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_CONNECTION_ANALYSIS_SIMILARITY_THRESHOLD;
  }

  return readUnitIntervalNumber(
    value,
    "Connection analysis similarityThreshold",
  );
}

function createUnsupportedConnectionAnalysisQueueMessageJobTypeError(
  jobType: string,
): TypeError {
  return new TypeError(
    `Connection analysis queue processor only supports connection_analysis jobs; received ${jobType}.`,
  );
}

function resolveConnectionAnalysisQueueMessage(
  request: InspirationQueueRecordProcessingRequest,
): ConnectionAnalysisQueueMessageBody {
  if (
    request.jobType !== undefined &&
    request.jobType !== "connection_analysis"
  ) {
    throw createUnsupportedConnectionAnalysisQueueMessageJobTypeError(
      request.jobType,
    );
  }

  if (request.jobType === "connection_analysis" && request.payload) {
    return parseSqsJobPayload("connection_analysis", request.payload);
  }

  return parseSqsJobPayload(
    "connection_analysis",
    readConnectionAnalysisQueueBody(request.body),
  );
}

function normalizeConnectionAnalysisWorkerRequest(
  request: InspirationQueueRecordProcessingRequest | InspirationQueueRecord,
): InspirationQueueRecordProcessingRequest {
  if ("record" in request) {
    return request;
  }

  return createInspirationQueueRecordProcessingRequest(request);
}

function resolveConnectionAnalysisQueueMessageDependencies(
  options: ConnectionAnalysisQueueMessageDependencies,
): ConnectionAnalysisQueueMessageDependencies {
  if (
    options.env !== undefined ||
    options.nonEmbeddingClient !== undefined ||
    options.now !== undefined ||
    options.persistenceClient !== undefined
  ) {
    return {
      ...(defaultConnectionAnalysisQueueMessageDependencies ?? {}),
      ...options,
    };
  }

  return defaultConnectionAnalysisQueueMessageDependencies ?? {};
}

function resolveConnectionAnalysisWorkerEnvironment(
  override: NodeJS.ProcessEnv | undefined,
): NodeJS.ProcessEnv {
  return (
    override ??
    defaultConnectionAnalysisQueueMessageDependencies?.env ??
    process.env
  );
}

function resolveConnectionAnalysisNonEmbeddingClient(
  override: ConnectionAnalysisNonEmbeddingClient | undefined,
  env: NodeJS.ProcessEnv & LLMRuntimeEnvironment,
): ConnectionAnalysisNonEmbeddingClient {
  if (override) {
    return override;
  }

  if (defaultConnectionAnalysisQueueMessageDependencies?.nonEmbeddingClient) {
    return defaultConnectionAnalysisQueueMessageDependencies.nonEmbeddingClient;
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

function resolveConnectionAnalysisPersistenceClient(
  override: ConnectionAnalysisPersistenceClient | undefined,
): ConnectionAnalysisPersistenceClient {
  if (override) {
    return override;
  }

  if (defaultConnectionAnalysisQueueMessageDependencies?.persistenceClient) {
    return defaultConnectionAnalysisQueueMessageDependencies.persistenceClient;
  }

  throw new Error(
    PROCESS_CONNECTION_ANALYSIS_QUEUE_MESSAGE_DEPENDENCIES_MISSING_ERROR,
  );
}

function resolveConnectionAnalysisClock(override?: () => Date): () => Date {
  return (
    override ??
    defaultConnectionAnalysisQueueMessageDependencies?.now ??
    (() => new Date())
  );
}

function createDeterministicGenerationOptions() {
  return {
    seed: 0,
    temperature: 0,
  } as const;
}

function dedupeConnectionMatches(
  matches: readonly InspirationSimilarityMatch[],
): InspirationSimilarityMatch[] {
  const seenIds = new Set<string>();
  const dedupedMatches: InspirationSimilarityMatch[] = [];

  for (const match of matches) {
    if (seenIds.has(match.id)) {
      continue;
    }

    seenIds.add(match.id);
    dedupedMatches.push(match);
  }

  return dedupedMatches;
}

async function resolveConnectionAnalysisCandidates(
  persistenceClient: ConnectionAnalysisPersistenceClient,
  message: ConnectionAnalysisQueueMessageBody,
  sourceInspiration: ConnectionAnalysisInspirationRecord & {
    embedding: readonly number[] | null;
  },
  maxConnections: number,
  similarityThreshold: number,
): Promise<ConnectionAnalysisCandidate[]> {
  if (sourceInspiration.embedding === null) {
    return [];
  }

  const matches = dedupeConnectionMatches(
    await findNearestInspirations(persistenceClient, {
      embedding: sourceInspiration.embedding,
      excludeInspirationId: sourceInspiration.id,
      limit: maxConnections,
      minSimilarity: similarityThreshold,
      userId: message.userId,
    }),
  ).slice(0, maxConnections);

  const targetInspirations = await Promise.all(
    matches.map((match) =>
      persistenceClient.inspiration.findFirst(
        buildFindConnectionAnalysisInspirationArgs(message.userId, match.id),
      ),
    ),
  );

  return matches
    .flatMap((match, index) => {
      const targetInspiration = targetInspirations[index];

      if (!targetInspiration) {
        return [];
      }

      return [
        {
          id: targetInspiration.id,
          rawContent: readRequiredMessageString(
            targetInspiration.rawContent,
            `Connection target inspiration ${targetInspiration.id} rawContent`,
          ),
          similarity: match.similarity,
          ...(match.sourceConversationRef === undefined
            ? {}
            : {
                sourceConversationRef: match.sourceConversationRef,
              }),
        },
      ];
    })
    .slice(0, maxConnections);
}

async function runDefaultConnectionAnalysisWorkerProcessor(
  input: ConnectionAnalysisWorkerProcessingInput,
  options: ProcessConnectionAnalysisQueueMessageOptions,
): Promise<void> {
  if (input.candidates.length === 0) {
    return;
  }

  const env = resolveConnectionAnalysisWorkerEnvironment(options.env);
  const now = resolveConnectionAnalysisClock(options.now);
  const nonEmbeddingClient = resolveConnectionAnalysisNonEmbeddingClient(
    options.nonEmbeddingClient,
    env,
  );
  const persistenceClient = resolveConnectionAnalysisPersistenceClient(
    options.persistenceClient,
  );
  const requestId = input.processingRequest.metadata.messageId;

  for (const candidate of input.candidates.slice(0, input.maxConnections)) {
    const explanationResponse = await nonEmbeddingClient.explainConnection({
      generation: createDeterministicGenerationOptions(),
      operation: "explainConnection",
      requestId,
      traceId: `connection-analysis:${input.sourceInspiration.id}:${candidate.id}`,
      input: {
        model: "text",
        sourceContent: input.sourceInspiration.rawContent,
        targetContent: candidate.rawContent,
      },
    });

    await upsertConnectionAnalysisMatch(persistenceClient, {
      explanation: readRequiredMessageString(
        explanationResponse.output.explanation,
        `Connection explanation for ${input.sourceInspiration.id} -> ${candidate.id}`,
      ),
      similarityScore: candidate.similarity,
      sourceId: input.sourceInspiration.id,
      surfacedAt: now(),
      targetId: candidate.id,
      userId: input.message.userId,
    });
  }
}

export function configureConnectionAnalysisQueueMessageDependencies(
  dependencies: ConnectionAnalysisQueueMessageDependencies | null,
): void {
  defaultConnectionAnalysisQueueMessageDependencies = dependencies;
}

export async function prepareConnectionAnalysisWorkerProcessing(
  request: InspirationQueueRecordProcessingRequest | InspirationQueueRecord,
  options: ConnectionAnalysisQueueMessageDependencies = {},
): Promise<ConnectionAnalysisWorkerProcessingInput> {
  const processingRequest =
    normalizeConnectionAnalysisWorkerRequest(request);
  const message = resolveConnectionAnalysisQueueMessage(processingRequest);
  const dependencies = resolveConnectionAnalysisQueueMessageDependencies(options);
  const persistenceClient = resolveConnectionAnalysisPersistenceClient(
    dependencies.persistenceClient,
  );
  const maxConnections = resolveConnectionAnalysisMaxConnections(
    message.maxConnections,
  );
  const similarityThreshold = resolveConnectionAnalysisSimilarityThreshold(
    message.similarityThreshold,
  );
  const sourceInspirationRecord = await findInspirationForConnectionAnalysis(
    persistenceClient,
    message.userId,
    message.inspirationId,
  );

  if (!sourceInspirationRecord) {
    throw new Error(
      `Inspiration ${message.inspirationId} was not found for connection analysis.`,
    );
  }

  const sourceInspiration = {
    ...sourceInspirationRecord,
    embedding: normalizeOptionalEmbedding(
      sourceInspirationRecord.embedding,
      `Connection source inspiration ${sourceInspirationRecord.id} embedding`,
    ),
    rawContent: readRequiredMessageString(
      sourceInspirationRecord.rawContent,
      `Connection source inspiration ${sourceInspirationRecord.id} rawContent`,
    ),
  };
  const candidates = await resolveConnectionAnalysisCandidates(
    persistenceClient,
    message,
    sourceInspiration,
    maxConnections,
    similarityThreshold,
  );

  return {
    candidates,
    maxConnections,
    message,
    processingRequest,
    similarityThreshold,
    sourceInspiration,
  };
}

export async function processConnectionAnalysisQueueMessage(
  request: InspirationQueueRecordProcessingRequest | InspirationQueueRecord,
  options: ProcessConnectionAnalysisQueueMessageOptions = {},
): Promise<ConnectionAnalysisWorkerProcessingInput> {
  const input = await prepareConnectionAnalysisWorkerProcessing(request, options);

  if (options.processor) {
    await options.processor(input);
    return input;
  }

  await runDefaultConnectionAnalysisWorkerProcessor(input, options);

  return input;
}
