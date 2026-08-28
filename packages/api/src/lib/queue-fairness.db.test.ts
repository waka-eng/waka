/**
 * THE QUEUE IS FAIR — kind fairness, in the SQL where it lives.
 *
 * goal: no-quiet-corners, Phase 7. Found live on 2026-08-23: two hundred
 * and five bulk derivations starved two enrichment jobs for the account's
 * whole model-budget window — FIFO plus a per-account budget means bulk
 * capture makes enrichment invisible for an hour, indistinguishable from
 * breakage. The claim loop now ranks runnable rows by LAP — position
 * within their own (profile, kind) line — before age, so each of an
 * account's job kinds is served in turn.
 *
 * These cases drive the REAL store (`postgresBackgroundJobStore`) against
 * real Postgres: the ordering, the window function, and the FOR UPDATE
 * restructure it forced are exactly what is under test, and an in-memory
 * model would prove none of them. `getDb()` is pointed at this suite's
 * isolated schema before its first call — vitest gives each file its own
 * worker, so the cached connection is this file's alone.
 *
 * The budget's own suite (`queue-model-budget.test.ts`) is deliberately
 * untouched: fairness decides WHICH of an account's due jobs spends the
 * budget next, never how much budget there is.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { postgresBackgroundJobStore } from "./queue.js";

let t: TestDatabase;
let seq = 0;

const NOW = new Date("2026-08-24T12:00:00Z");
const secondsAgo = (n: number) => new Date(NOW.getTime() - n * 1000).toISOString();

async function seedProfile(): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`fairness-${seq}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  return p.id as string;
}

async function seedJob(
  profileId: string,
  type: string,
  createdSecondsAgo: number,
): Promise<string> {
  const [row] = await t.sql`
    INSERT INTO background_jobs (profile_id, type, payload, status, run_after, created_at)
    VALUES (${profileId}, ${type}::background_job_type, '{}'::jsonb, 'pending',
            ${secondsAgo(createdSecondsAgo)}, ${secondsAgo(createdSecondsAgo)})
    RETURNING id`;
  return row.id as string;
}

beforeAll(async () => {
  t = await createTestDatabase();
  // Point the queue's own (cached, per-worker) connection at this suite's
  // schema before anything calls getDb().
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set("options", `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});

afterAll(async () => {
  await t?.cleanup();
});

describe("the queue serves each of an account's job kinds in turn", () => {
  beforeEach(async () => {
    await t.truncateAll();
  });

  it("claims the lone enrichment within the first drain pass, a hundred derivations ahead of it", async () => {
    const profileId = await seedProfile();
    // A hundred derivations enqueued first — the bulk-capture burst.
    for (let i = 0; i < 100; i += 1) {
      await seedJob(profileId, "derive_signals", 1000 - i);
    }
    // One enrichment, enqueued last of all.
    const enrichment = await seedJob(profileId, "enrich_attachment", 1);

    const first = await postgresBackgroundJobStore.claimNext(NOW);
    const second = await postgresBackgroundJobStore.claimNext(NOW);
    const claimed = [first, second].map((job) => job?.type);

    expect(
      claimed,
      "the first drain pass must reach the enrichment — lap one of each kind before lap two of any",
    ).toContain("enrich_attachment");
    expect([first?.id, second?.id]).toContain(enrichment);
    // And the burst is not punished either: its own oldest job went first.
    expect(first?.type).toBe("derive_signals");
  });

  it("keeps strict age order within one kind — fairness reorders across kinds only", async () => {
    const profileId = await seedProfile();
    const oldest = await seedJob(profileId, "derive_signals", 300);
    await seedJob(profileId, "derive_signals", 200);
    await seedJob(profileId, "derive_signals", 100);

    const first = await postgresBackgroundJobStore.claimNext(NOW);
    expect(first?.id, "one kind alone is plain FIFO, exactly as before").toBe(oldest);
  });

  it("peeks the same row the claim takes — the budget is asked about the right account", async () => {
    const profileId = await seedProfile();
    await seedJob(profileId, "derive_signals", 500);
    await seedJob(profileId, "enrich_attachment", 1);

    const head = await postgresBackgroundJobStore.headOfQueue(NOW);
    const claimed = await postgresBackgroundJobStore.claimNext(NOW);
    expect(head?.jobId, "peek and claim must choose the same row").toBe(claimed?.id);
  });
});
