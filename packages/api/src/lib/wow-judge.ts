import { z } from "zod";

import { wowKindEnumValues, type WowKind } from "../db/index.js";
import { findWowMomentCandidates } from "./wow-candidates.js";
import { getDb } from "./db.js";
import type { WakaDb } from "./inspiration-embeddings.js";

const GEMINI_MODEL = "gemini-2.0-flash";
const MAX_INSPIRATION_CHARS = 4000;
const MAX_TITLE_CHARS = 120;
const MAX_WHY_CHARS = 800;
const MAX_REFLECTION_QUESTION_CHARS = 240;

export class GeminiWowJudgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiWowJudgeValidationError";
  }
}

export type WowMomentJudgment =
  | { isWowMoment: false }
  | {
      isWowMoment: true;
      kind: WowKind;
      title: string;
      why: string;
      reflectionQuestion?: string;
      relatedInspirationIds: string[];
    };

export interface WowJudgePromptInspiration {
  id: string;
  text: string;
  kind: string | null;
  category: number | null;
  cluster: string | null;
  createdAt: Date;
}

export interface WowJudgePromptCandidate extends WowJudgePromptInspiration {
  scores: { runtimeCandidateScore: number };
}

export interface WowJudgeInput {
  trigger: WowJudgePromptInspiration;
  candidates: WowJudgePromptCandidate[];
}

export interface WowJudgeClient {
  judgeWowMoment(input: WowJudgeInput): Promise<WowMomentJudgment>;
}

interface GenerateContentRequest {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: "user"; parts: { text: string }[] }[];
  generationConfig: {
    temperature: number;
    responseMimeType: "application/json";
    responseSchema: unknown;
  };
}

export const WOW_JUDGE_SYSTEM_INSTRUCTION = `
You are a careful judge for WAKA, a personal inspiration notebook. Decide whether
one newly saved trigger inspiration and the provided top candidate inspirations
form a real "WOW moment": a meaningful pattern, bridge, tension, recurrence, or
surprise that is worth showing to the user.

Scope rules:
1. Use ONLY the trigger inspiration and candidate inspirations in the user
   message. Do not assume access to the user's full archive.
2. Do not invent inspiration ids. If isWowMoment is true, relatedInspirationIds
   must contain only ids from the trigger/candidates block.
3. If the provided candidates are weak, unrelated, or insufficient, return
   {"isWowMoment":false}.
4. Output only strict JSON matching one of these shapes:
   {"isWowMoment":false}
   {"isWowMoment":true,"kind":"recurrence|bridge|surprise_bridge|tension|outlier","title":"...","why":"...","reflectionQuestion":"... optional ...","relatedInspirationIds":["..."]}

Allowed kind values:
- recurrence: a meaningful motif appears again across notes.
- bridge: notes connect two domains or frames in a useful way.
- surprise_bridge: the connection is non-obvious and generative.
- tension: notes expose a productive contradiction or unresolved pull.
- outlier: the trigger is noteworthy because it stands apart from nearby notes.

Keep title concise, why specific to the provided notes, and reflectionQuestion
optional. Prefer false over over-claiming.
`.trim();

function getGeminiApiKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const sstLink = process.env.SST_RESOURCE_GeminiApiKey;
  if (sstLink) {
    try {
      const parsed = JSON.parse(sstLink) as { value?: string };
      if (parsed?.value) return parsed.value;
    } catch {
      // fall through
    }
  }

  throw new Error(
    "Gemini API key is not configured (GEMINI_API_KEY / SST_RESOURCE_GeminiApiKey).",
  );
}

function trimForPrompt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_INSPIRATION_CHARS
    ? trimmed.slice(0, MAX_INSPIRATION_CHARS)
    : trimmed;
}

function formatInspirationForPrompt(
  inspiration: WowJudgePromptInspiration,
  label: "trigger" | "candidate",
  score?: number,
): string {
  const metadata = {
    id: inspiration.id,
    kind: inspiration.kind,
    category: inspiration.category,
    cluster: inspiration.cluster,
    createdAt: inspiration.createdAt.toISOString(),
    ...(typeof score === "number" ? { runtimeCandidateScore: score } : {}),
  };

  return `<${label} metadata=${JSON.stringify(metadata)}>\n${trimForPrompt(
    inspiration.text,
  )}\n</${label}>`;
}

function buildUserPrompt(input: WowJudgeInput): string {
  const candidates = input.candidates
    .map((candidate, index) =>
      formatInspirationForPrompt(
        candidate,
        "candidate",
        candidate.scores.runtimeCandidateScore,
      ).replace("<candidate", `<candidate rank=${index + 1}`),
    )
    .join("\n\n");

  return `Judge whether the trigger plus these already-retrieved top candidates form a WOW moment. Do not use or infer any archive content beyond this block.

${formatInspirationForPrompt(input.trigger, "trigger")}

<candidates>
${candidates || "(none provided)"}
</candidates>`;
}

export function buildWowJudgmentRequest(input: WowJudgeInput): GenerateContentRequest {
  return {
    systemInstruction: { parts: [{ text: WOW_JUDGE_SYSTEM_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: buildUserPrompt(input) }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          isWowMoment: { type: "BOOLEAN" },
          kind: { type: "STRING", enum: wowKindEnumValues },
          title: { type: "STRING" },
          why: { type: "STRING" },
          reflectionQuestion: { type: "STRING" },
          relatedInspirationIds: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["isWowMoment"],
      },
    },
  };
}

export function buildWowGenerateContentUrl(apiKey: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

const generateContentResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z
                  .array(z.object({ text: z.string().optional() }).passthrough())
                  .optional(),
              })
              .passthrough()
              .optional(),
            finishReason: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    promptFeedback: z.object({ blockReason: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const falseJudgmentSchema = z.object({ isWowMoment: z.literal(false) }).strict();

const trueJudgmentSchema = z
  .object({
    isWowMoment: z.literal(true),
    kind: z.enum(wowKindEnumValues),
    title: z.string().trim().min(1).max(MAX_TITLE_CHARS),
    why: z.string().trim().min(1).max(MAX_WHY_CHARS),
    reflectionQuestion: z
      .string()
      .trim()
      .min(1)
      .max(MAX_REFLECTION_QUESTION_CHARS)
      .optional(),
    relatedInspirationIds: z.array(z.string().uuid()).min(1),
  })
  .strict();

const wowJudgmentSchema = z.union([falseJudgmentSchema, trueJudgmentSchema]);

function parseJsonFromGeminiText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new GeminiWowJudgeValidationError(
      `Gemini WOW judgment was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function parseWowJudgmentFromResponse(body: unknown): WowMomentJudgment {
  const envelope = generateContentResponseSchema.safeParse(body);
  if (!envelope.success) {
    throw new GeminiWowJudgeValidationError("Gemini WOW response envelope failed validation.");
  }

  if (envelope.data.promptFeedback?.blockReason) {
    return { isWowMoment: false };
  }

  const text = envelope.data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || text.trim().length === 0) {
    throw new GeminiWowJudgeValidationError("Gemini WOW response did not include JSON text.");
  }

  const parsed = parseJsonFromGeminiText(text);
  const judgment = wowJudgmentSchema.safeParse(parsed);
  if (!judgment.success) {
    throw new GeminiWowJudgeValidationError("Gemini WOW judgment failed strict schema validation.");
  }

  return judgment.data as WowMomentJudgment;
}

export interface GeminiWowJudgeClientOptions {
  apiKey?: string;
  fetchFn?: typeof fetch;
}

export class GeminiWowJudgeClient implements WowJudgeClient {
  private readonly apiKey?: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: GeminiWowJudgeClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async judgeWowMoment(input: WowJudgeInput): Promise<WowMomentJudgment> {
    const apiKey = this.apiKey ?? getGeminiApiKey();
    const response = await this.fetchFn(buildWowGenerateContentUrl(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildWowJudgmentRequest(input)),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "<unreadable>");
      throw new Error(
        `Gemini WOW judge failed: HTTP ${response.status} ${response.statusText} — ${errBody.slice(0, 500)}`,
      );
    }

    let rawJson: unknown;
    try {
      rawJson = await response.json();
    } catch (err) {
      throw new Error(
        `Gemini WOW judge returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const judgment = parseWowJudgmentFromResponse(rawJson);
    assertRelatedIdsAreSafe(judgment, input);
    return judgment;
  }
}

export interface JudgeWowMomentForInspirationParams {
  db?: WakaDb;
  userId: string;
  triggerInspirationId: string;
  limit?: number;
  client?: WowJudgeClient;
}

function toPromptInput(
  result: Awaited<ReturnType<typeof findWowMomentCandidates>>,
): WowJudgeInput | null {
  if (!result.trigger) return null;

  return {
    trigger: {
      id: result.trigger.id,
      text: result.trigger.text,
      kind: result.trigger.kind,
      category: result.trigger.category,
      cluster: result.trigger.cluster,
      createdAt: result.trigger.createdAt,
    },
    candidates: result.candidates.map((candidate) => ({
      id: candidate.inspiration.id,
      text: candidate.inspiration.text,
      kind: candidate.inspiration.kind,
      category: candidate.inspiration.category,
      cluster: candidate.inspiration.cluster,
      createdAt: candidate.inspiration.createdAt,
      scores: { runtimeCandidateScore: candidate.scores.runtimeCandidateScore },
    })),
  };
}

function assertRelatedIdsAreSafe(judgment: WowMomentJudgment, input: WowJudgeInput): void {
  if (!judgment.isWowMoment) return;

  const allowedIds = new Set([
    input.trigger.id,
    ...input.candidates.map((candidate) => candidate.id),
  ]);
  const unsafeIds = judgment.relatedInspirationIds.filter((id) => !allowedIds.has(id));
  if (unsafeIds.length > 0) {
    throw new GeminiWowJudgeValidationError(
      `Gemini WOW judgment referenced inspiration ids outside retrieved same-tenant candidates: ${unsafeIds.join(", ")}`,
    );
  }
}

export async function judgeWowMomentForInspiration(
  params: JudgeWowMomentForInspirationParams,
): Promise<WowMomentJudgment> {
  const db = params.db ?? getDb();
  const retrieved = await findWowMomentCandidates({
    db,
    userId: params.userId,
    triggerInspirationId: params.triggerInspirationId,
    limit: params.limit,
  });
  const input = toPromptInput(retrieved);
  if (!input) return { isWowMoment: false };

  const client = params.client ?? new GeminiWowJudgeClient();
  const judgment = await client.judgeWowMoment(input);
  assertRelatedIdsAreSafe(judgment, input);

  return judgment;
}
