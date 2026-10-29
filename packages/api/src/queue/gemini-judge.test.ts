/**
 * The merge judge's request and its reading of the answer — three-way since
 * no-quiet-corners Phase 5. The judge names the relation between two
 * statements (same | independent | opposed), and its failure directions are
 * still asymmetric: a wrong `same` fuses patterns invisibly, and a wrong
 * `opposed` manufactures a dispute the person never had — so everything
 * genuine uncertainty may return `independent`; malformed output must fail.
 */

import { describe, expect, it } from "vitest";

import {
  buildSignalMatchJudgementRequest,
  parseSignalMatchJudgement,
  SIGNAL_MATCH_JUDGE_SYSTEM_INSTRUCTION,
} from "./gemini.js";

const INPUT = {
  preferredLocale: "en-US" as const,
  candidateStatement: "I keep only the tools I could rebuild in an evening.",
  existingStatement: "Small, focused tools outlast my ambitious systems.",
};

describe("buildSignalMatchJudgementRequest", () => {
  it("asks a comparison at temperature zero with the three-way enum schema", () => {
    const request = buildSignalMatchJudgementRequest(INPUT);

    expect(request.generationConfig.temperature).toBe(0);
    expect(request.generationConfig.responseSchema).toMatchObject({
      type: "OBJECT",
      required: ["relation"],
      properties: {
        relation: { type: "STRING", enum: ["same", "independent", "opposed"] },
      },
    });
  });

  it("delimits both statements — they are content, never instructions", () => {
    const prompt = buildSignalMatchJudgementRequest(INPUT).contents[0]!.parts[0]!.text!;

    expect(prompt).toContain(INPUT.candidateStatement);
    expect(prompt).toContain(INPUT.existingStatement);
    /* Through fence(), with a distinct tag per statement — the shared
       anonymous <<<statement>>>/<<<end>>> pair this test used to pin was the
       hand-rolled fence docs/known-issues.md logs as M9: a statement
       containing the closer ended its own fence. Each fence opens and closes
       exactly once; prompt-fence.test.ts holds the adversarial cases. */
    for (const tag of ["statement a", "statement b"]) {
      expect(prompt.match(new RegExp(`<<<${tag}>>>`, "g"))).toHaveLength(1);
      expect(prompt.match(new RegExp(`<<<end ${tag}>>>`, "g"))).toHaveLength(1);
    }
  });

  it("tells the judge all three verdicts, that tension is not opposition, and that uncertainty means independent", () => {
    expect(SIGNAL_MATCH_JUDGE_SYSTEM_INSTRUCTION).toMatch(/^same — /m);
    expect(SIGNAL_MATCH_JUDGE_SYSTEM_INSTRUCTION).toMatch(/^opposed — /m);
    expect(SIGNAL_MATCH_JUDGE_SYSTEM_INSTRUCTION).toMatch(/^independent — /m);
    expect(SIGNAL_MATCH_JUDGE_SYSTEM_INSTRUCTION).toMatch(/tension is NOT opposition/);
    expect(SIGNAL_MATCH_JUDGE_SYSTEM_INSTRUCTION).toMatch(/uncertain, answer independent/i);
  });
});

describe("parseSignalMatchJudgement", () => {
  it("reads each clear verdict", () => {
    expect(parseSignalMatchJudgement({ relation: "same" })).toEqual({ relation: "same" });
    expect(parseSignalMatchJudgement({ relation: "opposed" })).toEqual({
      relation: "opposed",
    });
    expect(parseSignalMatchJudgement({ relation: "independent" })).toEqual({
      relation: "independent",
    });
  });

  it.each([
    { relation: "conflicting" },
    { relation: true },
    { "samePattern": true },
    {},
    null,
    "opposed",
    42,
  ])("refuses %j rather than inventing an independent verdict", (payload) => {
    expect(() => parseSignalMatchJudgement(payload)).toThrow('signal match judgement');
  });
});
