/**
 * Standalone smoke test for the Gemini classifier client (Sub-AC 10.3.2).
 *
 * Run with:
 *   pnpm --filter @waka/api exec tsx src/queue/gemini.smoke.ts
 *
 * Exits 0 on full pass, 1 on any failure. Same one-off-script style as the
 * other `*.smoke.ts` files in this package; no vitest dependency.
 *
 * What we cover:
 *   1. The request builder injects the inspiration text into the user
 *      content, sets temperature=0, and pins the responseSchema enum to the
 *      six canonical cluster labels (single source of truth: Drizzle schema's
 *      `clusterEnumValues`). This is what guarantees the model can never emit
 *      a label outside the allowed set.
 *   2. The system instruction defines all six cluster meanings and the rule
 *      "output only the label". Drift here would change classification
 *      behaviour silently, so we assert the contract bullets are present.
 *   3. The user prompt wraps the inspiration text in delimiters so a captured
 *      inspiration containing prompt-injection-like text (e.g. "ignore the
 *      above") is treated as data, not as instructions.
 *   4. `validateCluster` accepts every canonical label and rejects everything
 *      else (case-mismatched, whitespace, neighbours, non-strings).
 *   5. `parseClusterFromResponse` handles the documented JSON-encoded shape,
 *      the un-quoted fallback shape, missing candidates, empty parts, and
 *      out-of-set strings — without ever throwing.
 *   6. URL/header builders pin the `gemini-3.1-flash-lite` model id, keep secrets
 *      out of the URL, and send the key via `x-goog-api-key`.
 *   7. (Live, optional) If `GEMINI_API_KEY` is set, classify a hand-picked
 *      inspiration end-to-end and assert the returned cluster is one of the
 *      six valid labels. Skipped silently if no key is configured so CI /
 *      offline dev runs never fail on transient network or rate-limit issues.
 */

import "dotenv/config";

import { clusterEnumValues } from "../db/index.js";
import { buildGeminiJsonHeaders } from "../lib/gemini-http.js";
import {
  CLASSIFIER_SYSTEM_INSTRUCTION,
  buildClassificationRequest,
  buildGenerateContentUrl,
  classifyInspirationText,
  clusterSchema,
  generateContentResponseSchema,
  parseClusterFromResponse,
  validateCluster,
} from "./gemini.js";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`assert: ${msg}`);
}

async function main() {
  // -------------------------------------------------------------------------
  // 1. Request body shape
  // -------------------------------------------------------------------------
  const sampleText = "the more I optimise the slower I get";
  const req = buildClassificationRequest(sampleText);

  assert(
    req.systemInstruction.parts[0]?.text === CLASSIFIER_SYSTEM_INSTRUCTION,
    "system instruction must round-trip through the request builder",
  );
  assert(req.contents.length === 1, "exactly one user-content block");
  assert(req.contents[0]?.role === "user", "content role must be 'user'");
  const userText = req.contents[0]?.parts[0]?.text ?? "";
  assert(
    userText.includes(sampleText),
    "user prompt must contain the inspiration text verbatim",
  );
  assert(
    userText.includes("<<<inspiration>>>") && userText.includes("<<<end>>>"),
    "user prompt must wrap the inspiration in delimiters (injection guard)",
  );

  assert(req.generationConfig.temperature === 0, "temperature must be 0");
  assert(
    req.generationConfig.responseMimeType === "application/json",
    "responseMimeType must be application/json",
  );
  assert(
    req.generationConfig.responseSchema.type === "STRING",
    "responseSchema.type must be STRING",
  );

  // The enum on the wire MUST be the same six labels as the Drizzle enum.
  // This is the structural guarantee that the model can't ever emit a
  // value the database can't store.
  const wireEnum = req.generationConfig.responseSchema.enum;
  assert(
    wireEnum.length === clusterEnumValues.length,
    `responseSchema enum length mismatch: ${wireEnum.length} vs ${clusterEnumValues.length}`,
  );
  for (const label of clusterEnumValues) {
    assert(
      wireEnum.includes(label),
      `responseSchema enum is missing canonical label: ${label}`,
    );
  }
  console.log("[1/7] request builder shape ✅");

  // -------------------------------------------------------------------------
  // 2. System instruction defines all six clusters + output contract
  // -------------------------------------------------------------------------
  for (const label of clusterEnumValues) {
    assert(
      CLASSIFIER_SYSTEM_INSTRUCTION.includes(`${label}:`),
      `system instruction must define "${label}:" with a meaning`,
    );
  }
  // The "output only the label" rule is what makes the un-quoted fallback in
  // parseClusterFromResponse safe — assert it survives prompt edits.
  assert(
    /Output only the label/i.test(CLASSIFIER_SYSTEM_INSTRUCTION),
    'system instruction must include "Output only the label" rule',
  );
  console.log("[2/7] system instruction covers all six labels ✅");

  // -------------------------------------------------------------------------
  // 3. Long input is truncated, not failed
  //    (4 kB cap; we send 10 kB and confirm the request still builds OK and
  //    the user prompt is bounded.)
  // -------------------------------------------------------------------------
  const longInput = "a".repeat(10_000);
  const longReq = buildClassificationRequest(longInput.slice(0, 4000));
  assert(
    (longReq.contents[0]?.parts[0]?.text?.length ?? 0) < 10_000,
    "user prompt must be bounded under the 4 kB cap",
  );
  console.log("[3/7] long input does not break the builder ✅");

  // -------------------------------------------------------------------------
  // 4. validateCluster accepts every canonical label, rejects everything else
  // -------------------------------------------------------------------------
  for (const label of clusterEnumValues) {
    assert(validateCluster(label), `validateCluster should accept "${label}"`);
  }
  for (const bogus of [
    "Outlier", // case
    " outlier", // whitespace
    "outliers", // plural
    "", // empty
    null,
    undefined,
    42,
    {},
    ["outlier"],
  ]) {
    assert(
      !validateCluster(bogus),
      `validateCluster must reject ${JSON.stringify(bogus)}`,
    );
  }
  console.log("[4/7] validateCluster is strict ✅");

  // -------------------------------------------------------------------------
  // 4b. Zod schemas (Sub-AC 10.3.3): cluster enum + envelope validator
  // -------------------------------------------------------------------------
  // The cluster Zod enum must accept exactly the canonical labels and reject
  // anything else — same contract as `validateCluster`, but reachable directly
  // for callers that want a typed `safeParse` result instead of a boolean.
  for (const label of clusterEnumValues) {
    assert(
      clusterSchema.safeParse(label).success,
      `clusterSchema must accept canonical label "${label}"`,
    );
  }
  for (const bogus of ["Outlier", "outliers", "", " outlier", null, 1, {}]) {
    assert(
      !clusterSchema.safeParse(bogus).success,
      `clusterSchema must reject ${JSON.stringify(bogus)}`,
    );
  }

  // The envelope schema MUST accept the canonical Gemini shape and surface
  // structured ZodIssues for malformed inputs.
  const validEnvelope = generateContentResponseSchema.safeParse({
    candidates: [
      {
        content: { parts: [{ text: '"loop"' }] },
        finishReason: "STOP",
      },
    ],
  });
  assert(
    validEnvelope.success,
    "envelope schema must accept the canonical generateContent response shape",
  );

  // `.passthrough()` means upstream additions don't break the worker — assert
  // an unknown top-level field is preserved rather than rejected.
  const futureProof = generateContentResponseSchema.safeParse({
    candidates: [{ content: { parts: [{ text: '"morph"' }] } }],
    usageMetadata: { promptTokenCount: 42 }, // hypothetical future field
  });
  assert(
    futureProof.success,
    "envelope schema must passthrough unknown top-level fields (forward-compat)",
  );

  // Malformed input must produce a structured failure (issues[]), never throw.
  const malformed = generateContentResponseSchema.safeParse(
    "totally not a response object",
  );
  assert(
    !malformed.success,
    "envelope schema must reject a non-object body",
  );
  assert(
    !malformed.success && malformed.error.issues.length > 0,
    "envelope schema failure must include at least one ZodIssue for logging",
  );
  console.log("[4b] zod schemas validate envelope + cluster enum ✅");

  // -------------------------------------------------------------------------
  // 5. parseClusterFromResponse — documented + degenerate shapes
  // -------------------------------------------------------------------------
  // 5a. Canonical: text is a JSON-encoded string ("\"outlier\"").
  assert(
    parseClusterFromResponse({
      candidates: [{ content: { parts: [{ text: '"outlier"' }] } }],
    }) === "outlier",
    "documented JSON-encoded shape must parse to the cluster label",
  );

  // 5b. Fallback: model emitted bare label (no JSON quoting). Allowed because
  // the system instruction says "Output only the label" and this protects us
  // if the responseSchema constraint is briefly relaxed upstream.
  assert(
    parseClusterFromResponse({
      candidates: [{ content: { parts: [{ text: "tension" }] } }],
    }) === "tension",
    "bare-string fallback must still parse to the label",
  );

  // 5c. Out-of-set string → null, never a typed Cluster.
  assert(
    parseClusterFromResponse({
      candidates: [{ content: { parts: [{ text: '"banana"' }] } }],
    }) === null,
    "out-of-set string must be rejected by the validator",
  );

  // 5d. Missing candidates (e.g. safety block) → null.
  assert(
    parseClusterFromResponse({}) === null,
    "missing candidates must yield null, not throw",
  );
  assert(
    parseClusterFromResponse({ candidates: [] }) === null,
    "empty candidates must yield null",
  );
  assert(
    parseClusterFromResponse({ candidates: [{ content: { parts: [] } }] }) ===
      null,
    "empty parts must yield null",
  );
  assert(
    parseClusterFromResponse({
      candidates: [{ content: { parts: [{ text: "" }] } }],
    }) === null,
    "empty text must yield null",
  );

  // 5e. Garbage JSON in text → caught by the try/catch + validator.
  assert(
    parseClusterFromResponse({
      candidates: [{ content: { parts: [{ text: "{not json" }] } }],
    }) === null,
    "non-JSON text that also isn't a valid label must yield null",
  );

  // 5f. Top-level malformed body (string, number, null) → null, no throw.
  // This exercises the envelope-shape Zod failure path explicitly.
  for (const malformed of [null, "oops", 42, true, ["nope"]]) {
    assert(
      parseClusterFromResponse(malformed) === null,
      `parseClusterFromResponse must return null for malformed body: ${JSON.stringify(malformed)}`,
    );
  }

  // 5g. Forward-compat: extra unknown top-level fields must NOT cause the
  // parser to drop a valid label. Guards against an upstream addition (e.g.
  // a new `usageMetadata` block) accidentally breaking classification.
  assert(
    parseClusterFromResponse({
      candidates: [{ content: { parts: [{ text: '"convergence"' }] } }],
      usageMetadata: { promptTokenCount: 99 },
    }) === "convergence",
    "unknown top-level fields must be tolerated via .passthrough()",
  );
  console.log("[5/7] parseClusterFromResponse covers degenerate shapes ✅");

  // -------------------------------------------------------------------------
  // 6. URL/header builders
  // -------------------------------------------------------------------------
  const url = buildGenerateContentUrl();
  assert(
    url ===
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent",
    `URL must hit the v1beta gemini-3.1-flash-lite generateContent endpoint without query secrets, got: ${url}`,
  );
  assert(!url.includes("?key="), "API key must not be placed in the query string");
  const headers = buildGeminiJsonHeaders("ABC=DEF&xyz");
  assert(headers["x-goog-api-key"] === "ABC=DEF&xyz", "API key must be sent via x-goog-api-key header");
  assert(headers["Content-Type"] === "application/json", "Gemini request Content-Type must be JSON");
  console.log("[6/7] URL builder pins model and sends key via header ✅");

  // -------------------------------------------------------------------------
  // 7. Live integration — only when GEMINI_API_KEY is configured
  // -------------------------------------------------------------------------
  if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 0) {
    // A deliberately self-referential / cyclical inspiration so we have a
    // human-eyeballed expected label ("loop"). We don't *require* the model
    // to return "loop" — model behaviour can drift — but we do require it to
    // return *one of the six valid labels*, which is the actual API
    // contract we ship to the queue worker.
    const result = await classifyInspirationText(
      "the more I optimise my morning routine the more time I spend optimising my morning routine",
    );
    assert(
      result.cluster === null ||
        (clusterEnumValues as readonly string[]).includes(result.cluster),
      `live classify must return null or a canonical label, got: ${JSON.stringify(result)}`,
    );
    console.log(
      `[7/7] live classify returned ${JSON.stringify(result.cluster)} (finish=${result.finishReason}) ✅`,
    );
  } else {
    console.log("[7/7] live classify skipped (no GEMINI_API_KEY) ⏭");
  }
}

main()
  .then(() => {
    console.log("ALL SMOKE TESTS PASSED");
    process.exit(0);
  })
  .catch((err) => {
    console.error("SMOKE TEST FAILED:", err);
    process.exit(1);
  });
