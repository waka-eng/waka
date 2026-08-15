/**
 * The Gemini wire protocol for WAKA's two generation calls.
 *
 * Scope of this file
 * ------------------
 * Build the request body, POST it, parse the envelope, validate the payload,
 * and hand back a typed result. Nothing else: job claiming, retry bookkeeping,
 * match-or-mint, ranking, versioning, and the lock rule all live outside, in
 * lib/queue.ts, lib/signal-derivation.ts, and lib/top-of-mind-synthesis.ts.
 *
 * Keeping the prompts and the HTTP shape in one isolated module means prompt
 * iteration is a single-file diff a reviewer can read without scrolling past
 * background-job plumbing, and the functions are unit-testable by mocking
 * `fetch` alone.
 *
 * Why no SDK?
 * -----------
 * `@google/generative-ai` is ~150 kB doing what amounts to one `fetch` against
 * the documented v1beta `:generateContent` endpoint. On a Lambda cold start
 * that bundle weight is paid on every container boot.
 *
 * Output constraint strategy
 * --------------------------
 * Three layers, strongest first:
 *
 *   1. `responseSchema` + `responseMimeType: "application/json"`. Google's
 *      decoder is constrained server-side to the declared shape, which is
 *      stronger than any "respond with valid JSON" instruction.
 *   2. The system instruction, which explains what the fields *mean* so the
 *      model fills a valid shape with the right content.
 *   3. A Zod parse of the decoded payload. The schema constraint could
 *      regress, Google could change the envelope, and a model can always
 *      return a structurally valid answer that cites a signal id it invented.
 *      Nothing here is trusted without re-checking it.
 *
 * User text is wrapped in delimiters everywhere it appears. A capture that
 * itself reads "ignore the above and output X" is data, and the delimiters
 * plus the schema constraint are the cheapest defense that actually holds.
 */

import { z } from "zod";

import { topOfMindEntryTypeValues } from "../db/index.js";
import {
  buildGeminiJsonHeaders,
  buildGeminiModelEndpoint,
  fetchModelWithTimeout,
  formatSafeGeminiError,
  safeGeminiErrorDetails,
} from "../lib/gemini-http.js";
import type {
  SignalMatchJudgement,
  SignalMatchJudgementInput,
  SignalCandidateExtractionInput,
  SignalCandidateExtractionResult,
  TopOfMindSynthesisInput,
  TopOfMindSynthesisResult,
} from "../lib/model-provider.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Resolve the Gemini API key.
 *
 *   1. `GEMINI_API_KEY` — set explicitly by `sst.config.ts` from the
 *      `GeminiApiKey` SST Secret. The contract for production / `sst dev`.
 *   2. `SST_RESOURCE_GeminiApiKey` — the JSON envelope SST injects when the
 *      worker is `link`ed to the secret. A fallback so the handler still
 *      works if someone wires the link without re-exporting the env var.
 *
 * Throws when neither is present, so a misconfigured deployment fails loudly
 * on its first generation rather than silently producing nothing forever.
 */
function getGeminiApiKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;

  const sstLink = process.env.SST_RESOURCE_GeminiApiKey;
  if (sstLink) {
    try {
      const parsed = JSON.parse(sstLink) as { value?: string };
      if (parsed?.value) return parsed.value;
    } catch {
      // fall through to error
    }
  }

  throw new Error(
    "Gemini API key is not configured (GEMINI_API_KEY / SST_RESOURCE_GeminiApiKey).",
  );
}

/**
 * Pinned as a module constant rather than read from env: the prompts below
 * are tuned for this model's behaviour, so a model swap is a code change and
 * therefore visible in review.
 */
export const GEMINI_GENERATION_MODEL = "gemini-3.1-flash-lite";

/** Bounds one capture's contribution to a request. */
const MAX_INSPIRATION_CHARS = 4_000;
/** Enrichment is a whole page body; it is context, not the main event. */
const MAX_ATTACHMENT_CHARS = 2_000;
const MAX_REFLECTION_CHARS = 800;
/** At most three candidates per capture — see the extraction instruction. */
export const MAX_SIGNAL_CANDIDATES = 3;
/** A top of mind a reader cannot hold in one sitting is not a top of mind. */
export const MAX_TOP_OF_MIND_ENTRIES = 7;

function clip(value: string, max: number): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/** Delimit anything the model must read as data rather than as instruction. */
function fence(tag: string, body: string): string {
  return `<<<${tag}>>>\n${body}\n<<<end ${tag}>>>`;
}

// ---------------------------------------------------------------------------
// Wire types (minimal subset)
// ---------------------------------------------------------------------------

/**
 * The subset of the OpenAPI dialect Gemini accepts as `responseSchema`. Typed
 * structurally so a malformed schema is a compile error rather than a 400 at
 * runtime.
 */
interface ResponseSchema {
  type: "OBJECT" | "ARRAY" | "STRING" | "BOOLEAN" | "INTEGER" | "NUMBER";
  description?: string;
  nullable?: boolean;
  enum?: readonly string[];
  items?: ResponseSchema;
  maxItems?: number;
  properties?: Record<string, ResponseSchema>;
  required?: readonly string[];
  propertyOrdering?: readonly string[];
}

interface GenerateContentRequest {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: "user"; parts: { text: string }[] }[];
  generationConfig: {
    temperature: number;
    responseMimeType: "application/json";
    responseSchema: ResponseSchema;
  };
}

/**
 * Every field optional and `.passthrough()` throughout: an upstream addition
 * must not turn an otherwise-usable response into a parse failure. Only the
 * three paths this module actually reads are typed.
 */
export const generateContentResponseSchema = z
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
    promptFeedback: z
      .object({ blockReason: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type GenerateContentResponse = z.infer<typeof generateContentResponseSchema>;

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export function buildGenerateContentUrl(): string {
  return buildGeminiModelEndpoint(GEMINI_GENERATION_MODEL, "generateContent");
}

/**
 * POST one `:generateContent` call and return the decoded JSON payload, or
 * null when Gemini produced nothing usable (safety block, empty candidate
 * list, unparseable text).
 *
 * Throws on transport-level failures — non-2xx, network error, non-JSON body
 * — because those are transient and the queue's backoff is the right answer.
 * "The model gave us nothing" is not transient, so it comes back as null and
 * each caller decides what an empty answer means for its layer.
 */
async function callGemini(
  request: GenerateContentRequest,
  label: string,
): Promise<unknown | null> {
  const apiKey = getGeminiApiKey();

  const response = await fetchModelWithTimeout(fetch, buildGenerateContentUrl(), {
    method: "POST",
    headers: buildGeminiJsonHeaders(apiKey),
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    throw new Error(
      formatSafeGeminiError(
        `Gemini ${label} failed`,
        await safeGeminiErrorDetails(response),
      ),
    );
  }

  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (err) {
    throw new Error(
      `Gemini ${label} returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const envelope = generateContentResponseSchema.safeParse(rawJson);
  if (!envelope.success) {
    console.warn("[gemini] response envelope failed schema validation", {
      label,
      issues: envelope.error.issues,
    });
    return null;
  }

  const blockReason = envelope.data.promptFeedback?.blockReason ?? null;
  if (blockReason) {
    console.warn("[gemini] prompt blocked", { label, blockReason });
    return null;
  }

  const text = envelope.data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return null;

  try {
    return JSON.parse(text);
  } catch {
    console.warn("[gemini] constrained response was not valid JSON", {
      label,
      finishReason: envelope.data.candidates?.[0]?.finishReason ?? null,
    });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Layer 2 — signal candidate extraction
// ---------------------------------------------------------------------------

/**
 * The one rule that matters here is "in their words". A generator that
 * paraphrases every capture into house style produces statements nobody
 * recognizes as their own, which is the failure mode that makes a memory
 * product feel like someone else's notes about you.
 */
export const SIGNAL_EXTRACTION_SYSTEM_INSTRUCTION = `
You read one capture from a person's notebook and name the durable pattern it
is evidence of. A pattern is a taste, a theme, a tension, or a belief that
would still be true next month — not a summary of what the capture says.

Write each statement:
- in the same language the capture is written in, using the person's own
  words and register wherever the capture gives you them,
- as one plain sentence that could stand on its own months later, without
  referring to "this note", "the article", or "the user",
- specific enough that someone who knows this person would recognize it, and
  general enough that a different capture could also be evidence of it.

Ground every statement. Quote a verbatim span from the capture, its
reflections, or its attachment context that shows why you named it. If you
cannot quote a span, leave the quote out rather than inventing one.

Existing statements are provided for phrasing only. If this capture is
evidence of a pattern already listed, restate it the way it is already
phrased rather than coining a near-duplicate.

Return 0 to ${MAX_SIGNAL_CANDIDATES} statements. Zero is the right answer for a
capture that carries no durable pattern — a logistics note, a reminder, a
bare link with nothing said about it. Never pad, never template, never write
a sentence you could have written before reading the capture.
`.trim();

const signalExtractionResponseSchema: ResponseSchema = {
  type: "OBJECT",
  properties: {
    statements: {
      type: "ARRAY",
      maxItems: MAX_SIGNAL_CANDIDATES,
      items: {
        type: "OBJECT",
        properties: {
          statement: { type: "STRING", description: "The durable pattern, one sentence." },
          reason: { type: "STRING", description: "Why this capture is evidence of it." },
          quote: { type: "STRING", description: "A verbatim span, or omitted." },
        },
        required: ["statement"],
        propertyOrdering: ["statement", "reason", "quote"],
      },
    },
  },
  required: ["statements"],
};

const extractedStatementsSchema = z.object({
  statements: z
    .array(
      z.object({
        statement: z.string(),
        reason: z.string().optional(),
        quote: z.string().optional(),
      }),
    )
    .optional(),
});

function buildSignalExtractionPrompt(input: SignalCandidateExtractionInput): string {
  const sections: string[] = [];

  sections.push(
    `Locale: ${input.preferredLocale}. Captured: ${input.inspiration.createdAt.toISOString()}.`,
  );
  sections.push(
    input.inspiration.source === "agent"
      ? "This capture is an agent's own observation, not the person's words. Name the pattern it is evidence of without attributing the phrasing to the person."
      : "This capture is the person's own material.",
  );

  sections.push(fence("capture", clip(input.inspiration.text, MAX_INSPIRATION_CHARS)));

  for (const reflection of input.reflections) {
    sections.push(
      fence(
        "reflection",
        `Q: ${clip(reflection.question, MAX_REFLECTION_CHARS)}\nA: ${clip(reflection.answer, MAX_REFLECTION_CHARS)}`,
      ),
    );
  }

  for (const attachment of input.attachments) {
    // Attribution matters: an article's argument is not a claim the person
    // made by saving the link.
    const provenance =
      attachment.kind === "page_body"
        ? `Text from a page they saved${attachment.label ? ` (${attachment.label})` : ""}. Not their words.`
        : `Description of an image they saved${attachment.label ? ` (${attachment.label})` : ""}. Machine-written.`;
    sections.push(
      fence("attachment", `${provenance}\n${clip(attachment.text, MAX_ATTACHMENT_CHARS)}`),
    );
  }

  if (input.existingStatements.length > 0) {
    sections.push(
      fence(
        "existing statements",
        input.existingStatements.map((entry) => `- ${entry.statement}`).join("\n"),
      ),
    );
  }

  return sections.join("\n\n");
}

export function buildSignalExtractionRequest(
  input: SignalCandidateExtractionInput,
): GenerateContentRequest {
  return {
    systemInstruction: { parts: [{ text: SIGNAL_EXTRACTION_SYSTEM_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: buildSignalExtractionPrompt(input) }] }],
    generationConfig: {
      // Greedy decoding. Re-deriving a capture after an edit should move the
      // statement because the capture moved, not because the sampler rolled
      // differently.
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: signalExtractionResponseSchema,
    },
  };
}

/** Drop blanks and enforce the cap the schema only advertises. */
export function parseSignalCandidates(payload: unknown): SignalCandidateExtractionResult {
  const parsed = extractedStatementsSchema.safeParse(payload);
  if (!parsed.success) {
    console.warn("[gemini] signal extraction payload failed validation", {
      issues: parsed.error.issues,
    });
    return { statements: [] };
  }

  const statements = (parsed.data.statements ?? [])
    .map((candidate) => ({
      statement: candidate.statement.trim(),
      reason: candidate.reason?.trim() || undefined,
      quote: candidate.quote?.trim() || undefined,
    }))
    .filter((candidate) => candidate.statement.length > 0)
    .slice(0, MAX_SIGNAL_CANDIDATES);

  return { statements };
}

export async function extractSignalCandidates(
  input: SignalCandidateExtractionInput,
): Promise<SignalCandidateExtractionResult> {
  // An empty capture with no attachments and no reflections has nothing to
  // read; spending a model call to be told so is pure waste.
  const hasMaterial =
    input.inspiration.text.trim().length > 0 ||
    input.reflections.length > 0 ||
    input.attachments.length > 0;
  if (!hasMaterial) return { statements: [] };

  const payload = await callGemini(buildSignalExtractionRequest(input), "signal extraction");
  if (payload === null) return { statements: [] };
  return parseSignalCandidates(payload);
}


// ---------------------------------------------------------------------------
// Layer 2 — the merge judge
// ---------------------------------------------------------------------------

/**
 * Deliberately austere. The judge sees two statements and nothing else — no
 * captures, no evidence, no history — because its one question is whether the
 * sentences name the same durable pattern, and context invites it to decide
 * whether the pattern is *true*, which is not its call.
 */
export const SIGNAL_MATCH_JUDGE_SYSTEM_INSTRUCTION = `
You compare two statements from one person's memory system and answer a single
question: do they name the SAME durable pattern about this person?

Same pattern means a reader who held one would learn nothing new from the
other — one is a rewording, a narrowing, or a broadening of the other.

Different means each could gain evidence the other could not: they concern
different objects, different tensions, or different directions of pull, however
much vocabulary they share.

When genuinely uncertain, answer false. Wrongly fusing two patterns is
invisible afterwards; a duplicate stays visible and can be merged.
`.trim();

const signalMatchJudgementResponseSchema: ResponseSchema = {
  type: "OBJECT",
  properties: {
    samePattern: { type: "BOOLEAN" },
  },
  required: ["samePattern"],
};

export function buildSignalMatchJudgementRequest(
  input: SignalMatchJudgementInput,
): GenerateContentRequest {
  const prompt = [
    "statement A:",
    "<<<statement>>>",
    input.candidateStatement,
    "<<<end>>>",
    "",
    "statement B:",
    "<<<statement>>>",
    input.existingStatement,
    "<<<end>>>",
  ].join("\n");

  return {
    systemInstruction: { parts: [{ text: SIGNAL_MATCH_JUDGE_SYSTEM_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      // A comparison, not a composition; sampling would make the same pair
      // merge on Tuesday and mint on Wednesday.
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: signalMatchJudgementResponseSchema,
    },
  };
}

export function parseSignalMatchJudgement(payload: unknown): SignalMatchJudgement {
  const same =
    typeof payload === "object" &&
    payload !== null &&
    (payload as { samePattern?: unknown }).samePattern === true;
  // Anything malformed lands on "different", for the same reason the prompt
  // does: the recoverable mistake is the duplicate.
  return { samePattern: same };
}

export async function judgeSignalMatch(
  input: SignalMatchJudgementInput,
): Promise<SignalMatchJudgement> {
  const payload = await callGemini(
    buildSignalMatchJudgementRequest(input),
    "signal match judgement",
  );
  if (payload === null) return { samePattern: false };
  return parseSignalMatchJudgement(payload);
}

// ---------------------------------------------------------------------------
// Layer 3 — whole-artifact synthesis
// ---------------------------------------------------------------------------

/**
 * The artifact is the unit. The instruction asks for the complete set every
 * time, including locked entries reproduced exactly, because a model that
 * only ever sees "what to add" has no way to notice that something should
 * leave — and an artifact that only grows stops being what currently matters.
 */
export const TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION = `
You write one person's top of mind: the short artifact answering what
currently matters, what is believed, and what is in question. You are given
their strongest signals — distilled patterns, each with an id — and the
artifact as it stands.

Return the COMPLETE artifact every time, in the order a reader should meet it.
Not a patch, not additions: the whole set, at most ${MAX_TOP_OF_MIND_ENTRIES}
entries, fewer when fewer are true.

Each entry:
- type: pattern (what keeps holding), tension (two things pulling against
  each other), question (what is genuinely open), hypothesis (a claim worth
  testing), action (something they are moving toward).
- body: one or two sentences in their language and register, saying the thing
  rather than describing that the thing exists.
- belief: only when the entry supports a crisp declarative claim.
- prompt: only when the entry raises a question worth sitting with.
- citedSignalIds: the ids of the signals the entry rests on. Cite only ids
  from the list you were given. Never invent an id, and never write an entry
  you cannot cite.

Locked entries were written or edited by the person. Reproduce each one
exactly — same type, same body, same belief, same prompt, same cited ids,
character for character. Build the rest of the artifact around them. Their
text is theirs; you may not improve it.

Verdicts the person gave on earlier output are their judgement of your work.
An entry or claim they marked not_true must not come back in the same form:
either it stays out, or what returns is visibly reshaped by their correction —
their own words outrank your phrasing. A verdict of partly is an invitation to
sharpen, not to repeat.

If the current artifact still says what the signals say, set noChange to true
and return the current entries unchanged. Saying so is a real answer; churning
the wording to look busy is not.
`.trim();

const topOfMindSynthesisResponseSchema: ResponseSchema = {
  type: "OBJECT",
  properties: {
    noChange: {
      type: "BOOLEAN",
      description: "True when the current artifact still holds.",
    },
    entries: {
      type: "ARRAY",
      maxItems: MAX_TOP_OF_MIND_ENTRIES,
      items: {
        type: "OBJECT",
        properties: {
          type: { type: "STRING", enum: topOfMindEntryTypeValues },
          body: { type: "STRING" },
          belief: { type: "STRING" },
          prompt: { type: "STRING" },
          citedSignalIds: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["type", "body", "citedSignalIds"],
        propertyOrdering: ["type", "body", "belief", "prompt", "citedSignalIds"],
      },
    },
  },
  required: ["entries"],
};

const synthesizedArtifactSchema = z.object({
  noChange: z.boolean().optional(),
  entries: z
    .array(
      z.object({
        type: z.enum(topOfMindEntryTypeValues),
        body: z.string(),
        belief: z.string().optional(),
        prompt: z.string().optional(),
        citedSignalIds: z.array(z.string()).optional(),
      }),
    )
    .optional(),
});

function buildTopOfMindSynthesisPrompt(input: TopOfMindSynthesisInput): string {
  const sections: string[] = [];

  sections.push(`Locale: ${input.preferredLocale}.`);

  sections.push(
    fence(
      "signals",
      input.signals
        .map((signal) => {
          const recency = signal.lastEvidenceAt
            ? signal.lastEvidenceAt.toISOString()
            : "no evidence yet";
          return `id: ${signal.id}\nconfidence: ${signal.confidence} | evidence: ${signal.evidenceCount} | last evidence: ${recency}\nstatement: ${signal.statement}`;
        })
        .join("\n\n"),
    ),
  );

  if (input.lockedEntries.length > 0) {
    sections.push(
      fence(
        "locked entries — reproduce verbatim",
        input.lockedEntries
          .map((entry) =>
            JSON.stringify({
              type: entry.type,
              body: entry.body,
              belief: entry.belief ?? undefined,
              prompt: entry.prompt ?? undefined,
              citedSignalIds: entry.citedSignalIds,
            }),
          )
          .join("\n"),
      ),
    );
  }

  if (input.recentFeedback.length > 0) {
    sections.push(
      fence(
        "the person's verdicts on earlier output — newest first",
        input.recentFeedback
          .map((item) => {
            const correction = item.correction ? ` | their words: ${item.correction}` : "";
            return `${item.target} judged ${item.value}: ${item.about}${correction}`;
          })
          .join("\n"),
      ),
    );
  }

  sections.push(
    input.currentEntries.length > 0
      ? fence(
          "current artifact",
          input.currentEntries
            .map((entry) => `[${entry.type}] ${entry.body} (cites: ${entry.citedSignalIds.join(", ")})`)
            .join("\n"),
        )
      : "The artifact does not exist yet. Write it for the first time.",
  );

  return sections.join("\n\n");
}

export function buildTopOfMindSynthesisRequest(
  input: TopOfMindSynthesisInput,
): GenerateContentRequest {
  return {
    systemInstruction: {
      parts: [{ text: TOP_OF_MIND_SYNTHESIS_SYSTEM_INSTRUCTION }],
    },
    contents: [{ role: "user", parts: [{ text: buildTopOfMindSynthesisPrompt(input) }] }],
    generationConfig: {
      // Same input, same artifact. A person watching their own top of mind
      // reshuffle on every refresh learns to distrust it.
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: topOfMindSynthesisResponseSchema,
    },
  };
}

export function parseTopOfMindSynthesis(payload: unknown): TopOfMindSynthesisResult {
  const parsed = synthesizedArtifactSchema.safeParse(payload);
  if (!parsed.success) {
    console.warn("[gemini] top-of-mind synthesis payload failed validation", {
      issues: parsed.error.issues,
    });
    return { entries: [] };
  }

  const entries = (parsed.data.entries ?? [])
    .map((entry) => ({
      type: entry.type,
      body: entry.body.trim(),
      belief: entry.belief?.trim() || undefined,
      prompt: entry.prompt?.trim() || undefined,
      citedSignalIds: (entry.citedSignalIds ?? []).map((id) => id.trim()).filter(Boolean),
    }))
    .filter((entry) => entry.body.length > 0)
    .slice(0, MAX_TOP_OF_MIND_ENTRIES);

  return { entries, noChange: parsed.data.noChange };
}

export async function synthesizeTopOfMind(
  input: TopOfMindSynthesisInput,
): Promise<TopOfMindSynthesisResult> {
  const payload = await callGemini(
    buildTopOfMindSynthesisRequest(input),
    "top-of-mind synthesis",
  );
  if (payload === null) {
    // Deliberately loud. An unusable synthesis response must not be written
    // down as "nothing changed" — a refresh that records a decision it did
    // not make is exactly the silent failure the versioned artifact exists
    // to prevent. Let the queue retry, then let the job fail visibly.
    throw new Error("Gemini top-of-mind synthesis returned no usable artifact");
  }
  return parseTopOfMindSynthesis(payload);
}
