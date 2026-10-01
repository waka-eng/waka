import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../lib/session.js";
import {
  createSignalRoutes,
  type SignalDetail,
  type SignalSummary,
} from "./signals.js";

const accountId = "00000000-0000-4000-8000-0000000000a1";
const humanProfileId = "00000000-0000-4000-8000-000000000001";
const agentProfileId = "00000000-0000-4000-8000-000000000002";
const otherAccountId = "00000000-0000-4000-8000-0000000000a2";
const signalId = "00000000-0000-4000-8000-000000000101";
const groupId = "00000000-0000-4000-8000-000000000201";

function sessionFor(
  profileId: string,
  type: "human" | "agent",
  profileAccountId = accountId,
): AuthenticatedSession {
  return {
    sessionId: "session-1",
    account: { id: profileAccountId, email: "someone@example.com" },
    profile: {
      id: profileId,
      accountId: profileAccountId,
      type,
      name: type === "human" ? "Owner" : "Assistant",
      preferredLocale: "en-US",
    },
  };
}

function authMiddleware(session: AuthenticatedSession) {
  return async (c: any, next: () => Promise<void>) => {
    c.set("session", session);
    await next();
  };
}

const summary: SignalSummary = {
  id: signalId,
  statement: "Quiet rooms are where the honest work happens.",
  status: "active",
  confidence: 72,
  evidenceCount: 4,
  lastEvidenceAt: "2026-05-30T12:00:00.000Z",
  locked: false,
  unsupported: false,
  dismissed: false,
  contested: false,
  yielded: false,
  sharedGroupIds: [groupId],
  createdAt: "2026-05-01T10:00:00.000Z",
};

const detail: SignalDetail = {
  ...summary,
  evidence: [
    {
      inspirationId: "00000000-0000-4000-8000-000000000301",
      preview: "A saved note about quiet research rooms.",
      reason: "The capture names the room as the condition, not the topic.",
      quote: "quiet research rooms",
      quoteSource: "own",
      createdAt: "2026-05-30T12:00:00.000Z",
    },
  ],
};


/* A GET serve now writes a consultation through the real writer, so any db
   a 200-path test injects must accept that one insert — the write itself is
   pinned against real Postgres in consultations.db.test.ts. */
function serveDb(): Record<string, unknown> {
  return { insert: () => ({ values: async () => undefined }) };
}

describe("GET /api/signals", () => {
  it("scopes the list to the acting profile and passes status and limit through", async () => {
    const db = serveDb();
    const listSignals = vi.fn(async () => [summary]);
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => db as any,
        listSignals,
        authMiddleware: authMiddleware(sessionFor(humanProfileId, "human")),
      }),
    );

    const response = await app.request("/api/signals?status=active&limit=12");

    expect(response.status).toBe(200);
    expect(listSignals).toHaveBeenCalledWith(db, {
      profileId: humanProfileId,
      status: "active",
      limit: 12,
    });
    /* SCOPED RECALL (meeting, 2026-08-17): the q parameter reaches the
       loader, so an agent can ask for the signals about one concern instead
       of paging the whole wall through its context window. */
    const scoped = await app.request("/api/signals?q=walking");
    expect(scoped.status).toBe(200);
    expect(listSignals).toHaveBeenLastCalledWith(
      db,
      expect.objectContaining({ profileId: humanProfileId, query: "walking" }),
    );
    await expect(response.json()).resolves.toEqual({
      signals: [
        {
          id: signalId,
          statement: "Quiet rooms are where the honest work happens.",
          status: "active",
          confidence: 72,
          evidenceCount: 4,
          lastEvidenceAt: "2026-05-30T12:00:00.000Z",
          locked: false,
          unsupported: false,
          dismissed: false,
          contested: false,
          yielded: false,
          sharedGroupIds: [groupId],
          createdAt: "2026-05-01T10:00:00.000Z",
        },
      ],
    });
  });

  it("defaults the limit rather than letting a caller ask for the whole archive", async () => {
    const listSignals = vi.fn(async () => []);
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        listSignals,
        authMiddleware: authMiddleware(sessionFor(humanProfileId, "human")),
      }),
    );

    await app.request("/api/signals");

    expect(listSignals).toHaveBeenCalledWith(expect.anything(), {
      profileId: humanProfileId,
      status: undefined,
      limit: 80,
    });
  });

  it("rejects unknown query parameters instead of silently ignoring them", async () => {
    const listSignals = vi.fn(async () => []);
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        listSignals,
        authMiddleware: authMiddleware(sessionFor(humanProfileId, "human")),
      }),
    );

    const response = await app.request("/api/signals?sort=resonance");

    expect(response.status).toBe(400);
    expect(listSignals).not.toHaveBeenCalled();
  });

  it("lets an agent session read the account's human profile", async () => {
    const listSignals = vi.fn(async () => [summary]);
    const loadProfile = vi.fn(async () => ({ id: humanProfileId, accountId, type: "human" as const }));
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        listSignals,
        loadProfile,
        authMiddleware: authMiddleware(sessionFor(agentProfileId, "agent")),
      }),
    );

    const response = await app.request(`/api/signals?profile=${humanProfileId}`);

    expect(response.status).toBe(200);
    expect(listSignals).toHaveBeenCalledWith(expect.anything(), {
      profileId: humanProfileId,
      status: undefined,
      limit: 80,
    });
  });

  it("answers a cross-account profile as not-found, not forbidden", async () => {
    // A 403 here would confirm the id names a real profile in another account;
    // the same body as a nonexistent id keeps that from being an oracle.
    const listSignals = vi.fn(async () => [summary]);
    const loadProfile = vi.fn(async () => ({
      id: humanProfileId,
      accountId: otherAccountId,
      type: "human" as const,
    }));
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        listSignals,
        loadProfile,
        authMiddleware: authMiddleware(sessionFor(agentProfileId, "agent")),
      }),
    );

    const response = await app.request(`/api/signals?profile=${humanProfileId}`);

    expect(response.status).toBe(404);
    expect(listSignals).not.toHaveBeenCalled();
  });
});

describe("GET /api/signals/:signalId", () => {
  it("returns the signal with the evidence behind it", async () => {
    const getSignal = vi.fn(async () => detail);
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        getSignal,
        authMiddleware: authMiddleware(sessionFor(humanProfileId, "human")),
      }),
    );

    const response = await app.request(`/api/signals/${signalId}`);

    expect(response.status).toBe(200);
    expect(getSignal).toHaveBeenCalledWith(expect.anything(), {
      profileId: humanProfileId,
      signalId,
    });
    const body = (await response.json()) as { signal: SignalDetail };
    expect(body.signal.evidence).toEqual([
      {
        inspirationId: "00000000-0000-4000-8000-000000000301",
        preview: "A saved note about quiet research rooms.",
        reason: "The capture names the room as the condition, not the topic.",
        quote: "quiet research rooms",
        quoteSource: "own",
        createdAt: "2026-05-30T12:00:00.000Z",
      },
    ]);
  });

  it("returns 404 for a signal that belongs to someone else", async () => {
    const getSignal = vi.fn(async () => null);
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        getSignal,
        authMiddleware: authMiddleware(sessionFor(humanProfileId, "human")),
      }),
    );

    const response = await app.request(`/api/signals/${signalId}`);

    expect(response.status).toBe(404);
  });
});

describe("PATCH /api/signals/:signalId", () => {
  /**
   * The edit costs the caller a delete and two enqueues, and no model call.
   *
   * Re-embedding a rewritten statement is a call on the single Gemini key
   * every account shares, and this handler used to make it inline — so one
   * account could spend that key at HTTP speed, past a per-account budget
   * that only ever looked at the queue. The vector still has to stop
   * describing the old wording immediately, which is why the drop stays here:
   * it is a delete, and it costs the key nothing.
   */
  it("drops the stale vector here and asks the queue for the new one", async () => {
    const updateStatement = vi.fn(async () => ({
      ...detail,
      statement: "Quiet rooms are the condition, not the preference.",
      locked: true,
    }));
    const dropEmbedding = vi.fn(async () => undefined);
    const requestReembed = vi.fn(async () => ({ jobId: "job-2", requestVersion: "1", created: true }));
    const requestRefresh = vi.fn(async () => ({ jobId: "job-1", requestVersion: "1", created: true }));
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        updateStatement,
        dropEmbedding,
        requestReembed,
        requestRefresh,
        authMiddleware: authMiddleware(sessionFor(humanProfileId, "human")),
      }),
    );

    const response = await app.request(`/api/signals/${signalId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        statement: "Quiet rooms are the condition, not the preference.",
      }),
    });

    // The claim of this test, asserted before the rest: the old vector is gone
    // and the new one was asked for on the queue. Anything else means the
    // model call came back into the request.
    expect(dropEmbedding).toHaveBeenCalledWith(expect.anything(), {
      profileId: humanProfileId,
      signalId,
    });
    expect(requestReembed).toHaveBeenCalledWith(humanProfileId, signalId);

    expect(response.status).toBe(200);
    expect(updateStatement).toHaveBeenCalledWith(expect.anything(), {
      profileId: humanProfileId,
      signalId,
      statement: "Quiet rooms are the condition, not the preference.",
    });
    await expect(response.json()).resolves.toMatchObject({
      signal: { locked: true, statement: "Quiet rooms are the condition, not the preference." },
    });
    expect(requestRefresh).toHaveBeenCalledWith(humanProfileId, "signals_changed");
  });

  /**
   * The edit has already committed by the time the queue is asked, so a queue
   * that is briefly unreachable must not turn it into a 500 — the caller's
   * retry would rewrite the same statement and ask again. The warning is the
   * record; the vector is restored by the next edit.
   */
  it("still answers the edit when the re-embed cannot be enqueued", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const updateStatement = vi.fn(async () => ({ ...detail, locked: true }));
    const requestReembed = vi.fn(async () => {
      throw new Error("queue unreachable");
    });
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        updateStatement,
        dropEmbedding: vi.fn(async () => undefined),
        requestReembed,
        requestRefresh: vi.fn(async () => ({ jobId: "job-1", requestVersion: "1", created: true })),
        authMiddleware: authMiddleware(sessionFor(humanProfileId, "human")),
      }),
    );

    const response = await app.request(`/api/signals/${signalId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statement: "Rewritten once more." }),
    });

    expect(response.status).toBe(200);
    expect(requestReembed).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("refuses an agent session editing the human profile's signals", async () => {
    const updateStatement = vi.fn();
    const loadProfile = vi.fn(async () => ({ id: humanProfileId, accountId, type: "human" as const }));
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        updateStatement,
        loadProfile,
        authMiddleware: authMiddleware(sessionFor(agentProfileId, "agent")),
      }),
    );

    const response = await app.request(
      `/api/signals/${signalId}?profile=${humanProfileId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ statement: "Rewritten by an agent." }),
      },
    );

    expect(response.status).toBe(403);
    expect(updateStatement).not.toHaveBeenCalled();
  });

  it("rejects an empty statement", async () => {
    const updateStatement = vi.fn();
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        updateStatement,
        authMiddleware: authMiddleware(sessionFor(humanProfileId, "human")),
      }),
    );

    const response = await app.request(`/api/signals/${signalId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ statement: "   " }),
    });

    expect(response.status).toBe(400);
    expect(updateStatement).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/signals/:signalId", () => {
  it("deletes the acting profile's signal", async () => {
    const deleteSignal = vi.fn(async () => true);
    const reconcilePrinciples = vi.fn(async () => ({ demoted: [], removed: [] }));
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        deleteSignal,
        reconcilePrinciples,
        authMiddleware: authMiddleware(sessionFor(humanProfileId, "human")),
      }),
    );

    const response = await app.request(`/api/signals/${signalId}`, { method: "DELETE" });

    expect(response.status).toBe(200);
    expect(deleteSignal).toHaveBeenCalledWith(expect.anything(), {
      profileId: humanProfileId,
      signalId,
    });
  });
});

describe("the retired share verb", () => {
  /**
   * A statement no longer reaches a room by being handed to it. The founder
   * retired that on 2026-08-24 and the wall stopped reading `signal_shares`
   * the same day; the endpoints outlived the wall for a few hours, answering
   * 201 to a write that nothing anywhere would ever show.
   *
   * The claim now is that the door is CLOSED, not that it behaves politely:
   * a route that still parsed the body and returned some considered refusal
   * would be a verb that still exists. 404 is the router having nothing
   * there, which is the honest shape of "this is not how rooms work".
   */
  it("no longer answers a request to put a statement up", async () => {
    const app = new Hono();
    app.route(
      "/api/signals",
      createSignalRoutes({
        getDatabase: () => serveDb() as any,
        authMiddleware: authMiddleware(sessionFor(humanProfileId, "human")),
      }),
    );

    const put = await app.request(`/api/signals/${signalId}/shares`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ groupId }),
    });
    expect(put.status, "there is no verb to put a statement up").toBe(404);

    const took = await app.request(`/api/signals/${signalId}/shares/${groupId}`, {
      method: "DELETE",
    });
    expect(took.status, "nor one to take it back down").toBe(404);
  });
});
