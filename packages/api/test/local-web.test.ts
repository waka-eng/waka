import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { createLocalWebApp, isApiRoute } from "../src/local-web.js";

describe("local web dist server", () => {
  it("classifies protected API route prefixes", () => {
    expect(isApiRoute("/auth/google/login")).toBe(true);
    expect(isApiRoute("/inspirations/123")).toBe(true);
    expect(isApiRoute("/attachments/presign")).toBe(true);
    expect(isApiRoute("/wow-moments")).toBe(true);
    expect(isApiRoute("/health")).toBe(true);
    expect(isApiRoute("/healthy-client-route")).toBe(false);
    expect(isApiRoute("/author-profile")).toBe(false);
  });

  it("serves static files and falls back to index only for non-API GET routes", async () => {
    const distDir = join(tmpdir(), `waka-web-dist-${randomUUID()}`);
    await mkdir(join(distDir, "assets"), { recursive: true });
    await writeFile(join(distDir, "index.html"), "<main>WAKA SPA</main>");
    await writeFile(join(distDir, "assets", "app.js"), "console.log('waka');");

    const api = new Hono();
    api.get("/health", (c) => c.json({ ok: true }));
    api.get("/auth/me", (c) => c.json({ user: null }, 401));

    const app = createLocalWebApp(api, distDir);

    const health = await app.request("/health");
    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ ok: true });

    const asset = await app.request("/assets/app.js");
    expect(asset.status).toBe(200);
    await expect(asset.text()).resolves.toBe("console.log('waka');");

    const clientRoute = await app.request("/boards/today");
    expect(clientRoute.status).toBe(200);
    expect(clientRoute.headers.get("content-type")).toContain("text/html");
    await expect(clientRoute.text()).resolves.toBe("<main>WAKA SPA</main>");

    const unknownApi = await app.request("/auth/not-a-real-route");
    expect(unknownApi.status).toBe(404);
    await expect(unknownApi.text()).resolves.not.toContain("WAKA SPA");
  });
});
