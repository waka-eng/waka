import { expect, it } from "vitest";
import { principleMaterialKey } from "./principle-material-key.js";
import { supportBatchKey } from "./signal-support-batches.js";

/* KEY STABILITY ACROSS THE ROOM RETIREMENT. Both keys are idempotency keys
   over work already stored in dev and prod: a changed key re-buys every
   completed principles pass, and loses sight of every failed support batch.
   The room retirement removed the fields these keys used to read
   (`material.groupId`, `payload.membershipId`), so each now reproduces its
   old JSON by hand. The expected values below were computed on origin/dev
   (f837734d), before the change, with the same fixtures — hard-coded so any
   drift fails here rather than in a bill. */

const owner = "11111111-1111-4111-8111-111111111111";

it("keeps the assess_signal_support batch key computed before rooms retired", () => {
  expect(supportBatchKey(owner, {
    inspirationId: "22222222-2222-4222-8222-222222222222",
    signalIds: ["33333333-3333-4333-8333-333333333333"],
    materialRevision: "7", materialHash: "b".repeat(64),
    statements: [{ id: "33333333-3333-4333-8333-333333333333", revision: "2", hash: "c".repeat(64) }],
  })).toBe("assess_signal_support:c999cc19867f54b14eeecf88279a5d22e1458256ca569a19e18602e7f7c422c5");
});

it("keeps the principle material key computed before rooms retired", () => {
  const id = "44444444-4444-4444-8444-444444444444";
  const material = {
    activeSignals: [{ id, statement: "Quiet first", lastEvidenceAt: null, updatedAt: new Date(0) }],
    evidence: new Map([[id, { signalId: id, evidenceAt: [new Date("2026-01-02T00:00:00Z"), new Date("2026-01-01T00:00:00Z")],
      tomVersionIds: ["v2", "v1"], supportKey: "k" }]]),
    groupProfile: false, preferredLocale: "ko-KR", eligibility: {},
  };
  expect(principleMaterialKey(material as never))
    .toBe("bc25f975e9c99a0b6123b8fea6b797ec1df421a8afaa446255405d4f092a1c2e");
});
