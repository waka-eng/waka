/** Real statement writes and queue rows in isolated Postgres. Authentication
 * and the database factory are scoped to this fixture; no model runs here. */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { createSignalRoutes } from './signals.js';
import type { AuthEnv } from '../lib/middleware.js';
import { setDefaultModelProviderForTests, type ModelProvider, type SignalSupportAssessmentInput } from '../lib/model-provider.js';
import { postgresBackgroundJobStore, processBackgroundJob } from '../lib/queue.js';
import { reviewSignalSupport } from '../lib/signal-support-review.js';
import { applySignalSupportReview } from '../lib/signal-support-apply.js';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('../lib/db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase, sequence = 0;
beforeEach(async () => { setDefaultModelProviderForTests(null); t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db; });
afterAll(async () => { await t?.cleanup(); });

async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`wording-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [signal] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${profile.id}, 'Original statement') RETURNING id`;
  const sources: string[] = [];
  for (let i = 0; i < 2; i++) {
    const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, ${`Owned source ${i}`}) RETURNING id`;
    sources.push(source.id as string);
    await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${profile.id}, ${profile.id}, ${signal.id}, ${source.id})`;
  }
  const vector = [1, ...new Array<number>(767).fill(0)];
  await t.sql`INSERT INTO signal_embeddings(profile_id, signal_id, model, dimensions, input_hash, embedding)
    VALUES (${profile.id}, ${signal.id}, 'synthetic-test-model', 768, 'old-hash', ${JSON.stringify(vector)}::jsonb)`;
  const app = new Hono<AuthEnv>();
  app.onError(() => new Response(JSON.stringify({ error: 'statement write failed' }), { status: 500 }));
  app.route('/api/signals', createSignalRoutes({ getDatabase: () => t.db as never,
    authMiddleware: async (c, next) => {
      c.set('session', { sessionId: randomUUID(), account: { id: account.id as string, email: 'wording@example.test' },
        profile: { id: profile.id as string, accountId: account.id as string, type: 'human', name: 'Owner', preferredLocale: 'en-US' } });
      await next();
    },
  }));
  const edit = (statement = 'My revised statement') => app.request(`/api/signals/${signal.id}`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ statement }),
  });
  return { app, edit, profileId: profile.id as string, signalId: signal.id as string, sources };
}

describe('statement edits keep their required work', () => {
  it.each(['reembed_signal', 'review_signal_support', 'refresh_top_of_mind'])('rolls back wording, chain and vector when %s insertion fails', async (type) => {
    const f = await fixture();
    await t.sql.unsafe(`CREATE FUNCTION refuse_statement_work() RETURNS trigger AS $$ BEGIN
      IF NEW.type::text = '${type}' THEN RAISE EXCEPTION 'synthetic job-store failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await t.sql`CREATE TRIGGER refuse_statement_work BEFORE INSERT ON background_jobs FOR EACH ROW EXECUTE FUNCTION refuse_statement_work()`;
    try {
      expect((await f.edit()).status).toBe(500);
      expect(await t.sql`SELECT statement, locked_at FROM signals WHERE id = ${f.signalId}`).toEqual([{ statement: 'Original statement', locked_at: null }]);
      expect(await t.sql`SELECT id FROM signal_statements`).toHaveLength(0);
      expect(await t.sql`SELECT signal_id FROM signal_embeddings`).toHaveLength(1);
      expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
      expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(0);
    } finally {
      await t.sql`DROP TRIGGER refuse_statement_work ON background_jobs`;
      await t.sql`DROP FUNCTION refuse_statement_work()`;
    }
  });

  it('schedules one recheck per owned witness alongside re-embedding and rereading', async () => {
    const f = await fixture();
    expect((await f.edit()).status).toBe(200);
    const jobs = await t.sql`SELECT type, payload, profile_id FROM background_jobs`;
    expect(jobs.filter((job) => job.type === 'review_signal_support').map((job) => job.payload.inspirationId).sort()).toEqual(f.sources.sort());
    expect(jobs.every((job) => job.profile_id === f.profileId)).toBe(true);
    expect(jobs.filter((job) => job.type === 'reembed_signal')).toHaveLength(1);
    expect(jobs.filter((job) => job.type === 'refresh_top_of_mind')).toHaveLength(1);
    expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(0);
    expect(jobs.filter((job) => job.type === 'derive_signals')).toHaveLength(0);
    expect(await t.sql`SELECT signal_id FROM signal_embeddings`).toHaveLength(0);
    expect((await t.sql`SELECT statement, locked_at FROM signals WHERE id = ${f.signalId}`)[0])
      .toMatchObject({ statement: 'My revised statement', locked_at: expect.anything() });
  });

  it('an identical already-locked edit adds no chain or processing request', async () => {
    const f = await fixture();
    expect((await f.edit()).status).toBe(200);
    const chain = await t.sql`SELECT * FROM signal_statements ORDER BY created_at, id`;
    const jobs = await t.sql`SELECT id, request_version::text FROM background_jobs ORDER BY id`;
    const receipts = await t.sql`SELECT id FROM inspiration_processing ORDER BY id`;
    expect((await f.edit()).status).toBe(200);
    expect(await t.sql`SELECT * FROM signal_statements ORDER BY created_at, id`).toEqual(chain);
    expect(await t.sql`SELECT id, request_version::text FROM background_jobs ORDER BY id`).toEqual(jobs);
    expect(await t.sql`SELECT id FROM inspiration_processing ORDER BY id`).toEqual(receipts);
  });

  it('revert also carries its support rechecks in the same transaction', async () => {
    const f = await fixture();
    expect((await f.edit()).status).toBe(200);
    await t.sql`DELETE FROM background_jobs`;
    const response = await f.app.request(`/api/signals/${f.signalId}/revert`, { method: 'POST' });
    expect(response.status).toBe(200);
    expect((await t.sql`SELECT statement, locked_at FROM signals WHERE id = ${f.signalId}`)[0])
      .toEqual({ statement: 'Original statement', locked_at: null });
    const jobs = await t.sql`SELECT type, payload FROM background_jobs`;
    expect(jobs.filter((job) => job.type === 'review_signal_support').map((job) => job.payload.inspirationId).sort()).toEqual(f.sources.sort());
    expect(jobs.filter((job) => job.type === 'reembed_signal')).toHaveLength(1);
    expect(jobs.filter((job) => job.type === 'refresh_top_of_mind')).toHaveLength(1);
  });

  it('support jobs assess edited claims without extraction, vectors or false source completion', async () => {
    const f = await fixture(); expect((await f.edit()).status).toBe(200);
    await t.sql`UPDATE background_jobs SET run_after = now() + interval '1 day' WHERE type::text <> 'review_signal_support'`;
    const extract = vi.fn(async () => { throw new Error('Support review must not discover candidates'); });
    const assess = vi.fn(async (input: SignalSupportAssessmentInput) => {
      expect(input.claims).toEqual([{ signalId: f.signalId, statement: 'My revised statement' }]);
      return { assessments: input.claims.map((claim) => ({ signalId: claim.signalId, verdict: 'unsupported' as const, sourceIds: [] })) };
    });
    setDefaultModelProviderForTests({ extractSignalCandidates: extract, assessSignalSupport: assess } as unknown as ModelProvider);
    try {
      for (let i = 0; i < 2; i++) {
        const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
        expect(job?.type).toBe('review_signal_support');
        await processBackgroundJob(job!);
        await postgresBackgroundJobStore.markSucceeded(job!, null);
      }
      expect(assess).toHaveBeenCalledTimes(2); expect(extract).not.toHaveBeenCalled();
      expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(0);
      expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(2);
      expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(0);
      expect((await t.sql`SELECT statement, locked_at, unsupported_at FROM signals WHERE id = ${f.signalId}`)[0])
        .toMatchObject({ statement: 'My revised statement', locked_at: expect.anything(), unsupported_at: expect.anything() });
    } finally { setDefaultModelProviderForTests(null); }
  });

  it('rechecks previously withdrawn witnesses and can restore support for the edited wording', async () => {
    const f = await fixture();
    const report = await reviewSignalSupport(t.db as never, { ownerProfileId: f.profileId, inspirationId: f.sources[0]!, maxCalls: 1,
      provider: { assessSignalSupport: async (input) => ({ assessments: input.claims.map((claim) => ({ signalId: claim.signalId,
        verdict: 'unsupported', sourceIds: [] })) }) } });
    await applySignalSupportReview(t.db as never, report);
    expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(1);
    await t.sql`DELETE FROM background_jobs`;
    expect((await f.edit()).status).toBe(200);
    expect(await t.sql`SELECT id FROM background_jobs WHERE type::text = 'review_signal_support'`).toHaveLength(2);
    await t.sql`UPDATE background_jobs SET run_after = now() + interval '1 day' WHERE type::text <> 'review_signal_support'`;
    setDefaultModelProviderForTests({ assessSignalSupport: async (input: SignalSupportAssessmentInput) => ({
      assessments: input.claims.map((claim) => ({ signalId: claim.signalId, verdict: 'supported', sourceIds: [input.sources[0]!.id] })),
    }) } as unknown as ModelProvider);
    try {
      for (let i = 0; i < 2; i++) {
        const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
        expect(job?.type).toBe('review_signal_support');
        await processBackgroundJob(job!); await postgresBackgroundJobStore.markSucceeded(job!, null);
      }
      expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(2);
      expect((await t.sql`SELECT statement, locked_at FROM signals WHERE id = ${f.signalId}`)[0])
        .toMatchObject({ statement: 'My revised statement', locked_at: expect.anything() });
    } finally { setDefaultModelProviderForTests(null); }
  });

  it('yields to a concurrent source writer without changing words or stranding work', async () => {
    const f = await fixture();
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const untilReleased = new Promise<void>((resolve) => { release = resolve; });
    const holding = other.begin(async (tx) => {
      await tx`SELECT id FROM inspirations WHERE id = ${f.sources[0]} FOR UPDATE`;
      locked(); await untilReleased;
    });
    try {
      await ready;
      expect((await f.edit()).status).toBe(409);
      expect(await t.sql`SELECT statement FROM signals WHERE id = ${f.signalId}`).toEqual([{ statement: 'Original statement' }]);
      expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
    } finally { release(); await holding; await other.end(); }
    expect((await f.edit()).status).toBe(200);
  });

  it('a reclaimed support worker cannot apply its negative verdict', async () => {
    const f = await fixture(); expect((await f.edit()).status).toBe(200);
    await t.sql`UPDATE background_jobs SET run_after = now() + interval '1 day' WHERE type::text <> 'review_signal_support'`;
    const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    expect(job?.type).toBe('review_signal_support');
    setDefaultModelProviderForTests({ assessSignalSupport: async (input: SignalSupportAssessmentInput) => {
      await t.sql`UPDATE background_jobs SET locked_at = locked_at + interval '2 seconds', attempts = attempts + 1 WHERE id = ${job!.id}`;
      return { assessments: input.claims.map((claim) => ({ signalId: claim.signalId, verdict: 'unsupported', sourceIds: [] })) };
    } } as unknown as ModelProvider);
    try {
      await expect(processBackgroundJob(job!)).rejects.toThrow(/ownership changed/);
      expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(2);
      expect(await t.sql`SELECT review_id FROM signal_support_reviews`).toHaveLength(0);
      expect((await t.sql`SELECT statement FROM signals WHERE id = ${f.signalId}`)[0].statement).toBe('My revised statement');
    } finally { setDefaultModelProviderForTests(null); }
  });

  it('a failed revert handoff preserves the edited words and current chain', async () => {
    const f = await fixture(); expect((await f.edit()).status).toBe(200);
    await t.sql`DELETE FROM background_jobs`;
    const chain = await t.sql`SELECT * FROM signal_statements ORDER BY created_at, id`;
    await t.sql`CREATE FUNCTION refuse_revert_work() RETURNS trigger AS $$ BEGIN
      IF NEW.type::text = 'review_signal_support' THEN RAISE EXCEPTION 'synthetic review-store failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`;
    await t.sql`CREATE TRIGGER refuse_revert_work BEFORE INSERT ON background_jobs FOR EACH ROW EXECUTE FUNCTION refuse_revert_work()`;
    try {
      expect((await f.app.request(`/api/signals/${f.signalId}/revert`, { method: 'POST' })).status).toBe(500);
      expect((await t.sql`SELECT statement, locked_at FROM signals WHERE id = ${f.signalId}`)[0])
        .toMatchObject({ statement: 'My revised statement', locked_at: expect.anything() });
      expect(await t.sql`SELECT * FROM signal_statements ORDER BY created_at, id`).toEqual(chain);
      expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
    } finally {
      await t.sql`DROP TRIGGER refuse_revert_work ON background_jobs`;
      await t.sql`DROP FUNCTION refuse_revert_work()`;
    }
  });
});
