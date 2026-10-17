import { beforeEach, expect, it, vi } from "vitest";

const enqueue = vi.hoisted(() => vi.fn(async () => ({ id: "job", created: true })));
const database = vi.hoisted(() => vi.fn(() => { throw new Error("Unexpected room fan-out"); }));
vi.mock("../lib/queue.js", () => ({ enqueueDeriveSignals: enqueue }));
vi.mock("../lib/db.js", () => ({ getDb: database }));

import { requestSignalDerivation } from "./inspiration-derivation-requests.js";

beforeEach(() => { vi.clearAllMocks(); });

/* The room fan-out retired with the room engine (2026-10-17): whatever
   changed, a save asks for exactly the personal pass, and nothing reads the
   keeper's seats. The transaction is an empty object, so any read of it
   (the old visibility and membership lookups) would throw. */
it.each(["reflection", "inspiration"] as const)("asks only for the personal pass when a %s changes", async (changedSource) => {
  const transaction = {} as never;
  await requestSignalDerivation({
    profileId: "person", inspirationId: "capture", reason: "edited", changedSource,
  }, transaction);
  expect(enqueue).toHaveBeenCalledExactlyOnceWith("person", "capture", "edited", transaction);
  expect(database).not.toHaveBeenCalled();
});
