import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { enqueueDeriveSignals, enqueueTopOfMindRefresh, enqueueGroupTopOfMindRefresh, postgresBackgroundJobStore, processBackgroundJob } from './queue.js';
import { setDefaultModelProviderForTests, type ModelProvider, type SignalSupportAssessmentInput, type TopOfMindSynthesisInput } from './model-provider.js';
import { GeminiEmbeddingHttpClient } from './inspiration-embeddings.js';
import { createGroupForProfile, joinGroupByCode } from '../routes/groups-membership.js';

let t: TestDatabase;
let originalUrl: string;
let sequence = 0;
let discover = true;
let supportVerdict: 'supported' | 'unsupported' = 'supported';
const extract = vi.fn(async () => ({ statements: discover ? [{ statement: 'Quiet helps me choose', quote: 'A saved source' }] : [] }));
beforeAll(async () => {
  t = await createTestDatabase(); originalUrl = process.env.DB_CONNECTION_URL!;
  const url = new URL(originalUrl); url.searchParams.set('options', `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});
beforeEach(async () => {
  vi.restoreAllMocks(); extract.mockReset(); discover = true; supportVerdict = 'supported';
  extract.mockImplementation(async () => ({ statements: discover ? [{ statement: 'Quiet helps me choose', quote: 'A saved source' }] : [] }));
  await t.truncateAll();
  vi.spyOn(GeminiEmbeddingHttpClient.prototype, 'embed').mockResolvedValue([1, ...new Array<number>(767).fill(0)]);
  setDefaultModelProviderForTests({ extractSignalCandidates: extract,
    assessSignalSupport: async (input: SignalSupportAssessmentInput) => ({ assessments: input.claims.map((claim) => ({ signalId: claim.signalId, verdict: supportVerdict, sourceIds: supportVerdict === 'supported' ? [input.sources[0]!.id] : [] })) }),
    synthesizeTopOfMind: async (input: TopOfMindSynthesisInput) => ({ entries: [{ type: 'hypothesis', body: 'A little quiet may help you choose.', citedSignalIds: [input.signals[0]!.id] }] }),
  } as unknown as ModelProvider);
});
afterAll(async () => { vi.restoreAllMocks(); setDefaultModelProviderForTests(null); process.env.DB_CONNECTION_URL = originalUrl; await t?.cleanup(); });
async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`complete-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'A saved source') RETURNING id`;
  const queued = await enqueueDeriveSignals(profile.id as string, source.id as string, 'created');
  return { profileId: profile.id as string, sourceId: source.id as string, receipt: queued.receipt };
}
const read = async (id: string) => (await t.sql`SELECT derived_at, completed_at, reading_job_id, reading_request_version::text, result FROM inspiration_processing WHERE id = ${id}`)[0];
async function runNext() {
  const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
  expect(job).not.toBeNull();
  const result = await processBackgroundJob(job!);
  await postgresBackgroundJobStore.markSucceeded(job!, result ?? null);
  return job!;
}

async function groupFixture() {
  const a = await fixture(), b = await fixture();
  await t.sql`DELETE FROM background_jobs`; // exercise only the room path
  const group = await createGroupForProfile(t.db as never, { profileId: a.profileId, name: 'Shared processing' });
  await joinGroupByCode(t.db as never, { profileId: b.profileId, joinCode: group.joinCode });
  const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id = ${group.id}`;
  await t.sql`UPDATE inspirations SET visibility = 'public' WHERE id IN (${a.sourceId}, ${b.sourceId})`;
  const first = await enqueueDeriveSignals(a.profileId, a.sourceId, 'created', mind.id as string);
  const second = await enqueueDeriveSignals(b.profileId, b.sourceId, 'created', mind.id as string);
  extract.mockImplementation(async () => ({ statements: [
    { statement: 'Quiet helps me choose', quote: 'A saved source' },
    { statement: 'Small experiments help me learn', quote: 'A saved source' },
  ] }));
  vi.mocked(GeminiEmbeddingHttpClient.prototype.embed).mockImplementation(async (text) =>
    [text === 'Small experiments help me learn' ? 0 : 1, text === 'Small experiments help me learn' ? 1 : 0, ...new Array<number>(766).fill(0)]);
  await runNext(); await runNext(); await runNext();
  return { a, b, group, mind, first, second };
}

describe('saved material reaches an actual reading', () => {
  it('does not publish a reading without its required principle-processing handoff', async () => {
    const f = await fixture(); await runNext();
    await t.sql`INSERT INTO signals(profile_id, statement) VALUES
      (${f.profileId}, 'One other durable pattern'), (${f.profileId}, 'Another durable pattern')`;
    const all = await t.sql`SELECT id FROM signals WHERE profile_id = ${f.profileId}`;
    for (const signal of all) {
      for (let n = 0; n < 3; n++) {
        const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${f.profileId}, ${`Evidence ${n}`}) RETURNING id`;
        await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id) VALUES (${f.profileId}, ${f.profileId}, ${signal.id}, ${source.id})`;
      }
      await t.sql`UPDATE signals SET status = 'active' WHERE id = ${signal.id}`;
    }
    setDefaultModelProviderForTests({ synthesizeTopOfMind: async (input: TopOfMindSynthesisInput) => ({
      entries: [{ type: 'pattern', body: 'A reading across the current patterns', citedSignalIds: input.signals.map((signal) => signal.id) }],
    }) } as unknown as ModelProvider);
    await t.sql`CREATE FUNCTION refuse_principle_request() RETURNS trigger AS $$ BEGIN
      IF NEW.type::text = 'refresh_principles' THEN RAISE EXCEPTION 'principle queue unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`;
    await t.sql`CREATE TRIGGER refuse_principle_request BEFORE INSERT ON background_jobs FOR EACH ROW EXECUTE FUNCTION refuse_principle_request()`;
    const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    try {
      await expect(processBackgroundJob(job!)).rejects.toMatchObject({ cause: { message: 'principle queue unavailable' } });
      expect(await t.sql`SELECT id FROM top_of_minds`).toHaveLength(0);
      expect((await read(f.receipt.id)).completed_at).toBeNull();
    } finally { await t.sql`DROP TRIGGER refuse_principle_request ON background_jobs`; await t.sql`DROP FUNCTION refuse_principle_request()`; }
    await processBackgroundJob(job!);
    expect((await read(f.receipt.id)).completed_at).not.toBeNull();
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'refresh_principles'`).toHaveLength(1);
  });

  it.each(['failed', 'missing'] as const)('recovers a %s earlier read instead of dropping the dependency on a no-change pass', async (state) => {
    const f = await fixture(); await runNext();
    const before = await read(f.receipt.id);
    if (state === 'missing') await t.sql`DELETE FROM background_jobs WHERE id = ${before.reading_job_id}`;
    else await t.sql`UPDATE background_jobs SET status = 'failed' WHERE id = ${before.reading_job_id}`;
    const next = await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited'); discover = false;
    await runNext();
    const recovered = await read(next.receipt.id);
    expect(recovered.reading_job_id).toBeTruthy();
    expect(recovered.reading_job_id).not.toBe(before.reading_job_id);
    expect(recovered.completed_at).toBeNull();
    await runNext();
    expect((await read(next.receipt.id)).completed_at).not.toBeNull();
  });

  it('a newer request for unchanged material is not acknowledged by an older reading before derivation', async () => {
    const f = await fixture(); await runNext();
    let newer = '';
    setDefaultModelProviderForTests({ synthesizeTopOfMind: async (input: TopOfMindSynthesisInput) => {
      newer = (await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited')).receipt.id;
      return { entries: [{ type: 'hypothesis', body: 'An actual new reading', citedSignalIds: [input.signals[0]!.id] }] };
    } } as unknown as ModelProvider);
    await runNext();
    expect((await read(f.receipt.id)).completed_at).not.toBeNull();
    expect(await read(newer)).toMatchObject({ derived_at: null, completed_at: null, result: null });
  });

  it('a failed support assessment never becomes a successful source completion', async () => {
    const f = await fixture(); await runNext(); await runNext();
    await t.sql`UPDATE inspirations SET text = 'Another thought' WHERE id = ${f.sourceId}`;
    const next = await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited');
    setDefaultModelProviderForTests({ assessSignalSupport: async () => { throw new Error('Provider unavailable'); },
      extractSignalCandidates: async () => ({ statements: [] }),
    } as unknown as ModelProvider);
    const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    await expect(processBackgroundJob(job!)).rejects.toThrow(/support could not be fully assessed/i);
    expect(await read(next.receipt.id)).toMatchObject({ derived_at: null, completed_at: null, result: null });
    expect((await t.sql`SELECT text FROM inspirations WHERE id = ${f.sourceId}`)[0].text).toBe('Another thought');
  });

  it('uses a published result even if its finished job is cleaned up before extraction finishes', async () => {
    const f = await fixture(); await runNext(); await runNext();
    await t.sql`UPDATE inspirations SET text = 'A different source' WHERE id = ${f.sourceId}`;
    const next = await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited');
    supportVerdict = 'unsupported'; discover = false;
    let published: unknown;
    extract.mockImplementationOnce(async () => {
      await enqueueTopOfMindRefresh(f.profileId, 'manual'); await runNext();
      const early = await read(next.receipt.id); published = early.result;
      await t.sql`DELETE FROM background_jobs WHERE id = ${early.reading_job_id}`;
      return { statements: [] };
    });
    await runNext();
    expect(await read(next.receipt.id)).toMatchObject({ completed_at: expect.anything(), reading_job_id: null, result: published });
    expect(await t.sql`SELECT id FROM top_of_minds WHERE profile_id = ${f.profileId}`).toHaveLength(2);
  });

  it('does not accept malformed cached completion as proof that material was read', async () => {
    const f = await fixture(); await runNext();
    const before = await read(f.receipt.id);
    await t.sql`UPDATE inspiration_processing SET result = '{"unexpected":"not a receipt"}'::jsonb WHERE id = ${f.receipt.id}`;
    await t.sql`UPDATE background_jobs SET status = 'succeeded' WHERE id = ${before.reading_job_id}`;
    const next = await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited'); discover = false;
    await runNext();
    expect(await read(next.receipt.id)).toMatchObject({ completed_at: null, result: null });
    expect((await read(next.receipt.id)).reading_job_id).not.toBe(before.reading_job_id);
  });

  it('a room receipt waits for a real shared reading, not merely a successful waiting-for-members job', async () => {
    const { a, group, mind, first, second } = await groupFixture();
    expect(await read(second.receipt.id)).toMatchObject({ derived_at: expect.anything(), completed_at: null, result: null });
    expect(await t.sql`SELECT id FROM top_of_minds WHERE group_id = ${group.id}`).toHaveLength(0);
    const signals = await t.sql`SELECT id FROM signals WHERE profile_id = ${mind.id}`;
    expect(signals).toHaveLength(2);
    for (const signal of signals) await t.sql`INSERT INTO feedback(profile_id, target_type, target_id, value)
      VALUES (${a.profileId}, 'signal', ${signal.id}, 'true')`;
    await enqueueGroupTopOfMindRefresh(a.profileId, group.id, 'signals_changed'); await runNext();
    const [artifact] = await t.sql`SELECT id, version FROM top_of_minds WHERE group_id = ${group.id} AND status = 'live'`;
    for (const receipt of [first.receipt, second.receipt]) expect(await read(receipt.id))
      .toMatchObject({ completed_at: expect.anything(), result: { topOfMindId: artifact.id, version: artifact.version } });
    expect((await read(a.receipt.id)).completed_at).toBeNull();
  });

  it.each(['withdrawn', 'left'] as const)('does not complete a room contribution after its source is %s', async (change) => {
    const { a, group, first, second } = await groupFixture();
    if (change === 'withdrawn') await t.sql`UPDATE inspirations SET visibility = 'private' WHERE id = ${a.sourceId}`;
    else await t.sql`DELETE FROM group_members WHERE group_id = ${group.id} AND profile_id = ${a.profileId}`;
    await enqueueGroupTopOfMindRefresh(a.profileId, group.id, 'signals_changed'); await runNext();
    expect((await read(first.receipt.id)).completed_at).toBeNull();
    if (change === 'left') expect((await read(first.receipt.id)).result).toBeNull();
    expect((await read(second.receipt.id)).completed_at).not.toBeNull();
  });

  it('does not complete either source revision after a source edit races with synthesis', async () => {
    const f = await fixture(); await runNext();
    let newer = '';
    setDefaultModelProviderForTests({ synthesizeTopOfMind: async (input: TopOfMindSynthesisInput) => {
      await t.sql`UPDATE inspirations SET text = 'Edited while reading' WHERE id = ${f.sourceId}`;
      newer = (await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited')).receipt.id;
      return { entries: [{ type: 'hypothesis', body: 'An outdated reading', citedSignalIds: [input.signals[0]!.id] }] };
    } } as unknown as ModelProvider);
    const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    await expect(processBackgroundJob(job!)).rejects.toThrow(/inputs changed/i);
    expect((await read(f.receipt.id)).completed_at).toBeNull();
    expect((await read(newer)).completed_at).toBeNull();
    expect(await t.sql`SELECT id FROM top_of_minds`).toHaveLength(0);
  });

  it('an empty reading must still own its worker claim before acknowledging a receipt', async () => {
    const f = await fixture();
    await t.sql`UPDATE background_jobs SET status = 'succeeded', completed_version = request_version WHERE id = ${f.receipt.jobId}`;
    const pending = await enqueueTopOfMindRefresh(f.profileId, 'manual');
    await t.sql`UPDATE inspiration_processing SET derived_at = now(), reading_job_id = ${pending.jobId}, reading_request_version = ${pending.requestVersion}::bigint WHERE id = ${f.receipt.id}`;
    const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    await t.sql`UPDATE background_jobs SET locked_at = now() + interval '2 seconds', attempts = attempts + 1 WHERE id = ${job!.id}`;
    await expect(processBackgroundJob(job!)).rejects.toThrow(/ownership changed/i);
    expect((await read(f.receipt.id)).completed_at).toBeNull();
  });

  it('recovers a committed derivation without buying extraction or another read request again', async () => {
    const f = await fixture();
    const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    await processBackgroundJob(job!);
    const before = await read(f.receipt.id);
    await processBackgroundJob(job!); // simulate recovery before settlement
    expect(extract).toHaveBeenCalledTimes(1);
    expect(await read(f.receipt.id)).toEqual(before);
    expect((await t.sql`SELECT request_version::text FROM background_jobs WHERE id = ${before.reading_job_id}`)[0].request_version).toBe('1');
  });

  it('retains a read that finishes during extraction without premature completion or a redundant second read', async () => {
    const f = await fixture(); await runNext(); await runNext();
    await t.sql`UPDATE inspirations SET text = 'A different source' WHERE id = ${f.sourceId}`;
    const next = await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited');
    supportVerdict = 'unsupported'; discover = false;
    let earlyResult: unknown;
    extract.mockImplementationOnce(async () => {
      expect((await read(next.receipt.id)).derived_at).toBeNull();
      await enqueueTopOfMindRefresh(f.profileId, 'manual');
      await runNext();
      const early = await read(next.receipt.id);
      expect(early.result).toBeTruthy();
      expect(early.completed_at).toBeNull();
      earlyResult = early.result;
      return { statements: [] };
    });
    await runNext();
    expect(await read(next.receipt.id)).toMatchObject({ derived_at: expect.anything(), completed_at: expect.anything(), result: earlyResult });
    expect(await t.sql`SELECT id FROM top_of_minds WHERE profile_id = ${f.profileId}`).toHaveLength(2);
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'refresh_top_of_mind'`).toHaveLength(2);
  });

  it('keeps the published dependency through an extraction failure and finishes it on retry', async () => {
    const f = await fixture(); await runNext(); await runNext();
    await t.sql`UPDATE inspirations SET text = 'A different source' WHERE id = ${f.sourceId}`;
    const next = await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited');
    supportVerdict = 'unsupported'; discover = false;
    extract.mockImplementationOnce(async () => {
      await enqueueTopOfMindRefresh(f.profileId, 'manual'); await runNext();
      throw new Error('Extraction temporarily unavailable');
    });
    const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    await expect(processBackgroundJob(job!)).rejects.toThrow('Extraction temporarily unavailable');
    const early = await read(next.receipt.id);
    expect(early.result).toBeTruthy(); expect(early.completed_at).toBeNull(); expect(early.derived_at).toBeNull();
    await processBackgroundJob(job!);
    expect(await read(next.receipt.id)).toMatchObject({ completed_at: expect.anything(), result: early.result });
    expect(await t.sql`SELECT id FROM top_of_minds WHERE profile_id = ${f.profileId}`).toHaveLength(2);
  });

  it('publishes no artifact if its processing receipt cannot commit', async () => {
    const f = await fixture(); await runNext();
    const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    await t.sql`CREATE FUNCTION refuse_processing_result() RETURNS trigger AS $$ BEGIN
      IF NEW.result IS NOT NULL THEN RAISE EXCEPTION 'receipt unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`;
    await t.sql`CREATE TRIGGER refuse_processing_result BEFORE UPDATE ON inspiration_processing FOR EACH ROW EXECUTE FUNCTION refuse_processing_result()`;
    try {
      await expect(processBackgroundJob(job!)).rejects.toMatchObject({ cause: { message: 'receipt unavailable' } });
      expect(await t.sql`SELECT id FROM top_of_minds`).toHaveLength(0);
      expect((await read(f.receipt.id)).completed_at).toBeNull();
    } finally { await t.sql`DROP TRIGGER refuse_processing_result ON inspiration_processing`; await t.sql`DROP FUNCTION refuse_processing_result()`; }
    await processBackgroundJob(job!);
    expect((await read(f.receipt.id)).completed_at).not.toBeNull();
  });

  it('does not certify material whose attachment is still being enriched', async () => {
    const f = await fixture(); discover = false;
    const [attachment] = await t.sql`INSERT INTO attachments(profile_id, inspiration_id, type, url, enrichment_status)
      VALUES (${f.profileId}, ${f.sourceId}, 'link', 'https://example.test/fixture', 'pending') RETURNING id`;
    const pending = await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited'); await runNext();
    expect(await read(pending.receipt.id)).toMatchObject({ derived_at: null, completed_at: null });
    await t.sql`UPDATE attachments SET enrichment_status = 'ready', enrichment_kind = 'page_body', enrichment_text = 'Fetched context' WHERE id = ${attachment.id}`;
    const ready = await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited'); await runNext();
    expect((await read(ready.receipt.id)).completed_at).not.toBeNull();
    expect((await read(pending.receipt.id)).completed_at).toBeNull();
  });

  it('separates derivation, queued reading and published completion', async () => {
    const f = await fixture();
    await runNext();
    const derived = await read(f.receipt.id);
    expect(derived.derived_at).not.toBeNull();
    expect(derived.reading_job_id).toBeTruthy();
    expect(derived.completed_at).toBeNull();
    await runNext();
    const finished = await read(f.receipt.id);
    const [artifact] = await t.sql`SELECT id, version FROM top_of_minds WHERE profile_id = ${f.profileId} AND status = 'live'`;
    expect(finished.completed_at).not.toBeNull();
    expect(finished.result).toEqual({ kind: 'top_of_mind', topOfMindId: artifact.id, version: artifact.version, outcome: 'changed' });
  });

  it('finishes genuine no-change work without queuing an unnecessary synthesis', async () => {
    discover = false; const f = await fixture();
    await runNext();
    expect(await read(f.receipt.id)).toMatchObject({ derived_at: expect.anything(), completed_at: expect.anything(),
      reading_job_id: null, result: { kind: 'top_of_mind', topOfMindId: null, version: 0, outcome: 'empty' } });
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'refresh_top_of_mind'`).toHaveLength(0);
  });

  it('keeps an earlier unfinished read dependency when a newer source pass changes nothing', async () => {
    const f = await fixture(); await runNext();
    const earlier = await read(f.receipt.id);
    await t.sql`UPDATE background_jobs SET run_after = now() + interval '1 day' WHERE id = ${earlier.reading_job_id}`;
    await t.sql`UPDATE inspirations SET text = 'The source changed, but the pattern still holds' WHERE id = ${f.sourceId}`;
    const next = await enqueueDeriveSignals(f.profileId, f.sourceId, 'edited');
    discover = false; await runNext();
    expect(await read(next.receipt.id)).toMatchObject({ derived_at: expect.anything(), completed_at: null, reading_job_id: earlier.reading_job_id });
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'refresh_top_of_mind'`).toHaveLength(1);
    await enqueueTopOfMindRefresh(f.profileId, 'manual'); await runNext();
    expect((await read(next.receipt.id)).completed_at).not.toBeNull();
    expect((await read(f.receipt.id)).completed_at).toBeNull(); // superseded, not retrospectively claimed
  });
});
