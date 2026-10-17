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
 * THE CALLER'S DAY, NOT GREENWICH'S. This used to group by UTC on the theory
 * that the caller could shift the grid — but a count per UTC date cannot be
 * shifted into a count per Seoul date (a day's saves straddle two UTC dates),
 * so a Korean evening's keeps were drawn on the day before. The caller now
 * sends its IANA zone as `tz` and the grouping happens there. Absent, or a
 * name this runtime does not know, it is UTC — a calendar a few hours off is
 * better than one that will not load. A string that is not even shaped like a
 * zone name is refused, since nothing that sends it is a browser.
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
    /* Shaped like `Area/City[/Sub]`, `UTC` or `Etc/GMT+9`. The value is bound
       as a parameter either way; the shape check is so a typo or a probe is a
       400 rather than a Postgres error. */
    tz: z
      .string()
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/, "tz must be an IANA zone name")
      .optional(),
  })
  .strict();

/**
 * The zone to group by: the one asked for if this runtime knows it, else UTC.
 *
 * `Intl` and Postgres both read the IANA database, so a name one knows the
 * other does; asking `Intl` keeps an unknown name from reaching `AT TIME ZONE`,
 * where it would be a 500 instead of a calendar.
 */
export function groupingZone(tz: string | undefined): string {
  if (!tz) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

export interface KeptDay {
  /** `YYYY-MM-DD`, in the zone the request named (UTC when it named none). */
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
    const zone = groupingZone(parsed.data.tz);
    const rows = await db.execute<{ day: string; kept: number }>(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${zone}::text), 'YYYY-MM-DD') AS day,
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
