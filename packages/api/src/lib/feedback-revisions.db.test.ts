import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { refreshTopOfMindForProfile } from './top-of-mind-synthesis.js';
import type { ModelProvider, TopOfMindRecentFeedback, TopOfMindSynthesisInput } from './model-provider.js';
import { createFeedbackForProfile, listFeedbackForProfile } from '../routes/feedback.js';
import { feedbackWordingCurrent } from './feedback-revisions.js';
import { feedback } from '../db/index.js';
import { createGroupForProfile, joinGroupByCode } from '../routes/groups-membership.js';
import postgres from 'postgres';
import { Hono } from 'hono';
import { createFeedbackRoutes } from '../routes/feedback.js';
import type { AuthEnv } from './middleware.js';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./db.js', () => ({ getDb: () => state.db }));
let t: TestDatabase, sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db; });
afterAll(async () => { await t?.cleanup(); });

async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`feedback-revision-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','Owner') RETURNING id`;
  const sources: string[] = [], signals: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},${`Source ${index}`}) RETURNING id`;
    const [signal] = await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${profile.id},${`Claim ${index}`}) RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id) VALUES (${profile.id},${profile.id},${signal.id},${source.id})`;
    sources.push(source.id as string); signals.push(signal.id as string);
  }
  return { profileId: profile.id as string, sources, signals };
}

async function context(profileId: string) {
  let seen: TopOfMindRecentFeedback[] = [];
  await refreshTopOfMindForProfile({ profileId, reason: 'manual' }, { db: t.db as never,
    modelProvider: { synthesizeTopOfMind: async (input: TopOfMindSynthesisInput) => { seen = input.recentFeedback; return { entries: [] }; } } as unknown as ModelProvider });
  return seen;
}

function actor(profileId: string) {
  const app = new Hono<AuthEnv>();
  app.route('/feedback', createFeedbackRoutes({ getDatabase: () => t.db as never, authMiddleware: async (c, next) => {
    c.set('session', { sessionId: '00000000-0000-4000-8000-000000000001',
      account: { id: '00000000-0000-4000-8000-000000000002', email: 'fixture@example.test' },
      profile: { id: profileId, accountId: '00000000-0000-4000-8000-000000000002', type: 'human', name: 'Fixture', preferredLocale: 'en-US' } });
    await next();
  } }));
  return (targetId: string, targetRevision = '1') => app.request('/feedback', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ targetType: 'signal', targetId, targetRevision, value: 'partly' }) });
}

async function holdSignal(signalId: string, run: () => Promise<void>) {
  const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
  let release!: () => void, locked!: () => void;
  const ready = new Promise<void>((resolve) => { locked = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  const holding = other.begin(async (tx) => {
    await tx`UPDATE signals SET statement='Concurrent wording' WHERE id=${signalId}`;
    locked(); await released;
  });
  try { await ready; await run(); }
  finally { release(); await holding; await other.end(); }
}

describe('feedback stays with its words, not just its ID', () => {
  it('conflicts promptly with a concurrent wording writer, then accepts only the new displayed revision', async () => {
    const f = await fixture(), post = actor(f.profileId);
    await holdSignal(f.signals[0]!, async () => {
      const response = await post(f.signals[0]!);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: 'feedback_target_changed' });
      expect(await t.sql`SELECT id FROM feedback`).toHaveLength(0);
      expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
    });
    expect((await post(f.signals[0]!, '1')).status).toBe(409);
    expect((await post(f.signals[0]!, '2')).status).toBe(201);
  });

  it('does not reveal another profile’s busy target through a conflict response', async () => {
    const a = await fixture(), b = await fixture(), post = actor(b.profileId);
    await holdSignal(a.signals[0]!, async () => { expect((await post(a.signals[0]!)).status).toBe(404); });
    expect(await t.sql`SELECT id FROM feedback`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  });
  it.each(['stale_signal', 'stale_entry', 'rewritten_signal'])('does not recycle %s as personal synthesis context', async (kind) => {
    const f = await fixture(); let targetId = f.signals[0]!;
    if (kind === 'stale_entry') {
      const [reading] = await t.sql`INSERT INTO top_of_minds(profile_id,version) VALUES (${f.profileId},1) RETURNING id`;
      const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES (${reading.id},'hypothesis','Old conclusion') RETURNING id`;
      await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES (${entry.id},${targetId})`;
      targetId = entry.id as string;
    }
    await t.sql`INSERT INTO feedback(profile_id,target_type,target_id,value,correction_text) VALUES (${f.profileId},
      ${kind === 'stale_entry' ? 'top_of_mind_entry' : 'signal'}::feedback_target_type,${targetId},'partly','Correction of old words')`;
    if (kind === 'rewritten_signal') await t.sql`UPDATE signals SET statement='Different claim' WHERE id=${targetId}`;
    else await t.sql`UPDATE inspirations SET text='Different source' WHERE id=${f.sources[0]!}`;
    expect(await context(f.profileId)).toEqual([]);
    expect(await listFeedbackForProfile(t.db as never, { profileId: f.profileId, limit: 50 })).toHaveLength(1);
  });

  it('new feedback binds the current wording and stops following change-and-return', async () => {
    const f = await fixture();
    await t.sql`UPDATE signals SET statement='New words' WHERE id=${f.signals[0]!}`;
    const saved = await createFeedbackForProfile(t.db as never, { profileId: f.profileId, targetType: 'signal', targetId: f.signals[0]!, value: 'partly' });
    expect(saved).toMatchObject({ targetRevision: '2' });
    expect(await t.db.select().from(feedback).where(feedbackWordingCurrent())).toHaveLength(1);
    await t.sql`UPDATE signals SET statement='Other words' WHERE id=${f.signals[0]!}`;
    await t.sql`UPDATE signals SET statement='New words' WHERE id=${f.signals[0]!}`;
    expect(await t.db.select().from(feedback).where(feedbackWordingCurrent())).toHaveLength(0);
    expect(await listFeedbackForProfile(t.db as never, { profileId: f.profileId, limit: 50 })).toHaveLength(1);
  });

  it('does not acknowledge feedback if its required reading job cannot commit', async () => {
    const f = await fixture();
    const [a, b] = [...f.signals].sort();
    await t.sql`INSERT INTO signal_contradictions(profile_id,a_signal_id,b_signal_id) VALUES (${f.profileId},${a!},${b!})`;
    const [principle] = await t.sql`INSERT INTO principles(profile_id,statement,type,origin,rank,state)
      VALUES (${f.profileId},'My own principle','value','declared',1,'aspirational') RETURNING id`;
    await t.sql`CREATE FUNCTION reject_feedback_read() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic queue failure'; END $$`;
    await t.sql`CREATE TRIGGER reject_feedback_read BEFORE INSERT ON background_jobs FOR EACH ROW EXECUTE FUNCTION reject_feedback_read()`;
    try {
      await expect(createFeedbackForProfile(t.db as never, { profileId: f.profileId, targetType: 'signal', targetId: f.signals[0]!, value: 'not_true' })).rejects.toThrow();
      expect(await t.sql`SELECT resolved_at,yielded_signal_id FROM signal_contradictions`).toEqual([{ resolved_at: null, yielded_signal_id: null }]);
      await expect(createFeedbackForProfile(t.db as never, { profileId: f.profileId, targetType: 'principle', targetId: principle.id as string, value: 'not_true' })).rejects.toThrow();
      expect((await t.sql`SELECT state FROM principles WHERE id=${principle.id}`)[0].state).toBe('aspirational');
      expect(await t.sql`SELECT id FROM feedback`).toHaveLength(0);
    } finally {
      await t.sql`DROP TRIGGER reject_feedback_read ON background_jobs`;
      await t.sql`DROP FUNCTION reject_feedback_read()`;
    }
  });

  it('refuses a verdict on an older displayed revision without changing standing or jobs', async () => {
    const f = await fixture();
    await t.sql`UPDATE signals SET statement='Changed wording' WHERE id=${f.signals[0]!}`;
    await expect(createFeedbackForProfile(t.db as never, { profileId: f.profileId, targetType: 'signal',
      targetId: f.signals[0]!, value: 'not_true', targetRevision: '1' })).rejects.toThrow(/wording changed/);
    expect(await t.sql`SELECT id FROM feedback`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  });

  it('filters obsolete context before the bounded limit so current corrections are not crowded out', async () => {
    const f = await fixture();
    await t.sql`INSERT INTO feedback(profile_id,target_type,target_id,value,correction_text,created_at)
      VALUES (${f.profileId},'signal',${f.signals[1]!},'partly','Still relevant',now()-interval '1 day')`;
    for (let n = 0; n < 25; n++) await t.sql`INSERT INTO feedback(profile_id,target_type,target_id,value,correction_text)
      VALUES (${f.profileId},'signal',${f.signals[0]!},'partly','Outdated')`;
    await t.sql`UPDATE inspirations SET text='Different source' WHERE id=${f.sources[0]!}`;
    expect(await context(f.profileId)).toMatchObject([{ about: 'Claim 1', correction: 'Still relevant' }]);
    expect(await listFeedbackForProfile(t.db as never, { profileId: f.profileId, limit: 50 })).toHaveLength(26);
  });

  it.each(['principle', 'top_of_mind_entry'] as const)('binds %s feedback to its owning words', async (type) => {
    const f = await fixture(); let id: string;
    if (type === 'principle') {
      const [p] = await t.sql`INSERT INTO principles(profile_id,statement,type,origin,rank) VALUES (${f.profileId},'My words','value','declared',1) RETURNING id`;
      id = p.id as string;
      await t.sql`UPDATE principles SET statement='My revised words' WHERE id=${id}`;
    } else {
      const [reading] = await t.sql`INSERT INTO top_of_minds(profile_id,version) VALUES (${f.profileId},1) RETURNING id`;
      const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body) VALUES (${reading.id},'hypothesis','My words') RETURNING id`;
      id = entry.id as string;
      await t.sql`UPDATE top_of_mind_entries SET body='My revised words' WHERE id=${id}`;
    }
    const saved = await createFeedbackForProfile(t.db as never, { profileId: f.profileId, targetType: type, targetId: id, value: 'partly', targetRevision: '2' });
    expect(saved).toMatchObject({ targetRevision: '2' });
    expect(await t.db.select().from(feedback).where(feedbackWordingCurrent())).toHaveLength(1);
  });

  it('keeps feedback on current human-held entry words even when its generated support changes', async () => {
    const f = await fixture();
    const [reading] = await t.sql`INSERT INTO top_of_minds(profile_id,version) VALUES (${f.profileId},1) RETURNING id`;
    const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,locked_at)
      VALUES (${reading.id},'hypothesis','My own sentence',now()) RETURNING id`;
    await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES (${entry.id},${f.signals[0]!})`;
    await t.sql`INSERT INTO feedback(profile_id,target_type,target_id,value,correction_text)
      VALUES (${f.profileId},'top_of_mind_entry',${entry.id},'partly','Keep my nuance')`;
    await t.sql`UPDATE inspirations SET text='Different source' WHERE id=${f.sources[0]!}`;
    expect(await context(f.profileId)).toMatchObject([{ about: 'My own sentence', correction: 'Keep my nuance' }]);
  });

  it('queues an explicit personal correction without the passive daily floor', async () => {
    const f = await fixture();
    await createFeedbackForProfile(t.db as never, { profileId: f.profileId, targetType: 'signal', targetId: f.signals[0]!, value: 'partly' });
    const [job] = await t.sql`SELECT payload,run_after FROM background_jobs WHERE type='refresh_top_of_mind'`;
    expect(job.payload).toMatchObject({ reason: 'manual' });
    expect(new Date(job.run_after).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it.each(['true', 'not_true'] as const)('durably rereads a room-grown %s reaction, not an unrelated personal reading', async (value) => {
    const a = await fixture(), b = await fixture();
    const group = await createGroupForProfile(t.db as never, { profileId: a.profileId, name: 'Room' });
    await joinGroupByCode(t.db as never, { profileId: b.profileId, joinCode: group.joinCode });
    const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id=${group.id} AND type='group'`;
    const [signal] = await t.sql`INSERT INTO signals(profile_id,statement,input_policy)
      VALUES (${mind.id},'Room words','group-public-v1') RETURNING id`;
    await t.sql`DELETE FROM background_jobs`;
    const saved = await createFeedbackForProfile(t.db as never, { profileId: b.profileId, targetType: 'signal', targetId: signal.id as string, value });
    expect(saved).toMatchObject({ targetRevision: '1' });
    expect(await t.sql`SELECT type,payload FROM background_jobs`).toEqual([
      { type: 'refresh_group_top_of_mind', payload: { groupId: group.id, reason: 'shares_changed' } },
    ]);
  });
});
