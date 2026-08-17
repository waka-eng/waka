/**
 * No HTTP handler spends the shared model key.
 *
 * There is one Gemini key behind every account. `lib/model-budget.ts` bounds
 * what one account may spend of it, and that budget is enforced in exactly one
 * place: the drain, as it decides whose job to claim next. Every model call
 * the budget governs is therefore a call made from a background job — and a
 * call made anywhere else is a call the budget cannot see.
 *
 * That is not a hypothetical. The cap shipped with `PATCH /api/signals/:id`
 * still embedding a rewritten statement inline, one Gemini call per request,
 * on a route any account holder can drive as fast as their connection allows.
 * The queue was capped and the door beside it was open. Reviewing for it once
 * found it; only a test keeps finding it.
 *
 * So this reads the route sources as text and asserts the boundary directly.
 * Text rather than types because the property is "this module cannot reach
 * that function", and the cheapest honest way to check reachability across a
 * package is to check that the name never appears. A route needing model work
 * enqueues a job; the job is where the meter is.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROUTES_DIR = dirname(fileURLToPath(import.meta.url));
const API_ROOT = resolve(ROUTES_DIR, "..", "..");

/**
 * Every entry point whose body ends in a request to Gemini, and the module
 * that declares it.
 *
 * Named one by one rather than inferred, because "does this eventually call
 * the model" is not something a regex can decide — `signal-derivation.ts`
 * exports both `deriveSignalsForInspiration`, which spends the key, and
 * `computeSignalConfidence`, which is arithmetic a route is welcome to use.
 * The declaring module is recorded so that the list cannot rot into a
 * tautology: the first test below fails if a name here is not really exported
 * there, which is what a rename would otherwise do to this guard — leave it
 * passing and checking nothing.
 */
const SPENDS_THE_SHARED_KEY: Record<string, string> = {
  // The embedding client itself, and the two callers that construct one.
  GeminiEmbeddingHttpClient: "src/lib/inspiration-embeddings.ts",
  ensureInspirationEmbedding: "src/lib/inspiration-embeddings.ts",
  reembedSignalStatement: "src/lib/signal-derivation.ts",
  reembedSignal: "src/lib/signal-derivation.ts",
  // Extraction, judging, synthesis — the generation calls.
  deriveSignalsForInspiration: "src/lib/signal-derivation.ts",
  refreshTopOfMindForProfile: "src/lib/top-of-mind-synthesis.ts",
  refreshTopOfMindForGroup: "src/lib/top-of-mind-synthesis.ts",
  extractSignalCandidates: "src/queue/gemini.ts",
  judgeSignalMatch: "src/queue/gemini.ts",
  synthesizeTopOfMind: "src/queue/gemini.ts",
  // Enrichment: describing an image is a model call, and the attachment path
  // reaches it.
  describeImage: "src/lib/image-description.ts",
  enrichAttachment: "src/lib/signal-enrichment.ts",
  enrichImageAttachment: "src/lib/signal-enrichment.ts",
  // The provider factory and the raw transport, so a route cannot simply
  // assemble its own call out of the parts.
  getDefaultModelProvider: "src/lib/model-provider.ts",
  createGeminiModelProvider: "src/lib/gemini-model-provider.ts",
  fetchModelWithTimeout: "src/lib/gemini-http.ts",
};

function routeSources(): Array<{ file: string; source: string }> {
  return readdirSync(ROUTES_DIR)
    .filter((name) => name.endsWith(".ts") && !name.includes(".test."))
    .sort()
    .map((name) => ({
      file: `packages/api/src/routes/${name}`,
      source: readFileSync(join(ROUTES_DIR, name), "utf8"),
    }));
}

describe("model spend stays on the queue", () => {
  it("names only functions that really are exported where they are said to be", () => {
    const wrong = Object.entries(SPENDS_THE_SHARED_KEY).filter(([name, path]) => {
      const source = readFileSync(resolve(API_ROOT, path), "utf8");
      return !new RegExp(`export (async function|function|class|const) ${name}\\b`).test(source);
    });
    expect(
      wrong.map(([name, path]) => `${name} is not exported by ${path}`),
      "A renamed export would leave this guard passing while checking nothing. " +
        "Update the list in the same diff as the rename.",
    ).toEqual([]);
  });

  it("keeps every one of them out of every route handler", () => {
    const found: string[] = [];
    for (const { file, source } of routeSources()) {
      for (const name of Object.keys(SPENDS_THE_SHARED_KEY)) {
        if (!new RegExp(`\\b${name}\\b`).test(source)) continue;
        found.push(`${file} reaches ${name}`);
      }
    }
    expect(
      found,
      "A request handler must not call the model directly: the per-account " +
        "budget is enforced at the drain, so a call made inside a Hono " +
        "handler is a call nothing counts. Enqueue a job instead.",
    ).toEqual([]);
  });
});
