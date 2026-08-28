/**
 * The live-grant check the access matrix defers to.
 *
 * Read at request time, every time — revocation must take effect on the
 * next request, so nothing here is cached. One indexed lookup.
 */

import { and, eq, isNull } from "drizzle-orm";

import { agentReadGrants } from "../db/index.js";
import type { getDb } from "./db.js";

type WakaDb = ReturnType<typeof getDb>;

export async function hasLiveSiblingGrant(
  db: WakaDb,
  input: { granteeProfileId: string; targetProfileId: string },
): Promise<boolean> {
  const [row] = await db
    .select({ id: agentReadGrants.id })
    .from(agentReadGrants)
    .where(
      and(
        eq(agentReadGrants.granteeProfileId, input.granteeProfileId),
        eq(agentReadGrants.targetProfileId, input.targetProfileId),
        isNull(agentReadGrants.revokedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}
