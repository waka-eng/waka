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
import * as derivation from "./signal-derivation.js";
import * as synthesis from "./top-of-mind-synthesis.js";
import * as gemini from "../queue/gemini.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const DOC_PATH = resolve(REPO_ROOT, "docs/generation.md");
const doc = readFileSync(DOC_PATH, "utf8");

/**
 * The modules whose exported tuning values the doc promises to list. A
 * constant is "tuning" when it is UPPER_SNAKE and a number or string —
 * schemas, functions, and classes are behavior, covered by their own tests.
 */
const MODULES: Record<string, Record<string, unknown>> = {
  "signal-derivation.ts": derivation,
  "top-of-mind-synthesis.ts": synthesis,
  "gemini.ts": gemini,
  "inspiration-embeddings.ts": embeddings,
};

function tuningExports(): Map<string, string> {
  const out = new Map<string, string>();
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
  it("keeps the match thresholds ordered: judge band < match < batch dedupe", () => {
    expect(derivation.SIGNAL_MERGE_JUDGE_MIN_COSINE).toBeLessThan(
      derivation.SIGNAL_MATCH_MIN_COSINE,
    );
    expect(derivation.SIGNAL_MATCH_MIN_COSINE).toBeLessThan(
      derivation.SIGNAL_BATCH_DEDUPE_MIN_COSINE,
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

  it("keeps a capture that yields nothing from costing a synthesis", () => {
    // The trigger table claims refresh-after-derivation is conditional on the
    // signal set moving. The queue encodes that as an explicit `changed`
    // check; this pins the code shape the claim rests on.
    const queueSource = readFileSync(
      resolve(REPO_ROOT, "packages/api/src/lib/queue.ts"),
      "utf8",
    );
    expect(queueSource).toMatch(/const changed =[\s\S]{0,200}if \(changed\)/);
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

  it("stays discoverable: the README links the canon", () => {
    const readme = readFileSync(resolve(REPO_ROOT, "README.md"), "utf8");
    expect(readme).toContain("docs/generation.md");
  });
});
