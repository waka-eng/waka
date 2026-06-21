import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";

import { getAdminEmailAllowlist, isAdminUser, requireAdminUser } from "./admin-auth.js";

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
  });

  it("returns 403 for authenticated users outside the allowlist", async () => {
    process.env.WAKA_ADMIN_EMAILS = "admin@example.com";
    const app = new Hono<any>();
    app.use("*", async (c, next) => {
      c.set("user", { email: "user@example.com" });
      await next();
    });
    app.use("*", requireAdminUser as any);
    app.get("/admin", (c) => c.json({ ok: true }));

    const response = await app.request("/admin");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Admin authorization required" });
  });

  it("allows authenticated allowlisted admin users", async () => {
    process.env.WAKA_ADMIN_EMAILS = "admin@example.com";
    const app = new Hono<any>();
    app.use("*", async (c, next) => {
      c.set("user", { email: "admin@example.com" });
      await next();
    });
    app.use("*", requireAdminUser as any);
    app.get("/admin", (c) => c.json({ ok: true }));

    const response = await app.request("/admin");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
