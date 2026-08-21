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
import { profilesRoutes } from "./routes/profiles.js";
import { principlesMarkdownRoutes, principlesRoutes } from "./routes/principles.js";
import { sessionsRoutes } from "./routes/sessions.js";
import { publicProfileRoutes } from "./routes/public-profiles.js";
import { signalsRoutes } from "./routes/signals.js";
import { topOfMindRoutes } from "./routes/top-of-mind.js";

export const app = new Hono();

/**
 * Nothing this API returns may be cached by anything in front of it.
 *
 * Every response here is scoped to one session's profile, so two callers
 * asking the same URL are owed different answers. A shared cache keyed on the
 * URL alone will happily serve one person's answer to another — measured on
 * the deployed stage before this existed: a non-member's 404 for a group wall
 * was served back to the group's own owner, and the same mechanism would have
 * served a member's wall contents to someone who had never joined.
 *
 * `no-store` rather than `no-cache`, because `no-cache` still permits storing
 * a copy to revalidate later, and there is no revalidation any intermediary
 * could perform here that would establish who is asking. `Vary` is belt and
 * braces for a cache that ignores `Cache-Control` but honours a vary key.
 */
app.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store, private");
  c.header("Vary", "Authorization, Cookie");
});

// Liveness probe + capability handshake for external clients (waka-mcp
// validates the API URL against it at login; capabilities let clients
// feature-detect instead of guessing).
app.route("/api/health", healthRoutes);

// Signup, login, session, profile preferences, and the CLI loopback flow.
app.route("/api/auth", authRoutes);

// The memories an account owns — its human profile and any agent profiles.
app.route("/api/profiles", profilesRoutes);
app.route("/api/sessions", sessionsRoutes);
app.route("/api/principles.md", principlesMarkdownRoutes);
app.route("/api/principles", principlesRoutes);

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
