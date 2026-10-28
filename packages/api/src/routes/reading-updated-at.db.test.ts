import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { getLiveTopOfMind } from './top-of-mind.js';
let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t.cleanup(); });
it('keeps a no-change refresh honest and advances the date for a human edit', async () => {
  const [a] = await t.sql`INSERT INTO accounts(email) VALUES('reading-date@example.test') RETURNING id`;
  const [p] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES(${a.id},'human','Reader') RETURNING id`;
  await t.sql`INSERT INTO top_of_minds(profile_id,version,status,reason,created_at) VALUES(${p.id},1,'superseded','initial','2026-10-01T12:00:00Z')`;
  const [v] = await t.sql`INSERT INTO top_of_minds(profile_id,version,status,reason,created_at) VALUES(${p.id},2,'live','no_change','2026-10-02T12:00:00Z') RETURNING id`;
  const [e] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,created_at,updated_at) VALUES(${v.id},'pattern','A synthetic reading','2026-10-02T12:00:00Z','2026-10-02T12:00:00Z') RETURNING id`;
  expect((await getLiveTopOfMind(t.db as never, {profileId:p.id}))?.contentUpdatedAt).toBe('2026-10-01T12:00:00.000Z');
  await t.sql`UPDATE top_of_mind_entries SET body='My own wording',locked_at='2026-10-03T12:00:00Z',updated_at='2026-10-03T12:00:00Z' WHERE id=${e.id}`;
  expect((await getLiveTopOfMind(t.db as never, {profileId:p.id}))?.contentUpdatedAt).toBe('2026-10-03T12:00:00.000Z');
});
