import { afterEach, describe, expect, it, vi } from "vitest";

import { createGeminiModelProvider } from "./gemini-model-provider.js";
import {
  getDefaultModelProvider,
  setDefaultModelProviderForTests,
  type ModelProvider,
} from "./model-provider.js";

const userId = "00000000-0000-4000-8000-000000000001";

function fakeProvider(): ModelProvider {
  return {
    name: "test-provider",
    contextGraphRelationshipJudge: {
      judgeMeaningRelationships: vi.fn(),
    },
    topOfMindNoteJudge: {
      judgeWowMoment: vi.fn(),
    },
    classifySignalText: vi.fn(),
    generateSignalPacket: vi.fn(),
    generateTopOfMindNotes: vi.fn(),
    synthesizeAmbition: vi.fn(),
  };
}

const SYNTHESIS_INPUT = {
  userId,
  preferredLocale: "en-US" as const,
  trigger: "weekly_refresh" as const,
  synthesisKey: "ambition_synthesis:v1:test",
  contextNode: {
    id: "context-node-1",
    type: "project",
    label: "build a quieter research room",
    description: "The graph keeps returning to humane ambition.",
    confidence: 70,
  },
  memoryState: "active" as const,
  memoryMovementScore: 100,
  selectedSignals: [],
  priorFeedback: [],
  rewrites: [],
  rejectedOrCompetingInterpretations: [],
  tokenBudget: 2400,
  estimatedTokens: 100,
  fallback: {
    firstPersonPostItCandidate: "make the thing before explaining it",
    memoryState: "active" as const,
    environmentDirection:
      "A working culture where humane ambition becomes visible through repeated making.",
    rejectedEnvironment:
      "Work contexts that reward commentary while the real object stays abstract.",
    evidenceRationale:
      "Two saved signals point at humane ambition as a recurring work frequency.",
    confidence: 82,
    rejectedAlternativeInterpretation:
      "The shallow read would call this productivity, but the stronger read is about humane working conditions.",
  },
};

describe("model provider abstraction", () => {
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    setDefaultModelProviderForTests(null);
    vi.unstubAllGlobals();
    if (originalGeminiApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiApiKey;
    }
  });

  it("allows tests and workers to swap the default provider without importing a concrete vendor", async () => {
    const provider = fakeProvider();
    setDefaultModelProviderForTests(provider);

    await expect(getDefaultModelProvider()).resolves.toBe(provider);
  });

  it("keeps Gemini as the default implementation behind the provider interface", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const synthesisBody = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  firstPersonPostItCandidate:
                    "rooms where humane ambition stays normal, not performed",
                  environmentDirection:
                    "Working cultures that keep the real object visible over commentary.",
                  rejectedEnvironment:
                    "Productivity theater that rewards talking about the work.",
                  evidenceRationale:
                    "Saved signals keep returning to humane, quiet conditions for ambition.",
                  confidence: 84,
                  rejectedAlternativeInterpretation:
                    "The shallow read calls this productivity; the deeper read is humane conditions.",
                }),
              },
            ],
          },
        },
      ],
    };
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(synthesisBody), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchFn);

    const provider = createGeminiModelProvider();

    expect(provider.name).toBe("gemini");
    expect(provider.contextGraphRelationshipJudge).toHaveProperty(
      "judgeMeaningRelationships",
    );
    expect(provider.topOfMindNoteJudge).toHaveProperty("judgeWowMoment");

    const notes = await provider.generateTopOfMindNotes({
      userId,
      now: new Date("2026-05-30T12:00:00.000Z"),
      nodes: [
        {
          id: "context-node-1",
          type: "project",
          label: "build a quieter research room",
          description: "The graph keeps returning to humane ambition.",
          weight: 150,
          confidence: 70,
          evidenceCount: 2,
          firstSeenAt: new Date("2026-05-01T10:00:00.000Z"),
          lastReinforcedAt: new Date("2026-05-30T10:00:00.000Z"),
        },
      ],
      evidence: [
        {
          meaningNodeId: "context-node-1",
          inspirationId: "signal-1",
          reason: "A signal points at the same project shape.",
          weight: 80,
          createdAt: new Date("2026-05-30T10:00:00.000Z"),
          inspirationText: "Make spaces where ambition can stay humane.",
          sparkText: "humane ambition",
        },
      ],
    });

    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      contextType: "project",
      title: "make the thing before explaining it",
    });

    // synthesizeAmbition now delegates to the real Gemini client instead of
    // echoing the deterministic fallback.
    await expect(provider.synthesizeAmbition(SYNTHESIS_INPUT)).resolves.toMatchObject({
      firstPersonPostItCandidate:
        "rooms where humane ambition stays normal, not performed",
      confidence: 84,
    });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("falls back to null synthesis when Gemini errors so the loop stays deterministic", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    const fetchFn = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), {
          status: 429,
          statusText: "Too Many Requests",
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchFn);

    const provider = createGeminiModelProvider();

    await expect(provider.synthesizeAmbition(SYNTHESIS_INPUT)).resolves.toBeNull();
  });
});
