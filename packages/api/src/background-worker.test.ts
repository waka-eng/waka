import { afterEach, describe, expect, it, vi } from "vitest";

import { handler } from "./background-worker.js";
import { runBackgroundJobWorker } from "./lib/queue.js";

vi.mock("./lib/queue.js", () => ({
  runBackgroundJobWorker: vi.fn(async () => ({
    claimed: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    deferred: 0,
  })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("background worker cron handler", () => {
  it("drains a bounded number of background jobs by default", async () => {
    await handler();

    expect(runBackgroundJobWorker).toHaveBeenCalledWith({ limit: 5 });
  });

  it("clamps the cron drain limit from the environment", async () => {
    vi.stubEnv("WAKA_BACKGROUND_JOB_CRON_LIMIT", "100");

    await handler();

    expect(runBackgroundJobWorker).toHaveBeenCalledWith({ limit: 25 });
  });
});
