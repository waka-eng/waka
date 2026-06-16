import { describe, expect, it, vi } from "vitest";

import type { ActionRecommendationGenerationInput } from "./action-recommendations.js";
import {
  buildActionRecommendationGenerateContentUrl,
  buildActionRecommendationRequest,
  GeminiActionRecommendationClient,
  parseActionRecommendationResponse,
} from "./action-recommendations-gemini.js";
import type { TopOfMindNoteSurface } from "../routes/top-of-mind.js";

const note: TopOfMindNoteSurface = {
  id: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000001",
  title: "make the thing before explaining it",
  ambitionDimension: "work",
  ambientSignal: "make the thing before explaining it",
  matchedEnvironment: "A room where rough artifacts become public quickly",
  antiEnvironment: "Commentary loops where nothing gets made",
  evidenceRationale: "Saved signals keep returning to public rough drafts.",
  rejectedAlternativeInterpretation: null,
  type: "pattern",
  body: "Several saved signals connect building, showing, and learning from the room.",
  prompt: null,
  guidance: null,
  confidence: 82,
  status: "active",
  relatedSignalIds: ["00000000-0000-4000-8000-000000000101"],
  relatedContextNodeIds: [],
  createdAt: new Date("2026-05-30T10:00:00.000Z"),
  updatedAt: new Date("2026-05-30T11:00:00.000Z"),
  source: "wow_moment_compatibility",
  isProvisional: true,
  legacy: {
    wowMomentId: "00000000-0000-4000-8000-000000000010",
    wowKind: "recurrence",
    wowScore: 82,
  },
  evidencePreviews: [
    {
      signalId: "00000000-0000-4000-8000-000000000101",
      role: "The practice",
      reason: "It names the practice.",
      textPreview: "Architecture essay about bridge rhythms in city walks",
      kind: "note",
      createdAt: "2026-05-29T10:00:00.000Z",
      resonanceScore: 9,
    },
  ],
  relatedSignals: [],
};

function input(): ActionRecommendationGenerationInput {
  return {
    userId: note.userId,
    candidate: {
      id: "action-00000000-0000-4000-8000-000000000010-stable",
      sourceTopOfMindId: note.id,
      sourceSignalIds: note.relatedSignalIds,
      evidenceSnippets: ["Architecture essay about bridge rhythms in city walks"],
      confidence: 94,
      createdAt: note.createdAt,
      note,
    },
    states: [
      {
        actionId: "previous-action",
        sourceTopOfMindId: note.id,
        status: "completed",
        outcomeText: "Showing a rough draft made the next conversation easier.",
        relatedSignalIds: [],
        updatedAt: new Date("2026-06-01T10:00:00.000Z"),
      },
    ],
  };
}

function geminiBody(text: string) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

const validPayload = {
  text: "Draft the rough bridge-rhythm artifact and show it to one builder by Friday.",
  kind: "make_artifact",
  whyNow: "The post-it and prior outcome both point toward learning by making a rough public artifact.",
};

describe("buildActionRecommendationRequest", () => {
  it("uses JSON mode with the action recommendation schema", () => {
    const request = buildActionRecommendationRequest(input());

    expect(request.systemInstruction.parts[0]?.text).toContain("WAKA");
    expect(request.generationConfig.responseMimeType).toBe("application/json");
    expect(request.generationConfig.responseSchema).toMatchObject({
      required: ["text", "kind", "whyNow"],
    });
  });

  it("marks note, evidence, and outcome text as untrusted prompt data", () => {
    const request = buildActionRecommendationRequest(input());
    const prompt = JSON.parse(request.contents[0]!.parts[0]!.text) as {
      topOfMindNote: { untrustedTitle: string };
      evidence: Array<{ untrustedTextPreview: string }>;
      priorActionOutcomes: Array<{ untrustedOutcomeText: string }>;
    };

    expect(prompt.topOfMindNote.untrustedTitle).toContain("make the thing");
    expect(prompt.evidence[0]?.untrustedTextPreview).toContain("bridge rhythms");
    expect(prompt.priorActionOutcomes[0]?.untrustedOutcomeText).toContain(
      "rough draft",
    );
  });
});

describe("parseActionRecommendationResponse", () => {
  it("parses valid action text, kind, and whyNow from Gemini JSON", () => {
    expect(parseActionRecommendationResponse(geminiBody(JSON.stringify(validPayload)))).toEqual(
      validPayload,
    );
  });

  it("recovers JSON wrapped in markdown fences", () => {
    const output = parseActionRecommendationResponse(
      geminiBody("```json\n" + JSON.stringify(validPayload) + "\n```"),
    );
    expect(output?.kind).toBe("make_artifact");
  });

  it("returns null for blocked, empty, non-JSON, or schema-invalid responses", () => {
    expect(
      parseActionRecommendationResponse({ promptFeedback: { blockReason: "SAFETY" } }),
    ).toBeNull();
    expect(parseActionRecommendationResponse(geminiBody("   "))).toBeNull();
    expect(parseActionRecommendationResponse(geminiBody("not json"))).toBeNull();
    expect(
      parseActionRecommendationResponse(
        geminiBody(JSON.stringify({ ...validPayload, kind: "bad_kind" })),
      ),
    ).toBeNull();
  });
});

describe("GeminiActionRecommendationClient", () => {
  it("uses the configured Gemini flash-lite endpoint", () => {
    expect(buildActionRecommendationGenerateContentUrl()).toContain(
      "/models/gemini-3.1-flash-lite:generateContent",
    );
  });

  it("returns a generated action on a successful response", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(geminiBody(JSON.stringify(validPayload))), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = new GeminiActionRecommendationClient({
      apiKey: "test-key",
      fetchFn,
    });

    await expect(client.generateActionRecommendation(input())).resolves.toEqual(
      validPayload,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [, init] = fetchFn.mock.calls[0]!;
    expect((init as RequestInit).headers).toMatchObject({
      "x-goog-api-key": "test-key",
    });
  });

  it("throws on a non-ok HTTP response so the provider can return null", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "content-type": "application/json" },
        }),
      );
    const client = new GeminiActionRecommendationClient({
      apiKey: "test-key",
      fetchFn,
    });

    await expect(client.generateActionRecommendation(input())).rejects.toThrow(
      /Gemini action recommendation failed/,
    );
  });

  it("returns null when the response body is not JSON", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(new Response("<html>oops</html>", { status: 200 }));
    const client = new GeminiActionRecommendationClient({
      apiKey: "test-key",
      fetchFn,
    });

    await expect(client.generateActionRecommendation(input())).resolves.toBeNull();
  });
});
