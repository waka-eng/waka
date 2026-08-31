/**
 * Binds the provider interface to OpenRouter — one prompt, two roads.
 *
 * Every task reuses the INCUMBENT's prompt builder and parser from
 * queue/gemini.ts, verbatim: the builders return Gemini-shaped requests, and
 * this module translates that shape (system instruction, user parts, the
 * response schema's UPPERCASE type dialect) into an OpenAI-shaped chat call.
 * So the fences, the judge's austerity, the whole-artifact rule — all of it
 * is written once and cannot drift between providers; what changes per road
 * is transport and model id, nothing else.
 *
 * Model selection: `deepseek/deepseek-v4-flash` for every task (founder
 * ruling, 2026-08-30), overridable per task by env so a future eval can move
 * one task without moving the rest:
 *
 *   WAKA_MODEL_EXTRACT · WAKA_MODEL_JUDGE · WAKA_MODEL_SYNTHESIZE
 *   WAKA_MODEL_PRINCIPLES · WAKA_MODEL_PRINCIPLE_JUDGE · WAKA_MODEL_ROUTE
 *
 * Embeddings are NOT here and must never be: stored vectors and the four
 * calibrated cosine thresholds live in gemini-embedding-001's space, and a
 * "flexible" embedder would silently invalidate both.
 */
import {
  buildDeclarationRouteRequest,
  buildPrincipleDistillRequest,
  buildPrincipleRelationRequest,
  buildSignalExtractionRequest,
  buildSignalMatchJudgementRequest,
  buildTopOfMindSynthesisRequest,
  parseDeclarationRoute,
  parseDistilledPrinciples,
  parsePrincipleRelation,
  parseSignalCandidates,
  parseSignalMatchJudgement,
  parseTopOfMindSynthesis,
} from "../queue/gemini.js";
import { DeclarationNotConsideredError, type ModelProvider } from "./model-provider.js";
import {
  callOpenRouter,
  OPENROUTER_GENERATION_MODEL,
  type OpenRouterChatRequest,
} from "./openrouter-http.js";

/* The Gemini request dialect, structurally — the builders' return shape.
   Typed here rather than imported so queue/gemini.ts keeps its types
   private and this module cannot reach past the builders. */
interface GeminiShapedSchema {
  type: string;
  description?: string;
  enum?: string[];
  nullable?: boolean;
  items?: GeminiShapedSchema;
  properties?: Record<string, GeminiShapedSchema>;
  required?: string[];
}
interface GeminiShapedRequest {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role?: string; parts: Array<{ text: string }> }>;
  generationConfig: {
    temperature?: number;
    responseSchema?: GeminiShapedSchema;
  };
}

const TYPE_MAP: Record<string, string> = {
  OBJECT: "object",
  ARRAY: "array",
  STRING: "string",
  NUMBER: "number",
  INTEGER: "integer",
  BOOLEAN: "boolean",
};

/** Gemini's UPPERCASE schema dialect → plain JSON Schema. */
export function toJsonSchema(schema: GeminiShapedSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: TYPE_MAP[schema.type] ?? schema.type.toLowerCase(),
  };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.nullable) out.type = [out.type as string, "null"];
  if (schema.items) out.items = toJsonSchema(schema.items);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([k, v]) => [k, toJsonSchema(v)]),
    );
    out.additionalProperties = false;
  }
  if (schema.required) out.required = schema.required;
  return out;
}

export function toChatRequest(
  request: GeminiShapedRequest,
  model: string,
  schemaName: string,
): OpenRouterChatRequest {
  const system = (request.systemInstruction?.parts ?? [])
    .map((p) => p.text)
    .join("\n")
    .trim();
  const user = request.contents
    .flatMap((c) => c.parts.map((p) => p.text))
    .join("\n")
    .trim();
  const schema = request.generationConfig.responseSchema;
  const messages: OpenRouterChatRequest["messages"] = [];
  if (system) messages.push({ role: "system", content: system });
  messages.push({ role: "user", content: user });
  return {
    model,
    messages,
    temperature: request.generationConfig.temperature ?? 0,
    response_format: schema
      ? { type: "json_schema", json_schema: { name: schemaName, schema: toJsonSchema(schema) } }
      : { type: "json_object" },
  };
}

function modelFor(envName: string): string {
  const fromEnv = process.env[envName]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : OPENROUTER_GENERATION_MODEL;
}

async function ask(
  build: () => unknown,
  label: string,
  envName: string,
  schemaName: string,
): Promise<unknown | null> {
  const request = build() as GeminiShapedRequest;
  return callOpenRouter(toChatRequest(request, modelFor(envName), schemaName), label);
}

export function createOpenRouterModelProvider(): ModelProvider {
  return {
    name: "openrouter",
    async extractSignalCandidates(input) {
      const hasMaterial =
        input.inspiration.text.trim().length > 0 ||
        input.reflections.length > 0 ||
        input.attachments.length > 0;
      if (!hasMaterial) return { statements: [] };
      const payload = await ask(
        () => buildSignalExtractionRequest(input),
        "signal extraction",
        "WAKA_MODEL_EXTRACT",
        "signal_candidates",
      );
      if (payload === null) return { statements: [] };
      return parseSignalCandidates(payload);
    },
    async judgeSignalMatch(input) {
      const payload = await ask(
        () => buildSignalMatchJudgementRequest(input),
        "signal match judgement",
        "WAKA_MODEL_JUDGE",
        "signal_match",
      );
      if (payload === null) return { relation: "independent" };
      return parseSignalMatchJudgement(payload);
    },
    async synthesizeTopOfMind(input) {
      const payload = await ask(
        () => buildTopOfMindSynthesisRequest(input),
        "top-of-mind synthesis",
        "WAKA_MODEL_SYNTHESIZE",
        "top_of_mind",
      );
      if (payload === null) {
        /* same loudness as the incumbent: an unusable synthesis must not be
           recorded as "nothing changed" */
        throw new Error("OpenRouter top-of-mind synthesis returned no usable artifact");
      }
      return parseTopOfMindSynthesis(payload);
    },
    async distillPrinciples(input) {
      const payload = await ask(
        () => buildPrincipleDistillRequest(input),
        "principle distillation",
        "WAKA_MODEL_PRINCIPLES",
        "principles",
      );
      if (payload === null) return { candidates: [] };
      return parseDistilledPrinciples(payload);
    },
    async judgePrincipleRelation(input) {
      const payload = await ask(
        () => buildPrincipleRelationRequest(input),
        "principle relation judgement",
        "WAKA_MODEL_PRINCIPLE_JUDGE",
        "principle_relation",
      );
      if (payload === null) return { relation: "independent" };
      return parsePrincipleRelation(payload);
    },
    async routeDeclaration(input) {
      const payload = await ask(
        () => buildDeclarationRouteRequest(input),
        "declaration routing",
        "WAKA_MODEL_ROUTE",
        "declaration_route",
      );
      if (payload === null) {
        throw new DeclarationNotConsideredError(
          "declaration routing returned no usable verdict",
        );
      }
      return parseDeclarationRoute(payload);
    },
  };
}
