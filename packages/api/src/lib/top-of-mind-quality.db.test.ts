import { approveReadingReview } from '../../test/helpers/top-of-mind-review.js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { refreshTopOfMindForProfile } from './top-of-mind-synthesis.js';
import type { ModelProvider, TopOfMindSynthesisInput, TopOfMindSynthesisResult, TopOfMindReviewInput, TopOfMindReviewResult } from './model-provider.js';

// Real SQL evidence/ownership/revision checks; only the model is replaced so
// wrong-language, copied and misleading noChange replies are deterministic.
let t: TestDatabase;
let profileId: string;
let signalIds: string[];
let inspirationIds: string[];
const originals = ['I watched someone struggle to find the save button.', 'The first test exposed a confusing return path.'];
const fresh = 'You are noticing how small navigation choices shape the experience.';
const korean = '작은 사용성 실험을 통해 사람들이 망설이는 순간에 주목하고 있어요.';
let reply: (input: TopOfMindSynthesisInput) => Promise<TopOfMindSynthesisResult>;
const synthesize = vi.fn((input: TopOfMindSynthesisInput) => reply(input));
let review: (input: TopOfMindReviewInput) => Promise<TopOfMindReviewResult> = approveReadingReview;
const refresh = () => refreshTopOfMindForProfile({ profileId, reason: 'manual' }, {
  db: t.db as never, modelProvider: { reviewTopOfMind: (input: TopOfMindReviewInput) => review(input), synthesizeTopOfMind: synthesize } as unknown as ModelProvider,
});
const stored = () => t.sql`SELECT e.body FROM top_of_mind_entries e JOIN top_of_minds a ON a.id=e.top_of_mind_id
  WHERE a.profile_id=${profileId} AND a.status='live' AND e.dismissed_at IS NULL ORDER BY e.sort_order`;
const proposed = (body = fresh): TopOfMindSynthesisResult => ({ entries: [{ type: 'pattern', body, citedSignalIds: signalIds }] });

beforeAll(async () => { t = await createTestDatabase(); });
beforeEach(async () => {
  await t.truncateAll();
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES ('tom-quality@example.test') RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name,preferred_locale)
    VALUES (${account.id},'human','Reader','en-US') RETURNING id`;
  profileId = profile.id as string; signalIds = []; inspirationIds = [];
  for (const text of originals) {
    const [original] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profileId},${text}) RETURNING id`;
    const [signal] = await t.sql`INSERT INTO signals(profile_id,statement)
      VALUES (${profileId},${`Possible attention to navigation: ${text}`}) RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
      VALUES (${profileId},${profileId},${signal.id},${original.id})`;
    signalIds.push(signal.id as string); inspirationIds.push(original.id as string);
  }
  synthesize.mockClear(); reply = async () => proposed(); review = approveReadingReview;
});
afterAll(async () => { await t?.cleanup(); });

it('uses the stored Korean preference despite English inspirations and exposes real source identities', async () => {
  await t.sql`UPDATE profiles SET preferred_locale='ko-KR' WHERE id=${profileId}`;
  reply = async () => proposed(korean);
  expect((await refresh()).entryCount).toBe(1);
  expect(synthesize.mock.calls[0]![0].preferredLocale).toBe('ko-KR');
  expect(synthesize.mock.calls[0]![0].signals.flatMap(row => row.inspirationIds).sort()).toEqual([...inspirationIds].sort());
  expect((await stored()).map(row => row.body)).toEqual([korean]);
});

it('blocks a wrong-language response even when its citations are valid', async () => {
  await t.sql`UPDATE profiles SET preferred_locale='ko-KR' WHERE id=${profileId}`;
  await expect(refresh()).rejects.toThrow(/publication checks/);
  expect(await stored()).toHaveLength(0);
});

it('does not let noChange preserve the old language, and accepts a translated repair mislabeled noChange', async () => {
  await refresh();
  await t.sql`UPDATE profiles SET preferred_locale='ko-KR' WHERE id=${profileId}`;
  reply = async input => {
    expect(input.currentEntries).toEqual([]);
    return { ...proposed(korean), noChange: true };
  };
  expect((await refresh()).reason).toBe('regenerated');
  expect((await stored()).map(row => row.body)).toEqual([korean]);
  await t.sql`UPDATE profiles SET preferred_locale='en-US' WHERE id=${profileId}`;
  reply = async () => ({ noChange: true, entries: [] });
  await refresh();
  expect(await stored()).toHaveLength(0);
});

it('rejects a copied inspiration while retaining a valid derived entry', async () => {
  reply = async () => ({ entries: [...proposed(originals[0]).entries, ...proposed().entries] });
  expect((await refresh()).entryCount).toBe(1);
  expect((await stored()).map(row => row.body)).toEqual([fresh]);
});

it('does not preserve an old quotation through noChange', async () => {
  await refresh();
  await t.sql`UPDATE top_of_mind_entries SET body=${originals[0]} WHERE top_of_mind_id IN
    (SELECT id FROM top_of_minds WHERE profile_id=${profileId} AND status='live')`;
  reply = async input => { expect(input.currentEntries).toEqual([]); return { noChange: true, entries: [] }; };
  await refresh();
  expect(await stored()).toHaveLength(0);
});

it('waits without a model call when multiple signals all come from one inspiration', async () => {
  await t.sql`DELETE FROM signal_evidence WHERE signal_id=${signalIds[1]}`;
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
    VALUES (${profileId},${profileId},${signalIds[1]},${inspirationIds[0]})`;
  expect((await refresh()).status).toBe('nothing_to_synthesize');
  expect(synthesize).not.toHaveBeenCalled();
});

it('requires two sources per entry, not merely somewhere in the model context', async () => {
  reply = async () => ({ entries: [{ ...proposed().entries[0]!, citedSignalIds: [signalIds[0]!] }] });
  await expect(refresh()).rejects.toThrow(/publication checks/);
});

it('allows one signal that is actually derived from two different inspirations', async () => {
  await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
    VALUES (${profileId},${profileId},${signalIds[0]},${inspirationIds[1]})`;
  reply = async () => ({ entries: [{ ...proposed().entries[0]!, citedSignalIds: [signalIds[0]!] }] });
  expect((await refresh()).entryCount).toBe(1);
});

it('preserves explicitly edited wording exactly, including its language', async () => {
  await refresh();
  await t.sql`UPDATE top_of_mind_entries SET body=${originals[0]},locked_at=now() WHERE top_of_mind_id IN
    (SELECT id FROM top_of_minds WHERE profile_id=${profileId} AND status='live')`;
  await t.sql`UPDATE profiles SET preferred_locale='ko-KR' WHERE id=${profileId}`;
  reply = async () => ({ noChange: true, entries: [] });
  await refresh();
  expect((await stored()).map(row => row.body)).toEqual([originals[0]]);
});

it('rejects a generation started before the language changed', async () => {
  reply = async () => {
    await t.sql`UPDATE profiles SET preferred_locale='ko-KR' WHERE id=${profileId}`;
    return proposed();
  };
  await expect(refresh()).rejects.toThrow(/Generation inputs changed/);
  expect(await stored()).toHaveLength(0);
});

it('lets kept words regain current citations without subjecting them to machine wording rules', async () => {
  await refresh();
  await t.sql`UPDATE top_of_mind_entries SET body=${originals[1]},locked_at=now() WHERE top_of_mind_id IN
    (SELECT id FROM top_of_minds WHERE profile_id=${profileId} AND status='live')`;
  await t.sql`DELETE FROM signal_evidence WHERE signal_id=${signalIds[0]}`;
  await t.sql`UPDATE profiles SET preferred_locale='ko-KR' WHERE id=${profileId}`;
  reply = async input => {
    expect(input.lockedEntries[0]?.supportChanged).toBe(true);
    return { entries: [{ type: 'pattern', body: originals[1]!, citedSignalIds: [signalIds[1]!] }] };
  };
  await refresh();
  expect((await stored()).map(row => row.body)).toEqual([originals[1]]);
  const citations = await t.sql`SELECT c.signal_id FROM top_of_mind_entry_signals c JOIN top_of_mind_entries e ON e.id=c.entry_id
    JOIN top_of_minds a ON a.id=e.top_of_mind_id WHERE a.profile_id=${profileId} AND a.status='live'`;
  expect(citations.map(row => row.signal_id)).toEqual([signalIds[1]]);
});


it('retains the current version when a non-noChange proposal is entirely rejected, then recovers on retry', async () => {
  const first = await refresh();
  reply = async () => ({ ...proposed(originals[0]), noChange: false });
  await expect(refresh()).rejects.toThrow(/publication checks/);
  expect((await stored()).map(row => row.body)).toEqual([fresh]);
  const versions = await t.sql`SELECT id FROM top_of_minds WHERE profile_id=${profileId}`;
  expect(versions.map(row => row.id)).toEqual([first.topOfMindId]);
  reply = async () => proposed('You are exploring ways to make navigation feel clearer.');
  expect((await refresh()).entryCount).toBe(1);
});

it('does not carry the previous language when a rejected replacement triggers retry', async () => {
  await refresh();
  await t.sql`UPDATE profiles SET preferred_locale='ko-KR' WHERE id=${profileId}`;
  await expect(refresh()).rejects.toThrow(/publication checks/);
  expect(await stored()).toHaveLength(0);
});

it('does not let a surviving locked entry hide the rejection of every machine entry', async () => {
  const other = 'You are exploring how predictable controls help people find their way.';
  reply = async () => ({ entries: [...proposed().entries, ...proposed(other).entries] });
  await refresh();
  await t.sql`UPDATE top_of_mind_entries SET locked_at=now() WHERE body=${fresh} AND top_of_mind_id IN
    (SELECT id FROM top_of_minds WHERE profile_id=${profileId} AND status='live')`;
  reply = async () => ({ ...proposed(), rejectedEntries: 1 });
  await expect(refresh()).rejects.toThrow(/publication checks/);
  expect((await stored()).map(row => row.body)).toEqual([fresh, other]);
});

it('does not restore stale support while preserving a fallback', async () => {
  await refresh();
  await t.sql`DELETE FROM signal_evidence WHERE signal_id=${signalIds[1]}`;
  await refresh();
  expect(await stored()).toHaveLength(0);
});

it.each(['language', 'grounding', 'synthesis'] as const)('rejects a negative %s review with valid citations and preserves the reviewed fallback', async issue => {
  await refresh();
  reply = async () => proposed(issue === 'language'
    ? 'Vous cherchez des chemins plus clairs pour enregistrer vos idées.'
    : 'You enjoy climbing mountains and camping alone.');
  review = async input => {
    const result = await approveReadingReview(input);
    result.entries[0]![issue === 'language' ? 'languageMatches' : issue === 'grounding' ? 'grounded' : 'synthesized'] = false;
    return result;
  };
  await expect(refresh()).rejects.toThrow(/publication review/);
  expect((await stored()).map(row => row.body)).toEqual([fresh]);
});

it('reviews legacy machine text even when the model says noChange', async () => {
  await refresh();
  reply = async () => ({ noChange: true, entries: [] });
  review = async input => ({ entries: (await approveReadingReview(input)).entries.map(v => ({ ...v, languageMatches: false })) });
  await refresh();
  expect(await stored()).toHaveLength(0);
});

it('does not publish unchecked text if the review is unavailable', async () => {
  await refresh();
  reply = async () => proposed('You are exploring ways to make navigation feel clearer.');
  review = async () => { throw new Error('review unavailable'); };
  await expect(refresh()).rejects.toThrow('review unavailable');
  expect((await stored()).map(row => row.body)).toEqual([fresh]);
});

it('fences changes that happen during the second model call', async () => {
  review = async input => {
    await t.sql`UPDATE profiles SET preferred_locale='ko-KR' WHERE id=${profileId}`;
    return approveReadingReview(input);
  };
  await expect(refresh()).rejects.toThrow(/Generation inputs changed/);
  expect(await stored()).toHaveLength(0);
});
