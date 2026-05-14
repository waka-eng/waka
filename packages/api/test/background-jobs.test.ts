import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { eq, sql } from "drizzle-orm";

import { backgroundJobs, inspirations } from "../src/db/index.js";
import {
  drainBackgroundJobs,
  enqueueClassification,
} from "../src/lib/queue.js";
import { getDb } from "../src/lib/db.js";
import { createInspirationFixture } from "./fixtures/inspirations.js";
import { createUserFixture } from "./fixtures/users.js";
import { apiJson, authedClient } from "./helpers/client.js";
import { createCleanupTracker } from "./helpers/index.js";
import {
  type GeminiMockHandle,
  installGeminiMock,
} from "./mocks/gemini.js";

const cleanup = createCleanupTracker();
let gemini: GeminiMockHandle;
const isolatedNow = new Date("2000-01-01T00:00:00.000Z");
const isolatedRunnableAt = new Date("1999-12-31T23:59:00.000Z");

function setAdminGate(enabled: boolean) {
  if (enabled) {
    process.env.WAKA_ENABLE_BACKGROUND_JOBS_ADMIN = "true";
  } else {
    delete process.env.WAKA_ENABLE_BACKGROUND_JOBS_ADMIN;
    delete process.env.WAKA_ENABLE_ADMIN_ROUTES;
  }
}

type AdminJobResponse = {
  job: {
    id: string;
    userId: string;
    type: string;
    status: string;
    attempts: number;
    maxAttempts: number;
    runAfter: string;
    lockedAt: string | null;
    lastError: string | null;
    idempotencyKey: string | null;
    createdAt: string;
    updatedAt: string;
    payloadSummary: Record<string, unknown>;
  };
};

type AdminJobsResponse = { jobs: AdminJobResponse["job"][] };

beforeAll(() => {
  expect(process.env.DB_CONNECTION_URL, "DB_CONNECTION_URL").toBeTruthy();
  gemini = installGeminiMock();
});

beforeEach(() => {
  gemini.reset();
});

afterEach(async () => {
  setAdminGate(false);
  await cleanup.flush();
});

afterAll(async () => {
  await cleanup.flush();
  gemini?.restore();
});

async function loadJob(jobId: string) {
  const rows = await getDb()
    .select()
    .from(backgroundJobs)
    .where(eq(backgroundJobs.id, jobId))
    .limit(1);
  return rows[0]!;
}

describe("DB-backed background jobs", () => {
  it("enqueueClassification creates a tenant-scoped process_inspiration job", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const inspirationId = "00000000-0000-4000-8000-000000000123";

    const result = await enqueueClassification(inspirationId, fixture.user.id);

    const job = await loadJob(result.jobId);
    expect(job.userId).toBe(fixture.user.id);
    expect(job.type).toBe("process_inspiration");
    expect(job.payload).toEqual({ inspirationId });
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(0);
    expect(job.maxAttempts).toBe(3);
  });

  it("drains one runnable job and marks it succeeded", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const [inserted] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: fixture.user.id,
        type: "process_inspiration",
        payload: { inspirationId: "00000000-0000-4000-8000-000000000124" },
        runAfter: isolatedRunnableAt,
      })
      .returning({ id: backgroundJobs.id });
    const processor = vi.fn(async () => undefined);

    const result = await drainBackgroundJobs({ processor, now: isolatedNow });

    expect(result).toMatchObject({ claimed: 1, succeeded: 1, retried: 0, failed: 0 });
    expect(processor).toHaveBeenCalledTimes(1);
    const job = await loadJob(inserted!.id);
    expect(job.status).toBe("succeeded");
    expect(job.attempts).toBe(1);
    expect(job.lockedAt).toBeNull();
    expect(job.lastError).toBeNull();
  });

  it("honors the drain limit and leaves extra runnable jobs pending", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const inserted = await getDb()
      .insert(backgroundJobs)
      .values(
        [0, 1, 2].map((index) => ({
          userId: fixture.user.id,
          type: "process_inspiration" as const,
          payload: { inspirationId: `00000000-0000-4000-8000-00000000013${index}` },
          runAfter: isolatedRunnableAt,
        })),
      )
      .returning({ id: backgroundJobs.id });
    const processor = vi.fn(async () => undefined);

    const result = await drainBackgroundJobs({ processor, limit: 2, now: isolatedNow });

    expect(result).toMatchObject({ claimed: 2, succeeded: 2, retried: 0, failed: 0 });
    expect(processor).toHaveBeenCalledTimes(2);
    const rows = await getDb().execute(sql`
      SELECT status, count(*)::int AS count
      FROM background_jobs
      WHERE id IN (${sql.join(inserted.map((job) => job.id), sql`, `)})
      GROUP BY status
      ORDER BY status
    `);
    expect(Array.from(rows as { status: string; count: number }[])).toEqual([
      { status: "pending", count: 1 },
      { status: "succeeded", count: 2 },
    ]);
  });

  it("does not classify or WOW another tenant's inspiration from a mismatched job", async () => {
    const owner = await createUserFixture(getDb());
    const other = await createUserFixture(getDb());
    cleanup.trackUser(owner.user.id);
    cleanup.trackUser(other.user.id);

    const ownerInspiration = await createInspirationFixture(getDb(), owner.user.id, {
      text: "tenant isolation target",
    });
    await getDb().insert(backgroundJobs).values({
      userId: other.user.id,
      type: "process_inspiration",
      payload: { inspirationId: ownerInspiration.id },
      runAfter: isolatedRunnableAt,
    });

    const result = await drainBackgroundJobs({ limit: 1, now: isolatedNow });

    expect(result).toMatchObject({ claimed: 1, succeeded: 1, retried: 0, failed: 0 });
    expect(gemini.calls).toHaveLength(0);
    const rows = await getDb()
      .select()
      .from(inspirations)
      .where(eq(inspirations.id, ownerInspiration.id))
      .limit(1);
    expect(rows[0]?.cluster).toBeNull();
    expect(rows[0]?.classifiedAt).toBeNull();
  });

  it("retries transient failures with backoff and fails after max attempts", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const now = isolatedNow;
    const [inserted] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: fixture.user.id,
        type: "process_inspiration",
        payload: { inspirationId: "00000000-0000-4000-8000-000000000125" },
        maxAttempts: 2,
        runAfter: isolatedRunnableAt,
      })
      .returning({ id: backgroundJobs.id });
    const processor = vi.fn(async () => {
      throw new Error("provider temporary failure token=secret-value");
    });

    const first = await drainBackgroundJobs({ processor, now });
    expect(first).toMatchObject({ claimed: 1, succeeded: 0, retried: 1, failed: 0 });
    let job = await loadJob(inserted!.id);
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
    expect(job.runAfter.getTime()).toBeGreaterThan(now.getTime());
    expect(job.lastError).toContain("token=[redacted]");

    await getDb()
      .update(backgroundJobs)
      .set({ runAfter: now })
      .where(eq(backgroundJobs.id, inserted!.id));

    const second = await drainBackgroundJobs({ processor, now });
    expect(second).toMatchObject({ claimed: 1, succeeded: 0, retried: 0, failed: 1 });
    job = await loadJob(inserted!.id);
    expect(job.status).toBe("failed");
    expect(job.attempts).toBe(2);
  });

  it("does not double-claim one runnable job across concurrent drains", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    await getDb().insert(backgroundJobs).values({
      userId: fixture.user.id,
      type: "process_inspiration",
      payload: { inspirationId: "00000000-0000-4000-8000-000000000126" },
      runAfter: isolatedRunnableAt,
    });
    const seen: string[] = [];
    const processor = vi.fn(async (job) => {
      seen.push(job.id);
      await new Promise((resolve) => setTimeout(resolve, 25));
    });

    const now = isolatedNow;
    const results = await Promise.all([
      drainBackgroundJobs({ processor, now }),
      drainBackgroundJobs({ processor, now }),
    ]);

    expect(results.reduce((sum, item) => sum + item.claimed, 0)).toBe(1);
    expect(new Set(seen).size).toBe(1);
    expect(processor).toHaveBeenCalledTimes(1);
  });

  it("cascades tenant jobs when the user is deleted", async () => {
    const fixture = await createUserFixture(getDb());
    const [inserted] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: fixture.user.id,
        type: "process_inspiration",
        payload: { inspirationId: "00000000-0000-4000-8000-000000000127" },
      })
      .returning({ id: backgroundJobs.id });

    cleanup.trackUser(fixture.user.id);
    await cleanup.flush();

    const remaining = await getDb().execute(sql`
      SELECT id FROM background_jobs WHERE id = ${inserted!.id}
    `);
    expect(Array.from(remaining as any[])).toHaveLength(0);
  });
});


describe("admin background jobs API", () => {
  it("returns 404 for authenticated requests when the admin gate is disabled", async () => {
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const res = await authedClient(fixture).get("/api/admin/background-jobs");

    expect(res.status).toBe(404);
  });

  it("returns 401 for unauthenticated requests when the admin gate is enabled", async () => {
    setAdminGate(true);

    const res = await apiJson("/api/admin/background-jobs");

    expect(res.status).toBe(401);
  });

  it("enables the route with the broad admin routes alias", async () => {
    process.env.WAKA_ENABLE_ADMIN_ROUTES = "true";
    delete process.env.WAKA_ENABLE_BACKGROUND_JOBS_ADMIN;
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);

    const res = await authedClient(fixture).get<AdminJobsResponse>(
      "/api/admin/background-jobs",
    );

    expect(res.status).toBe(200);
    expect(res.body.jobs).toEqual([]);
  });

  it("uses a default list limit of 50", async () => {
    setAdminGate(true);
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const base = Date.parse("2026-02-01T00:00:00.000Z");
    const inserted = await getDb()
      .insert(backgroundJobs)
      .values(
        Array.from({ length: 55 }, (_, index) => ({
          userId: fixture.user.id,
          type: "process_inspiration" as const,
          payload: {
            inspirationId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          },
          createdAt: new Date(base + index * 1000),
          updatedAt: new Date(base + index * 1000),
        })),
      )
      .returning({ id: backgroundJobs.id });

    const res = await authedClient(fixture).get<AdminJobsResponse>(
      "/api/admin/background-jobs",
    );

    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(50);
    expect(res.body.jobs[0]!.id).toBe(inserted[54]!.id);
    expect(res.body.jobs.at(-1)!.id).toBe(inserted[5]!.id);
  });

  it("filters list results by process_inspiration type", async () => {
    setAdminGate(true);
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const [matching] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: fixture.user.id,
        type: "process_inspiration",
        payload: { inspirationId: "00000000-0000-4000-8000-000000000777" },
      })
      .returning({ id: backgroundJobs.id });

    const res = await authedClient(fixture).get<AdminJobsResponse>(
      "/api/admin/background-jobs?type=process_inspiration",
    );

    expect(res.status).toBe(200);
    expect(res.body.jobs.map((job) => job.id)).toContain(matching!.id);
    expect(res.body.jobs.every((job) => job.type === "process_inspiration")).toBe(true);
  });

  it("lists safe job summaries with status filtering, limit clamp, and newest-first order", async () => {
    setAdminGate(true);
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    const inserted = await getDb()
      .insert(backgroundJobs)
      .values(
        Array.from({ length: 105 }, (_, index) => ({
          userId: fixture.user.id,
          type: "process_inspiration" as const,
          payload: {
            inspirationId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            secretToken: `do-not-return-${index}`,
          } as any,
          status: index % 2 === 0 ? ("failed" as const) : ("pending" as const),
          attempts: index % 2 === 0 ? 2 : 0,
          maxAttempts: 3,
          runAfter: new Date(base + index * 1000),
          lastError: index % 2 === 0 ? "sanitized provider error" : null,
          idempotencyKey: `admin-list-${fixture.user.id}-${index}`,
          createdAt: new Date(base + index * 1000),
          updatedAt: new Date(base + index * 1000),
        })),
      )
      .returning({ id: backgroundJobs.id });

    const res = await authedClient(fixture).get<AdminJobsResponse>(
      "/api/admin/background-jobs?status=failed&limit=999",
    );

    expect(res.status).toBe(200);
    expect(res.body.jobs).toHaveLength(53);
    expect(res.body.jobs.map((job) => job.id)).toEqual(
      inserted
        .filter((_, index) => index % 2 === 0)
        .map((job) => job.id)
        .reverse(),
    );
    expect(res.body.jobs[0]).toEqual({
      id: inserted[104]!.id,
      userId: fixture.user.id,
      type: "process_inspiration",
      status: "failed",
      attempts: 2,
      maxAttempts: 3,
      runAfter: new Date(base + 104_000).toISOString(),
      lockedAt: null,
      lastError: "sanitized provider error",
      idempotencyKey: `admin-list-${fixture.user.id}-104`,
      createdAt: new Date(base + 104_000).toISOString(),
      updatedAt: new Date(base + 104_000).toISOString(),
      payloadSummary: { inspirationId: "00000000-0000-4000-8000-000000000104" },
    });
    expect(JSON.stringify(res.body)).not.toContain("secretToken");
    expect(JSON.stringify(res.body)).not.toContain("do-not-return");

    const clamped = await authedClient(fixture).get<AdminJobsResponse>(
      `/api/admin/background-jobs?userId=${fixture.user.id}&limit=999`,
    );
    expect(clamped.status).toBe(200);
    expect(clamped.body.jobs).toHaveLength(100);
    expect(clamped.body.jobs[0]!.id).toBe(inserted[104]!.id);
    expect(clamped.body.jobs.at(-1)!.id).toBe(inserted[5]!.id);
  });

  it("sanitizes secret-looking lastError values in list and detail responses", async () => {
    setAdminGate(true);
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const rawBearer = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.rawsignaturevalue1234567890";
    const rawApiKey = "sk-test-raw-admin-api-key";
    const rawPassword = "correct-horse-battery-staple";
    const rawLongToken = "rawlongtokenvalue1234567890abcdefRAWLONGTOKEN";
    const [inserted] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: fixture.user.id,
        type: "process_inspiration",
        payload: { inspirationId: "00000000-0000-4000-8000-000000000805" },
        status: "failed",
        attempts: 3,
        lastError: `Provider failed: Authorization: Bearer ${rawBearer}; api_key=${rawApiKey} password="${rawPassword}" token: ${rawLongToken}. ${"safe diagnostic context ".repeat(80)}`,
      })
      .returning({ id: backgroundJobs.id });

    const list = await authedClient(fixture).get<AdminJobsResponse>(
      "/api/admin/background-jobs?status=failed",
    );
    const detail = await authedClient(fixture).get<AdminJobResponse>(
      `/api/admin/background-jobs/${inserted!.id}`,
    );

    expect(list.status).toBe(200);
    expect(detail.status).toBe(200);
    const listedJob = list.body.jobs.find((job) => job.id === inserted!.id)!;
    const responseText = JSON.stringify({ list: list.body, detail: detail.body });
    for (const rawSecret of [rawBearer, rawApiKey, rawPassword, rawLongToken]) {
      expect(responseText).not.toContain(rawSecret);
    }
    for (const lastError of [listedJob.lastError, detail.body.job.lastError]) {
      expect(lastError).toBeTruthy();
      expect(lastError).toContain("Provider failed");
      expect(lastError).toContain("[redacted]");
      expect(lastError!.length).toBeLessThanOrEqual(1_000);
    }
  });

  it("keeps list results tenant-scoped even with another userId filter", async () => {
    setAdminGate(true);
    const owner = await createUserFixture(getDb());
    const other = await createUserFixture(getDb());
    cleanup.trackUser(owner.user.id);
    cleanup.trackUser(other.user.id);
    const [ownerJob] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: owner.user.id,
        type: "process_inspiration",
        payload: { inspirationId: "00000000-0000-4000-8000-000000000801" },
      })
      .returning({ id: backgroundJobs.id });
    await getDb().insert(backgroundJobs).values({
      userId: other.user.id,
      type: "process_inspiration",
      payload: { inspirationId: "00000000-0000-4000-8000-000000000802" },
    });

    const defaultList = await authedClient(owner).get<AdminJobsResponse>(
      "/api/admin/background-jobs",
    );
    const crossTenantList = await authedClient(owner).get<AdminJobsResponse>(
      `/api/admin/background-jobs?userId=${other.user.id}`,
    );

    expect(defaultList.status).toBe(200);
    expect(defaultList.body.jobs.map((job) => job.id)).toContain(ownerJob!.id);
    expect(defaultList.body.jobs.every((job) => job.userId === owner.user.id)).toBe(true);
    expect(crossTenantList.status).toBe(200);
    expect(crossTenantList.body.jobs).toEqual([]);
  });

  it("returns 404 for missing job detail and a safe summary for an existing job", async () => {
    setAdminGate(true);
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const [inserted] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: fixture.user.id,
        type: "process_inspiration",
        payload: {
          inspirationId: "00000000-0000-4000-8000-000000000321",
          accessToken: "do-not-return",
        } as any,
        status: "succeeded",
      })
      .returning({ id: backgroundJobs.id });

    const missing = await authedClient(fixture).get<AdminJobResponse>(
      "/api/admin/background-jobs/00000000-0000-4000-8000-000000000000",
    );
    const existing = await authedClient(fixture).get<AdminJobResponse>(
      `/api/admin/background-jobs/${inserted!.id}`,
    );

    expect(missing.status).toBe(404);
    expect(existing.status).toBe(200);
    expect(existing.body.job).toMatchObject({
      id: inserted!.id,
      userId: fixture.user.id,
      type: "process_inspiration",
      status: "succeeded",
      payloadSummary: { inspirationId: "00000000-0000-4000-8000-000000000321" },
    });
    expect(JSON.stringify(existing.body)).not.toContain("accessToken");
    expect(JSON.stringify(existing.body)).not.toContain("do-not-return");
  });

  it("returns 404 for another tenant's job detail", async () => {
    setAdminGate(true);
    const owner = await createUserFixture(getDb());
    const other = await createUserFixture(getDb());
    cleanup.trackUser(owner.user.id);
    cleanup.trackUser(other.user.id);
    const [otherJob] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: other.user.id,
        type: "process_inspiration",
        payload: { inspirationId: "00000000-0000-4000-8000-000000000803" },
      })
      .returning({ id: backgroundJobs.id });

    const res = await authedClient(owner).get(
      `/api/admin/background-jobs/${otherJob!.id}`,
    );

    expect(res.status).toBe(404);
  });

  it("retries failed jobs by resetting them to pending", async () => {
    setAdminGate(true);
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const oldDate = new Date("2025-01-01T00:00:00.000Z");
    const [inserted] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: fixture.user.id,
        type: "process_inspiration",
        payload: { inspirationId: "00000000-0000-4000-8000-000000000456" },
        status: "failed",
        attempts: 3,
        maxAttempts: 3,
        runAfter: oldDate,
        lockedAt: oldDate,
        lastError: "sanitized failure",
      })
      .returning({ id: backgroundJobs.id });

    const res = await authedClient(fixture).json<AdminJobResponse>(
      "POST",
      `/api/admin/background-jobs/${inserted!.id}/retry`,
    );
    const persisted = await loadJob(inserted!.id);

    expect(res.status).toBe(200);
    expect(res.body.job).toMatchObject({
      id: inserted!.id,
      status: "pending",
      attempts: 0,
      lockedAt: null,
      lastError: null,
      payloadSummary: { inspirationId: "00000000-0000-4000-8000-000000000456" },
    });
    expect(new Date(res.body.job.runAfter).getTime()).toBeGreaterThan(oldDate.getTime());
    expect(persisted.status).toBe("pending");
    expect(persisted.attempts).toBe(0);
    expect(persisted.lockedAt).toBeNull();
    expect(persisted.lastError).toBeNull();
  });

  it("returns 409 when retrying a non-failed job", async () => {
    setAdminGate(true);
    const fixture = await createUserFixture(getDb());
    cleanup.trackUser(fixture.user.id);
    const [inserted] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: fixture.user.id,
        type: "process_inspiration",
        payload: { inspirationId: "00000000-0000-4000-8000-000000000654" },
        status: "pending",
      })
      .returning({ id: backgroundJobs.id });

    const res = await authedClient(fixture).json(
      "POST",
      `/api/admin/background-jobs/${inserted!.id}/retry`,
    );
    const persisted = await loadJob(inserted!.id);

    expect(res.status).toBe(409);
    expect(persisted.status).toBe("pending");
    expect(persisted.attempts).toBe(0);
  });

  it("returns 404 and does not retry another tenant's failed job", async () => {
    setAdminGate(true);
    const owner = await createUserFixture(getDb());
    const other = await createUserFixture(getDb());
    cleanup.trackUser(owner.user.id);
    cleanup.trackUser(other.user.id);
    const [otherJob] = await getDb()
      .insert(backgroundJobs)
      .values({
        userId: other.user.id,
        type: "process_inspiration",
        payload: { inspirationId: "00000000-0000-4000-8000-000000000804" },
        status: "failed",
        attempts: 3,
        lastError: "sanitized failure",
      })
      .returning({ id: backgroundJobs.id });

    const res = await authedClient(owner).json(
      "POST",
      `/api/admin/background-jobs/${otherJob!.id}/retry`,
    );
    const persisted = await loadJob(otherJob!.id);

    expect(res.status).toBe(404);
    expect(persisted.status).toBe("failed");
    expect(persisted.attempts).toBe(3);
    expect(persisted.lastError).toBe("sanitized failure");
  });
});
