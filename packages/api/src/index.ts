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

import { createRecallRoutes } from "./routes/recall.js";
import { createSignalDuplicatesRoutes } from "./routes/signal-duplicates.js";
import { Hono } from "hono";
import { handle } from "hono/aws-lambda";

import { adminBackgroundJobsRoutes } from "./routes/admin-background-jobs.js";
import { createAdminLoopHealthRoute } from "./routes/admin-loop-health.js";
import { attachmentsRoutes } from "./routes/attachments.js";
import { authRoutes } from "./routes/auth.js";
import { feedbackRoutes } from "./routes/feedback.js";
import { groupsRoutes } from "./routes/groups.js";
import { healthRoutes } from "./routes/health.js";
import { inspirationsRoutes } from "./routes/inspirations.js";
import { createReviewSessionRoutes } from './routes/review-sessions.js';
import { createConversationRoutes } from './routes/conversations.js';
import { profilesRoutes } from "./routes/profiles.js";
import { principlesMarkdownRoutes, principlesRoutes } from "./routes/principles.js";
import { createAgentGrantRoutes } from "./routes/agent-grants.js";
import { createConsultationRoutes } from "./routes/consultations.js";
import { agentKeyRoutes } from "./routes/agent-keys.js";
import { keeperKeyRoutes } from "./routes/keeper-keys.js";
import { experienceRoutes } from "./routes/experiences.js";
import { graphRoutes } from "./routes/graph.js";
import { createExportRoute } from "./routes/export.js";
import { createReadingRoute } from "./routes/reading.js";
import { createWeatherMarkdownRoute, createWeatherRoute } from "./routes/weather.js";
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
app.route("/api/agent-keys", agentKeyRoutes);
app.route("/api/keeper-keys", keeperKeyRoutes);
app.route("/api/experiences", experienceRoutes);
app.route("/api/graph", graphRoutes);

// The memories an account owns — its human profile and any agent profiles.
app.route("/api/profiles", profilesRoutes);
app.route("/api/sessions", sessionsRoutes);
app.route("/api/principles.md", principlesMarkdownRoutes);
app.route("/api/principles", principlesRoutes);
// How WAKA reads you — the loop's rules, one rendering for every kind of
// mind, pinned by lib/the-reading.test.ts so it cannot drift from the code.
app.route("/api/reading.md", createReadingRoute());
// What the loop did — told as days, a view of stored records only, pinned
// by lib/the-weather.db.test.ts so nothing can be said that a row does not
// back. JSON for the world (told + antechamber), markdown for the wire.
app.route("/api/weather.md", createWeatherMarkdownRoute());
app.route("/api/weather", createWeatherRoute());
// Everything visible: the whole human profile as one deterministic bundle,
// the person's own hand only. The anti-Dreaming — you can leave with it.
app.route("/api/export", createExportRoute());
// The hand on the sibling door: explicit, human-granted, revocable
// agent-to-agent read grants. The open default retired with this route.
app.route("/api/agent-grants", createAgentGrantRoutes());
app.route("/api/consultations", createConsultationRoutes());

// Deliberately unauthenticated: returns only the owner-approved surface.
app.route("/api/public/profiles", publicProfileRoutes);

// Internal/dev-only queue observability. The router applies its own env
// gate, requireAuth, and admin allowlist, so the namespace stays hidden by
// default while still returning 401 for anonymous callers when enabled.
app.route("/api/admin/background-jobs", adminBackgroundJobsRoutes);
app.route("/api/admin/loop-health", createAdminLoopHealthRoute());

// Layer 1 — capture, edit, delete, and search the raw archive.
app.route("/api/inspirations", inspirationsRoutes);
app.route('/api/review-sessions',createReviewSessionRoutes());
app.route('/api/conversations',createConversationRoutes());

// Presigned uploads. The router applies requireAuth at the mount point, so
// no anonymous caller can mint an S3 upload URL.
app.route("/api/attachments", attachmentsRoutes);

// Layer 2 — the evidence-backed patterns WAKA derives, and their shares.
app.route("/api/signals", signalsRoutes);
app.route("/api/recall", createRecallRoutes());
app.route("/api/signal-duplicates", createSignalDuplicatesRoutes());

// Layer 3 — the one live artifact per profile, and its version chain.
app.route("/api/top-of-mind", topOfMindRoutes);

// Group walls of shared signals, and the artifact members co-edit.
app.route("/api/groups", groupsRoutes);

// Reader verdicts that teach the next regeneration.
app.route("/api/feedback", feedbackRoutes);

export const handler = handle(app);

export default app;
