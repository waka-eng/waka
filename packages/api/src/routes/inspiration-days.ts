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
 * name Postgres does not know, or a string not even shaped like a zone name,
 * it is UTC — a calendar a few hours off is better than one that will not
 * load, and the reply says which zone it used so the calendar can match.
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
    /* Read as any string: a zone that is not shaped like one is UTC, never a
       400 — see `zoneShaped`. */
    tz: z.string().optional(),
  })
  .strict();

/* Shaped like `Area/City[/Sub]`, `UTC` or `Etc/GMT+9`. The value is bound as a
   parameter either way; the shape check keeps a typo or a probe from reaching
   Postgres at all, and it falls back to UTC like any unknown zone — a
   calendar that will not load because of its zone is worse than one in UTC. */
const ZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;
export function zoneShaped(tz: string | undefined): string | undefined {
  return tz !== undefined && tz.length <= 64 && ZONE_SHAPE.test(tz) ? tz : undefined;
}

/**
 * OLD NAMES FOR THE SAME PLACE. Browsers still send some zones by the name
 * they had before the IANA database renamed them, and a server's tzdata may
 * hold only one of the two. Each pair is tried both ways: the current name
 * first, then the old one, so either copy of the database answers.
 */
const ZONE_LINKS: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Europe/Kiev": "Europe/Kyiv",
  "Asia/Saigon": "Asia/Ho_Chi_Minh",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon": "Asia/Yangon",
  "America/Buenos_Aires": "America/Argentina/Buenos_Aires",
};
const ZONE_LINKS_BACK = Object.fromEntries(Object.entries(ZONE_LINKS).map(([old, now]) => [now, old]));

/** The names to try for a zone, in order: its current name, then its old one. */
export function zoneCandidates(tz: string): string[] {
  const current = ZONE_LINKS[tz] ?? tz;
  const old = ZONE_LINKS_BACK[current];
  return old && old !== current ? [current, old] : [current];
}

/**
 * The zone to group by: the one asked for if POSTGRES knows it, else UTC.
 *
 * Asked of Postgres, not of `Intl`. They read different copies of the IANA
 * database — Node's ICU and the server's tzdata — and a zone one copy has and
 * the other lacks (a new one, like `America/Ciudad_Juarez`) passed an `Intl`
 * check and then failed `AT TIME ZONE`, a 500 instead of a calendar. The
 * question goes to the one that will do the grouping.
 *
 * `pg_timezone_names` is a scan of the zone files, so each answer is cached —
 * unknown names too, so a probe repeated costs one query. The cache is
 * bounded and simply starts over when full: the names real browsers send are
 * a few hundred, and a stream of invented ones must not grow it without end.
 */
const KNOWN_ZONES = new Map<string, string | null>();
const KNOWN_ZONES_MAX = 512;

/** The zone grouped in, and whether it is UTC only because the one asked
    for was absent, malformed or unknown — said outright, so a client never
    has to guess from a name that may have been canonicalized
    (`Asia/Calcutta` asked, `Asia/Kolkata` used: not a fallback). */
async function groupingZone(
  db: ReturnType<typeof getDb>,
  tz: string | undefined,
): Promise<{ zone: string; fallback: boolean }> {
  if (!tz) return { zone: "UTC", fallback: true };
  if (tz === "UTC") return { zone: "UTC", fallback: false };
  let known = KNOWN_ZONES.get(tz);
  if (known === undefined) {
    known = null;
    for (const name of zoneCandidates(tz)) {
      /* The exact name first; a name that differs only in case is the same
         zone, and the one Postgres spells is the one used and said back. */
      const rows = await db.execute<{ name: string }>(sql`
        SELECT name FROM pg_timezone_names WHERE lower(name) = lower(${name})
        ORDER BY (name = ${name}) DESC LIMIT 1`);
      const list = ((Array.isArray(rows) ? rows : (rows as { rows?: unknown[] }).rows) ?? []) as Array<{ name: string }>;
      if (list[0]) { known = list[0].name; break; }
    }
    if (KNOWN_ZONES.size >= KNOWN_ZONES_MAX) KNOWN_ZONES.clear();
    KNOWN_ZONES.set(tz, known);
  }
  return known ? { zone: known, fallback: false } : { zone: "UTC", fallback: true };
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
    const { zone, fallback } = await groupingZone(db, zoneShaped(parsed.data.tz));
    const rows = await db.execute<{ day: string; kept: number }>(sql`
      SELECT to_char(date_trunc('day', created_at AT TIME ZONE ${zone}::text), 'YYYY-MM-DD') AS day,
             count(*)::int AS kept
      FROM inspirations
      WHERE profile_id = ${scope.profileId}::uuid
        /* FROM LOCAL MIDNIGHT OF THE OLDEST DAY, not "N times 24 hours ago".
           The calendar's cells are whole local dates — today and the N-1
           before it — and a window measured from this instant started part
           way through a date, so the oldest cell counted only its later
           hours (and a daylight-saving change shifted the cut by an hour). */
        AND created_at >= (date_trunc('day', now() AT TIME ZONE ${zone}::text)
                           - ((${days}::int - 1) * interval '1 day')) AT TIME ZONE ${zone}::text
      GROUP BY 1
      ORDER BY 1
    `);

    /* `db.execute` hands back the driver's own row container, which is an
       array on one driver and `{ rows }` on another. Normalising here keeps
       that difference out of the response shape. */
    const list = (Array.isArray(rows) ? rows : (rows as { rows?: KeptDay[] }).rows) ?? [];
    /* THE ZONE ACTUALLY USED, said back. A zone Postgres did not know fell
       back to UTC, and a client that went on drawing its own local dates
       put every count on the wrong cell for part of the day. */
    return c.json({ days: list as KeptDay[], zone, fallback }, 200);
  });

  return routes;
}
