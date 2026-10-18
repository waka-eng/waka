import { expect, it, vi } from "vitest";

/* Large-source coverage planning (>12 claims) re-reads the source through
   `reviewSignalSupport`. A source deleted between the pass's first read and
   that planning is the ordinary "missing" outcome, exactly as it is for the
   main support review — not an exception that burns the job's retries. */
vi.mock("./signal-support-batches.js", async () => {
  const { SupportSourceUnavailableError } = await import("./signal-support-review.js");
  return { ensureSupportBatchCoverage: vi.fn(async () => { throw new SupportSourceUnavailableError(); }) };
});

import { deriveSignalsForInspiration } from "./signal-derivation.js";

it("returns missing_inspiration when the source vanishes during coverage planning", async () => {
  const row = { id: "capture", profileId: "person", visibility: "private" };
  const chain = { from: () => chain, where: () => chain, limit: async () => [row] };
  const db = { select: () => chain } as never;
  const result = await deriveSignalsForInspiration({ inspirationId: "capture", reason: "edited" }, {
    db, modelProvider: {} as never, beforeCommit: async () => {},
  });
  expect(result).toMatchObject({ status: "missing_inspiration", inspirationId: "capture", profileId: "person" });
});
