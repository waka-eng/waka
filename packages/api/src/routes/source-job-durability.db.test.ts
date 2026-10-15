/** Actual routes and isolated Postgres; only the default DB factory is scoped
 * to the same test connection as the injected route DB. No model/network calls. */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createInspirationsRoutes } from "./inspirations.js";
import { createAttachmentRoutes } from "./attachments.js";
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
  it('returns a receipt for the exact capture/answer revision committed by each save', async () => {
    const f = await fixture();
    const create = await f.app.request('/api/inspirations', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'A new capture', reflections: [{ question: 'Why?', answer: 'First answer' }, { question: 'What else?', answer: 'Second answer' }] }) });
    expect(create.status).toBe(201);
    const saved = await create.json() as { inspiration: { id: string }; processing: { id: string; jobId: string; materialRevision: string; requestVersion: string } };
    expect(saved.processing).toMatchObject({ materialRevision: '3', requestVersion: '1' });
    const edit = await f.app.request(`/api/inspirations/${saved.inspiration.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'A revised capture' }) });
    expect(edit.status).toBe(200);
    expect(await edit.json()).toMatchObject({ processing: { jobId: saved.processing.jobId, materialRevision: '4', requestVersion: '2' } });
    const answer = await f.app.request(`/api/inspirations/${saved.inspiration.id}/reflections`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'What now?', answer: 'A third answer' }) });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toMatchObject({ processing: { jobId: saved.processing.jobId, materialRevision: '5', requestVersion: '3' } });
    const receipts = await t.sql`SELECT material_revision::text, derived_at, completed_at FROM inspiration_processing WHERE inspiration_id = ${saved.inspiration.id} ORDER BY material_revision`;
    expect(receipts).toEqual(['3', '4', '5'].map((material_revision) => ({ material_revision, derived_at: null, completed_at: null })));
  });

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

  /* ── "PUBLIC SAVES FAN OUT DURABLY, BUT SAVED ANSWERS REMAIN PERSONAL",
     DELETED ────────────────────────────────────────────────────────────
     Founder: "방 없애". A public save used to enqueue TWO `derive_signals`
     jobs — one for the person, one aimed at each room's mind through
     `deriveIntoProfileId` — both billed to the saver, and a saved ANSWER had
     to enqueue only the first, because an answer is private and a room never
     reads one. The asymmetry was the whole test. One destination remains, so
     both halves collapse to "a save enqueues its job", which the first case
     in this file already holds revision by revision. */

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

  /* ── TWO MORE ROOM FAN-OUT CASES, DELETED ────────────────────────────
     Founder: "방 없애". "turning a public inspiration private requests a room
     reread, not private derivation" pinned the WITHDRAWAL direction: making
     a shared memory private must ask every room that read it to read again
     without it, and must NOT pretend the memory itself changed. There is
     nothing to withdraw from. `inspirations.visibility` is still stored,
     still returned and still accepted by PATCH — the founder has not ruled
     on the data — but no reader is left for it to mean anything to.

     "a failed room fan-out rolls back the save and the already-inserted
     personal request" was the strongest durability claim in the file: the
     personal job is inserted FIRST, so a room enqueue failing after it must
     take the whole save down rather than commit a capture whose learning was
     half-requested. It needed a second enqueue that could fail on its own,
     and there is one enqueue now — if it fails the save fails, which is the
     same guarantee with nothing left to coordinate. `withQueueUnavailable`
     below still holds exactly that for the single-enqueue shape. */

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

  it('deleting a source retires what cited it and cancels its obsolete jobs', async () => {
    /* THE ROOM CAME OUT; THE RECONCILIATION DID NOT. Founder: "방 없애".
       This used to make the citing signal a ROOM's — minted into the room's
       mind, stamped `group-public-v1`, cited at the member's public
       revision — and assert that deleting the member's capture both retired
       the room's statement and woke `refresh_group_top_of_mind`. Aimed at
       the owner's own signal the two claims that survive are the same two,
       and they are the ones that matter after a delete: a locked statement
       is NOT rewritten or removed (it is the person's words), it is marked
       unsupported, and the `derive_signals` job that was queued for the
       now-deleted source is cancelled rather than left to fail. */
    const f = await fixture();
    const [signal] = await t.sql`INSERT INTO signals(profile_id, statement, locked_at)
      VALUES (${f.profileId}, 'Our edited direction', now()) RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${f.profileId}, ${f.profileId}, ${signal.id}, ${f.inspirationId})`;
    await t.sql`INSERT INTO background_jobs(profile_id, type, payload)
      VALUES (${f.profileId}, 'derive_signals', ${JSON.stringify({ inspirationId: f.inspirationId, reason: 'edited' })}::jsonb)`;
    const response = await f.app.request(`/api/inspirations/${f.inspirationId}`, { method: 'DELETE' });
    expect(response.status).toBe(200);
    const [after] = await t.sql`SELECT statement, unsupported_at FROM signals WHERE id = ${signal.id}`;
    expect(after.statement).toBe('Our edited direction');
    expect(after.unsupported_at).not.toBeNull();
    const jobs = await t.sql`SELECT type FROM background_jobs`;
    /* EXACT, not `some`. The room used to make this count two, and dropping to
       `some` to survive that lost the count entirely — an unexpected third job
       would have passed. One job is the whole claim now. */
    expect(jobs.map((row) => row.type)).toEqual(['refresh_top_of_mind']);
  });

  it('enrichment cache and the derivation job it provokes commit together', async () => {
    /* Was "personal/room derivation jobs commit together": the room made the
       count TWO, which is what made "together" visible. Founder: "방 없애" —
       one job now, and the atomicity claim is unchanged. The first attempt
       runs with the queue refusing inserts and must leave the attachment
       `pending` rather than cached-but-unlearned; the retry caches and
       enqueues in one commit. */
    const f = await fixture();
    const [attachment] = await t.sql`INSERT INTO attachments(profile_id, inspiration_id, type, url, enrichment_status)
      VALUES (${f.profileId}, ${f.inspirationId}, 'link', 'https://example.test', 'pending') RETURNING id`;
    const enrich = () => enrichAttachment(attachment.id as string, { db: t.db as never,
      readAttachment: async () => ({ result: { status: 'ready', kind: 'page_body', reason: null, text: 'A useful article' } }) });
    await withQueueUnavailable(async () => {
      await expect(enrich()).rejects.toThrow();
      expect((await t.sql`SELECT enrichment_status FROM attachments WHERE id = ${attachment.id}`)[0].enrichment_status).toBe('pending');
    });
    expect((await enrich()).status).toBe('ready');
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'derive_signals'`).toHaveLength(1);
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
