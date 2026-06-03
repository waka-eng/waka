import { Hono, type MiddlewareHandler } from "hono";

import { getDb } from "../lib/db.js";
import {
  buildWhatToBuildDecisionMemoForUser,
  type WhatToBuildDecisionMemo,
} from "../lib/decision-memo.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";

type WakaDb = ReturnType<typeof getDb>;

export interface DecisionMemoRouteDependencies {
  getDatabase?: typeof getDb;
  getDecisionMemo?: (
    db: WakaDb,
    input: { userId: string },
  ) => Promise<WhatToBuildDecisionMemo>;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createDecisionMemoRoutes(
  deps: DecisionMemoRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const getDecisionMemo = deps.getDecisionMemo ?? buildWhatToBuildDecisionMemoForUser;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const userId = c.get("user").id;
    const decisionMemo = await getDecisionMemo(getDatabase(), { userId });
    return c.json({ decisionMemo });
  });

  return routes;
}

export const decisionMemoRoutes = createDecisionMemoRoutes();
