import { describe, expect, it } from "vitest";

import { apiCapabilities, healthRoutes } from "./health.js";

describe("GET /api/health", () => {
  it("stays a liveness probe and advertises the capability handshake", async () => {
    const response = await healthRoutes.request("/");

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      service: string;
      capabilities: string[];
    };
    expect(body.ok).toBe(true);
    expect(body.service).toBe("waka");
    expect(body.capabilities).toEqual([...apiCapabilities]);
  });

  /**
   * Clients key off these exact strings, so a rename is a break they can see
   * — which is the point of naming capabilities rather than version numbers.
   * Changing one is a deliberate act; this test is what makes it deliberate.
   */
  it("keeps the shipped capability strings stable for external clients", () => {
    expect(apiCapabilities).toContain("three-layers");
    expect(apiCapabilities).toContain("profiles");
    expect(apiCapabilities).toContain("cli-auth-consent");
    expect(apiCapabilities).toContain("signal-source");
    expect(apiCapabilities).toContain("attachment-enrichment");
  });
});
