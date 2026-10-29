import { approveReadingReview } from '../../test/helpers/top-of-mind-review.js';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { refreshTopOfMindForProfile } from './top-of-mind-synthesis.js';
import { writeSignalEmbedding } from './signal-embeddings.js';
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
const refresh = (reason: 'manual' | 'signals_changed' = 'manual', now?: Date) => refreshTopOfMindForProfile({ profileId, reason }, {
  now, experimentalNoveltyReview: true,
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

it('keeps the failed novelty experiment off for ordinary refreshes', async () => {
  await refresh();
  const reviewed = vi.fn(approveReadingReview);
  await refreshTopOfMindForProfile({ profileId, reason: 'manual' }, { db: t.db as never,
    modelProvider: { synthesizeTopOfMind: synthesize, reviewTopOfMind: reviewed } as unknown as ModelProvider });
  expect(reviewed).toHaveBeenCalledTimes(1);
  expect(reviewed.mock.calls[0]![0].comparison).toBeUndefined();
});

it('keeps the current wording when a purported change is only a paraphrase', async () => {
  await refresh();
  reply = async () => ({ ...proposed('Small choices in navigation are becoming a focus of your attention.'), noChange: false });
  review = input => approveReadingReview(input, false);
  expect((await refresh()).reason).toBe('no_change');
  expect((await stored()).map(row => row.body)).toEqual([fresh]);
});

it('publishes a reviewed meaningful change even when synthesis incorrectly says noChange', async () => {
  await refresh();
  const changed = 'You are exploring how predictable exits and discoverable controls let people save with less hesitation.';
  reply = async () => ({ ...proposed(changed), noChange: true });
  review = approveReadingReview;
  expect((await refresh()).reason).toBe('regenerated');
  expect((await stored()).map(row => row.body)).toEqual([changed]);
});

it.each(['locked', 'empty'] as const)('respects the visible %s baseline when synthesis says noChange', async state => {
  const first = await refresh();
  if (state === 'locked') await t.sql`UPDATE top_of_mind_entries SET locked_at=now() WHERE top_of_mind_id=${first.topOfMindId}`;
  else await t.sql`DELETE FROM top_of_mind_entries WHERE top_of_mind_id=${first.topOfMindId}`;
  const changed = 'You are exploring how predictable exits and discoverable controls let people save with less hesitation.';
  reply = async () => ({ ...proposed(changed), noChange: true });
  expect((await refresh()).reason).toBe(state === 'locked' ? 'no_change' : 'regenerated');
  expect((await stored()).map(row => row.body)).toEqual(state === 'locked' ? [fresh] : [changed]);
});

it('refuses a missing novelty verdict without replacing the current reading', async () => {
  const first = await refresh();
  reply = async () => proposed('Small choices in navigation are becoming a focus of your attention.');
  review = async input => ({ entries: (await approveReadingReview(input)).entries.map(row => ({ ...row, coveredByIndices: undefined })) });
  await expect(refresh()).rejects.toThrow(/comparison/i);
  expect((await stored()).map(row => row.body)).toEqual([fresh]);
  expect((await t.sql`SELECT id FROM top_of_minds WHERE profile_id=${profileId}`).map(row => row.id)).toEqual([first.topOfMindId]);
});

it('does not let semantic no-change keep a prior entry that failed language review', async () => {
  await refresh();
  await t.sql`UPDATE top_of_mind_entries SET body='Vous remarquez comment les petits choix de navigation façonnent cette expérience.'
    WHERE top_of_mind_id IN (SELECT id FROM top_of_minds WHERE profile_id=${profileId} AND status='live')`;
  reply = async () => ({ ...proposed(), noChange: true });
  review = async input => ({ ...await approveReadingReview(input),
    entries: (await approveReadingReview(input)).entries.map((row, index) => ({ ...row, languageMatches: index === 0 })) });
  expect((await refresh()).reason).toBe('regenerated');
  expect((await stored()).map(row => row.body)).toEqual([fresh]);
});

it('a cosmetic manual refresh does not restart the automatic 24-hour floor', async () => {
  const start = new Date(); await refresh('manual', start);
  reply = async () => proposed('Small choices in navigation are becoming a focus of your attention.');
  review = input => approveReadingReview(input, false);
  expect((await refresh('manual', new Date(start.getTime() + 23 * 3600_000))).reason).toBe('no_change');
  review = approveReadingReview;
  expect((await refresh('signals_changed', new Date(start.getTime() + 24 * 3600_000 + 1000))).reason).toBe('regenerated');
});

it('keeps exact human locks and pins outside the machine novelty comparison', async () => {
  const locked = 'My wording stays mine.'; const pinned = 'Keep this in view.';
  reply = async () => ({ entries: [fresh, locked, pinned].map(body => ({ type: 'pattern', body, citedSignalIds: signalIds })) });
  const first = await refresh(); const touchedAt = new Date().toISOString();
  await t.sql`UPDATE top_of_mind_entries SET locked_at=${touchedAt} WHERE top_of_mind_id=${first.topOfMindId} AND body=${locked}`;
  await t.sql`UPDATE top_of_mind_entries SET pinned_at=${touchedAt} WHERE top_of_mind_id=${first.topOfMindId} AND body=${pinned}`;
  const reviewed = vi.fn((input: TopOfMindReviewInput) => approveReadingReview(input, false));
  review = reviewed; reply = async () => proposed('Small choices in navigation are becoming a focus of your attention.');
  const next = await refresh();
  expect(next.reason).toBe('no_change');
  expect(reviewed).toHaveBeenCalledTimes(1);
  expect(reviewed.mock.calls[0]![0].entries.map(row => row.body)).toEqual([
    'Small choices in navigation are becoming a focus of your attention.', fresh,
  ]);
  expect((await stored()).map(row => row.body)).toEqual([fresh, locked, pinned]);
  const kept = await t.sql`SELECT body,locked_at,pinned_at FROM top_of_mind_entries WHERE top_of_mind_id=${next.topOfMindId} AND body IN (${locked},${pinned}) ORDER BY body`;
  expect(new Date(kept.find(row => row.body === locked)!.locked_at).toISOString()).toBe(touchedAt);
  expect(new Date(kept.find(row => row.body === pinned)!.pinned_at).toISOString()).toBe(touchedAt);
});

it('can change the leading focus without changing the individual sentences', async () => {
  const second = 'You are examining whether a predictable return path makes a save feel complete.';
  reply = async () => ({ entries: [fresh, second].map(body => ({ type: 'pattern', body, citedSignalIds: signalIds })) });
  await refresh();
  reply = async () => ({ noChange: true, entries: [second, fresh].map(body => ({ type: 'pattern', body, citedSignalIds: signalIds })) });
  review = approveReadingReview;
  expect((await refresh()).reason).toBe('regenerated');
  expect((await stored()).map(row => row.body)).toEqual([second, fresh]);
});

it('publishes a reviewed change to the question without needing a body rewrite', async () => {
  await refresh(); const prompt = 'Which exit would a first-time visitor expect after saving?';
  reply = async () => ({ noChange: true, entries: [{ ...proposed().entries[0]!, prompt }] });
  const result = await refresh();
  expect(result.reason).toBe('regenerated');
  expect((await t.sql`SELECT body,prompt FROM top_of_mind_entries WHERE top_of_mind_id=${result.topOfMindId}`)[0]).toMatchObject({ body: fresh, prompt });
});

it.each(['partial', 'all'] as const)('excludes dismissed proposals before comparing novelty (%s)', async mode => {
  const dismissed = 'You are thinking about how predictable exits make saving feel complete.';
  reply = async () => ({ entries: [fresh, dismissed].map(body => ({ type: 'pattern', body, citedSignalIds: signalIds })) });
  const first = await refresh();
  await t.sql`UPDATE top_of_mind_entries SET dismissed_at=now() WHERE top_of_mind_id=${first.topOfMindId} AND body=${dismissed}`;
  const paraphrase = 'Small choices in navigation are becoming a focus of your attention.';
  reply = async () => ({ entries: (mode === 'partial' ? [paraphrase, dismissed] : [dismissed])
    .map(body => ({ type: 'pattern', body, citedSignalIds: signalIds })) });
  const reviewed = vi.fn((input: TopOfMindReviewInput) => approveReadingReview(input, false));
  review = reviewed;
  if (mode === 'partial') expect((await refresh()).reason).toBe('no_change');
  else await expect(refresh()).rejects.toThrow(/publication checks/);
  expect(reviewed.mock.calls[0]![0].entries.map(row => row.body)).toEqual(mode === 'partial' ? [paraphrase, fresh] : [fresh]);
  expect((await stored()).map(row => row.body)).toEqual([fresh]);
});

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
  const log = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    await expect(refresh()).rejects.toThrow(/publication checks: checks_single_source=1/);
    const event = log.mock.calls.find(call => call[0] === '[top-of-mind] publication rejected');
    expect(JSON.parse(event![1] as string)).toEqual({ profileId, locale: 'en-US', stage: 'checks',
      reason: 'single_source', count: 1, entryIndex: 0, fields: [], distinctOrigins: 1 });
    expect(JSON.stringify(log.mock.calls)).not.toContain(fresh);
    expect(JSON.stringify(log.mock.calls)).not.toContain(originals[0]);
  } finally { log.mockRestore(); }
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

it('rejects an entry containing an invented citation even when two other citations are valid', async () => {
  await refresh();
  reply = async () => ({ entries: [{ ...proposed('You are connecting new experiments with clearer navigation.').entries[0]!,
    citedSignalIds: [...signalIds, '00000000-0000-4000-8000-000000000099'] }] });
  await expect(refresh()).rejects.toThrow(/publication checks/);
  expect((await stored()).map(row => row.body)).toEqual([fresh]);
});

it('stores repeated machine wording once, including case, spacing and final-punctuation variants', async () => {
  const echo = fresh.toUpperCase().replaceAll(' ', '  ').replace(/\.$/, '!');
  reply = async () => ({ entries: [...proposed().entries, ...proposed(echo).entries] });
  expect((await refresh()).entryCount).toBe(1);
  expect((await stored()).map(row => row.body)).toEqual([fresh]);
});

it('cleans up repeated machine wording on noChange while retaining exact human choices', async () => {
  await refresh();
  const [artifact] = await t.sql`SELECT id FROM top_of_minds WHERE profile_id=${profileId} AND status='live'`;
  const [duplicate] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,sort_order)
    VALUES (${artifact.id},'pattern',${fresh},1) RETURNING id`;
  for (const id of signalIds) await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES (${duplicate.id},${id})`;
  reply = async () => ({ noChange: true, entries: [] });
  expect((await refresh()).entryCount).toBe(1); expect((await stored()).map(row => row.body)).toEqual([fresh]);
  const [human] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,sort_order,locked_at)
    SELECT id,'pattern',${fresh.toUpperCase()},1,now() FROM top_of_minds WHERE profile_id=${profileId} AND status='live' RETURNING id`;
  for (const id of signalIds) await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES (${human.id},${id})`;
  await refresh();
  expect((await stored()).map(row => row.body)).toEqual([fresh.toUpperCase()]);
  const [secondHuman] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id,type,body,sort_order,locked_at)
    SELECT id,'pattern',${fresh},1,now() FROM top_of_minds WHERE profile_id=${profileId} AND status='live' RETURNING id`;
  for (const id of signalIds) await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id) VALUES (${secondHuman.id},${id})`;
  expect((await refresh()).entryCount).toBe(2);
  expect((await stored()).map(row => row.body)).toEqual([fresh.toUpperCase(), fresh]);
});

it('does not compare caches from different embedding models in the same coordinate space', async () => {
  for (const [index, id] of signalIds.entries()) {
    const [row] = await t.sql`SELECT statement FROM signals WHERE id=${id}`;
    await t.db.transaction(tx => writeSignalEmbedding(tx as never, { profileId, signalId: id,
      statement: row.statement as string, embedding: [1, 0], model: `different-model-${index}` }));
  }
  expect((await refresh()).entryCount).toBe(1);
  expect(synthesize.mock.calls[0]![0].signals.map(row => row.id).sort()).toEqual([...signalIds].sort());
});
