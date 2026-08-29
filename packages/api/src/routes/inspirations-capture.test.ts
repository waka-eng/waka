/**
 * THE TWO RULES THAT DECIDE WHAT A CAPTURE SAYS ABOUT YOU.
 *
 * What this suite mocks, and why (see docs/goals/a-codebase-you-can-navigate.md,
 * G6): it mocks the **database driver**, not the route. The Hono app under test
 * is the real `createInspirationsRoutes`, wired the way `index.ts` wires it, and
 * the assertions are on the values the route hands the database — the object it
 * passes to `insert().values()`. Nothing here opens a connection; `lib/db.js`
 * and `lib/queue.js` are replaced so a stray call fails loudly rather than
 * quietly reaching a real Postgres.
 *
 * That boundary is chosen deliberately. The bug this file exists to hold down
 * (`visibilityForCapture`) is a bug about *which column the route writes*, and
 * the only place that is observable is the argument to the insert. A test that
 * mocked one layer higher would pass no matter what the route wrote.
 *
 * The other half is `agent-boundary.db.test.ts`, which proves against a real
 * migrated Postgres that a capture row written with no `visibility` comes back
 * `private`. Neither test is sufficient alone and the pair is the whole claim:
 *
 *   here            — writing for someone else sends no `visibility` column
 *   agent-boundary  — a row with no `visibility` column is private
 *
 * Keep them in sync. If the route ever starts writing a literal instead of
 * omitting the key, this suite fails, and it should.
 */

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { inspirations as inspirationsTable } from "../db/index.js";
import type { AuthenticatedSession } from "../lib/session.js";

vi.mock("../lib/db.js", () => ({
  getDb: () => {
    throw new Error("this suite must never open a database connection");
  },
}));

vi.mock("../lib/queue.js", () => ({
  enqueueDeriveSignals: vi.fn(async () => ({ id: "job", created: true })),
  enqueueTopOfMindRefresh: vi.fn(async () => ({ id: "job", created: true })),
  enqueueEnrichAttachment: vi.fn(async () => ({ id: "job", created: true })),
}));

const { createInspirationsRoutes } = await import("./inspirations.js");
const { sourceForCapture, visibilityForCapture } = await import("./inspirations-capture.js");

const accountId = "00000000-0000-4000-8000-0000000000a1";
const humanProfileId = "00000000-0000-4000-8000-000000000001";
const agentProfileId = "00000000-0000-4000-8000-000000000002";

function sessionFor(profileId: string, type: "human" | "agent"): AuthenticatedSession {
  return {
    sessionId: "session-1",
    account: { id: accountId, email: "someone@example.com" },
    profile: {
      id: profileId,
      accountId,
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

/**
 * A stand-in for the driver that remembers what it was asked to write.
 *
 * `profileRows` is what the `?profile=` lookup finds. The returned row echoes
 * the written values with `visibility` filled in the way the column's own
 * default would fill it — that default is the thing `agent-boundary.db.test.ts`
 * proves; here it only exists so serialization has a row to work with. The
 * assertion that matters is on `writtenRows`, never on the echo. That array was
 * called `captured` until the vocabulary gate reached this package: the test-spy
 * sense of the word and layer 1's sense collided in the one file where both are
 * in play, so one line meant "what the spy recorded" and the next meant "the
 * inspiration".
 */
function fakeDatabase(
  profileRows: Array<{ id: string; accountId: string; type?: "human" | "agent" }> = [],
) {
  const writtenRows: Array<Record<string, unknown>> = [];

  const selectChain: any = {
    from: () => selectChain,
    where: () => selectChain,
    limit: async () => profileRows,
  };

  const tx = {
    insert: (table: unknown) => ({
      values: (values: any) => ({
        returning: async () => {
          if (table !== inspirationsTable) {
            return (Array.isArray(values) ? values : [values]).map((v: any, i: number) => ({
              id: `reflection-${i}`,
              inspirationId: v.inspirationId,
              question: v.question,
              answer: v.answer,
              skipped: v.skipped,
              createdAt: v.createdAt ?? new Date(0),
            }));
          }
          writtenRows.push(values);
          return [
            {
              id: "00000000-0000-4000-8000-0000000000ff",
              profileId: values.profileId,
              text: values.text,
              kind: values.kind,
              source: values.source,
              visibility: values.visibility ?? "private",
              createdAt: values.createdAt,
              updatedAt: values.updatedAt,
            },
          ];
        },
      }),
    }),
  };

  const db: any = {
    select: () => selectChain,
    transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  };

  return { db, writtenRows };
}

function appFor(session: AuthenticatedSession, db: unknown) {
  const app = new Hono();
  app.route(
    "/api/inspirations",
    createInspirationsRoutes({
      getDatabase: () => db as any,
      authMiddleware: authMiddleware(session),
    }),
  );
  return app;
}

describe("visibilityForCapture", () => {
  it("honors what you chose for your own capture", () => {
    const session = sessionFor(humanProfileId, "human");
    expect(visibilityForCapture(session, humanProfileId, "public")).toBe("public");
    expect(visibilityForCapture(session, humanProfileId, "private")).toBe("private");
    expect(visibilityForCapture(session, humanProfileId, undefined)).toBeUndefined();
  });

  it("refuses to publish on behalf of another profile", () => {
    // The agent holds "capture" on the human profile and legitimately writes
    // here. Publishing is a different permission wearing the same request.
    const agent = sessionFor(agentProfileId, "agent");
    expect(visibilityForCapture(agent, humanProfileId, "public")).toBeUndefined();
  });

  it("drops a cross-profile visibility even when the session is the account's human", () => {
    // Not only agents. An admin human session writing into one of its own
    // agent profiles is still someone else's capture, and the choice to open
    // it belongs to whoever reads that profile's material.
    const human = sessionFor(humanProfileId, "human");
    expect(visibilityForCapture(human, agentProfileId, "public")).toBeUndefined();
  });
});

describe("sourceForCapture", () => {
  it("never lets a browser claim to be an agent", () => {
    const human = sessionFor(humanProfileId, "human");
    expect(sourceForCapture(human, "agent")).toBe("app");
    expect(sourceForCapture(human, undefined)).toBe("app");
  });

  it("lets an agent session say whose initiative the content was", () => {
    const agent = sessionFor(agentProfileId, "agent");
    expect(sourceForCapture(agent, "app")).toBe("app");
    expect(sourceForCapture(agent, "agent")).toBe("agent");
    expect(sourceForCapture(agent, undefined)).toBe("agent");
  });
});

describe("POST /api/inspirations", () => {
  /* The 2026-08-29 ruling: what an agent generates stays wholly in its own
     stack. The capture that used to relay into the human is refused at the
     door, and refused means NOTHING WRITTEN — a 403 that still inserted
     would be the ruling in name only. */
  it("refuses an agent capturing into the human profile, writing nothing", async () => {
    const { db, writtenRows } = fakeDatabase([{ id: humanProfileId, accountId }]);
    const app = appFor(sessionFor(agentProfileId, "agent"), db);

    const response = await app.request(
      `/api/inspirations?profile=${humanProfileId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "relayed from a page", visibility: "public" }),
      },
    );

    expect(response.status).toBe(403);
    expect(writtenRows).toHaveLength(0);
  });

  it("writes no visibility column when the HUMAN captures into an agent profile", async () => {
    const { db, writtenRows } = fakeDatabase([
      { id: agentProfileId, accountId, type: "agent" },
    ]);
    const app = appFor(sessionFor(humanProfileId, "human"), db);

    const response = await app.request(
      `/api/inspirations?profile=${agentProfileId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "seeded into the agent", visibility: "public" }),
      },
    );

    expect(response.status).toBe(201);
    expect(writtenRows).toHaveLength(1);
    expect(writtenRows[0]!.profileId).toBe(agentProfileId);
    // The key must be ABSENT, not "private": the column default is the single
    // place that decides what unset means.
    expect(
      Object.hasOwn(writtenRows[0]!, "visibility"),
      "the route wrote a visibility for a capture it is making on someone else's behalf",
    ).toBe(false);
  });

  it("keeps your own choice when you capture into your own profile", async () => {
    const { db, writtenRows } = fakeDatabase();
    const app = appFor(sessionFor(humanProfileId, "human"), db);

    const response = await app.request("/api/inspirations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "something I chose to share", visibility: "public" }),
    });

    expect(response.status).toBe(201);
    expect(writtenRows).toHaveLength(1);
    expect(writtenRows[0]!.visibility).toBe("public");
  });

  it("records a human session's capture as app even when the body says agent", async () => {
    const { db, writtenRows } = fakeDatabase();
    const app = appFor(sessionFor(humanProfileId, "human"), db);

    const response = await app.request("/api/inspirations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "typed in a browser", source: "agent" }),
    });

    expect(response.status).toBe(201);
    expect(writtenRows[0]!.source).toBe("app");
  });

  it("answers a profile in another account as not-found, and writes nothing", async () => {
    // A 403 would confirm the id names a real profile somewhere.
    const { db, writtenRows } = fakeDatabase([
      { id: humanProfileId, accountId: "00000000-0000-4000-8000-0000000000a2" },
    ]);
    const app = appFor(sessionFor(agentProfileId, "agent"), db);

    const response = await app.request(
      `/api/inspirations?profile=${humanProfileId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "not yours", visibility: "public" }),
      },
    );

    expect(response.status).toBe(404);
    expect(writtenRows).toHaveLength(0);
  });
});
