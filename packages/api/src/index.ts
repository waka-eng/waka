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
import { adminBackgroundJobsRoutes } from "./routes/admin-background-jobs.js";
import { inspirationsRoutes } from "./routes/inspirations.js";
import { wowMomentsRoutes } from "./routes/wow-moments.js";

export const app = new Hono();

/**
 * Liveness probe. Useful for `sst dev` smoke tests and for any future
 * uptime monitor that just needs a 200 to confirm the Lambda is awake.
 */
app.get("/api/health", (c) => c.json({ ok: true }));

// Auth routes (signup, login, ...) live under /api/auth.
app.route("/api/auth", authRoutes);

// Internal/dev-only background job observability routes. The router itself
// applies both env-gate and requireAuth so the namespace stays hidden by
// default while returning 401 for unauthenticated requests when explicitly on.
app.route("/api/admin/background-jobs", adminBackgroundJobsRoutes);

// Inspirations routes (create, list, ...) live under /api/inspirations.
// Every handler in this router requires a valid session — the router
// applies `requireAuth` at the mount point.
app.route("/api/inspirations", inspirationsRoutes);

// Attachments routes (presigned uploads, ...) live under /api/attachments.
// The router applies `requireAuth` at the mount point, so no anonymous
// caller can mint an S3 upload URL.
app.route("/api/attachments", attachmentsRoutes);

// WOW moment routes list persisted generated moments for the signed-in user.
// Generation/scoring pipelines land later; this mount only exposes rows that
// already exist in the database.
app.route("/api/wow-moments", wowMomentsRoutes);

export default app;
