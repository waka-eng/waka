/**
 * `GET /api/reading.md` — how WAKA reads you.
 *
 * The loop's rules, rendered from `lib/the-reading.ts` — the one rendering,
 * pinned by its drift suite so it cannot describe the product wrongly. The
 * same bytes serve every kind of mind: a person's panel fetches this, and an
 * agent may read it to know the contract it is working inside. It describes
 * the product, not any profile, so there is no profile scope and no
 * consultation written — nothing of anyone's memory is served here.
 *
 * Auth is still required: the reading is part of the product's inside, not
 * a public page, and an unauthenticated crawler has no business with it.
 */

import { Hono, type MiddlewareHandler } from "hono";

import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { renderTheReading } from "../lib/the-reading.js";

export interface ReadingRouteDependencies {
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createReadingRoute(deps: ReadingRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", (c) => {
    /* the reading is the session's own surface — no profile parameter — so
       it speaks the acting profile's language */
    const preferred = c.get("session").profile.preferredLocale;
    return c.text(renderTheReading(preferred === "ko-KR" ? "ko-KR" : "en-US"), 200, {
      "Content-Type": "text/markdown; charset=utf-8",
    });
  });

  return routes;
}
