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

  it("keeps the shipped capability strings stable for external clients", () => {
    expect(apiCapabilities).toContain("cli-auth");
    expect(apiCapabilities).toContain("signal-source");
    expect(apiCapabilities).toContain("top-of-mind-lens");
  });
});
