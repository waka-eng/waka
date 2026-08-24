/**
 * `GET /api/export` — everything visible, one door, the person's own hand.
 *
 * goal: no-quiet-corners, Phase 3 (register item 6). The whole human
 * profile as one deterministic bundle — see `lib/profile-export.ts` for
 * what "everything" means and what is deliberately excluded.
 *
 * HUMAN-SESSION-ONLY, and only the session's own profile. An agent-bound
 * credential is refused outright: leaving with the archive is the person's
 * act, never delegated — the permission matrix's read rules govern serving
 * surfaces, and egress is stricter than any serve. No `?profile=`
 * parameter exists here on purpose.
 *
 * The export is itself a consultation (surface `export`): the largest
 * serve there is goes on the record like the smallest.
 */

import { recordConsultation } from "../lib/consultations.js";
import { Hono, type MiddlewareHandler } from "hono";

import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { assembleProfileExport } from "../lib/profile-export.js";

export interface ExportRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createExportRoute(deps: ExportRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const session = c.get("session");
    if (session.profile.type !== "human") {
      return c.json(
        { error: "Export is the person's own door — an agent-bound session cannot open it" },
        403,
      );
    }

    const db = getDatabase();
    const bundle = await assembleProfileExport(db, session.profile.id);
    await recordConsultation(db, {
      profileId: session.profile.id,
      session,
      surface: "export",
    });
    return c.json({ export: bundle }, 200);
  });

  return routes;
}
