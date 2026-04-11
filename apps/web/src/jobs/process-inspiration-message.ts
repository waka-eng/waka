import type {
  ClassifyRequest,
  ClassifyResponse,
  ClassifyMetadataRequest,
  ClassifyMetadataResponse,
  GenerateEmbeddingRequest,
  GenerateEmbeddingResponse,
  GenerateReflectionRequest,
  GenerateReflectionResponse,
  GenerateTitleRequest,
  GenerateTitleResponse,
  SummarizeRequest,
  SummarizeResponse,
} from "../../../../packages/shared/llm/provider.ts";
import { GeminiProvider } from "../../../../packages/shared/llm/gemini-provider.ts";
import { OpenAIProvider } from "../../../../packages/shared/llm/openai-provider.ts";
import { buildReflectionGroundingContext } from "../../../../packages/shared/llm/reflection-grounding.ts";
import {
  createEmbeddingClientFromEnv,
  resolveNonEmbeddingProviderName,
  type LLMRuntimeEnvironment,
} from "../../../../packages/shared/llm/runtime.ts";
import {
  parseSqsJobPayload,
  parseSupportedSqsJobType,
} from "../../../../packages/shared/schemas.ts";
import { INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS_ENVIRONMENT_KEY } from "../../../../packages/shared/types.ts";
import type {
  SqsJobPayloadByType,
  SupportedSqsJobType,
} from "../../../../packages/shared/types.ts";
import {
  buildFailedInspirationEnrichmentFields,
  buildInspirationEnrichmentFieldMetadata,
  buildProcessingInspirationEnrichmentFields,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED,
  INSPIRATION_ENRICHMENT_FIELD_STATUS_TIMEOUT,
  INSPIRATION_ENRICHMENT_FIELD_NAMES,
  INSPIRATION_ENRICHMENT_METADATA_FIELD_NAMES,
  type InspirationEnrichmentFieldName,
  type InspirationEnrichmentFields,
} from "../inspirations/enrichment-field-metadata.ts";
import {
  buildInspirationEnrichmentResumeState,
  type InspirationEnrichmentResumeCapture,
  type InspirationEnrichmentCompletedOutputs,
} from "../inspirations/enrichment-resume-state.ts";
import { resolveInspirationEnrichmentExecutionPlan } from "../inspirations/enrichment-selective-execution.ts";
import {
  INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
  INSPIRATION_ENRICHMENT_STATUS_COMPLETED,
  INSPIRATION_ENRICHMENT_STATUS_FAILED,
} from "../inspirations/enrichment-pipeline.ts";
import {
  InspirationAiFieldGenerationTimeoutError,
  resolveInspirationAiFieldGenerationRetryPolicy,
} from "./inspiration-ai-field-generation-policy.ts";
import type {
  InspirationEmbeddingPersistenceClient,
  InspirationEmbeddingRecord,
  InspirationEmbeddingSourceExpansionRecord,
} from "./inspiration-embedding-persistence.ts";
import {
  findInspirationForEmbedding,
  markInspirationEnrichmentAttemptStarted,
  persistInspirationEnrichment,
  serializeInspirationEnrichmentError,
} from "./inspiration-embedding-persistence.ts";
import {
  classifyInspirationJobFailureRetryability,
  isInspirationJobFailureTerminal,
} from "./inspiration-job-failure.ts";
import {
  createInspirationQueueRecordProcessingRequest,
  resolveInspirationQueueAttemptCount,
  type InspirationQueueRecord,
  type InspirationQueueRecordProcessingRequest,
} from "./inspiration-queue.ts";
import {
  buildConnectionAnalysisJobPayload,
  type ConnectionAnalysisJobPublisher,
} from "./inspiration-connection-analysis-job.ts";
import {
  buildClusterRebuildJobPayload,
  countClusterableInspirations,
  DEFAULT_CLUSTER_REBUILD_TRIGGER_EVERY,
  shouldTriggerClusterRebuild,
  type ClusterRebuildJobPublisher,
  type ClusterRebuildTriggerPersistenceClient,
} from "./inspiration-cluster-rebuild-job.ts";
import { buildAiConversationSourceReference } from "../import/ai-conversation.ts";
import { buildAiConversationSummaryPromptContent } from "../import/ai-conversation-summary.ts";
import {
  createUrlImportExtractor,
  isPureUrlImportCapture,
  type UrlImportExtractor,
} from "../import/url-import.ts";

const SUPPORTED_INSPIRATION_QUEUE_MESSAGE_JOB_TYPES = [
  "ai_enrichment",
  "reflection_reembedding",
] as const;

type SupportedInspirationQueueMessageJobType =
  (typeof SUPPORTED_INSPIRATION_QUEUE_MESSAGE_JOB_TYPES)[number];

export type InspirationQueueMessageBody =
  SqsJobPayloadByType<SupportedInspirationQueueMessageJobType>;

export interface InspirationEmbeddingClient {
  generateEmbedding(
    request: GenerateEmbeddingRequest,
  ): Promise<GenerateEmbeddingResponse>;
}

export interface InspirationNonEmbeddingClient {
  classify(request: ClassifyRequest): Promise<ClassifyResponse>;
  summarize(request: SummarizeRequest): Promise<SummarizeResponse>;
  generateReflection(
    request: GenerateReflectionRequest,
  ): Promise<GenerateReflectionResponse>;
  generateTitle(request: GenerateTitleRequest): Promise<GenerateTitleResponse>;
  classifyMetadata(
    request: ClassifyMetadataRequest,
  ): Promise<ClassifyMetadataResponse>;
}

export interface ProcessInspirationQueueMessageOptions<
  TRecord extends InspirationEmbeddingRecord = InspirationEmbeddingRecord,
> {
  allowedRuntimeMs?: number;
  clusterRebuildJobPublisher?: ClusterRebuildJobPublisher;
  clusterRebuildPersistenceClient?: ClusterRebuildTriggerPersistenceClient;
  clusterRebuildTriggerEvery?: number;
  connectionAnalysisJobPublisher?: ConnectionAnalysisJobPublisher;
  connectionSimilarityThreshold?: number;
  connectionSimilarityTopK?: number;
  embeddingClient?: InspirationEmbeddingClient;
  env?: NodeJS.ProcessEnv;
  nonEmbeddingClient?: InspirationNonEmbeddingClient;
  now?: () => Date;
  persistenceClient?: InspirationEmbeddingPersistenceClient<TRecord>;
  urlImportExtractor?: UrlImportExtractor;
}

let defaultInspirationEmbeddingPersistenceClient:
  | InspirationEmbeddingPersistenceClient
  | null = null;

const EMBEDDING_RETRY_POLICY =
  resolveInspirationAiFieldGenerationRetryPolicy("embedding");
const SUMMARY_RETRY_POLICY =
  resolveInspirationAiFieldGenerationRetryPolicy("summary");
const METADATA_RETRY_POLICY =
  resolveInspirationAiFieldGenerationRetryPolicy("metadata");
const TITLE_RETRY_POLICY =
  resolveInspirationAiFieldGenerationRetryPolicy("title");
const PROCESS_INSPIRATION_CLUSTER_REBUILD_DEPENDENCIES_MISSING_ERROR =
  "A cluster rebuild persistence client with inspiration.count must be configured when cluster rebuild publishing is enabled.";

const TITLE_FIELD_NAMES = TITLE_RETRY_POLICY.fieldNames;
const EMBEDDING_FIELD_NAMES = EMBEDDING_RETRY_POLICY.fieldNames;
const SUMMARY_FIELD_NAMES = SUMMARY_RETRY_POLICY.fieldNames;
const DEFAULT_INSPIRATION_AI_FIELD_GENERATION_ALLOWED_RUNTIME_MS = 55_000;
const REFLECTION_CLASSIFICATION_LABELS = [
  "PROMPTED",
  "NOT_NEEDED",
] as const;
const TERMINAL_REFLECTION_STATUSES = [
  "PROMPTED",
  "ANSWERED",
  "SKIPPED",
  "NOT_NEEDED",
] as const;

type PendingTrackedInspirationAiFieldGenerationJobResult = {
  status: "pending";
};

type TrackedInspirationAiFieldGenerationJobResult<TResult> =
  | PendingTrackedInspirationAiFieldGenerationJobResult
  | PromiseSettledResult<TResult>;

interface TrackedInspirationAiFieldGenerationJob<TResult> {
  completion: Promise<void>;
  fieldNames: readonly InspirationEnrichmentFieldName[];
  result: TrackedInspirationAiFieldGenerationJobResult<TResult>;
}

type AsyncReflectionStatus =
  (typeof REFLECTION_CLASSIFICATION_LABELS)[number];

interface AsyncReflectionResolution {
  reflectionPrompt: string | null;
  reflectionStatus: AsyncReflectionStatus;
}

function readRequiredMessageString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }

  return value.trim();
}

function readOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length > 0 ? normalizedValue : undefined;
}

function readReflectionStatus(
  value: unknown,
  label: string,
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalizedValue = readRequiredMessageString(value, label);

  switch (normalizedValue) {
    case "PENDING":
    case "PROMPTED":
    case "ANSWERED":
    case "SKIPPED":
    case "NOT_NEEDED":
      return normalizedValue;
    default:
      throw new TypeError(`${label} must be a valid reflection status.`);
  }
}

function normalizeReflectionClassification(
  classification: string,
): AsyncReflectionStatus {
  const normalizedClassification = classification.trim().toUpperCase();

  switch (normalizedClassification) {
    case "PROMPTED":
    case "NOT_NEEDED":
      return normalizedClassification;
    default:
      throw new TypeError(
        `Reflection classification must resolve to one of: ${REFLECTION_CLASSIFICATION_LABELS.join(", ")}.`,
      );
  }
}

function buildReflectionClassificationPrompt(
  content: string,
  sourceType?: string | null,
): string {
  return [
    "Classify whether this saved inspiration should surface a post-save reflection prompt.",
    `Return exactly one label: ${REFLECTION_CLASSIFICATION_LABELS.join(" or ")}.`,
    "Choose PROMPTED for complex, nuanced, emotionally charged, interpretive, or insight-dense captures that would benefit from deeper thinking.",
    "Choose NOT_NEEDED for simple saves, quick references, bare links, single words, straightforward reminders, or factual snippets.",
    `Source type: ${readOptionalTrimmedString(sourceType) ?? "UNKNOWN"}`,
    "Captured content:",
    content,
  ].join("\n");
}

function shouldResolveAsyncReflection(
  inspiration: InspirationEmbeddingRecord,
  message: InspirationQueueMessageBody,
): boolean {
  if (message.jobType !== "ai_enrichment") {
    return false;
  }

  if (inspiration.sourceType === "PHOTO" || inspiration.sourceType === "URL_IMPORT") {
    return false;
  }

  const reflectionStatus = readReflectionStatus(
    inspiration.reflectionStatus,
    `Inspiration ${inspiration.id} reflectionStatus`,
  );

  return (
    reflectionStatus === undefined ||
    !TERMINAL_REFLECTION_STATUSES.includes(
      reflectionStatus as (typeof TERMINAL_REFLECTION_STATUSES)[number],
    )
  );
}

async function resolveAsyncReflection(
  inspiration: InspirationEmbeddingRecord,
  content: string,
  nonEmbeddingClient: InspirationNonEmbeddingClient,
  requestId: string,
  traceId: string,
  timeoutMs: number,
  generation: ReturnType<typeof createDeterministicGenerationOptions>,
): Promise<AsyncReflectionResolution | null> {
  if (content.trim().length === 0) {
    return null;
  }

  const classification = await nonEmbeddingClient.classify({
    maxRetries: METADATA_RETRY_POLICY.providerMaxRetries,
    operation: "classify",
    requestId,
    timeoutMs,
    traceId,
    generation,
    input: {
      labels: REFLECTION_CLASSIFICATION_LABELS,
      model: "text",
      prompt: buildReflectionClassificationPrompt(content, inspiration.sourceType),
    },
  });

  const reflectionStatus = normalizeReflectionClassification(
    classification.output.classification,
  );

  if (reflectionStatus === "NOT_NEEDED") {
    return {
      reflectionPrompt: null,
      reflectionStatus,
    };
  }

  const reflection = await nonEmbeddingClient.generateReflection({
    maxRetries: TITLE_RETRY_POLICY.providerMaxRetries,
    operation: "generateReflection",
    requestId,
    timeoutMs,
    traceId,
    generation,
    input: {
      content,
      groundingContext: buildReflectionGroundingContext(content),
      model: "text",
    },
  });

  return {
    reflectionPrompt: readRequiredMessageString(
      reflection.output.reflectionPrompt,
      `Inspiration ${inspiration.id} reflectionPrompt`,
    ),
    reflectionStatus,
  };
}

function resolvePersistenceClient<
  TRecord extends InspirationEmbeddingRecord = InspirationEmbeddingRecord,
>(
  override?: InspirationEmbeddingPersistenceClient<TRecord>,
): InspirationEmbeddingPersistenceClient<TRecord> {
  if (override) {
    return override;
  }

  if (defaultInspirationEmbeddingPersistenceClient) {
    return defaultInspirationEmbeddingPersistenceClient as InspirationEmbeddingPersistenceClient<TRecord>;
  }

  throw new Error(
    "An inspiration embedding persistence client must be configured before processing inspiration jobs.",
  );
}

function resolveEmbeddingInputText(
  inspiration: InspirationEmbeddingRecord,
): string {
  return readRequiredMessageString(
    inspiration.rawContent,
    `Inspiration ${inspiration.id} rawContent`,
  );
}

function normalizeSourceExpansionInputTexts(
  inspiration: InspirationEmbeddingRecord,
): string[] {
  if (
    inspiration.sourceExpansions === undefined ||
    inspiration.sourceExpansions === null
  ) {
    return [];
  }

  if (!Array.isArray(inspiration.sourceExpansions)) {
    throw new TypeError(
      `Inspiration ${inspiration.id} sourceExpansions must be an array when provided.`,
    );
  }

  return inspiration.sourceExpansions.map(
    (
      sourceExpansion: InspirationEmbeddingSourceExpansionRecord,
      sourceExpansionIndex,
    ) =>
      readRequiredMessageString(
        sourceExpansion.rawContent,
        `Inspiration ${inspiration.id} sourceExpansion ${sourceExpansionIndex} rawContent`,
      ),
  );
}

function resolveReflectionAnswerInputText(
  inspiration: InspirationEmbeddingRecord,
): string | undefined {
  return readOptionalTrimmedString(inspiration.reflectionAnswer);
}

function resolvePersistableSourceConversationReference(
  inspiration: InspirationEmbeddingRecord,
  capture: InspirationEnrichmentResumeCapture,
): string | undefined {
  if (
    typeof inspiration.sourceConversationRef === "string" &&
    inspiration.sourceConversationRef.trim().length > 0
  ) {
    return inspiration.sourceConversationRef;
  }

  if (capture.sourceMeta === null) {
    return undefined;
  }

  return buildAiConversationSourceReference(
    capture.sourceMeta,
    capture.sourceUrl ?? undefined,
  );
}

function resolveInspirationProcessingContent(
  inspiration: InspirationEmbeddingRecord,
  options: {
    includeSourceExpansions?: boolean;
  } = {},
): string {
  const parentInputText = resolveEmbeddingInputText(inspiration);
  const reflectionAnswerInputText =
    resolveReflectionAnswerInputText(inspiration);

  if (!options.includeSourceExpansions) {
    return reflectionAnswerInputText === undefined
      ? parentInputText
      : [parentInputText, reflectionAnswerInputText].join("\n\n");
  }

  const sourceExpansionInputTexts = normalizeSourceExpansionInputTexts(
    inspiration,
  );

  return [
    parentInputText,
    ...sourceExpansionInputTexts,
    ...(reflectionAnswerInputText === undefined
      ? []
      : [reflectionAnswerInputText]),
  ].join("\n\n");
}

function shouldEnqueueConnectionAnalysis(
  message: InspirationQueueMessageBody,
  completedOutputs: InspirationEnrichmentCompletedOutputs,
  publisher?: ConnectionAnalysisJobPublisher,
): boolean {
  return (
    publisher !== undefined &&
    message.jobType === "ai_enrichment" &&
    (message.fieldNames === undefined || message.fieldNames.includes("embedding")) &&
    Array.isArray(completedOutputs.embedding) &&
    completedOutputs.embedding.length > 0
  );
}

async function enqueueConnectionAnalysisJob(
  inspiration: InspirationEmbeddingRecord,
  message: InspirationQueueMessageBody,
  completedOutputs: InspirationEnrichmentCompletedOutputs,
  options: ProcessInspirationQueueMessageOptions,
): Promise<void> {
  const publisher = options.connectionAnalysisJobPublisher;

  if (
    publisher === undefined ||
    !shouldEnqueueConnectionAnalysis(message, completedOutputs, publisher)
  ) {
    return;
  }

  await publisher.enqueue(
    buildConnectionAnalysisJobPayload({
      inspirationId: inspiration.id,
      maxConnections: options.connectionSimilarityTopK,
      similarityThreshold: options.connectionSimilarityThreshold,
      userId: readRequiredMessageString(
        inspiration.userId ?? "",
        `Inspiration ${inspiration.id} userId`,
      ),
    }),
  );
}

function didPersistNewEmbedding(
  inspiration: InspirationEmbeddingRecord,
  message: InspirationQueueMessageBody,
  completedOutputs: InspirationEnrichmentCompletedOutputs,
): boolean {
  return (
    message.jobType === "ai_enrichment" &&
    inspiration.embedding == null &&
    (message.fieldNames === undefined || message.fieldNames.includes("embedding")) &&
    Array.isArray(completedOutputs.embedding) &&
    completedOutputs.embedding.length > 0
  );
}

function resolveClusterRebuildPersistenceClient(
  options: ProcessInspirationQueueMessageOptions,
  persistenceClient: InspirationEmbeddingPersistenceClient,
): ClusterRebuildTriggerPersistenceClient | undefined {
  if (options.clusterRebuildPersistenceClient) {
    return options.clusterRebuildPersistenceClient;
  }

  if (!options.clusterRebuildJobPublisher) {
    return undefined;
  }

  const candidate = persistenceClient as InspirationEmbeddingPersistenceClient &
    Partial<ClusterRebuildTriggerPersistenceClient>;

  if (typeof candidate.inspiration?.count === "function") {
    return candidate as ClusterRebuildTriggerPersistenceClient;
  }

  throw new Error(PROCESS_INSPIRATION_CLUSTER_REBUILD_DEPENDENCIES_MISSING_ERROR);
}

async function enqueueClusterRebuildJob(
  inspiration: InspirationEmbeddingRecord,
  message: InspirationQueueMessageBody,
  completedOutputs: InspirationEnrichmentCompletedOutputs,
  persistenceClient: InspirationEmbeddingPersistenceClient,
  options: ProcessInspirationQueueMessageOptions,
): Promise<void> {
  const publisher = options.clusterRebuildJobPublisher;

  if (
    publisher === undefined ||
    !didPersistNewEmbedding(inspiration, message, completedOutputs)
  ) {
    return;
  }

  const clusterRebuildPersistenceClient =
    resolveClusterRebuildPersistenceClient(options, persistenceClient);

  if (clusterRebuildPersistenceClient === undefined) {
    return;
  }

  const userId = readRequiredMessageString(
    inspiration.userId ?? "",
    `Inspiration ${inspiration.id} userId`,
  );
  const clusterableInspirationCount = await countClusterableInspirations(
    clusterRebuildPersistenceClient,
    userId,
  );

  if (
    !shouldTriggerClusterRebuild(
      clusterableInspirationCount,
      options.clusterRebuildTriggerEvery ??
        DEFAULT_CLUSTER_REBUILD_TRIGGER_EVERY,
    )
  ) {
    return;
  }

  await publisher.enqueue(
    buildClusterRebuildJobPayload({
      triggerInspirationId: inspiration.id,
      userId,
    }),
  );
}

function readCompletedSummaryOutput(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function resolveFieldNamesToProcessWithFocusedSummaryDependency(
  fieldNamesToProcess: readonly InspirationEnrichmentFieldName[],
  completedOutputs: InspirationEnrichmentCompletedOutputs,
  usesFocusedSummaryEmbedding: boolean,
): InspirationEnrichmentFieldName[] {
  if (
    !usesFocusedSummaryEmbedding ||
    !fieldNamesToProcess.includes("embedding") ||
    fieldNamesToProcess.includes("summary") ||
    readCompletedSummaryOutput(completedOutputs.summary) !== undefined
  ) {
    return [...fieldNamesToProcess];
  }

  const dependentFieldNames = new Set<InspirationEnrichmentFieldName>(
    fieldNamesToProcess,
  );
  dependentFieldNames.add("summary");

  return INSPIRATION_ENRICHMENT_FIELD_NAMES.filter((fieldName) =>
    dependentFieldNames.has(fieldName),
  );
}

function resolveNonEmbeddingClient(
  override: InspirationNonEmbeddingClient | undefined,
  env: NodeJS.ProcessEnv & LLMRuntimeEnvironment,
): InspirationNonEmbeddingClient {
  if (override) {
    return override;
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

function createDeterministicGenerationOptions() {
  return {
    seed: 0,
    temperature: 0,
  } as const;
}

function readPositiveInteger(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : undefined;
}

function resolveInspirationAiFieldGenerationAllowedRuntimeMs(
  env: NodeJS.ProcessEnv,
  override?: number,
): number {
  const overrideRuntimeMs = readPositiveInteger(override);

  if (overrideRuntimeMs !== undefined) {
    return overrideRuntimeMs;
  }

  const envRuntimeMs = Number.parseInt(
    env[INSPIRATION_PROCESSOR_ALLOWED_RUNTIME_MS_ENVIRONMENT_KEY] ?? "",
    10,
  );

  return (
    readPositiveInteger(envRuntimeMs) ??
    DEFAULT_INSPIRATION_AI_FIELD_GENERATION_ALLOWED_RUNTIME_MS
  );
}

function createTrackedInspirationAiFieldGenerationJob<TResult>(
  fieldNames: readonly InspirationEnrichmentFieldName[],
  execute: () => Promise<TResult>,
): TrackedInspirationAiFieldGenerationJob<TResult> {
  const job: TrackedInspirationAiFieldGenerationJob<TResult> = {
    completion: Promise.resolve(),
    fieldNames,
    result: {
      status: "pending",
    },
  };

  job.completion = Promise.resolve()
    .then(execute)
    .then(
      (value) => {
        job.result = {
          status: "fulfilled",
          value,
        };
      },
      (reason) => {
        job.result = {
          reason,
          status: "rejected",
        };
      },
    );

  return job;
}

async function waitForTrackedInspirationAiFieldGenerationJobs(
  jobs: readonly TrackedInspirationAiFieldGenerationJob<unknown>[],
  allowedRuntimeMs: number,
): Promise<boolean> {
  if (jobs.length === 0) {
    return false;
  }

  const allJobsCompleted = Promise.all(jobs.map((job) => job.completion)).then(
    () => false,
  );
  let timeoutHandle: NodeJS.Timeout | undefined;

  const timedOut = await Promise.race([
    allJobsCompleted,
    new Promise<boolean>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(true), allowedRuntimeMs);
    }),
  ]);

  if (timeoutHandle) {
    clearTimeout(timeoutHandle);
  }

  return timedOut;
}

function resolveTimedOutInspirationAiFieldNames(
  jobs: readonly TrackedInspirationAiFieldGenerationJob<unknown>[],
): InspirationEnrichmentFieldName[] {
  const pendingFieldNames = new Set<InspirationEnrichmentFieldName>();

  for (const job of jobs) {
    if (job.result.status !== "pending") {
      continue;
    }

    for (const fieldName of job.fieldNames) {
      pendingFieldNames.add(fieldName);
    }
  }

  return INSPIRATION_ENRICHMENT_FIELD_NAMES.filter((fieldName) =>
    pendingFieldNames.has(fieldName),
  );
}

function resolveTrackedInspirationAiFieldGenerationJobResult<TResult>(
  job: TrackedInspirationAiFieldGenerationJob<TResult>,
  timeoutError: InspirationAiFieldGenerationTimeoutError | null,
): PromiseSettledResult<TResult> {
  if (job.result.status === "pending") {
    if (!timeoutError) {
      throw new Error(
        `AI field generation result for ${job.fieldNames.join(", ")} remained pending without a timeout.`,
      );
    }

    return {
      reason: timeoutError,
      status: "rejected",
    };
  }

  return job.result;
}

function isSupportedInspirationQueueMessageJobType(
  value: SupportedSqsJobType,
): value is SupportedInspirationQueueMessageJobType {
  return SUPPORTED_INSPIRATION_QUEUE_MESSAGE_JOB_TYPES.includes(
    value as SupportedInspirationQueueMessageJobType,
  );
}

function createUnsupportedInspirationQueueMessageJobTypeError(
  jobType: SupportedSqsJobType,
): TypeError {
  return new TypeError(
    `Inspiration queue processor only supports ${SUPPORTED_INSPIRATION_QUEUE_MESSAGE_JOB_TYPES.join(" or ")} jobs; received ${jobType}.`,
  );
}

function buildPersistableInspirationEnrichmentOutputs(
  outputs: InspirationEnrichmentCompletedOutputs,
) {
  return {
    ...(outputs.actionability === undefined
      ? {}
      : {
          actionability: outputs.actionability,
        }),
    ...(outputs.domain === undefined
      ? {}
      : {
          domain: outputs.domain,
        }),
    ...(outputs.embedding === undefined
      ? {}
      : {
          embedding: outputs.embedding,
        }),
    ...(outputs.mood === undefined
      ? {}
      : {
          mood: outputs.mood,
        }),
    ...(outputs.summary === undefined
      ? {}
      : {
          summary: outputs.summary,
        }),
    ...(outputs.tags === undefined
      ? {}
      : {
          tags: outputs.tags,
        }),
    ...(outputs.title === undefined
      ? {}
      : {
          title: outputs.title,
        }),
  };
}

function resolveCompletedFieldNamesFromEnrichmentFields(
  enrichmentFields: InspirationEnrichmentFields,
): InspirationEnrichmentFieldName[] {
  return INSPIRATION_ENRICHMENT_FIELD_NAMES.filter(
    (fieldName) =>
      enrichmentFields[fieldName].status ===
      INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  );
}

function resolveRemainingFieldNamesFromEnrichmentFields(
  enrichmentFields: InspirationEnrichmentFields,
): InspirationEnrichmentFieldName[] {
  return INSPIRATION_ENRICHMENT_FIELD_NAMES.filter(
    (fieldName) =>
      enrichmentFields[fieldName].status !==
      INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
  );
}

function shouldRunTrackedJob(
  remainingFieldNames: readonly InspirationEnrichmentFieldName[],
  fieldNames: readonly InspirationEnrichmentFieldName[],
): boolean {
  const remainingFieldNameSet = new Set(remainingFieldNames);

  return fieldNames.some((fieldName) => remainingFieldNameSet.has(fieldName));
}

async function resolvePureUrlImportProcessingContent(
  inspiration: InspirationEmbeddingRecord,
  rawContent: string,
  extractor: UrlImportExtractor,
): Promise<
  | {
      content: string;
      sourceMeta?: Record<string, unknown>;
      title?: string;
    }
  | null
> {
  if (
    inspiration.sourceType !== "URL_IMPORT" ||
    typeof inspiration.sourceUrl !== "string" ||
    !isPureUrlImportCapture(rawContent, inspiration.sourceUrl)
  ) {
    return null;
  }

  const extractedImport = await extractor.extract({
    rawContent,
    sourceUrl: inspiration.sourceUrl,
  });
  const content = readRequiredMessageString(
    extractedImport.content,
    `URL import ${inspiration.id} extracted content`,
  );
  const sourceMeta =
    extractedImport.sourceMeta &&
    typeof extractedImport.sourceMeta === "object" &&
    !Array.isArray(extractedImport.sourceMeta)
      ? extractedImport.sourceMeta
      : undefined;
  const title = readOptionalTrimmedString(extractedImport.title);

  return {
    content,
    ...(sourceMeta === undefined ? {} : { sourceMeta }),
    ...(title === undefined ? {} : { title }),
  };
}

export function configureInspirationEmbeddingPersistenceClient(
  client: InspirationEmbeddingPersistenceClient | null,
): void {
  defaultInspirationEmbeddingPersistenceClient = client;
}

export function parseInspirationQueueMessageBody(
  body: string,
): InspirationQueueMessageBody {
  let payload: unknown;

  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new TypeError(
      `Inspiration queue body must be valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (typeof payload !== "object" || payload === null) {
    throw new TypeError("Inspiration queue body must be a JSON object.");
  }

  const record = payload as Record<string, unknown>;

  if (record.jobType === undefined) {
    return parseSqsJobPayload("ai_enrichment", record);
  }

  const jobType = parseSupportedSqsJobType(
    record.jobType,
    "Inspiration queue body jobType",
  );

  if (!isSupportedInspirationQueueMessageJobType(jobType)) {
    throw createUnsupportedInspirationQueueMessageJobTypeError(jobType);
  }

  return parseSqsJobPayload(jobType, record);
}

function resolveInspirationEnrichmentMessage(
  request: InspirationQueueRecordProcessingRequest,
): InspirationQueueMessageBody {
  if (request.jobType !== undefined) {
    if (!isSupportedInspirationQueueMessageJobType(request.jobType)) {
      throw createUnsupportedInspirationQueueMessageJobTypeError(request.jobType);
    }

    if (request.payload) {
      return parseSqsJobPayload(request.jobType, request.payload);
    }
  }

  return parseInspirationQueueMessageBody(request.body);
}

function normalizeInspirationQueueRecordProcessingRequest(
  request: InspirationQueueRecordProcessingRequest | InspirationQueueRecord,
): InspirationQueueRecordProcessingRequest {
  if ("record" in request) {
    return request;
  }

  return createInspirationQueueRecordProcessingRequest(request);
}

export async function processInspirationQueueMessage(
  request: InspirationQueueRecordProcessingRequest | InspirationQueueRecord,
  options: ProcessInspirationQueueMessageOptions = {},
): Promise<void> {
  const processingRequest =
    normalizeInspirationQueueRecordProcessingRequest(request);
  const message = resolveInspirationEnrichmentMessage(processingRequest);
  const persistenceClient = resolvePersistenceClient(options.persistenceClient);
  const now = options.now ?? (() => new Date());
  const env = options.env ?? process.env;
  const inspiration = await findInspirationForEmbedding(
    persistenceClient,
    message.inspirationId,
  );

  if (!inspiration) {
    throw new Error(
      `Inspiration ${message.inspirationId} was not found for embedding generation.`,
    );
  }

  const retryPlan = resolveInspirationEnrichmentExecutionPlan(inspiration, {
    forceFullReprocessing: message.jobType === "reflection_reembedding",
    requestedFieldNames:
      message.jobType === "ai_enrichment" ? message.fieldNames : undefined,
  });
  const focusedSummaryPromptContent = buildAiConversationSummaryPromptContent({
    rawContent: retryPlan.capture.rawContent,
    sourceMeta: retryPlan.capture.sourceMeta,
  });
  const usesFocusedSummaryEmbedding = focusedSummaryPromptContent !== undefined;
  const fieldNamesToProcess =
    resolveFieldNamesToProcessWithFocusedSummaryDependency(
      retryPlan.fieldNamesToProcess,
      retryPlan.completedOutputs,
      usesFocusedSummaryEmbedding,
    );
  const attemptCount = resolveInspirationQueueAttemptCount(processingRequest);
  const startedAt = now();
  const initialProcessingEnrichmentFields =
    buildProcessingInspirationEnrichmentFields(startedAt, {
      attemptCount,
      completedFieldNames: retryPlan.completedFieldNames,
      existingFields: retryPlan.existingFields,
      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      processingFieldNames: fieldNamesToProcess,
    });

  await markInspirationEnrichmentAttemptStarted(
    persistenceClient,
    inspiration.id,
    startedAt,
    {
      attemptCount,
      completedFieldNames: retryPlan.completedFieldNames,
      enrichmentFields: initialProcessingEnrichmentFields,
      processingFieldNames: fieldNamesToProcess,
      enrichmentResumeState: retryPlan.resumeState ?? null,
    },
  );

  const persistInputBase = {
    expectedRawContent: retryPlan.capture.rawContent,
    ignoreIfSourceCaptureChanged: true,
    inspirationId: inspiration.id,
    sourceConversationRef: resolvePersistableSourceConversationReference(
      inspiration,
      retryPlan.capture,
    ),
  };
  let extractedUrlImportRawContent: string | undefined;
  let extractedUrlImportSourceMeta: Record<string, unknown> | undefined;
  let resolvedAsyncReflection: AsyncReflectionResolution | null = null;

  const persistFailure = async (
    error: unknown,
    occurredAt: Date,
    completedOutputs: InspirationEnrichmentCompletedOutputs,
    enrichmentFields?: InspirationEnrichmentFields,
  ): Promise<boolean> => {
    const serializedFailure = serializeInspirationEnrichmentError(
      error,
      occurredAt,
      {
        attemptCount,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      },
    );
    const failureFields =
      enrichmentFields ??
      buildFailedInspirationEnrichmentFields({
        attemptCount,
        completedFieldNames: retryPlan.completedFieldNames,
        existingFields: retryPlan.existingFields,
        failedFieldNames: fieldNamesToProcess,
        failedAt: occurredAt,
        lastError: serializedFailure,
        lastFailureReason:
          serializedFailure.reason ?? serializedFailure.message,
        lastFailureRetryability: serializedFailure.retryability,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        startedAt,
      });
    const failureResumeState = buildInspirationEnrichmentResumeState({
      capture: retryPlan.capture,
      completedFieldNames:
        enrichmentFields === undefined
          ? retryPlan.completedFieldNames
          : resolveCompletedFieldNamesFromEnrichmentFields(enrichmentFields),
      completedOutputs,
      remainingFieldNames:
        enrichmentFields === undefined
          ? retryPlan.remainingFieldNames
          : resolveRemainingFieldNamesFromEnrichmentFields(enrichmentFields),
      updatedAt: occurredAt,
    });

    try {
      const persistedFailure = await persistInspirationEnrichment(
        persistenceClient,
        {
          ...persistInputBase,
          ...buildPersistableInspirationEnrichmentOutputs(completedOutputs),
          ...(extractedUrlImportRawContent === undefined
            ? {}
            : { rawContent: extractedUrlImportRawContent }),
          ...(resolvedAsyncReflection === null
            ? {}
            : {
                reflectionPrompt: resolvedAsyncReflection.reflectionPrompt,
                reflectionStatus: resolvedAsyncReflection.reflectionStatus,
              }),
          ...(extractedUrlImportSourceMeta === undefined
            ? {}
            : { sourceMeta: extractedUrlImportSourceMeta }),
          enrichmentFields: failureFields,
          enrichmentLastError: serializedFailure,
          enrichmentLastFailureReason:
            serializedFailure.reason ?? serializedFailure.message,
          enrichmentLastFailureRetryability:
            serializedFailure.retryability,
          enrichmentResumeState: failureResumeState,
          enrichmentStatus: INSPIRATION_ENRICHMENT_STATUS_FAILED,
        },
      );

      if (!persistedFailure) {
        return false;
      }
    } catch (persistenceError) {
      throw new AggregateError(
        [error, persistenceError],
        `Inspiration ${inspiration.id} failed enrichment and the failure state could not be persisted.`,
      );
    }

    return true;
  };

  let embeddingClient: InspirationEmbeddingClient;
  let nonEmbeddingClient: InspirationNonEmbeddingClient;
  let requestId: string;
  let traceId: string;
  let generation: ReturnType<typeof createDeterministicGenerationOptions>;
  let content: string;
  let summaryRequestContent: string;
  let extractedUrlImportTitle: string | undefined;
  let hasPrefilledUrlImportTitle = false;
  let reflectionResolutionPromise: Promise<AsyncReflectionResolution | null> | null =
    null;
  const allowedRuntimeMs = resolveInspirationAiFieldGenerationAllowedRuntimeMs(
    env,
    options.allowedRuntimeMs,
  );

  try {
    embeddingClient =
      options.embeddingClient ??
      createEmbeddingClientFromEnv(env);
    nonEmbeddingClient = resolveNonEmbeddingClient(
      options.nonEmbeddingClient,
      env,
    );
    requestId = processingRequest.metadata.messageId;
    traceId = message.inspirationId;
    generation = createDeterministicGenerationOptions();
    const extractedUrlImport = await resolvePureUrlImportProcessingContent(
      inspiration,
      retryPlan.capture.rawContent,
      options.urlImportExtractor ?? createUrlImportExtractor(),
    );
    extractedUrlImportRawContent = extractedUrlImport?.content;
    extractedUrlImportSourceMeta = extractedUrlImport?.sourceMeta;
    extractedUrlImportTitle = extractedUrlImport?.title;
    hasPrefilledUrlImportTitle =
      readOptionalTrimmedString(retryPlan.completedOutputs.title) === undefined &&
      extractedUrlImportTitle !== undefined;
    content =
      extractedUrlImportRawContent ??
      resolveInspirationProcessingContent(
        {
          ...inspiration,
          rawContent: retryPlan.capture.rawContent,
        },
        {
          includeSourceExpansions: message.jobType === "reflection_reembedding",
        },
      );
    summaryRequestContent = focusedSummaryPromptContent ?? content;
    reflectionResolutionPromise = shouldResolveAsyncReflection(
      inspiration,
      message,
    )
      ? resolveAsyncReflection(
          inspiration,
          content,
          nonEmbeddingClient,
          requestId,
          traceId,
          allowedRuntimeMs,
          generation,
        )
      : null;
  } catch (error) {
    if (!(await persistFailure(error, now(), retryPlan.completedOutputs))) {
      return;
    }
    throw error;
  }

  const persistedSummaryOutput = readCompletedSummaryOutput(
    retryPlan.completedOutputs.summary,
  );
  const summaryJob = shouldRunTrackedJob(
    fieldNamesToProcess,
    SUMMARY_FIELD_NAMES,
  )
    ? createTrackedInspirationAiFieldGenerationJob(SUMMARY_FIELD_NAMES, () =>
        nonEmbeddingClient.summarize({
          maxRetries: SUMMARY_RETRY_POLICY.providerMaxRetries,
          operation: "summarize",
          requestId,
          timeoutMs: allowedRuntimeMs,
          traceId,
          generation,
          input: {
            content: summaryRequestContent,
            model: "text",
          },
        }),
      )
    : null;
  const embeddingInputTextPromise = !usesFocusedSummaryEmbedding
    ? Promise.resolve(content)
    : summaryJob
      ? summaryJob.completion.then(() => {
          if (summaryJob.result.status === "fulfilled") {
            return summaryJob.result.value.output.summary;
          }

          if (summaryJob.result.status === "rejected") {
            throw summaryJob.result.reason;
          }

          throw new Error(
            `Focused summary generation for inspiration ${inspiration.id} did not resolve before embedding generation started.`,
          );
        })
      : persistedSummaryOutput !== undefined
        ? Promise.resolve(persistedSummaryOutput)
        : Promise.reject(
            new Error(
              `Focused summary output is required before embedding inspiration ${inspiration.id}.`,
            ),
          );
  const embeddingJob = shouldRunTrackedJob(
    fieldNamesToProcess,
    EMBEDDING_FIELD_NAMES,
  )
    ? createTrackedInspirationAiFieldGenerationJob(EMBEDDING_FIELD_NAMES, () =>
        embeddingInputTextPromise.then((embeddingText) =>
          embeddingClient.generateEmbedding({
            maxRetries: EMBEDDING_RETRY_POLICY.providerMaxRetries,
            operation: "generateEmbedding",
            requestId,
            timeoutMs: allowedRuntimeMs,
            traceId,
            input: {
              model: "embedding",
              text: embeddingText,
            },
          }),
        ),
      )
    : null;
  const metadataJob = shouldRunTrackedJob(
    fieldNamesToProcess,
    METADATA_RETRY_POLICY.fieldNames,
  )
    ? createTrackedInspirationAiFieldGenerationJob(
        METADATA_RETRY_POLICY.fieldNames,
        () =>
          nonEmbeddingClient.classifyMetadata({
            maxRetries: METADATA_RETRY_POLICY.providerMaxRetries,
            operation: "classifyMetadata",
            requestId,
            timeoutMs: allowedRuntimeMs,
            traceId,
            generation,
            input: {
              content,
              model: "text",
            },
          }),
      )
    : null;
  const titleJob = shouldRunTrackedJob(
    fieldNamesToProcess,
    TITLE_FIELD_NAMES,
  )
    && !hasPrefilledUrlImportTitle
    ? createTrackedInspirationAiFieldGenerationJob(TITLE_FIELD_NAMES, () =>
        nonEmbeddingClient.generateTitle({
          maxRetries: TITLE_RETRY_POLICY.providerMaxRetries,
          operation: "generateTitle",
          requestId,
          timeoutMs: allowedRuntimeMs,
          traceId,
          generation,
          input: {
            content,
            model: "text",
          },
        }),
      )
    : null;
  const trackedJobs = [
    ...(embeddingJob ? [embeddingJob] : []),
    ...(summaryJob ? [summaryJob] : []),
    ...(metadataJob ? [metadataJob] : []),
    ...(titleJob ? [titleJob] : []),
  ];
  const didTimeout = await waitForTrackedInspirationAiFieldGenerationJobs(
    trackedJobs,
    allowedRuntimeMs,
  );
  const settledAt = now();
  const timedOutFieldNames = didTimeout
    ? resolveTimedOutInspirationAiFieldNames(trackedJobs)
    : [];
  const timeoutError =
    timedOutFieldNames.length > 0
      ? new InspirationAiFieldGenerationTimeoutError(
          timedOutFieldNames,
          allowedRuntimeMs,
        )
      : null;
  const enrichmentFields = buildProcessingInspirationEnrichmentFields(
    startedAt,
    {
      attemptCount,
      completedFieldNames: retryPlan.completedFieldNames,
      existingFields: retryPlan.existingFields,
      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      processingFieldNames: fieldNamesToProcess,
    },
  );
  const completedOutputs: InspirationEnrichmentCompletedOutputs = {
    ...retryPlan.completedOutputs,
  };
  const failedResults: unknown[] = [];

  const markFieldsCompleted = (
    fieldNames: readonly InspirationEnrichmentFieldName[],
  ) => {
    for (const fieldName of fieldNames) {
      if (enrichmentFields[fieldName].status === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED) {
        continue;
      }

      enrichmentFields[fieldName] = buildInspirationEnrichmentFieldMetadata({
        attemptCount,
        completedAt: settledAt,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        startedAt,
        status: INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED,
      });
    }
  };

  const markFieldsFailed = (
    fieldNames: readonly InspirationEnrichmentFieldName[],
    error: unknown,
  ) => {
    const serializedError = serializeInspirationEnrichmentError(
      error,
      settledAt,
      {
        attemptCount,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      },
    );
    const failureStatus =
      error instanceof InspirationAiFieldGenerationTimeoutError &&
      !isInspirationJobFailureTerminal(error, {
        attemptCount,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      })
        ? INSPIRATION_ENRICHMENT_FIELD_STATUS_TIMEOUT
        : INSPIRATION_ENRICHMENT_FIELD_STATUS_FAILED;

    for (const fieldName of fieldNames) {
      if (enrichmentFields[fieldName].status === INSPIRATION_ENRICHMENT_FIELD_STATUS_COMPLETED) {
        continue;
      }

      enrichmentFields[fieldName] = buildInspirationEnrichmentFieldMetadata({
        attemptCount,
        failedAt: settledAt,
        lastError: serializedError,
        lastFailureReason:
          serializedError.reason ?? serializedError.message,
        lastFailureRetryability: serializedError.retryability,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
        startedAt,
        status: failureStatus,
      });
    }
    failedResults.push(error);
  };

  if (hasPrefilledUrlImportTitle && extractedUrlImportTitle !== undefined) {
    markFieldsCompleted(TITLE_FIELD_NAMES);
    completedOutputs.title = extractedUrlImportTitle;
  }

  if (embeddingJob) {
    const embeddingResult = resolveTrackedInspirationAiFieldGenerationJobResult(
      embeddingJob,
      timeoutError,
    );

    if (embeddingResult.status === "fulfilled") {
      markFieldsCompleted(EMBEDDING_FIELD_NAMES);
      completedOutputs.embedding = embeddingResult.value.output.embedding;
    } else {
      markFieldsFailed(EMBEDDING_FIELD_NAMES, embeddingResult.reason);
    }
  }

  if (summaryJob) {
    const summaryResult = resolveTrackedInspirationAiFieldGenerationJobResult(
      summaryJob,
      timeoutError,
    );

    if (summaryResult.status === "fulfilled") {
      markFieldsCompleted(SUMMARY_FIELD_NAMES);
      completedOutputs.summary = summaryResult.value.output.summary;
    } else {
      markFieldsFailed(SUMMARY_FIELD_NAMES, summaryResult.reason);
    }
  }

  if (metadataJob) {
    const metadataResult = resolveTrackedInspirationAiFieldGenerationJobResult(
      metadataJob,
      timeoutError,
    );

    if (metadataResult.status === "fulfilled") {
      markFieldsCompleted(INSPIRATION_ENRICHMENT_METADATA_FIELD_NAMES);
      completedOutputs.actionability = metadataResult.value.output.actionability;
      completedOutputs.domain = metadataResult.value.output.domain;
      completedOutputs.mood = metadataResult.value.output.mood;
      completedOutputs.tags = metadataResult.value.output.tags;
    } else {
      markFieldsFailed(
        INSPIRATION_ENRICHMENT_METADATA_FIELD_NAMES,
        metadataResult.reason,
      );
    }
  }

  if (titleJob) {
    const titleResult = resolveTrackedInspirationAiFieldGenerationJobResult(
      titleJob,
      timeoutError,
    );

    if (titleResult.status === "rejected") {
      markFieldsFailed(TITLE_FIELD_NAMES, titleResult.reason);
    } else {
      markFieldsCompleted(TITLE_FIELD_NAMES);
      completedOutputs.title = titleResult.value.output.title;
    }
  }

  if (reflectionResolutionPromise) {
    try {
      resolvedAsyncReflection = await reflectionResolutionPromise;
    } catch (error) {
      failedResults.push(error);
    }
  }

  const failure = timeoutError ?? failedResults[0];

  if (failure) {
    if (!(await persistFailure(failure, settledAt, completedOutputs, enrichmentFields))) {
      return;
    }
    throw failure;
  }

  const remainingFieldNames = resolveRemainingFieldNamesFromEnrichmentFields(
    enrichmentFields,
  );

  if (remainingFieldNames.length > 0) {
    await persistInspirationEnrichment(persistenceClient, {
      ...persistInputBase,
      ...buildPersistableInspirationEnrichmentOutputs(completedOutputs),
      ...(extractedUrlImportRawContent === undefined
        ? {}
        : { rawContent: extractedUrlImportRawContent }),
      ...(resolvedAsyncReflection === null
        ? {}
        : {
            reflectionPrompt: resolvedAsyncReflection.reflectionPrompt,
            reflectionStatus: resolvedAsyncReflection.reflectionStatus,
          }),
      ...(extractedUrlImportSourceMeta === undefined
        ? {}
        : { sourceMeta: extractedUrlImportSourceMeta }),
      enrichmentFields,
      enrichmentResumeState: buildInspirationEnrichmentResumeState({
        capture: retryPlan.capture,
        completedFieldNames:
          resolveCompletedFieldNamesFromEnrichmentFields(enrichmentFields),
        completedOutputs,
        remainingFieldNames,
        updatedAt: settledAt,
      }),
      enrichmentStatus: INSPIRATION_ENRICHMENT_STATUS_FAILED,
    });

    return;
  }

  try {
    const persistedEnrichment = await persistInspirationEnrichment(
      persistenceClient,
      {
        ...persistInputBase,
        ...buildPersistableInspirationEnrichmentOutputs(completedOutputs),
        ...(extractedUrlImportRawContent === undefined
          ? {}
          : { rawContent: extractedUrlImportRawContent }),
        ...(resolvedAsyncReflection === null
          ? {}
          : {
              reflectionPrompt: resolvedAsyncReflection.reflectionPrompt,
              reflectionStatus: resolvedAsyncReflection.reflectionStatus,
            }),
        ...(extractedUrlImportSourceMeta === undefined
          ? {}
          : { sourceMeta: extractedUrlImportSourceMeta }),
        enrichmentFields,
        enrichmentResumeState: null,
        enrichmentStatus: INSPIRATION_ENRICHMENT_STATUS_COMPLETED,
      },
    );

    if (!persistedEnrichment) {
      return;
    }

    await enqueueConnectionAnalysisJob(
      inspiration,
      message,
      completedOutputs,
      options,
    );
    await enqueueClusterRebuildJob(
      inspiration,
      message,
      completedOutputs,
      persistenceClient,
      options,
    );
  } catch (error) {
    const failedFields = buildFailedInspirationEnrichmentFields({
      attemptCount,
      completedFieldNames:
        resolveCompletedFieldNamesFromEnrichmentFields(enrichmentFields),
      existingFields: enrichmentFields,
      failedAt: settledAt,
      lastError: serializeInspirationEnrichmentError(error, settledAt, {
        attemptCount,
        maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      }),
      lastFailureReason:
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "Failed to persist enrichment results.",
      lastFailureRetryability: classifyInspirationJobFailureRetryability(
        error,
      ),
      maxAttemptCount: INSPIRATION_ENRICHMENT_MAX_ATTEMPT_COUNT,
      startedAt,
    });

    if (!(await persistFailure(error, settledAt, completedOutputs, failedFields))) {
      return;
    }
    throw error;
  }
}
