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

  /* ── TWO ROOM FAN-OUT CASES, DELETED ──────────────────────────────────
     Founder: "방 없애". "binds public room material independently of private
     reflection changes" held the SPLIT: a capture shared into a room carries
     two revisions, a personal one that a private answer advances and a
     public one that it must not, so writing something private could never
     invalidate what a room had already read. One scope is left, so there is
     no split to bind.

     "a %s capture encountered during room backfill does not strand the
     remaining public material" (private / deleted) held the backfill
     `createGroupForProfile` ran on arrival — one derivation per existing
     public memory, aimed at the room's mind, surviving a capture that turns
     private or disappears mid-run. Joining is gone, so arriving-with-an-
     archive is gone, and the loop it protected no longer runs.

     Both were also the only callers of the `enqueueDerive` seam on
     `createGroupForProfile`. */

  it('refuses a foreign destination and rolls back the just-enqueued job', async () => {
    const f = await fixture(), other = await fixture();
    await expect(t.db.transaction((tx) => enqueueDeriveSignals(f.profileId, f.inspirationId, 'created', other.profileId, tx as never)))
      .rejects.toThrow(/authorized material/);
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM inspiration_processing`).toHaveLength(0);
  });

  /* ── TWO MORE ROOM CASES, DELETED ─────────────────────────────────────
     Founder: "방 없애". "does not give a legacy agent membership permission
     to contribute room material" was a real gate over real bad data — six
     agent-seated rows had reached the dev database, and `docs/data-model.md`
     rule 5 says membership is between people. It gated `groupJobIds` coming
     back empty for an agent with a seat.

     CORRECTION (2026-10-15): IT WAS NOT DELETED, it was rewritten — see the
     case below. An earlier version of this note said "the rule it enforced is
     now enforced by there being nowhere to go." That was wrong. The rule is
     enforced by a live SQL predicate — `owner.type = 'human'` in
     `authorizedDestination` and again in `recordInspirationProcessingRequest`
     — and closing the routes did not remove it. The six agent-seated rows are
     STILL IN THE DEV DATABASE, nothing here deletes them, and
     `requestSignalDerivation` still walks a seat it finds. Deleting the only
     test of a live authorization predicate, over data that really exists,
     would have left the rule able to regress with the suite green. The case
     is restored below without the deleted route helper.

     "a destination becoming unavailable does not roll back the personal save
     or leave its failed room enqueue behind" pinned the most important
     ordering property of the fan-out — that a room's enqueue failing inside
     the save transaction must cost the room's job and NOT the person's
     capture. It needed a second destination that could fail independently of
     the first. There is one destination now, and if it fails the save fails,
     which is the correct and much simpler behaviour.

     CORRECTION (2026-10-15): the savepoint-and-rollback machinery did NOT
     come out. The nested transaction and its `InspirationProcessingUnavailableError`
     swallow are still in `lib/inspiration-derivation-requests.ts`, because
     the room branch they guard is still there for any profile holding a
     seat. What this case lost is its second independently-failing
     destination, which no door can create any more — not the machinery. */

  it('does not give a legacy agent membership permission to contribute room material', async () => {
    /* RESTORED 2026-10-15. This gates a LIVE predicate over data that really
       exists: six agent-seated `group_members` rows reached the dev database,
       `docs/data-model.md` rule 5 says membership is between people, and the
       only thing keeping an agent's material out of a room's ground is the
       `owner.type = 'human'` join in `authorizedDestination`. The routes are
       gone; the seats and the code that walks them are not.

       Seated with direct SQL rather than `createGroupForProfile`, which went
       with the room routes. Writing the rows at the table is also the more
       honest fixture here — it reproduces the legacy data exactly as it sits
       in the database, instead of through a door that no longer exists. */
    const f = await fixture();
    const [group] = await t.sql`INSERT INTO groups(name, join_code, created_by_profile_id)
      VALUES ('Legacy seat', ${'legacy-' + Math.random().toString(36).slice(2, 10)}, ${f.profileId}) RETURNING id`;
    await t.sql`INSERT INTO group_members(group_id, profile_id) VALUES (${group.id}, ${f.profileId})`;
    await t.sql`UPDATE profiles SET type = 'agent' WHERE id = ${f.profileId}`;
    await t.sql`UPDATE inspirations SET visibility = 'public' WHERE id = ${f.inspirationId}`;
    const result = await t.db.transaction((tx) => requestSignalDerivation({ ...f, reason: 'created', changedSource: 'inspiration' }, tx as never));
    expect(result.groupJobIds).toEqual([]);
    expect(await t.sql`SELECT profile_id FROM inspiration_processing`).toEqual([{ profile_id: f.profileId }]);
    expect(await t.sql`SELECT id FROM background_jobs`).toHaveLength(1);
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
