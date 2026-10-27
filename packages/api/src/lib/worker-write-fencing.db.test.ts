/** WHAT THIS MOCKS, AND WHY: `undici` fetch delegates to the test fetch stub;
 * `GeminiEmbeddingHttpClient` and `setDefaultModelProviderForTests` replace model
 * calls. Real queue claims, ownership fences and writes run on local Postgres. */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('undici', async (importOriginal) => ({
  ...await importOriginal<typeof import('undici')>(),
  fetch: (...args: Parameters<typeof fetch>) => globalThis.fetch(...args),
}));
import postgres from 'postgres';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { GeminiEmbeddingHttpClient, GEMINI_EMBEDDING_MODEL, hashEmbeddingInput } from './inspiration-embeddings.js';
import { setDefaultModelProviderForTests, type ModelProvider, type SignalSupportAssessmentInput } from './model-provider.js';
import { postgresBackgroundJobStore, processBackgroundJob } from './queue.js';
import { tendSignalGarden } from './signal-gardener.js';

let t: TestDatabase;
let sequence = 0;
let originalUrl: string;
const vector = (x = 1, y = 0) => [x, y, ...new Array<number>(766).fill(0)];
beforeAll(async () => {
  t = await createTestDatabase(); originalUrl = process.env.DB_CONNECTION_URL!;
  const url = new URL(originalUrl); url.searchParams.set('options', `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});
beforeEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
  await t.truncateAll();
  vi.spyOn(GeminiEmbeddingHttpClient.prototype, 'embed').mockResolvedValue(vector());
  setDefaultModelProviderForTests({ extractSignalCandidates: async () => ({ statements: [] }) } as unknown as ModelProvider);
});
afterAll(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); setDefaultModelProviderForTests(null);
  process.env.DB_CONNECTION_URL = originalUrl; await t?.cleanup();
});
async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`worker-fence-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'An inspiration') RETURNING id`;
  return { profileId: profile.id as string, sourceId: source.id as string };
}
async function signal(f: Awaited<ReturnType<typeof fixture>>, statement: string, evidence = false) {
  const [row] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${f.profileId}, ${statement}) RETURNING id`;
  if (evidence) await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
    VALUES (${f.profileId}, ${f.profileId}, ${row.id}, ${f.sourceId})`;
  await t.sql`INSERT INTO signal_embeddings(profile_id, signal_id, model, dimensions, input_hash, embedding)
    VALUES (${f.profileId}, ${row.id}, ${GEMINI_EMBEDDING_MODEL}, 768, ${hashEmbeddingInput(statement)}, ${JSON.stringify(vector())}::jsonb)`;
  return row.id as string;
}
async function claimed(profileId: string, type: string, payload: object) {
  const [row] = await t.sql`INSERT INTO background_jobs(profile_id, type, payload) VALUES (${profileId}, ${type}, ${JSON.stringify(payload)}::jsonb) RETURNING id`;
  const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
  expect(job?.id).toBe(row.id); return job!;
}
const reclaim = (id: string) => t.sql`UPDATE background_jobs SET locked_at = now() + interval '2 seconds', attempts = attempts + 1 WHERE id = ${id}`;

describe('every background write owns its claim', () => {
  it('a current derivation still commits its vector, evidence and durable reading request', async () => {
    const f = await fixture();
    const job = await claimed(f.profileId, 'derive_signals', { inspirationId: f.sourceId, reason: 'created' });
    setDefaultModelProviderForTests({ extractSignalCandidates: async () => ({
      statements: [{ statement: 'A grounded pattern', quote: 'An inspiration' }],
    }) } as unknown as ModelProvider);
    await processBackgroundJob(job);
    expect(await t.sql`SELECT id FROM inspiration_embeddings`).toHaveLength(1);
    expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(1);
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'refresh_top_of_mind'`).toHaveLength(1);
  });

  it('a current explicit negative assessment still withdraws evidence and requests a reading', async () => {
    const f = await fixture(); const id = await signal(f, 'A standing pattern', true);
    const job = await claimed(f.profileId, 'derive_signals', { inspirationId: f.sourceId, reason: 'edited' });
    setDefaultModelProviderForTests({ extractSignalCandidates: async () => ({ statements: [] }),
      assessSignalSupport: async (input: SignalSupportAssessmentInput) => ({
        assessments: input.claims.map((claim) => ({ signalId: claim.signalId, verdict: 'unsupported', sourceIds: [] })),
      }),
    } as unknown as ModelProvider);
    await processBackgroundJob(job);
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${id}`).toHaveLength(0);
    expect(await t.sql`SELECT review_id FROM signal_support_reviews`).toHaveLength(1);
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'refresh_top_of_mind'`).toHaveLength(1);
  });

  it('a current enrichment still commits fetched material with its downstream job', async () => {
    const f = await fixture();
    const [attachment] = await t.sql`INSERT INTO attachments(profile_id, inspiration_id, type, url)
      VALUES (${f.profileId}, ${f.sourceId}, 'link', 'http://127.0.0.1:8791/fixture') RETURNING id`;
    const job = await claimed(f.profileId, 'enrich_attachment', { inspirationId: f.sourceId, attachmentId: attachment.id });
    vi.stubEnv('WAKA_ENRICHMENT_ALLOWED_HOSTS', '127.0.0.1:8791');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html><head><title>Keeping space for reflection</title></head><body><article>An article about keeping space for reflection.</article></body></html>', { headers: { 'content-type': 'text/html' } })));
    await processBackgroundJob(job);
    expect((await t.sql`SELECT enrichment_text, enrichment_status FROM attachments WHERE id = ${attachment.id}`)[0])
      .toMatchObject({ enrichment_text: expect.stringContaining('reflection'), enrichment_status: 'ready' });
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'derive_signals'`).toHaveLength(1);
  });

  it('a reclaimed derivation cannot persist a capture vector', async () => {
    const f = await fixture();
    const job = await claimed(f.profileId, 'derive_signals', { inspirationId: f.sourceId, reason: 'created' });
    vi.mocked(GeminiEmbeddingHttpClient.prototype.embed).mockImplementation(async () => { await reclaim(job.id); return vector(); });
    await expect(processBackgroundJob(job)).rejects.toThrow(/ownership changed/i);
    expect(await t.sql`SELECT id FROM inspiration_embeddings`).toHaveLength(0);
  });

  it('a reclaimed support assessment cannot withdraw evidence or persist a review', async () => {
    const f = await fixture(); const id = await signal(f, 'A standing pattern', true);
    const job = await claimed(f.profileId, 'derive_signals', { inspirationId: f.sourceId, reason: 'edited' });
    setDefaultModelProviderForTests({ extractSignalCandidates: async () => ({ statements: [] }),
      assessSignalSupport: async (input: SignalSupportAssessmentInput) => {
        await reclaim(job.id);
        return { assessments: input.claims.map((claim) => ({ signalId: claim.signalId, verdict: 'unsupported', sourceIds: [] })) };
      },
    } as unknown as ModelProvider);
    await expect(processBackgroundJob(job)).rejects.toThrow(/ownership changed/i);
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${id}`).toHaveLength(1);
    expect(await t.sql`SELECT review_id FROM signal_support_reviews`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'refresh_top_of_mind'`).toHaveLength(0);
  });

  it.each(['discovery', 'judge'] as const)('a reclaimed %s cannot write signals, evidence or a reading request', async (stage) => {
    const f = await fixture();
    if (stage === 'judge') await signal(f, 'An existing pattern');
    const job = await claimed(f.profileId, 'derive_signals', { inspirationId: f.sourceId, reason: 'created' });
    vi.mocked(GeminiEmbeddingHttpClient.prototype.embed).mockResolvedValue(vector(0.8, 0.6));
    setDefaultModelProviderForTests({ extractSignalCandidates: async () => {
      if (stage === 'discovery') await reclaim(job.id);
      return { statements: [{ statement: 'A candidate pattern', quote: 'An inspiration' }] };
    }, judgeSignalMatch: async () => { await reclaim(job.id); return { relation: 'same' }; } } as unknown as ModelProvider);
    await expect(processBackgroundJob(job)).rejects.toThrow(/ownership changed/i);
    expect(await t.sql`SELECT id FROM signals`).toHaveLength(stage === 'judge' ? 1 : 0);
    expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'refresh_top_of_mind'`).toHaveLength(0);
  });

  it('a reclaimed enrichment cannot cache fetched text or request derivation', async () => {
    const f = await fixture();
    const [attachment] = await t.sql`INSERT INTO attachments(profile_id, inspiration_id, type, url)
      VALUES (${f.profileId}, ${f.sourceId}, 'link', 'http://127.0.0.1:8791/fixture') RETURNING id`;
    const job = await claimed(f.profileId, 'enrich_attachment', { inspirationId: f.sourceId, attachmentId: attachment.id });
    vi.stubEnv('WAKA_ENRICHMENT_ALLOWED_HOSTS', '127.0.0.1:8791');
    vi.stubGlobal('fetch', vi.fn(async () => {
      await reclaim(job.id);
      return new Response('<html><head><title>Fixture</title></head><body><article>An article about keeping space for reflection.</article></body></html>', { headers: { 'content-type': 'text/html' } });
    }));
    await expect(processBackgroundJob(job)).rejects.toThrow(/ownership changed/i);
    expect((await t.sql`SELECT enrichment_text, enrichment_status FROM attachments WHERE id = ${attachment.id}`)[0])
      .toMatchObject({ enrichment_text: null, enrichment_status: null });
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'derive_signals'`).toHaveLength(0);
  });

  it.each(['same', 'opposed'] as const)('a reclaimed gardener cannot persist a %s pair', async (relation) => {
    const f = await fixture(); await signal(f, 'One pattern'); await signal(f, 'A similar pattern');
    const job = await claimed(f.profileId, 'tend_signal_garden', {});
    setDefaultModelProviderForTests({ judgeSignalMatch: async () => { await reclaim(job.id); return { relation }; } } as unknown as ModelProvider);
    await expect(processBackgroundJob(job)).rejects.toThrow(/ownership changed/i);
    expect(await t.sql`SELECT id FROM signal_duplicates`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM signal_contradictions`).toHaveLength(0);
  });

  it('gardening rejects changed wording and does not partially persist a batch on provider failure', async () => {
    const f = await fixture(); const id = await signal(f, 'One pattern'); await signal(f, 'A similar pattern'); await signal(f, 'A third pattern');
    let calls = 0;
    await expect(tendSignalGarden(t.db as never, { profileId: f.profileId, preferredLocale: 'en-US',
      provider: { judgeSignalMatch: async () => { if (++calls === 2) throw new Error('Second judgment failed'); return { relation: 'same' }; } } as unknown as ModelProvider,
    })).rejects.toThrow('Second judgment failed');
    expect(await t.sql`SELECT id FROM signal_duplicates`).toHaveLength(0);
    await expect(tendSignalGarden(t.db as never, { profileId: f.profileId, preferredLocale: 'en-US',
      provider: { judgeSignalMatch: async () => {
        await t.sql`UPDATE signals SET statement = 'I no longer mean that', locked_at = now() WHERE id = ${id}`;
        return { relation: 'same' };
      } } as unknown as ModelProvider,
    })).rejects.toThrow(/inputs changed/i);
    expect(await t.sql`SELECT id FROM signal_duplicates`).toHaveLength(0);
  });

  it('does not contradict a keep-apart decision recorded while its judgment was in flight', async () => {
    const f = await fixture();
    const ids = [await signal(f, 'One pattern'), await signal(f, 'A similar pattern')].sort();
    const result = await tendSignalGarden(t.db as never, { profileId: f.profileId, preferredLocale: 'en-US',
      provider: { judgeSignalMatch: async () => {
        await t.sql`INSERT INTO signal_duplicates(profile_id, a_signal_id, b_signal_id, similarity, resolved_at, resolved_by)
          VALUES (${f.profileId}, ${ids[0]!}, ${ids[1]!}, 0.99, now(), 'kept_apart')`;
        return { relation: 'opposed' };
      } } as unknown as ModelProvider,
    });
    expect(result.opposed).toBe(0);
    expect(await t.sql`SELECT id FROM signal_contradictions`).toHaveLength(0);
  });

  it('gardening yields at commit when a human already holds a compared statement', async () => {
    const f = await fixture(); const id = await signal(f, 'One pattern'); await signal(f, 'A similar pattern');
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
    let release!: () => void, locked!: () => void;
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const mutation = other.begin(async (tx) => {
      await tx`SELECT id FROM signals WHERE id = ${id} FOR NO KEY UPDATE`;
      locked(); await resume;
      await tx`UPDATE signals SET statement = 'The human edit survives', locked_at = now() WHERE id = ${id}`;
    });
    try {
      await ready;
      await expect(tendSignalGarden(t.db as never, { profileId: f.profileId, preferredLocale: 'en-US',
        provider: { judgeSignalMatch: async () => ({ relation: 'same' }) } as unknown as ModelProvider,
      })).rejects.toMatchObject({ cause: { code: '55P03' } });
    } finally { release(); await mutation; await other.end(); }
    expect((await t.sql`SELECT statement FROM signals WHERE id = ${id}`)[0].statement).toBe('The human edit survives');
    expect(await t.sql`SELECT id FROM signal_duplicates`).toHaveLength(0);
  });

  it('a source worker yields before taking its claim when a human holds the revision and needs the job row next', async () => {
    const f = await fixture();
    const job = await claimed(f.profileId, 'derive_signals', { inspirationId: f.sourceId, reason: 'created' });
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
    let release!: () => void, locked!: () => void;
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const mutation = other.begin(async (tx) => {
      await tx`SELECT profile_id FROM generation_revisions WHERE profile_id = ${f.profileId} FOR UPDATE`;
      locked(); await resume;
      await tx`UPDATE background_jobs SET rerun_requested = true WHERE id = ${job.id}`;
    });
    try {
      await ready;
      await expect(processBackgroundJob(job)).rejects.toMatchObject({ cause: { code: '55P03' } });
    } finally { release(); await mutation; await other.end(); }
    expect((await t.sql`SELECT rerun_requested FROM background_jobs WHERE id = ${job.id}`)[0].rerun_requested).toBe(true);
    expect(await t.sql`SELECT id FROM inspiration_embeddings`).toHaveLength(0);
  });

  it.each(['derive_signals', 'enrich_attachment'] as const)('a poisoned %s job cannot operate on another profile’s source', async (type) => {
    const owner = await fixture(), caller = await fixture();
    const [attachment] = await t.sql`INSERT INTO attachments(profile_id, inspiration_id, type, url)
      VALUES (${owner.profileId}, ${owner.sourceId}, 'file', 'http://127.0.0.1:8791/fixture') RETURNING id`;
    const job = await claimed(caller.profileId, type, { inspirationId: owner.sourceId, attachmentId: attachment.id, reason: 'created' });
    await processBackgroundJob(job);
    expect(GeminiEmbeddingHttpClient.prototype.embed).not.toHaveBeenCalled();
    expect((await t.sql`SELECT enrichment_status FROM attachments WHERE id = ${attachment.id}`)[0].enrichment_status).toBeNull();
    expect(await t.sql`SELECT id FROM inspiration_embeddings`).toHaveLength(0);
  });
});
