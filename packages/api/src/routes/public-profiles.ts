/**
 * The public profile surface.
 *
 * One unauthenticated route: `GET /api/public/profiles/:handle`. It answers
 * with a profile's display identity and, when that profile has opted in, the
 * entries of its live top of mind.
 *
 * Nobody is authenticated here, so the rules are the strict ones:
 *
 *   - **Inspirations never appear.** Raw captures are private to the owning
 *     account, full stop — this file does not read that table at all.
 *   - **Signals never appear.** A top-of-mind entry rests on signals, but the
 *     evidence stays behind; only the synthesized entry is public.
 *   - **No identifiers leave.** Profile, artifact, entry, and signal ids stay
 *     server-side; a public reader gets prose and nothing to correlate.
 *   - Two flags gate it: `publicProfileEnabled` for the page itself and
 *     `publicTopOfMindEnabled` for the artifact. Enabling the page does not
 *     imply publishing what is on your mind.
 */

import { and, asc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  profiles,
  topOfMindEntries,
  topOfMinds,
  type TopOfMindEntryType,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { normalizeSupportedLocale, type SupportedLocale } from "../lib/locales.js";
import {
  normalizePublicHandle,
  validatePublicHandle,
} from "../lib/public-handles.js";

type WakaDb = ReturnType<typeof getDb>;

const DEFAULT_PUBLIC_ENTRY_LIMIT = 12;
const MAX_PUBLIC_ENTRY_LIMIT = 24;

const publicProfileParamsSchema = z
  .object({
    handle: z.string().min(1),
  })
  .strict();

const publicProfileQuerySchema = z
  .object({
    limit: z
      .string()
      .regex(/^\d+$/, "limit must be an integer")
      .transform((value) => Number.parseInt(value, 10))
      .pipe(
        z
          .number()
          .int("limit must be an integer")
          .min(1, "limit must be at least 1")
          .max(MAX_PUBLIC_ENTRY_LIMIT, `limit must be <= ${MAX_PUBLIC_ENTRY_LIMIT}`),
      )
      .optional(),
  })
  .strict();

export interface PublicProfileOwner {
  id: string;
  name: string;
  publicHandle: string;
  preferredLocale: SupportedLocale;
  publicTopOfMindEnabled: boolean;
}

/** One entry of the artifact, stripped to what a stranger may read. */
export interface PublicTopOfMindEntry {
  type: TopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  pinned: boolean;
}

export interface PublicTopOfMind {
  version: number;
  publishedAt: string;
  entries: PublicTopOfMindEntry[];
}

export interface PublicProfileRouteDependencies {
  getDatabase?: typeof getDb;
  getProfileByHandle?: (
    db: WakaDb,
    handle: string,
  ) => Promise<PublicProfileOwner | null>;
  getTopOfMind?: (
    db: WakaDb,
    input: { profileId: string; limit: number },
  ) => Promise<PublicTopOfMind | null>;
}

async function getPublicProfileByHandle(
  db: WakaDb,
  handle: string,
): Promise<PublicProfileOwner | null> {
  const [row] = await db
    .select({
      id: profiles.id,
      name: profiles.name,
      publicHandle: profiles.publicHandle,
      preferredLocale: profiles.preferredLocale,
      publicTopOfMindEnabled: profiles.publicTopOfMindEnabled,
    })
    .from(profiles)
    .where(
      and(
        /* AND A PERSON'S, NEVER AN AGENT'S. The handle columns live on every
           profile, so an agent switched public was reachable here exactly like
           a human one — publishing an account's memory to anyone with the URL.
           A public profile is a person choosing to be found. */
        eq(profiles.type, "human"),
        eq(profiles.publicHandle, handle),
        eq(profiles.publicProfileEnabled, true),
      ),
    )
    .limit(1);

  if (!row?.publicHandle) return null;

  return {
    id: row.id,
    name: row.name,
    publicHandle: row.publicHandle,
    preferredLocale: normalizeSupportedLocale(row.preferredLocale),
    publicTopOfMindEnabled: row.publicTopOfMindEnabled,
  };
}

/**
 * The profile's current artifact, in display order.
 *
 * Only the `live` version is readable: superseded versions are history, and
 * history is nobody else's business. Dismissed entries are excluded in SQL
 * rather than filtered afterwards — a dismissal is the owner saying "not
 * this", and the row should never travel far enough to be dropped by mistake.
 *
 * Returns null when there is nothing to show, so a page with an emptied
 * artifact renders as "no public top of mind" instead of an empty frame.
 */
async function getPublicTopOfMind(
  db: WakaDb,
  input: { profileId: string; limit: number },
): Promise<PublicTopOfMind | null> {
  const rows = await db
    .select({
      version: topOfMinds.version,
      publishedAt: topOfMinds.createdAt,
      type: topOfMindEntries.type,
      body: topOfMindEntries.body,
      belief: topOfMindEntries.belief,
      prompt: topOfMindEntries.prompt,
      pinnedAt: topOfMindEntries.pinnedAt,
    })
    .from(topOfMinds)
    .innerJoin(topOfMindEntries, eq(topOfMindEntries.topOfMindId, topOfMinds.id))
    .where(
      and(
        eq(topOfMinds.profileId, input.profileId),
        eq(topOfMinds.status, "live"),
        isNull(topOfMindEntries.dismissedAt),
      ),
    )
    .orderBy(asc(topOfMindEntries.sortOrder))
    .limit(input.limit);

  const first = rows[0];
  if (!first) return null;

  return {
    version: first.version,
    publishedAt: first.publishedAt.toISOString(),
    entries: rows.map((row) => ({
      type: row.type,
      body: row.body,
      belief: row.belief ?? null,
      prompt: row.prompt ?? null,
      pinned: row.pinnedAt !== null,
    })),
  };
}

export function createPublicProfileRoutes(
  deps: PublicProfileRouteDependencies = {},
): Hono {
  const routes = new Hono();
  const getDatabase = deps.getDatabase ?? getDb;
  const getProfileByHandle = deps.getProfileByHandle ?? getPublicProfileByHandle;
  const getTopOfMind = deps.getTopOfMind ?? getPublicTopOfMind;

  routes.get("/:handle", async (c) => {
    const parsedParams = publicProfileParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json({ error: "Public profile not found" }, 404);
    }

    // A handle that could never be stored cannot match a row, so it is
    // answered as a miss without touching the database.
    const normalizedHandle = normalizePublicHandle(parsedParams.data.handle);
    if (validatePublicHandle(normalizedHandle)) {
      return c.json({ error: "Public profile not found" }, 404);
    }

    const parsedQuery = publicProfileQuerySchema.safeParse(c.req.query());
    if (!parsedQuery.success) {
      return c.json(
        {
          error: "Invalid public profile query",
          details: parsedQuery.error.flatten().fieldErrors,
        },
        400,
      );
    }

    const db = getDatabase();
    const profile = await getProfileByHandle(db, normalizedHandle);
    if (!profile) {
      return c.json({ error: "Public profile not found" }, 404);
    }

    const topOfMind = profile.publicTopOfMindEnabled
      ? await getTopOfMind(db, {
          profileId: profile.id,
          limit: parsedQuery.data.limit ?? DEFAULT_PUBLIC_ENTRY_LIMIT,
        })
      : null;

    return c.json({
      profile: {
        name: profile.name,
        handle: profile.publicHandle,
        preferredLocale: profile.preferredLocale,
      },
      topOfMind,
    });
  });

  return routes;
}

export const publicProfileRoutes = createPublicProfileRoutes();
