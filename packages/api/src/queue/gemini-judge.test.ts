/**
 * The merge judge's request and its reading of the answer. The judge decides
 * whether two statements are one pattern, and both of its failure directions
 * are asymmetric: a wrong "same" fuses patterns invisibly, so everything
 * uncertain or malformed must land on "different".
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
  it("asks a comparison at temperature zero with a boolean schema", () => {
    const request = buildSignalMatchJudgementRequest(INPUT);

    expect(request.generationConfig.temperature).toBe(0);
    expect(request.generationConfig.responseSchema).toMatchObject({
      type: "OBJECT",
      required: ["samePattern"],
    });
  });

  it("delimits both statements — they are content, never instructions", () => {
    const prompt = buildSignalMatchJudgementRequest(INPUT).contents[0]!.parts[0]!.text!;

    expect(prompt).toContain("<<<statement>>>");
    expect(prompt).toContain(INPUT.candidateStatement);
    expect(prompt).toContain(INPUT.existingStatement);
    // Two statements, two fences each.
    expect(prompt.match(/<<<statement>>>/g)).toHaveLength(2);
    expect(prompt.match(/<<<end>>>/g)).toHaveLength(2);
  });

  it("tells the judge that uncertainty means different", () => {
    expect(SIGNAL_MATCH_JUDGE_SYSTEM_INSTRUCTION).toMatch(/uncertain, answer false/i);
  });
});

describe("parseSignalMatchJudgement", () => {
  it("reads a clear yes", () => {
    expect(parseSignalMatchJudgement({ samePattern: true })).toEqual({ samePattern: true });
  });

  it.each([
    { samePattern: false },
    { samePattern: "true" },
    { same: true },
    {},
    null,
    "yes",
    42,
  ])("lands %j on different", (payload) => {
    expect(parseSignalMatchJudgement(payload)).toEqual({ samePattern: false });
  });
});
