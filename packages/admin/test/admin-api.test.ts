import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminApiError,
  fetchBackgroundJobs,
  retryBackgroundJob,
  type AdminBackgroundJob,
} from "../src/lib/admin-api";

const job: AdminBackgroundJob = {
  id: "job-1",
  userId: "user-1",
  type: "process_inspiration",
  status: "failed",
  attempts: 3,
  maxAttempts: 3,
  runAfter: "2026-05-01T00:00:00.000Z",
  lockedAt: null,
  lastError: "Gemini timeout",
  idempotencyKey: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:01:00.000Z",
  payloadSummary: { inspirationId: "insp-1" },
};

function stubFetch(response: Response): void {
  vi.stubGlobal("fetch", vi.fn(async () => response));
}

describe("admin background jobs API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists jobs with credentials through the same-origin admin API path", async () => {
    stubFetch(Response.json({ jobs: [job] }));

    await expect(fetchBackgroundJobs({ status: "failed", type: "process_inspiration" })).resolves.toEqual([
      job,
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/background-jobs?status=failed&type=process_inspiration",
      {
        method: "GET",
        credentials: "include",
        headers: { Accept: "application/json" },
      },
    );
  });

  it("turns a disabled admin route 404 into an explanatory error", async () => {
    stubFetch(Response.json({ error: "Not Found" }, { status: 404 }));

    await expect(fetchBackgroundJobs()).rejects.toMatchObject({
      name: "AdminApiError",
      status: 404,
      message:
        "Admin routes are disabled. Set WAKA_ENABLE_BACKGROUND_JOBS_ADMIN=true on the API/dev server.",
    } satisfies Partial<AdminApiError>);
  });

  it("retries a failed job and returns the updated job", async () => {
    const updated = { ...job, status: "pending", attempts: 0, lastError: null };
    stubFetch(Response.json({ job: updated }));

    await expect(retryBackgroundJob(job.id)).resolves.toEqual(updated);
    expect(fetch).toHaveBeenCalledWith("/api/admin/background-jobs/job-1/retry", {
      method: "POST",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });
});
