import { beforeEach, expect, it, vi } from "vitest";

const enqueue = vi.hoisted(() => vi.fn(async () => ({ id: "job", created: true })));
const database = vi.hoisted(() => vi.fn(() => { throw new Error("Unexpected room fan-out"); }));
vi.mock("../lib/queue.js", () => ({ enqueueDeriveSignals: enqueue }));
vi.mock("../lib/db.js", () => ({ getDb: database }));

import { requestSignalDerivation } from "./inspiration-derivation-requests.js";

beforeEach(() => { vi.clearAllMocks(); });

it("updates personal learning without triggering room generation for a private reflection", async () => {
  const transaction = {} as never;
  await requestSignalDerivation({
    profileId: "person", inspirationId: "capture", reason: "edited", changedSource: "reflection",
  }, transaction);
  expect(enqueue).toHaveBeenCalledExactlyOnceWith("person", "capture", "edited", undefined, transaction);
  expect(database).not.toHaveBeenCalled();
});
