import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createWowMomentsRoutes } from "./wow-moments.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

function createWowMomentsSelect<T>(terminal: T) {
  const limit = vi.fn(async () => terminal);
  return {
    limit,
    builder: {
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit })),
        })),
      })),
    },
  };
}

function createRelatedRowsSelect<T>(terminal: T) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => terminal),
        })),
      })),
    })),
  };
}

describe("GET /api/wow-moments top-of-mind compatibility", () => {
  it("keeps the WOW response while adding a provisional top-of-mind note", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000010",
      userId: user.id,
      title: "Rituals keep returning",
      kind: "recurrence",
      why: "Multiple signals keep circling the same careful ritual.",
      beliefStatement: null,
      reflectionQuestion: null,
      reflectionGuide: "Try one small version this week.",
      wowScore: 82,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const relatedRows = [
      {
        wowMomentId: moment.id,
        inspirationId: "00000000-0000-4000-8000-000000000101",
        role: "Source signal",
        reason: "This signal shows the recurring ritual.",
        sortOrder: 0,
        inspirationText: "Signal text",
        inspirationKind: "note",
        inspirationCreatedAt: new Date("2026-05-29T10:00:00.000Z"),
        inspirationWowScore: 64,
      },
    ];
    const momentsSelect = createWowMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect(relatedRows)),
    };
    const app = new Hono();
    app.route(
      "/api/wow-moments",
      createWowMomentsRoutes({
        getDatabase: () => db as any,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/wow-moments?limit=1");

    expect(response.status).toBe(200);
    expect(momentsSelect.limit).toHaveBeenCalledWith(1);
    const body = (await response.json()) as { wowMoments: unknown[] };
    expect(body.wowMoments).toHaveLength(1);
    expect(body.wowMoments[0]).toMatchObject({
      id: moment.id,
      title: "Rituals keep returning",
      kind: "recurrence",
      relatedInspirations: [
        {
          inspirationId: "00000000-0000-4000-8000-000000000101",
          role: "Source signal",
          reason: "This signal shows the recurring ritual.",
          text: "Signal text",
          kind: "note",
          createdAt: "2026-05-29T10:00:00.000Z",
          wowScore: 64,
        },
      ],
      topOfMindNote: {
        id: moment.id,
        userId: user.id,
        title: "Rituals keep returning",
        ambitionDimension: "next_experiment",
        ambientSignal: "Rituals keep returning",
        matchedEnvironment: "",
        antiEnvironment: "",
        evidenceRationale: "",
        type: "action",
        body: "Multiple signals keep circling the same careful ritual.",
        prompt: null,
        guidance: "Try one small version this week.",
        confidence: 82,
        status: "active",
        relatedSignalIds: ["00000000-0000-4000-8000-000000000101"],
        relatedContextNodeIds: [],
        createdAt: "2026-05-30T10:00:00.000Z",
        updatedAt: "2026-05-30T11:00:00.000Z",
        source: "wow_moment_compatibility",
        isProvisional: true,
        legacy: {
          wowMomentId: moment.id,
          wowKind: "recurrence",
          wowScore: 82,
        },
      },
    });
  });

  it("sanitizes scaffolded legacy why in the WOW compatibility response", async () => {
    const moment = {
      id: "00000000-0000-4000-8000-000000000011",
      userId: user.id,
      title: "People who make courage feel normal",
      kind: "bridge",
      why:
        "Ambient signal: people who make courage feel normal. " +
        "Matched environment: People who make publishing early feel ordinary. " +
        "Anti-environment: Circles where permission arrives before motion. " +
        "Evidence rationale: Three saved signals are clustering around this frequency. " +
        "This may matter for ambition because it points at a people frequency. " +
        "Supporting signals: \"shipping early\". " +
        "Memory movement: 3 reinforcements; rank 2 score 94 candidate abc.",
      beliefStatement: "people who make courage feel normal",
      reflectionQuestion: null,
      reflectionGuide: null,
      wowScore: 82,
      createdAt: new Date("2026-05-30T10:00:00.000Z"),
      updatedAt: new Date("2026-05-30T11:00:00.000Z"),
    };
    const momentsSelect = createWowMomentsSelect([moment]);
    const db = {
      select: vi
        .fn()
        .mockReturnValueOnce(momentsSelect.builder)
        .mockReturnValueOnce(createRelatedRowsSelect([])),
    };
    const app = new Hono();
    app.route(
      "/api/wow-moments",
      createWowMomentsRoutes({
        getDatabase: () => db as any,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/wow-moments?limit=1");

    expect(response.status).toBe(200);
    const body = (await response.json()) as { wowMoments: unknown[] };
    const payload = JSON.stringify(body.wowMoments[0]);
    expect(payload).not.toContain("This may matter for ambition because it points");
    expect(payload).not.toContain("Memory movement:");
    expect(payload).not.toContain("Supporting signals:");
    expect(payload).not.toContain("Ambient signal:");
    expect(payload).not.toContain("Matched environment:");
    expect(payload).not.toContain("Evidence rationale:");
    expect(body.wowMoments[0]).toMatchObject({
      why: "",
      topOfMindNote: {
        evidenceRationale: "",
        body: "",
      },
    });
  });
});
