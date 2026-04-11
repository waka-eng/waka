import type { S3AudioObjectReference } from "../types.ts";
import type { ReflectionGroundingContext } from "./reflection-grounding.ts";

export const LLM_PROVIDER_NAMES = ["openai", "gemini"] as const;

export type LLMProviderName = (typeof LLM_PROVIDER_NAMES)[number];

export const LLM_PROVIDER_OPERATIONS = [
  "generateEmbedding",
  "classify",
  "summarize",
  "generateReflection",
  "explainConnection",
  "generateTitle",
  "classifyMetadata",
  "transcribeAudio",
  "describeImage",
] as const;

export type LLMProviderOperation = (typeof LLM_PROVIDER_OPERATIONS)[number];

export const LLM_PROVIDER_TEXT_MODEL_INPUTS = ["default", "text"] as const;
export type LLMProviderTextModelInput =
  (typeof LLM_PROVIDER_TEXT_MODEL_INPUTS)[number];

export const LLM_PROVIDER_EMBEDDING_MODEL_INPUTS = [
  "default",
  "embedding",
] as const;
export type LLMProviderEmbeddingModelInput =
  (typeof LLM_PROVIDER_EMBEDDING_MODEL_INPUTS)[number];

export const LLM_PROVIDER_TRANSCRIPTION_MODEL_INPUTS = [
  "default",
  "transcription",
] as const;
export type LLMProviderTranscriptionModelInput =
  (typeof LLM_PROVIDER_TRANSCRIPTION_MODEL_INPUTS)[number];

export const LLM_PROVIDER_VISION_MODEL_INPUTS = ["default", "vision"] as const;
export type LLMProviderVisionModelInput =
  (typeof LLM_PROVIDER_VISION_MODEL_INPUTS)[number];

export const LLM_PROVIDER_ERROR_CODES = [
  "AUTHENTICATION",
  "BAD_REQUEST",
  "INVALID_RESPONSE",
  "RATE_LIMITED",
  "TIMEOUT",
  "UNAVAILABLE",
  "UNSUPPORTED_OPERATION",
  "UNKNOWN",
] as const;

export type LLMProviderErrorCode = (typeof LLM_PROVIDER_ERROR_CODES)[number];

export interface LLMProviderMetadata {
  readonly [key: string]: LLMProviderMetadataValue;
}

export type LLMProviderMetadataValue =
  | boolean
  | LLMProviderMetadata
  | null
  | number
  | readonly LLMProviderMetadataValue[]
  | string;

export interface LLMProviderGenerationOptions {
  frequencyPenalty?: number;
  maxTokens?: number;
  presencePenalty?: number;
  seed?: number;
  stopSequences?: readonly string[];
  temperature?: number;
  topK?: number;
  topP?: number;
}

export type LLMProviderFinishReason =
  | "cancelled"
  | "content-filter"
  | "error"
  | "length"
  | "stop"
  | "tool-calls"
  | "unknown";

export interface LLMProviderUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface LLMProviderTextContentBlock {
  type: "text";
  text: string;
}

export interface LLMProviderRefusalContentBlock {
  type: "refusal";
  refusal: string;
}

export type LLMProviderContentBlock =
  | LLMProviderRefusalContentBlock
  | LLMProviderTextContentBlock;

export interface LLMProviderResult {
  role: "assistant";
  content: readonly LLMProviderContentBlock[];
  finishReason?: LLMProviderFinishReason;
  text: string;
}

export interface LLMProviderRequestContext {
  generation?: LLMProviderGenerationOptions;
  requestId?: string;
  traceId?: string;
  userId?: string;
  timeoutMs?: number;
  maxRetries?: number;
  metadata?: LLMProviderMetadata;
}

export interface LLMProviderRequest<
  TOperation extends LLMProviderOperation,
  TInput,
> extends LLMProviderRequestContext {
  operation: TOperation;
  input: TInput;
}

export interface LLMProviderResponse<
  TOperation extends LLMProviderOperation,
  TOutput,
> {
  operation: TOperation;
  provider: LLMProviderName;
  model: string;
  requestId?: string;
  traceId?: string;
  finishReason?: LLMProviderFinishReason;
  usage?: LLMProviderUsage;
  usageMetadata?: LLMProviderMetadata;
  output: TOutput;
}

export interface GenerateEmbeddingRequest
  extends LLMProviderRequest<
    "generateEmbedding",
    {
      text: string;
      model?: LLMProviderEmbeddingModelInput;
    }
  > {}

export interface GenerateEmbeddingResponse
  extends LLMProviderResponse<
    "generateEmbedding",
    {
      embedding: number[];
      dimensions: number;
    }
  > {}

export interface ClassifyRequest
  extends LLMProviderRequest<
    "classify",
    {
      prompt: string;
      labels?: readonly string[];
      model?: LLMProviderTextModelInput;
    }
  > {}

export interface ClassifyResponse
  extends LLMProviderResponse<
    "classify",
    {
      classification: string;
    }
  > {}

export interface SummarizeRequest
  extends LLMProviderRequest<
    "summarize",
    {
      content: string;
      maxCharacters?: number;
      model?: LLMProviderTextModelInput;
    }
  > {}

export interface SummarizeResponse
  extends LLMProviderResponse<
    "summarize",
    {
      summary: string;
    }
  > {}

export interface GenerateReflectionRequest
  extends LLMProviderRequest<
    "generateReflection",
    {
      content: string;
      groundingContext?: ReflectionGroundingContext;
      model?: LLMProviderTextModelInput;
    }
  > {}

export interface GenerateReflectionResponse
  extends LLMProviderResponse<
    "generateReflection",
    {
      reflectionPrompt: string;
    }
  > {}

export interface ExplainConnectionRequest
  extends LLMProviderRequest<
    "explainConnection",
    {
      sourceContent: string;
      targetContent: string;
      model?: LLMProviderTextModelInput;
    }
  > {}

export interface ExplainConnectionResponse
  extends LLMProviderResponse<
    "explainConnection",
    {
      explanation: string;
    }
  > {}

export interface GenerateTitleRequest
  extends LLMProviderRequest<
    "generateTitle",
    {
      content: string;
      maxCharacters?: number;
      model?: LLMProviderTextModelInput;
    }
  > {}

export interface GenerateTitleResponse
  extends LLMProviderResponse<
    "generateTitle",
    {
      title: string;
    }
  > {}

export const METADATA_CLASSIFICATION_DOMAINS = [
  "technology",
  "philosophy",
  "personal",
  "work",
  "design",
  "science",
  "business",
  "health",
  "education",
  "relationships",
  "creativity",
  "society",
  "other",
] as const;

export type MetadataClassificationDomain =
  (typeof METADATA_CLASSIFICATION_DOMAINS)[number];

export const METADATA_CLASSIFICATION_MOODS = [
  "curious",
  "excited",
  "frustrated",
  "reflective",
  "inspired",
  "uncertain",
  "urgent",
  "neutral",
] as const;

export type MetadataClassificationMood =
  (typeof METADATA_CLASSIFICATION_MOODS)[number];

export const METADATA_CLASSIFICATION_ACTIONABILITY = [
  "idea",
  "observation",
  "question",
  "decision",
  "reference",
] as const;

export type MetadataClassificationActionability =
  (typeof METADATA_CLASSIFICATION_ACTIONABILITY)[number];

export interface MetadataClassificationOutput {
  tags: string[];
  domain: MetadataClassificationDomain;
  mood: MetadataClassificationMood;
  actionability: MetadataClassificationActionability;
}

export interface ClassifyMetadataRequest
  extends LLMProviderRequest<
    "classifyMetadata",
    {
      content: string;
      model?: LLMProviderTextModelInput;
    }
  > {}

export interface ClassifyMetadataResponse
  extends LLMProviderResponse<"classifyMetadata", MetadataClassificationOutput> {}

export interface TranscribeAudioRequest
  extends LLMProviderRequest<
    "transcribeAudio",
    {
      audio: S3AudioObjectReference;
      model?: LLMProviderTranscriptionModelInput;
    }
  > {}

export interface TranscribeAudioResponse
  extends LLMProviderResponse<
    "transcribeAudio",
    {
      transcript: string;
    }
  > {}

export interface DescribeImageRequest
  extends LLMProviderRequest<
    "describeImage",
    {
      imageUrl: string;
      model?: LLMProviderVisionModelInput;
    }
  > {}

export interface DescribeImageResponse
  extends LLMProviderResponse<
    "describeImage",
    {
      description: string;
    }
  > {}

export interface LLMProviderOperationMap {
  generateEmbedding: {
    request: GenerateEmbeddingRequest;
    response: GenerateEmbeddingResponse;
  };
  classify: {
    request: ClassifyRequest;
    response: ClassifyResponse;
  };
  summarize: {
    request: SummarizeRequest;
    response: SummarizeResponse;
  };
  generateReflection: {
    request: GenerateReflectionRequest;
    response: GenerateReflectionResponse;
  };
  explainConnection: {
    request: ExplainConnectionRequest;
    response: ExplainConnectionResponse;
  };
  generateTitle: {
    request: GenerateTitleRequest;
    response: GenerateTitleResponse;
  };
  classifyMetadata: {
    request: ClassifyMetadataRequest;
    response: ClassifyMetadataResponse;
  };
  transcribeAudio: {
    request: TranscribeAudioRequest;
    response: TranscribeAudioResponse;
  };
  describeImage: {
    request: DescribeImageRequest;
    response: DescribeImageResponse;
  };
}

export type LLMProviderRequestFor<TOperation extends LLMProviderOperation> =
  LLMProviderOperationMap[TOperation]["request"];

export type LLMProviderResponseFor<TOperation extends LLMProviderOperation> =
  LLMProviderOperationMap[TOperation]["response"];

export type AnyLLMProviderRequest =
  LLMProviderOperationMap[keyof LLMProviderOperationMap]["request"];

export type AnyLLMProviderResponse =
  LLMProviderOperationMap[keyof LLMProviderOperationMap]["response"];

export interface LLMProvider {
  readonly provider: LLMProviderName;
  readonly supportedOperations: readonly LLMProviderOperation[];
  generateEmbedding(
    request: GenerateEmbeddingRequest,
  ): Promise<GenerateEmbeddingResponse>;
  classify(request: ClassifyRequest): Promise<ClassifyResponse>;
  summarize(request: SummarizeRequest): Promise<SummarizeResponse>;
  generateReflection(
    request: GenerateReflectionRequest,
  ): Promise<GenerateReflectionResponse>;
  explainConnection(
    request: ExplainConnectionRequest,
  ): Promise<ExplainConnectionResponse>;
  generateTitle(request: GenerateTitleRequest): Promise<GenerateTitleResponse>;
  classifyMetadata(
    request: ClassifyMetadataRequest,
  ): Promise<ClassifyMetadataResponse>;
  transcribeAudio(
    request: TranscribeAudioRequest,
  ): Promise<TranscribeAudioResponse>;
  describeImage(request: DescribeImageRequest): Promise<DescribeImageResponse>;
}

export interface LLMProviderErrorOptions {
  code: LLMProviderErrorCode;
  provider: LLMProviderName;
  operation: LLMProviderOperation;
  message: string;
  retryable: boolean;
  requestId?: string;
  traceId?: string;
  statusCode?: number;
  details?: LLMProviderMetadata;
  cause?: unknown;
}

export class LLMProviderError extends Error {
  readonly name = "LLMProviderError";
  readonly code: LLMProviderErrorCode;
  readonly provider: LLMProviderName;
  readonly operation: LLMProviderOperation;
  readonly retryable: boolean;
  readonly requestId?: string;
  readonly traceId?: string;
  readonly statusCode?: number;
  readonly details?: LLMProviderMetadata;
  override readonly cause?: unknown;

  constructor(options: LLMProviderErrorOptions) {
    super(options.message);

    this.code = options.code;
    this.provider = options.provider;
    this.operation = options.operation;
    this.retryable = options.retryable;
    this.requestId = options.requestId;
    this.traceId = options.traceId;
    this.statusCode = options.statusCode;
    this.details = options.details;
    this.cause = options.cause;

    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isLLMProviderError(
  value: unknown,
): value is LLMProviderError {
  return value instanceof LLMProviderError;
}
