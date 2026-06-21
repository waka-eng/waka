import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { users } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { normalizeSupportedLocale, type SupportedLocale } from "../lib/locales.js";
import {
  normalizePublicHandle,
  validatePublicHandle,
} from "../lib/public-handles.js";
import {
  listTopOfMindNotesForUser,
  type TopOfMindEvidencePreview,
  type TopOfMindNoteSurface,
  type TopOfMindRelatedSignalReference,
} from "./top-of-mind.js";

type WakaDb = ReturnType<typeof getDb>;

const DEFAULT_PUBLIC_TOP_OF_MIND_LIMIT = 12;
const MAX_PUBLIC_TOP_OF_MIND_LIMIT = 24;

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
          .max(
            MAX_PUBLIC_TOP_OF_MIND_LIMIT,
            `limit must be <= ${MAX_PUBLIC_TOP_OF_MIND_LIMIT}`,
          ),
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

export type PublicTopOfMindEvidencePreview = Omit<
  TopOfMindEvidencePreview,
  "signalId"
>;

export type PublicTopOfMindRelatedSignalReference = Omit<
  TopOfMindRelatedSignalReference,
  "id"
>;

export type PublicTopOfMindNoteSurface = Omit<
  TopOfMindNoteSurface,
  | "id"
  | "userId"
  | "relatedSignalIds"
  | "relatedContextNodeIds"
  | "legacy"
  | "evidencePreviews"
  | "relatedSignals"
> & {
  evidencePreviews: PublicTopOfMindEvidencePreview[];
  relatedSignals: PublicTopOfMindRelatedSignalReference[];
};

export interface PublicProfileRouteDependencies {
  getDatabase?: typeof getDb;
  getProfileByHandle?: (
    db: WakaDb,
    handle: string,
  ) => Promise<PublicProfileOwner | null>;
  listNotes?: (
    db: WakaDb,
    input: { userId: string; limit: number; preferredLocale?: SupportedLocale },
  ) => Promise<TopOfMindNoteSurface[]>;
}

async function getPublicProfileByHandle(
  db: WakaDb,
  handle: string,
): Promise<PublicProfileOwner | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      publicHandle: users.publicHandle,
      preferredLocale: users.preferredLocale,
      publicTopOfMindEnabled: users.publicTopOfMindEnabled,
    })
    .from(users)
    .where(
      and(
        eq(users.publicHandle, handle),
        eq(users.publicProfileEnabled, true),
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

function serializePublicTopOfMindNote(
  note: TopOfMindNoteSurface,
): PublicTopOfMindNoteSurface {
  const {
    id: _id,
    userId: _userId,
    relatedSignalIds: _relatedSignalIds,
    relatedContextNodeIds: _relatedContextNodeIds,
    legacy: _legacy,
    evidencePreviews,
    relatedSignals,
    ...surface
  } = note;

  return {
    ...surface,
    evidencePreviews: evidencePreviews.map(({ signalId: _signalId, ...preview }) => preview),
    relatedSignals: relatedSignals.map(({ id: _signalId, ...signal }) => signal),
  };
}

export function createPublicProfileRoutes(
  deps: PublicProfileRouteDependencies = {},
): Hono {
  const routes = new Hono();
  const getDatabase = deps.getDatabase ?? getDb;
  const getProfileByHandle = deps.getProfileByHandle ?? getPublicProfileByHandle;
  const listNotes = deps.listNotes ?? listTopOfMindNotesForUser;

  routes.get("/:handle", async (c) => {
    const parsedParams = publicProfileParamsSchema.safeParse(c.req.param());
    if (!parsedParams.success) {
      return c.json({ error: "Public profile not found" }, 404);
    }

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

    const topOfMindNotes = profile.publicTopOfMindEnabled
      ? await listNotes(db, {
          userId: profile.id,
          limit: parsedQuery.data.limit ?? DEFAULT_PUBLIC_TOP_OF_MIND_LIMIT,
          preferredLocale: profile.preferredLocale,
        })
      : [];

    return c.json({
      profile: {
        name: profile.name,
        handle: profile.publicHandle,
        preferredLocale: profile.preferredLocale,
      },
      topOfMindNotes: topOfMindNotes.map(serializePublicTopOfMindNote),
    });
  });

  return routes;
}

export const publicProfileRoutes = createPublicProfileRoutes();
