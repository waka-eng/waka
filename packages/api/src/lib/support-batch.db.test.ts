/** Real source jobs, review records and queue settlement in isolated Postgres.
 * Provider responses and vectors are synthetic; no model/network calls. */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { drainBackgroundJobs, enqueueDeriveSignals, postgresBackgroundJobStore, processBackgroundJob } from './queue.js';
import { setDefaultModelProviderForTests, type ModelProvider, type SignalSupportAssessmentInput, type TopOfMindSynthesisInput } from './model-provider.js';
import { GeminiEmbeddingHttpClient } from './inspiration-embeddings.js';
import { BackgroundJobHeldError } from './background-job-hold.js';
import { reviewSignalSupport } from './signal-support-review.js';
import { applySignalSupportReview } from './signal-support-apply.js';
import { recoverInspirationProcessing } from './inspiration-processing-recovery.js';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase, sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db; });
afterAll(async () => { setDefaultModelProviderForTests(null); vi.restoreAllMocks(); await t?.cleanup(); });
afterEach(() => vi.useRealTimers());

async function fixture(count = 13) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`batch-scope-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'Quiet work matters') RETURNING id`;
  const ids: string[] = [];
  for (let n = 0; n < count; n++) {
    const [signal] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${profile.id}, ${`Claim ${n}`}) RETURNING id`;
    ids.push(signal.id as string);
    await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${profile.id}, ${profile.id}, ${signal.id}, ${source.id})`;
  }
  await t.sql`UPDATE inspirations SET text = 'Current context for quiet work' WHERE id = ${source.id}`;
  return { profileId: profile.id as string, sourceId: source.id as string, ids };
}

const positive = vi.fn(async (input: SignalSupportAssessmentInput) => ({ assessments: input.claims.map((claim) => ({
  signalId: claim.signalId, verdict: 'supported' as const, sourceIds: [input.sources[0]!.id],
})) }));

async function plan(f: Awaited<ReturnType<typeof fixture>>) {
  const queued = await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited');
  const parent = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
  expect(parent?.id).toBe(queued.jobId);
  try { await processBackgroundJob(parent!); throw new Error('Coverage must wait for its paid batches'); }
  catch (error) {
    expect(error).toBeInstanceOf(BackgroundJobHeldError);
    await postgresBackgroundJobStore.holdJob(parent!, (error as BackgroundJobHeldError).heldUntil, 'support');
  }
  const child = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
  expect(child?.type).toBe('assess_signal_support');
  return { queued, parent: parent!, child: child! };
}

describe('bounded support coverage', () => {
  it('a selected report cannot apply a verdict to an unselected claim', async () => {
    const f = await fixture();
    const report = await reviewSignalSupport(t.db as never, { ownerProfileId: f.profileId, inspirationId: f.sourceId,
      signalIds: f.ids.slice(0, 12), provider: { assessSignalSupport: positive }, maxCalls: 1 });
    const forged = { ...report, items: [...report.items, { signalId: f.ids[12], statementHash: report.items[0]!.statementHash,
      verdict: 'unsupported', sourceIds: [] }] };
    await expect(applySignalSupportReview(t.db as never, forged)).rejects.toThrow(/coverage mismatch/);
    expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(13);
    expect(await t.sql`SELECT review_id FROM signal_support_reviews`).toHaveLength(0);
  });

  it.each(['material', 'statement'])('drops a batch changed before its %s is assessed, without a provider call', async (change) => {
    const f = await fixture(); positive.mockClear();
    setDefaultModelProviderForTests({ assessSignalSupport: positive } as unknown as ModelProvider);
    const { child } = await plan(f);
    if (change === 'material') await t.sql`UPDATE inspirations SET text = 'Newer material' WHERE id = ${f.sourceId}`;
    else {
      const id = (child.payload as { signalIds: string[] }).signalIds[0]!;
      await t.sql`UPDATE signals SET statement = 'Newer wording', locked_at = now() WHERE id = ${id}`;
    }
    await processBackgroundJob(child);
    await postgresBackgroundJobStore.markSucceeded(child, null);
    expect(positive).not.toHaveBeenCalled();
    expect(await t.sql`SELECT review_id FROM signal_support_reviews`).toHaveLength(0);
    expect((await t.sql`SELECT status FROM background_jobs WHERE id = ${child.id}`)[0].status).toBe('succeeded');
  });

  it('a reclaimed paid batch cannot persist its verdicts', async () => {
    const f = await fixture();
    setDefaultModelProviderForTests({ assessSignalSupport: positive } as unknown as ModelProvider);
    const { child } = await plan(f);
    setDefaultModelProviderForTests({ assessSignalSupport: async (input: SignalSupportAssessmentInput) => {
      await t.sql`UPDATE background_jobs SET locked_at = locked_at + interval '2 seconds', attempts = attempts + 1 WHERE id = ${child.id}`;
      return positive(input);
    } } as unknown as ModelProvider);
    await expect(processBackgroundJob(child)).rejects.toThrow(/ownership changed/);
    expect(await t.sql`SELECT review_id FROM signal_support_reviews`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(13);
  });

  it('source retry resumes failed paid batches without replacing the saved words', async () => {
    const f = await fixture();
    setDefaultModelProviderForTests({ assessSignalSupport: positive } as unknown as ModelProvider);
    const { queued, child } = await plan(f);
    await t.sql`UPDATE background_jobs SET status = 'failed' WHERE id IN (${queued.jobId}, ${child.id})`;
    const before = await t.sql`SELECT request_version::text FROM background_jobs WHERE id = ${child.id}`;
    await recoverInspirationProcessing(t.db as never, { profileId: f.profileId, inspirationId: f.sourceId, receiptId: queued.receipt.id });
    const [after] = await t.sql`SELECT status, request_version::text, attempts FROM background_jobs WHERE id = ${child.id}`;
    expect(after.status).toBe('pending'); expect(after.attempts).toBe(0);
    expect(BigInt(after.request_version)).toBe(BigInt(before[0].request_version) + 1n);
    expect((await t.sql`SELECT text FROM inspirations WHERE id = ${f.sourceId}`)[0].text).toBe('Current context for quiet work');
  });

  it('checks forty claims without exhausting retry attempts or repeating discovery', async () => {
    const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`batches-${++sequence}@example.test`}) RETURNING id`;
    const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
    const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'A changed thought about quiet work') RETURNING id`;
    for (let i = 0; i < 40; i++) {
      const [signal] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${profile.id}, ${`Claim ${i}`}) RETURNING id`;
      await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
        VALUES (${profile.id}, ${profile.id}, ${signal.id}, ${source.id})`;
    }
    await t.sql`UPDATE inspirations SET text = 'New context about quiet work' WHERE id = ${source.id}`;
    const assess = vi.fn(async (input: SignalSupportAssessmentInput) => ({ assessments: input.claims.map((claim) => ({
      signalId: claim.signalId, verdict: 'supported' as const, sourceIds: [input.sources[0]!.id],
    })) }));
    const extract = vi.fn(async () => ({ statements: [] }));
    setDefaultModelProviderForTests({ assessSignalSupport: assess, extractSignalCandidates: extract,
      synthesizeTopOfMind: async (input: TopOfMindSynthesisInput) => ({ entries: [{ type: 'hypothesis', body: 'Quiet work is a current thread', citedSignalIds: [input.signals[0]!.id] }] }),
    } as unknown as ModelProvider);
    vi.spyOn(GeminiEmbeddingHttpClient.prototype, 'embed').mockResolvedValue([1, ...new Array<number>(767).fill(0)]);
    const queued = await enqueueDeriveSignals(profile.id as string, source.id as string, 'edited');
    vi.useFakeTimers({ toFake: ['Date'] });
    let now = new Date(), failures = 0;
    for (let i = 0; i < 10; i++) {
      vi.setSystemTime(now);
      const result = await drainBackgroundJobs({ limit: 50, now }); failures += result.failed;
      const [job] = await t.sql`SELECT status FROM background_jobs WHERE id = ${queued.jobId}`;
      if (job.status === 'succeeded' || job.status === 'failed') break;
      const [next] = await t.sql`SELECT min(run_after) AS due FROM background_jobs WHERE status = 'pending'`;
      if (!next.due) break;
      now = new Date(Math.max(Date.now(), new Date(next.due).getTime()) + 1);
    }
    expect(failures).toBe(0);
    expect((await t.sql`SELECT status FROM background_jobs WHERE id = ${queued.jobId}`)[0].status).toBe('succeeded');
    expect(assess).toHaveBeenCalledTimes(4);
    expect(await t.sql`SELECT id FROM background_jobs WHERE type::text = 'assess_signal_support' AND started_at IS NOT NULL`).toHaveLength(4);
    expect(assess.mock.calls.every(([input]) => input.claims.length <= 12)).toBe(true);
    expect(new Set(assess.mock.calls.flatMap(([input]) => input.claims.map((claim) => claim.signalId))).size).toBe(40);
    expect(extract).toHaveBeenCalledOnce();
    expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(40);
    const [progress] = await t.sql`SELECT derived_at, completed_at, reading_job_id, result FROM inspiration_processing WHERE id = ${queued.receipt.id}`;
    expect(progress.derived_at).not.toBeNull(); expect(progress.reading_job_id).not.toBeNull();
    if (progress.completed_at) {
      expect(progress.result.topOfMindId).toBeTruthy();
      expect(await t.sql`SELECT id FROM top_of_minds WHERE id = ${progress.result.topOfMindId} AND profile_id = ${profile.id}`).toHaveLength(1);
    }
  });
});
