/**
 * Asking layer 2 to catch up with a change at layer 1.
 *
 * Capture, edit and reflection all end the same way: the signals this capture
 * supports need re-deriving. The rule they share — that asking must never fail
 * the write — is the reason this is one function and not three inline
 * `.catch()` blocks that could quietly stop agreeing with each other.
 */

import type { DeriveSignalsPayload } from "../db/index.js";
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
    .then(() => undefined)
    .catch((err: unknown) => {
      console.error("[inspirations] failed to enqueue signal derivation:", {
        inspirationId: input.inspirationId,
        reason: input.reason,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}
