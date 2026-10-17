import {recordModelUsage} from './model-usage.js';
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL_REQUEST_TIMEOUT_MS = 25_000;

/**
 * The road's patience for the ENTIRE answer, headers and body both.
 *
 * With streaming off, the provider sends the body only when generation
 * finishes — so "reading the body" IS the generation time, and the 25s
 * header deadline used to be cleared the moment headers arrived, leaving
 * `response.json()` unbounded. Observed live (2026-08-31, pipeline eval
 * run 2): one extraction call answered 200 and then stalled its body for
 * seven minutes until the test runner killed the process — the other half
 * of the 2026-08-30 finish_reason:length incident, which bounded the
 * answer's SIZE but not its TIME. Three minutes is far past any legitimate
 * generation under OPENROUTER_MAX_OUTPUT_TOKENS with reasoning off (the
 * slowest healthy full pipeline runs finish ~15 calls in under 100s); a
 * stall past it is a hang, and the timeout throws. A background job that
 * lets it escape is retried by the queue's backoff with time left to
 * matter. A chat reply is the exception: it is deliberately not replayed
 * (conversation-replies.ts marks it failed and the person's Retry button
 * spends the next attempt).
 */
const DEFAULT_MODEL_EXCHANGE_TIMEOUT_MS = 180_000;

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

export function getModelExchangeTimeoutMs(): number {
  const parsed = Number.parseInt(process.env.WAKA_MODEL_EXCHANGE_TIMEOUT_MS ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MODEL_EXCHANGE_TIMEOUT_MS;
  return Math.max(1_000, Math.min(parsed, 600_000));
}

/** Statuses the Response constructor refuses a body for. */
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

/**
 * Bound every provider round-trip. Abort is not enough on its own because an
 * injected or non-conforming fetch implementation may ignore the signal, so
 * the explicit race guarantees the worker gets control back and can retry.
 *
 * Two deadlines: `timeoutMs` to the response HEADERS (a road that cannot
 * even answer in 25s is down), and `exchangeTimeoutMs` to the fully-read
 * BODY (generation time lives here; see DEFAULT_MODEL_EXCHANGE_TIMEOUT_MS).
 * The body is buffered inside the deadline and handed back as a rebuilt
 * Response, so callers keep reading `.ok` / `.json()` exactly as before —
 * now from memory, with nothing left unbounded.
 */
export async function fetchModelWithTimeout(
  fetchFn: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit = {},
  timeoutMs = getModelRequestTimeoutMs(),
  exchangeTimeoutMs = Math.max(getModelExchangeTimeoutMs(), getModelRequestTimeoutMs()),
  label?:string,
): Promise<Response> {
  const started=performance.now();let google=false,usageRecorded=false,operation=label??'other';
  try{const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);google=url.hostname==='generativelanguage.googleapis.com';
    if(!label&&url.pathname.endsWith(':embedContent'))operation='embedding';}catch{/* Unknown destinations carry no provider attribution. */}
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  let headerTimer: ReturnType<typeof setTimeout> | undefined;
  let exchangeTimer: ReturnType<typeof setTimeout> | undefined;
  const headerDeadline = new Promise<never>((_, reject) => {
    headerTimer = setTimeout(() => {
      controller.abort();
      reject(new ModelRequestTimeoutError(timeoutMs));
    }, timeoutMs);
  });
  const exchangeDeadline = new Promise<never>((_, reject) => {
    exchangeTimer = setTimeout(() => {
      controller.abort();
      reject(new ModelRequestTimeoutError(exchangeTimeoutMs));
    }, exchangeTimeoutMs);
  });

  try {
    const response = await Promise.race([
      fetchFn(input, { ...init, signal: controller.signal }),
      headerDeadline,
      exchangeDeadline,
    ]);
    if (headerTimer) clearTimeout(headerTimer);
    const body = await Promise.race([response.arrayBuffer(), exchangeDeadline]);
    if(google){let usage:unknown=null;try{usage=JSON.parse(new TextDecoder().decode(body));}catch{/* Unpriced remains explicit. */}
      recordModelUsage('gemini',operation,usage,performance.now()-started,response.ok?'received':'http_error');usageRecorded=true;}
    return new Response(NULL_BODY_STATUSES.has(response.status) ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch(error){if(google&&!usageRecorded)recordModelUsage('gemini',operation,null,performance.now()-started,'unknown');throw error;} finally {
    if (headerTimer) clearTimeout(headerTimer);
    if (exchangeTimer) clearTimeout(exchangeTimer);
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
