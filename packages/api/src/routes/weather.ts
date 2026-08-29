/**
 * `/api/weather` — what the loop did, told as days.
 *
 * Two doors on one assembly (`lib/the-weather.ts`):
 *
 *   GET /api/weather      — JSON for the world: the told sentence for the
 *                           caller's away-window (`?since=`), the fortnight
 *                           of days, and the antechamber — the refused
 *                           candidates standing in the dim place, each with
 *                           its anchor.
 *   GET /api/weather.md   — markdown for any other mind: the days only,
 *                           digit-free, one rendering.
 *
 * Both read across profiles under the same matrix as the other layers
 * (`?profile=`), and both write a consultation: the told sentences carry no
 * memory, but the antechamber carries refused candidates — derived readings
 * of the person — and a serve of those answers for itself like any other
 * (goals/no-quiet-corners.md Phase 1 doctrine).
 *
 * Nothing here writes any record the weather tells of. The telling is a
 * view; `the-weather.db.test.ts` proves a deleted record loses its
 * sentence.
 */

import { recordConsultation } from "../lib/consultations.js";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { getDb } from "../lib/db.js";
import { requireAuth, type AuthEnv } from "../lib/middleware.js";
import { assembleTheWeather, renderTheWeather } from "../lib/the-weather.js";
import { validationDetails } from "../lib/validation.js";
import { loadProfileTarget, resolveProfileScope } from "./signals.js";

const weatherQuerySchema = z
  .object({
    profile: z.string().uuid("profile must be a uuid").optional(),
    /** when the caller was last here — RFC3339; absent means no told line */
    since: z
      .string()
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .optional(),
    /** "false" = the telling only: told + days, no antechamber. Event
        counts carry no one's memory, so that serve writes no consultation —
        asking the companion must not inflate its own answer. */
    antechamber: z
      .enum(["true", "false"])
      .transform((value) => value === "true")
      .optional(),
  })
  .strict();

export interface WeatherRouteDependencies {
  getDatabase?: typeof getDb;
  loadProfile?: typeof loadProfileTarget;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
}

export function createWeatherRoute(deps: WeatherRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const loadProfile = deps.loadProfile ?? loadProfileTarget;
  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsed = weatherQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: "Invalid weather query", details: validationDetails(parsed.error) },
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

    const includeAntechamber = parsed.data.antechamber !== false;
    const weather = await assembleTheWeather(db, {
      profileId: scope.profileId,
      since: parsed.data.since ?? null,
      includeAntechamber,
    });
    /* The antechamber carries refused candidates — derived readings of the
       person — so serving it is on the record. The telling alone is event
       counts, and counts of the loop's own moves are the product speaking,
       not anyone's memory being read. */
    if (includeAntechamber) {
      await recordConsultation(db, {
        profileId: scope.profileId,
        session: c.get("session"),
        surface: "weather",
      });
    }
    return c.json({ weather }, 200);
  });

  return routes;
}

export function createWeatherMarkdownRoute(
  deps: WeatherRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const loadProfile = deps.loadProfile ?? loadProfileTarget;
  routes.use("*", deps.authMiddleware ?? requireAuth);

  routes.get("/", async (c) => {
    const parsed = weatherQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: "Invalid weather query", details: validationDetails(parsed.error) },
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

    const weather = await assembleTheWeather(db, { profileId: scope.profileId });
    await recordConsultation(db, {
      profileId: scope.profileId,
      session: c.get("session"),
      surface: "weather",
    });
    return c.text(renderTheWeather(weather), 200, {
      "Content-Type": "text/markdown; charset=utf-8",
    });
  });

  return routes;
}
