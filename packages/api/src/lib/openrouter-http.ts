/**
 * The OpenRouter transport — the second road to a model, same discipline as
 * the first (founder, 2026-08-30: generation moves to OpenRouter so the
 * model under any task can change with an env var, not a rewrite).
 *
 * This file owns exactly what gemini-http.ts owns for Gemini: the key, the
 * endpoint, the headers, the timeout, and turning an HTTP answer into
 * "parsed JSON or null" without ever leaking a response body into an error
 * message. Everything about WHAT is asked lives in queue/gemini.ts's prompt
 * builders, which both transports share — a prompt that exists twice is a
 * prompt that drifts.
 *
 * Failure posture mirrors the incumbent exactly: malformed envelope, refusal,
 * or non-JSON content returns null (the callers' parsers all treat null as
 * their safe verdict); HTTP-level failure throws with status only.
 */
import { z } from "zod";

import {
  fetchModelWithTimeout,
  formatSafeGeminiError,
  safeGeminiErrorDetails,
} from "./gemini-http.js";
import { MODEL_DECLINED } from "./model-provider.js";
import {recordModelUsage} from './model-usage.js';

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** The shared text-task default (owner request, 2026-10-22).
    Top of Mind synthesis and review have their own explicit model below.
    Pin the October 17 V4.1 snapshot, not a floating `-latest` alias. A model
    change is an owner decision with verification, never a silent upgrade. */
export const OPENROUTER_GENERATION_MODEL =
  process.env.OPENROUTER_GENERATION_MODEL ?? "deepseek/deepseek-v4.1-flash-1017";

/** Owner choice: Top of Mind synthesis and review use Terra (2026-10-29).
 * Each task retains its own override. */
export const OPENROUTER_TOP_OF_MIND_MODEL = "openai/gpt-6.1-terra";

export function getOpenRouterApiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function buildOpenRouterHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    /* attribution, per OpenRouter's convention — shows up in their dashboard
       so spend is legible per app */
    "HTTP-Referer": "https://waka.im",
    "X-Title": "WAKA",
  };
}

/** The OpenAI-shaped chat request this transport sends. */
export interface OpenRouterChatRequest {
  model: string;
  messages: Array<{ role: "system" | "user"; content: string | Array<
    { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
  > }>;
  temperature?: number;
  max_tokens?: number;
  /** OpenRouter's unified reasoning control; providers that cannot honor it
      ignore it, which is the behavior we want */
  reasoning?: { enabled?: boolean; effort?: 'low' | 'medium'; exclude?: boolean };
  provider?:{data_collection?:'deny';zdr?:true};
  response_format?:
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: { name: string; strict?: boolean; schema: unknown } };
}

/**
 * EVERY ANSWER HERE IS A BOUNDED JSON ARTIFACT, so the transport says so.
 *
 * Observed live (2026-08-30, local worker): OpenRouter routed a batch to a
 * backend that reasons at length by default — single calls ran for minutes
 * and then came back `finish_reason: "length"`, a JSON object truncated
 * mid-key, which the parser correctly refuses… silently, as "no candidates".
 * A judge that thinks for five minutes about a two-sentence comparison is
 * not being careful, it is being routed somewhere this workload never asked
 * to go. `max_tokens` bounds the answer far above anything a real artifact
 * needs; `reasoning: { enabled: false }` asks the route not to spend tokens
 * thinking out loud into the budget.
 */
export const OPENROUTER_MAX_OUTPUT_TOKENS = 8_192;

const chatResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string().nullable().optional() }).passthrough(),
            finish_reason: z.string().nullable().optional(),
          })
          .passthrough(),
      )
      .optional(),
    error: z.object({ message: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

/**
 * Some models wrap even schema-constrained JSON in a markdown fence. The
 * incumbent never does, so its transport never had to care; this one strips
 * one outer fence defensively before parsing.
 */
export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/** Only restrictive overrides are supported; omission retains account policy.
 * A request never disables an account-level privacy requirement. */
export function openRouterPrivacyPreferences(){
  const collection=process.env.WAKA_OPENROUTER_DATA_COLLECTION,zdr=process.env.WAKA_OPENROUTER_REQUIRE_ZDR;
  if(collection!==undefined&&collection!==''&&collection!=='deny')throw new Error('OpenRouter data-collection policy must be deny or unset');
  if(zdr!==undefined&&zdr!==''&&zdr!=='0'&&zdr!=='1')throw new Error('OpenRouter retention policy must be 0, 1 or unset');
  return {...(collection==='deny'||zdr==='1'?{data_collection:'deny' as const}:{}),...(zdr==='1'?{zdr:true as const}:{})};
}

/** A status-only failure lets media adapters retain their retry policy. */
export class OpenRouterHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'OpenRouterHttpError';
  }
}

export async function callOpenRouter(
  request: OpenRouterChatRequest,
  label: string,
  options: { apiKey?: string; fetchFn?: typeof fetch } = {},
): Promise<unknown | null | typeof MODEL_DECLINED> {
  const apiKey = options.apiKey ?? getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error("OpenRouter API key is not configured (OPENROUTER_API_KEY).");
  }
  const privacy=openRouterPrivacyPreferences();
  const dispatched=Object.keys(privacy).length?{...request,provider:{...request.provider,...privacy}}:request;

  /* one quiet line per call while the road is new — which task, which model */
  console.log(`[openrouter] ${label} → ${request.model}`);
  const started=performance.now();let response:Response;
  try{response=await fetchModelWithTimeout(options.fetchFn ?? fetch, OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: buildOpenRouterHeaders(apiKey),
    body: JSON.stringify(dispatched),
  });}catch(error){recordModelUsage('openrouter',label,null,performance.now()-started,'unknown');throw error;}

  if (!response.ok) {
    const billing=await response.clone().json().catch(()=>null);recordModelUsage('openrouter',label,billing,performance.now()-started,'http_error');
    throw new OpenRouterHttpError(
      formatSafeGeminiError(
        `OpenRouter ${label} failed`,
        await safeGeminiErrorDetails(response),
      ),
      response.status,
    );
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (err) {
    recordModelUsage('openrouter',label,null,performance.now()-started,'unknown');
    throw new Error(
      `OpenRouter ${label} returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  recordModelUsage('openrouter',label,rawJson,performance.now()-started,'received');

  const envelope = chatResponseSchema.safeParse(rawJson);
  if (!envelope.success) {
    console.warn("[openrouter] response envelope failed schema validation", {
      label,
      issues: envelope.error.issues,
    });
    return null;
  }
  if (envelope.data.error) {
    console.warn("[openrouter] provider-level error in 200 envelope", { label });
    return null;
  }

  /* a content filter is the road's considered refusal — terminal, so the
     caller keeps its safe posture instead of retrying the same material */
  if (envelope.data.choices?.[0]?.finish_reason === "content_filter") {
    console.warn("[openrouter] response declined by content filter", { label });
    return MODEL_DECLINED;
  }

  const content = envelope.data.choices?.[0]?.message?.content;
  if(['length','error'].includes(envelope.data.choices?.[0]?.finish_reason??'')){
    console.warn('[openrouter] incomplete response refused',{label,finishReason:envelope.data.choices?.[0]?.finish_reason});return null;
  }
  if (typeof content !== "string" || content.length === 0) return null;

  try {
    return JSON.parse(stripJsonFence(content));
  } catch {
    console.warn("[openrouter] constrained response was not valid JSON", {
      label,
      finishReason: envelope.data.choices?.[0]?.finish_reason ?? null,
    });
    return null;
  }
}
