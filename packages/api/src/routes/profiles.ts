/**
 * Profiles: the memories an account owns.
 *
 * Every account has exactly one human profile — its owner's own memory,
 * created with the account and never deletable, because deleting it would
 * leave an account that can sign in but has nowhere to remember. Alongside
 * it sit agent profiles: separate stacks an agent uses as its own working
 * memory rather than as a lens over the person's.
 *
 * Administering profiles is an account-owner act. A human-profile session is
 * that owner; an agent-bound session can see which profiles exist (it needs
 * to know what it may read) but cannot create, rename, or delete one — an
 * agent that could mint itself new memories, or remove the human's, would be
 * administering the account rather than working inside it.
 */

import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { profiles, type Profile } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";
import { validationDetails } from "../lib/validation.js";

/**
 * How many agent profiles one account may hold. The schema supports any
 * number; the product offers a handful. The cap exists so a loop that
 * creates profiles cannot quietly fill a table.
 */
const MAX_AGENT_PROFILES = 8;

const MAX_NAME_LENGTH = 80;

/**
 * A path segment that is not a uuid reaches a uuid column comparison and
 * Postgres raises a cast error — a 500 for what is really a malformed request.
 * Validate the shape first so it answers 400.
 */
const profileIdSchema = z.string().uuid();

const createProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  })
  .strict();

const updateProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(MAX_NAME_LENGTH),
  })
  .strict();

function serializeProfile(profile: Profile) {
  return {
    id: profile.id,
    accountId: profile.accountId,
    type: profile.type,
    name: profile.name,
    avatarUrl: profile.avatarUrl ?? null,
    preferredLocale: profile.preferredLocale,
    createdAt: profile.createdAt.toISOString(),
  };
}

export const profilesRoutes = new Hono<AuthEnv>();

profilesRoutes.use("*", requireAuth);

/** Every profile the account owns, human first. */
profilesRoutes.get("/", async (c) => {
  const session = c.get("session");
  const rows = await getDb()
    .select()
    .from(profiles)
    .where(eq(profiles.accountId, session.profile.accountId))
    .orderBy(profiles.type, profiles.createdAt);

  return c.json({ profiles: rows.map(serializeProfile) });
});

profilesRoutes.post("/", async (c) => {
  const session = c.get("session");
  if (session.profile.type !== "human") {
    return c.json({ error: "Only the account owner can add a profile" }, 403);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = createProfileSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid profile payload", details: validationDetails(parsed.error) },
      400,
    );
  }

  const db = getDb();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(profiles)
    .where(and(eq(profiles.accountId, session.profile.accountId), eq(profiles.type, "agent")));

  if (count >= MAX_AGENT_PROFILES) {
    return c.json({ error: `An account may hold ${MAX_AGENT_PROFILES} agent profiles` }, 409);
  }

  const [created] = await db
    .insert(profiles)
    .values({
      accountId: session.profile.accountId,
      type: "agent",
      name: parsed.data.name,
      // An agent writes in the language its owner reads.
      preferredLocale: session.profile.preferredLocale,
    })
    .returning();

  return c.json({ profile: serializeProfile(created!) }, 201);
});

profilesRoutes.patch("/:profileId", async (c) => {
  const session = c.get("session");
  if (session.profile.type !== "human") {
    return c.json({ error: "Only the account owner can rename a profile" }, 403);
  }
  if (!profileIdSchema.safeParse(c.req.param("profileId")).success) {
    return c.json({ error: "Profile not found" }, 404);
  }

  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return c.json({ error: "Request body must be valid JSON" }, 400);
  }

  const parsed = updateProfileSchema.safeParse(rawBody);
  if (!parsed.success) {
    return c.json(
      { error: "Invalid profile payload", details: validationDetails(parsed.error) },
      400,
    );
  }

  const [updated] = await getDb()
    .update(profiles)
    .set({ name: parsed.data.name, updatedAt: new Date() })
    .where(
      and(
        eq(profiles.id, c.req.param("profileId")),
        eq(profiles.accountId, session.profile.accountId),
      ),
    )
    .returning();

  if (!updated) return c.json({ error: "Profile not found" }, 404);
  return c.json({ profile: serializeProfile(updated) });
});

/**
 * Deleting a profile takes its whole stack with it — every inspiration,
 * signal, and version of its top of mind, by cascade. Only agent profiles
 * can go: the human profile is the account's own memory and outlives
 * everything except the account itself.
 */
profilesRoutes.delete("/:profileId", async (c) => {
  const session = c.get("session");
  if (session.profile.type !== "human") {
    return c.json({ error: "Only the account owner can remove a profile" }, 403);
  }
  if (!profileIdSchema.safeParse(c.req.param("profileId")).success) {
    return c.json({ error: "Profile not found" }, 404);
  }

  const [deleted] = await getDb()
    .delete(profiles)
    .where(
      and(
        eq(profiles.id, c.req.param("profileId")),
        eq(profiles.accountId, session.profile.accountId),
        eq(profiles.type, "agent"),
      ),
    )
    .returning({ id: profiles.id });

  if (!deleted) return c.json({ error: "Profile not found" }, 404);
  return c.json({ id: deleted.id });
});
