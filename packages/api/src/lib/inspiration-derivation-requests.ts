/** Persist learning work in the transaction that changes its source. Failure
 * aborts that write; model/wake failures occur only after the words are saved. */
import type { DeriveSignalsPayload } from "../db/index.js";
import { getDb } from "./db.js";
import { enqueueDeriveSignals } from "./queue.js";

type SourceTransaction = Pick<ReturnType<typeof getDb>, "select" | "execute" | "transaction">;

/* ONE DESTINATION: THE KEEPER'S OWN STACK (room engine retired, 2026-10-17).
   This used to fan a public save out to every room mind the keeper held a
   seat in — a `derive_signals` job per mind, or a room refresh when the save
   went private. Rooms left the product on 2026-10-15 and their engine with
   this change, so a save now asks for exactly one pass. The membership rows
   are still in the database and deliberately not read here: a seat no
   longer means anything to the pipeline. */
export async function requestSignalDerivation(input: {
  profileId: string;
  inspirationId: string;
  reason: DeriveSignalsPayload["reason"];
  /** Kept on the input so callers state what changed; only the personal pass
   * reads either kind of source. */
  changedSource: "inspiration" | "reflection";
}, transaction: SourceTransaction) {
  const personal = await enqueueDeriveSignals(input.profileId, input.inspirationId, input.reason, transaction);
  return { jobId: personal.jobId, receipt: personal.receipt };
}
