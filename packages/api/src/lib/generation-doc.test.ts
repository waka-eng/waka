/**
 * The drift lock between docs/generation.md and the implementation.
 *
 * The doc is the team's shared understanding of how memory is generated; a
 * doc that silently disagrees with the code is worse than no doc, because it
 * is believed. So this test makes the disagreement loud:
 *
 *   1. Every exported tuning constant from the four generation modules must
 *      appear in the doc's tables with exactly the code's value — and every
 *      table row must name a real export. Both directions, so an undocumented
 *      new constant fails CI just like a stale documented one.
 *   2. Inline `CONSTANT_NAME (value)` mentions in prose are held to the same
 *      standard as table rows.
 *   3. The doc's structural claims (threshold ordering, weight sums, the
 *      cold-start floor, named functions) are re-asserted here.
 *   4. Every repo path the doc cites must exist — renames must update the doc.
 *
 * If this test failed your PR: change the doc and the code in the same diff.
 * That is the point.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import * as embeddings from "./inspiration-embeddings.js";
import * as principleGeneration from "./principle-generation.js";
import * as modelBudget from "./model-budget.js";
import * as openrouterHttp from "./openrouter-http.js";
import * as derivation from "./signal-derivation.js";
import * as derivationThresholds from "./signal-derivation-thresholds.js";
import * as synthesis from "./top-of-mind-synthesis.js";
import * as gemini from "../queue/gemini.js";
import * as signalRoutes from '../routes/signals.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DOC_PATH = resolve(REPO_ROOT, "docs/generation.md");
const doc = readFileSync(DOC_PATH, "utf8");

/**
 * The modules whose exported tuning values the doc promises to list. A
 * constant is "tuning" when it is UPPER_SNAKE and a number or string —
 * schemas, functions, and classes are behavior, covered by their own tests.
 */
const MODULES: Record<string, Record<string, unknown>> = {
  'signals.ts':signalRoutes,
  "principle-generation.ts": principleGeneration,
  // Layer 2's tuning all lives in the thresholds module now. It is named here
  // *as well as* being reachable through the facade, and the redundancy is the
  // point: `signal-derivation.ts` re-exports it with `export *` today, but the
  // moment someone rewrites that into a list of names the facade stops showing
  // this test any constant nobody remembered to add to the list — which is
  // precisely how a split once left an undocumented constant with a green
  // suite. Importing the module directly cannot be undone by a facade edit.
  "signal-derivation-thresholds.ts": derivationThresholds,
  // The pass itself, and with it every sibling stage it re-exports.
  "signal-derivation.ts": derivation,
  // Layer 3's tuning is all ranking, and ranking is a stage of the pass, so
  // the pass module is where the numbers live and the only one named here.
  // It used to be listed twice, the second entry a `top-of-mind-selection.ts`
  // that mirrored every constant and function of the ranking stage verbatim
  // and was imported by nothing but this map. Naming one module is not a
  // weaker guard: it is this guard finally pointed at the code that runs,
  // rather than at a copy that could agree with the doc for as long as it
  // liked while the pass drifted away from both.
  "top-of-mind-synthesis.ts": synthesis,
  "gemini.ts": gemini,
  "inspiration-embeddings.ts": embeddings,
  // What the pipeline is allowed to spend is tuning like any other: the
  // budget decides whether an account's derivation runs now or in an hour,
  // and a cap raised in code but not in the doc is exactly the drift the rest
  // of this file exists to catch.
  "model-budget.ts": modelBudget,
  "openrouter-http.ts": openrouterHttp,
};

/**
 * The field's constants live in the WEB package, and are read as text rather
 * than imported.
 *
 * Brightness in the field is a scoring model — it decides what a person sees —
 * so its numbers belong under the same guard as the ones deciding what the
 * machine concludes. They used to be eight literals in a render loop, silently
 * disagreeing with the constants above.
 *
 * Read, not imported, because the API test suite must not take a dependency on
 * the web package to check a document. A regex over `export const NAME = 7;`
 * is enough, and it fails loudly if the file moves — which is the correct
 * outcome, since the doc names its path.
 */
/*
 * A list rather than a glob: a new painter that exports tuning constants has to
 * be added here by hand. Weaker than a glob, but honest — the test names the
 * files it reads, and the doc names the same paths.
 */
const WEB_TUNING = [
  new URL("../../../web/src/lib/aliveness.ts", import.meta.url),
];

function webTuningExports(): Map<string, string> {
  const out = new Map<string, string>();
  for (const file of WEB_TUNING) {
    const src = readFileSync(fileURLToPath(file), "utf8");
    for (const m of src.matchAll(/^export const ([A-Z][A-Z0-9_]+) = ([0-9.]+);/gm)) {
      out.set(m[1] as string, String(m[2]));
    }
  }
  return out;
}

function tuningExports(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, value] of webTuningExports()) out.set(name, value);
  for (const mod of Object.values(MODULES)) {
    for (const [name, value] of Object.entries(mod)) {
      if (!/^[A-Z][A-Z0-9_]+$/.test(name)) continue;
      if (typeof value !== "number" && typeof value !== "string") continue;
      // Multi-line strings are prompt instructions — behavior, not tuning.
      // A value table cannot hold prose; their drift is covered by the
      // prompt-builder tests next to each instruction.
      if (typeof value === "string" && value.includes("\n")) continue;
      out.set(name, String(value));
    }
  }
  return out;
}

/** `| \`NAME\` | value | ...` rows from the doc's tables. */
function documentedRows(): Map<string, string> {
  const rows = new Map<string, string>();
  for (const match of doc.matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*([^|]+?)\s*\|/gm)) {
    rows.set(match[1]!, match[2]!.trim());
  }
  return rows;
}

describe("docs/generation.md stays true to the code", () => {
  const exported = tuningExports();
  const documented = documentedRows();

  it('keeps the review interval in both help translations aligned with the server',()=>{
    for(const [locale,suffix] of [['en-US',' days'],['ko-KR','일']] as const){
      const catalog=JSON.parse(readFileSync(resolve(REPO_ROOT,`packages/web/src/lib/i18n/messages/${locale}.json`),'utf8'));
      expect(catalog['worldHowReviewBody']).toContain(`${signalRoutes.CLAIM_REASK_DAYS}${suffix}`);
    }
  });

  it("documents every exported tuning constant", () => {
    const missing = [...exported.keys()].filter((name) => !documented.has(name));
    expect(
      missing,
      `Exported but absent from docs/generation.md's tables: ${missing.join(", ")}. ` +
        "New tuning constants must be documented in the same diff.",
    ).toEqual([]);
  });

  it("never documents a constant the code does not export", () => {
    const phantom = [...documented.keys()].filter((name) => !exported.has(name));
    expect(
      phantom,
      `In the doc's tables but not exported by the generation modules: ${phantom.join(", ")}. ` +
        "Either the code renamed it (update the doc) or the doc invented it.",
    ).toEqual([]);
  });

  it("agrees with the code on every value", () => {
    const stale = [...documented.entries()]
      .filter(([name]) => exported.has(name))
      .filter(([name, value]) => value !== exported.get(name))
      .map(([name, value]) => `${name}: doc says ${value}, code says ${exported.get(name)}`);
    expect(stale, `Stale values:\n  ${stale.join("\n  ")}`).toEqual([]);
  });

  it("agrees with the code in every inline `NAME (value)` mention", () => {
    const wrong: string[] = [];
    for (const match of doc.matchAll(/`([A-Z][A-Z0-9_]+)`\s*\((\d+(?:\.\d+)?)\)/g)) {
      const [, name, value] = match;
      const actual = exported.get(name!);
      if (actual !== undefined && actual !== value) {
        wrong.push(`${name}: doc prose says ${value}, code says ${actual}`);
      }
    }
    expect(wrong, `Stale prose:\n  ${wrong.join("\n  ")}`).toEqual([]);
  });

  it("cites only paths that exist", () => {
    const missing = [...doc.matchAll(/`((?:packages|docs|tools)\/[^`\s]+)`/g)]
      .map((match) => match[1]!)
      .filter((path) => !existsSync(resolve(REPO_ROOT, path)));
    expect(
      missing,
      `Paths cited in docs/generation.md that no longer exist: ${missing.join(", ")}`,
    ).toEqual([]);
  });
});

describe("the doc's [checked] structural claims", () => {
  it("keeps the match thresholds ordered: judge band < identical-wording attach", () => {
    expect(derivation.SIGNAL_MERGE_JUDGE_MIN_COSINE).toBeLessThan(
      derivation.SIGNAL_MATCH_MIN_COSINE,
    );
  });

  it("keeps the ground's refusal ahead of the match", () => {
    // The doc claims a candidate near a dismissed anchor is refused BEFORE
    // the match is even looked at — so a refused pattern cannot re-enter as
    // evidence for something else, and a refused candidate never spends a
    // judge call. The behavior is proven on a real database in
    // signal-suppression.db.test.ts; this pins the code shape the ordering
    // claim rests on, the way the queue's `changed` check is pinned below.
    const source = readFileSync(
      resolve(REPO_ROOT, "packages/api/src/lib/signal-match-or-mint.ts"),
      "utf8",
    );
    const refusal = source.indexOf("findSuppressionAnchor(candidate, anchors)");
    const match = source.indexOf("findBestMatch(candidate.embedding");
    expect(refusal).toBeGreaterThan(-1);
    expect(match).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(match);
    // A refusal bar below the judge band would silence candidates the match
    // would not even have asked about.
    expect(derivation.SIGNAL_SUPPRESSION_MIN_COSINE).toBeGreaterThanOrEqual(
      derivation.SIGNAL_MERGE_JUDGE_MIN_COSINE,
    );
  });

  it("keeps confidence weights summing to 100, with diversity as a bonus outside them", () => {
    expect(
      derivation.CONFIDENCE_SUPPORT_WEIGHT +
        derivation.CONFIDENCE_SPREAD_WEIGHT +
        derivation.CONFIDENCE_RECENCY_WEIGHT,
    ).toBe(100);
    expect(derivation.CONFIDENCE_SOURCE_DIVERSITY_BONUS).toBeGreaterThan(0);
  });

  it("keeps selection weights summing to 1", () => {
    expect(
      synthesis.SELECTION_CONFIDENCE_WEIGHT +
        synthesis.SELECTION_EVIDENCE_WEIGHT +
        synthesis.SELECTION_RECENCY_WEIGHT +
        synthesis.SELECTION_COMEBACK_WEIGHT,
    ).toBeCloseTo(1, 10);
  });

  it("keeps the cold-start floor within the selection limit", () => {
    expect(synthesis.TOP_OF_MIND_MIN_SIGNALS).toBeGreaterThan(0);
    expect(synthesis.TOP_OF_MIND_MIN_SIGNALS).toBeLessThanOrEqual(
      synthesis.TOP_OF_MIND_SIGNAL_LIMIT,
    );
  });

  it("keeps the named decision functions the doc points at", () => {
    expect(typeof derivation.classifyMatch).toBe("function");
    expect(typeof synthesis.chooseSelection).toBe("function");
    expect(typeof synthesis.computeSelectionScore).toBe("function");
    expect(typeof derivation.computeSignalConfidence).toBe("function");
  });

  it("requests synthesis only when discovery or explicit reconciliation changed support", () => {
    // The enqueue moved into the evidence transaction. Pin its real owner,
    // not a no-longer-authoritative check in the job router. SQL tests also
    // verify the unchanged and explicit-withdrawal zero-candidate branches.
    const derivationSource = readFileSync(
      resolve(REPO_ROOT, "packages/api/src/lib/signal-derivation.ts"),
      "utf8",
    );
    expect(derivationSource).toMatch(/const changed =[\s\S]{0,200}if \(changed\)/);
    const supportSource = readFileSync(resolve(REPO_ROOT, "packages/api/src/lib/signal-support-apply.ts"), "utf8");
    expect(supportSource).toMatch(/const changed = withdrawn\.length \+ restored\.length > 0/);
    expect(supportSource).toMatch(/const job = !changed \? null/);
  });

  it("keeps confidence computed live at reads and selection, not served stale", () => {
    // The doc claims time actually passes for a signal: personal reads and
    // layer-3 selection recompute confidence from evidence at request time.
    // The stored snapshot is written when its recency term peaks, so serving
    // it would freeze every signal at its best moment — the bug this pins
    // against reintroducing.
    const readsSource = readFileSync(
      resolve(REPO_ROOT, "packages/api/src/routes/signals.ts"),
      "utf8",
    );
    const selectionSource = readFileSync(
      resolve(REPO_ROOT, "packages/api/src/lib/top-of-mind-synthesis.ts"),
      "utf8",
    );
    expect(readsSource).toMatch(/computeSignalConfidence\(/);
    expect(selectionSource).toMatch(/computeSignalConfidence\(/);
  });

  it("keeps the longevity bar measuring the union of citing signals", () => {
    // The doc claims span and survivals are the THEME's, not any one
    // wording's. Union semantics: no single signal below clears the bar the
    // set clears together.
    const now = new Date("2026-08-21T00:00:00Z");
    const DAY = 86_400_000;
    const set = [
      { signalId: "a", statement:"Pattern A", evidenceAt: [new Date(now.getTime() - 60 * DAY), new Date(now.getTime() - 55 * DAY)], tomVersionIds: ["v1", "v2"] },
      { signalId: "b", statement:"Pattern B", evidenceAt: [new Date(now.getTime() - 35 * DAY)], tomVersionIds: ["v3", "v4"] },
      { signalId: "c", statement:"Pattern C", evidenceAt: [new Date(now.getTime())], tomVersionIds: ["v5"] },
    ];
    expect(principleGeneration.computeCitationEligibility(set, now).eligible).toBe(true);
    for (const one of set) {
      expect(principleGeneration.computeCitationEligibility([one], now).eligible).toBe(false);
    }
  });

  it("keeps the generation and evidence integrity functions available", () => {
    // The cadence pin lives in sst-config-env.test.ts; this re-asserts the
    // doc's structural claim that the named pieces exist.
    expect(typeof principleGeneration.refreshPrinciplesForProfile).toBe("function");
    expect(typeof principleGeneration.computeCitationEligibility).toBe("function");
    expect(typeof principleGeneration.reconcileAction).toBe("function");
  });

  it("stays discoverable: the README links the canon", () => {
    const readme = readFileSync(resolve(REPO_ROOT, "README.md"), "utf8");
    expect(readme).toContain("docs/generation.md");
  });
});
