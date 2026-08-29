/**
 * HTTP handler for the read record — GET /api/consultations.
 *
 * Every serve of derived memory writes a consultation (lib/consultations.ts);
 * until this route, the record could answer for itself only by SQL. This is
 * the account's own view of it: who read whose memory, which surface, when —
 * newest first, across every profile the account holds, because "what have my
 * agents been told?" is an account question, not a per-wall one.
 *
 * `humanSessionsOnly`, deliberately: the record of reads is the owner's audit
 * surface. An agent asking who-read-what is an agent reading the room, and a
 * keeper key is refused twice over (the guard checks `keyScoped`, and the
 * chokepoint allowlist never names this path) — a config-file credential
 * cannot watch the account watching.
 *
 * Read-only, whole and unfiltered by design: the doctrine says the record
 * outlives the credential (null session) and the reader (null profile), so
 * rows here may honestly say "someone". Rendering that as a person's name
 * that no longer exists would be the one dishonest option.
 */
import { desc, eq, inArray } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { z } from "zod";

import { consultations, profiles } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { humanSessionsOnly, requireAuth, type AuthEnv } from "../lib/middleware.js";
import { validationDetails } from "../lib/validation.js";

const MAX_CONSULTATIONS_PAGE = 100;
const DEFAULT_CONSULTATIONS_PAGE = 20;

const listQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(z.number().int().min(1).max(MAX_CONSULTATIONS_PAGE))
      .optional(),
  })
  .strict();

export interface ConsultationView {
  id: string;
  /** Whose memory was served. */
  profile: { id: string; name: string };
  /** Who read it; null once the reader erased their account — "someone". */
  reader: { id: string; name: string } | null;
  surface: string;
  artifactVersion: number | null;
  renderedOn: string | null;
  servedAt: string;
}

export interface ConsultationRouteDependencies {
  getDatabase?: typeof getDb;
  authMiddleware?: typeof requireAuth;
}

export function createConsultationRoutes(
  deps: ConsultationRouteDependencies = {},
): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const getDatabase = deps.getDatabase ?? getDb;

  routes.use("*", deps.authMiddleware ?? requireAuth);
  routes.use("*", humanSessionsOnly);

  // GET /api/consultations — the account's read record, newest first.
  routes.get("/", async (c) => {
    const parsed = listQuerySchema.safeParse(c.req.query());
    if (!parsed.success) {
      return c.json(
        { error: "Invalid query", details: validationDetails(parsed.error) },
        400,
      );
    }
    const limit = parsed.data.limit ?? DEFAULT_CONSULTATIONS_PAGE;

    const db = getDatabase();
    const session = c.get("session");

    const owned = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.accountId, session.profile.accountId));
    const ownedIds = owned.map((row) => row.id);
    if (ownedIds.length === 0) return c.json({ consultations: [] });

    const served = alias(profiles, "served_profiles");
    const reader = alias(profiles, "reader_profiles");
    const rows = await db
      .select({
        id: consultations.id,
        profileId: consultations.profileId,
        profileName: served.name,
        readerProfileId: consultations.readerProfileId,
        readerName: reader.name,
        surface: consultations.surface,
        artifactVersion: consultations.artifactVersion,
        renderedOn: consultations.renderedOn,
        servedAt: consultations.servedAt,
      })
      .from(consultations)
      .innerJoin(served, eq(served.id, consultations.profileId))
      .leftJoin(reader, eq(reader.id, consultations.readerProfileId))
      .where(inArray(consultations.profileId, ownedIds))
      .orderBy(desc(consultations.servedAt), desc(consultations.id))
      .limit(limit);

    const view: ConsultationView[] = rows.map((row) => ({
      id: row.id,
      profile: { id: row.profileId, name: row.profileName },
      reader:
        row.readerProfileId && row.readerName
          ? { id: row.readerProfileId, name: row.readerName }
          : null,
      surface: row.surface,
      artifactVersion: row.artifactVersion,
      renderedOn: row.renderedOn,
      servedAt: row.servedAt.toISOString(),
    }));
    return c.json({ consultations: view });
  });

  return routes;
}

export const consultationRoutes = createConsultationRoutes();
