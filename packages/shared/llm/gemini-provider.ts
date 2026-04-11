import {
  createGeminiProviderErrorFromException,
  createGeminiProviderErrorFromResponse,
} from "./gemini-error.ts";
import {
  buildReflectionGroundingPromptContent,
  ensureGroundedReflectionPrompt,
} from "./reflection-grounding.ts";
import { withLLMProviderRetry } from "./transport-retry.ts";
import {
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
  type LLMProviderMetadata,
  type LLMProviderOperation,
  type LLMProviderRequestContext,
  type LLMProviderResult,
  type LLMProviderUsage,
  type MetadataClassificationOutput,
  type SummarizeRequest,
  type SummarizeResponse,
  type TranscribeAudioRequest,
  type TranscribeAudioResponse,
} from "./provider.ts";

export const GEMINI_PROVIDER_NAME = "gemini" as const;
export const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiProviderModelConfig {
  text: string;
  transcription: string;
  vision: string;
}

export const GEMINI_PROVIDER_DEFAULT_MODELS: GeminiProviderModelConfig = {
  text: "gemini-2.5-flash",
  transcription: "gemini-2.0-flash-exp",
  vision: "gemini-2.5-flash",
};

export const GEMINI_PROVIDER_SUPPORTED_OPERATIONS: readonly LLMProviderOperation[] = [
  "classify",
  "summarize",
  "generateReflection",
  "explainConnection",
  "generateTitle",
  "classifyMetadata",
  "transcribeAudio",
  "describeImage",
];

export interface GeminiProviderOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  models?: Partial<GeminiProviderModelConfig>;
  sleep?: (ms: number) => Promise<void>;
}

interface GeminiContent {
  role?: "model" | "user";
  parts: GeminiContentPart[];
}

type GeminiContentPart =
  | {
      text: string;
    }
  | {
      file_data: {
        file_uri: string;
        mime_type: string;
      };
    }
  | {
      inline_data: {
        data: string;
        mime_type: string;
      };
    };

interface GeminiErrorPayload {
  error?: {
    code?: number;
    details?: unknown;
    message?: string;
    status?: string;
  };
}

interface GeminiUsageMetadata {
  cachedContentTokenCount?: number;
  cacheTokensDetails?: GeminiModalityTokenCount[];
  candidatesTokenCount?: number;
  candidatesTokensDetails?: GeminiModalityTokenCount[];
  promptTokenCount?: number;
  promptTokensDetails?: GeminiModalityTokenCount[];
  thoughtsTokenCount?: number;
  toolUsePromptTokenCount?: number;
  toolUsePromptTokensDetails?: GeminiModalityTokenCount[];
  totalTokenCount?: number;
}

interface GeminiModalityTokenCount {
  modality?: string;
  tokenCount?: number;
}

interface GeminiGenerateContentResponsePayload {
  candidates?: GeminiCandidate[];
  modelVersion?: string;
  promptFeedback?: {
    blockReason?: string;
  };
  responseId?: string;
  usageMetadata?: GeminiUsageMetadata;
}

interface GeminiCandidate {
  content?: {
    parts?: Array<{
      text?: string;
    }>;
    role?: string;
  };
  finishMessage?: string;
  finishReason?: string;
}

interface GeminiTextResult {
  finishReason?: LLMProviderFinishReason;
  model: string;
  requestId?: string;
  text: string;
  usage?: LLMProviderUsage;
  usageMetadata?: LLMProviderMetadata;
}

type GeminiModelPurpose = keyof GeminiProviderModelConfig;

interface NormalizedGeminiUsage {
  usage?: LLMProviderUsage;
  usageMetadata?: LLMProviderMetadata;
}

export class GeminiProvider implements LLMProvider {
  readonly provider = GEMINI_PROVIDER_NAME;
  readonly supportedOperations = GEMINI_PROVIDER_SUPPORTED_OPERATIONS;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly models: GeminiProviderModelConfig;
  private readonly sleepImplementation?: (ms: number) => Promise<void>;

  constructor(options: GeminiProviderOptions) {
    const apiKey = options.apiKey.trim();

    if (apiKey.length === 0) {
      throw new Error(
        "GeminiProvider requires a non-empty GEMINI_API_KEY during initialization.",
      );
    }

    const fetchImplementation = options.fetch ?? globalThis.fetch?.bind(globalThis);

    if (typeof fetchImplementation !== "function") {
      throw new Error(
        "GeminiProvider requires a fetch implementation in the current runtime.",
      );
    }

    this.apiKey = apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImplementation = fetchImplementation;
    this.sleepImplementation = options.sleep;
    this.models = {
      ...GEMINI_PROVIDER_DEFAULT_MODELS,
      ...options.models,
    };
  }

  async generateEmbedding(
    request: GenerateEmbeddingRequest,
  ): Promise<GenerateEmbeddingResponse> {
    throw new LLMProviderError({
      code: "UNSUPPORTED_OPERATION",
      provider: this.provider,
      operation: request.operation,
      message:
        "Gemini embeddings are not available in Waka V1. Embeddings stay pinned to OpenAI text-embedding-3-small.",
      retryable: false,
      requestId: request.requestId,
      traceId: request.traceId,
      details: {
        supportedProvider: "openai",
      },
    });
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
        createGeminiUserContent([
          {
            text: `Source note:\n${request.input.sourceContent}\n\nTarget note:\n${request.input.targetContent}`,
          },
        ]),
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
      instructions:
        "Classify the note into JSON with keys tags, domain, mood, and actionability. Return valid JSON only.",
      input: request.input.content,
      maxOutputTokens: 220,
      responseMimeType: "application/json",
      responseSchema: {
        properties: {
          actionability: {
            type: "STRING",
          },
          domain: {
            type: "STRING",
          },
          mood: {
            type: "STRING",
          },
          tags: {
            items: {
              type: "STRING",
            },
            type: "ARRAY",
          },
        },
        required: ["tags", "domain", "mood", "actionability"],
        type: "OBJECT",
      },
    });

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
      output: parseMetadataClassification(
        result.text,
        result.requestId ?? request.requestId,
        request.traceId,
      ),
    };
  }

  async transcribeAudio(
    request: TranscribeAudioRequest,
  ): Promise<TranscribeAudioResponse> {
    const asset = await this.fetchBinaryAsset(
      request.input.audio.mediaUrl,
      request,
      "transcribeAudio",
    );
    const result = await this.runTextOperation({
      operation: "transcribeAudio",
      request,
      requestedModel: request.input.model,
      instructions:
        "Transcribe this audio faithfully. Respond with transcript text only.",
      input: [
        createGeminiUserContent([
          {
            text: "Transcribe this captured audio note.",
          },
          {
            inline_data: {
              data: Buffer.from(asset.bytes).toString("base64"),
              mime_type: asset.contentType,
            },
          },
        ]),
      ],
      maxOutputTokens: 512,
    });

    return {
      operation: "transcribeAudio",
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
        transcript: result.text,
      },
    };
  }

  async describeImage(
    request: DescribeImageRequest,
  ): Promise<DescribeImageResponse> {
    const asset = await this.fetchBinaryAsset(
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
        createGeminiUserContent([
          {
            text: "Read this captured inspiration image and return the extracted text.",
          },
          {
            inline_data: {
              data: Buffer.from(asset.bytes).toString("base64"),
              mime_type: asset.contentType,
            },
          },
        ]),
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
    operation: Exclude<LLMProviderOperation, "generateEmbedding">;
    request: LLMProviderRequestContext;
    requestedModel?: string;
    instructions: string;
    input: string | readonly GeminiContent[];
    maxOutputTokens: number;
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
  }): Promise<GeminiTextResult> {
    const model = resolveGeminiModel({
      operation: args.operation,
      request: args.request,
      requestedModel: args.requestedModel,
      purpose:
        args.operation === "describeImage"
          ? "vision"
          : args.operation === "transcribeAudio"
            ? "transcription"
            : "text",
      models: this.models,
    });
    const response = await this.requestJson<GeminiGenerateContentResponsePayload>({
      model,
      operation: args.operation,
      request: args.request,
      body: {
        contents: buildGeminiContents(args.input),
        generationConfig: buildGeminiGenerationConfig({
          defaultMaxOutputTokens: args.maxOutputTokens,
          generation: args.request.generation,
          responseMimeType: args.responseMimeType,
          responseSchema: args.responseSchema,
        }),
        systemInstruction: buildGeminiSystemInstruction(args.instructions),
      },
    });
    const result = normalizeGeminiGenerateContentResult(response.body);
    const text = result?.text.trim();

    if (!text) {
      throw new LLMProviderError({
        code: "INVALID_RESPONSE",
        provider: this.provider,
        operation: args.operation,
        message: "Gemini response did not include output text.",
        retryable: false,
        requestId: response.requestId ?? args.request.requestId,
        traceId: args.request.traceId,
      });
    }

    const usage = normalizeGeminiUsage(response.body.usageMetadata);

    return {
      finishReason: result.finishReason,
      model: response.body.modelVersion ?? model,
      requestId: response.requestId ?? args.request.requestId,
      text,
      usage: usage.usage,
      usageMetadata: usage.usageMetadata,
    };
  }

  private async requestJson<TResponse>(args: {
    model: string;
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
          model: args.model,
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

  private async request(args: {
    method: "POST";
    model: string;
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
      const response = await this.fetchImplementation(
        `${this.baseUrl}/models/${args.model}:generateContent`,
        {
          method: args.method,
          headers: buildGeminiHeaders({
            apiKey: this.apiKey,
            contentType: args.contentType,
          }),
          body: args.body,
          signal: controller.signal,
        },
      );
      const requestId =
        response.headers.get("x-goog-request-id") ??
        response.headers.get("x-request-id") ??
        undefined;

      if (!response.ok) {
        await throwMappedGeminiError({
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
          message: "Gemini request timed out.",
          retryable: true,
          requestId: args.request.requestId,
          traceId: args.request.traceId,
          cause: error,
        });
      }

      throw createGeminiProviderErrorFromException({
        provider: this.provider,
        operation: args.operation,
        requestId: args.request.requestId,
        traceId: args.request.traceId,
        error,
        fallbackMessage: "Gemini request failed.",
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
    operation: "describeImage" | "transcribeAudio",
  ): Promise<{
    bytes: Uint8Array;
    contentType: string;
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

      return {
        bytes: new Uint8Array(await response.arrayBuffer()),
        contentType:
          response.headers.get("content-type")?.split(";")[0]?.trim() ||
          inferContentTypeFromUrl(url),
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
}

function resolveGeminiModel(args: {
  operation: LLMProviderOperation;
  request: LLMProviderRequestContext;
  requestedModel?: string;
  purpose: GeminiModelPurpose;
  models: GeminiProviderModelConfig;
}): string {
  const requestedModel = args.requestedModel?.trim();
  const defaultModel = args.models[args.purpose];

  if (!requestedModel) {
    return defaultModel;
  }

  const normalizedModel = requestedModel.toLowerCase();

  if (
    normalizedModel === "default" ||
    getGeminiModelAliases(args.purpose).includes(normalizedModel)
  ) {
    return defaultModel;
  }

  if (normalizedModel === defaultModel.toLowerCase()) {
    return defaultModel;
  }

  throw new LLMProviderError({
    code: "BAD_REQUEST",
    provider: GEMINI_PROVIDER_NAME,
    operation: args.operation,
    message: `Gemini does not support model "${requestedModel}" for ${args.operation}.`,
    retryable: false,
    requestId: args.request.requestId,
    traceId: args.request.traceId,
    details: {
      requestedModel,
      supportedModels: [defaultModel, ...getGeminiModelAliases(args.purpose)],
    },
  });
}

function getGeminiModelAliases(
  purpose: GeminiModelPurpose,
): readonly string[] {
  switch (purpose) {
    case "text":
      return ["text"];
    case "transcription":
      return ["transcription"];
    case "vision":
      return ["vision"];
  }
}

function normalizeBaseUrl(baseUrl?: string): string {
  const normalized = (baseUrl ?? GEMINI_API_BASE_URL).trim();
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function buildGeminiHeaders(args: {
  apiKey: string;
  contentType?: string;
}): Headers {
  const headers = new Headers({
    "x-goog-api-key": args.apiKey,
  });

  if (args.contentType) {
    headers.set("Content-Type", args.contentType);
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
      provider: GEMINI_PROVIDER_NAME,
      operation,
      message: "Gemini returned a non-JSON response.",
      retryable: false,
      requestId,
      traceId,
      cause: error,
    });
  }
}

async function throwMappedGeminiError(args: {
  response: Response;
  operation: LLMProviderOperation;
  requestId?: string;
  traceId?: string;
}): Promise<never> {
  let payload: GeminiErrorPayload | undefined;

  try {
    payload = (await args.response.json()) as GeminiErrorPayload;
  } catch {
    payload = undefined;
  }

  throw createGeminiProviderErrorFromResponse({
    provider: GEMINI_PROVIDER_NAME,
    operation: args.operation,
    statusCode: args.response.status,
    requestId: args.requestId,
    traceId: args.traceId,
    payload,
    headers: args.response.headers,
    fallbackMessage:
      payload?.error?.message ||
      `Gemini request failed with status ${args.response.status}.`,
  });
}

function normalizeGeminiUsage(
  usage: GeminiUsageMetadata | undefined,
): NormalizedGeminiUsage {
  if (!usage) {
    return {};
  }

  const normalizedUsage = removeUndefinedValues({
    inputTokens: usage.promptTokenCount,
    outputTokens: usage.candidatesTokenCount,
    totalTokens: usage.totalTokenCount,
  });
  const usageMetadata = removeUndefinedValues({
    cachedContentTokenCount: usage.cachedContentTokenCount,
    candidatesTokensDetails: normalizeGeminiModalityTokenDetails(
      usage.candidatesTokensDetails,
    ),
    cacheTokensDetails: normalizeGeminiModalityTokenDetails(
      usage.cacheTokensDetails,
    ),
    promptTokensDetails: normalizeGeminiModalityTokenDetails(
      usage.promptTokensDetails,
    ),
    thoughtsTokenCount: usage.thoughtsTokenCount,
    toolUsePromptTokenCount: usage.toolUsePromptTokenCount,
    toolUsePromptTokensDetails: normalizeGeminiModalityTokenDetails(
      usage.toolUsePromptTokensDetails,
    ),
  });

  return {
    ...(hasEntries(normalizedUsage) ? { usage: normalizedUsage } : {}),
    ...(hasEntries(usageMetadata) ? { usageMetadata } : {}),
  };
}

function normalizeGeminiModalityTokenDetails(
  details: GeminiModalityTokenCount[] | undefined,
): LLMProviderMetadata | undefined {
  if (!details || details.length === 0) {
    return undefined;
  }

  return {
    modalities: details
      .map((detail) =>
        removeUndefinedValues({
          modality:
            typeof detail.modality === "string"
              ? detail.modality.toLowerCase()
              : undefined,
          tokenCount: detail.tokenCount,
        }),
      )
      .filter((detail) => hasEntries(detail)),
  };
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

function buildGeminiGenerationConfig(args: {
  defaultMaxOutputTokens: number;
  generation?: LLMProviderGenerationOptions;
  responseMimeType?: string;
  responseSchema?: Record<string, unknown>;
}): LLMProviderMetadata {
  return removeUndefinedValues({
    frequencyPenalty: normalizeFiniteNumber(args.generation?.frequencyPenalty),
    maxOutputTokens:
      normalizePositiveInteger(args.generation?.maxTokens) ??
      args.defaultMaxOutputTokens,
    presencePenalty: normalizeFiniteNumber(args.generation?.presencePenalty),
    responseMimeType: args.responseMimeType,
    responseSchema: args.responseSchema,
    seed: normalizeInteger(args.generation?.seed),
    stopSequences: normalizeStopSequences(args.generation?.stopSequences),
    temperature: normalizeFiniteNumber(args.generation?.temperature),
    topK: normalizePositiveInteger(args.generation?.topK),
    topP: normalizeFiniteNumber(args.generation?.topP),
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

function buildGeminiSystemInstruction(
  instruction: string | undefined,
): GeminiContent | undefined {
  const text = instruction?.trim();

  if (!text) {
    return undefined;
  }

  return {
    parts: [
      {
        text,
      },
    ],
  };
}

function buildGeminiContents(
  input: string | readonly GeminiContent[],
): GeminiContent[] {
  if (typeof input === "string") {
    return [
      createGeminiUserContent([
        {
          text: input,
        },
      ]),
    ];
  }

  return input.map((content) => ({
    ...content,
    parts: content.parts.filter((part) => geminiPartHasContent(part)),
  }));
}

function geminiPartHasContent(part: GeminiContentPart): boolean {
  if ("text" in part) {
    return part.text.trim().length > 0;
  }

  if ("inline_data" in part) {
    return (
      part.inline_data.data.trim().length > 0 &&
      part.inline_data.mime_type.trim().length > 0
    );
  }

  return (
    part.file_data.file_uri.trim().length > 0 &&
    part.file_data.mime_type.trim().length > 0
  );
}

function createGeminiUserContent(parts: GeminiContentPart[]): GeminiContent {
  return {
    role: "user",
    parts,
  };
}

export function normalizeGeminiGenerateContentResult(
  payload: GeminiGenerateContentResponsePayload,
): LLMProviderResult | undefined {
  const candidate = payload.candidates?.[0];
  const content = extractGeminiAssistantContentBlocks(candidate);
  const refusal = extractGeminiRefusal(candidate, payload.promptFeedback);

  if (content.length === 0 && refusal) {
    content.push({
      type: "refusal",
      refusal,
    });
  }

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
  const finishReason = normalizeGeminiFinishReason(candidate?.finishReason);

  if (finishReason) {
    result.finishReason = finishReason;
  }

  return result;
}

function extractGeminiAssistantContentBlocks(
  candidate: GeminiCandidate | undefined,
): LLMProviderResult["content"] {
  const blocks: LLMProviderResult["content"][number][] = [];

  for (const part of candidate?.content?.parts ?? []) {
    if (typeof part?.text !== "string") {
      continue;
    }

    const text = part.text.trim();

    if (text.length === 0) {
      continue;
    }

    blocks.push({
      type: "text",
      text,
    });
  }

  return blocks;
}

function extractGeminiRefusal(
  candidate: GeminiCandidate | undefined,
  promptFeedback: GeminiGenerateContentResponsePayload["promptFeedback"],
): string | undefined {
  const finishMessage = candidate?.finishMessage?.trim();

  if (finishMessage) {
    return finishMessage;
  }

  const blockReason = promptFeedback?.blockReason?.trim();

  if (blockReason) {
    return `Gemini blocked the prompt: ${blockReason}.`;
  }

  if (normalizeGeminiFinishReason(candidate?.finishReason) === "content-filter") {
    return "Gemini blocked the response for safety or policy reasons.";
  }

  return undefined;
}

function normalizeGeminiFinishReason(
  reason: string | undefined,
): LLMProviderFinishReason | undefined {
  if (!reason || reason.trim().length === 0) {
    return undefined;
  }

  switch (reason) {
    case "STOP":
      return "stop";
    case "MAX_TOKENS":
      return "length";
    case "SAFETY":
    case "RECITATION":
    case "LANGUAGE":
    case "BLOCKLIST":
    case "PROHIBITED_CONTENT":
    case "SPII":
    case "IMAGE_SAFETY":
    case "IMAGE_PROHIBITED_CONTENT":
    case "IMAGE_RECITATION":
      return "content-filter";
    case "UNEXPECTED_TOOL_CALL":
    case "TOO_MANY_TOOL_CALLS":
    case "MALFORMED_FUNCTION_CALL":
      return "tool-calls";
    case "MALFORMED_RESPONSE":
    case "MISSING_THOUGHT_SIGNATURE":
    case "NO_IMAGE":
    case "IMAGE_OTHER":
      return "error";
    default:
      return "unknown";
  }
}

function clampTextToCharacterLimit(text: string, maxCharacters: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (maxCharacters < 1 || normalized.length <= maxCharacters) {
    return normalized;
  }

  return normalized.slice(0, maxCharacters).trimEnd();
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
      provider: GEMINI_PROVIDER_NAME,
      operation: "classifyMetadata",
      message: "Gemini metadata classification response was not valid JSON.",
      retryable: false,
      requestId,
      traceId,
      cause: error,
    });
  }

  if (!isMetadataClassificationOutput(parsed)) {
    throw new LLMProviderError({
      code: "INVALID_RESPONSE",
      provider: GEMINI_PROVIDER_NAME,
      operation: "classifyMetadata",
      message:
        "Gemini metadata classification response did not match the expected schema.",
      retryable: false,
      requestId,
      traceId,
    });
  }

  return parsed;
}

function isMetadataClassificationOutput(
  value: unknown,
): value is MetadataClassificationOutput {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<MetadataClassificationOutput>;

  return (
    Array.isArray(candidate.tags) &&
    candidate.tags.every((tag) => typeof tag === "string") &&
    typeof candidate.domain === "string" &&
    typeof candidate.mood === "string" &&
    typeof candidate.actionability === "string"
  );
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

function removeUndefinedValues<T extends Record<string, unknown>>(
  value: T,
): T & LLMProviderMetadata {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T & LLMProviderMetadata;
}
