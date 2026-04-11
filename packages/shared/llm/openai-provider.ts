import {
  DEFAULT_OPENAI_BASE_URL,
  OPENAI_EMBEDDING_DIMENSIONS,
  OPENAI_EMBEDDING_MODEL,
} from "./runtime.ts";
import {
  createOpenAIProviderErrorFromException,
  createOpenAIProviderErrorFromResponse,
} from "./openai-error.ts";
import {
  buildReflectionGroundingPromptContent,
  ensureGroundedReflectionPrompt,
} from "./reflection-grounding.ts";
import { withLLMProviderRetry } from "./transport-retry.ts";
import {
  METADATA_CLASSIFICATION_ACTIONABILITY,
  METADATA_CLASSIFICATION_DOMAINS,
  METADATA_CLASSIFICATION_MOODS,
  LLM_PROVIDER_OPERATIONS,
  LLMProviderError,
  type ClassifyMetadataRequest,
  type ClassifyMetadataResponse,
  type ClassifyRequest,
  type ClassifyResponse,
  type DescribeImageRequest,
  type DescribeImageResponse,
  type ExplainConnectionRequest,
  type ExplainConnectionResponse,
  type GenerateEmbeddingRequest,
  type GenerateEmbeddingResponse,
  type GenerateReflectionRequest,
  type GenerateReflectionResponse,
  type GenerateTitleRequest,
  type GenerateTitleResponse,
  type LLMProvider,
  type LLMProviderFinishReason,
  type LLMProviderGenerationOptions,
  type LLMProviderResult,
  type LLMProviderMetadata,
  type LLMProviderOperation,
  type LLMProviderRequestContext,
  type LLMProviderUsage,
  type MetadataClassificationOutput,
  type SummarizeRequest,
  type SummarizeResponse,
  type TranscribeAudioRequest,
  type TranscribeAudioResponse,
} from "./provider.ts";

export const OPENAI_PROVIDER_NAME = "openai" as const;
export const OPENAI_API_BASE_URL = DEFAULT_OPENAI_BASE_URL;
export { OPENAI_EMBEDDING_DIMENSIONS, OPENAI_EMBEDDING_MODEL };

export interface OpenAIProviderModelConfig {
  embedding: typeof OPENAI_EMBEDDING_MODEL;
  text: string;
  transcription: string;
  vision: string;
}

export const OPENAI_PROVIDER_DEFAULT_MODELS: OpenAIProviderModelConfig = {
  embedding: OPENAI_EMBEDDING_MODEL,
  text: "gpt-5-mini",
  transcription: "gpt-4o-mini-transcribe",
  vision: "gpt-4.1-mini",
};

export interface OpenAIProviderOptions {
  apiKey: string;
  baseUrl?: string;
  organization?: string;
  project?: string;
  fetch?: typeof fetch;
  models?: Partial<OpenAIProviderModelConfig>;
  sleep?: (ms: number) => Promise<void>;
}

export type NormalizedConversationInput =
  | string
  | readonly NormalizedConversationMessage[];

export interface NormalizedConversationMessage {
  role: "assistant" | "system" | "user";
  content: string | readonly NormalizedConversationContentPart[];
}

export type NormalizedConversationContentPart =
  | {
      type: "image";
      imageUrl: string;
      detail?: "auto" | "high" | "low";
    }
  | {
      type: "text";
      text: string;
    };

interface OpenAIChatMessage {
  role: "assistant" | "system" | "user";
  content: string | OpenAIChatMessageContentPart[];
}

type OpenAIChatMessageContentPart =
  | {
      type: "image_url";
      image_url: {
        url: string;
        detail?: "auto" | "high" | "low";
      };
    }
  | {
      type: "text";
      text: string;
    };

interface OpenAIErrorPayload {
  error?: {
    code?: string | null;
    message?: string;
    type?: string;
  };
}

interface OpenAIEmbeddingsResponsePayload {
  model?: string;
  data?: Array<{
    embedding?: unknown;
  }>;
  usage?: OpenAITokenUsagePayload;
}

interface OpenAIInputTokenDetailsPayload {
  audio_tokens?: number;
  cached_tokens?: number;
}

interface OpenAIOutputTokenDetailsPayload {
  accepted_prediction_tokens?: number;
  audio_tokens?: number;
  reasoning_tokens?: number;
  rejected_prediction_tokens?: number;
}

interface OpenAITokenUsagePayload {
  completion_tokens?: number;
  completion_tokens_details?: OpenAIOutputTokenDetailsPayload;
  input_tokens?: number;
  input_tokens_details?: OpenAIInputTokenDetailsPayload;
  output_tokens?: number;
  output_tokens_details?: OpenAIOutputTokenDetailsPayload;
  prompt_tokens?: number;
  prompt_tokens_details?: OpenAIInputTokenDetailsPayload;
  total_tokens?: number;
}

interface OpenAITextResponsePayload {
  model?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
            refusal?: string;
          }>;
    };
  }>;
  output_text?: string;
  output?: Array<{
    role?: string;
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
      refusal?: string;
    }>;
  }>;
  status?: string;
  incomplete_details?: {
    reason?: string | null;
  };
  usage?: OpenAITokenUsagePayload;
}

interface OpenAITranscriptionPayload {
  text?: string;
  usage?:
    | ({
        type?: "tokens";
      } & OpenAITokenUsagePayload)
    | {
        type?: "duration";
        seconds?: number;
      };
}

interface OpenAITextResult {
  result: LLMProviderResult;
  finishReason?: LLMProviderFinishReason;
  text: string;
  model: string;
  requestId?: string;
  usage?: LLMProviderUsage;
  usageMetadata?: LLMProviderMetadata;
}

type OpenAIModelPurpose = keyof OpenAIProviderModelConfig;

interface NormalizedOpenAIUsage {
  usage?: LLMProviderUsage;
  usageMetadata?: LLMProviderMetadata;
}

export class OpenAIProvider implements LLMProvider {
  readonly provider = OPENAI_PROVIDER_NAME;
  readonly supportedOperations = LLM_PROVIDER_OPERATIONS;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly organization?: string;
  private readonly project?: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly models: OpenAIProviderModelConfig;
  private readonly sleepImplementation?: (ms: number) => Promise<void>;

  constructor(options: OpenAIProviderOptions) {
    const apiKey = options.apiKey.trim();

    if (apiKey.length === 0) {
      throw new Error(
        "OpenAIProvider requires a non-empty OPENAI_API_KEY during initialization.",
      );
    }

    const fetchImplementation = options.fetch ?? globalThis.fetch?.bind(globalThis);

    if (typeof fetchImplementation !== "function") {
      throw new Error(
        "OpenAIProvider requires a fetch implementation in the current runtime.",
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.organization = options.organization?.trim() || undefined;
    this.project = options.project?.trim() || undefined;
    this.fetchImplementation = fetchImplementation;
    this.sleepImplementation = options.sleep;
    this.models = {
      ...OPENAI_PROVIDER_DEFAULT_MODELS,
      ...options.models,
      embedding: OPENAI_EMBEDDING_MODEL,
    };
  }

  async generateEmbedding(
    request: GenerateEmbeddingRequest,
  ): Promise<GenerateEmbeddingResponse> {
    const model = resolveOpenAIModel({
      operation: "generateEmbedding",
      request,
      requestedModel: request.input.model,
      purpose: "embedding",
      models: this.models,
    });
    const response = await this.requestJson<OpenAIEmbeddingsResponsePayload>({
      path: "/embeddings",
      operation: "generateEmbedding",
      request,
      body: {
        encoding_format: "float",
        input: request.input.text,
        model,
        user: request.userId,
      },
    });

    const embedding = response.body.data?.[0]?.embedding;

    if (
      !Array.isArray(embedding) ||
      !embedding.every((value) => typeof value === "number") ||
      embedding.length !== OPENAI_EMBEDDING_DIMENSIONS
    ) {
      throw new LLMProviderError({
        code: "INVALID_RESPONSE",
        provider: this.provider,
        operation: "generateEmbedding",
        message:
          "OpenAI embeddings response did not include a 1536-dimensional embedding.",
        retryable: false,
        requestId: response.requestId ?? request.requestId,
        traceId: request.traceId,
      });
    }

    const usage = normalizeEmbeddingUsage(response.body.usage);

    return {
      operation: "generateEmbedding",
      provider: this.provider,
      model: response.body.model ?? model,
      ...buildResponseMetadata({
        requestId: response.requestId ?? request.requestId,
        traceId: request.traceId,
        usage: usage.usage,
        usageMetadata: usage.usageMetadata,
      }),
      output: {
        embedding,
        dimensions: embedding.length,
      },
    };
  }

  async classify(request: ClassifyRequest): Promise<ClassifyResponse> {
    const labels = request.input.labels?.filter((label) => label.trim().length > 0);
    const instructions =
      labels && labels.length > 0
        ? `Choose exactly one label from this list: ${labels.join(", ")}. Respond with only the label.`
        : "Return a concise lower-case classification label only.";
    const result = await this.runTextOperation({
      operation: "classify",
      request,
      requestedModel: request.input.model,
      instructions,
      input: request.input.prompt,
      maxOutputTokens: 48,
    });

    return {
      operation: "classify",
      provider: this.provider,
      model: result.model,
      ...buildResponseMetadata({
        finishReason: result.finishReason,
        requestId: result.requestId ?? request.requestId,
        traceId: request.traceId,
        usage: result.usage,
        usageMetadata: result.usageMetadata,
      }),
      output: {
        classification: result.text,
      },
    };
  }

  async summarize(request: SummarizeRequest): Promise<SummarizeResponse> {
    const maxCharacters = request.input.maxCharacters ?? 280;
    const result = await this.runTextOperation({
      operation: "summarize",
      request,
      requestedModel: request.input.model,
      instructions: `Summarize the content in ${maxCharacters} characters or fewer. Respond with summary text only.`,
      input: request.input.content,
      maxOutputTokens: 160,
    });

    return {
      operation: "summarize",
      provider: this.provider,
      model: result.model,
      ...buildResponseMetadata({
        finishReason: result.finishReason,
        requestId: result.requestId ?? request.requestId,
        traceId: request.traceId,
        usage: result.usage,
        usageMetadata: result.usageMetadata,
      }),
      output: {
        summary: clampTextToCharacterLimit(result.text, maxCharacters),
      },
    };
  }

  async generateReflection(
    request: GenerateReflectionRequest,
  ): Promise<GenerateReflectionResponse> {
    const result = await this.runTextOperation({
      operation: "generateReflection",
      request,
      requestedModel: request.input.model,
      instructions:
        "Write a single reflective follow-up question that helps the user deepen the captured idea. Use the grounding context directly by naming at least one phrase, detail, or theme from it. The question must reference a concrete detail, theme, tension, or subject from the captured content and must avoid vague wording like 'this thought' or 'this idea' without naming what it refers to. Respond with the question only.",
      input: buildReflectionGroundingPromptContent(
        request.input.content,
        request.input.groundingContext,
      ),
      maxOutputTokens: 120,
    });

    return {
      operation: "generateReflection",
      provider: this.provider,
      model: result.model,
      ...buildResponseMetadata({
        finishReason: result.finishReason,
        requestId: result.requestId ?? request.requestId,
        traceId: request.traceId,
        usage: result.usage,
        usageMetadata: result.usageMetadata,
      }),
      output: {
        reflectionPrompt: ensureGroundedReflectionPrompt(
          result.text,
          request.input.content,
          request.input.groundingContext,
        ),
      },
    };
  }

  async explainConnection(
    request: ExplainConnectionRequest,
  ): Promise<ExplainConnectionResponse> {
    const result = await this.runTextOperation({
      operation: "explainConnection",
      request,
      requestedModel: request.input.model,
      instructions:
        "Explain the strongest connection between the two notes in 2 short sentences. Respond with explanation text only.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Source note:\n${request.input.sourceContent}\n\nTarget note:\n${request.input.targetContent}`,
            },
          ],
        },
      ],
      maxOutputTokens: 180,
    });

    return {
      operation: "explainConnection",
      provider: this.provider,
      model: result.model,
      ...buildResponseMetadata({
        finishReason: result.finishReason,
        requestId: result.requestId ?? request.requestId,
        traceId: request.traceId,
        usage: result.usage,
        usageMetadata: result.usageMetadata,
      }),
      output: {
        explanation: result.text,
      },
    };
  }

  async generateTitle(
    request: GenerateTitleRequest,
  ): Promise<GenerateTitleResponse> {
    const maxCharacters = request.input.maxCharacters ?? 80;
    const result = await this.runTextOperation({
      operation: "generateTitle",
      request,
      requestedModel: request.input.model,
      instructions: `Generate a concise, descriptive title in ${maxCharacters} characters or fewer. Respond with the title only.`,
      input: request.input.content,
      maxOutputTokens: 48,
    });

    return {
      operation: "generateTitle",
      provider: this.provider,
      model: result.model,
      ...buildResponseMetadata({
        finishReason: result.finishReason,
        requestId: result.requestId ?? request.requestId,
        traceId: request.traceId,
        usage: result.usage,
        usageMetadata: result.usageMetadata,
      }),
      output: {
        title: clampTextToCharacterLimit(result.text, maxCharacters),
      },
    };
  }

  async classifyMetadata(
    request: ClassifyMetadataRequest,
  ): Promise<ClassifyMetadataResponse> {
    const result = await this.runTextOperation({
      operation: "classifyMetadata",
      request,
      requestedModel: request.input.model,
      instructions: `Classify the note into JSON with keys tags, domain, mood, and actionability.
- tags: array of short lower-case strings
- domain: one of ${METADATA_CLASSIFICATION_DOMAINS.join(", ")}
- mood: one of ${METADATA_CLASSIFICATION_MOODS.join(", ")}
- actionability: one of ${METADATA_CLASSIFICATION_ACTIONABILITY.join(", ")}
Return valid JSON only.`,
      input: request.input.content,
      maxOutputTokens: 220,
    });

    const output = parseMetadataClassification(
      result.text,
      result.requestId ?? request.requestId,
      request.traceId,
    );

    return {
      operation: "classifyMetadata",
      provider: this.provider,
      model: result.model,
      ...buildResponseMetadata({
        finishReason: result.finishReason,
        requestId: result.requestId ?? request.requestId,
        traceId: request.traceId,
        usage: result.usage,
        usageMetadata: result.usageMetadata,
      }),
      output,
    };
  }

  async transcribeAudio(
    request: TranscribeAudioRequest,
  ): Promise<TranscribeAudioResponse> {
    const model = resolveOpenAIModel({
      operation: "transcribeAudio",
      request,
      requestedModel: request.input.model,
      purpose: "transcription",
      models: this.models,
    });
    const audioAsset = await this.fetchBinaryAsset(
      request.input.audio.mediaUrl,
      request,
      "transcribeAudio",
    );
    const formData = new FormData();
    formData.set(
      "file",
      new Blob([audioAsset.bytes], { type: audioAsset.contentType }),
      audioAsset.fileName,
    );
    formData.set("model", model);

    const response = await this.requestFormData<OpenAITranscriptionPayload>({
      path: "/audio/transcriptions",
      operation: "transcribeAudio",
      request,
      body: formData,
    });

    const transcript = response.body.text?.trim();

    if (!transcript) {
      throw new LLMProviderError({
        code: "INVALID_RESPONSE",
        provider: this.provider,
        operation: "transcribeAudio",
        message: "OpenAI transcription response did not include transcript text.",
        retryable: false,
        requestId: response.requestId ?? request.requestId,
        traceId: request.traceId,
      });
    }

    const usage = normalizeTextUsage(response.body.usage);

    return {
      operation: "transcribeAudio",
      provider: this.provider,
      model,
      ...buildResponseMetadata({
        requestId: response.requestId ?? request.requestId,
        traceId: request.traceId,
        usage: usage.usage,
        usageMetadata: usage.usageMetadata,
      }),
      output: {
        transcript,
      },
    };
  }

  async describeImage(
    request: DescribeImageRequest,
  ): Promise<DescribeImageResponse> {
    const imageDataUrl = await this.fetchAssetAsDataUrl(
      request.input.imageUrl,
      request,
      "describeImage",
    );
    const result = await this.runTextOperation({
      operation: "describeImage",
      request,
      requestedModel: request.input.model,
      instructions:
        "Extract any legible text from the image verbatim. If the image has no meaningful text, return a short searchable description in one sentence. Respond with text only.",
      input: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Read this captured inspiration image and return the extracted text.",
            },
            {
              type: "image",
              imageUrl: imageDataUrl,
              detail: "auto",
            },
          ],
        },
      ],
      maxOutputTokens: 160,
    });

    return {
      operation: "describeImage",
      provider: this.provider,
      model: result.model,
      ...buildResponseMetadata({
        finishReason: result.finishReason,
        requestId: result.requestId ?? request.requestId,
        traceId: request.traceId,
        usage: result.usage,
        usageMetadata: result.usageMetadata,
      }),
      output: {
        description: result.text,
      },
    };
  }

  private async runTextOperation(args: {
    operation: Exclude<LLMProviderOperation, "generateEmbedding" | "transcribeAudio">;
    request: LLMProviderRequestContext;
    requestedModel?: string;
    instructions: string;
    input: NormalizedConversationInput;
    maxOutputTokens: number;
  }): Promise<OpenAITextResult> {
    const model = resolveOpenAIModel({
      operation: args.operation,
      request: args.request,
      requestedModel: args.requestedModel,
      purpose: args.operation === "describeImage" ? "vision" : "text",
      models: this.models,
    });
    const response = await this.requestJson<OpenAITextResponsePayload>({
      path: "/chat/completions",
      operation: args.operation,
      request: args.request,
      body: {
        messages: buildOpenAIMessages({
          input: args.input,
          systemInstruction: args.instructions,
        }),
        model,
        ...buildOpenAIChatCompletionOptions({
          defaultMaxOutputTokens: args.maxOutputTokens,
          generation: args.request.generation,
        }),
      },
    });
    const result = normalizeOpenAICompletionResult(response.body);
    const text = result?.text.trim();

    if (!text) {
      throw new LLMProviderError({
        code: "INVALID_RESPONSE",
        provider: this.provider,
        operation: args.operation,
        message: "OpenAI response did not include output text.",
        retryable: false,
        requestId: response.requestId ?? args.request.requestId,
        traceId: args.request.traceId,
      });
    }

    return {
      result,
      finishReason: result.finishReason,
      text,
      model: response.body.model ?? model,
      requestId: response.requestId ?? args.request.requestId,
      ...normalizeTextUsage(response.body.usage),
    };
  }

  private async requestJson<TResponse>(args: {
    path: string;
    operation: LLMProviderOperation;
    request: LLMProviderRequestContext;
    body: Record<string, unknown>;
  }): Promise<{
    body: TResponse;
    requestId?: string;
  }> {
    return withLLMProviderRetry(
      async () => {
        const { response, requestId } = await this.request({
          method: "POST",
          path: args.path,
          operation: args.operation,
          request: args.request,
          body: JSON.stringify(removeUndefinedValues(args.body)),
          contentType: "application/json",
        });

        return {
          body: await parseJsonResponse<TResponse>(
            response,
            args.operation,
            requestId ?? args.request.requestId,
            args.request.traceId,
          ),
          requestId,
        };
      },
      {
        maxRetries: args.request.maxRetries,
        sleep: this.sleepImplementation,
      },
    );
  }

  private async requestFormData<TResponse>(args: {
    path: string;
    operation: LLMProviderOperation;
    request: LLMProviderRequestContext;
    body: FormData;
  }): Promise<{
    body: TResponse;
    requestId?: string;
  }> {
    return withLLMProviderRetry(
      async () => {
        const { response, requestId } = await this.request({
          method: "POST",
          path: args.path,
          operation: args.operation,
          request: args.request,
          body: args.body,
        });

        return {
          body: await parseJsonResponse<TResponse>(
            response,
            args.operation,
            requestId ?? args.request.requestId,
            args.request.traceId,
          ),
          requestId,
        };
      },
      {
        maxRetries: args.request.maxRetries,
        sleep: this.sleepImplementation,
      },
    );
  }

  private async request(args: {
    method: "GET" | "POST";
    path: string;
    operation: LLMProviderOperation;
    request: LLMProviderRequestContext;
    body?: BodyInit;
    contentType?: string;
  }): Promise<{
    response: Response;
    requestId?: string;
  }> {
    const controller = new AbortController();
    const timeoutMs = args.request.timeoutMs;
    const timeout =
      timeoutMs !== undefined
        ? setTimeout(() => controller.abort(), timeoutMs)
        : undefined;

    try {
      const response = await this.fetchImplementation(`${this.baseUrl}${args.path}`, {
        method: args.method,
        headers: buildOpenAIHeaders({
          apiKey: this.apiKey,
          contentType: args.contentType,
          organization: this.organization,
          project: this.project,
        }),
        body: args.body,
        signal: controller.signal,
      });
      const requestId = response.headers.get("x-request-id") ?? undefined;

      if (!response.ok) {
        await throwMappedOpenAIError({
          response,
          operation: args.operation,
          requestId: requestId ?? args.request.requestId,
          traceId: args.request.traceId,
        });
      }

      return {
        response,
        requestId,
      };
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new LLMProviderError({
          code: "TIMEOUT",
          provider: this.provider,
          operation: args.operation,
          message: "OpenAI request timed out.",
          retryable: true,
          requestId: args.request.requestId,
          traceId: args.request.traceId,
          cause: error,
        });
      }

      throw createOpenAIProviderErrorFromException({
        provider: this.provider,
        operation: args.operation,
        requestId: args.request.requestId,
        traceId: args.request.traceId,
        error,
        fallbackMessage: "OpenAI request failed.",
      });
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  private async fetchBinaryAsset(
    url: string,
    request: LLMProviderRequestContext,
    operation: "transcribeAudio" | "describeImage",
  ): Promise<{
    bytes: Uint8Array;
    contentType: string;
    fileName: string;
  }> {
    const controller = new AbortController();
    const timeoutMs = request.timeoutMs;
    const timeout =
      timeoutMs !== undefined
        ? setTimeout(() => controller.abort(), timeoutMs)
        : undefined;

    try {
      const response = await this.fetchImplementation(url, {
        method: "GET",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new LLMProviderError({
          code: "BAD_REQUEST",
          provider: this.provider,
          operation,
          message: `Unable to download remote asset: ${url}`,
          retryable: false,
          requestId: request.requestId,
          traceId: request.traceId,
          statusCode: response.status,
        });
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      const contentType =
        response.headers.get("content-type")?.split(";")[0]?.trim() ||
        inferContentTypeFromUrl(url);

      return {
        bytes,
        contentType,
        fileName: inferFileName(url, contentType),
      };
    } catch (error) {
      if (error instanceof LLMProviderError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new LLMProviderError({
          code: "TIMEOUT",
          provider: this.provider,
          operation,
          message: `Timed out while downloading remote asset: ${url}`,
          retryable: true,
          requestId: request.requestId,
          traceId: request.traceId,
          cause: error,
        });
      }

      throw new LLMProviderError({
        code: "UNAVAILABLE",
        provider: this.provider,
        operation,
        message: error instanceof Error ? error.message : "Failed to download asset.",
        retryable: true,
        requestId: request.requestId,
        traceId: request.traceId,
        cause: error,
      });
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }
  }

  private async fetchAssetAsDataUrl(
    url: string,
    request: LLMProviderRequestContext,
    operation: "describeImage",
  ): Promise<string> {
    const asset = await this.fetchBinaryAsset(url, request, operation);
    return `data:${asset.contentType};base64,${Buffer.from(asset.bytes).toString("base64")}`;
  }
}

function resolveOpenAIModel(args: {
  operation: LLMProviderOperation;
  request: LLMProviderRequestContext;
  requestedModel?: string;
  purpose: OpenAIModelPurpose;
  models: OpenAIProviderModelConfig;
}): string {
  const requestedModel = args.requestedModel?.trim();
  const defaultModel = getOpenAIModelForPurpose(args.purpose, args.models);

  if (!requestedModel) {
    return defaultModel;
  }

  const normalizedModel = requestedModel.toLowerCase();

  if (
    normalizedModel === "default" ||
    getOpenAIModelAliases(args.purpose).includes(normalizedModel)
  ) {
    return defaultModel;
  }

  if (normalizedModel === defaultModel.toLowerCase()) {
    return defaultModel;
  }

  throw new LLMProviderError({
    code: "BAD_REQUEST",
    provider: OPENAI_PROVIDER_NAME,
    operation: args.operation,
    message: `OpenAI does not support model "${requestedModel}" for ${args.operation}.`,
    retryable: false,
    requestId: args.request.requestId,
    traceId: args.request.traceId,
    details: {
      requestedModel,
      supportedModels: [defaultModel, ...getOpenAIModelAliases(args.purpose)],
    },
  });
}

function getOpenAIModelForPurpose(
  purpose: OpenAIModelPurpose,
  models: OpenAIProviderModelConfig,
): string {
  if (purpose === "embedding") {
    return OPENAI_EMBEDDING_MODEL;
  }

  return models[purpose];
}

function getOpenAIModelAliases(
  purpose: OpenAIModelPurpose,
): readonly string[] {
  switch (purpose) {
    case "embedding":
      return ["embedding"];
    case "text":
      return ["text"];
    case "transcription":
      return ["transcription"];
    case "vision":
      return ["vision"];
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl ?? OPENAI_API_BASE_URL).trim();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function buildOpenAIHeaders(args: {
  apiKey: string;
  contentType?: string;
  organization?: string;
  project?: string;
}): Headers {
  const headers = new Headers({
    Authorization: `Bearer ${args.apiKey}`,
  });

  if (args.contentType) {
    headers.set("Content-Type", args.contentType);
  }

  if (args.organization) {
    headers.set("OpenAI-Organization", args.organization);
  }

  if (args.project) {
    headers.set("OpenAI-Project", args.project);
  }

  return headers;
}

async function parseJsonResponse<TResponse>(
  response: Response,
  operation: LLMProviderOperation,
  requestId?: string,
  traceId?: string,
): Promise<TResponse> {
  try {
    return (await response.json()) as TResponse;
  } catch (error) {
    throw new LLMProviderError({
      code: "INVALID_RESPONSE",
      provider: OPENAI_PROVIDER_NAME,
      operation,
      message: "OpenAI returned a non-JSON response.",
      retryable: false,
      requestId,
      traceId,
      cause: error,
    });
  }
}

async function throwMappedOpenAIError(args: {
  response: Response;
  operation: LLMProviderOperation;
  requestId?: string;
  traceId?: string;
}): Promise<never> {
  let payload: OpenAIErrorPayload | undefined;

  try {
    payload = (await args.response.json()) as OpenAIErrorPayload;
  } catch {
    payload = undefined;
  }

  const message =
    payload?.error?.message ||
    `OpenAI request failed with status ${args.response.status}.`;

  throw createOpenAIProviderErrorFromResponse({
    provider: OPENAI_PROVIDER_NAME,
    operation: args.operation,
    statusCode: args.response.status,
    requestId: args.requestId,
    traceId: args.traceId,
    payload,
    headers: args.response.headers,
    fallbackMessage: message,
  });
}

function normalizeEmbeddingUsage(
  usage: OpenAITokenUsagePayload | undefined,
): NormalizedOpenAIUsage {
  if (!usage) {
    return {};
  }

  const normalizedUsage = removeUndefinedValues({
    inputTokens: usage.prompt_tokens ?? usage.input_tokens,
    totalTokens: usage.total_tokens,
  });

  return buildNormalizedUsage({
    usage: normalizedUsage,
    usageMetadata: normalizeOpenAIUsageMetadata(usage),
  });
}

function normalizeTextUsage(
  usage:
    | OpenAITokenUsagePayload
    | ({
        type?: "tokens";
      } & OpenAITokenUsagePayload)
    | {
        type?: "duration";
        seconds?: number;
      }
    | undefined,
): NormalizedOpenAIUsage {
  if (
    !usage ||
    ("type" in usage && usage.type === "duration") ||
    (!("completion_tokens" in usage) &&
      !("input_tokens" in usage) &&
      !("output_tokens" in usage) &&
      !("prompt_tokens" in usage) &&
      !("total_tokens" in usage))
  ) {
    return {};
  }

  const normalizedUsage = removeUndefinedValues({
    inputTokens:
      "prompt_tokens" in usage ? usage.prompt_tokens : usage.input_tokens,
    outputTokens:
      "completion_tokens" in usage
        ? usage.completion_tokens
        : usage.output_tokens,
    totalTokens: usage.total_tokens,
  });

  return buildNormalizedUsage({
    usage: normalizedUsage,
    usageMetadata: normalizeOpenAIUsageMetadata(usage),
  });
}

function buildNormalizedUsage(args: {
  usage: LLMProviderUsage;
  usageMetadata?: LLMProviderMetadata;
}): NormalizedOpenAIUsage {
  return {
    ...(hasEntries(args.usage) ? { usage: args.usage } : {}),
    ...(args.usageMetadata ? { usageMetadata: args.usageMetadata } : {}),
  };
}

function normalizeOpenAIUsageMetadata(
  usage:
    | OpenAITokenUsagePayload
    | ({
        type?: "tokens";
      } & OpenAITokenUsagePayload),
): LLMProviderMetadata | undefined {
  const inputTokensDetails = normalizeOpenAIInputTokenDetails(
    usage.prompt_tokens_details ?? usage.input_tokens_details,
  );
  const outputTokensDetails = normalizeOpenAIOutputTokenDetails(
    usage.completion_tokens_details ?? usage.output_tokens_details,
  );
  const usageMetadata = removeUndefinedValues({
    inputTokensDetails,
    outputTokensDetails,
  });

  return hasEntries(usageMetadata) ? usageMetadata : undefined;
}

function normalizeOpenAIInputTokenDetails(
  details: OpenAIInputTokenDetailsPayload | undefined,
): LLMProviderMetadata | undefined {
  if (!details) {
    return undefined;
  }

  const normalizedDetails = removeUndefinedValues({
    audioTokens: details.audio_tokens,
    cachedTokens: details.cached_tokens,
  });

  return hasEntries(normalizedDetails) ? normalizedDetails : undefined;
}

function normalizeOpenAIOutputTokenDetails(
  details: OpenAIOutputTokenDetailsPayload | undefined,
): LLMProviderMetadata | undefined {
  if (!details) {
    return undefined;
  }

  const normalizedDetails = removeUndefinedValues({
    acceptedPredictionTokens: details.accepted_prediction_tokens,
    audioTokens: details.audio_tokens,
    reasoningTokens: details.reasoning_tokens,
    rejectedPredictionTokens: details.rejected_prediction_tokens,
  });

  return hasEntries(normalizedDetails) ? normalizedDetails : undefined;
}

function hasEntries(value: object): boolean {
  return Object.keys(value).length > 0;
}

function buildResponseMetadata(args: {
  finishReason?: LLMProviderFinishReason;
  requestId?: string;
  traceId?: string;
  usage?: LLMProviderUsage;
  usageMetadata?: LLMProviderMetadata;
}): {
  finishReason?: LLMProviderFinishReason;
  requestId?: string;
  traceId?: string;
  usage?: LLMProviderUsage;
  usageMetadata?: LLMProviderMetadata;
} {
  return removeUndefinedValues(args);
}

function buildOpenAIChatCompletionOptions(args: {
  defaultMaxOutputTokens: number;
  generation?: LLMProviderGenerationOptions;
}): LLMProviderMetadata {
  return removeUndefinedValues({
    frequency_penalty: normalizeFiniteNumber(args.generation?.frequencyPenalty),
    max_completion_tokens:
      normalizePositiveInteger(args.generation?.maxTokens) ??
      args.defaultMaxOutputTokens,
    presence_penalty: normalizeFiniteNumber(args.generation?.presencePenalty),
    seed: normalizeInteger(args.generation?.seed),
    stop: normalizeStopSequences(args.generation?.stopSequences),
    temperature: normalizeFiniteNumber(args.generation?.temperature),
    top_p: normalizeFiniteNumber(args.generation?.topP),
  });
}

function normalizeFiniteNumber(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return value;
}

function normalizeInteger(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    return undefined;
  }

  return value;
}

function normalizePositiveInteger(
  value: number | undefined,
): number | undefined {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function normalizeStopSequences(
  value: readonly string[] | undefined,
): readonly string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const stopSequences = value.filter((sequence) => sequence.trim().length > 0);

  return stopSequences.length > 0 ? stopSequences : undefined;
}

export function normalizeOpenAICompletionResult(
  payload: OpenAITextResponsePayload,
): LLMProviderResult | undefined {
  const content = extractOpenAIAssistantContentBlocks(payload);

  if (content.length === 0) {
    return undefined;
  }

  const text = content
    .filter(
      (
        block,
      ): block is Extract<LLMProviderResult["content"][number], { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text.trim())
    .filter((block) => block.length > 0)
    .join("\n")
    .trim();

  const result: LLMProviderResult = {
    role: "assistant",
    content,
    text,
  };

  const finishReason = normalizeOpenAIFinishReason(payload);

  if (finishReason) {
    result.finishReason = finishReason;
  }

  return result;
}

function normalizeOpenAIFinishReason(
  payload: OpenAITextResponsePayload,
): LLMProviderFinishReason | undefined {
  const choiceFinishReason = payload.choices?.[0]?.finish_reason;

  if (typeof choiceFinishReason === "string" && choiceFinishReason.trim().length > 0) {
    return mapOpenAIFinishReason(choiceFinishReason);
  }

  if (payload.status === "completed") {
    return "stop";
  }

  if (payload.status === "incomplete") {
    return payload.incomplete_details?.reason
      ? mapOpenAIFinishReason(payload.incomplete_details.reason)
      : "unknown";
  }

  if (payload.status === "requires_action") {
    return "tool-calls";
  }

  if (payload.status === "cancelled") {
    return "cancelled";
  }

  if (payload.status === "failed" || payload.status === "expired") {
    return "error";
  }

  return undefined;
}

function mapOpenAIFinishReason(reason: string): LLMProviderFinishReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
    case "max_output_tokens":
    case "max_tokens":
      return "length";
    case "content_filter":
      return "content-filter";
    case "cancelled":
      return "cancelled";
    case "error":
    case "expired":
    case "failed":
      return "error";
    case "function_call":
    case "tool_calls":
    case "tool_use":
      return "tool-calls";
    default:
      return "unknown";
  }
}

function extractOpenAIAssistantContentBlocks(
  payload: OpenAITextResponsePayload,
): LLMProviderResult["content"] {
  const messageContent = payload.choices?.[0]?.message?.content;
  const messageBlocks =
    typeof messageContent === "string"
      ? normalizeOpenAITextContent(messageContent)
      : normalizeOpenAIContentParts(messageContent);

  if (messageBlocks.length > 0) {
    return messageBlocks;
  }

  const outputBlocks = normalizeOpenAIOutputItems(payload.output);

  if (outputBlocks.length > 0) {
    return outputBlocks;
  }

  return normalizeOpenAITextContent(payload.output_text);
}

function normalizeOpenAIOutputItems(
  output: OpenAITextResponsePayload["output"],
): LLMProviderResult["content"] {
  const blocks: LLMProviderResult["content"][number][] = [];

  for (const item of output ?? []) {
    if (
      item?.type === "message" &&
      item.role !== undefined &&
      item.role !== "assistant"
    ) {
      continue;
    }

    blocks.push(...normalizeOpenAIContentParts(item?.content));
  }

  return blocks;
}

function normalizeOpenAIContentParts(
  parts:
    | Array<{
        type?: string;
        text?: string;
        refusal?: string;
      }>
    | undefined,
): LLMProviderResult["content"] {
  const blocks: LLMProviderResult["content"][number][] = [];

  for (const part of parts ?? []) {
    if (
      (part?.type === "output_text" || part?.type === "text") &&
      typeof part.text === "string"
    ) {
      const text = part.text.trim();

      if (text.length > 0) {
        blocks.push({
          type: "text",
          text,
        });
      }

      continue;
    }

    if (part?.type === "refusal" && typeof part.refusal === "string") {
      const refusal = part.refusal.trim();

      if (refusal.length > 0) {
        blocks.push({
          type: "refusal",
          refusal,
        });
      }
    }
  }

  return blocks;
}

function normalizeOpenAITextContent(
  value: string | undefined,
): LLMProviderResult["content"] {
  if (typeof value !== "string") {
    return [];
  }

  const text = value.trim();

  if (text.length === 0) {
    return [];
  }

  return [
    {
      type: "text",
      text,
    },
  ];
}

function clampTextToCharacterLimit(text: string, maxCharacters: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (maxCharacters < 1 || normalized.length <= maxCharacters) {
    return normalized;
  }

  return normalized.slice(0, maxCharacters).trimEnd();
}

export function buildOpenAIMessages(args: {
  input: NormalizedConversationInput;
  systemInstruction?: string;
}): OpenAIChatMessage[] {
  const messages: OpenAIChatMessage[] = [];
  const systemInstruction = args.systemInstruction?.trim();

  if (systemInstruction) {
    messages.push({
      role: "system",
      content: systemInstruction,
    });
  }

  if (typeof args.input === "string") {
    messages.push({
      role: "user",
      content: args.input,
    });

    return messages;
  }

  for (const message of args.input) {
    messages.push({
      role: message.role,
      content: normalizeOpenAIMessageContent(message.content),
    });
  }

  return messages;
}

function normalizeOpenAIMessageContent(
  content: string | readonly NormalizedConversationContentPart[],
): string | OpenAIChatMessageContentPart[] {
  if (typeof content === "string") {
    return content;
  }

  if (content.every((part) => part.type === "text")) {
    return content
      .map((part) => part.text.trim())
      .filter((part) => part.length > 0)
      .join("\n");
  }

  return content.map((part) => {
    if (part.type === "text") {
      return {
        type: "text",
        text: part.text,
      };
    }

    return {
      type: "image_url",
      image_url: removeUndefinedValues({
        url: part.imageUrl,
        detail: part.detail,
      }),
    };
  });
}

function parseMetadataClassification(
  value: string,
  requestId?: string,
  traceId?: string,
): MetadataClassificationOutput {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new LLMProviderError({
      code: "INVALID_RESPONSE",
      provider: OPENAI_PROVIDER_NAME,
      operation: "classifyMetadata",
      message: "OpenAI metadata classification response was not valid JSON.",
      retryable: false,
      requestId,
      traceId,
      cause: error,
    });
  }

  if (!isMetadataClassificationOutput(parsed)) {
    throw new LLMProviderError({
      code: "INVALID_RESPONSE",
      provider: OPENAI_PROVIDER_NAME,
      operation: "classifyMetadata",
      message:
        "OpenAI metadata classification response did not match the expected schema.",
      retryable: false,
      requestId,
      traceId,
    });
  }

  return parsed;
}

function normalizeMetadataStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);

  if (normalized.length === 0) {
    return null;
  }

  return Array.from(new Set(normalized));
}

function normalizeMetadataEnumValue<const TValue extends readonly string[]>(
  value: unknown,
  allowedValues: TValue,
): TValue[number] | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized.length === 0) {
    return null;
  }

  return (allowedValues as readonly string[]).includes(normalized)
    ? (normalized as TValue[number])
    : null;
}

function isMetadataClassificationOutput(
  value: unknown,
): value is MetadataClassificationOutput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MetadataClassificationOutput>;
  const tags = normalizeMetadataStringArray(candidate.tags);
  const domain = normalizeMetadataEnumValue(
    candidate.domain,
    METADATA_CLASSIFICATION_DOMAINS,
  );
  const mood = normalizeMetadataEnumValue(
    candidate.mood,
    METADATA_CLASSIFICATION_MOODS,
  );
  const actionability = normalizeMetadataEnumValue(
    candidate.actionability,
    METADATA_CLASSIFICATION_ACTIONABILITY,
  );

  if (
    tags === null ||
    domain === null ||
    mood === null ||
    actionability === null
  ) {
    return false;
  }

  candidate.tags = tags;
  candidate.domain = domain;
  candidate.mood = mood;
  candidate.actionability = actionability;

  return true;
}

function inferContentTypeFromUrl(url: string): string {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.endsWith(".png")) {
    return "image/png";
  }

  if (lowerUrl.endsWith(".webp")) {
    return "image/webp";
  }

  if (lowerUrl.endsWith(".gif")) {
    return "image/gif";
  }

  if (lowerUrl.endsWith(".jpg") || lowerUrl.endsWith(".jpeg")) {
    return "image/jpeg";
  }

  if (lowerUrl.endsWith(".mp3")) {
    return "audio/mpeg";
  }

  if (lowerUrl.endsWith(".wav")) {
    return "audio/wav";
  }

  if (lowerUrl.endsWith(".m4a")) {
    return "audio/mp4";
  }

  return "application/octet-stream";
}

function inferFileName(url: string, contentType: string): string {
  try {
    const parsedUrl = new URL(url);
    const fileName = parsedUrl.pathname.split("/").pop();

    if (fileName && fileName.length > 0) {
      return fileName;
    }
  } catch {
    // Fall through to content-type based filename synthesis.
  }

  return contentTypeToFallbackFileName(contentType);
}

function contentTypeToFallbackFileName(contentType: string): string {
  switch (contentType) {
    case "audio/mpeg":
      return "audio.mp3";
    case "audio/wav":
      return "audio.wav";
    case "audio/mp4":
      return "audio.m4a";
    case "image/png":
      return "image.png";
    case "image/jpeg":
      return "image.jpg";
    case "image/webp":
      return "image.webp";
    case "image/gif":
      return "image.gif";
    default:
      return "asset.bin";
  }
}

function removeUndefinedValues<T extends Record<string, unknown>>(
  value: T,
): T & LLMProviderMetadata {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T & LLMProviderMetadata;
}
