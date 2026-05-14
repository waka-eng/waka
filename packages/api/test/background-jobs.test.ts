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
import { createCleanupTracker } from "./helpers/index.js";
import {
  type GeminiMockHandle,
  installGeminiMock,
} from "./mocks/gemini.js";

const cleanup = createCleanupTracker();
let gemini: GeminiMockHandle;
const isolatedNow = new Date("2000-01-01T00:00:00.000Z");
const isolatedRunnableAt = new Date("1999-12-31T23:59:00.000Z");

beforeAll(() => {
  expect(process.env.DB_CONNECTION_URL, "DB_CONNECTION_URL").toBeTruthy();
  gemini = installGeminiMock();
});

beforeEach(() => {
  gemini.reset();
});

afterEach(async () => {
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
