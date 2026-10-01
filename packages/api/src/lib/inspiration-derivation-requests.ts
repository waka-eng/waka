/** Persist learning work in the transaction that changes its source. Failure
 * aborts that write; model/wake failures occur only after the words are saved. */
import { and, eq } from "drizzle-orm";
import { groupMembers, inspirations, profiles, type DeriveSignalsPayload } from "../db/index.js";
import { getDb } from "./db.js";
import { enqueueDeriveSignals, enqueueGroupTopOfMindRefresh } from "./queue.js";
import { InspirationProcessingUnavailableError } from "./inspiration-processing.js";

type SourceTransaction = Pick<ReturnType<typeof getDb>, "select" | "execute" | "transaction">;

export async function requestSignalDerivation(input: {
  profileId: string;
  inspirationId: string;
  reason: DeriveSignalsPayload["reason"];
  /** Private answers never change a room's input projection. */
  changedSource: "inspiration" | "reflection";
  previousVisibility?: "private" | "public";
}, transaction: SourceTransaction) {
  const personal = await enqueueDeriveSignals(input.profileId, input.inspirationId, input.reason, undefined, transaction);
  const groupJobIds: string[] = [];
  if (input.changedSource === "inspiration") {
    // Do not trust a caller's visibility or membership snapshot for fan-out.
    const [source] = await transaction.select({ visibility: inspirations.visibility }).from(inspirations)
      .where(and(eq(inspirations.id, input.inspirationId), eq(inspirations.profileId, input.profileId))).limit(1);
    if (source && (source.visibility === "public" || input.previousVisibility === "public")) {
      const minds = await transaction.select({ id: profiles.id, groupId: groupMembers.groupId }).from(groupMembers)
        .innerJoin(profiles, and(eq(profiles.groupId, groupMembers.groupId), eq(profiles.type, "group")))
        .where(eq(groupMembers.profileId, input.profileId));
      for (const mind of minds) {
        try {
          // A room can disappear or a membership can end after the list read.
          // Roll back that room's enqueue alone, not the person's saved words.
          const job = source.visibility === "public"
            ? await transaction.transaction((tx) => enqueueDeriveSignals(input.profileId, input.inspirationId, input.reason, mind.id, tx))
            : await enqueueGroupTopOfMindRefresh(input.profileId, mind.groupId, "signals_changed", transaction);
          groupJobIds.push(job.jobId);
        } catch (error) {
          if (!(error instanceof InspirationProcessingUnavailableError)) throw error;
        }
      }
    }
  }
  return { jobId: personal.jobId, receipt: personal.receipt, groupJobIds };
}
