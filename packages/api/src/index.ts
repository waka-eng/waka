/**
 * Hono application entry-point.
 *
 * This module wires together the route modules into a single Hono app that
 * SST will deploy to Lambda (and that vitest exercises directly via
 * `app.request(...)`). Keep this file thin — actual handlers belong in
 * `./routes/*` — so route ownership stays clear.
 */

import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

import { attachmentsRoutes } from "./routes/attachments.js";
import { authRoutes } from "./routes/auth.js";
import { adminBackgroundJobsRoutes } from "./routes/admin-background-jobs.js";
import { adminMeaningGraphRoutes } from "./routes/admin-meaning-graph.js";
import { adminTopOfMindPreviewRoutes } from "./routes/admin-top-of-mind-preview.js";
import { decisionMemoRoutes } from "./routes/decision-memo.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { guidedReflectionRoutes } from "./routes/guided-reflection.js";
import { inspirationsRoutes } from "./routes/inspirations.js";
import { publicProfileRoutes } from "./routes/public-profiles.js";
import { signalArchiveRoutes } from "./routes/signals.js";
import { topOfMindRoutes } from "./routes/top-of-mind.js";
import { wowMomentsRoutes } from "./routes/wow-moments.js";
import { wowStatusRoutes } from "./routes/wow-status.js";

export const app = new Hono();

/**
 * Liveness probe. Useful for `sst dev` smoke tests and for any future
 * uptime monitor that just needs a 200 to confirm the Lambda is awake.
 */
app.get("/api/health", (c) => c.json({ ok: true }));

// Auth routes (signup, login, ...) live under /api/auth.
app.route("/api/auth", authRoutes);

// Public profile routes are deliberately unauthenticated and return only the
// owner-approved public surface.
app.route("/api/public/profiles", publicProfileRoutes);

// Internal/dev-only background job observability routes. The router itself
// applies both env-gate and requireAuth so the namespace stays hidden by
// default while returning 401 for unauthenticated requests when explicitly on.
app.route("/api/admin/background-jobs", adminBackgroundJobsRoutes);

// Internal/dev-only meaning graph inspection. This stays under /api/admin so
// graph state is available for reviewers without becoming a user-facing API.
app.route("/api/admin/meaning-graph", adminMeaningGraphRoutes);

// Internal/dev-only preview of how the current meaning graph could power the
// top-of-mind experience.
app.route("/api/admin/top-of-mind-preview", adminTopOfMindPreviewRoutes);

// Inspirations routes (create, list, ...) live under /api/inspirations.
// Every handler in this router requires a valid session — the router
// applies `requireAuth` at the mount point.
app.route("/api/inspirations", inspirationsRoutes);

// User-facing guided Reflect Deeper prompt generation. The route owns the
// model contract and returns deterministic fallback copy when generation is
// unavailable, so the capture flow can stay safe and non-blocking.
app.route("/api/guided-reflection", guidedReflectionRoutes);

// User-facing saved-signal archive and deep-dive surface.
app.route("/api/signals", signalArchiveRoutes);

// User-facing reading of the current meaning graph.
app.route("/api/top-of-mind", topOfMindRoutes);

// Low-prominence scaffold for turning graph-backed notes into a build decision.
app.route("/api/decision-memo", decisionMemoRoutes);

// User feedback teaches the graph-backed signal and top-of-mind loop.
app.route("/api/feedback", feedbackRoutes);

// Attachments routes (presigned uploads, ...) live under /api/attachments.
// The router applies `requireAuth` at the mount point, so no anonymous
// caller can mint an S3 upload URL.
app.route("/api/attachments", attachmentsRoutes);

// WOW moment routes list persisted generated moments for the signed-in user.
// Generation/scoring pipelines land later; this mount only exposes rows that
// already exist in the database.
app.route("/api/wow-moments", wowMomentsRoutes);

// Tenant-scoped development/status view for the visible WOW generation pipeline.
app.route("/api/wow-status", wowStatusRoutes);

export const handler = handle(app);

export default app;
