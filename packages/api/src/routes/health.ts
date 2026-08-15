/**
 * Liveness + capability handshake.
 *
 * `GET /api/health` has always been an unauthenticated liveness probe
 * (`{ ok: true }`); it now also identifies the service and advertises
 * capabilities so external clients — waka-mcp first — can feature-detect
 * instead of guessing. That matters because the user-facing read endpoints
 * use `.strict()` query schemas: an older server hard-400s on a query param
 * it doesn't know (e.g. `lens` before the provenance work landed), so a
 * client cannot probe by just sending the param and watching what happens.
 *
 * Keep shipped entries stable — clients key off the exact strings.
 */

import { Hono } from "hono";

export const apiCapabilities = [
  // /api/auth/cli/start + /exchange — the waka-mcp loopback login.
  "cli-auth",
  // POST /api/inspirations accepts `source: "app" | "agent"` from CLI sessions.
  "signal-source",
  // GET /api/top-of-mind accepts `lens=all|app|agent`.
  "top-of-mind-lens",
] as const;

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) =>
  c.json({ ok: true, service: "waka", capabilities: apiCapabilities }),
);
