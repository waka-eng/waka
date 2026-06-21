import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminTopOfMindPreviewRoutes } from "./admin-top-of-mind-preview.js";

const user = { id: "00000000-0000-4000-8000-000000000001", email: "admin@example.com" };

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

function gateMiddleware() {
  return async (_c: any, next: () => Promise<void>) => {
    await next();
  };
}

beforeEach(() => {
  process.env.WAKA_ADMIN_EMAILS = user.email;
});

describe("GET /api/admin/top-of-mind-preview", () => {
  it("returns the preview for the signed-in user", async () => {
    const preview = {
      generatedAt: "2026-05-24T12:00:00.000Z",
      headline: "Top of mind: what kind of life would make this work worth it",
      activeThemes: [],
      activeQuestions: [
        {
          nodeId: "node-1",
          label: "what kind of life would make this work worth it",
          type: "question",
          reason: "The saves ask whether work is connected to a life worth living.",
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
    const getPreview = vi.fn(async () => preview);
    const db = {};
    const app = new Hono();
    app.route(
      "/api/admin/top-of-mind-preview",
      createAdminTopOfMindPreviewRoutes({
        getDatabase: () => db as any,
        getPreview,
        authMiddleware: authMiddleware(),
        adminGate: gateMiddleware(),
      }),
    );

    const response = await app.request("/api/admin/top-of-mind-preview");

    expect(response.status).toBe(200);
    expect(getPreview).toHaveBeenCalledWith(db, user.id);
    await expect(response.json()).resolves.toEqual({ preview });
  });

  it("forbids authenticated non-admin users before loading preview data", async () => {
    process.env.WAKA_ADMIN_EMAILS = "someone-else@example.com";
    const getPreview = vi.fn(async () => ({} as any));
    const app = new Hono();
    app.route(
      "/api/admin/top-of-mind-preview",
      createAdminTopOfMindPreviewRoutes({
        getDatabase: () => ({}) as any,
        getPreview,
        authMiddleware: authMiddleware(),
        adminGate: gateMiddleware(),
      }),
    );

    const response = await app.request("/api/admin/top-of-mind-preview");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Admin authorization required" });
    expect(getPreview).not.toHaveBeenCalled();
  });
});
