/**
 * `/api/experiences` — the named grounds a profile's memories were kept on.
 *
 * Meeting, 2026-08-17: the unit of the memory structure is an EXPERIENCE.
 * This surface is read-only on purpose. An experience is BORN at capture
 * time — find-or-create by name, in the capture's own transaction — because
 * the moment a stretch of work gets its name is the moment a memory from it
 * is kept, not a form filled in beforehand. A create route here would be a
 * second birthplace to keep consistent with the first; a delete route would
 * orphan memories from their ground for tidiness. Neither earns its keep.
 */
import { desc, eq, sql } from "drizzle-orm";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { experiences, inspirations } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { validationDetails } from "../lib/validation.js";
import { resolveTargetProfile } from "./inspirations-tenancy.js";

const listQuerySchema = z
  .object({ profile: z.string().uuid("profile must be a uuid").optional() })
  .strict();

export interface ExperienceView {
  id: string;
  name: string;
  /** How many memories stand on this ground. */
  inspirationCount: number;
  createdAt: string;
}

export interface ExperienceRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createExperienceRoutes(deps: ExperienceRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: "Invalid query", details: validationDetails(parsed.error) },
        400,
      );
    }

    const db = getDatabase();
    const session = c.get("session");
    const target = await resolveTargetProfile(db, session, parsed.data.profile, "read");
    if (!target.ok) return c.json(target.body, target.status);

    /* a join and a group rather than a correlated subquery: the query
       builder renders the subquery's table reference unaliased, which made
       the correlation silently self-referential and every count zero */
    const rows = await db
      .select({
        id: experiences.id,
        name: experiences.name,
        createdAt: experiences.createdAt,
        inspirationCount: sql<number>`count(${inspirations.id})::int`,
      })
      .from(experiences)
      .leftJoin(inspirations, eq(inspirations.experienceId, experiences.id))
      .where(eq(experiences.profileId, target.profileId))
      .groupBy(experiences.id, experiences.name, experiences.createdAt)
      .orderBy(desc(experiences.createdAt));

    const list: ExperienceView[] = rows.map((row) => ({
      id: row.id,
      name: row.name,
      inspirationCount: row.inspirationCount,
      createdAt: row.createdAt.toISOString(),
    }));
    return c.json({ experiences: list });
  });

  return routes;
}

export const experienceRoutes = createExperienceRoutes();
