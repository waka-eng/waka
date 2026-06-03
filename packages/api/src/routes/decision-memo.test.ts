import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createDecisionMemoRoutes } from "./decision-memo.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

describe("GET /api/decision-memo", () => {
  it("returns an authenticated what-to-build decision memo for the current tenant", async () => {
    const db = {};
    const getDecisionMemo = vi.fn(async () => ({
      generatedAt: "2026-05-30T12:00:00.000Z",
      title: "What to build next" as const,
      drawnTo: {
        summary: "You seem drawn to a quieter research room.",
        contextNodes: [],
      },
      strongestEvidence: [],
      tensions: [],
      topOfMindNotes: [],
      nextAction: "Prototype one small version this week.",
      isScaffold: true as const,
    }));
    const app = new Hono();
    app.route(
      "/api/decision-memo",
      createDecisionMemoRoutes({
        getDatabase: () => db as any,
        getDecisionMemo,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/decision-memo");

    expect(response.status).toBe(200);
    expect(getDecisionMemo).toHaveBeenCalledWith(db, { userId: user.id });
    await expect(response.json()).resolves.toMatchObject({
      decisionMemo: {
        title: "What to build next",
        nextAction: "Prototype one small version this week.",
        isScaffold: true,
      },
    });
  });
});
