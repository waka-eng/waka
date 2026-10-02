import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { postgresBackgroundJobStore } from './queue.js';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase;
let sequence = 0;
const now = new Date('2026-10-01T12:00:00Z');

beforeAll(async () => {
  t = await createTestDatabase();
  state.db = t.db;
  // Only this disposable schema gains a simulated future deployment's type.
  await t.sql`ALTER TYPE background_job_type ADD VALUE 'rollout_future_job'`;
});
beforeEach(async () => { await t.truncateAll(); });
afterAll(async () => { await t?.cleanup(); });

it.each(['pending', 'running'])('leaves a newer %s job untouched while processing known work', async (status) => {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`rollout-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [future] = await t.sql`INSERT INTO background_jobs(profile_id, type, payload, status, run_after, locked_at)
    VALUES (${profile.id}, 'rollout_future_job', '{}', ${status}::background_job_status,
      '2026-09-30T00:00:00Z', ${status === 'running' ? '2026-09-30T00:00:00Z' : null}) RETURNING id`;
  const [known] = await t.sql`INSERT INTO background_jobs(profile_id, type, payload, run_after)
    VALUES (${profile.id}, 'derive_signals', '{}', '2026-10-01T00:00:00Z') RETURNING id`;

  expect((await postgresBackgroundJobStore.headOfQueue(now))?.jobId).toBe(known.id);
  expect((await postgresBackgroundJobStore.claimNext(now))?.id).toBe(known.id);
  expect(await postgresBackgroundJobStore.headOfQueue(now)).toBeNull();
  expect(await postgresBackgroundJobStore.claimNext(now)).toBeNull();
  const [untouched] = await t.sql`SELECT status, attempts, started_at, last_error FROM background_jobs WHERE id = ${future.id}`;
  expect(untouched).toEqual({ status, attempts: 0, started_at: null, last_error: null });
});
