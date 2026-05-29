import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createTopOfMindRoutes } from "./top-of-mind.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

describe("GET /api/top-of-mind", () => {
  it("returns the meaning-graph-backed top-of-mind preview for the signed-in user", async () => {
    const topOfMind = {
      generatedAt: "2026-05-24T12:00:00.000Z",
      headline: "Top of mind: what kind of life would make this work worth it",
      activeThemes: [],
      activeQuestions: [
        {
          nodeId: "node-1",
          label: "what kind of life would make this work worth it",
          type: "question",
          reason: "The meaning graph infers a live work/life question.",
          evidenceCount: 4,
          lastReinforcedAt: "2026-05-24T10:00:00.000Z",
          supportingInspirations: [],
        },
      ],
      relationshipSignals: [],
      summary: {
        inspirationCount: 12,
        meaningNoteCount: 7,
        relationshipEdgeCount: 3,
      },
    };
    const getTopOfMind = vi.fn(async () => topOfMind);
    const db = {};
    const app = new Hono();
    app.route(
      "/api/top-of-mind",
      createTopOfMindRoutes({
        getDatabase: () => db as any,
        getTopOfMind,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/top-of-mind");

    expect(response.status).toBe(200);
    expect(getTopOfMind).toHaveBeenCalledWith(db, user.id);
    await expect(response.json()).resolves.toEqual({ topOfMind });
  });
});
