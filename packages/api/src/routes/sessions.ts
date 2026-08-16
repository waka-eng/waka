/**
 * Sessions: the machines currently holding a credential for this account.
 *
 * A session is not an API key. It is a signed token bound to exactly one
 * profile, expiring on its own, and the database keeps only a hash of it —
 * so nothing here can hand a token back, and "show me my key" is a question
 * this surface deliberately cannot answer. What it can answer is which
 * connections exist, what each one acts as, and when it was last used.
 *
 * Listing and revoking are account-owner acts, like administering profiles:
 * a human-profile session may see and end any connection in the account, and
 * an agent-bound session may do neither. An agent that could revoke its
 * owner's browser session would be administering the account rather than
 * working inside it — and one that could enumerate connections would be
 * reporting on the person rather than remembering for them.
 */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { profiles, sessions } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { type AuthEnv, requireAuth } from "../lib/middleware.js";

const sessionIdSchema = z.string().uuid();

export const sessionsRoutes = new Hono<AuthEnv>();

sessionsRoutes.use("*", requireAuth);

/**
 * Every live connection to this account, newest first.
 *
 * `current` marks the one making the request, so a client can say "this
 * device" rather than inviting someone to guess which row will log them out.
 */
sessionsRoutes.get("/", async (c) => {
  const session = c.get("session");
  if (session.profile.type !== "human") {
    return c.json({ error: "Only the account owner can see connections" }, 403);
  }

  const rows = await getDb()
    .select({
      id: sessions.id,
      deviceLabel: sessions.deviceLabel,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      expiresAt: sessions.expiresAt,
      profileId: profiles.id,
      profileName: profiles.name,
      profileType: profiles.type,
    })
    .from(sessions)
    .innerJoin(profiles, eq(profiles.id, sessions.profileId))
    .where(eq(profiles.accountId, session.profile.accountId))
    .orderBy(desc(sessions.lastSeenAt));

  return c.json({
    sessions: rows.map((row) => ({
      id: row.id,
      deviceLabel: row.deviceLabel,
      profile: { id: row.profileId, name: row.profileName, type: row.profileType },
      current: row.id === session.sessionId,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    })),
  });
});

/**
 * End one connection.
 *
 * Deleting the row is the revocation: the token stays syntactically valid
 * until it expires, and the lookup that would accept it finds nothing. That
 * is the whole reason a hash row exists beside a self-contained token.
 *
 * Revoking the current session is allowed and is simply a logout from
 * elsewhere — refusing it would mean the one device you are holding is the
 * one you cannot cut off, which is backwards when the reason to revoke is
 * usually that a device is no longer yours.
 */
sessionsRoutes.delete("/:sessionId", async (c) => {
  const session = c.get("session");
  if (session.profile.type !== "human") {
    return c.json({ error: "Only the account owner can end a connection" }, 403);
  }
  if (!sessionIdSchema.safeParse(c.req.param("sessionId")).success) {
    return c.json({ error: "Connection not found" }, 404);
  }

  const db = getDb();
  // Scoped through the profile join so one account cannot end another's
  // connection, and so an unknown id and someone else's id answer alike.
  const [target] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .innerJoin(profiles, eq(profiles.id, sessions.profileId))
    .where(
      and(
        eq(sessions.id, c.req.param("sessionId")),
        eq(profiles.accountId, session.profile.accountId),
      ),
    )
    .limit(1);
  if (!target) return c.json({ error: "Connection not found" }, 404);

  await db.delete(sessions).where(eq(sessions.id, target.id));
  return c.json({ id: target.id, endedCurrent: target.id === session.sessionId });
});
