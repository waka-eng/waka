/** Real save/read/recovery routes and queue processing in disposable Postgres.
 * Only authentication, model responses and embeddings are injected. This is
 * backend journey evidence, not browser, deployment or model-quality evidence. */
import { randomUUID } from 'node:crypto';
import { Hono, type MiddlewareHandler } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import type { AuthEnv } from '../lib/middleware.js';
import { GeminiEmbeddingHttpClient } from '../lib/inspiration-embeddings.js';
import type { InspirationProcessingStatus } from '../lib/inspiration-processing-status.js';
import { setDefaultModelProviderForTests, type ModelProvider, type SignalCandidateExtractionInput,
  type SignalSupportAssessmentInput, type TopOfMindSynthesisInput } from '../lib/model-provider.js';
import { drainBackgroundJobs } from '../lib/queue.js';
import { createInspirationsRoutes } from './inspirations.js';
import { createTopOfMindRoutes, getLiveTopOfMind } from './top-of-mind.js';
import type { readSavedInspiration, readSavedReflection } from './inspirations-save-requests.js';

type SavedSource = Awaited<ReturnType<typeof readSavedInspiration>>;
type SavedAnswer = Awaited<ReturnType<typeof readSavedReflection>>;
const answers = [
  { question: 'What caught your attention?', answer: 'The evening felt unhurried.' },
  { question: 'What helped you decide?', answer: 'Taking a quiet walk helps me choose.' },
  { question: 'What would you try next?', answer: 'I might leave more space in the afternoon.' },
];
const statement = 'Quiet walks help me choose';
const wording = 'A little quiet may help you choose.';
let t: TestDatabase, originalUrl: string;
let sequence = 0;
const extract = vi.fn<ModelProvider['extractSignalCandidates']>();
const assess = vi.fn<ModelProvider['assessSignalSupport']>();
const synthesize = vi.fn<ModelProvider['synthesizeTopOfMind']>();

beforeAll(async () => {
  t = await createTestDatabase();
  originalUrl = process.env.DB_CONNECTION_URL!;
  const url = new URL(originalUrl);
  url.searchParams.set('options', `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});
beforeEach(async () => {
  vi.restoreAllMocks(); extract.mockReset(); assess.mockReset(); synthesize.mockReset();
  await t.truncateAll();
  vi.spyOn(GeminiEmbeddingHttpClient.prototype, 'embed').mockResolvedValue([1, ...new Array<number>(767).fill(0)]);
  extract.mockImplementation(async (input: SignalCandidateExtractionInput) => ({
    statements: input.reflections.some((answer) => answer.answer === answers[1]!.answer)
      ? [{ statement, quote: answers[1]!.answer }] : [],
  }));
  assess.mockImplementation(async (input: SignalSupportAssessmentInput) => {
    const witness = input.sources.find((source) => source.kind === 'reflection'
      && source.text.endsWith(`\nAnswer: ${answers[1]!.answer}`));
    return { assessments: input.claims.map((claim) => ({ signalId: claim.signalId,
      verdict: witness ? 'supported' : 'unsupported', sourceIds: witness ? [witness.id] : [] })) };
  });
  synthesize.mockImplementation(async (input: TopOfMindSynthesisInput) => ({
    entries: [{ type: 'hypothesis', body: wording, citedSignalIds: input.signals.map((signal) => signal.id) }],
  }));
  setDefaultModelProviderForTests({ extractSignalCandidates: extract, assessSignalSupport: assess,
    synthesizeTopOfMind: synthesize } as unknown as ModelProvider);
});
afterAll(async () => {
  vi.restoreAllMocks(); setDefaultModelProviderForTests(null);
  process.env.DB_CONNECTION_URL = originalUrl;
  await t?.cleanup();
});

async function actor() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`journey-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const profileId = profile.id as string;
  const authMiddleware: MiddlewareHandler<AuthEnv> = async (c, next) => {
    c.set('session', { sessionId: randomUUID(), account: { id: account.id as string, email: 'journey@example.test' },
      profile: { id: profileId, accountId: account.id as string, type: 'human', name: 'Owner', preferredLocale: 'en-US' } });
    await next();
  };
  const app = new Hono<AuthEnv>();
  const deps = { getDatabase: () => t.db as never, authMiddleware };
  app.route('/api/inspirations', createInspirationsRoutes(deps));
  app.route('/api/top-of-mind', createTopOfMindRoutes(deps));
  const post = (path: string, body: unknown, key: string = randomUUID()) => app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body),
  });
  return { app, post, profileId };
}

async function saveThreeAnswers() {
  const f = await actor();
  const sourceInput = { text: 'An unhurried evening', visibility: 'private' };
  const sourceKey = randomUUID();
  const created = await f.post('/api/inspirations', sourceInput, sourceKey);
  expect(created.status).toBe(201);
  const source = await created.json() as SavedSource;
  const path = `/api/inspirations/${source.inspiration.id}`;
  const saved: SavedAnswer[] = [];
  const keys: string[] = [];
  for (const answer of answers) {
    const key = randomUUID(); keys.push(key);
    const response = await f.post(`${path}/reflections`, answer, key);
    expect(response.status).toBe(201);
    saved.push(await response.json() as SavedAnswer);
  }
  // An unknown response is reconciled by lookup and an identical replay,
  // never by inventing a new identity or incrementing evidence a second time.
  const replay = await f.post(`${path}/reflections`, answers[2], keys[2]);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({ reflection: saved[2]!.reflection, processing: saved[2]!.processing });
  expect((await f.app.request(`/api/inspirations/save-requests/${keys[2]}`)).status).toBe(200);
  expect((await f.post('/api/inspirations', sourceInput, sourceKey)).status).toBe(200);
  const status = async (receipt = source.processing!.id) => {
    const response = await f.app.request(`${path}/processing?receipt=${receipt}`);
    expect(response.status).toBe(200);
    return await response.json() as InspirationProcessingStatus;
  };
  expect(await status()).toMatchObject({ phase: 'queued', superseded: true, result: null });
  expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
  expect(await t.sql`SELECT id FROM reflections`).toHaveLength(3);
  return { ...f, path, source, saved, keys, status };
}

async function drain() {
  const result = await drainBackgroundJobs({ limit: 10, now: new Date(Date.now() + 1000) });
  expect(result.retried).toBe(0);
  expect(result.failed).toBe(0);
  expect(result.deferred).toBe(0);
  return result;
}

describe('personal learning journey', () => {
  it.each([false, true])('keeps three answers, then retracts exact support (provider failure: %s)', async (fail) => {
    const f = await saveThreeAnswers();
    if (fail) {
      extract.mockRejectedValueOnce(new Error('Synthetic provider failure'));
      // Exhaust one attempt to exercise the real explicit recovery endpoint.
      await t.sql`UPDATE background_jobs SET max_attempts = 1 WHERE type = 'derive_signals'`;
      const failed = await drainBackgroundJobs({ limit: 1, now: new Date(Date.now() + 1000) });
      expect(failed.failed).toBe(1);
      expect(await f.status()).toMatchObject({ phase: 'failed', canRetry: true, result: null });
      expect(await t.sql`SELECT id FROM reflections`).toHaveLength(3);
      expect(await t.sql`SELECT id FROM top_of_minds`).toHaveLength(0);
      expect((await f.post(`${f.path}/processing/retry`, { receiptId: f.saved[2]!.processing!.id })).status).toBe(202);
    }
    await drain();
    const before = await getLiveTopOfMind(t.db as never, { profileId: f.profileId });
    expect(before?.entries.map((entry) => entry.body)).toEqual([wording]);
    expect(await f.status()).toMatchObject({ phase: 'ready', result: { topOfMindId: before!.id, version: before!.version } });
    expect(extract.mock.calls.at(-1)?.[0].reflections).toEqual(answers);
    expect(await t.sql`SELECT quote, quote_reflection_id FROM signal_evidence`).toEqual([
      { quote: answers[1]!.answer, quote_reflection_id: f.saved[1]!.reflection.id },
    ]);

    const stranger = await actor();
    expect((await stranger.app.request(`${f.path}/processing`)).status).toBe(404);
    expect((await stranger.post(`${f.path}/processing/retry`, {})).status).toBe(404);
    expect((await stranger.app.request(`/api/inspirations/save-requests/${f.keys[1]}`)).status).toBe(404);

    const removed = await f.app.request(`${f.path}/reflections/${f.saved[1]!.reflection.id}`, { method: 'DELETE' });
    expect(removed.status).toBe(200);
    expect(await t.sql`SELECT quote FROM signal_evidence`).toEqual([{ quote: null }]);
    expect(await f.status()).toMatchObject({ phase: 'queued', result: null });
    await drain();
    // Unsupported generated wording is not served while replacement is held.
    expect((await getLiveTopOfMind(t.db as never, { profileId: f.profileId }))?.entries).toEqual([]);
    if ((await f.status()).phase === 'waiting') {
      expect(await f.status()).toMatchObject({ stage: 'reading', result: null, canRetry: false });
      expect((await f.post('/api/top-of-mind/refresh', {})).status).toBe(202);
      await drain();
    }
    expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(0);
    const after = await getLiveTopOfMind(t.db as never, { profileId: f.profileId });
    expect(after?.entries).toEqual([]);
    expect(after!.version).toBeGreaterThan(before!.version);
    expect(await f.status()).toMatchObject({ phase: 'ready', result: { topOfMindId: after!.id, version: after!.version } });
    const source = await (await f.app.request(f.path)).json() as SavedSource;
    expect(source.inspiration.text).toBe('An unhurried evening');
    expect(source.inspiration.reflections.map(({ question, answer }) => ({ question, answer }))).toEqual([answers[0], answers[2]]);
    expect((await f.post(`${f.path}/reflections`, answers[1], f.keys[1])).status).toBe(410);
    expect(await t.sql`SELECT id FROM reflections`).toHaveLength(2);
    expect(extract.mock.calls.at(-1)?.[0].reflections).toEqual([answers[0], answers[2]]);
  });

  it('distinguishes no new candidates, a daily hold, and a completed unchanged reading', async () => {
    const f = await saveThreeAnswers(); await drain();
    const before = await getLiveTopOfMind(t.db as never, { profileId: f.profileId });
    extract.mockResolvedValue({ statements: [] });
    const repeated = await f.app.request(f.path, { method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'An unhurried evening' }) });
    expect(repeated.status).toBe(200);
    await drain();
    expect(await f.status()).toMatchObject({ phase: 'ready', result: { topOfMindId: before!.id, version: before!.version } });
    expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(1);
    expect(await t.sql`SELECT id FROM top_of_minds`).toHaveLength(1);
    expect(synthesize).toHaveBeenCalledTimes(1);

    const addedAnswer = 'A short sketch helps me plan.';
    const addedStatement = 'Sketching helps me plan';
    extract.mockResolvedValue({ statements: [{ statement: addedStatement, quote: addedAnswer }] });
    vi.mocked(GeminiEmbeddingHttpClient.prototype.embed).mockImplementation(async (text) =>
      [text === addedStatement ? 0 : 1, text === addedStatement ? 1 : 0, ...new Array<number>(766).fill(0)]);
    const saved = await f.post(`${f.path}/reflections`, { question: 'Anything else?', answer: addedAnswer });
    expect(saved.status).toBe(201);
    await drain();
    expect(await f.status()).toMatchObject({ phase: 'waiting', stage: 'reading', canRetry: false, result: null });
    expect(synthesize).toHaveBeenCalledTimes(1);
    synthesize.mockResolvedValue({ noChange: true, entries: [] });
    const accepted = await f.post('/api/top-of-mind/refresh', {});
    expect(accepted.status).toBe(202);
    const request = await accepted.json() as { jobId: string; requestVersion: string };
    await drain();
    const response = await f.app.request(`/api/top-of-mind/refresh/${request.jobId}?requestVersion=${request.requestVersion}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'succeeded', result: { outcome: 'unchanged' } });
    expect(await f.status()).toMatchObject({ phase: 'ready', result: { outcome: 'unchanged' } });
    expect((await getLiveTopOfMind(t.db as never, { profileId: f.profileId }))?.entries.map((entry) => entry.body)).toEqual([wording]);
    expect(await t.sql`SELECT id FROM reflections`).toHaveLength(4);
  });
});
