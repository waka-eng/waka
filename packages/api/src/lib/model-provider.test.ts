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
  };
}

describe("model provider abstraction", () => {
  afterEach(() => {
    setDefaultModelProviderForTests(null);
  });

  it("allows tests and workers to swap the default provider without importing a concrete vendor", async () => {
    const provider = fakeProvider();
    setDefaultModelProviderForTests(provider);

    await expect(getDefaultModelProvider()).resolves.toBe(provider);
  });

  it("keeps Gemini as the default implementation behind the provider interface", async () => {
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
      title: "I need workrooms where making the thing is the default temperature.",
    });
  });
});
