import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";

import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import {
  buildTopOfMindPreviewForUser,
  type TopOfMindPreview,
} from "../lib/top-of-mind-preview.js";

export interface TopOfMindRouteDependencies {
  getDatabase?: typeof getDb;
  getTopOfMind?: (db: ReturnType<typeof getDb>, userId: string) => Promise<TopOfMindPreview>;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createTopOfMindRoutes(
  deps: TopOfMindRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const getTopOfMind = deps.getTopOfMind ?? buildTopOfMindPreviewForUser;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const userId = c.get("user").id;
    const topOfMind = await getTopOfMind(getDatabase(), userId);
    return c.json({ topOfMind });
  });

  return routes;
}

export const topOfMindRoutes = createTopOfMindRoutes();
