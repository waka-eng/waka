/**
 * Inspirations — layer 1, the capture surface.
 *
 *   POST   /api/inspirations                          capture
 *   GET    /api/inspirations                          archive and recall
 *   GET    /api/inspirations/:id                      one capture in full
 *   PATCH  /api/inspirations/:id                      edit text or kind
 *   DELETE /api/inspirations/:id                      delete, cascades below
 *   POST   /api/inspirations/:id/reflections          human Q&A on a capture
 *   GET    /api/inspirations/:id/reflections
 *   DELETE /api/inspirations/:id/reflections/:reflectionId
 *   GET    /api/inspirations/:id/processing            saved material → reading
 *   POST   /api/inspirations/:id/processing/retry      recover failed work
 *   GET    /api/inspirations/save-requests/:requestId  reconcile an authored save
 *
 * An inspiration is whatever arrived — pasted text, a link, an image, an
 * agent's relayed excerpt. It is editable and deletable, and it is never
 * distilled in place: distillation produces signals (layer 2), which cite
 * inspirations as evidence. Editing therefore asks for re-derivation rather
 * than rewriting anything here.
 *
 * Tenancy
 * -------
 * Every statement in this namespace is scoped to one profile, and that profile
 * is chosen by the server. A session acts as exactly one profile by default;
 * the optional `?profile=` parameter names another profile of the *same
 * account* and is checked against the access matrix per operation, so an agent
 * session can read its human's memory but cannot capture into, edit or
 * delete it. A profile in another account is indistinguishable from one that
 * does not exist. See docs/data-model.md, and `inspirations-tenancy.ts` for
 * the one function every handler starts with.
 *
 * Provenance
 * ----------
 * Two facts are kept apart: which session captured the row (the bound profile,
 * which the tenancy rules above already carry) and *whose initiative the
 * content is*. Only the second is stored, as `source`. An agent relaying a
 * person's own words on request writes "app"; an agent logging its own
 * observation writes "agent". A human session's capture is always "app" —
 * a browser cannot claim to be an agent by sending a field.
 *
 * Where the rest of it lives
 * --------------------------
 * This file is the router and nothing else. It was one 1,266-line file until
 * the split, and the reason for splitting it was not the line count: the two
 * questions a reader most often brings here — "what may a client write into a
 * capture" and "what leaves the server" — each had their answer spread across
 * eight handlers, which is how a field gets accepted, or returned, somewhere
 * nobody looked.
 *
 *   `inspirations-validation.ts`     every schema a request is checked against
 *   `inspirations-tenancy.ts`        whose memory, and may this session touch it
 *   `inspirations-serialization.ts`  every field that leaves, named
 *   `lib/inspiration-derivation-requests.ts`  durable layer-2 requests
 *   `inspirations-capture.ts`        POST /
 *   `inspirations-recall.ts`         GET / and GET /:id
 *   `inspirations-editing.ts`        PATCH /:id and DELETE /:id
 *   `inspirations-reflections.ts`    the three /:id/reflections routes
 *   `inspirations-processing.ts`     read-only progress and explicit recovery
 *   `inspirations-save-requests.ts`  committed save lookup and current replay data
 *
 * The handler modules register onto the router built below rather than
 * returning sub-routers of their own. That is deliberate: `Hono.route()` has
 * its own merge semantics for middleware, and the authentication mounted here
 * covers this namespace only because it is `use("*")` on the very instance the
 * handlers attach to. Passing the instance keeps that fact checkable in one
 * place instead of resting on how a framework composes apps.
 */

import { Hono, type MiddlewareHandler } from "hono";

import { getDb } from "../lib/db.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";
import { registerCaptureRoutes } from "./inspirations-capture.js";
import { registerEditingRoutes } from "./inspirations-editing.js";
import { registerRecallRoutes } from "./inspirations-recall.js";
import { registerReflectionRoutes } from "./inspirations-reflections.js";
import { registerProcessingRoutes } from "./inspirations-processing.js";
import { registerSaveRequestRoutes } from './inspirations-save-requests.js';

export type { CreateInspirationInput } from "./inspirations-validation.js";

export interface InspirationsRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createInspirationsRoutes(
  deps: InspirationsRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;

  // Mounted at the router level so an unauthenticated handler cannot reach this
  // namespace by accident. It is registered before any handler on purpose:
  // Hono matches in registration order, so a route added above this line would
  // answer without a session.
  routes.use("*", deps.authMiddleware ?? requireAuth);

  // Registration order is the original file's order, preserved because path
  // matching is order-sensitive. `/:id` is a single segment and cannot swallow
  // `/:id/reflections`, but that is a property of the patterns rather than
  // something to rediscover the next time one changes.
  registerCaptureRoutes(routes, getDatabase);
  registerRecallRoutes(routes, getDatabase);
  registerEditingRoutes(routes, getDatabase);
  registerReflectionRoutes(routes, getDatabase);
  registerProcessingRoutes(routes, getDatabase);
  registerSaveRequestRoutes(routes, getDatabase);

  return routes;
}

export const inspirationsRoutes = createInspirationsRoutes();
