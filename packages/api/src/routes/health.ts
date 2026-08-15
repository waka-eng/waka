/**
 * Liveness and capability handshake.
 *
 * An unauthenticated probe that also says who is answering and what it can
 * do, so an external client — waka-mcp first — can feature-detect rather than
 * guess. Guessing is unsafe here specifically: the read endpoints use
 * `.strict()` query schemas, so a server that does not know a parameter
 * rejects the whole request rather than ignoring it. "Send it and see" tells
 * a client nothing it can act on.
 *
 * Clients key off the exact strings, so a shipped entry is not renamed
 * casually — a rename is a break, and it should be one they can detect.
 */

import { Hono } from "hono";

export const apiCapabilities = [
  // The three-layer model: /api/inspirations, /api/signals, /api/top-of-mind.
  "three-layers",
  // Accounts own profiles; /api/profiles lists and manages them.
  "profiles",
  // /api/auth/cli/start renders a consent page with a profile picker, and the
  // credential it mints binds to the chosen profile.
  "cli-auth-consent",
  // POST /api/inspirations accepts `source: "app" | "agent"` from an
  // agent-bound session.
  "signal-source",
  // Attachments carry enrichment: a link's page body, an image's description.
  "attachment-enrichment",
] as const;

export const healthRoutes = new Hono();

healthRoutes.get("/", (c) =>
  c.json({ ok: true, service: "waka", capabilities: apiCapabilities }),
);
