import { Hono } from "hono";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { authRoutes } from "./auth.js";

const authState = vi.hoisted(() => ({
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "user@example.com",
    name: "Existing",
    avatarUrl: null as string | null,
    preferredLocale: "en-US",
    onboardingCompletedAt: null as Date | null,
  },
}));

const dbState = vi.hoisted(() => ({
  db: {} as any,
}));

vi.mock("../lib/middleware.js", () => ({
  requireAuth: async (c: any, next: () => Promise<void>) => {
    const authorization = c.req.header("Authorization");
    if (!authorization?.toLowerCase().startsWith("bearer ")) {
      return c.json({ error: "Authentication required" }, 401);
    }
    c.set("user", authState.user);
    c.set("sessionToken", authorization.slice(7).trim());
    await next();
  },
}));

vi.mock("../lib/db.js", () => ({
  getDb: () => dbState.db,
}));

vi.mock("../lib/auth.js", () => ({
  buildSessionClearCookie: () => "waka_session=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
  buildSessionCookie: () => "waka_session=test; Path=/; HttpOnly; SameSite=Lax",
  hashPassword: vi.fn(async () => "hashed-password"),
  signSessionToken: vi.fn(async () => "signed-token"),
  verifyPassword: vi.fn(async () => true),
}));

vi.mock("../lib/session.js", () => ({
  createSessionRow: vi.fn(async () => undefined),
  revokeSessionByToken: vi.fn(async () => undefined),
}));

function app() {
  const hono = new Hono();
  hono.route("/api/auth", authRoutes);
  return hono;
}

function makeProfileDb(updatedRows: unknown[]) {
  const returning = vi.fn(async () => updatedRows);
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  return { update, set, where, returning };
}

function makeDeleteDb() {
  const where = vi.fn(async () => undefined);
  const deleteFn = vi.fn(() => ({ where }));
  return { delete: deleteFn, where };
}

beforeEach(() => {
  delete process.env.WAKA_ADMIN_EMAILS;
  delete process.env.WAKA_ADMIN_ALLOWLIST;
  authState.user = {
    id: "00000000-0000-4000-8000-000000000001",
    email: "user@example.com",
    name: "Existing",
    avatarUrl: null,
    preferredLocale: "en-US",
    onboardingCompletedAt: null,
  };
  dbState.db = {};
  vi.clearAllMocks();
});

describe("GET /api/auth/me", () => {
  it("marks allowlisted users as admins", async () => {
    process.env.WAKA_ADMIN_EMAILS = "admin@example.com, user@example.com";

    const response = await app().request("/api/auth/me", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: {
        email: "user@example.com",
        isAdmin: true,
      },
    });
  });

  it("marks authenticated non-admin users as non-admin", async () => {
    process.env.WAKA_ADMIN_EMAILS = "admin@example.com";

    const response = await app().request("/api/auth/me", {
      headers: { Authorization: "Bearer test-token" },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: {
        email: "user@example.com",
        isAdmin: false,
      },
    });
  });
});

describe("PATCH /api/auth/me/profile", () => {
  it("requires authentication", async () => {
    const response = await app().request("/api/auth/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "Mina", preferredLocale: "ko-KR" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("rejects invalid profile payloads", async () => {
    const response = await app().request("/api/auth/me/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: "", preferredLocale: "fr-FR", extra: true }),
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid profile payload",
      details: {
        name: ["Nickname is required"],
        preferredLocale: expect.any(Array),
      },
    });
  });

  it("persists nickname, locale, and onboarding completion", async () => {
    const completedAt = new Date("2026-06-20T10:15:30.000Z");
    const db = makeProfileDb([
      {
        id: authState.user.id,
        email: authState.user.email,
        name: "Mina",
        avatarUrl: null,
        preferredLocale: "ko-KR",
        onboardingCompletedAt: completedAt,
      },
    ]);
    dbState.db = db;

    const response = await app().request("/api/auth/me/profile", {
      method: "PATCH",
      body: JSON.stringify({
        name: " Mina ",
        preferredLocale: "ko-KR",
        completeOnboarding: true,
      }),
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(200);
    expect(db.update).toHaveBeenCalledTimes(1);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Mina",
        preferredLocale: "ko-KR",
        onboardingCompletedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    const body = await response.json();
    expect(body).toMatchObject({
      user: {
        id: authState.user.id,
        email: authState.user.email,
        name: "Mina",
        preferredLocale: "ko-KR",
        onboardingCompletedAt: completedAt.toISOString(),
      },
    });
  });

  it("keeps an existing onboarding completion timestamp stable", async () => {
    const existingCompletedAt = new Date("2026-06-19T08:00:00.000Z");
    authState.user.onboardingCompletedAt = existingCompletedAt;
    const db = makeProfileDb([
      {
        ...authState.user,
        name: "Mina",
        preferredLocale: "en-US",
      },
    ]);
    dbState.db = db;

    const response = await app().request("/api/auth/me/profile", {
      method: "PATCH",
      body: JSON.stringify({
        name: "Mina",
        preferredLocale: "en-US",
        completeOnboarding: true,
      }),
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(200);
    expect(db.set).toHaveBeenCalledWith(
      expect.objectContaining({ onboardingCompletedAt: existingCompletedAt }),
    );
    await expect(response.json()).resolves.toMatchObject({
      user: { onboardingCompletedAt: existingCompletedAt.toISOString() },
    });
  });
});

describe("DELETE /api/auth/me", () => {
  it("requires authentication", async () => {
    const response = await app().request("/api/auth/me", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Authentication required" });
  });

  it("requires the literal DELETE confirmation", async () => {
    const response = await app().request("/api/auth/me", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "delete" }),
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid delete confirmation",
      details: { confirmation: expect.any(Array) },
    });
  });

  it("deletes the authenticated user and clears the session cookie", async () => {
    const db = makeDeleteDb();
    dbState.db = db;

    const response = await app().request("/api/auth/me", {
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE" }),
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
    });

    expect(response.status).toBe(200);
    expect(db.delete).toHaveBeenCalledTimes(1);
    expect(db.where).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Set-Cookie")).toContain("Max-Age=0");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
