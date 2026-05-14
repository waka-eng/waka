import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createInspirationsRoutes } from "./inspirations.js";

interface CreateInspirationResponse {
  inspiration: { id: string };
  autoWowGeneration?: { status: string; generated: boolean };
}

const user = { id: "00000000-0000-4000-8000-000000000001" };
const inspirationId = "00000000-0000-4000-8000-000000000002";

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

function createInsertDb() {
  const inserted = {
    id: inspirationId,
    userId: user.id,
    text: "automatic wow should not break save",
    kind: "note",
    category: null,
    importanceScore: null,
    wowScore: null,
    cluster: null,
    classifiedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  return {
    db: {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({
          returning: vi.fn(async () => [inserted]),
        })),
      })),
    } as any,
    inserted,
  };
}

describe("POST /api/inspirations automatic WOW generation", () => {
  it("returns 201 without invoking automatic WOW generation inline", async () => {
    const { db } = createInsertDb();
    const app = new Hono();

    app.route(
      "/api/inspirations",
      createInspirationsRoutes({
        getDatabase: () => db,
        authMiddleware: authMiddleware(),
        enqueueClassificationJob: vi.fn(async () => undefined),
        persistScores: vi.fn(async () => ({ importanceScore: 10, wowScore: 20 })),
      }),
    );

    const response = await app.request("/api/inspirations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "automatic wow should not break save", kind: "note" }),
    });

    expect(response.status).toBe(201);
    const body = (await response.json()) as CreateInspirationResponse;
    expect(body.inspiration.id).toBe(inspirationId);
    expect(body.autoWowGeneration).toBeUndefined();
  });
});
