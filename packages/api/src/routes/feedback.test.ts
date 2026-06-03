import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import {
  createFeedbackRoutes,
  type FeedbackRecord,
} from "./feedback.js";

const user = { id: "00000000-0000-4000-8000-000000000001" };

function authMiddleware() {
  return async (c: any, next: () => Promise<void>) => {
    c.set("user", user);
    await next();
  };
}

const feedbackRecord: FeedbackRecord = {
  id: "00000000-0000-4000-8000-000000000010",
  userId: user.id,
  targetType: "top_of_mind_note",
  targetId: "00000000-0000-4000-8000-000000000020",
  value: "partly",
  emotionLabel: "curious",
  correctionText: "This is close, but the motive is more about agency.",
  source: "user",
  metadata: {},
  createdAt: "2026-05-30T20:00:00.000Z",
  updatedAt: "2026-05-30T20:00:00.000Z",
};

describe("POST /api/feedback", () => {
  it("creates tenant-scoped feedback for a graph-backed top-of-mind note", async () => {
    const createFeedback = vi.fn(async () => feedbackRecord);
    const db = {};
    const app = new Hono();
    app.route(
      "/api/feedback",
      createFeedbackRoutes({
        getDatabase: () => db as any,
        createFeedback,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        targetType: "top_of_mind_note",
        targetId: feedbackRecord.targetId,
        value: "partly",
        emotionLabel: "curious",
        correctionText: "This is close, but the motive is more about agency.",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(201);
    expect(createFeedback).toHaveBeenCalledWith(db, {
      userId: user.id,
      targetType: "top_of_mind_note",
      targetId: feedbackRecord.targetId,
      value: "partly",
      emotionLabel: "curious",
      correctionText: "This is close, but the motive is more about agency.",
    });
    await expect(response.json()).resolves.toEqual({
      feedback: feedbackRecord,
    });
  });

  it.each([
    ["signal", "true", "admire"],
    ["context_node", "not_true", "fear"],
    ["hypothesis", "important", "want"],
    ["top_of_mind_note", "not_important", "aesthetic_only"],
  ] as const)(
    "accepts %s targets with %s feedback and %s emotion",
    async (targetType, value, emotionLabel) => {
      const createFeedback = vi.fn(async () => ({
        ...feedbackRecord,
        targetType,
        value,
        emotionLabel,
      }));
      const app = new Hono();
      app.route(
        "/api/feedback",
        createFeedbackRoutes({
          getDatabase: () => ({}) as any,
          createFeedback,
          authMiddleware: authMiddleware(),
        }),
      );

      const response = await app.request("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          targetType,
          targetId: feedbackRecord.targetId,
          value,
          emotionLabel,
        }),
        headers: { "content-type": "application/json" },
      });

      expect(response.status).toBe(201);
    },
  );

  it("returns 404 when the target is not owned by the signed-in tenant", async () => {
    const createFeedback = vi.fn(async () => null);
    const app = new Hono();
    app.route(
      "/api/feedback",
      createFeedbackRoutes({
        getDatabase: () => ({}) as any,
        createFeedback,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        targetType: "signal",
        targetId: "00000000-0000-4000-8000-000000000404",
        value: "not_true",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Feedback target not found",
    });
  });

  it("rejects invalid feedback payloads before persistence", async () => {
    const createFeedback = vi.fn();
    const app = new Hono();
    app.route(
      "/api/feedback",
      createFeedbackRoutes({
        getDatabase: () => ({}) as any,
        createFeedback,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        targetType: "wow_moment",
        targetId: "not-a-uuid",
        value: "yes",
      }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(400);
    expect(createFeedback).not.toHaveBeenCalled();
  });
});

describe("GET /api/feedback", () => {
  it("lists feedback through tenant-scoped filters", async () => {
    const listFeedback = vi.fn(async () => [feedbackRecord]);
    const db = {};
    const app = new Hono();
    app.route(
      "/api/feedback",
      createFeedbackRoutes({
        getDatabase: () => db as any,
        listFeedback,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request(
      `/api/feedback?targetType=top_of_mind_note&targetId=${feedbackRecord.targetId}&limit=10`,
    );

    expect(response.status).toBe(200);
    expect(listFeedback).toHaveBeenCalledWith(db, {
      userId: user.id,
      targetType: "top_of_mind_note",
      targetId: feedbackRecord.targetId,
      limit: 10,
    });
    await expect(response.json()).resolves.toEqual({
      feedback: [feedbackRecord],
    });
  });

  it("rejects invalid list filters before querying", async () => {
    const listFeedback = vi.fn();
    const app = new Hono();
    app.route(
      "/api/feedback",
      createFeedbackRoutes({
        getDatabase: () => ({}) as any,
        listFeedback,
        authMiddleware: authMiddleware(),
      }),
    );

    const response = await app.request("/api/feedback?limit=0");

    expect(response.status).toBe(400);
    expect(listFeedback).not.toHaveBeenCalled();
  });
});
