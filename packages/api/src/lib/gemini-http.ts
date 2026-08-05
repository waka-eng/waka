const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 25_000;

export class ModelRequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Model request timed out after ${timeoutMs}ms`);
    this.name = "ModelRequestTimeoutError";
  }
}

export function getModelRequestTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.WAKA_MODEL_TIMEOUT_MS ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MODEL_REQUEST_TIMEOUT_MS;
  return Math.max(1_000, Math.min(parsed, 120_000));
}

/**
 * Bound every provider round-trip. Abort is not enough on its own because an
 * injected or non-conforming fetch implementation may ignore the signal, so
 * the explicit race guarantees the worker gets control back and can retry.
 */
export async function fetchModelWithTimeout(
  fetchFn: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  timeoutMs = getModelRequestTimeoutMs(),
): Promise<Response> {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new ModelRequestTimeoutError(timeoutMs));
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      fetchFn(input, { ...init, signal: controller.signal }),
      timeout,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

export function buildGeminiModelEndpoint(model: string, method: "generateContent" | "embedContent"): string {
  return `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:${method}`;
}

export function buildGeminiJsonHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };
}

export interface SafeGeminiErrorDetails {
  status: number;
  statusText: string;
  providerCode?: string;
}

function extractSafeProviderCode(body: unknown): string | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const error = (body as { error?: unknown }).error;
  if (error && typeof error === "object") {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "string" && /^[A-Z0-9_:-]{1,80}$/.test(status)) {
      return status;
    }
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number" && Number.isSafeInteger(code)) return String(code);
    if (typeof code === "string" && /^[A-Z0-9_:-]{1,80}$/.test(code)) return code;
  }
  const code = (body as { code?: unknown }).code;
  if (typeof code === "number" && Number.isSafeInteger(code)) return String(code);
  if (typeof code === "string" && /^[A-Z0-9_:-]{1,80}$/.test(code)) return code;
  return undefined;
}

export async function safeGeminiErrorDetails(response: Response): Promise<SafeGeminiErrorDetails> {
  let providerCode: string | undefined;
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.toLowerCase().includes("json")) {
      providerCode = extractSafeProviderCode(await response.clone().json());
    }
  } catch {
    providerCode = undefined;
  }

  return {
    status: response.status,
    statusText: response.statusText,
    ...(providerCode ? { providerCode } : {}),
  };
}

export function formatSafeGeminiError(prefix: string, details: SafeGeminiErrorDetails): string {
  const code = details.providerCode ? ` providerCode=${details.providerCode}` : "";
  return `${prefix}: HTTP ${details.status} ${details.statusText}${code}`;
}
