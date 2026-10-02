import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../lib/session.js";
import {
  createFeedbackRoutes,
  FeedbackTargetChangedError,
  mayAnswerSignal,
  type FeedbackRecord,
  type FeedbackRouteDependencies,
} from "./feedback.js";

const accountId = "00000000-0000-4000-8000-0000000000a1";
const profileId = "00000000-0000-4000-8000-000000000001";
const targetId = "00000000-0000-4000-8000-000000000020";

const session: AuthenticatedSession = {
  sessionId: "00000000-0000-4000-8000-0000000000f1",
  account: { id: accountId, email: "ada@example.com" },
  profile: {
    id: profileId,
    accountId,
    type: "human",
    name: "Ada",
    preferredLocale: "en-US",
  },
};

function sessionMiddleware() {
  return async (c: { set: (key: string, value: unknown) => void }, next: () => Promise<void>) => {
    c.set("session", session);
    await next();
  };
}

const feedbackRecord: FeedbackRecord = {
  id: "00000000-0000-4000-8000-000000000010",
  profileId,
  targetType: "top_of_mind_entry",
  targetId,
  value: "partly",
  correctionText: "This is close, but the motive is more about agency.",
  createdAt: "2026-08-12T20:00:00.000Z",
};

function mountWith(deps: FeedbackRouteDependencies = {}) {
  const app = new Hono();
  app.route(
    "/api/feedback",
    createFeedbackRoutes({
      getDatabase: (() => ({})) as FeedbackRouteDependencies["getDatabase"],
      authMiddleware: sessionMiddleware() as never,
      ...deps,
    }),
  );
  return app;
}

describe("POST /api/feedback", () => {
  it('passes the displayed revision through and refuses changed wording with a recoverable conflict', async () => {
    const createFeedback = vi.fn(async () => { throw new FeedbackTargetChangedError(); });
    const app = mountWith({ createFeedback });
    const response = await app.request('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetType: 'signal', targetId, value: 'true', targetRevision: '2' }) });
    expect(createFeedback).toHaveBeenCalledWith({}, { profileId, targetType: 'signal', targetId, value: 'true', targetRevision: '2' });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'feedback_target_changed' });
  });

  it.each(['0', '-1', '9223372036854775808'])('refuses invalid revision %s without invoking the writer', async (targetRevision) => {
    const createFeedback = vi.fn(async () => feedbackRecord);
    const app = mountWith({ createFeedback });
    const response = await app.request('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetType: 'signal', targetId, value: 'true', targetRevision }) });
    expect(response.status).toBe(400); expect(createFeedback).not.toHaveBeenCalled();
  });
  it("records a verdict on an entry the acting profile owns", async () => {
    const createFeedback = vi.fn(async () => feedbackRecord);
    const app = mountWith({ createFeedback });

    const response = await app.request("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetType: "top_of_mind_entry",
        targetId,
        value: "partly",
        correctionText: "This is close, but the motive is more about agency.",
      }),
    });

    expect(response.status).toBe(201);
    expect(createFeedback).toHaveBeenCalledWith(
      {},
      {
        profileId,
        targetType: "top_of_mind_entry",
        targetId,
        value: "partly",
        correctionText: "This is close, but the motive is more about agency.",
      },
    );
    await expect(response.json()).resolves.toEqual({ feedback: feedbackRecord });
  });

  it.each(["signal", "top_of_mind_entry"] as const)(
    "accepts %s as a target",
    async (targetType) => {
      const createFeedback = vi.fn(async () => ({ ...feedbackRecord, targetType }));
      const app = mountWith({ createFeedback });

      const response = await app.request("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType, targetId, value: "true" }),
      });

      expect(response.status).toBe(201);
    },
  );

  /**
   * Pin and dismiss are columns on the entry. A client sending them as
   * feedback is aimed at the wrong door, and a bare "invalid enum" would leave
   * whoever wrote it guessing which door is right.
   */
  it.each(["important", "not_important", "pin", "dismiss"])(
    "sends %s back to the entry endpoints instead of storing it",
    async (value) => {
      const createFeedback = vi.fn(async () => feedbackRecord);
      const app = mountWith({ createFeedback });

      const response = await app.request("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetType: "signal", targetId, value }),
      });

      expect(response.status).toBe(400);
      expect(createFeedback).not.toHaveBeenCalled();
      const body = (await response.json()) as { error: string };
      expect(body.error).toMatch(/entry state, not feedback/);
      expect(body.error).toMatch(/pin\/dismiss endpoints/);
    },
  );

  it("returns 404 when the target is not the acting profile's", async () => {
    const app = mountWith({ createFeedback: vi.fn(async () => null) });

    const response = await app.request("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        targetType: "signal",
        targetId: "00000000-0000-4000-8000-000000000404",
        value: "not_true",
      }),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "Feedback target not found",
    });
  });

  it.each([
    ["a target type that is not a feedback target", { targetType: "inspiration", targetId, value: "true" }],
    ["a target id that is not a uuid", { targetType: "signal", targetId: "nope", value: "true" }],
    ["a field nobody asked for", { targetType: "signal", targetId, value: "true", source: "user" }],
  ])("rejects %s before persistence", async (_label, body) => {
    const createFeedback = vi.fn(async () => feedbackRecord);
    const app = mountWith({ createFeedback });

    const response = await app.request("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(response.status).toBe(400);
    expect(createFeedback).not.toHaveBeenCalled();
  });
});

describe("GET /api/feedback", () => {
  it("lists the acting profile's feedback through its filters", async () => {
    const listFeedback = vi.fn(async () => [feedbackRecord]);
    const app = mountWith({ listFeedback });

    const response = await app.request(
      `/api/feedback?targetType=top_of_mind_entry&targetId=${targetId}&limit=10`,
    );

    expect(response.status).toBe(200);
    expect(listFeedback).toHaveBeenCalledWith(
      {},
      { profileId, targetType: "top_of_mind_entry", targetId, limit: 10 },
    );
    await expect(response.json()).resolves.toEqual({ feedback: [feedbackRecord] });
  });

  it("falls back to a bounded page when no limit is given", async () => {
    const listFeedback = vi.fn(async () => [feedbackRecord]);
    const app = mountWith({ listFeedback });

    await app.request("/api/feedback");

    expect(listFeedback).toHaveBeenCalledWith({}, { profileId, limit: 50 });
  });

  it("rejects an out-of-range limit before querying", async () => {
    const listFeedback = vi.fn(async () => [feedbackRecord]);
    const app = mountWith({ listFeedback });

    const response = await app.request("/api/feedback?limit=0");

    expect(response.status).toBe(400);
    expect(listFeedback).not.toHaveBeenCalled();
  });
});

describe("who may answer a signal", () => {
  it("lets you answer your own", () => {
    expect(mayAnswerSignal({ ownsIt: true, sharedIntoARoomYouAreIn: false })).toBe(true);
  });

  it("lets you answer one shared into a room you are in", () => {
    expect(mayAnswerSignal({ ownsIt: false, sharedIntoARoomYouAreIn: true })).toBe(true);
  });

  /* the case the widening must not create: a statement that exists, that you
     do not own, and that was never shared anywhere you can see */
  it("refuses a stranger's unshared signal", () => {
    expect(mayAnswerSignal({ ownsIt: false, sharedIntoARoomYouAreIn: false })).toBe(false);
  });
});
