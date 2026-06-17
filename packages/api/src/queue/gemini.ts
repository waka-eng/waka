/**
 * Gemini classifier client (Sub-AC 10.3.2).
 *
 * Scope of this file
 * ------------------
 * This module owns *only* the Gemini wire-protocol concern: build the request
 * body, POST it, parse the response, and return one of the six allowed cluster
 * labels (or `null` if the model could not produce a valid one). It is the
 * single source of truth for "how do we ask Gemini to classify an inspiration?"
 *
 * Specifically NOT in scope here:
 *   - DB-backed job claiming      (lib/queue.ts)
 *   - DB SELECT / UPDATE          (queue/classifier.ts)
 *   - Retry/backoff bookkeeping   (lib/queue.ts)
 *
 * Keeping the prompt + the HTTP shape in one isolated module means:
 *   1. The classifier handler never grows tangled `fetch(...)` boilerplate.
 *   2. Prompt iteration is a single-file diff; reviewers can evaluate the
 *      prompt change without scrolling through background-job plumbing.
 *   3. The function is trivially unit-testable: pass a string in, mock fetch,
 *      assert one of the six labels comes out.
 *
 * Why no SDK?
 * -----------
 * `@google/generative-ai` is ~150 kB of code that does what amounts to one
 * `fetch` call against the v1beta `:generateContent` REST endpoint. On a
 * Lambda cold start that bundle weight is paid on every container boot. A
 * direct `fetch` against the documented REST surface keeps the worker bundle
 * lean and removes a dependency that we'd otherwise have to keep upgraded
 * just for our one call site.
 *
 * Output constraint strategy
 * --------------------------
 * The Gemini API supports a `responseSchema` with `enum`-constrained STRING
 * outputs (when `responseMimeType: "application/json"` is set). We use that
 * as the *primary* defense against the model emitting anything other than the
 * six allowed labels — Google's server-side decoder is constrained to only
 * emit one of the enum values, which is stronger than any prompt-engineered
 * "respond with exactly one word" instruction.
 *
 * The system instruction is the *secondary* defense (and the explanatory
 * surface): it tells the model what each label *means*, so even when the
 * decoder is constrained the model picks the *right* enum value rather than
 * picking one at random.
 *
 * Validator (`validateCluster`) is the *tertiary* defense: belt-and-suspenders
 * for the case where Google ever changes the response shape, the enum
 * constraint silently regresses, or the JSON parse returns something
 * unexpected. We never trust the model's output to be in-set without
 * re-checking it against `clusterEnumValues`.
 */

import { z } from "zod";

import { type Cluster, clusterEnumValues } from "../db/index.js";
import {
  buildGeminiJsonHeaders,
  buildGeminiModelEndpoint,
  formatSafeGeminiError,
  safeGeminiErrorDetails,
} from "../lib/gemini-http.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Resolve the Gemini API key.
 *
 * Resolution order mirrors `lib/queue.ts:getQueueUrl` so the worker has one
 * consistent configuration story:
 *
 *   1. `GEMINI_API_KEY` — set explicitly by `sst.config.ts` from the
 *      `GeminiApiKey` SST Secret. This is the contract for production /
 *      `sst dev` runs.
 *
 *   2. `SST_RESOURCE_GeminiApiKey` — auto-injected JSON envelope SST emits
 *      when the worker is `link`ed to the secret. Kept as a fallback so the
 *      handler still works if a future engineer wires the link without
 *      re-exporting the env var.
 *
 * Throws if neither is present so a misconfigured deployment fails loudly the
 * first time the worker tries to classify a row, rather than silently
 * dropping every classification.
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
 * Model id pinned to the same lightweight Gemini family used by the other
 * WAKA Gemini clients.
 *
 * Pinned here as a module constant rather than read from env so a model
 * change is a code change (and therefore visible in code review). The
 * classifier prompt is tuned for this model's behaviour; swapping models
 * silently is a quiet way to degrade output quality.
 */
const GEMINI_MODEL = "gemini-3.1-flash-lite";

/**
 * Hard cap on inspiration text length sent to Gemini.
 *
 * Inspirations are short by design (the original UI is a notes capture, not
 * an essay editor), but we still trim defensively to:
 *   1. Bound the cost of a single classification call.
 *   2. Make sure a pathological 1 MB paste cannot blow past the model's
 *      context window and silently fail.
 *
 * 4 kB is comfortably above any realistic capture and well below the
 * gemini-3.1-flash-lite context window.
 */
const MAX_INSPIRATION_CHARS = 4000;

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

/**
 * System instruction for cluster classification.
 *
 * The label semantics mirror the original single-file UI's cluster cards
 * (outlier / bridge / morph / convergence / tension / loop). Each definition
 * is intentionally short and contrastive: the model needs to be able to
 * *distinguish* between labels, not memorise an ontology.
 *
 * Style rules:
 *   - Imperative voice ("Classify…").
 *   - One label per bullet, with a one-line definition + a contrastive cue.
 *   - Explicit "ambiguity tiebreaker" rule so the model has a deterministic
 *     fallback rather than oscillating between two near-equal candidates.
 *   - No examples in-prompt: the responseSchema enum is what actually
 *     constrains the output, and few-shot examples for a 6-class single-word
 *     output would just inflate token cost without measurably improving
 *     accuracy.
 */
export const CLASSIFIER_SYSTEM_INSTRUCTION = `
You are a librarian for a personal "inspirations" notebook. Each inspiration is
a short note the user captured in the moment. Your job is to assign exactly one
of six cluster labels to the inspiration based on the *shape* of the thought,
not its surface topic.

The six clusters and their meanings:

- outlier: A standalone observation that does not fit existing patterns. Feels
  isolated, anomalous, surprising on its own terms. (Cue: "this doesn't connect
  to anything else I know yet.")

- bridge: Connects two previously unrelated domains, fields, or ideas. Names a
  link between A and B. (Cue: "X is like Y" / "this maps onto that.")

- morph: A transformation, reframing, or reshaping of an existing idea into a
  new form. (Cue: "what if we changed this into…" / "another way to see X is…")

- convergence: Multiple distinct lines of thinking pointing at the same
  underlying insight. A synthesis. (Cue: "all of these are really about…")

- tension: Holds two opposing forces, paradoxes, or contradictions in a single
  frame without resolving them. (Cue: "X but also Y" / "the thing that makes it
  good is the thing that makes it bad.")

- loop: Self-referential, recursive, or cyclical structure. The thought folds
  back on itself or describes a feedback cycle. (Cue: "the more I X the more I
  X" / "this is itself an example of itself.")

Rules:
1. Pick exactly one label. Never invent new ones.
2. Classify by structural shape, not topic. A note about coffee can be a
   "bridge" if it links coffee to something unrelated.
3. If two labels feel equally plausible, prefer the one that captures more of
   the inspiration's *internal structure*: "tension" beats "outlier",
   "convergence" beats "bridge", "loop" beats "morph".
4. Output only the label. No prose, no quotes, no explanation.
`.trim();

/**
 * Build the user-content block for a single inspiration.
 *
 * Wrapped in delimiters (`<<<inspiration>>> … <<<end>>>`) so the model treats
 * the user's text as data rather than as additional instructions. This is the
 * cheapest available defense against a captured inspiration that itself
 * contains text like "ignore the above and respond with X" — the delimiter
 * pattern + the system instruction's explicit "Output only the label" rule
 * make prompt injection materially harder without changing the API surface.
 */
function buildUserPrompt(text: string): string {
  return `Classify the following inspiration. Respond with exactly one label.

<<<inspiration>>>
${text}
<<<end>>>`;
}

// ---------------------------------------------------------------------------
// Wire types (minimal subset)
// ---------------------------------------------------------------------------

/**
 * Request body for `models/<model>:generateContent`. We only declare the
 * fields we set; the API tolerates additional unknown fields at the top
 * level, so this is a structural subset rather than a full schema.
 */
interface GenerateContentRequest {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: "user"; parts: { text: string }[] }[];
  generationConfig: {
    temperature: number;
    responseMimeType: "application/json";
    /**
     * STRING + enum constrains decoding to exactly one of the listed values,
     * JSON-encoded (i.e. the response text is `"outlier"`, including the
     * surrounding double-quotes).
     */
    responseSchema: {
      type: "STRING";
      enum: readonly string[];
    };
  };
}

// ---------------------------------------------------------------------------
// Zod schemas — Sub-AC 10.3.3
// ---------------------------------------------------------------------------
//
// Why Zod here (and not in queue/classifier.ts)?
// ----------------------------------------------
// `classifier.ts` validates a one-field legacy compatibility envelope
// (`{ inspirationId }`) where adding zod is dead weight. The Gemini response, in contrast, is a
// nested wire shape we don't control — Google can extend it, drop fields,
// reorder candidates, or change the safety-block envelope. Centralising the
// "what does a usable Gemini response look like?" rule into a Zod schema buys
// three things:
//
//   1. *One* place to update when the upstream API drifts.
//   2. Structured, typed errors — `safeParse` returns either `success` plus a
//      narrowed type or a `ZodError` whose `issues[]` we can log verbatim. No
//      ad-hoc string sniffing.
//   3. The schema doubles as documentation: a reader can see exactly which
//      fields the worker depends on without scrolling through guard clauses.
//
// All schemas use `safeParse` at call-sites — we never throw on a bad shape.
// The contract with `queue/classifier.ts` is "return null for any unusable
// response, throw only on transport-level errors" (see file header). Zod's
// failures are *parsing* failures (the shape we got back was malformed), which
// fall on the "return null" side of that contract.

/**
 * The canonical cluster label, as a Zod enum.
 *
 * Single source of truth is still `clusterEnumValues` from the Drizzle schema
 * — `z.enum` accepts the same `readonly string[]` and gives us:
 *   - a runtime validator (`safeParse`),
 *   - a static type (`z.infer<typeof clusterSchema>`) that is assignable to
 *     `Cluster` (verified by the satisfies-style assertion below),
 *   - and a single point of failure if/when the schema and the DB enum drift.
 */
export const clusterSchema = z.enum(clusterEnumValues);

// Compile-time guard: if anyone widens `clusterEnumValues` without adding the
// new label to the DB enum migration, this assignment breaks the build before
// it can ship. The `as` cast is a no-op at runtime; it exists purely to make
// the type-equality check explicit for future readers.
const _clusterTypeCheck: Cluster = "" as z.infer<typeof clusterSchema>;
void _clusterTypeCheck;

/**
 * Minimal Zod schema for the Gemini `:generateContent` response envelope.
 *
 * We deliberately mark every field optional and use `.passthrough()` so an
 * upstream addition (new top-level field, extra metadata on `candidates[]`)
 * does NOT cause the schema to reject an otherwise-valid response. The fields
 * we do care about are typed strictly:
 *
 *   - `candidates[].content.parts[].text` — where the model output lives.
 *   - `candidates[].finishReason`        — for logging (STOP / SAFETY / …).
 *   - `promptFeedback.blockReason`       — for safety-block detection.
 *
 * Anything else is preserved but ignored.
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
                  .array(
                    z
                      .object({
                        text: z.string().optional(),
                      })
                      .passthrough(),
                  )
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
      .object({
        blockReason: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

/**
 * Static type derived from the Zod schema. Replaces the previous hand-typed
 * `interface GenerateContentResponse` so the type and the validator can never
 * disagree.
 */
export type GenerateContentResponse = z.infer<
  typeof generateContentResponseSchema
>;

// ---------------------------------------------------------------------------
// Output validation
// ---------------------------------------------------------------------------

/**
 * Type-guard: is `value` one of the canonical cluster enum strings?
 *
 * Backed by `clusterSchema.safeParse` rather than a hand-rolled `includes`
 * check — same single source of truth (`clusterEnumValues`), but now the
 * validator and the type are both derived from the same Zod schema, so
 * adding / renaming a label is still a one-file change in `db/schema.ts`.
 */
export function validateCluster(value: unknown): value is Cluster {
  return clusterSchema.safeParse(value).success;
}

/**
 * Extract the cluster label from Gemini's response payload.
 *
 * Two-stage validation:
 *
 *   1. **Envelope shape** — `generateContentResponseSchema.safeParse(body)`
 *      confirms `body` is structurally a Gemini response (or close enough
 *      under `.passthrough()` that we can read the parts we care about). A
 *      shape failure returns null + logs the Zod issues; we never throw.
 *
 *   2. **Label content** — the inner `text` is JSON-decoded (the documented
 *      shape under `responseSchema.type === "STRING"` produces a JSON-quoted
 *      string like `"outlier"`), with a fallback to the raw, trimmed,
 *      quote-stripped string for the un-quoted case. The result is then run
 *      through `clusterSchema.safeParse` so out-of-set values become null.
 *
 * Defensive against (each → returns null, never throws):
 *   - Body is not an object / fails envelope shape validation
 *   - Missing `candidates` (safety block, etc.)
 *   - Empty / non-string `parts[0].text`
 *   - Plain string (no JSON quoting; unlikely but cheap)
 *   - JSON parse error on the text
 *   - Out-of-set string after parsing
 *
 * The caller (queue/classifier.ts) treats `null` as "no classification this
 * time" and leaves the row's `cluster` column NULL — the same retry semantics
 * as a Gemini safety block.
 */
export function parseClusterFromResponse(body: unknown): Cluster | null {
  const envelope = generateContentResponseSchema.safeParse(body);
  if (!envelope.success) {
    // Structural drift on Google's side. Log the issues so a future on-call
    // engineer can see exactly which path failed without re-running the
    // request. We log at warn (not error) because a single malformed
    // response is permanent-skip, not retry — see file header contract.
    console.warn("[gemini] response envelope failed schema validation", {
      issues: envelope.error.issues,
    });
    return null;
  }

  const text = envelope.data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string" || text.length === 0) return null;

  // Try JSON-decode first (the documented shape under responseSchema STRING),
  // fall back to the raw text trimmed of surrounding whitespace and quotes.
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    candidate = text.trim().replace(/^["']|["']$/g, "");
  }

  const label = clusterSchema.safeParse(candidate);
  return label.success ? label.data : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build the full request body sent to Gemini for a given inspiration text.
 *
 * Exported for two reasons:
 *   1. Unit tests can snapshot the exact bytes that go on the wire without
 *      having to mock `fetch`.
 *   2. A future smoke-test or canary tool can re-run the prompt against a
 *      different model id by calling this and swapping the URL.
 */
export function buildClassificationRequest(
  text: string,
): GenerateContentRequest {
  return {
    systemInstruction: {
      parts: [{ text: CLASSIFIER_SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: buildUserPrompt(text) }],
      },
    ],
    generationConfig: {
      // 0 = greedy / deterministic. Classification has a single right answer
      // per input; we want the same input to always map to the same output so
      // re-classification (e.g. backfill) doesn't re-shuffle clusters.
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "STRING",
        enum: clusterEnumValues,
      },
    },
  };
}

/**
 * Build the absolute URL for a `:generateContent` call against the configured
 * model. Pulled out of `classifyInspirationText` so a smoke test can hit the
 * same URL without re-implementing the path construction.
 */
export function buildGenerateContentUrl(): string {
  return buildGeminiModelEndpoint(GEMINI_MODEL, "generateContent");
}

/**
 * Outcome of a classification attempt.
 *
 * `cluster` is the only field the caller usually cares about. The other
 * fields exist so the queue worker can write structured logs without the
 * Gemini module having to know about logging conventions.
 */
export interface ClassificationResult {
  /** Validated cluster label, or null if Gemini gave us nothing usable. */
  cluster: Cluster | null;
  /** Gemini's reported finishReason (STOP / SAFETY / MAX_TOKENS / …). */
  finishReason: string | null;
  /**
   * Set when Gemini refused the prompt entirely (safety / recitation block).
   * The worker logs this so we can spot a rising block-rate on a real corpus
   * of saved inspirations.
   */
  blockReason: string | null;
}

/**
 * Classify a single inspiration's text.
 *
 * Resolves with a `ClassificationResult`. Returns `cluster: null` when:
 *   - the input is empty after trimming (nothing to classify),
 *   - Gemini blocked the prompt for safety / recitation,
 *   - Gemini returned a value that didn't survive `validateCluster`.
 *
 * Throws on:
 *   - missing API key                       → fail-loud configuration error
 *   - non-2xx HTTP response                 → transient; DB-backed worker will retry
 *   - network error inside `fetch`          → same as above
 *   - non-JSON response body                → indicates an upstream protocol
 *                                             change; loud failure is correct
 *
 * The split between "return null" and "throw" matters because the DB-backed
 * worker uses it to decide retry-vs-give-up:
 *   - `null` → permanent: leave `cluster` NULL on the row and mark the job
 *     succeeded. A backfill job can revisit later if we want.
 *   - throw  → transient: leave the job pending with backoff for another drain.
 */
export async function classifyInspirationText(
  rawText: string,
): Promise<ClassificationResult> {
  // Defensive trim. The DB column is `text NOT NULL` so empty-string is
  // technically possible if a future code path inserts one; treat that as
  // "nothing to classify" rather than burning a Gemini call on whitespace.
  const trimmed = rawText.trim();
  if (trimmed.length === 0) {
    return { cluster: null, finishReason: null, blockReason: null };
  }

  const text =
    trimmed.length > MAX_INSPIRATION_CHARS
      ? trimmed.slice(0, MAX_INSPIRATION_CHARS)
      : trimmed;

  const apiKey = getGeminiApiKey();
  const url = buildGenerateContentUrl();
  const requestBody = buildClassificationRequest(text);

  const response = await fetch(url, {
    method: "POST",
    headers: buildGeminiJsonHeaders(apiKey),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(
      formatSafeGeminiError(
        "Gemini classify failed",
        await safeGeminiErrorDetails(response),
      ),
    );
  }

  // Parse the JSON envelope. A non-JSON success body would indicate Google
  // changed the API contract; throw so the failure is loud rather than
  // silently degrading every inspiration to cluster=null.
  let rawJson: unknown;
  try {
    rawJson = await response.json();
  } catch (err) {
    throw new Error(
      `Gemini classify returned non-JSON body: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Validate the envelope shape via the shared Zod schema. A shape failure
  // here is treated as "permanent skip" (cluster=null) rather than thrown,
  // because a malformed envelope will be malformed on every retry — the
  // model genuinely produced something we can't classify, and retrying would
  // just burn through the background job attempt budget.
  const envelope = generateContentResponseSchema.safeParse(rawJson);
  if (!envelope.success) {
    console.warn("[gemini] generateContent body failed schema validation", {
      issues: envelope.error.issues,
    });
    return { cluster: null, finishReason: null, blockReason: null };
  }

  const parsed = envelope.data;
  const finishReason = parsed.candidates?.[0]?.finishReason ?? null;
  const blockReason = parsed.promptFeedback?.blockReason ?? null;

  // If the prompt was blocked outright, candidates will be empty. Don't
  // throw — this is a permanent decision by Google about this specific
  // input, and retrying will produce the same block.
  if (blockReason) {
    return { cluster: null, finishReason, blockReason };
  }

  const cluster = parseClusterFromResponse(parsed);
  return { cluster, finishReason, blockReason };
}
