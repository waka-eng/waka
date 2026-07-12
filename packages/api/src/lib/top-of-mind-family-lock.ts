import { sql } from "drizzle-orm";

import type { WakaDb } from "./inspiration-embeddings.js";

/**
 * Serializes every mutation of one user's semantic top-of-mind family.
 * hashtextextended returns a collision-resistant signed 64-bit PostgreSQL key.
 */
export async function acquireTopOfMindFamilyLock(
  tx: WakaDb,
  input: { userId: string; semanticKey: string },
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${[
      "waka.top_of_mind_family",
      input.userId,
      input.semanticKey,
    ].join("\n")}, 0))`,
  );
}
