/**
 * WHAT MAY BE CACHED, AND WHAT MAY NEVER BE.
 *
 * This pairing is not an optimisation. Getting it wrong breaks the app
 * permanently after any rebuild: `index.html` is the only file that NAMES
 * the hashed chunks, so a cached document asks for chunks that no longer
 * exist, and the reload the error screen offers serves that same cached
 * document and fails identically. The one screen whose job is to recover
 * could not.
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing is replaced. A real Hono app
 * is mounted over a real temporary directory holding a real index.html and a
 * real hashed asset, and the assertions read the actual response headers.
 * The thing under test is a header policy — a fixture standing in for the
 * server would be asserting the policy against itself.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createLocalWebApp } from "./local-web.js";

let dist: string;
let app: Hono;

beforeAll(() => {
  dist = mkdtempSync(join(tmpdir(), "waka-local-web-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>waka</title>");
  writeFileSync(join(dist, "assets", "Chat-abc123.js"), "export default 1;");
  const api = new Hono();
  api.get("/api/health", (c) => c.json({ ok: true }));
  app = createLocalWebApp(api, dist) as Hono;
});

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe("what the local server lets a browser keep", () => {
  it("never lets the document be cached, because it names the chunks", async () => {
    const response = await app.request("/");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("says the same about a deep link, which serves the same document", async () => {
    /* Every route falls through to index.html, so every route is the
       manifest and every one of them has to say so. */
    const response = await app.request("/principles");

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("lets a hashed asset be kept forever, because its name changes with its bytes", async () => {
    const response = await app.request("/assets/Chat-abc123.js");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("immutable");
  });

  it("leaves the API alone", async () => {
    /* The header pass runs over every response; an API route must not pick
       up an asset's caching on its way out. */
    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control") ?? "").not.toContain("immutable");
  });
});
