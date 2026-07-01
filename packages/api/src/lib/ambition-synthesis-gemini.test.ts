import { describe, expect, it, vi } from "vitest";

import type { AmbitionSynthesisInput } from "./ambition-synthesis.js";
import {
  AMBITION_SYNTHESIS_SYSTEM_INSTRUCTION,
  buildAmbitionSynthesisRequest,
  buildAmbitionSynthesisGenerateContentUrl,
  GeminiAmbitionSynthesisClient,
  parseAmbitionSynthesisResponse,
} from "./ambition-synthesis-gemini.js";

function synthesisInput(
  overrides: Partial<AmbitionSynthesisInput> = {},
): AmbitionSynthesisInput {
  return {
    userId: "00000000-0000-4000-8000-000000000001",
    preferredLocale: "en-US",
    trigger: "weekly_refresh",
    synthesisKey: "ambition_synthesis:v1:test:active",
    contextNode: {
      id: "public-building-room",
      type: "environment",
      label: "cities where public building is normal",
      description: "Signals keep returning to places where ambition feels social.",
      confidence: 72,
    },
    memoryState: "active",
    memoryMovementScore: 12,
    selectedSignals: [
      {
        id: "signal-1",
        excerpt: "wanting to live near people who make building in public feel normal",
        highlight: "building in public feels normal here",
        emotionalPullMetadata: ["want", "envy"],
        microReflection: "the room made courage feel ordinary",
        evidenceReason: "supports the same ambition read",
        capturedAt: new Date("2026-05-30T10:00:00.000Z"),
      },
    ],
    priorFeedback: [],
    rewrites: [],
    rejectedOrCompetingInterpretations: ["The shallow read would call this cities."],
    tokenBudget: 2400,
    estimatedTokens: 200,
    ...overrides,
  };
}

function geminiBody(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const validPayload = {
  firstPersonPostItCandidate: "people who make shipping in public feel normal",
  environmentDirection: "Peers and rooms where building openly is the expected rhythm.",
  rejectedEnvironment: "Circles where polish and permission arrive before motion.",
  evidenceRationale:
    "Two saved signals point at peers as the edge, not cities as a category.",
  confidence: 88,
  rejectedAlternativeInterpretation:
    "The shallow read calls this cities; the truer read is wanting peers who normalize visible work.",
};

describe("buildAmbitionSynthesisRequest", () => {
  it("includes the system instruction and a strict response schema", () => {
    const request = buildAmbitionSynthesisRequest(synthesisInput());

    expect(request.systemInstruction.parts[0]?.text).toContain("WAKA");
    expect(request.generationConfig.responseMimeType).toBe("application/json");
    const schema = request.generationConfig.responseSchema as {
      required: string[];
    };
    expect(schema.required).toEqual([
      "firstPersonPostItCandidate",
      "environmentDirection",
      "rejectedEnvironment",
      "evidenceRationale",
      "confidence",
      "rejectedAlternativeInterpretation",
    ]);
  });

  it("serializes user-authored content under untrusted-marked fields", () => {
    const request = buildAmbitionSynthesisRequest(synthesisInput());
    const prompt = JSON.parse(request.contents[0]!.parts[0]!.text) as {
      savedSignals: Array<{ untrustedExcerpt: string }>;
      contextNode: { untrustedLabel: string };
    };
    expect(prompt.contextNode.untrustedLabel).toContain("public building");
    expect(prompt.savedSignals[0]?.untrustedExcerpt).toContain("building in public");
  });

  it("includes preferred locale and Korean output instructions for ko-KR", () => {
    const request = buildAmbitionSynthesisRequest(
      synthesisInput({ preferredLocale: "ko-KR" }),
    );
    const prompt = JSON.parse(request.contents[0]!.parts[0]!.text) as {
      preferredLocale: string;
      localeOutputInstruction: string;
    };

    expect(prompt.preferredLocale).toBe("ko-KR");
    expect(prompt.localeOutputInstruction).toContain("natural Korean");
    expect(prompt.localeOutputInstruction).toContain("Hangul");
    expect(prompt.localeOutputInstruction).toContain("untrusted excerpts as data");
  });
  it("includes anti-template variability guidance while preserving untrusted and ko-KR instructions", () => {
    const request = buildAmbitionSynthesisRequest(
      synthesisInput({ preferredLocale: "ko-KR" }),
    );
    const prompt = JSON.parse(request.contents[0]!.parts[0]!.text) as {
      instruction: string;
      outputLimits: { firstPersonPostItCandidate: string };
      localeOutputInstruction: string;
    };

    expect(AMBITION_SYNTHESIS_SYSTEM_INSTRUCTION).toContain(
      "Do NOT reuse stock per-dimension",
    );
    expect(AMBITION_SYNTHESIS_SYSTEM_INSTRUCTION).toContain("memory movement");
    expect(prompt.instruction).toContain("stock per-dimension/title templates");
    expect(prompt.instruction).toContain("saved signals");
    expect(prompt.instruction).toContain("rejected interpretations");
    expect(prompt.outputLimits.firstPersonPostItCandidate).toContain(
      "duplicate title",
    );
    expect(prompt.localeOutputInstruction).toContain("Hangul");
    expect(prompt.localeOutputInstruction).toContain("untrusted excerpts as data");
  });
});

describe("parseAmbitionSynthesisResponse", () => {
  it("parses a valid payload and echoes memoryState from the input", () => {
    const output = parseAmbitionSynthesisResponse(
      geminiBody(JSON.stringify(validPayload)),
      synthesisInput({ memoryState: "reactivated" }),
    );

    expect(output).not.toBeNull();
    expect(output?.firstPersonPostItCandidate).toBe(
      "people who make shipping in public feel normal",
    );
    expect(output?.memoryState).toBe("reactivated");
    expect(output?.confidence).toBe(88);
  });

  it("clamps and rounds confidence into 1-100", () => {
    const tooHigh = parseAmbitionSynthesisResponse(
      geminiBody(JSON.stringify({ ...validPayload, confidence: 250 })),
      synthesisInput(),
    );
    expect(tooHigh?.confidence).toBe(100);

    const tooLow = parseAmbitionSynthesisResponse(
      geminiBody(JSON.stringify({ ...validPayload, confidence: -4 })),
      synthesisInput(),
    );
    expect(tooLow?.confidence).toBe(1);
  });

  it("recovers JSON wrapped in markdown fences", () => {
    const output = parseAmbitionSynthesisResponse(
      geminiBody("```json\n" + JSON.stringify(validPayload) + "\n```"),
      synthesisInput(),
    );
    expect(output?.firstPersonPostItCandidate).toBe(
      "people who make shipping in public feel normal",
    );
  });

  it("returns null for blocked, empty, non-JSON, or schema-invalid responses", () => {
    expect(
      parseAmbitionSynthesisResponse(
        { promptFeedback: { blockReason: "SAFETY" } },
        synthesisInput(),
      ),
    ).toBeNull();
    expect(
      parseAmbitionSynthesisResponse(geminiBody("   "), synthesisInput()),
    ).toBeNull();
    expect(
      parseAmbitionSynthesisResponse(geminiBody("not json at all"), synthesisInput()),
    ).toBeNull();
    expect(
      parseAmbitionSynthesisResponse(
        geminiBody(JSON.stringify({ firstPersonPostItCandidate: "only one field" })),
        synthesisInput(),
      ),
    ).toBeNull();
  });
});

describe("GeminiAmbitionSynthesisClient", () => {
  it("uses the configured Gemini flash-lite model endpoint", () => {
    expect(buildAmbitionSynthesisGenerateContentUrl()).toContain(
      "/models/gemini-3.1-flash-lite:generateContent",
    );
  });

  it("returns a synthesized output on a successful response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(geminiBody(JSON.stringify(validPayload))), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = new GeminiAmbitionSynthesisClient({ apiKey: "test-key", fetchFn });

    const output = await client.synthesizeAmbition(synthesisInput());

    expect(output?.firstPersonPostItCandidate).toBe(
      "people who make shipping in public feel normal",
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, init] = fetchFn.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({
      "x-goog-api-key": "test-key",
    });
  });

  it("throws on a non-ok HTTP response so the provider can fall back", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "content-type": "application/json" },
        }),
      );
    const client = new GeminiAmbitionSynthesisClient({ apiKey: "test-key", fetchFn });

    await expect(client.synthesizeAmbition(synthesisInput())).rejects.toThrow(
      /Gemini ambition synthesis failed/,
    );
  });

  it("returns null when the response body is not JSON", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));
    const client = new GeminiAmbitionSynthesisClient({ apiKey: "test-key", fetchFn });

    expect(await client.synthesizeAmbition(synthesisInput())).toBeNull();
  });
});
