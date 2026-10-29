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
 * Model selection: Terra for Top of Mind synthesis/review; DeepSeek V4.1 Flash 1017
 * for the other text tasks. Overridable per task by env so an eval can move
 * one task without moving the rest:
 *
 *   WAKA_MODEL_EXTRACT · WAKA_MODEL_JUDGE · WAKA_MODEL_SYNTHESIZE
 *   WAKA_MODEL_TOP_OF_MIND_REVIEW
 *   WAKA_MODEL_PRINCIPLES · WAKA_MODEL_PRINCIPLE_JUDGE · WAKA_MODEL_ROUTE
 *   WAKA_MODEL_SUPPORT · WAKA_MODEL_REFLECT · WAKA_MODEL_CHAT
 *
 * Embeddings are NOT here and must never be: stored vectors and the four
 * calibrated cosine thresholds live in gemini-embedding-001's space, and a
 * "flexible" embedder would silently invalidate both.
 */
import {
  buildDeclarationRouteRequest,
  buildPrincipleDistillRequest,
  buildPrincipleGroundingRequest,
  parsePrincipleGrounding,
  buildPrincipleRelationRequest,
  buildReflectionQuestionRequest,
  buildReviewQuestionRequest,
  buildConversationReplyRequest,
  parseConversationReply,
  buildReviewAnswerDerivationRequest,
  buildSignalExtractionRequest,
  buildSignalSupportRequest,
  buildSignalMatchJudgementRequest,
  buildTopOfMindSynthesisRequest,
  parseDeclarationRoute,
  parseDistilledPrinciples,
  parsePrincipleRelation,
  parseReflectionQuestion,
  parseReviewQuestion,
  parseReviewAnswerDerivation,
  parseSignalCandidates,
  parseSignalSupport,
  parseSignalMatchJudgement,
  parseTopOfMindSynthesis,
  buildTopOfMindReviewRequest,
  parseTopOfMindReview,
  buildTopOfMindComparisonRequest,
  applyTopOfMindComparison,
} from "../queue/gemini.js";
import {
  DeclarationNotConsideredError,
  CONVERSATION_REPLY_OUTPUT_TOKENS,
  MODEL_DECLINED,
  ModelDidNotAnswerError,
  type ModelProvider,
} from "./model-provider.js";
import {
  callOpenRouter,
  OPENROUTER_GENERATION_MODEL,
  OPENROUTER_TOP_OF_MIND_MODEL,
  OPENROUTER_MAX_OUTPUT_TOKENS,
  type OpenRouterChatRequest,
} from "./openrouter-http.js";

/* The Gemini request dialect, structurally — the builders' return shape.
   Typed here rather than imported so queue/gemini.ts keeps its types
   private and this module cannot reach past the builders. */
interface GeminiShapedSchema {
  type: string;
  description?: string;
  enum?: readonly string[];
  nullable?: boolean;
  items?: GeminiShapedSchema;
  properties?: Record<string, GeminiShapedSchema>;
  required?: readonly string[];
  anyOf?: readonly GeminiShapedSchema[];
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
}
interface GeminiShapedRequest {
  systemInstruction?: { parts: Array<{ text: string }> };
  contents: Array<{ role?: string; parts: Array<{ text: string }> }>;
  generationConfig: {
    temperature?: number;
    maxOutputTokens?: number;
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
  NULL: "null",
};

/** Gemini's UPPERCASE schema dialect → plain JSON Schema. */
export function toJsonSchema(schema: GeminiShapedSchema, strict = false): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: TYPE_MAP[schema.type] ?? schema.type.toLowerCase(),
  };
  if (schema.description) out.description = schema.description;
  if (schema.enum) out.enum = schema.enum;
  if (schema.nullable) out.type = [out.type as string, "null"];
  if (schema.items) out.items = toJsonSchema(schema.items, strict);
  if (schema.properties) {
    out.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key,
        strict && !schema.required?.includes(key)
          ? { anyOf: [toJsonSchema(value, strict), { type: 'null' }] }
          : toJsonSchema(value, strict)]),
    );
    out.additionalProperties = false;
  }
  if (strict && schema.properties) out.required = Object.keys(schema.properties);
  else if (schema.required) out.required = schema.required;
  if (schema.anyOf) out.anyOf = schema.anyOf.map(child => toJsonSchema(child, strict));
  for (const key of ['minItems','maxItems','minimum','maximum','minLength','maxLength','pattern'] as const) {
    if (schema[key] !== undefined) out[key] = schema[key];
  }
  return out;
}

export function toChatRequest(
  request: GeminiShapedRequest,
  model: string,
  schemaName: string,
  strict = false,
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
    max_tokens: request.generationConfig.maxOutputTokens ?? OPENROUTER_MAX_OUTPUT_TOKENS,
    reasoning: { enabled: false },
    response_format: schema
      ? { type: "json_schema", json_schema: { name: schemaName, schema: toJsonSchema(schema, strict), ...(strict ? { strict: true } : {}) } }
      : { type: "json_object" },
  };
}

function modelFor(envName: string, fallback = OPENROUTER_GENERATION_MODEL): string {
  const fromEnv = process.env[envName]?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : fallback;
}

function topOfMindRequest(request: GeminiShapedRequest, envName: string, schemaName: string, effort: 'low' | 'medium' = 'medium'): OpenRouterChatRequest {
  const model = modelFor(envName, OPENROUTER_TOP_OF_MIND_MODEL);
  const chat = toChatRequest(request, model, schemaName, model === OPENROUTER_TOP_OF_MIND_MODEL);
  if (model === OPENROUTER_TOP_OF_MIND_MODEL) {
    chat.reasoning = { effort, exclude: true };
    delete chat.temperature;
  }
  return chat;
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
    async reviewTopOfMind(input) {
      const payload = await callOpenRouter(topOfMindRequest(buildTopOfMindReviewRequest(input),
        'WAKA_MODEL_TOP_OF_MIND_REVIEW', 'top_of_mind_review', 'low'), 'top-of-mind review');
      if (payload === null || payload === MODEL_DECLINED) throw new ModelDidNotAnswerError('top-of-mind review');
      const reviewed = parseTopOfMindReview(payload);
      if (!input.comparison) return reviewed;
      const compared = await ask(() => buildTopOfMindComparisonRequest(input, reviewed), 'top-of-mind comparison', 'WAKA_MODEL_JUDGE', 'top_of_mind_comparison');
      return applyTopOfMindComparison(input, reviewed, compared);
    },
    async answerConversation(input){
      const request=toChatRequest(buildConversationReplyRequest(input),modelFor('WAKA_MODEL_CHAT'),'conversation_reply');
      // The pinned route returned truncated strings/decoder errors for this
      // schema in the M8 baseline. Ask for JSON structure only; the same strict
      // application parser still enforces every field, bound and citation.
      request.response_format={type:'json_object'};
      // This candidate endpoint refuses reasoning.enabled=false. Keep its
      // minimum effort inside the same total completion-token request cap.
      if(request.model==='google/gemini-3.8-flash')request.reasoning={effort:'low',exclude:true};
      request.max_tokens=CONVERSATION_REPLY_OUTPUT_TOKENS;
      const payload=await callOpenRouter(request,'conversation reply');
      if(payload===null||payload===MODEL_DECLINED)throw new ModelDidNotAnswerError('conversation reply');return parseConversationReply(payload,input);
    },
    async deriveReviewAnswer(input){
      const payload=await ask(()=>buildReviewAnswerDerivationRequest(input),'review derivation','WAKA_MODEL_EXTRACT','review_derivation');
      if(payload===null||payload===MODEL_DECLINED)throw new ModelDidNotAnswerError('review derivation');return parseReviewAnswerDerivation(payload,input);
    },
    async askReviewQuestion(input){
      const payload=await ask(()=>buildReviewQuestionRequest(input),'review question','WAKA_MODEL_REFLECT','review_question');
      if(payload===null||payload===MODEL_DECLINED)throw new ModelDidNotAnswerError('review question');
      return parseReviewQuestion(payload,input);
    },
    async askReflectionQuestion(input) {
      const payload = await ask(
        () => buildReflectionQuestionRequest(input),
        "reflection follow-up",
        "WAKA_MODEL_REFLECT",
        "reflection_question",
      );
      if (payload === null || payload === MODEL_DECLINED) throw new ModelDidNotAnswerError("reflection follow-up");
      return parseReflectionQuestion(payload, input);
    },
    async extractSignalCandidates(input) {
      const hasMaterial =
        input.inspiration.text.trim().length > 0 ||
        input.reflections.length > 0 ||
        input.attachments.length > 0;
      if (!hasMaterial) return { statements: [], category: null };
      const payload = await ask(
        () => buildSignalExtractionRequest(input),
        "signal extraction",
        "WAKA_MODEL_EXTRACT",
        "signal_candidates",
      );
      if (payload === MODEL_DECLINED) return { statements: [], category: null };
      if (payload === null) throw new ModelDidNotAnswerError("signal extraction");
      return parseSignalCandidates(payload, input);
    },
    async judgeSignalMatch(input) {
      const payload = await ask(
        () => buildSignalMatchJudgementRequest(input),
        "signal match judgement",
        "WAKA_MODEL_JUDGE",
        "signal_match",
      );
      return parseSignalMatchJudgement(payload);
    },
    async assessSignalSupport(input) {
      const payload = await ask(
        () => buildSignalSupportRequest(input),
        "signal support assessment",
        "WAKA_MODEL_SUPPORT",
        "signal_support",
      );
      if (payload === null || payload === MODEL_DECLINED) throw new ModelDidNotAnswerError("signal support assessment");
      return parseSignalSupport(payload);
    },
    async synthesizeTopOfMind(input) {
      const request = topOfMindRequest(buildTopOfMindSynthesisRequest(input), 'WAKA_MODEL_SYNTHESIZE', 'top_of_mind');
      const payload = await callOpenRouter(request, 'top-of-mind synthesis');
      if (payload === null || payload === MODEL_DECLINED) {
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
      if (payload === MODEL_DECLINED) return { candidates: [] };
      if (payload === null) throw new ModelDidNotAnswerError("principle distillation");
      return parseDistilledPrinciples(payload);
    },
    async judgePrincipleRelation(input) {
      const payload = await ask(
        () => buildPrincipleRelationRequest(input),
        "principle relation judgement",
        "WAKA_MODEL_PRINCIPLE_JUDGE",
        "principle_relation",
      );
      if (payload === null || payload === MODEL_DECLINED) throw new ModelDidNotAnswerError("principle relation judgement");
      return parsePrincipleRelation(payload,input);
    },
    async assessPrincipleGrounding(input) {
      const payload=await ask(()=>buildPrincipleGroundingRequest(input),'principle grounding','WAKA_MODEL_PRINCIPLES','principle_grounding');
      if(payload===null||payload===MODEL_DECLINED)throw new ModelDidNotAnswerError('principle grounding');
      return parsePrincipleGrounding(payload,input);
    },
    async routeDeclaration(input) {
      const payload = await ask(
        () => buildDeclarationRouteRequest(input),
        "declaration routing",
        "WAKA_MODEL_ROUTE",
        "declaration_route",
      );
      if (payload === null || payload === MODEL_DECLINED) {
        throw new DeclarationNotConsideredError(
          "declaration routing returned no usable verdict",
        );
      }
      return parseDeclarationRoute(payload);
    },
  };
}
