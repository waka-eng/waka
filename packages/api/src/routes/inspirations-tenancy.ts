/**
 * Whose memory a request touches, and whether this session may touch it that
 * way.
 *
 * Every inspiration handler begins by calling `resolveTargetProfile`, and none
 * of them may query the `inspirations` table with a profile id from anywhere
 * else. That is the whole tenancy story for layer 1, and it is one function so
 * that a reader can check the story is true by finding its callers rather than
 * by reading eight handlers for a missing `eq(profileId, ...)`.
 *
 * The operation argument matters and is not decorative: an agent session holds
 * "read" and "capture" on its human's profile but not "write", so passing the
 * wrong verb here is how an agent would come to edit or delete a person's
 * memory. Each handler names its verb at the call site for that reason.
 *
 * See docs/data-model.md, "What an agent session may do".
 */

import { eq } from "drizzle-orm";

import { profiles } from "../db/index.js";
import { getDb } from "../lib/db.js";
import { profileAccessError, type ProfileOperation,
  asAccountProfile,
} from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";

export type ProfileResolution =
  | { ok: true; profileId: string }
  | { ok: false; status: 403 | 404; body: { error: string } };

/**
 * Which profile's memory this request touches.
 *
 * Defaults to the session's own profile. A named profile must belong to the
 * same account and must pass the matrix for this operation; a profile in
 * another account answers exactly like one that does not exist, so the
 * parameter cannot be used to discover which accounts hold which profiles.
 */
export async function resolveTargetProfile(
  db: ReturnType<typeof getDb>,
  session: AuthenticatedSession,
  requested: string | undefined,
  operation: ProfileOperation,
): Promise<ProfileResolution> {
  if (!requested || requested === session.profile.id) {
    return { ok: true, profileId: session.profile.id };
  }

  const [row] = await db
    .select({ id: profiles.id, accountId: profiles.accountId, type: profiles.type })
    .from(profiles)
    .where(eq(profiles.id, requested))
    .limit(1);

  /* a room's mind (null account) narrows to nothing and lands in the same
     404 as any profile outside this account — one rule, stated in the type */
  const target = row ? asAccountProfile(row) : null;
  if (!target || target.accountId !== session.profile.accountId) {
    return { ok: false, status: 404, body: { error: "Profile not found" } };
  }

  const denied = await profileAccessError(db, session, target, operation);
  if (denied) return { ok: false, status: 403, body: denied };

  return { ok: true, profileId: target.id };
}
