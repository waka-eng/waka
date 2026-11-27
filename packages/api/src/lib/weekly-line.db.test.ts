/** YOUR WEEK, IN ONE LINE (insight goal, phase 5, 2026-11-26).
 *
 * WHAT THIS MOCKS, AND WHY (gate G6): nothing. Real rows in a disposable
 * local database: saves, signals, evidence and a live reading, read through
 * the same `getLiveTopOfMind` the route serves. The clock is passed in. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { getLiveTopOfMind } from '../routes/top-of-mind.js';
import { loadWeeklyLine } from './weekly-line.js';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase(); });
afterAll(async () => { await t?.cleanup(); });

const DAY = 86_400_000;
const now = new Date('2026-11-29T12:00:00Z');
const at = (days: number) => new Date(now.getTime() - days * DAY);
/* The driver takes timestamps as text. */
const ago = (days: number) => at(days).toISOString();

async function person(label: string, saves: Array<{ text: string; daysAgo: number }>, readingDaysAgo: number) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`week-${label}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human',${label}) RETURNING id`;
  const [signal] = await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${profile.id},'Small steps make change possible') RETURNING id`;
  const ids: string[] = [];
  for (const save of saves) {
    const [row] = await t.sql`INSERT INTO inspirations(profile_id,text,created_at) VALUES (${profile.id},${save.text},${ago(save.daysAgo)}) RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id) VALUES (${profile.id},${profile.id},${signal.id},${row.id})`;
    ids.push(row.id as string);
  }
  const [reading] = await t.sql`INSERT INTO top_of_minds(profile_id,version,status,reason,created_at)
    VALUES (${profile.id},1,'live','initial',${ago(readingDaysAgo)}) RETURNING id`;
  const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,sort_order,created_at,updated_at)
    VALUES (${reading.id},'pattern','You keep making the next step small enough to take.',0,${ago(readingDaysAgo)},${ago(readingDaysAgo)}) RETURNING id`;
  await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id,owner_profile_id) VALUES (${entry.id},${signal.id},${profile.id})`;
  return { profileId: profile.id as string, ids };
}
const weekOf = async (profileId: string) =>
  loadWeeklyLine(t.db as never, profileId, await getLiveTopOfMind(t.db as never, { profileId }), now);

describe('the week in one line', () => {
  it('is the lead reading, resting on this week\'s saves, newest first', async () => {
    const p = await person('moved', [{ text: 'Walked home the long way.', daysAgo: 2 }, { text: 'One concrete step today.', daysAgo: 1 },
      { text: 'Something from last month.', daysAgo: 30 }], 1);
    const week = await weekOf(p.profileId);
    expect(week?.line).toBe('You keep making the next step small enough to take.');
    expect(week?.saveIds).toEqual([p.ids[1], p.ids[0]]);
    expect(week?.week).toEqual({ from: ago(7), to: now.toISOString() });
  });
  it('says nothing when only one of this week\'s saves stands under it', async () => {
    const p = await person('thin', [{ text: 'Walked home the long way.', daysAgo: 2 }, { text: 'Older thing.', daysAgo: 20 }], 1);
    expect(await weekOf(p.profileId)).toBeNull();
  });
  it('says nothing when the week did not write or confirm the reading', async () => {
    const p = await person('still', [{ text: 'A.', daysAgo: 2 }, { text: 'B.', daysAgo: 3 }], 12);
    expect(await weekOf(p.profileId)).toBeNull();
  });
  it('says nothing with no reading at all', async () => {
    const [account] = await t.sql`INSERT INTO accounts(email) VALUES ('week-none@example.test') RETURNING id`;
    const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'human','none') RETURNING id`;
    expect(await weekOf(profile.id as string)).toBeNull();
  });
});
