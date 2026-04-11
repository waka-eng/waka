import type {
  LLMProviderName,
} from "../../packages/shared/llm/provider.ts";
import type {
  NonEmbeddingLLMClient,
  NonEmbeddingLLMOperation,
} from "../../packages/shared/llm/runtime.ts";

export interface LLMProviderInvocation {
  operation: NonEmbeddingLLMOperation;
  provider: LLMProviderName;
  requestId?: string;
  traceId?: string;
}

export type TrackedNonEmbeddingClient = NonEmbeddingLLMClient & {
  invocations: LLMProviderInvocation[];
};

export interface LLMProviderSelectionFixture {
  clients: Record<LLMProviderName, TrackedNonEmbeddingClient>;
  getInvocations(): readonly LLMProviderInvocation[];
  getInvocationsFor(
    provider: LLMProviderName,
  ): readonly LLMProviderInvocation[];
  resetInvocations(): void;
  withProvider<T>(
    provider: LLMProviderName | undefined,
    callback: () => Promise<T> | T,
  ): Promise<T>;
}

const NON_EMBEDDING_OPERATIONS = [
  "classify",
  "summarize",
  "generateReflection",
  "explainConnection",
  "generateTitle",
  "classifyMetadata",
  "transcribeAudio",
  "describeImage",
] as const satisfies readonly NonEmbeddingLLMOperation[];

function getTextModel(provider: LLMProviderName): string {
  return provider === "openai" ? "gpt-5-mini" : "gemini-2.5-flash";
}

function getTranscriptionModel(provider: LLMProviderName): string {
  return provider === "openai"
    ? "gpt-4o-mini-transcribe"
    : "gemini-2.0-flash-exp";
}

function getVisionModel(provider: LLMProviderName): string {
  return provider === "openai" ? "gpt-4.1-mini" : getTextModel(provider);
}

function recordInvocation(
  providerInvocations: LLMProviderInvocation[],
  allInvocations: LLMProviderInvocation[],
  provider: LLMProviderName,
  operation: NonEmbeddingLLMOperation,
  requestId?: string,
  traceId?: string,
) {
  const invocation = {
    provider,
    operation,
    requestId,
    traceId,
  } satisfies LLMProviderInvocation;

  providerInvocations.push(invocation);
  allInvocations.push(invocation);
}

export function createTrackedNonEmbeddingClient(
  provider: LLMProviderName,
  allInvocations: LLMProviderInvocation[] = [],
): TrackedNonEmbeddingClient {
  const textModel = getTextModel(provider);
  const transcriptionModel = getTranscriptionModel(provider);
  const visionModel = getVisionModel(provider);
  const invocations: LLMProviderInvocation[] = [];

  return {
    provider,
    invocations,
    supportedOperations: [...NON_EMBEDDING_OPERATIONS],
    async classify(request) {
      recordInvocation(
        invocations,
        allInvocations,
        provider,
        request.operation,
        request.requestId,
        request.traceId,
      );

      return {
        operation: "classify",
        provider,
        model: textModel,
        requestId: request.requestId,
        traceId: request.traceId,
        output: {
          classification: `${provider}:classification`,
        },
      };
    },
    async summarize(request) {
      recordInvocation(
        invocations,
        allInvocations,
        provider,
        request.operation,
        request.requestId,
        request.traceId,
      );

      return {
        operation: "summarize",
        provider,
        model: textModel,
        requestId: request.requestId,
        traceId: request.traceId,
        output: {
          summary: `${provider}:summary`,
        },
      };
    },
    async generateReflection(request) {
      recordInvocation(
        invocations,
        allInvocations,
        provider,
        request.operation,
        request.requestId,
        request.traceId,
      );

      return {
        operation: "generateReflection",
        provider,
        model: textModel,
        requestId: request.requestId,
        traceId: request.traceId,
        output: {
          reflectionPrompt: `${provider}:reflection`,
        },
      };
    },
    async explainConnection(request) {
      recordInvocation(
        invocations,
        allInvocations,
        provider,
        request.operation,
        request.requestId,
        request.traceId,
      );

      return {
        operation: "explainConnection",
        provider,
        model: textModel,
        requestId: request.requestId,
        traceId: request.traceId,
        output: {
          explanation: `${provider}:connection`,
        },
      };
    },
    async generateTitle(request) {
      recordInvocation(
        invocations,
        allInvocations,
        provider,
        request.operation,
        request.requestId,
        request.traceId,
      );

      return {
        operation: "generateTitle",
        provider,
        model: textModel,
        requestId: request.requestId,
        traceId: request.traceId,
        output: {
          title: `${provider}:title`,
        },
      };
    },
    async classifyMetadata(request) {
      recordInvocation(
        invocations,
        allInvocations,
        provider,
        request.operation,
        request.requestId,
        request.traceId,
      );

      return {
        operation: "classifyMetadata",
        provider,
        model: textModel,
        requestId: request.requestId,
        traceId: request.traceId,
        output: {
          actionability: "idea",
          domain: "technology",
          mood: "curious",
          tags: [`${provider}:tag`],
        },
      };
    },
    async transcribeAudio(request) {
      recordInvocation(
        invocations,
        allInvocations,
        provider,
        request.operation,
        request.requestId,
        request.traceId,
      );

      return {
        operation: "transcribeAudio",
        provider,
        model: transcriptionModel,
        requestId: request.requestId,
        traceId: request.traceId,
        output: {
          transcript: `${provider}:transcript`,
        },
      };
    },
    async describeImage(request) {
      recordInvocation(
        invocations,
        allInvocations,
        provider,
        request.operation,
        request.requestId,
        request.traceId,
      );

      return {
        operation: "describeImage",
        provider,
        model: visionModel,
        requestId: request.requestId,
        traceId: request.traceId,
        output: {
          description: `${provider}:description`,
        },
      };
    },
  };
}

export async function withLLMProvider<T>(
  provider: LLMProviderName | undefined,
  callback: () => Promise<T> | T,
): Promise<T> {
  const previousProvider = process.env.LLM_PROVIDER;

  if (provider === undefined) {
    delete process.env.LLM_PROVIDER;
  } else {
    process.env.LLM_PROVIDER = provider;
  }

  try {
    return await callback();
  } finally {
    if (previousProvider === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = previousProvider;
    }
  }
}

export function createLLMProviderSelectionFixture(): LLMProviderSelectionFixture {
  const allInvocations: LLMProviderInvocation[] = [];
  const clients = {
    openai: createTrackedNonEmbeddingClient("openai", allInvocations),
    gemini: createTrackedNonEmbeddingClient("gemini", allInvocations),
  };

  return {
    clients,
    getInvocations() {
      return [...allInvocations];
    },
    getInvocationsFor(provider) {
      return [...clients[provider].invocations];
    },
    resetInvocations() {
      allInvocations.length = 0;
      clients.openai.invocations.length = 0;
      clients.gemini.invocations.length = 0;
    },
    withProvider(provider, callback) {
      return withLLMProvider(provider, callback);
    },
  };
}
