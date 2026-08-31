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

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** The default for every generation task (founder ruling, 2026-08-30).
    Pinned to the 0731 GA snapshot, deliberately not the floating `-latest`
    alias: a float would swap the judge under the canon the day a new
    snapshot ships, and a model change should be a decision with an eval,
    never a surprise. */
export const OPENROUTER_GENERATION_MODEL =
  process.env.OPENROUTER_GENERATION_MODEL ?? "deepseek/deepseek-v4-flash-0731";

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
  messages: Array<{ role: "system" | "user"; content: string }>;
  temperature?: number;
  response_format?:
    | { type: "json_object" }
    | { type: "json_schema"; json_schema: { name: string; strict?: boolean; schema: unknown } };
}

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

export async function callOpenRouter(
  request: OpenRouterChatRequest,
  label: string,
): Promise<unknown | null | typeof MODEL_DECLINED> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) {
    throw new Error("OpenRouter API key is not configured (OPENROUTER_API_KEY).");
  }

  /* one quiet line per call while the road is new — which task, which model */
  console.log(`[openrouter] ${label} → ${request.model}`);
  const response = await fetchModelWithTimeout(fetch, OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: buildOpenRouterHeaders(apiKey),
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(
      formatSafeGeminiError(
        `OpenRouter ${label} failed`,
        await safeGeminiErrorDetails(response),
      ),
    );
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (err) {
    throw new Error(
      `OpenRouter ${label} returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

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
