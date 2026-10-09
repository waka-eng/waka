/**
 * `GET /api/inspiration-days` — how much was kept on each day.
 *
 * One row per day that has anything on it, newest last. The calendar draws a
 * dot per date and spends `kept` on how brightly it burns, which is the same
 * channel the companion and the field already use: light is the only meaning
 * channel this product has, so a busy day is a BRIGHTER day, never a differently
 * coloured one.
 *
 * DAYS WITH NOTHING ARE ABSENT, NOT ZERO. A quiet day is a real fact and the
 * calendar still draws it — but it draws it from the calendar's own grid, which
 * knows every date in the month whether or not a row exists for it. Sending
 * zeroes would mean sending a row for every day since the account opened to say
 * nothing happened on it.
 *
 * UTC, AND SAID SO. Grouping by local day would need a timezone this server
 * does not have and would quietly move things across midnight for anyone who
 * travels. The caller knows its own offset and can shift the grid; the server
 * reports the fact it actually holds.
 */
import { Hono, type MiddlewareHandler } from "hono";
import { sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { validationDetails } from "../lib/validation.js";
import { loadProfileTarget, resolveProfileScope } from "./signals.js";

/** A year of dots is the most a calendar can show without becoming a chart. */
const DEFAULT_DAYS = 120;
const MAX_DAYS = 400;

const daysQuerySchema = z
  .object({
    days: z
      .string()
      .regex(/^\d+$/, "days must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(z.number().int().min(1).max(MAX_DAYS))
      .optional(),
    profile: z.string().uuid("profile must be a uuid").optional(),
  })
  .strict();

export interface KeptDay {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  kept: number;
}

interface DaysRouteDependencies {
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  getDatabase?: typeof getDb;
  loadProfile?: typeof loadProfileTarget;
}

export function createInspirationDaysRoutes(deps: DaysRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const loadProfile = deps.loadProfile ?? loadProfileTarget;

  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsed = daysQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: "Invalid days query", details: validationDetails(parsed.error) },
        400,
      );
    }

    const db = getDatabase();
    const scope = await resolveProfileScope(
      db,
      c.get("session"),
      parsed.data.profile,
      "read",
      loadProfile,
    );
    if (!scope.ok) return c.json(scope.body, scope.status);

    const days = parsed.data.days ?? DEFAULT_DAYS;
    const rows = await db.execute<{ day: string; kept: number }>(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             count(*)::int AS kept
      FROM inspirations
      WHERE profile_id = ${scope.profileId}::uuid
        AND created_at >= now() - (${days}::int * interval '1 day')
      GROUP BY 1
      ORDER BY 1
    `);

    /* `db.execute` hands back the driver's own row container, which is an
       array on one driver and `{ rows }` on another. Normalising here keeps
       that difference out of the response shape. */
    const list = (Array.isArray(rows) ? rows : (rows as { rows?: KeptDay[] }).rows) ?? [];
    return c.json({ days: list as KeptDay[] }, 200);
  });

  return routes;
}
