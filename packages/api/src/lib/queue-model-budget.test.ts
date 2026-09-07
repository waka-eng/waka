/**
 * One account cannot spend everyone's model budget.
 *
 * The bug these pin against: `drainBackgroundJobs` took work strictly
 * oldest-first with no notion of whose it was, and every job type ends in a
 * call against one shared Gemini API key. A single signup that saved enough
 * things owned the head of the queue for as long as it took, and generation
 * stopped working for every other account until then. Nothing in the code said
 * no, because nothing in the code was counting.
 *
 * The queue drains against Postgres, and the api unit suite runs on a bare
 * checkout with no database, so these run the real `drainBackgroundJobs` loop
 * against an in-memory `BackgroundJobStore`. What is faked is the storage;
 * what is under test — the order of peek, budget, claim, and deferral — is the
 * shipped code. The behaviour that genuinely lives in SQL (SKIP LOCKED,
 * stale-lock reclaim) is not modelled here and is not what these assert.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BackgroundJob } from "../db/index.js";
import {
  MODEL_BUDGET_JOBS_PER_ACCOUNT,
  MODEL_BUDGET_RELEASE_MARGIN_MS,
  MODEL_BUDGET_WINDOW_MS,
} from "./model-budget.js";
import {
  type BackgroundJobStore,
  drainBackgroundJobs,
  type DeferAccountBacklogInput,
  type RunnableJobHead,
} from "./queue.js";

const NOW = new Date("2026-08-16T12:00:00.000Z");
const MINUTE = 60 * 1_000;
const MAX_ATTEMPTS = 3;
/** Mirrors `STALE_LOCK_SECONDS` in ./queue.ts. */
const STALE_LOCK_MS = 15 * MINUTE;

interface QueuedRow {
  id: string;
  profileId: string;
  accountId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  attempts: number;
  runAfter: Date;
  lockedAt: Date | null;
  createdAt: Date;
  startedAt: Date | null;
}

/**
 * A queue that lives in an array.
 *
 * It implements what decides whose job the budget is asked about: the two
 * orderings the real store guarantees — oldest due first, then oldest created
 * — and both arms of "runnable", the pending row whose time has come and the
 * running row abandoned by a dead worker. Everything else is the smallest
 * thing that answers honestly.
 */
class InMemoryBackgroundJobStore implements BackgroundJobStore {
  readonly rows: QueuedRow[] = [];
  private sequence = 0;

  enqueue(input: {
    accountId: string;
    profileId?: string;
    createdAt?: Date;
    runAfter?: Date;
  }): QueuedRow {
    this.sequence += 1;
    const row: QueuedRow = {
      id: `job-${this.sequence}`,
      profileId: input.profileId ?? `${input.accountId}-profile`,
      accountId: input.accountId,
      status: "pending",
      attempts: 0,
      runAfter: input.runAfter ?? new Date(NOW.getTime() - MINUTE),
      lockedAt: null,
      createdAt: input.createdAt ?? new Date(NOW.getTime() - MINUTE + this.sequence),
      startedAt: null,
    };
    this.rows.push(row);
    return row;
  }

  /** A job this account already ran inside the window — spend, not backlog. */
  recordEarlierStart(accountId: string, startedAt: Date): void {
    const row = this.enqueue({ accountId });
    row.status = "succeeded";
    row.startedAt = startedAt;
  }

  /** A job whose worker died holding it: running, locked, long past the ceiling. */
  abandon(row: QueuedRow, startedAt: Date): void {
    row.status = "running";
    row.attempts = 1;
    row.lockedAt = startedAt;
    row.startedAt = startedAt;
  }

  private nextRunnable(now: Date): QueuedRow | null {
    const runnable = this.rows
      .filter(
        (row) =>
          (row.status === "pending" && row.runAfter.getTime() <= now.getTime()) ||
          (row.status === "running" &&
            row.lockedAt !== null &&
            row.lockedAt.getTime() < now.getTime() - STALE_LOCK_MS &&
            row.attempts < MAX_ATTEMPTS),
      )
      .sort(
        (a, b) =>
          a.runAfter.getTime() - b.runAfter.getTime() ||
          a.createdAt.getTime() - b.createdAt.getTime(),
      );
    return runnable[0] ?? null;
  }

  async headOfQueue(now: Date): Promise<RunnableJobHead | null> {
    const row = this.nextRunnable(now);
    if (!row) return null;
    return { jobId: row.id, accountId: row.accountId, reclaimed: row.status === "running" };
  }

  async claimNext(now: Date): Promise<BackgroundJob | null> {
    const row = this.nextRunnable(now);
    if (!row) return null;
    row.status = "running";
    row.attempts += 1;
    row.lockedAt = now;
    row.startedAt = now;
    return {
      id: row.id,
      profileId: row.profileId,
      type: "derive_signals",
      payload: { inspirationId: `inspiration-${row.id}`, reason: "created" },
      status: "running",
      attempts: row.attempts,
      maxAttempts: MAX_ATTEMPTS,
      runAfter: row.runAfter,
      lockedAt: now,
      startedAt: now,
      lastError: null,
      idempotencyKey: null,
      rerunRequested: false,
      createdAt: row.createdAt,
      updatedAt: now,
    };
  }

  async usageForAccount(accountId: string, since: Date) {
    const starts = this.rows
      .filter(
        (row) =>
          row.accountId === accountId &&
          row.startedAt !== null &&
          row.startedAt.getTime() >= since.getTime(),
      )
      .map((row) => row.startedAt as Date)
      .sort((a, b) => a.getTime() - b.getTime());
    return {
      startedInWindow: starts.length,
      oldestStartInWindow: starts[0] ?? null,
    };
  }

  async deferAccountBacklog(input: DeferAccountBacklogInput): Promise<number> {
    const due = this.rows.filter(
      (row) =>
        row.accountId === input.accountId &&
        row.status === "pending" &&
        row.runAfter.getTime() <= input.now.getTime(),
    );
    for (const row of due) row.runAfter = input.until;
    return due.length;
  }

  async markSucceeded(jobId: string): Promise<void> {
    const row = this.rows.find((candidate) => candidate.id === jobId);
    if (row) row.status = "succeeded";
  }

  async holdJob(job: BackgroundJob, until: Date) {
    const row = this.rows.find((r) => r.id === job.id);
    if (row) {
      row.status = "pending";
      row.attempts = Math.max(0, row.attempts - 1);
      row.runAfter = until;
    }
  }

  async markFailedOrPending(job: BackgroundJob, _err: unknown, exhausted: boolean) {
    const row = this.rows.find((candidate) => candidate.id === job.id);
    if (row) row.status = exhausted ? "failed" : "pending";
  }
}

let store: InMemoryBackgroundJobStore;
let ran: string[];

beforeEach(() => {
  // The in-process drain timer would fire after the test that armed it and
  // reach for a database this suite deliberately does not have.
  vi.stubEnv("WAKA_BACKGROUND_JOB_AUTODRAIN", "0");
  vi.spyOn(console, "log").mockImplementation(() => {});
  store = new InMemoryBackgroundJobStore();
  ran = [];
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const processor = async (job: BackgroundJob) => {
  ran.push(job.id);
};

function drain(limit: number) {
  return drainBackgroundJobs({ limit, now: NOW, store, processor });
}

/** Spend an account's whole window, oldest start `oldestMinutesAgo` back. */
function spendTheBudget(accountId: string, oldestMinutesAgo = 30): void {
  for (let i = 0; i < MODEL_BUDGET_JOBS_PER_ACCOUNT; i += 1) {
    store.recordEarlierStart(
      accountId,
      new Date(NOW.getTime() - oldestMinutesAgo * MINUTE + i),
    );
  }
}

describe("the model budget bounds one account", () => {
  it("drains an account that is inside its budget", async () => {
    store.enqueue({ accountId: "account-a" });
    store.enqueue({ accountId: "account-a" });

    const result = await drain(10);

    expect(ran).toHaveLength(2);
    expect(result.claimed).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.deferred).toBe(0);
  });

  /**
   * The cap in one assertion: an account with far more work than its budget
   * runs exactly its budget, however many times the worker wakes up inside the
   * same window. Draining in a loop is what the deployed worker does — it
   * drains until the queue is dry — so a cap that only held for one batch
   * would not be a cap at all.
   */
  it("stops an account at its budget however often the worker wakes", async () => {
    const overshoot = 20;
    for (let i = 0; i < MODEL_BUDGET_JOBS_PER_ACCOUNT + overshoot; i += 1) {
      store.enqueue({ accountId: "account-a" });
    }

    for (let pass = 0; pass < 5; pass += 1) await drain(100);

    expect(ran).toHaveLength(MODEL_BUDGET_JOBS_PER_ACCOUNT);
  });

  it("defers the over-budget backlog instead of dropping it", async () => {
    const oldestStart = new Date(NOW.getTime() - 30 * MINUTE);
    spendTheBudget("account-a");
    const waiting = [
      store.enqueue({ accountId: "account-a" }),
      store.enqueue({ accountId: "account-a" }),
      store.enqueue({ accountId: "account-a" }),
    ];

    const result = await drain(10);

    expect(ran).toEqual([]);
    expect(result.claimed).toBe(0);
    expect(result.deferred).toBe(3);

    // Still pending, still unattempted, still theirs — just later. `run_after`
    // is the queue's own word for "not yet", so nothing downstream has to
    // learn a new state to understand a deferred job.
    for (const row of waiting) {
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(0);
      expect(row.runAfter.getTime()).toBe(
        oldestStart.getTime() + MODEL_BUDGET_WINDOW_MS + MODEL_BUDGET_RELEASE_MARGIN_MS,
      );
    }
  });

  it("runs the deferred work once the window frees a slot", async () => {
    spendTheBudget("account-a", 59);
    const waiting = store.enqueue({ accountId: "account-a" });

    await drain(10);
    expect(ran).toEqual([]);

    const afterTheWindow = new Date(waiting.runAfter.getTime() + MINUTE);
    await drainBackgroundJobs({ limit: 10, now: afterTheWindow, store, processor });

    expect(ran).toEqual([waiting.id]);
  });
});

describe("one account's spending is not another's problem", () => {
  /**
   * The bug in its sharpest form. Account A saved first, so every one of its
   * jobs sits ahead of B's in the queue, and a batch is finite. Without the
   * budget the batch is spent entirely on A and B waits for the next wake-up —
   * and the next, for as long as A keeps saving. With it, A's backlog is
   * pushed out of the way and B is served in the same batch.
   */
  it("serves a second account in the same batch the first is capped in", async () => {
    spendTheBudget("account-a");
    for (let i = 0; i < 5; i += 1) {
      store.enqueue({ accountId: "account-a", createdAt: new Date(NOW.getTime() - 10 * MINUTE) });
    }
    const theirs = store.enqueue({
      accountId: "account-b",
      createdAt: new Date(NOW.getTime() - MINUTE),
    });

    const result = await drain(2);

    expect(ran).toEqual([theirs.id]);
    expect(result.succeeded).toBe(1);
  });

  it("gives the second account its own full budget", async () => {
    spendTheBudget("account-a");
    store.enqueue({ accountId: "account-a" });
    for (let i = 0; i < MODEL_BUDGET_JOBS_PER_ACCOUNT; i += 1) {
      store.enqueue({ accountId: "account-b" });
    }

    for (let pass = 0; pass < 3; pass += 1) await drain(100);

    expect(ran).toHaveLength(MODEL_BUDGET_JOBS_PER_ACCOUNT);
    expect(ran.every((id) => store.rows.find((row) => row.id === id)?.accountId === "account-b"))
      .toBe(true);
  });

  /**
   * A job abandoned by a dead worker is reclaimed rather than deferred, and
   * the difference is the whole queue. `run_after` is not what makes a stale
   * row claimable, so deferring one would move nothing and leave the same row
   * at the head on every pass — one crashed Lambda, holding one job for an
   * account that happened to be over budget, would stop generation for every
   * account on the deployment.
   *
   * Letting it through is not a hole in the cap: its first start was gated and
   * counted, and `attempts < max_attempts` bounds how often any row can be
   * picked up again.
   */
  it("still reclaims an abandoned job, and serves everyone behind it", async () => {
    spendTheBudget("account-a");
    const abandoned = store.enqueue({
      accountId: "account-a",
      createdAt: new Date(NOW.getTime() - 30 * MINUTE),
      runAfter: new Date(NOW.getTime() - 30 * MINUTE),
    });
    store.abandon(abandoned, new Date(NOW.getTime() - 20 * MINUTE));
    store.enqueue({ accountId: "account-a", createdAt: new Date(NOW.getTime() - 20 * MINUTE) });
    const theirs = store.enqueue({
      accountId: "account-b",
      createdAt: new Date(NOW.getTime() - MINUTE),
    });

    await drain(10);

    expect(ran).toEqual([abandoned.id, theirs.id]);
  });

  /**
   * An account is a login, and one login owns its human profile and its
   * agents. A cap counted per profile would be lifted by making another agent,
   * which the product hands out for free.
   */
  it("counts every profile the account owns against one budget", async () => {
    spendTheBudget("account-a");
    const fromAnAgent = store.enqueue({
      accountId: "account-a",
      profileId: "account-a-agent",
    });

    await drain(10);

    expect(ran).toEqual([]);
    expect(fromAnAgent.status).toBe("pending");
  });
});
