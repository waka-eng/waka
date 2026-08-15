import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { getAdminEmailAllowlist, isAdminUser, requireAdminUser } from "./admin-auth.js";
import type { AuthEnv } from "./middleware.js";
import type { AuthenticatedSession } from "./session.js";

const ORIGINAL_ADMIN_EMAILS = process.env.WAKA_ADMIN_EMAILS;
const ORIGINAL_ADMIN_ALLOWLIST = process.env.WAKA_ADMIN_ALLOWLIST;

afterEach(() => {
  if (ORIGINAL_ADMIN_EMAILS === undefined) {
    delete process.env.WAKA_ADMIN_EMAILS;
  } else {
    process.env.WAKA_ADMIN_EMAILS = ORIGINAL_ADMIN_EMAILS;
  }

  if (ORIGINAL_ADMIN_ALLOWLIST === undefined) {
    delete process.env.WAKA_ADMIN_ALLOWLIST;
  } else {
    process.env.WAKA_ADMIN_ALLOWLIST = ORIGINAL_ADMIN_ALLOWLIST;
  }
});

function sessionFor(email: string, type: "human" | "agent" = "human"): AuthenticatedSession {
  return {
    sessionId: "00000000-0000-4000-8000-0000000000f1",
    account: { id: "00000000-0000-4000-8000-0000000000a1", email },
    profile: {
      id: "00000000-0000-4000-8000-000000000001",
      accountId: "00000000-0000-4000-8000-0000000000a1",
      type,
      name: "Ada",
      preferredLocale: "en-US",
    },
  };
}

function appActingAs(session: AuthenticatedSession | null) {
  const app = new Hono<AuthEnv>();
  app.use("*", async (c, next) => {
    if (session) c.set("session", session);
    await next();
  });
  app.use("*", requireAdminUser);
  app.get("/admin", (c) => c.json({ ok: true }));
  return app;
}

describe("admin auth allowlist", () => {
  it("normalizes admin email allowlist entries", () => {
    process.env.WAKA_ADMIN_EMAILS = " Admin@Example.com,ops@example.com ; dev@example.com ";
    delete process.env.WAKA_ADMIN_ALLOWLIST;

    expect([...getAdminEmailAllowlist()].sort()).toEqual([
      "admin@example.com",
      "dev@example.com",
      "ops@example.com",
    ]);
    expect(isAdminUser({ email: "ADMIN@example.com" })).toBe(true);
    expect(isAdminUser({ email: "user@example.com" })).toBe(false);
    expect(isAdminUser(null)).toBe(false);
  });

  it("returns 403 for an authenticated account outside the allowlist", async () => {
    process.env.WAKA_ADMIN_EMAILS = "admin@example.com";

    const response = await appActingAs(sessionFor("user@example.com")).request("/admin");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Admin authorization required" });
  });

  it("allows an allowlisted account", async () => {
    process.env.WAKA_ADMIN_EMAILS = "admin@example.com";

    const response = await appActingAs(sessionFor("admin@example.com")).request("/admin");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  /**
   * The allowlist is keyed by account email, and an agent session carries the
   * same account. That is deliberate: administering the queue belongs to the
   * account, and the routes behind this gate are scoped to that account's own
   * profiles either way.
   */
  it("reads the account, not the profile, so a bound agent session is not a separate identity", async () => {
    process.env.WAKA_ADMIN_EMAILS = "admin@example.com";

    const response = await appActingAs(sessionFor("admin@example.com", "agent")).request(
      "/admin",
    );

    expect(response.status).toBe(200);
  });

  it("refuses a request with no session at all", async () => {
    process.env.WAKA_ADMIN_EMAILS = "admin@example.com";

    const response = await appActingAs(null).request("/admin");

    expect(response.status).toBe(403);
  });
});
