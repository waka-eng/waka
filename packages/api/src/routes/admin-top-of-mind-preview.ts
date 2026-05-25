/**
 * Internal/dev-only top-of-mind preview API.
 *
 * This turns the current meaning graph into a deterministic admin preview of
 * what the user-facing top-of-mind experience could say.
 */

import { Hono, type MiddlewareHandler } from "hono";

import {
  buildTopOfMindPreviewForUser,
  type TopOfMindPreview,
} from "../lib/top-of-mind-preview.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";
import { requireAdminMeaningGraphEnabled } from "./admin-meaning-graph.js";

export interface AdminTopOfMindPreviewRouteDependencies {
  getDatabase?: typeof getDb;
  getPreview?: (db: ReturnType<typeof getDb>, userId: string) => Promise<TopOfMindPreview>;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  adminGate?: MiddlewareHandler<AuthEnv>;
}

export function createAdminTopOfMindPreviewRoutes(
  deps: AdminTopOfMindPreviewRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const getPreview = deps.getPreview ?? buildTopOfMindPreviewForUser;

  routes.use("*", deps.adminGate ?? requireAdminMeaningGraphEnabled);
  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const userId = c.get("user").id;
    const preview = await getPreview(getDatabase(), userId);
    return c.json({ preview });
  });

  return routes;
}

export const adminTopOfMindPreviewRoutes = createAdminTopOfMindPreviewRoutes();
