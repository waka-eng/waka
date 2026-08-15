/**
 * Serializes every mutation of one owner's top-of-mind artifact family.
 *
 * The database already guarantees at most one *live* artifact per profile and
 * per group (partial unique indexes). That constraint turns a concurrent
 * refresh into a failed insert, which is safe but wasteful: two workers pay
 * for two syntheses and one of them throws. Taking the advisory lock first
 * makes the second worker wait, read the version the first one wrote, and
 * decide against it.
 *
 * `pg_advisory_xact_lock` releases with the transaction — there is no unlock
 * path to forget, and a crashed worker cannot leave the family wedged.
 * `hashtextextended` gives the collision-resistant signed 64-bit key the
 * function requires.
 */

import { sql, type SQL } from "drizzle-orm";

/** Anything that can run SQL: the pool handle or a transaction handle. */
interface SqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

/** Exactly one of the two, mirroring the artifact's ownership CHECK. */
export type TopOfMindOwner = { profileId: string } | { groupId: string };

export async function acquireTopOfMindArtifactLock(
  tx: SqlExecutor,
  owner: TopOfMindOwner,
): Promise<void> {
  const key =
    "profileId" in owner
      ? ["waka.top_of_mind", "profile", owner.profileId]
      : ["waka.top_of_mind", "group", owner.groupId];

  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${key.join("\n")}, 0))`,
  );
}
