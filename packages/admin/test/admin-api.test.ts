import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AdminApiError,
  fetchBackgroundJobDetail,
  fetchBackgroundJobs,
  retryBackgroundJob,
  type AdminBackgroundJob,
} from "../src/lib/admin-api";

const job: AdminBackgroundJob = {
  id: "job-1",
  profileId: "profile-1",
  type: "derive_signals",
  status: "failed",
  attempts: 3,
  maxAttempts: 3,
  runAfter: "2026-05-01T00:00:00.000Z",
  lockedAt: null,
  lastError: "Gemini timeout",
  idempotencyKey: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  updatedAt: "2026-05-01T00:01:00.000Z",
  payloadSummary: { inspirationId: "inspiration-1" },
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

    await expect(fetchBackgroundJobs({ status: "failed", type: "derive_signals" })).resolves.toEqual([
      job,
    ]);
    expect(fetch).toHaveBeenCalledWith(
      "/api/admin/background-jobs?status=failed&type=derive_signals",
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

  it("takes the detail as a bounded payload summary and drops the raw payload", async () => {
    const detail: AdminBackgroundJob = {
      ...job,
      payloadSummary: { inspirationId: "inspiration-1", reason: "capture" },
    };
    stubFetch(Response.json({ job: detail, payload: { accessToken: "do-not-use" } }));

    await expect(fetchBackgroundJobDetail(job.id)).resolves.toEqual(detail);
    expect(fetch).toHaveBeenCalledWith("/api/admin/background-jobs/job-1", {
      method: "GET",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  /*
    A job type this app has never heard of still has to list and open, or the
    admin surface goes blind exactly when a new worker is being introduced.
  */
  it("accepts a job type it does not know", async () => {
    const unknown: AdminBackgroundJob = {
      ...job,
      type: "a_worker_added_after_this_build",
      payloadSummary: {},
    };
    stubFetch(Response.json({ jobs: [unknown] }));

    await expect(fetchBackgroundJobs()).resolves.toEqual([unknown]);
  });

  it("rejects a job row with no owning profile", async () => {
    const { profileId: _profileId, ...withoutProfile } = job;
    stubFetch(Response.json({ jobs: [withoutProfile] }));

    await expect(fetchBackgroundJobs()).rejects.toMatchObject({
      name: "AdminApiError",
      message: "Malformed background job response",
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
