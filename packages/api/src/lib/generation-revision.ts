import { and, eq } from "drizzle-orm";
import { generationRevisions, profiles } from "../db/index.js";
import { getDb } from "./db.js";
import type { TopOfMindOwner } from "./top-of-mind-family-lock.js";

type Db = Pick<ReturnType<typeof getDb>, "select">;
export interface GenerationRevision { profileId: string; revision: bigint }

/** Capture BEFORE loading model inputs; text can change back, revision cannot. */
export async function readGenerationRevision(db: Db, owner: TopOfMindOwner): Promise<GenerationRevision | null> {
  const [row] = await db.select({ profileId: generationRevisions.profileId, revision: generationRevisions.revision })
    .from(generationRevisions).innerJoin(profiles, eq(profiles.id, generationRevisions.profileId))
    .where("profileId" in owner ? eq(profiles.id, owner.profileId)
      : and(eq(profiles.groupId, owner.groupId), eq(profiles.type, "group"))).limit(1);
  return row ?? null;
}

/** Final transaction only: mutation triggers wait here until this commit.
 * No source text or provider call is held under this lock. */
export async function assertGenerationRevision(db: Db, expected: GenerationRevision, noWait=false): Promise<void> {
  const [current] = await db.select({ revision: generationRevisions.revision }).from(generationRevisions)
    .where(eq(generationRevisions.profileId, expected.profileId)).for("update",noWait?{noWait:true}:{});
  if (!current || current.revision !== expected.revision) throw new Error("Generation inputs changed; retry current inputs");
}
