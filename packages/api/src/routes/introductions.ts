/**
 * /api/introductions — two consenting people whose principles overlap
 * (design "Agent introductions", approved 2026-11-27). See `lib/introductions.ts`
 * for the privacy model; this file is the door.
 *
 *   GET  /api/introductions                 what this person may see now
 *   POST /api/introductions/consent         { enabled }   Introduce us / Not now / Settings
 *   POST /api/introductions/:id/answer      { answer: "yes" | "no" }
 *   POST /api/introductions/:id/seen        Done on an introduction
 *
 * A PERSON'S DECISION, NEVER AN AGENT'S. Every route sits behind
 * `humanSessionsOnly`, which refuses agent-bound sessions and key-scoped
 * (MCP) sessions alike; the keeper key's allowlist does not name this path
 * either, so an MCP key is refused at the door and again here. There is no
 * `?profile=`: the session's own profile is the only one these routes act
 * for, and a row that does not involve it answers 404, as a missing one does.
 */
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import { getDb } from "../lib/db.js";
import {
  answerIntroduction,
  introductionsAvailable,
  markIntroductionSeen,
  readIntroductionState,
  setIntroductionConsent,
  type FollowUp,
} from "../lib/introductions.js";
import { humanSessionsOnly, requireAuth, type AuthEnv } from "../lib/middleware.js";
import { drainIntroductionFollowUps, enqueueIntroductionMatch } from "../lib/queue.js";

const consentSchema = z.object({ enabled: z.boolean() }).strict();
const answerSchema = z.object({ answer: z.enum(["yes", "no"]) }).strict();
const NOT_AVAILABLE = { error: "Introductions are not available" } as const;

export interface IntroductionRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: MiddlewareHandler<AuthEnv>;
  available?: () => boolean;
  requestMatch?: (followUp: FollowUp) => Promise<unknown>;
}

export function createIntroductionRoutes(deps: IntroductionRouteDependencies = {}): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;
  const available = deps.available ?? (() => introductionsAvailable());
  const requestMatch = deps.requestMatch ?? ((followUp: FollowUp) => enqueueIntroductionMatch(followUp));
  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", humanSessionsOnly);
  routes.use("*", async (c, next) => { c.header("Cache-Control", "private, no-store"); await next(); });

  const readBody = async <T>(c: { req: { json: () => Promise<unknown> } }, schema: z.ZodType<T>): Promise<T | null> => {
    try { const parsed = schema.safeParse(await c.req.json()); return parsed.success ? parsed.data : null; } catch { return null; }
  };
  /* Asking for a match never fails the person's own act: the row is theirs
     either way, and the next answer or switch asks again. */
  const askForMatch = async (followUps: FollowUp[]) => {
    if (!available()) return;
    for (const followUp of followUps) await requestMatch(followUp).catch(() => null);
  };

  routes.get("/", async (c) => {
    if (available()) await drainIntroductionFollowUps().catch(() => 0);
    return c.json(await readIntroductionState(getDatabase(), c.get("session").profile.id, available()));
  });

  routes.post("/consent", async (c) => {
    const body = await readBody(c, consentSchema);
    if (!body) return c.json({ error: "Invalid introduction consent" }, 400);
    /* Turning it off is always possible, even where the feature is not
       offered: withdrawing consent must never depend on a flag. */
    if (body.enabled && !available()) return c.json(NOT_AVAILABLE, 404);
    const profileId = c.get("session").profile.id;
    /* On: a pass for this person. Off: a pass for anyone an unseen
       introduction with this person was closed on, who is free again. */
    await askForMatch(await setIntroductionConsent(getDatabase(), profileId, body.enabled));
    return c.json({ enabled: body.enabled });
  });

  routes.post("/:id/answer", async (c) => {
    if (!available()) return c.json(NOT_AVAILABLE, 404);
    const id = z.string().uuid().safeParse(c.req.param("id"));
    const body = await readBody(c, answerSchema);
    if (!id.success || !body) return c.json({ error: "Invalid introduction answer" }, 400);
    const profileId = c.get("session").profile.id;
    const outcome = await answerIntroduction(getDatabase(), profileId, id.data, body.answer);
    if (!outcome.ok) {
      return outcome.status === 404 ? c.json({ error: "Introduction not found" }, 404) : c.json({ error: "That introduction is no longer open" }, 409);
    }
    await askForMatch(outcome.followUps);
    return c.json(outcome.result);
  });

  routes.post("/:id/seen", async (c) => {
    if (!available()) return c.json(NOT_AVAILABLE, 404);
    const id = z.string().uuid().safeParse(c.req.param("id"));
    if (!id.success) return c.json({ error: "Invalid introduction" }, 400);
    const profileId = c.get("session").profile.id;
    if (!(await markIntroductionSeen(getDatabase(), profileId, id.data))) return c.json({ error: "Introduction not found" }, 404);
    await askForMatch([{ profileId, key: "now" }]);
    return c.json({ seen: true });
  });

  return routes;
}

export const introductionRoutes = createIntroductionRoutes();
