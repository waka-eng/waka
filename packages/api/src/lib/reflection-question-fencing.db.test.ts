import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { setDefaultModelProviderForTests, type ModelProvider } from './model-provider.js';
import { enqueueReflectionQuestion, postgresBackgroundJobStore, processBackgroundJob } from './queue.js';

let t: TestDatabase;
let sequence = 0;
let duringQuestion: (() => Promise<void>) | null;
let providerCalls = 0;
beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set('options', `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});
beforeEach(async () => {
  await t.truncateAll();
  duringQuestion = null; providerCalls = 0;
  setDefaultModelProviderForTests({ askReflectionQuestion: async () => {
    providerCalls += 1;
    await duringQuestion?.();
    return { question: 'What would give you more space for that?' };
  } } as unknown as ModelProvider);
});
afterAll(async () => { setDefaultModelProviderForTests(null); await t?.cleanup(); });

async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`question-fence-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name, preferred_locale)
    VALUES (${account.id}, 'human', 'Owner', 'en-US') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'A quiet walk') RETURNING id`;
  const [answer] = await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer)
    VALUES (${profile.id}, ${source.id}, 'What caught your attention?', 'Room to think') RETURNING id`;
  const { jobId } = await enqueueReflectionQuestion(profile.id as string, source.id as string, answer.id as string);
  const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
  expect(job?.id).toBe(jobId);
  return { profileId: profile.id as string, sourceId: source.id as string, answerId: answer.id as string, job: job! };
}

describe('reflection follow-up commit fences', () => {
  it('keeps a question for an unchanged answer under the current worker claim', async () => {
    const f = await fixture();
    await processBackgroundJob(f.job);
    expect((await t.sql`SELECT payload FROM background_jobs WHERE id = ${f.job.id}`)[0].payload)
      .toMatchObject({ afterReflectionId: f.answerId, question: 'What would give you more space for that?' });
    expect(providerCalls).toBe(1);
  });

  it('does not spend another question call when unrelated reading work advances the profile revision', async () => {
    const f = await fixture();
    duringQuestion = async () => { await t.sql`INSERT INTO top_of_minds(profile_id, version) VALUES (${f.profileId}, 1)`; };
    await processBackgroundJob(f.job);
    expect((await t.sql`SELECT payload FROM background_jobs WHERE id = ${f.job.id}`)[0].payload.question)
      .toBe('What would give you more space for that?');
    expect(providerCalls).toBe(1);
  });

  it('yields to a source transaction holding the question row instead of waiting back on it', async () => {
    const f = await fixture();
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
    let release!: () => void;
    let locked!: () => void;
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const mutation = other.begin(async (tx) => {
      await tx`SELECT id FROM background_jobs WHERE id = ${f.job.id} FOR UPDATE`;
      locked();
      await resume;
      await tx`UPDATE inspirations SET text = 'The human edit survives' WHERE id = ${f.sourceId}`;
    });
    try {
      await ready;
      await expect(processBackgroundJob(f.job)).rejects.toMatchObject({ cause: { code: '55P03' } });
    } finally {
      release();
      await mutation;
      await other.end();
    }
    expect((await t.sql`SELECT text FROM inspirations WHERE id = ${f.sourceId}`)[0].text).toBe('The human edit survives');
  });

  it('cannot overwrite the replacement worker’s question after losing its claim', async () => {
    const f = await fixture();
    duringQuestion = async () => {
      await t.sql`UPDATE background_jobs SET locked_at = now() + interval '2 seconds', attempts = attempts + 1,
        payload = payload || '{"question":"A question from the current worker"}'::jsonb WHERE id = ${f.job.id}`;
    };
    await expect(processBackgroundJob(f.job)).rejects.toThrow(/ownership changed/i);
    expect((await t.sql`SELECT payload FROM background_jobs WHERE id = ${f.job.id}`)[0].payload.question)
      .toBe('A question from the current worker');
  });

  it.each(['locale', 'another-answer', 'source-edit', 'answer-edit', 'source-delete'] as const)
    ('does not persist a stale follow-up after %s changes during the model call', async (change) => {
      const f = await fixture();
      duringQuestion = async () => {
        if (change === 'locale') await t.sql`UPDATE profiles SET preferred_locale = 'ko-KR' WHERE id = ${f.profileId}`;
        if (change === 'another-answer') await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer, created_at)
          VALUES (${f.profileId}, ${f.sourceId}, 'What does that make possible?', 'A different path', now() + interval '1 second')`;
        if (change === 'source-edit') await t.sql`UPDATE inspirations SET text = 'A noisy commute' WHERE id = ${f.sourceId}`;
        if (change === 'answer-edit') await t.sql`UPDATE reflections SET answer = 'I have changed my mind' WHERE id = ${f.answerId}`;
        if (change === 'source-delete') await t.sql`DELETE FROM inspirations WHERE id = ${f.sourceId}`;
      };
      await expect(processBackgroundJob(f.job)).rejects.toThrow(/inputs changed|ownership changed|could not keep/i);
      const rows = await t.sql`SELECT payload FROM background_jobs WHERE id = ${f.job.id}`;
      expect(rows[0]?.payload.question).toBeUndefined();
    });
});
