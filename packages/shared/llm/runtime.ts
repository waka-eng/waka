import {
  LLM_PROVIDER_NAMES,
  LLMProviderError,
  type LLMProvider,
  type GenerateEmbeddingRequest,
  type GenerateEmbeddingResponse,
  type LLMProviderName,
  type LLMProviderOperation,
  type LLMProviderRequestFor,
  type LLMProviderResponseFor,
  type LLMProviderUsage,
} from "./provider.ts";
import {
  createOpenAIProviderErrorFromException,
  createOpenAIProviderErrorFromResponse,
} from "./openai-error.ts";

export const DEFAULT_LLM_PROVIDER: LLMProviderName = "openai";
export const OPENAI_EMBEDDING_PROVIDER: LLMProviderName = "openai";
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
export const OPENAI_EMBEDDING_DIMENSIONS = 1536;
export const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface LLMRuntimeEnvironment {
  LLM_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  GEMINI_API_KEY?: string;
}

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers?: unknown;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<FetchResponseLike>;

export interface OpenAIEmbeddingClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: FetchLike;
}

export interface ResolvedLLMRuntimeConfig {
  readonly nonEmbeddingProvider: LLMProviderName;
  readonly embeddingProvider: typeof OPENAI_EMBEDDING_PROVIDER;
}

export type NonEmbeddingLLMOperation = Exclude<
  LLMProviderOperation,
  "generateEmbedding"
>;

export type NonEmbeddingLLMClient = Pick<
  LLMProvider,
  "provider" | "supportedOperations" | NonEmbeddingLLMOperation
>;

export type NonEmbeddingProviderRegistry<
  TProvider extends Pick<LLMProvider, "provider"> = LLMProvider,
> = Partial<Record<LLMProviderName, TProvider>>;

export type NonEmbeddingClientRegistry<
  TClient extends NonEmbeddingLLMClient = NonEmbeddingLLMClient,
> = Partial<Record<LLMProviderName, TClient>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFiniteNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((entry) => Number.isFinite(entry));
}

function normalizeTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeBaseUrl(baseUrl: string | undefined): string {
  const candidate = baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL;

  return candidate.replace(/\/+$/, "");
}

function parseLLMProviderName(rawProvider: string | undefined): LLMProviderName {
  const normalizedProvider = rawProvider?.trim().toLowerCase();

  if (!normalizedProvider) {
    return DEFAULT_LLM_PROVIDER;
  }

  if ((LLM_PROVIDER_NAMES as readonly string[]).includes(normalizedProvider)) {
    return normalizedProvider as LLMProviderName;
  }

  throw new TypeError(
    `LLM_PROVIDER must be either "openai" or "gemini"; received "${rawProvider}".`,
  );
}

function resolveFetchImplementation(fetchImplementation?: FetchLike): FetchLike {
  if (fetchImplementation) {
    return fetchImplementation;
  }

  if (typeof globalThis.fetch !== "function") {
    throw new TypeError(
      "A fetch implementation is required to generate embeddings.",
    );
  }

  return globalThis.fetch.bind(globalThis) as FetchLike;
}

function parseUsage(payload: unknown): LLMProviderUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) {
    return undefined;
  }

  const inputTokens =
    normalizeTokenCount(payload.usage.prompt_tokens) ??
    normalizeTokenCount(payload.usage.input_tokens);
  const outputTokens =
    normalizeTokenCount(payload.usage.completion_tokens) ??
    normalizeTokenCount(payload.usage.output_tokens);
  const totalTokens = normalizeTokenCount(payload.usage.total_tokens);

  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function normalizeEmbedding(
  payload: unknown,
  request: GenerateEmbeddingRequest,
): number[] {
  if (!isRecord(payload) || !Array.isArray(payload.data) || payload.data.length === 0) {
    throw new LLMProviderError({
      code: "INVALID_RESPONSE",
      provider: OPENAI_EMBEDDING_PROVIDER,
      operation: request.operation,
      message: "OpenAI embeddings response did not include a data array.",
      retryable: false,
      requestId: request.requestId,
      traceId: request.traceId,
      details: {
        expectedDimensions: OPENAI_EMBEDDING_DIMENSIONS,
      },
    });
  }

  const firstVector = payload.data[0];

  if (!isRecord(firstVector) || !isFiniteNumberArray(firstVector.embedding)) {
    throw new LLMProviderError({
      code: "INVALID_RESPONSE",
      provider: OPENAI_EMBEDDING_PROVIDER,
      operation: request.operation,
      message: "OpenAI embeddings response did not include a numeric embedding vector.",
      retryable: false,
      requestId: request.requestId,
      traceId: request.traceId,
      details: {
        expectedDimensions: OPENAI_EMBEDDING_DIMENSIONS,
      },
    });
  }

  if (firstVector.embedding.length !== OPENAI_EMBEDDING_DIMENSIONS) {
    throw new LLMProviderError({
      code: "INVALID_RESPONSE",
      provider: OPENAI_EMBEDDING_PROVIDER,
      operation: request.operation,
      message: `OpenAI embeddings must be ${OPENAI_EMBEDDING_DIMENSIONS} dimensions, received ${firstVector.embedding.length}.`,
      retryable: false,
      requestId: request.requestId,
      traceId: request.traceId,
      details: {
        actualDimensions: firstVector.embedding.length,
        expectedDimensions: OPENAI_EMBEDDING_DIMENSIONS,
      },
    });
  }

  return firstVector.embedding;
}

async function readErrorPayload(response: FetchResponseLike): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    try {
      return await response.text();
    } catch {
      return undefined;
    }
  }
}

export function resolveLLMProviderName(
  env: Pick<LLMRuntimeEnvironment, "LLM_PROVIDER">,
): LLMProviderName {
  return resolveLLMRuntimeConfig(env).nonEmbeddingProvider;
}

export function resolveNonEmbeddingProviderName(
  env: Pick<LLMRuntimeEnvironment, "LLM_PROVIDER">,
): LLMProviderName {
  return resolveLLMProviderName(env);
}

export function resolveLLMRuntimeConfig(
  env: Pick<LLMRuntimeEnvironment, "LLM_PROVIDER">,
): ResolvedLLMRuntimeConfig {
  return {
    nonEmbeddingProvider: parseLLMProviderName(env.LLM_PROVIDER),
    embeddingProvider: OPENAI_EMBEDDING_PROVIDER,
  };
}

export function resolveEmbeddingProviderName(
  env: Pick<LLMRuntimeEnvironment, "LLM_PROVIDER">,
): typeof OPENAI_EMBEDDING_PROVIDER {
  return resolveLLMRuntimeConfig(env).embeddingProvider;
}

export function createNonEmbeddingProviderFromEnv<
  TProvider extends Pick<LLMProvider, "provider">,
>(
  env: Pick<LLMRuntimeEnvironment, "LLM_PROVIDER">,
  providers: NonEmbeddingProviderRegistry<TProvider>,
): TProvider {
  const providerName = resolveNonEmbeddingProviderName(env);
  const provider = providers[providerName];

  if (!provider) {
    throw new TypeError(
      `A ${providerName} provider implementation must be registered for non-embedding LLM tasks.`,
    );
  }

  return provider;
}

export function createNonEmbeddingClientFromEnv<
  TClient extends NonEmbeddingLLMClient,
>(
  env: Pick<LLMRuntimeEnvironment, "LLM_PROVIDER">,
  clients: NonEmbeddingClientRegistry<TClient>,
): TClient {
  return createNonEmbeddingProviderFromEnv(env, clients);
}

export function executeNonEmbeddingRequest<
  TOperation extends NonEmbeddingLLMOperation,
>(
  client: NonEmbeddingLLMClient,
  request: LLMProviderRequestFor<TOperation>,
): Promise<LLMProviderResponseFor<TOperation>> {
  switch (request.operation) {
    case "classify":
      return client.classify(
        request as LLMProviderRequestFor<"classify">,
      ) as Promise<LLMProviderResponseFor<TOperation>>;
    case "summarize":
      return client.summarize(
        request as LLMProviderRequestFor<"summarize">,
      ) as Promise<LLMProviderResponseFor<TOperation>>;
    case "generateReflection":
      return client.generateReflection(
        request as LLMProviderRequestFor<"generateReflection">,
      ) as Promise<LLMProviderResponseFor<TOperation>>;
    case "explainConnection":
      return client.explainConnection(
        request as LLMProviderRequestFor<"explainConnection">,
      ) as Promise<LLMProviderResponseFor<TOperation>>;
    case "generateTitle":
      return client.generateTitle(
        request as LLMProviderRequestFor<"generateTitle">,
      ) as Promise<LLMProviderResponseFor<TOperation>>;
    case "classifyMetadata":
      return client.classifyMetadata(
        request as LLMProviderRequestFor<"classifyMetadata">,
      ) as Promise<LLMProviderResponseFor<TOperation>>;
    case "transcribeAudio":
      return client.transcribeAudio(
        request as LLMProviderRequestFor<"transcribeAudio">,
      ) as Promise<LLMProviderResponseFor<TOperation>>;
    case "describeImage":
      return client.describeImage(
        request as LLMProviderRequestFor<"describeImage">,
      ) as Promise<LLMProviderResponseFor<TOperation>>;
  }

  throw new TypeError(
    `Unsupported non-embedding LLM operation: ${String(request.operation)}`,
  );
}

export function executeNonEmbeddingRequestFromEnv<
  TOperation extends NonEmbeddingLLMOperation,
>(
  env: Pick<LLMRuntimeEnvironment, "LLM_PROVIDER">,
  clients: NonEmbeddingClientRegistry,
  request: LLMProviderRequestFor<TOperation>,
): Promise<LLMProviderResponseFor<TOperation>> {
  const client = createNonEmbeddingClientFromEnv(env, clients);
  return executeNonEmbeddingRequest(client, request);
}

export function resolveOpenAIEmbeddingApiKey(
  env: Pick<LLMRuntimeEnvironment, "OPENAI_API_KEY">,
): string {
  if (typeof env.OPENAI_API_KEY !== "string" || env.OPENAI_API_KEY.trim().length === 0) {
    throw new TypeError(
      "OPENAI_API_KEY is required because embeddings are pinned to OpenAI text-embedding-3-small.",
    );
  }

  return env.OPENAI_API_KEY.trim();
}

export class OpenAIEmbeddingClient {
  readonly provider = OPENAI_EMBEDDING_PROVIDER;
  readonly model = OPENAI_EMBEDDING_MODEL;
  readonly dimensions = OPENAI_EMBEDDING_DIMENSIONS;

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImplementation: FetchLike;

  constructor(options: OpenAIEmbeddingClientOptions) {
    this.apiKey = options.apiKey.trim();
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetchImplementation = resolveFetchImplementation(options.fetch);
  }

  async generateEmbedding(
    request: GenerateEmbeddingRequest,
  ): Promise<GenerateEmbeddingResponse> {
    if (typeof request.input.text !== "string" || request.input.text.length === 0) {
      throw new LLMProviderError({
        code: "BAD_REQUEST",
        provider: this.provider,
        operation: request.operation,
        message: "Embedding input text must include at least 1 character.",
        retryable: false,
        requestId: request.requestId,
        traceId: request.traceId,
      });
    }

    let response: FetchResponseLike;

    try {
      response = await this.fetchImplementation(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: request.input.text,
          model: OPENAI_EMBEDDING_MODEL,
        }),
      });
    } catch (error) {
      throw createOpenAIProviderErrorFromException({
        provider: this.provider,
        operation: request.operation,
        requestId: request.requestId,
        traceId: request.traceId,
        error,
        fallbackMessage: "OpenAI embeddings request failed.",
      });
    }

    if (!response.ok) {
      const errorPayload = await readErrorPayload(response);

      throw createOpenAIProviderErrorFromResponse({
        provider: this.provider,
        operation: request.operation,
        statusCode: response.status,
        requestId: request.requestId,
        traceId: request.traceId,
        payload: errorPayload,
        headers: response.headers,
        fallbackMessage: `OpenAI embeddings request failed with status ${response.status}.`,
      });
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch (error) {
      throw new LLMProviderError({
        code: "INVALID_RESPONSE",
        provider: this.provider,
        operation: request.operation,
        message: "OpenAI embeddings response was not valid JSON.",
        retryable: false,
        requestId: request.requestId,
        traceId: request.traceId,
        cause: error,
      });
    }

    const embedding = normalizeEmbedding(payload, request);

    return {
      operation: request.operation,
      provider: this.provider,
      model: OPENAI_EMBEDDING_MODEL,
      requestId: request.requestId,
      traceId: request.traceId,
      usage: parseUsage(payload),
      output: {
        embedding,
        dimensions: OPENAI_EMBEDDING_DIMENSIONS,
      },
    };
  }
}

export function createEmbeddingClientFromEnv(
  env: LLMRuntimeEnvironment,
  options: Pick<OpenAIEmbeddingClientOptions, "fetch"> = {},
): OpenAIEmbeddingClient {
  return new OpenAIEmbeddingClient({
    apiKey: resolveOpenAIEmbeddingApiKey(env),
    baseUrl: env.OPENAI_BASE_URL,
    fetch: options.fetch,
  });
}
