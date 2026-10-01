import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { requestSignalDerivation } from './inspiration-derivation-requests.js';
import { enqueueDeriveSignals } from './queue.js';
import { loadInspirationMaterial, assertMaterialCurrent } from './inspiration-material.js';
import { createGroupForProfile } from '../routes/groups-membership.js';
import * as processing from './inspiration-processing.js';

let t: TestDatabase;
let sequence = 0;
beforeEach(async () => { vi.restoreAllMocks(); t ??= await createTestDatabase(); await t.truncateAll(); });
afterAll(async () => { vi.restoreAllMocks(); await t?.cleanup(); });
async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`processing-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'Original source') RETURNING id`;
  return { profileId: profile.id as string, inspirationId: source.id as string };
}
const versions = async (id: string) => (await t.sql`SELECT personal_revision::text, public_revision::text FROM inspiration_revisions WHERE inspiration_id = ${id}`)[0];

describe('source material and its numbered processing request', () => {
  it('initializes legacy sources without fabricating revision history or completed processing', async () => {
    const folder = fileURLToPath(new URL('../../../../drizzle/migrations/', import.meta.url));
    const staged = mkdtempSync(join(tmpdir(), 'waka-before-processing-'));
    const previous = process.env.WAKA_TEST_MIGRATIONS_DIR;
    let legacy: TestDatabase | undefined;
    try {
      for (const file of readdirSync(folder).filter((name) => name.endsWith('.sql') && name < '0041_')) copyFileSync(join(folder, file), join(staged, file));
      process.env.WAKA_TEST_MIGRATIONS_DIR = staged;
      legacy = await createTestDatabase();
      if (previous === undefined) delete process.env.WAKA_TEST_MIGRATIONS_DIR;
      else process.env.WAKA_TEST_MIGRATIONS_DIR = previous;
      const [account] = await legacy.sql`INSERT INTO accounts(email) VALUES ('legacy@example.test') RETURNING id`;
      const [profile] = await legacy.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Legacy') RETURNING id`;
      const [source] = await legacy.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'Kept before migration') RETURNING id`;
      await legacy.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer) VALUES (${profile.id}, ${source.id}, 'Why?', 'A legacy private answer')`;
      const migration = readFileSync(join(folder, '0041_inspiration-processing.sql'), 'utf8').replaceAll('"public"', `"${legacy.schemaName}"`);
      let duringRollout = '';
      await legacy.sql.begin(async (tx) => {
        for (const statement of migration.split('--> statement-breakpoint')) {
          if (statement.includes('Install tracking before the baseline')) {
            const [arrived] = await tx`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'Arrived during rollout') RETURNING id`;
            duringRollout = arrived.id as string;
            await tx`INSERT INTO reflections(profile_id, inspiration_id, question, answer) VALUES (${profile.id}, ${arrived.id}, 'Why?', 'New during rollout')`;
          }
          await tx.unsafe(statement);
        }
      });
      expect((await legacy.sql`SELECT personal_revision::text, public_revision::text FROM inspiration_revisions WHERE inspiration_id = ${source.id}`)[0])
        .toEqual({ personal_revision: '1', public_revision: '1' });
      expect((await legacy.sql`SELECT personal_revision::text, public_revision::text FROM inspiration_revisions WHERE inspiration_id = ${duringRollout}`)[0])
        .toEqual({ personal_revision: '2', public_revision: '1' });
      expect(await legacy.sql`SELECT id FROM inspiration_processing`).toHaveLength(0);
      expect((await legacy.sql`SELECT answer FROM reflections WHERE inspiration_id = ${source.id}`)[0].answer).toBe('A legacy private answer');
      await legacy.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer) VALUES (${profile.id}, ${source.id}, 'What now?', 'A new answer')`;
      expect((await legacy.sql`SELECT personal_revision::text, public_revision::text FROM inspiration_revisions WHERE inspiration_id = ${source.id}`)[0])
        .toEqual({ personal_revision: '2', public_revision: '1' });
    } finally {
      if (previous === undefined) delete process.env.WAKA_TEST_MIGRATIONS_DIR;
      else process.env.WAKA_TEST_MIGRATIONS_DIR = previous;
      await legacy?.cleanup();
      rmSync(staged, { recursive: true, force: true });
    }
  });

  it('ignores timing-only writes and skipped/unanswered prompts', async () => {
    const f = await fixture();
    await t.sql`UPDATE inspirations SET updated_at = now() WHERE id = ${f.inspirationId}`;
    const [answer] = await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer, skipped)
      VALUES (${f.profileId}, ${f.inspirationId}, 'An unanswered prompt', NULL, true) RETURNING id`;
    await t.sql`UPDATE reflections SET question = 'Still skipped' WHERE id = ${answer.id}`;
    await t.sql`DELETE FROM reflections WHERE id = ${answer.id}`;
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '1', public_revision: '1' });
  });

  it('tracks usable answer edits and transitions without double-counting one update', async () => {
    const f = await fixture();
    const [answer] = await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer)
      VALUES (${f.profileId}, ${f.inspirationId}, 'Why?', 'One answer') RETURNING id`;
    await t.sql`UPDATE reflections SET answer = 'Another answer' WHERE id = ${answer.id}`;
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '3', public_revision: '1' });
    await t.sql`UPDATE reflections SET skipped = true WHERE id = ${answer.id}`;
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '4', public_revision: '1' });
    await t.sql`UPDATE reflections SET skipped = false WHERE id = ${answer.id}`;
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '5', public_revision: '1' });
  });

  it('advances both projections for attachment material, but not an unchanged cache timestamp', async () => {
    const f = await fixture();
    const [attachment] = await t.sql`INSERT INTO attachments(profile_id, inspiration_id, type, url, enrichment_status)
      VALUES (${f.profileId}, ${f.inspirationId}, 'link', 'https://example.test/source', 'pending') RETURNING id`;
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '2', public_revision: '2' });
    await t.sql`UPDATE attachments SET enrichment_status = 'ready', enrichment_kind = 'page_body', enrichment_text = 'Fetched material' WHERE id = ${attachment.id}`;
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '3', public_revision: '3' });
    await t.sql`UPDATE attachments SET updated_at = now(), enrichment_updated_at = now(), enrichment_error_reason = NULL WHERE id = ${attachment.id}`;
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '3', public_revision: '3' });
    await t.sql`DELETE FROM attachments WHERE id = ${attachment.id}`;
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '4', public_revision: '4' });
  });

  it('rejects an older material snapshot after text changes and then returns to its original words', async () => {
    const f = await fixture();
    const before = await loadInspirationMaterial(t.db as never, f.profileId, f.inspirationId, 'personal');
    await t.sql`UPDATE inspirations SET text = 'Changed' WHERE id = ${f.inspirationId}`;
    await t.sql`UPDATE inspirations SET text = 'Original source' WHERE id = ${f.inspirationId}`;
    const after = await loadInspirationMaterial(t.db as never, f.profileId, f.inspirationId, 'personal');
    expect(after?.identity.hash).toBe(before?.identity.hash);
    expect(after?.identity.revision).toBe('3');
    await expect(t.db.transaction((tx) => assertMaterialCurrent(tx as never, before!, []))).rejects.toThrow(/material changed/i);
  });

  it('rolls material, counters, jobs and receipts back together when the save fails', async () => {
    const f = await fixture();
    await expect(t.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE inspirations SET text = 'Uncommitted edit' WHERE id = ${f.inspirationId}::uuid`);
      const result = await requestSignalDerivation({ ...f, reason: 'edited', changedSource: 'inspiration' }, tx as never);
      expect(result.receipt.materialRevision).toBe('2');
      throw new Error('Save failed');
    })).rejects.toThrow('Save failed');
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '1', public_revision: '1' });
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(0);
  });

  it('does not inherit completion when unchanged material is requested again', async () => {
    const f = await fixture();
    const first = await t.db.transaction((tx) => enqueueDeriveSignals(f.profileId, f.inspirationId, 'created', undefined, tx as never));
    await t.sql`UPDATE inspiration_processing SET derived_at = now(), completed_at = now(),
      result = '{"kind":"top_of_mind","topOfMindId":null,"version":0,"outcome":"empty"}'::jsonb WHERE id = ${first.receipt.id}`;
    const next = await t.db.transaction((tx) => enqueueDeriveSignals(f.profileId, f.inspirationId, 'edited', undefined, tx as never));
    expect(next.receipt.id).not.toBe(first.receipt.id);
    expect(next.receipt.materialRevision).toBe(first.receipt.materialRevision);
    expect((await t.sql`SELECT derived_at, completed_at, result FROM inspiration_processing WHERE id = ${next.receipt.id}`)[0])
      .toEqual({ derived_at: null, completed_at: null, result: null });
  });

  it('binds public room material independently of private reflection changes', async () => {
    const f = await fixture();
    const group = await createGroupForProfile(t.db as never, { profileId: f.profileId, name: 'Shared room' });
    const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id = ${group.id}`;
    await t.sql`UPDATE inspirations SET visibility = 'public' WHERE id = ${f.inspirationId}`;
    await t.db.transaction((tx) => requestSignalDerivation({ ...f, reason: 'edited', changedSource: 'inspiration' }, tx as never));
    const groupBefore = await t.sql`SELECT id, material_revision, derivation_request_version FROM inspiration_processing WHERE profile_id = ${mind.id}`;
    await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer) VALUES (${f.profileId}, ${f.inspirationId}, 'Why?', 'PRIVATE_SENTINEL')`;
    const personal = await t.db.transaction((tx) => requestSignalDerivation({ ...f, reason: 'edited', changedSource: 'reflection' }, tx as never));
    expect(personal.receipt.materialRevision).toBe('3');
    expect(await t.sql`SELECT id, material_revision, derivation_request_version FROM inspiration_processing WHERE profile_id = ${mind.id}`).toEqual(groupBefore);
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '3', public_revision: '2' });
    expect(JSON.stringify(await t.sql`SELECT row_to_json(p) AS metadata FROM inspiration_processing p`)).not.toContain('PRIVATE_SENTINEL');
  });

  it.each(['private', 'deleted'] as const)('a %s capture encountered during room backfill does not strand the remaining public material', async (change) => {
    const f = await fixture();
    await t.sql`UPDATE inspirations SET visibility = 'public' WHERE id = ${f.inspirationId}`;
    await t.sql`INSERT INTO inspirations(profile_id, text, visibility) VALUES (${f.profileId}, 'Another public source', 'public')`;
    let calls = 0;
    const group = await createGroupForProfile(t.db as never, { profileId: f.profileId, name: 'Backfill race' }, {
      enqueueDerive: async (profileId, inspirationId, reason, destination) => {
        if (++calls === 1) {
          if (change === 'deleted') await t.sql`DELETE FROM inspirations WHERE id = ${inspirationId}`;
          else await t.sql`UPDATE inspirations SET visibility = 'private' WHERE id = ${inspirationId}`;
        }
        return t.db.transaction((tx) => enqueueDeriveSignals(profileId, inspirationId, reason, destination, tx as never));
      },
    });
    expect(calls).toBe(2);
    expect(await t.sql`SELECT p.id FROM inspiration_processing p JOIN profiles d ON d.id = p.profile_id WHERE d.group_id = ${group.id}`).toHaveLength(1);
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'derive_signals'`).toHaveLength(1);
  });

  it('refuses a foreign destination and rolls back the just-enqueued job', async () => {
    const f = await fixture(), other = await fixture();
    await expect(t.db.transaction((tx) => enqueueDeriveSignals(f.profileId, f.inspirationId, 'created', other.profileId, tx as never)))
      .rejects.toThrow(/authorized material/);
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(0);
  });

  it('does not give a legacy agent membership permission to contribute room material', async () => {
    const f = await fixture();
    await createGroupForProfile(t.db as never, { profileId: f.profileId, name: 'Legacy seat' });
    await t.sql`UPDATE profiles SET type = 'agent' WHERE id = ${f.profileId}`;
    await t.sql`UPDATE inspirations SET visibility = 'public' WHERE id = ${f.inspirationId}`;
    const result = await t.db.transaction((tx) => requestSignalDerivation({ ...f, reason: 'created', changedSource: 'inspiration' }, tx as never));
    expect(result.groupJobIds).toEqual([]);
    expect(await t.sql`SELECT profile_id FROM inspiration_processing`).toEqual([{ profile_id: f.profileId }]);
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(1);
  });

  it('a destination becoming unavailable does not roll back the personal save or leave its failed room enqueue behind', async () => {
    const f = await fixture();
    await createGroupForProfile(t.db as never, { profileId: f.profileId, name: 'Room closes during save' });
    const record = processing.recordInspirationProcessingRequest;
    // Only the authorization outcome is injected here; the source update,
    // queue writes, savepoint and rollback are real SQL. Separate cases above
    // exercise the actual visibility/membership checks and backfill races.
    vi.spyOn(processing, 'recordInspirationProcessingRequest').mockImplementation((tx, input) => {
      if (input.profileId !== input.ownerProfileId) throw new processing.InspirationProcessingUnavailableError();
      return record(tx, input);
    });
    const result = await t.db.transaction(async (tx) => {
      await tx.execute(sql`UPDATE inspirations SET text = 'The personal save survives', visibility = 'public' WHERE id = ${f.inspirationId}::uuid`);
      return requestSignalDerivation({ ...f, reason: 'edited', changedSource: 'inspiration' }, tx as never);
    });
    expect(result.groupJobIds).toEqual([]);
    expect((await t.sql`SELECT text FROM inspirations WHERE id = ${f.inspirationId}`)[0].text).toBe('The personal save survives');
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(1);
    expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(1);
  });

  it('deleting a reflected source removes its revision and processing metadata without orphaning copies', async () => {
    const f = await fixture();
    await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer) VALUES (${f.profileId}, ${f.inspirationId}, 'Why?', 'An answer')`;
    await t.db.transaction((tx) => requestSignalDerivation({ ...f, reason: 'created', changedSource: 'inspiration' }, tx as never));
    await t.sql`DELETE FROM inspirations WHERE id = ${f.inspirationId}`;
    expect(await t.sql`SELECT inspiration_id FROM inspiration_revisions`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(0);
  });

  it('a source deletion can cancel its job while a concurrent enqueue waits for the parent', async () => {
    const f = await fixture();
    const first = await t.db.transaction((tx) => enqueueDeriveSignals(f.profileId, f.inspirationId, 'created', undefined, tx as never));
    const [{ pid }] = await t.sql`SELECT pg_backend_pid() AS pid`;
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false, connection: { search_path: t.schemaName } });
    let release!: () => void;
    let ready!: (tx: postgres.TransactionSql) => void;
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const holding = new Promise<postgres.TransactionSql>((resolve) => { ready = resolve; });
    const removal = other.begin(async (tx) => {
      await tx`SELECT id FROM inspirations WHERE id = ${f.inspirationId} FOR UPDATE`;
      ready(tx); await resume;
      await tx`DELETE FROM background_jobs WHERE id = ${first.jobId}`;
      await tx`DELETE FROM inspirations WHERE id = ${f.inspirationId}`;
    });
    const held = await holding;
    const enqueue = t.db.transaction((tx) => enqueueDeriveSignals(f.profileId, f.inspirationId, 'edited', undefined, tx as never))
      .then(() => ({ ok: true }), (error: unknown) => ({ ok: false, error }));
    try {
      let waited = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const [state] = await held`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
        if (state?.wait_event_type === 'Lock') { waited = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(waited).toBe(true);
    } finally { release(); await removal; await other.end(); }
    expect(await enqueue).toMatchObject({ ok: false, error: { name: 'InspirationProcessingUnavailableError' } });
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(0);
  });

  it('binds a saved source to its material revision and exact derivation request', async () => {
    const f = await fixture();
    const result = await t.db.transaction((tx) => requestSignalDerivation({ ...f, reason: 'created', changedSource: 'inspiration' }, tx as never));
    expect(result).toMatchObject({ receipt: { ...f, materialRevision: '1', requestVersion: '1' } });
  });

  it('advances only personal material when a private answer is saved or removed', async () => {
    const f = await fixture();
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '1', public_revision: '1' });
    const [answer] = await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer)
      VALUES (${f.profileId}, ${f.inspirationId}, 'Why?', 'My private answer') RETURNING id`;
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '2', public_revision: '1' });
    await t.sql`DELETE FROM reflections WHERE id = ${answer.id}`;
    expect(await versions(f.inspirationId)).toEqual({ personal_revision: '3', public_revision: '1' });
  });

  it('distinguishes successive material revisions even when the queue reuses one job', async () => {
    const f = await fixture();
    const first = await t.db.transaction((tx) => requestSignalDerivation({ ...f, reason: 'created', changedSource: 'inspiration' }, tx as never));
    await t.sql`UPDATE inspirations SET text = 'New source' WHERE id = ${f.inspirationId}`;
    const second = await t.db.transaction((tx) => requestSignalDerivation({ ...f, reason: 'edited', changedSource: 'inspiration' }, tx as never));
    expect(second).toMatchObject({ jobId: first.jobId, receipt: { ...f, materialRevision: '2', requestVersion: '2' } });
  });
});
