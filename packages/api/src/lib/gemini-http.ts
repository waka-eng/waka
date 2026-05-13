const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

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
