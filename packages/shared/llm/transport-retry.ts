import { isLLMProviderError } from "./provider.ts";

export const DEFAULT_LLM_PROVIDER_MAX_RETRIES = 3;
export const LLM_PROVIDER_RETRY_BASE_DELAY_MS = 250;

export interface LLMProviderRetryOptions {
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function calculateLLMProviderRetryDelayMs(attempt: number): number {
  return LLM_PROVIDER_RETRY_BASE_DELAY_MS * 2 ** attempt;
}

export async function withLLMProviderRetry<T>(
  run: () => Promise<T>,
  options: LLMProviderRetryOptions = {},
): Promise<T> {
  const maxRetries = normalizeMaxRetries(options.maxRetries);
  const sleep = options.sleep ?? sleepFor;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isRetryableProviderError(error) || attempt >= maxRetries) {
        throw error;
      }

      await sleep(calculateLLMProviderRetryDelayMs(attempt));
    }
  }
}

function isRetryableProviderError(error: unknown): boolean {
  return isLLMProviderError(error) && error.retryable;
}

function normalizeMaxRetries(maxRetries?: number): number {
  if (maxRetries === undefined || !Number.isFinite(maxRetries)) {
    return DEFAULT_LLM_PROVIDER_MAX_RETRIES;
  }

  return Math.max(0, Math.floor(maxRetries));
}

function sleepFor(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
