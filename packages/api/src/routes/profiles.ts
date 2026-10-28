import { attachments, deletedInspirations } from '../db/index.js';
import { sweepAttachmentObjects } from '../lib/attachment-sweep.js';
import { unreferencedAttachmentKeys } from '../lib/conversation-attachments.js';
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
 * that owner; an agent-bound session sees only its own profile and cannot
 * create, rename, or delete one — an
 * agent that could mint itself new memories, or remove the human's, would be
 * administering the account rather than working inside it.
 */

import { and, eq, sql, getTableColumns } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { profiles, type Profile } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, humanSessionsOnly, requireAuth } from "../lib/middleware.js";
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

/** Account owners see every profile; restricted credentials see only their own. */
profilesRoutes.get("/", async (c) => {
  const session = c.get("session");
  const rows = await getDb()
    .select({ ...getTableColumns(profiles), hasInspirations: sql<boolean>`exists (select 1 from inspirations i where i.profile_id = profiles.id)` })
    .from(profiles)
    .where(and(eq(profiles.accountId, session.profile.accountId),
      session.profile.type === "agent" || session.keyScoped ? eq(profiles.id, session.profile.id) : undefined))
    .orderBy(profiles.type, profiles.createdAt);

  return c.json({ profiles: rows.map(row => ({ ...serializeProfile(row), hasInspirations: row.hasInspirations })) });
});

/*
 * ADDING, RENAMING, AND REMOVING A MEMORY ARE ACCOUNT-OWNER ACTS, and the
 * three handlers below say so with the shared middleware rather than with a
 * profile-type comparison of their own. The comparison they used to write was
 * true for a keeper key — a credential in a config file, bound to the human
 * profile — so a stolen MCP config could have minted itself memories and
 * deleted the person's. See `humanSessionsOnly` in lib/middleware.ts for why
 * the inline form kept losing its `keyScoped` half.
 *
 * GET stays open to an agent session, scoped to that session’s own profile.
 */
profilesRoutes.post("/", humanSessionsOnly, async (c) => {
  const session = c.get("session");
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
  const created = await db.transaction(async tx => {
    // Serialize with language changes and other creations. A stale auth snapshot
    // must not give a new agent the owner's previous language.
    const [owner] = await tx.select({ preferredLocale: profiles.preferredLocale }).from(profiles)
      .where(eq(profiles.id, session.profile.id)).for('update');
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(profiles)
      .where(and(eq(profiles.accountId, session.profile.accountId), eq(profiles.type, "agent")));

    if (count >= MAX_AGENT_PROFILES) {
      return null;
    }

    const [created] = await tx
      .insert(profiles)
      .values({
        accountId: session.profile.accountId,
        type: "agent",
        name: parsed.data.name,
        // An agent writes in the language its owner reads.
        preferredLocale: owner.preferredLocale,
      })
      .returning();
    return created;
  });

  if (!created) return c.json({ error: `An account may hold ${MAX_AGENT_PROFILES} agent profiles` }, 409);

  return c.json({ profile: serializeProfile(created!) }, 201);
});

profilesRoutes.patch("/:profileId", humanSessionsOnly, async (c) => {
  const session = c.get("session");
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
profilesRoutes.delete("/:profileId", humanSessionsOnly, async (c) => {
  const session = c.get("session");
  if (!profileIdSchema.safeParse(c.req.param("profileId")).success) {
    return c.json({ error: "Profile not found" }, 404);
  }

  const db = getDb();
  const deleted = await db.transaction(async tx => {
    const [profile] = await tx.select({ id: profiles.id }).from(profiles)
      .where(and(eq(profiles.id, c.req.param("profileId")), eq(profiles.accountId, session.profile.accountId), eq(profiles.type, "agent"))).for("update");
    if (!profile) return null;
    const live = await tx.select({ s3Key: attachments.s3Key }).from(attachments).where(eq(attachments.profileId, profile.id));
    const copies = await tx.select({ attachments: deletedInspirations.attachments }).from(deletedInspirations).where(eq(deletedInspirations.profileId, profile.id));
    const keys = [...live, ...copies.flatMap(row => row.attachments)].flatMap(row => row.s3Key ? [row.s3Key] : []);
    await tx.delete(profiles).where(eq(profiles.id, profile.id));
    return { id: profile.id, keys };
  });
  if (deleted) await sweepAttachmentObjects(await unreferencedAttachmentKeys(db, deleted.keys));

  if (!deleted) return c.json({ error: "Profile not found" }, 404);
  return c.json({ id: deleted.id });
});
