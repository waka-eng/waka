/**
 * Hono application entry-point.
 *
 * This module wires together the route modules into a single Hono app that
 * SST will deploy to Lambda (and that vitest exercises directly via
 * `app.request(...)`). Keep this file thin — actual handlers belong in
 * `./routes/*` — so route ownership stays clear.
 */

import { Hono } from "hono";

import { attachmentsRoutes } from "./routes/attachments.js";
import { authRoutes } from "./routes/auth.js";
import { inspirationsRoutes } from "./routes/inspirations.js";

export const app = new Hono();

/**
 * Liveness probe. Useful for `sst dev` smoke tests and for any future
 * uptime monitor that just needs a 200 to confirm the Lambda is awake.
 */
app.get("/health", (c) => c.json({ ok: true }));

// Auth routes (signup, login, ...) live under /auth.
app.route("/auth", authRoutes);

// Inspirations routes (create, list, ...) live under /inspirations.
// Every handler in this router requires a valid session — the router
// applies `requireAuth` at the mount point.
app.route("/inspirations", inspirationsRoutes);

// Attachments routes (presigned uploads, ...) live under /attachments.
// The router applies `requireAuth` at the mount point, so no anonymous
// caller can mint an S3 upload URL.
app.route("/attachments", attachmentsRoutes);

export default app;
