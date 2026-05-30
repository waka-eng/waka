import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createSignalArchiveRoutes, type SavedSignalDetail } from "./signals.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };
const signalId = "00000000-0000-4000-8000-000000000101";

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

describe("GET /api/signals", () => {
  it("passes search, filter, sort, and tenant scope to the archive assembler", async () => {
    const db = {};
    const listSignals = vi.fn(async () => [
      {
        id: signalId,
        userId: user.id,
        textPreview: "A saved signal about quiet research rooms.",
        kind: "note",
        capturedAt: "2026-05-30T12:00:00.000Z",
        updatedAt: "2026-05-30T12:00:00.000Z",
        resonanceScore: 84,
        signalScores: {
          resonance: 84,
          recurrence: 62,
          agency: 71,
          identitySignal: 73,
          decisionRelevance: 70,
        },
        highlightedSnippets: [
          {
            id: "spark-1",
            text: "quiet research rooms",
            source: "user_selected",
            confidence: 100,
            isPrimary: true,
          },
        ],
        matchingSnippets: ["quiet research rooms"],
        relatedContextTerms: ["environment: quiet rooms"],
        relatedTopOfMindNoteTitles: ["Rooms for honest work keep returning"],
        attachmentSummary: [],
        relevanceReasons: ["highlight match", "context match"],
      },
    ]);
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalArchiveRoutes({
        getDatabase: () => db as any,
        listSignals,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request(
      "/api/signals?q=room&filter=highlighted&sort=resonance&limit=12",
    );

    expect(response.status).toBe(200);
    expect(listSignals).toHaveBeenCalledWith(db, {
      userId: user.id,
      query: "room",
      filter: "highlighted",
      sort: "resonance",
      limit: 12,
    });
    await expect(response.json()).resolves.toMatchObject({
      signals: [
        {
          id: signalId,
          textPreview: "A saved signal about quiet research rooms.",
          highlightedSnippets: [{ text: "quiet research rooms" }],
          relatedContextTerms: ["environment: quiet rooms"],
          relatedTopOfMindNoteTitles: ["Rooms for honest work keep returning"],
        },
      ],
    });
  });

  it("returns detail with packet, context, top-of-mind, feedback, and raw text without admin graph fields", async () => {
    const detail: SavedSignalDetail = {
      id: signalId,
      userId: user.id,
      textPreview: "A saved signal about quiet research rooms.",
      rawText: "A saved signal about quiet research rooms and who gets to think there.",
      kind: "note",
      capturedAt: "2026-05-30T12:00:00.000Z",
      updatedAt: "2026-05-30T12:00:00.000Z",
      resonanceScore: 84,
      signalScores: {
        resonance: 84,
        recurrence: 62,
        agency: 71,
        identitySignal: 73,
        decisionRelevance: 70,
      },
      highlightedSnippets: [
        {
          id: "spark-1",
          text: "who gets to think there",
          source: "user_selected",
          confidence: 100,
          isPrimary: true,
        },
      ],
      matchingSnippets: [],
      relatedContextTerms: ["environment"],
      relatedTopOfMindNoteTitles: ["Rooms for honest work keep returning"],
      attachmentSummary: [],
      relevanceReasons: ["has highlighted snippets"],
      attachments: [],
      resonanceFeedback: [
        {
          id: "feedback-1",
          value: "important",
          emotionLabel: "want",
          correctionText: null,
          createdAt: "2026-05-30T13:00:00.000Z",
        },
      ],
      signalPacket: {
        id: "packet-1",
        text: "waka.signal_packet.v1\nWHY_IT_MATTERS: quiet rooms keep recurring.",
        primarySpark: "who gets to think there",
        artifactExcerpt: "A saved signal about quiet research rooms.",
        updatedAt: "2026-05-30T12:30:00.000Z",
      },
      relatedContextNodes: [
        {
          id: "node-1",
          type: "environment",
          label: "quiet research rooms",
          description: "A durable context claim about where attention works.",
          confidence: 78,
          evidenceReason: "The signal names the environment directly.",
        },
      ],
      relatedTopOfMindNotes: [
        {
          id: "note-1",
          title: "Rooms for honest work keep returning",
          type: "pattern",
          body: "Several signals point at this room.",
          confidence: 86,
          status: "active",
        },
      ],
    };
    const getSignal = vi.fn(async () => detail);
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalArchiveRoutes({
        getDatabase: () => ({}) as any,
        getSignal,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request(`/api/signals/${signalId}`);

    expect(response.status).toBe(200);
    expect(getSignal).toHaveBeenCalledWith(expect.anything(), {
      userId: user.id,
      signalId,
    });
    const body = (await response.json()) as { signal: SavedSignalDetail };
    expect(body.signal).toMatchObject({
      id: signalId,
      rawText: expect.stringContaining("quiet research rooms"),
      signalPacket: { text: expect.stringContaining("waka.signal_packet.v1") },
      relatedContextNodes: [{ type: "environment", label: "quiet research rooms" }],
      relatedTopOfMindNotes: [{ title: "Rooms for honest work keep returning" }],
      resonanceFeedback: [{ value: "important", emotionLabel: "want" }],
    });
    expect(JSON.stringify(body)).not.toContain("meaningNodeId");
    expect(JSON.stringify(body)).not.toContain("admin");
  });
});
