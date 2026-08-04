/**
 * The reading-divergence judge's edges.
 *
 * A judgment we cannot read must never become a score: every unreadable
 * response shape has to come back null rather than zero. The prompt's job is
 * to frame all user-derived text as data, which is asserted here because it is
 * the only thing standing between a saved signal and prompt injection.
 */

import { describe, expect, it } from "vitest";

import {
  buildReadingDivergenceRequest,
  parseReadingDivergenceResponse,
} from "./reading-divergence-gemini.js";

describe("parseReadingDivergenceResponse", () => {
  function envelope(text: string): unknown {
    return { candidates: [{ content: { parts: [{ text }] } }] };
  }

  it("parses a well-formed judgment and clamps the score into 0-100", () => {
    expect(
      parseReadingDivergenceResponse(
        envelope('{"score": 130, "rationale": "  same ambition,   same direction  "}'),
      ),
    ).toEqual({ score: 100, rationale: "same ambition, same direction" });

    expect(
      parseReadingDivergenceResponse(envelope('{"score": -5, "rationale": "r"}')),
    ).toEqual({ score: 0, rationale: "r" });
  });

  it("reads a judgment out of a markdown fence", () => {
    expect(
      parseReadingDivergenceResponse(
        envelope('```json\n{"score": 40, "rationale": "shifted"}\n```'),
      ),
    ).toEqual({ score: 40, rationale: "shifted" });
  });

  it("returns null for blocked, empty, non-JSON, or schema-invalid responses", () => {
    expect(
      parseReadingDivergenceResponse({ promptFeedback: { blockReason: "SAFETY" } }),
    ).toBeNull();
    expect(parseReadingDivergenceResponse({ candidates: [] })).toBeNull();
    expect(parseReadingDivergenceResponse(envelope("not json at all"))).toBeNull();
    expect(parseReadingDivergenceResponse(envelope('{"score": 10}'))).toBeNull();
    expect(
      parseReadingDivergenceResponse(envelope('{"score": 10, "rationale": ""}')),
    ).toBeNull();
  });

  it("bounds the rationale to one line of at most 240 characters", () => {
    const judgment = parseReadingDivergenceResponse(
      envelope(JSON.stringify({ score: 55, rationale: "word ".repeat(100) })),
    );
    expect(judgment).not.toBeNull();
    expect(judgment!.rationale.length).toBeLessThanOrEqual(240);
    expect(judgment!.rationale.endsWith("…")).toBe(true);
  });
});

describe("buildReadingDivergenceRequest", () => {
  it("frames every user-derived string as untrusted data", () => {
    const request = buildReadingDivergenceRequest({
      signalText: "the clip of the crowd going quiet",
      soloBelief: "solo belief",
      soloWhy: "solo why",
      groupBelief: "group belief",
      groupWhy: "group why",
      locale: "en-US",
    });

    const prompt = request.contents[0]?.parts[0]?.text ?? "";
    const payload = JSON.parse(prompt) as Record<string, unknown>;
    expect(payload.untrustedSignalText).toBe("the clip of the crowd going quiet");
    expect(payload.readAlone).toEqual({
      untrustedBelief: "solo belief",
      untrustedWhy: "solo why",
    });
    expect(payload.readInTheRoom).toEqual({
      untrustedBelief: "group belief",
      untrustedWhy: "group why",
    });
    // Deterministic scoring posture: JSON-only, low temperature, no thinking.
    expect(request.generationConfig.responseMimeType).toBe("application/json");
    expect(request.generationConfig.temperature).toBeLessThanOrEqual(0.3);
  });

  it("demands a Hangul rationale for ko-KR readings", () => {
    const request = buildReadingDivergenceRequest({
      signalText: "t",
      soloBelief: "b",
      soloWhy: "w",
      groupBelief: "gb",
      groupWhy: "gw",
      locale: "ko-KR",
    });
    const payload = JSON.parse(request.contents[0]?.parts[0]?.text ?? "{}") as {
      localeInstruction?: string;
    };
    expect(payload.localeInstruction).toContain("Hangul");
  });
});
