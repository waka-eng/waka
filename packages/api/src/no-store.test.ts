/**
 * Every API response must forbid shared caching.
 *
 * This is a regression test for something that actually happened on the
 * deployed stage: CloudFront cached `/api/groups/:id/wall` by URL, so a
 * non-member's 404 was served back to the group's own owner — and the same
 * mechanism, hit in the other order, would have served a member's wall
 * contents to someone who had never joined. Nothing about the handlers is
 * wrong in that scenario; the response simply has to say it is unshareable.
 */

import { describe, expect, it } from "vitest";

import { app } from "./index.js";

/**
 * Paths that answer without a database, so this stays a no-database test.
 * The header is applied by one middleware over every route, so proving it on
 * these proves it everywhere.
 */
const PATHS = ["/api/health", "/api/auth/me", "/api/inspirations", "/api/does-not-exist"];

describe("no API response is shareable between callers", () => {
  it.each(PATHS)("%s forbids storing", async (path) => {
    const response = await app.request(path);

    expect(response.headers.get("cache-control")).toBe("no-store, private");
  });

  it.each(PATHS)("%s varies on the credential", async (path) => {
    const response = await app.request(path);

    const vary = response.headers.get("vary") ?? "";
    expect(vary).toContain("Authorization");
    expect(vary).toContain("Cookie");
  });

  /**
   * `no-cache` would still permit an intermediary to keep a copy and
   * revalidate it, and there is no revalidation a CDN could perform that
   * establishes who is asking.
   */
  it("does not settle for no-cache", async () => {
    const response = await app.request("/api/health");

    expect(response.headers.get("cache-control")).not.toBe("no-cache");
  });
});
