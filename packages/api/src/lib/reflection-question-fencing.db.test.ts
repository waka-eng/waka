import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import postgres from 'postgres';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { setDefaultModelProviderForTests, type ModelProvider, type ReflectionQuestionInput } from './model-provider.js';
import { enqueueReflectionQuestion, postgresBackgroundJobStore, processBackgroundJob } from './queue.js';

let t: TestDatabase;
let sequence = 0;
let duringQuestion: (() => Promise<void>) | null;
let providerCalls = 0;
let providerInput: ReflectionQuestionInput | null = null;
beforeAll(async () => {
  t = await createTestDatabase();
  const url = new URL(process.env.DB_CONNECTION_URL!);
  url.searchParams.set('options', `-c search_path=${t.schemaName}`);
  process.env.DB_CONNECTION_URL = url.toString();
});
beforeEach(async () => {
  await t.truncateAll();
  duringQuestion = null; providerCalls = 0; providerInput = null;
  setDefaultModelProviderForTests({ askReflectionQuestion: async (input: ReflectionQuestionInput) => {
    providerInput = input;
    providerCalls += 1;
    await duringQuestion?.();
    return { question: 'What would give you more space for that?' };
  } } as unknown as ModelProvider);
});
afterAll(async () => { setDefaultModelProviderForTests(null); await t?.cleanup(); });

async function fixture(withAttachments = false) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`question-fence-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name, preferred_locale)
    VALUES (${account.id}, 'human', 'Owner', 'en-US') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'A quiet walk') RETURNING id`;
  const [answer] = await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer)
    VALUES (${profile.id}, ${source.id}, 'What caught your attention?', 'Room to think') RETURNING id`;
  if (withAttachments) {
    await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_kind,enrichment_text,transcript_correction)
      VALUES (${profile.id},${source.id},'audio','https://example.test/audio','ready','audio_transcription','Old machine wording','My corrected spoken words')`;
    await t.sql`INSERT INTO attachments(profile_id,inspiration_id,type,url,enrichment_status,enrichment_text)
      VALUES (${profile.id},${source.id},'image','https://example.test/photo','pending','UNFINISHED_PRIVATE_TEXT')`;
  }
  const { jobId } = await enqueueReflectionQuestion(profile.id as string, source.id as string, answer.id as string);
  const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
  expect(job?.id).toBe(jobId);
  return { profileId: profile.id as string, sourceId: source.id as string, answerId: answer.id as string, job: job! };
}

describe('reflection follow-up commit fences', () => {
  it('uses the effective corrected transcript once and does not read pending image contents', async () => {
    const f = await fixture(true); await processBackgroundJob(f.job);
    expect(providerInput?.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({type:'audio',text:'My corrected spoken words',status:'ready'}),
      expect.objectContaining({type:'image',text:null,status:'pending'}),
    ]));
    expect(JSON.stringify(providerInput)).not.toContain('Old machine wording');
    expect(JSON.stringify(providerInput)).not.toContain('UNFINISHED_PRIVATE_TEXT');
    expect((await t.sql`SELECT payload FROM background_jobs WHERE id=${f.job.id}`)[0].payload.contextHash).toEqual(expect.any(String));
  });
  it.each(['correction','delete','completion'] as const)('withdraws a question if attachment %s changes during generation', async change => {
    const f = await fixture(true);
    duringQuestion = async () => {
      if (change === 'correction') await t.sql`UPDATE attachments SET transcript_correction='New correction' WHERE inspiration_id=${f.sourceId} AND type='audio'`;
      if (change === 'delete') await t.sql`DELETE FROM attachments WHERE inspiration_id=${f.sourceId} AND type='audio'`;
      if (change === 'completion') await t.sql`UPDATE attachments SET enrichment_status='ready',enrichment_kind='image_description',enrichment_text='A finished description' WHERE inspiration_id=${f.sourceId} AND type='image'`;
    };
    await expect(processBackgroundJob(f.job)).rejects.toThrow(/inputs changed|ownership changed/);
    expect(await t.sql`SELECT id FROM background_jobs WHERE id=${f.job.id}`).toHaveLength(0);
  });
  it('redacts a completed attachment-derived question on correction but not timestamp-only updates', async () => {
    const f = await fixture(true); await processBackgroundJob(f.job);
    await t.sql`UPDATE attachments SET updated_at=now() WHERE inspiration_id=${f.sourceId}`;
    expect(await t.sql`SELECT id FROM background_jobs WHERE id=${f.job.id}`).toHaveLength(1);
    await t.sql`UPDATE attachments SET transcript_correction='Withdraw that wording' WHERE inspiration_id=${f.sourceId} AND type='audio'`;
    expect(await t.sql`SELECT id FROM background_jobs WHERE id=${f.job.id}`).toHaveLength(0);
  });
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
