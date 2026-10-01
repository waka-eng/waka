import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { reembedSignal, reembedSignalStatement } from './signal-embeddings.js';
import { GeminiEmbeddingHttpClient, GEMINI_EMBEDDING_MODEL, hashEmbeddingInput } from './inspiration-embeddings.js';
import { postgresBackgroundJobStore, processBackgroundJob } from './queue.js';

let t: TestDatabase;
let sequence = 0;
let originalUrl: string;
beforeAll(async () => {
  t = await createTestDatabase();
  originalUrl = process.env.DB_CONNECTION_URL!;
  const url = new URL(originalUrl);
  url.searchParams.set('options', `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});
beforeEach(async () => { vi.restoreAllMocks(); await t.truncateAll(); });
afterAll(async () => { vi.restoreAllMocks(); process.env.DB_CONNECTION_URL = originalUrl; await t?.cleanup(); });
const model = 'fixture-vector-v1';
async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`vector-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [signal] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${profile.id}, 'Earlier wording') RETURNING id`;
  return { profileId: profile.id as string, signalId: signal.id as string, statement: 'Earlier wording' };
}
async function vector(f: Awaited<ReturnType<typeof fixture>>, statement: string, embedding = [0, 1], storedModel = model) {
  await t.sql`INSERT INTO signal_embeddings(profile_id, signal_id, model, dimensions, input_hash, embedding)
    VALUES (${f.profileId}, ${f.signalId}, ${storedModel}, ${embedding.length}, ${hashEmbeddingInput(statement)}, ${JSON.stringify(embedding)}::jsonb)
    ON CONFLICT (signal_id, model) DO UPDATE SET input_hash = excluded.input_hash, embedding = excluded.embedding, updated_at = now()`;
}
const stored = async (id: string) => (await t.sql`SELECT model, input_hash, embedding FROM signal_embeddings WHERE signal_id = ${id} ORDER BY model`);

describe('statement embedding races', () => {
  it('stores a current vector without changing human wording', async () => {
    const f = await fixture();
    const [locked] = await t.sql`UPDATE signals SET locked_at = now() WHERE id = ${f.signalId} RETURNING locked_at`;
    await reembedSignal(f, { db: t.db as never, embeddingClient: { model, embed: async () => [1, 0] } });
    expect(await stored(f.signalId)).toMatchObject([{ input_hash: hashEmbeddingInput(f.statement), embedding: [1, 0] }]);
    expect((await t.sql`SELECT statement, locked_at FROM signals WHERE id = ${f.signalId}`)[0])
      .toMatchObject({ statement: f.statement, locked_at: locked.locked_at });
  });

  it.each(['success', 'failure'] as const)('a reclaimed queue worker cannot mutate the cache on provider %s', async (outcome) => {
    const f = await fixture(); await vector(f, 'Stale cached words', [0, 1], GEMINI_EMBEDDING_MODEL);
    const [row] = await t.sql`INSERT INTO background_jobs(profile_id, type, payload)
      VALUES (${f.profileId}, 'reembed_signal', ${JSON.stringify({ signalId: f.signalId })}::jsonb) RETURNING id`;
    const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    expect(job?.id).toBe(row.id);
    vi.spyOn(GeminiEmbeddingHttpClient.prototype, 'embed').mockImplementation(async () => {
      await t.sql`UPDATE background_jobs SET locked_at = now() + interval '2 seconds', attempts = attempts + 1 WHERE id = ${row.id}`;
      if (outcome === 'failure') throw new Error('Provider unavailable');
      return [1, 0];
    });
    await expect(processBackgroundJob(job!)).rejects.toThrow(/ownership changed/i);
    expect(await stored(f.signalId)).toMatchObject([{ input_hash: hashEmbeddingInput('Stale cached words'), embedding: [0, 1] }]);
  });

  it('yields to a concurrent human edit instead of waiting back on its source lock', async () => {
    const f = await fixture();
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
    let release!: () => void, locked!: () => void;
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const mutation = other.begin(async (tx) => {
      await tx`SELECT id FROM signals WHERE id = ${f.signalId} FOR NO KEY UPDATE`;
      locked(); await resume;
      await tx`UPDATE signals SET statement = 'The human edit survives', locked_at = now() WHERE id = ${f.signalId}`;
    });
    try {
      await ready;
      await expect(reembedSignal(f, { db: t.db as never, embeddingClient: { model, embed: async () => [1, 0] } }))
        .rejects.toMatchObject({ cause: { code: '55P03' } });
    } finally { release(); await mutation; await other.end(); }
    expect((await t.sql`SELECT statement FROM signals WHERE id = ${f.signalId}`)[0].statement).toBe('The human edit survives');
    expect(await stored(f.signalId)).toHaveLength(0);
  });

  it('retries a provider failure, removes only the stale model row, and keeps private error text out of the failure', async () => {
    const f = await fixture();
    await vector(f, 'Stale cached words');
    await vector(f, f.statement, [0, 1], 'another-model');
    const failure = reembedSignal(f, { db: t.db as never, embeddingClient: { model, embed: async () => { throw new Error('PRIVATE provider response'); } } });
    await expect(failure).rejects.toThrow('Signal embedding unavailable; retry current wording');
    expect(await stored(f.signalId)).toEqual([{ model: 'another-model', input_hash: hashEmbeddingInput(f.statement), embedding: [0, 1] }]);
  });

  it('does not disguise a commit failure as provider failure or delete existing cache rows', async () => {
    const f = await fixture(); await vector(f, 'Stale cached words');
    await expect(reembedSignal(f, { db: t.db as never, embeddingClient: { model, embed: async () => [1, 0] },
      beforeCommit: async () => { throw new Error('Synthetic commit refused'); } })).rejects.toThrow('Synthetic commit refused');
    expect(await stored(f.signalId)).toMatchObject([{ input_hash: hashEmbeddingInput('Stale cached words') }]);
  });

  it('does not overwrite a newer human edit with the vector for older words', async () => {
    const f = await fixture();
    const pending = reembedSignalStatement(t.db as never, f, { embeddingClient: { model, embed: async () => {
      await t.sql`UPDATE signals SET statement = 'Newer wording', locked_at = now() WHERE id = ${f.signalId}`;
      await vector(f, 'Newer wording');
      return [1, 0];
    } } });
    await expect(pending).rejects.toThrow(/statement changed/i);
    expect(await stored(f.signalId)).toMatchObject([{ input_hash: hashEmbeddingInput('Newer wording'), embedding: [0, 1] }]);
  });

  it('a failed older call cannot delete a newer successful vector', async () => {
    const f = await fixture();
    const pending = reembedSignalStatement(t.db as never, f, { embeddingClient: { model, embed: async () => {
      await t.sql`UPDATE signals SET statement = 'Newer wording' WHERE id = ${f.signalId}`;
      await vector(f, 'Newer wording');
      throw new Error('Synthetic failure');
    } } });
    await expect(pending).rejects.toThrow(/statement changed/i);
    expect(await stored(f.signalId)).toMatchObject([{ input_hash: hashEmbeddingInput('Newer wording'), embedding: [0, 1] }]);
  });

  it.each(['success', 'failure'] as const)('preserves a concurrent current vector when this call ends in %s', async (outcome) => {
    const f = await fixture();
    await reembedSignalStatement(t.db as never, f, { embeddingClient: { model, embed: async () => {
      await vector(f, f.statement);
      if (outcome === 'failure') throw new Error('Synthetic failure');
      return [1, 0];
    } } });
    expect(await stored(f.signalId)).toMatchObject([{ input_hash: hashEmbeddingInput(f.statement), embedding: [0, 1] }]);
  });

  it('reuses an already current vector without a provider call', async () => {
    const f = await fixture(); await vector(f, f.statement);
    const embed = vi.fn(async () => [1, 0]);
    await reembedSignal(f, { db: t.db as never, embeddingClient: { model, embed } });
    expect(embed).not.toHaveBeenCalled();
  });

  it('rejects an outdated or cross-profile direct request before spending a call', async () => {
    const f = await fixture();
    const embed = vi.fn(async () => [1, 0]);
    await expect(reembedSignalStatement(t.db as never, { ...f, statement: 'Words it never carried' }, { embeddingClient: { model, embed } }))
      .rejects.toThrow(/statement changed/i);
    await reembedSignalStatement(t.db as never, { ...f, profileId: '00000000-0000-4000-8000-000000000001' }, { embeddingClient: { model, embed } });
    expect(embed).not.toHaveBeenCalled();
    expect(await stored(f.signalId)).toHaveLength(0);
  });
});
