/**
 * Hono application entry-point.
 *
 * Wires the route modules into a single app that SST deploys to Lambda and
 * that vitest exercises directly via `app.request(...)`. Keep this file thin
 * — handlers belong in `./routes/*` — so route ownership stays obvious.
 *
 * The mounts follow the three layers: inspirations are what a person or an
 * agent captures, signals are what WAKA distills from them, and the top of
 * mind is the single artifact those signals synthesize into. Groups pool
 * shared signals and grow an artifact of their own.
 */

import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

import { adminBackgroundJobsRoutes } from "./routes/admin-background-jobs.js";
import { attachmentsRoutes } from "./routes/attachments.js";
import { authRoutes } from "./routes/auth.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { groupsRoutes } from "./routes/groups.js";
import { healthRoutes } from "./routes/health.js";
import { inspirationsRoutes } from "./routes/inspirations.js";
import { publicProfileRoutes } from "./routes/public-profiles.js";
import { signalsRoutes } from "./routes/signals.js";
import { topOfMindRoutes } from "./routes/top-of-mind.js";

export const app = new Hono();

// Liveness probe + capability handshake for external clients (waka-mcp
// validates the API URL against it at login; capabilities let clients
// feature-detect instead of guessing).
app.route("/api/health", healthRoutes);

// Signup, login, session, profile preferences, and the CLI loopback flow.
app.route("/api/auth", authRoutes);

// Deliberately unauthenticated: returns only the owner-approved surface.
app.route("/api/public/profiles", publicProfileRoutes);

// Internal/dev-only queue observability. The router applies its own env
// gate, requireAuth, and admin allowlist, so the namespace stays hidden by
// default while still returning 401 for anonymous callers when enabled.
app.route("/api/admin/background-jobs", adminBackgroundJobsRoutes);

// Layer 1 — capture, edit, delete, and search the raw archive.
app.route("/api/inspirations", inspirationsRoutes);

// Presigned uploads. The router applies requireAuth at the mount point, so
// no anonymous caller can mint an S3 upload URL.
app.route("/api/attachments", attachmentsRoutes);

// Layer 2 — the evidence-backed patterns WAKA derives, and their shares.
app.route("/api/signals", signalsRoutes);

// Layer 3 — the one live artifact per profile, and its version chain.
app.route("/api/top-of-mind", topOfMindRoutes);

// Group walls of shared signals, and the artifact members co-edit.
app.route("/api/groups", groupsRoutes);

// Reader verdicts that teach the next regeneration.
app.route("/api/feedback", feedbackRoutes);

export const handler = handle(app);

export default app;
