/** Actual routes and isolated Postgres; only the default DB factory is scoped
 * to the same test connection as the injected route DB. No model/network calls. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createInspirationsRoutes } from "./inspirations.js";
import { createAttachmentRoutes } from "./attachments.js";
import { createGroupForProfile } from "./groups-membership.js";
import { enqueueTopOfMindRefresh, postgresBackgroundJobStore } from "../lib/queue.js";
import { enrichAttachment } from "../lib/signal-enrichment.js";
import type { AuthEnv } from "../lib/middleware.js";
import type { AuthenticatedSession } from "../lib/session.js";

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../lib/db.js", () => ({ getDb: () => state.db }));
let t: TestDatabase;
let sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db; });
afterAll(async () => { await t?.cleanup(); });

async function fixture() {
  const email = `durable-${++sequence}@example.test`;
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${email}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'Original words') RETURNING id`;
  const [answer] = await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer)
    VALUES (${profile.id}, ${source.id}, 'Why?', 'Original answer') RETURNING id`;
  const session: AuthenticatedSession = { sessionId: 'test', account: { id: account.id as string, email },
    profile: { id: profile.id as string, accountId: account.id as string, type: 'human', name: 'Owner', preferredLocale: 'en-US' } };
  const app = new Hono<AuthEnv>();
  app.onError(() => new Response(JSON.stringify({ error: 'write failed' }), { status: 500 }));
  app.route('/api/inspirations', createInspirationsRoutes({ getDatabase: () => t.db as never,
    authMiddleware: async (c, next) => { c.set('session', session); await next(); } }));
  app.route('/api/attachments', createAttachmentRoutes({ getDatabase: () => t.db as never,
    authMiddleware: async (c, next) => { c.set('session', session); await next(); } }));
  return { app, profileId: profile.id as string, inspirationId: source.id as string, reflectionId: answer.id as string };
}

async function withQueueUnavailable(run: () => Promise<void>) {
  await t.sql`CREATE FUNCTION reject_source_job() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'queue unavailable'; END; $$ LANGUAGE plpgsql`;
  await t.sql`CREATE TRIGGER reject_source_job BEFORE INSERT ON background_jobs FOR EACH ROW EXECUTE FUNCTION reject_source_job()`;
  try { await run(); }
  finally { await t.sql`DROP TRIGGER reject_source_job ON background_jobs`; await t.sql`DROP FUNCTION reject_source_job()`; }
}

describe('source writes and their durable learning request', () => {
  it.each(['create', 'edit', 'answer', 'remove_answer', 'remove_source'] as const)('%s cannot commit without its job', async (action) => {
    const f = await fixture();
    await withQueueUnavailable(async () => {
      const path = action === 'create' ? '/api/inspirations' : action === 'edit' || action === 'remove_source' ? `/api/inspirations/${f.inspirationId}`
        : action === 'answer' ? `/api/inspirations/${f.inspirationId}/reflections`
        : `/api/inspirations/${f.inspirationId}/reflections/${f.reflectionId}`;
      const removing = action === 'remove_answer' || action === 'remove_source';
      const response = await f.app.request(path, { method: action === 'edit' ? 'PATCH' : removing ? 'DELETE' : 'POST',
        headers: { 'content-type': 'application/json' },
        ...(removing ? {} : { body: JSON.stringify(action === 'answer'
          ? { question: 'What changed?', answer: 'My new answer' } : { text: 'My new words' }) }),
      });
      expect(response.status).toBe(500);
      expect((await t.sql`SELECT text FROM inspirations WHERE profile_id = ${f.profileId}`).map((row) => row.text)).toEqual(['Original words']);
      expect((await t.sql`SELECT answer FROM reflections WHERE profile_id = ${f.profileId}`).map((row) => row.answer)).toEqual(['Original answer']);
      expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
    });
  });

  it('a failed older attempt cannot strand a newer saved revision', async () => {
    const f = await fixture();
    let editCount = 0;
    const edit = () => f.app.request(`/api/inspirations/${f.inspirationId}`, { method: 'PATCH',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: `Updated words ${++editCount}` }) });
    expect((await edit()).status).toBe(200);
    await t.sql`UPDATE background_jobs SET attempts = max_attempts - 1 WHERE type = 'derive_signals'`;
    const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    expect(job).not.toBeNull();
    expect((await edit()).status).toBe(200);
    await postgresBackgroundJobStore.markFailedOrPending(job!, new Error('older material failed'), true, new Date());
    expect((await t.sql`SELECT status, attempts, rerun_requested, last_error FROM background_jobs WHERE id = ${job!.id}`)[0])
      .toMatchObject({ status: 'pending', attempts: 0, rerun_requested: false, last_error: null });
  });

  it('public saves fan out durably, but saved answers remain personal', async () => {
    const f = await fixture();
    const group = await createGroupForProfile(t.db as never, { profileId: f.profileId, name: 'Shared room' });
    const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id = ${group.id}`;
    const response = await f.app.request('/api/inspirations', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'A public thought', visibility: 'public' }) });
    expect(response.status).toBe(201);
    const saved = await response.json() as { inspiration: { id: string } };
    const jobs = await t.sql`SELECT profile_id, payload FROM background_jobs WHERE type = 'derive_signals'`;
    expect(jobs).toHaveLength(2);
    expect(jobs.every((job) => job.profile_id === f.profileId)).toBe(true);
    expect(jobs.map((job) => job.payload.deriveIntoProfileId ?? null).sort()).toEqual([null, mind.id].sort());
    await t.sql`DELETE FROM background_jobs`;
    const answer = await f.app.request(`/api/inspirations/${saved.inspiration.id}/reflections`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Why?', answer: 'PRIVATE_SENTINEL' }) });
    expect(answer.status).toBe(201);
    expect((await t.sql`SELECT payload FROM background_jobs`).map((row) => row.payload)).toEqual([
      { inspirationId: saved.inspiration.id, reason: 'edited' },
    ]);
  });

  it('a held older pass cannot postpone a newer manual reread', async () => {
    const f = await fixture();
    const first = await t.db.transaction((tx) => enqueueTopOfMindRefresh(f.profileId, 'signals_changed', tx));
    const job = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    expect(job?.id).toBe(first.jobId);
    await t.db.transaction((tx) => enqueueTopOfMindRefresh(f.profileId, 'manual', tx));
    await postgresBackgroundJobStore.holdJob(job!, new Date(Date.now() + 86_400_000));
    const [row] = await t.sql`SELECT run_after, attempts, rerun_requested, payload FROM background_jobs WHERE id = ${first.jobId}`;
    expect(new Date(row.run_after).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    expect(row).toMatchObject({ attempts: 0, rerun_requested: false, payload: { reason: 'manual' } });
  });

  it('turning a public inspiration private requests a room reread, not private derivation', async () => {
    const f = await fixture();
    const group = await createGroupForProfile(t.db as never, { profileId: f.profileId, name: 'Shared room' });
    await t.sql`UPDATE inspirations SET visibility = 'public' WHERE id = ${f.inspirationId}`;
    const response = await f.app.request(`/api/inspirations/${f.inspirationId}`, { method: 'PATCH',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visibility: 'private' }) });
    expect(response.status).toBe(200);
    const jobs = await t.sql`SELECT type, payload FROM background_jobs`;
    expect(jobs).toHaveLength(2);
    expect(jobs.find((row) => row.type === 'refresh_group_top_of_mind')?.payload).toEqual({ groupId: group.id, reason: 'signals_changed' });
    expect(jobs.filter((row) => row.type === 'derive_signals').map((row) => row.payload)).toEqual([{ inspirationId: f.inspirationId, reason: 'edited' }]);
  });

  it('a failed room fan-out rolls back the save and the already-inserted personal request', async () => {
    const f = await fixture();
    await createGroupForProfile(t.db as never, { profileId: f.profileId, name: 'Shared room' });
    await t.sql`CREATE FUNCTION reject_group_request() RETURNS trigger AS $$ BEGIN
      IF NEW.payload ? 'deriveIntoProfileId' THEN RAISE EXCEPTION 'group queue unavailable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`;
    await t.sql`CREATE TRIGGER reject_group_request BEFORE INSERT ON background_jobs FOR EACH ROW EXECUTE FUNCTION reject_group_request()`;
    try {
      const response = await f.app.request('/api/inspirations', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'New public thought', visibility: 'public' }) });
      expect(response.status).toBe(500);
      expect((await t.sql`SELECT text FROM inspirations WHERE profile_id = ${f.profileId}`).map((row) => row.text)).toEqual(['Original words']);
      expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
    } finally { await t.sql`DROP TRIGGER reject_group_request ON background_jobs`; await t.sql`DROP FUNCTION reject_group_request()`; }
  });

  it('attachment finalization cannot lose its enrichment request', async () => {
    const f = await fixture();
    await withQueueUnavailable(async () => {
      const response = await f.app.request('/api/attachments', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ inspirationId: f.inspirationId, type: 'link', url: 'https://example.test/article' }) });
      expect(response.status).toBe(500);
      expect(await t.sql`SELECT id FROM attachments`).toHaveLength(0);
      expect(await t.sql`SELECT id FROM inspirations WHERE id = ${f.inspirationId}`).toHaveLength(1);
    });
  });

  it('deleting a public source reconciles every citing room and cancels obsolete source jobs', async () => {
    const f = await fixture();
    const group = await createGroupForProfile(t.db as never, { profileId: f.profileId, name: 'Shared room' });
    const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id = ${group.id}`;
    const [signal] = await t.sql`INSERT INTO signals(profile_id, statement, input_policy, locked_at)
      VALUES (${mind.id}, 'Our edited direction', 'group-public-v1', now()) RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${mind.id}, ${f.profileId}, ${signal.id}, ${f.inspirationId})`;
    await t.sql`INSERT INTO background_jobs(profile_id, type, payload)
      VALUES (${f.profileId}, 'derive_signals', ${JSON.stringify({ inspirationId: f.inspirationId, reason: 'edited' })}::jsonb)`;
    const response = await f.app.request(`/api/inspirations/${f.inspirationId}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    const [after] = await t.sql`SELECT statement, unsupported_at FROM signals WHERE id = ${signal.id}`;
    expect(after.statement).toBe('Our edited direction');
    expect(after.unsupported_at).not.toBeNull();
    const jobs = await t.sql`SELECT type, payload FROM background_jobs`;
    expect(jobs).toHaveLength(2);
    expect(jobs.some((row) => row.type === 'derive_signals')).toBe(false);
    expect(jobs.find((row) => row.type === 'refresh_group_top_of_mind')?.payload.groupId).toBe(group.id);
  });

  it('enrichment cache and personal/room derivation jobs commit together', async () => {
    const f = await fixture();
    await createGroupForProfile(t.db as never, { profileId: f.profileId, name: 'Shared room' });
    await t.sql`UPDATE inspirations SET visibility = 'public' WHERE id = ${f.inspirationId}`;
    const [attachment] = await t.sql`INSERT INTO attachments(profile_id, inspiration_id, type, url, enrichment_status)
      VALUES (${f.profileId}, ${f.inspirationId}, 'link', 'https://example.test', 'pending') RETURNING id`;
    const enrich = () => enrichAttachment(attachment.id as string, { db: t.db as never,
      readAttachment: async () => ({ result: { status: 'ready', kind: 'page_body', reason: null, text: 'A useful article' } }) });
    await withQueueUnavailable(async () => {
      await expect(enrich()).rejects.toThrow();
      expect((await t.sql`SELECT enrichment_status FROM attachments WHERE id = ${attachment.id}`)[0].enrichment_status).toBe('pending');
    });
    expect((await enrich()).status).toBe('ready');
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'derive_signals'`).toHaveLength(2);
  });

  it('an attachment changed during fetching cannot receive the old content', async () => {
    const f = await fixture();
    const [attachment] = await t.sql`INSERT INTO attachments(profile_id, inspiration_id, type, url, enrichment_status)
      VALUES (${f.profileId}, ${f.inspirationId}, 'link', 'https://example.test/old', 'pending') RETURNING id`;
    await expect(enrichAttachment(attachment.id as string, { db: t.db as never, readAttachment: async () => {
      await t.sql`UPDATE attachments SET url = 'https://example.test/new' WHERE id = ${attachment.id}`;
      return { result: { status: 'ready', kind: 'page_body', reason: null, text: 'OLD_CONTENT' } };
    } })).rejects.toThrow(/material changed/);
    expect((await t.sql`SELECT enrichment_text FROM attachments WHERE id = ${attachment.id}`)[0].enrichment_text).toBeNull();
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
  });
});
