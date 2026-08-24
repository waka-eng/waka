/**
 * Asking layer 2 to catch up with a change at layer 1.
 *
 * Capture, edit and reflection all end the same way: the signals this capture
 * supports need re-deriving. The rule they share — that asking must never fail
 * the write — is the reason this is one function and not three inline
 * `.catch()` blocks that could quietly stop agreeing with each other.
 */

import { and, eq } from "drizzle-orm";

import {
  groupMembers,
  inspirations,
  profiles,
  type DeriveSignalsPayload,
} from "../db/index.js";
import { getDb } from "../lib/db.js";
import { enqueueDeriveSignals } from "../lib/queue.js";

/**
 * Ask for the signals this capture supports to be derived, and never let that
 * request fail the write.
 *
 * The capture is already durable by the time this runs: answering 5xx because
 * a queue insert failed would invite a retry, and the retry would be a second
 * capture of the same thing. A missed enqueue is visible in the logs and
 * recoverable; a duplicated memory is neither.
 */
export function requestSignalDerivation(input: {
  profileId: string;
  inspirationId: string;
  reason: DeriveSignalsPayload["reason"];
}): Promise<void> {
  return enqueueDeriveSignals(input.profileId, input.inspirationId, input.reason)
    .then(() => fanOutToGroups(input))
    .catch((err: unknown) => {
      console.error("[inspirations] failed to enqueue signal derivation:", {
        inspirationId: input.inspirationId,
        reason: input.reason,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * THE SAME CAPTURE, READ BY EVERY ROOM IT STANDS IN (2026-08-24).
 *
 * A public memory is on the ground of every room its keeper belongs to —
 * one switch, all rooms, by ruling — and a room distils from its own
 * ground. So a keep that is public asks for one more derivation pass PER
 * ROOM, each landing on that room's mind, each job still OWNED by the
 * keeper: the model budget and the queue's fairness bill the person whose
 * keep asked for the work, and a room is not an unmetered path to the key.
 *
 * Visibility is read from the row rather than trusted from a caller: the
 * three callers (capture, edit, reflection) would each have to carry it,
 * and the one that forgot would silently derive private memories into
 * rooms — the exact failure a read here makes impossible. A private keep
 * costs one SELECT and fans out to nothing.
 */
async function fanOutToGroups(input: {
  profileId: string;
  inspirationId: string;
  reason: DeriveSignalsPayload["reason"];
}): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ visibility: inspirations.visibility })
    .from(inspirations)
    .where(eq(inspirations.id, input.inspirationId))
    .limit(1);
  if (row?.visibility !== "public") return;

  const minds = await db
    .select({ mindProfileId: profiles.id })
    .from(groupMembers)
    .innerJoin(
      profiles,
      and(eq(profiles.groupId, groupMembers.groupId), eq(profiles.type, "group")),
    )
    .where(eq(groupMembers.profileId, input.profileId));

  for (const mind of minds) {
    await enqueueDeriveSignals(
      input.profileId,
      input.inspirationId,
      input.reason,
      mind.mindProfileId,
    );
  }
}
