import {
  LLMProviderError,
  type LLMProviderErrorCode,
  type LLMProviderMetadata,
  type LLMProviderName,
  type LLMProviderOperation,
} from "./provider.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getNestedErrorRecord(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !isRecord(value.error)) {
    return undefined;
  }

  return value.error;
}

function getStringProperty(
  value: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const candidate = value?.[key];
  return typeof candidate === "string" && candidate.trim().length > 0
    ? candidate.trim()
    : undefined;
}

function getNumberProperty(
  value: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const candidate = value?.[key];
  return typeof candidate === "number" && Number.isFinite(candidate)
    ? candidate
    : undefined;
}

function normalizeOpenAIErrorFragment(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .replace(/__+/g, "_")
    .toLowerCase();

  return normalized.length > 0 ? normalized : undefined;
}

function extractOpenAIHeaders(value: unknown): unknown {
  if (!isRecord(value)) {
    return undefined;
  }

  const response = isRecord(value.response) ? value.response : undefined;
  return value.headers ?? response?.headers;
}

function getHeaderValue(headers: unknown, name: string): string | undefined {
  if (!headers) {
    return undefined;
  }

  if (
    typeof headers === "object" &&
    headers !== null &&
    "get" in headers &&
    typeof (headers as { get?: unknown }).get === "function"
  ) {
    const value = (headers as { get(name: string): string | null }).get(name);
    return typeof value === "string" && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  if (!isRecord(headers)) {
    return undefined;
  }

  const normalizedName = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== normalizedName) {
      continue;
    }

    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }

    if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "string" &&
      value[0].trim().length > 0
    ) {
      return value[0].trim();
    }
  }

  return undefined;
}

function extractStatusCode(value: unknown): number | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const response = isRecord(value.response) ? value.response : undefined;

  return (
    getNumberProperty(value, "status") ??
    getNumberProperty(value, "statusCode") ??
    getNumberProperty(response, "status") ??
    getNumberProperty(response, "statusCode")
  );
}

function extractMessage(value: unknown): string | undefined {
  const record = isRecord(value) ? value : undefined;
  const nestedError = getNestedErrorRecord(value);

  return (
    getStringProperty(nestedError, "message") ??
    getStringProperty(record, "message")
  );
}

function extractType(value: unknown): string | undefined {
  const record = isRecord(value) ? value : undefined;
  const nestedError = getNestedErrorRecord(value);

  return normalizeOpenAIErrorFragment(
    getStringProperty(nestedError, "type") ??
      getStringProperty(record, "type") ??
      getStringProperty(record, "name"),
  );
}

function extractProviderCode(value: unknown): string | undefined {
  const record = isRecord(value) ? value : undefined;
  const nestedError = getNestedErrorRecord(value);

  return normalizeOpenAIErrorFragment(
    getStringProperty(nestedError, "code") ?? getStringProperty(record, "code"),
  );
}

function extractParam(value: unknown): string | undefined {
  const record = isRecord(value) ? value : undefined;
  const nestedError = getNestedErrorRecord(value);

  return (
    getStringProperty(nestedError, "param") ??
    getStringProperty(record, "param")
  );
}

function extractRequestId(
  value: unknown,
  headers: unknown,
  fallbackRequestId?: string,
): string | undefined {
  const record = isRecord(value) ? value : undefined;

  return (
    getStringProperty(record, "request_id") ??
    getStringProperty(record, "requestId") ??
    getHeaderValue(headers, "x-request-id") ??
    fallbackRequestId
  );
}

function extractRetryAfterSeconds(headers: unknown): number | undefined {
  const rawRetryAfter = getHeaderValue(headers, "retry-after");

  if (!rawRetryAfter) {
    return undefined;
  }

  const retryAfterSeconds = Number(rawRetryAfter);
  return Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined;
}

function buildOpenAIErrorDetails(
  value: unknown,
  headers: unknown,
): LLMProviderMetadata | undefined {
  const details = removeUndefinedValues({
    code: extractProviderCode(value),
    param: extractParam(value),
    retryAfterSeconds: extractRetryAfterSeconds(headers),
    type: extractType(value),
  });

  return Object.keys(details).length > 0 ? details : undefined;
}

function mapOpenAIExceptionToErrorCode(error: unknown): LLMProviderErrorCode {
  const statusCode = extractStatusCode(error);

  if (statusCode !== undefined) {
    return mapOpenAIStatusCodeToProviderErrorCode(statusCode);
  }

  const type = extractType(error);
  const providerCode = extractProviderCode(error);
  const signal = `${type ?? ""} ${providerCode ?? ""}`.trim();

  if (
    signal.includes("timeout") ||
    signal.includes("timed_out")
  ) {
    return "TIMEOUT";
  }

  if (
    signal.includes("rate_limit") ||
    signal.includes("quota")
  ) {
    return "RATE_LIMITED";
  }

  if (
    signal.includes("authentication") ||
    signal.includes("permission") ||
    signal.includes("invalid_api_key")
  ) {
    return "AUTHENTICATION";
  }

  if (
    signal.includes("bad_request") ||
    signal.includes("invalid_request") ||
    signal.includes("not_found") ||
    signal.includes("unprocessable")
  ) {
    return "BAD_REQUEST";
  }

  if (
    signal.includes("api_connection") ||
    signal.includes("internal_server") ||
    signal.includes("server_error")
  ) {
    return "UNAVAILABLE";
  }

  return "UNKNOWN";
}

function inferRetryableFromException(
  error: unknown,
  normalizedCode: LLMProviderErrorCode,
  defaultRetryable: boolean,
): boolean {
  const statusCode = extractStatusCode(error);

  if (statusCode !== undefined) {
    return isRetryableOpenAIStatusCode(statusCode);
  }

  if (
    normalizedCode === "TIMEOUT" ||
    normalizedCode === "RATE_LIMITED" ||
    normalizedCode === "UNAVAILABLE"
  ) {
    return true;
  }

  if (
    normalizedCode === "AUTHENTICATION" ||
    normalizedCode === "BAD_REQUEST"
  ) {
    return false;
  }

  return defaultRetryable;
}

export function createOpenAIProviderErrorFromResponse(args: {
  provider: LLMProviderName;
  operation: LLMProviderOperation;
  statusCode: number;
  requestId?: string;
  traceId?: string;
  payload?: unknown;
  headers?: unknown;
  fallbackMessage?: string;
}): LLMProviderError {
  return new LLMProviderError({
    code: mapOpenAIStatusCodeToProviderErrorCode(args.statusCode),
    provider: args.provider,
    operation: args.operation,
    message:
      extractMessage(args.payload) ??
      args.fallbackMessage ??
      `OpenAI request failed with status ${args.statusCode}.`,
    retryable: isRetryableOpenAIStatusCode(args.statusCode),
    requestId: extractRequestId(args.payload, args.headers, args.requestId),
    traceId: args.traceId,
    statusCode: args.statusCode,
    details: buildOpenAIErrorDetails(args.payload, args.headers),
  });
}

export function createOpenAIProviderErrorFromException(args: {
  provider: LLMProviderName;
  operation: LLMProviderOperation;
  requestId?: string;
  traceId?: string;
  error: unknown;
  fallbackMessage: string;
  defaultRetryable?: boolean;
}): LLMProviderError {
  const headers = extractOpenAIHeaders(args.error);
  const statusCode = extractStatusCode(args.error);
  const code = mapOpenAIExceptionToErrorCode(args.error);

  return new LLMProviderError({
    code,
    provider: args.provider,
    operation: args.operation,
    message:
      extractMessage(args.error) ??
      (statusCode !== undefined
        ? `OpenAI request failed with status ${statusCode}.`
        : args.fallbackMessage),
    retryable: inferRetryableFromException(
      args.error,
      code,
      args.defaultRetryable ?? true,
    ),
    requestId: extractRequestId(args.error, headers, args.requestId),
    traceId: args.traceId,
    statusCode,
    details: buildOpenAIErrorDetails(args.error, headers),
    cause: args.error,
  });
}

export function mapOpenAIStatusCodeToProviderErrorCode(
  statusCode: number,
): LLMProviderErrorCode {
  if (statusCode === 400 || statusCode === 404 || statusCode === 422) {
    return "BAD_REQUEST";
  }

  if (statusCode === 401 || statusCode === 403) {
    return "AUTHENTICATION";
  }

  if (statusCode === 408) {
    return "TIMEOUT";
  }

  if (statusCode === 429) {
    return "RATE_LIMITED";
  }

  if (statusCode >= 500) {
    return "UNAVAILABLE";
  }

  return "UNKNOWN";
}

export function isRetryableOpenAIStatusCode(statusCode: number): boolean {
  return (
    statusCode === 408 ||
    statusCode === 409 ||
    statusCode === 429 ||
    statusCode >= 500
  );
}

function removeUndefinedValues<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
