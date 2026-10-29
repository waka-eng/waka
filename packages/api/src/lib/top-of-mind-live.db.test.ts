/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Opt-in live provider calls
 * and real synthesis, publication review, SQL ownership and version writes
 * run over synthetic material in a disposable local database. No user archive
 * is accessed. Ordinary test runs visibly skip without the explicit flag. */
import { afterAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { refreshTopOfMindForProfile } from './top-of-mind-synthesis.js';
import { copiesSource, readingMatchesLocale } from './top-of-mind-quality.js';

const live = process.env.WAKA_RUN_LIVE_EVALS === '1' && Boolean(process.env.OPENROUTER_API_KEY || process.env.GEMINI_API_KEY);
let t: TestDatabase | undefined;
afterAll(async () => { await t?.cleanup(); });
const originals = [
  'I watched a first-time visitor hesitate because the Save control was hidden in a menu.',
  'In a separate test, a visitor expected Close to return them to the page they had just left.',
];
const statements = [
  'Clear save controls can reduce hesitation during a capture.',
  'Predictable closing behavior can help people find their way during a capture.',
];

describe.skipIf(!live)('live personal reading publication', () => {
  it.each(['en-US', 'ko-KR'] as const)('synthesizes English sources into a grounded %s reading and persists it', async locale => {
    t ??= await createTestDatabase();
    const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`live-reading-${locale}@example.test`}) RETURNING id`;
    const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name,preferred_locale)
      VALUES (${account.id},'human','Synthetic reader',${locale}) RETURNING id`;
    const signalIds: string[] = [];
    for (const [index, text] of originals.entries()) {
      const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},${text}) RETURNING id`;
      const [signal] = await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${profile.id},${statements[index]}) RETURNING id`;
      await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
        VALUES (${profile.id},${profile.id},${signal.id},${source.id})`;
      signalIds.push(signal.id as string);
    }
    const result = await refreshTopOfMindForProfile({ profileId: profile.id as string, reason: 'manual' }, { db: t.db as never });
    expect(result.status).toBe('versioned'); expect(result.entryCount).toBeGreaterThan(0);
    const entries = await t.sql`SELECT id,body FROM top_of_mind_entries WHERE top_of_mind_id=${result.topOfMindId}`;
    for (const entry of entries) {
      expect(readingMatchesLocale(entry.body as string, locale)).toBe(true);
      expect(copiesSource(entry.body as string, originals)).toBe(false);
      const citations = await t.sql`SELECT signal_id FROM top_of_mind_entry_signals WHERE entry_id=${entry.id}`;
      expect(citations.map(row => row.signal_id).sort()).toEqual([...signalIds].sort());
    }
  }, 90_000);
});
