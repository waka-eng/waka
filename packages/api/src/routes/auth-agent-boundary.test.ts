/**
 * THE TWO GUARDS ON `/me` THAT NOTHING WAS WATCHING.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): it replaces `requireAuth` only, so that a
 * request arrives carrying an AGENT session. Everything downstream of that —
 * `humanSessionsOnly` itself, the route wiring, the handlers — is the real
 * thing. The database and the auth primitives are stubbed because this file
 * asserts nothing about them; if a guard lets a request through, the stub is
 * what records that it reached a handler at all.
 *
 * WHY IT EXISTS.
 *
 * `PATCH /api/auth/me/profile` and `DELETE /api/auth/me` both carry
 * `humanSessionsOnly` on top of `requireAuth`, and the comment above them
 * explains why in detail: publishing a handle, making a profile public and
 * exposing a top of mind are the account holder's decisions about their own
 * visibility to the open internet, and account erasure is irreversible. An
 * agent credential is reachable by prompt injection.
 *
 * A reviewer checking the auth.ts split found that BOTH guards could be
 * deleted with `tsc` clean and the entire suite — 495 tests — still green.
 * The reason is worth stating, because it is not carelessness and it will
 * happen again: `auth-profile.test.ts` mocks `requireAuth` to install a HUMAN
 * session. `humanSessionsOnly` then reads that session, finds a human, and
 * passes. It cannot fail, so removing it changes nothing any test can see.
 *
 * The header of auth.ts already says these guards "fail silently: drop
 * humanSessionsOnly from a route and nothing stops you." That was written as a
 * warning to a reader. This file is what makes it false.
 *
 * `/me` and `/me/preferences` are asserted in the other direction on purpose.
 * A test that only proves refusals would pass just as happily against a build
 * that refused everything, and an agent reading its own session and setting
 * its own locale is a thing the product wants to work.
 */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedSession } from "../lib/session.js";

process.env.JWT_SECRET ??= "test-agent-boundary-secret";

/** An agent credential: same account, same human owner, different profile type. */
const AGENT_SESSION: AuthenticatedSession = {
  sessionId: "session-agent",
  account: { id: "account-1", email: "owner@example.com" },
  profile: {
    id: "profile-agent",
    accountId: "account-1",
    type: "agent",
    name: "Scout",
    preferredLocale: "en-US",
  },
};

const reached = vi.hoisted(() => ({ handler: false }));

vi.mock("../lib/middleware.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/middleware.js")>();
  return {
    ...actual,
    /* Only the authentication step is faked. `humanSessionsOnly` is the real
       implementation, spread in from `actual` above — it is the subject. */
    requireAuth: async (c: any, next: () => Promise<void>) => {
      c.set("session", AGENT_SESSION);
      c.set("sessionToken", "agent-token");
      await next();
    },
  };
});

vi.mock("../lib/db.js", () => ({
  getDb: () => {
    /* Reaching the database means a guard let the request through. Recorded
       rather than thrown, so the assertion below names the guard that failed
       instead of surfacing an unrelated stub error. */
    reached.handler = true;
    const chain: any = {};
    chain.from = vi.fn(() => chain);
    chain.innerJoin = vi.fn(() => chain);
    chain.where = vi.fn(() => {
      const result: any = Promise.resolve([]);
      result.limit = vi.fn(async () => []);
      return result;
    });
    return { select: vi.fn(() => chain), update: vi.fn(() => chain), delete: vi.fn(() => chain) };
  },
}));

vi.mock("../lib/account-erasure.js", () => ({
  eraseAccount: vi.fn(async () => {
    reached.handler = true;
  }),
}));

vi.mock("../lib/auth.js", () => ({
  SESSION_COOKIE_NAME: "waka_session",
  SESSION_TTL_SECONDS: 60 * 60 * 24 * 30,
  buildSessionClearCookie: () => "waka_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
  buildSessionCookie: () => "waka_session=test; Path=/; HttpOnly; SameSite=Lax",
  hashPassword: vi.fn(async () => "hashed-password"),
  signSessionToken: vi.fn(async () => "signed-token"),
  verifyPassword: vi.fn(async () => true),
  verifySessionToken: vi.fn(async () => null),
}));

vi.mock("../lib/session.js", () => ({
  createSessionRow: vi.fn(async () => undefined),
  revokeSessionByToken: vi.fn(async () => undefined),
  hashSessionToken: vi.fn(async () => "hashed-token"),
}));

import { authRoutes } from "./auth.js";

function app() {
  const hono = new Hono();
  hono.route("/api/auth", authRoutes);
  return hono;
}

const json = (body: unknown) => ({
  method: "PATCH",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("an agent session cannot act as the account holder", () => {
  it("refuses PATCH /me/profile — publishing is the human's decision", async () => {
    reached.handler = false;
    const res = await app().request(
      "/api/auth/me/profile",
      json({ publicHandle: "scout", publicProfileEnabled: true }),
    );

    expect(res.status).toBe(403);
    expect(
      reached.handler,
      "the request reached the handler — humanSessionsOnly is missing from PATCH /me/profile",
    ).toBe(false);
  });

  it("refuses DELETE /me — erasure is irreversible and not an agent's to trigger", async () => {
    reached.handler = false;
    const res = await app().request("/api/auth/me", { method: "DELETE" });

    expect(res.status).toBe(403);
    expect(
      reached.handler,
      "the request reached the handler — humanSessionsOnly is missing from DELETE /me",
    ).toBe(false);
  });

  it("still lets an agent read its own session", async () => {
    /* The other direction. Without this, a build that refused every request
       would pass the two cases above. */
    const res = await app().request("/api/auth/me");
    expect(res.status).not.toBe(403);
  });

  it("still lets an agent set its own locale", async () => {
    const res = await app().request("/api/auth/me/preferences", json({ preferredLocale: "en-US" }));
    expect(res.status).not.toBe(403);
  });
});
