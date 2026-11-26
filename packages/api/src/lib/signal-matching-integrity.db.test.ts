/** WHAT THIS MOCKS, AND WHY (gate G6): `judgeSignalMatch` and
 * `extractSignalCandidates` supply controlled semantic verdicts;
 * `embeddingClient` supplies deliberately identical vectors, reproducing
 * negation/temporal-scope collisions. Real matching, locks, evidence,
 * confidence and queue writes run on disposable local Postgres. */
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { approveReadingReview } from '../../test/helpers/top-of-mind-review.js';
import { getLiveTopOfMind, updateLiveEntry } from '../routes/top-of-mind.js';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { acquireSignalDerivationLock, applyCandidates } from './signal-match-or-mint.js';
import { writeSignalEmbedding } from './signal-embeddings.js';
import {hashEmbeddingInput} from './inspiration-embeddings.js';
import { deriveSignalsForInspiration } from './signal-derivation.js';
import { refreshTopOfMindForProfile } from './top-of-mind-synthesis.js';
import type { ModelProvider } from './model-provider.js';

let t: TestDatabase, sequence = 0;
const model = 'signal-integrity-fixture', vector = [1, 0, 0, 0];
const original = 'I prefer quiet mornings for focused work.';
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN', '0'); });
afterAll(async () => { vi.unstubAllEnvs(); await t?.cleanup(); });
async function fixture(cachedStatement = original, dismissed = false, personalDraft = false) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`signal-integrity-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},${personalDraft ? 'human' : 'agent'},${personalDraft ? 'Reader' : 'First agent'}) RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},${personalDraft ? 'I did the hard calculations before the house woke up.' : 'I now prefer busy mornings, although I used to prefer quiet mornings.'}) RETURNING id`;
  const [signal] = await t.sql`INSERT INTO signals(profile_id,statement,locked_at,status,dismissed_at)
    VALUES (${profile.id},${original},CASE WHEN ${personalDraft} THEN NULL ELSE now() END,${dismissed ? 'retired' : 'emerging'},${dismissed ? new Date().toISOString() : null}) RETURNING id`;
  await t.db.transaction(tx => writeSignalEmbedding(tx as never, { profileId: profile.id as string, signalId: signal.id as string,
    statement: original, embedding: vector, model }));
  // Simulate a stale/corrupt persisted row directly. The guarded writer now
  // refuses to insert a vector for words the source no longer carries.
  if(cachedStatement!==original)await t.sql`UPDATE signal_embeddings SET input_hash=${hashEmbeddingInput(cachedStatement)} WHERE signal_id=${signal.id} AND model=${model}`;
  return { accountId: account.id as string, profileId: profile.id as string, inspirationId: source.id as string, signalId: signal.id as string };
}
function run(f: Awaited<ReturnType<typeof fixture>>, statements: string | string[], judge: ModelProvider['judgeSignalMatch']) {
  return t.db.transaction(async tx => {
    await acquireSignalDerivationLock(tx as never, f.profileId);
    return applyCandidates(tx as never, { profileId: f.profileId, evidenceOwnerProfileId: f.profileId,
      inspirationId: f.inspirationId, embeddingModel: model, preferredLocale: 'en-US', now: new Date(),
      provider: { judgeSignalMatch: judge } as ModelProvider, beforeWrites: async () => {},
      candidates: (typeof statements === 'string' ? [statements] : statements)
        .map(statement => ({ statement, reason: null, quote: null, quoteSource: null, embedding: vector, relatedEvidence: [] })),
    });
  });
}

it.each([
  ['opposed', 'I prefer busy mornings for focused work.'],
  ['independent', 'This week I want to try quiet mornings for focused work.'],
] as const)('checks meaning above the cosine bar and keeps an %s claim separate', async (relation, statement) => {
  const f = await fixture(), judge = vi.fn(async () => ({ relation }));
  const outcome = await run(f, statement, judge);
  expect(judge).toHaveBeenCalledOnce(); expect(outcome.matchedSignalIds).toEqual([]); expect(outcome.mintedSignalIds).toHaveLength(1);
  expect((await t.sql`SELECT signal_id FROM signal_evidence WHERE inspiration_id=${f.inspirationId}`)[0]?.signal_id).toBe(outcome.mintedSignalIds[0]);
  expect((await t.sql`SELECT statement FROM signals WHERE id=${f.signalId}`)[0]?.statement).toBe(original);
  expect(await t.sql`SELECT id FROM signal_contradictions`).toHaveLength(relation === 'opposed' ? 1 : 0);
});
it('allows a confirmed rephrasing to add support without rewriting locked wording', async () => {
  const f = await fixture(), judge = vi.fn(async () => ({ relation: 'same' as const }));
  const outcome = await run(f, 'Quiet mornings help me focus.', judge);
  expect(judge).toHaveBeenCalledOnce(); expect(outcome.matchedSignalIds).toEqual([f.signalId]); expect(outcome.mintedSignalIds).toEqual([]);
  expect((await t.sql`SELECT statement FROM signals WHERE id=${f.signalId}`)[0]?.statement).toBe(original);
});
it('retries failed semantic checks without changing evidence or inventing another signal', async () => {
  const f = await fixture();
  await expect(run(f, 'Quiet mornings help me focus.', async () => { throw new Error('Provider unavailable'); })).rejects.toThrow('Provider unavailable');
  expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(0); expect(await t.sql`SELECT id FROM signals`).toHaveLength(1);
});
it('replays an identical statement without extra judgments, witnesses or confidence inflation', async () => {
  const f = await fixture(), judge = vi.fn(async () => ({ relation: 'same' as const }));
  await run(f, original, judge); const before = await t.sql`SELECT confidence FROM signals WHERE id=${f.signalId}`;
  await run(f, original, judge);
  expect(judge).not.toHaveBeenCalled(); expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(1);
  expect(await t.sql`SELECT confidence FROM signals WHERE id=${f.signalId}`).toEqual(before);
});
it.each([false, true])('does not match or suppress through a vector for different wording (dismissed=%s)', async dismissed => {
  const f = await fixture('An unrelated earlier statement', dismissed), judge = vi.fn(async () => ({ relation: 'same' as const }));
  const outcome = await run(f, 'A separate current pattern.', judge);
  expect(outcome.matchedSignalIds).toEqual([]); expect(outcome.mintedSignalIds).toHaveLength(1);
  expect(await t.sql`SELECT id FROM suppressions`).toHaveLength(0); expect(judge).not.toHaveBeenCalled();
});
it('keeps matching inside one agent even when a sibling has an identical vector', async () => {
  const f = await fixture();
  const [sibling] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${f.accountId},'agent','Sibling agent') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${sibling.id},${original}) RETURNING id`;
  const outcome = await run({ ...f, profileId: sibling.id as string, inspirationId: source.id as string }, original, async () => ({ relation: 'same' }));
  expect(outcome.mintedSignalIds).toHaveLength(1); expect(outcome.matchedSignalIds).toEqual([]);
  expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id=${f.signalId}`).toHaveLength(0);
});
it('does not discard a second meaning from one extraction just because its vector is identical', async () => {
  const f = await fixture(); await t.sql`DELETE FROM signals WHERE id=${f.signalId}`;
  const outcome = await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: 'created' }, {
    db: t.db as never, embeddingClient: { model, embed: async () => [1, ...new Array<number>(767).fill(0)] },
    modelProvider: { extractSignalCandidates: async () => ({ statements: [
      { statement: 'I used to prefer quiet mornings.', quote: 'I used to prefer quiet mornings' },
      { statement: 'I now prefer busy mornings.', quote: 'I now prefer busy mornings' },
    ] }), judgeSignalMatch: async () => ({ relation: 'independent' }) } as unknown as ModelProvider,
  });
  expect(outcome.mintedSignalIds).toHaveLength(2); expect(await t.sql`SELECT id FROM signal_contradictions`).toHaveLength(0);
});

it.each([
  ['opposed', 'I do not prefer quiet mornings for focused work.'],
  ['independent', 'This week only I want to try quiet mornings for focused work.'],
  ['independent', 'I used to prefer quiet mornings, but I now prefer busy mornings.'],
  ['independent', '이번 주에만 조용한 아침에 일해 보려고 해요. 아직 맞는지는 모르겠어요.'],
] as const)('does not suppress a dismissed signal’s %s neighbor: %s', async (relation, statement) => {
  const f = await fixture(original, true), judge = vi.fn(async () => ({ relation }));
  const outcome = await run(f, statement, judge);
  expect(judge).toHaveBeenCalledOnce();
  expect(outcome.mintedSignalIds).toHaveLength(1); expect(outcome.matchedSignalIds).toEqual([]);
  expect(await t.sql`SELECT id FROM suppressions`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM signal_contradictions`).toHaveLength(0);
  const [anchor] = await t.sql`SELECT statement,locked_at,dismissed_at FROM signals WHERE id=${f.signalId}`;
  expect(anchor.statement).toBe(original); expect(anchor.locked_at).not.toBeNull(); expect(anchor.dismissed_at).not.toBeNull();
  expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id=${f.signalId}`).toHaveLength(0);
});
it('suppresses confirmed rephrasings without adding evidence to the dismissed signal', async () => {
  const f = await fixture(original, true), judge = vi.fn(async () => ({ relation: 'same' as const }));
  const outcome = await run(f, 'Quiet mornings help me focus.', judge);
  expect(judge).toHaveBeenCalledOnce(); expect(outcome.mintedSignalIds).toEqual([]); expect(outcome.matchedSignalIds).toEqual([]);
  expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(0);
  expect(await t.sql`SELECT anchor_signal_id FROM suppressions`).toMatchObject([{ anchor_signal_id: f.signalId }]);
});
it('suppresses identical dismissed wording without a model call', async () => {
  const f = await fixture(original, true), judge = vi.fn();
  const outcome = await run(f, original, judge);
  expect(judge).not.toHaveBeenCalled(); expect(outcome.mintedSignalIds).toEqual([]);
  expect(await t.sql`SELECT id FROM suppressions`).toHaveLength(1);
});
it('retries an unavailable dismissal judgment without minting, attaching or recording a refusal', async () => {
  const f = await fixture(original, true);
  await expect(run(f, 'Quiet mornings help me focus.', async () => { throw new Error('Provider unavailable'); })).rejects.toThrow('Provider unavailable');
  expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM suppressions`).toHaveLength(0); expect(await t.sql`SELECT id FROM signals`).toHaveLength(1);
});
it('does not apply a dismissal verdict after the anchor was restored during the model call', async () => {
  const f = await fixture(original, true);
  // The helper deliberately has one connection; a concurrent owner write
  // needs another, otherwise it queues behind the transaction under test.
  const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, connection: { search_path: t.schemaName } });
  try {
    await expect(run(f, 'Quiet mornings help me focus.', async () => {
      await other`UPDATE signals SET dismissed_at=NULL,status='emerging' WHERE id=${f.signalId}`;
      return { relation: 'same' };
    })).rejects.toThrow('Signal inputs changed');
  } finally { await other.end(); }
  expect(await t.sql`SELECT id FROM suppressions`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(0);
});
it('keeps a sibling agent’s dismissal out of both suppression and the model prompt', async () => {
  const f = await fixture(original, true), judge = vi.fn();
  const [sibling] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${f.accountId},'agent','Sibling agent') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${sibling.id},${original}) RETURNING id`;
  const outcome = await run({ ...f, profileId: sibling.id as string, inspirationId: source.id as string }, original, judge);
  expect(judge).not.toHaveBeenCalled(); expect(outcome.mintedSignalIds).toHaveLength(1);
  expect(await t.sql`SELECT id FROM suppressions`).toHaveLength(0);
});
it('prioritizes exact dismissed wording over a closer different anchor', async () => {
  const f = await fixture(original, true), judge = vi.fn();
  await t.db.transaction(tx => writeSignalEmbedding(tx as never, { profileId: f.profileId, signalId: f.signalId,
    statement: original, embedding: [0.9, Math.sqrt(1 - 0.81), 0, 0], model }));
  const [different] = await t.sql`INSERT INTO signals(profile_id,statement,status,dismissed_at)
    VALUES (${f.profileId},'I do not prefer quiet mornings.','retired',now()) RETURNING id`;
  await t.db.transaction(tx => writeSignalEmbedding(tx as never, { profileId: f.profileId, signalId: different.id as string,
    statement: 'I do not prefer quiet mornings.', embedding: vector, model }));
  await run(f, original, judge);
  expect(judge).not.toHaveBeenCalled();
  expect(await t.sql`SELECT anchor_signal_id FROM suppressions`).toMatchObject([{ anchor_signal_id: f.signalId }]);
});
it('continues normal matching after a distinct dismissed neighbor is ruled out', async () => {
  const f = await fixture(original, true);
  const activeWords = 'I prefer busy mornings for focused work.';
  const [active] = await t.sql`INSERT INTO signals(profile_id,statement,locked_at)
    VALUES (${f.profileId},${activeWords},now()) RETURNING id`;
  await t.db.transaction(tx => writeSignalEmbedding(tx as never, { profileId: f.profileId, signalId: active.id as string,
    statement: activeWords, embedding: vector, model }));
  const judge = vi.fn(async () => ({ relation: 'opposed' as const }));
  const outcome = await run(f, activeWords, judge);
  expect(judge).toHaveBeenCalledOnce(); expect(outcome.matchedSignalIds).toEqual([active.id]);
  expect(outcome.mintedSignalIds).toEqual([]); expect(await t.sql`SELECT id FROM suppressions`).toHaveLength(0);
  expect(await t.sql`SELECT id FROM signal_contradictions`).toHaveLength(0);
});

const quietMornings = 'Quiet mornings make it easier to concentrate.';
const beforeNoise = 'Do the work that needs thought before the morning gets noisy.';
const same = async (): Promise<{ relation: 'same' }> => ({ relation: 'same' });

async function supportedDraft() {
  const f = await fixture(original, false, true);
  for (const text of ['Before the school run, I could think through the budget.',
    'At sunrise I wrote a complicated reply while the street stayed still.']) {
    const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${f.profileId},${text}) RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id,owner_profile_id,signal_id,inspiration_id)
      VALUES (${f.profileId},${f.profileId},${f.signalId},${source.id})`;
  }
  return f;
}

async function publishDraftReading(f: Awaited<ReturnType<typeof supportedDraft>>, db = t.db) {
  const reading = await refreshTopOfMindForProfile({ profileId: f.profileId, reason: 'manual' }, {
    db: db as never,
    modelProvider: {
      synthesizeTopOfMind: async () => ({ entries: [{ type: 'pattern', body: 'The first part of the day gives you room to think.', citedSignalIds: [f.signalId] }] }),
      reviewTopOfMind: approveReadingReview,
    } as unknown as ModelProvider,
  });
  expect(reading).toMatchObject({ status: 'versioned', entryCount: 1 });
}

it('confirms and promotes a cited emerging draft while keeping its published wording and reading', async () => {
  const f = await supportedDraft();
  await publishDraftReading(f);
  const before = await getLiveTopOfMind(t.db as never, f);
  const embedding = await t.sql`SELECT input_hash,embedding FROM signal_embeddings WHERE signal_id=${f.signalId}`;
  const judge = vi.fn<ModelProvider['judgeSignalMatch']>(same);

  const result = await run(f, [quietMornings, beforeNoise], judge);

  expect(judge.mock.calls.map(([input]) => input.existingStatement)).toEqual([original, original]);
  expect(result).toMatchObject({ matchedSignalIds: [f.signalId, f.signalId], mintedSignalIds: [], promotedSignalIds: [f.signalId] });
  expect(await t.sql`SELECT statement,statement_revision::text,status,locked_at FROM signals WHERE id=${f.signalId}`)
    .toEqual([{ statement: original, statement_revision: '1', status: 'active', locked_at: null }]);
  expect(await t.sql`SELECT input_hash,embedding FROM signal_embeddings WHERE signal_id=${f.signalId}`).toEqual(embedding);
  expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id=${f.signalId}`).toHaveLength(3);
  expect(await getLiveTopOfMind(t.db as never, f)).toMatchObject({
    id: before!.id, version: before!.version, supportChanged: false,
    entries: [{ id: before!.entries[0]!.id, body: before!.entries[0]!.body, citedSignals: [{ id: f.signalId, statement: original }] }],
  });
});

it.each(['absent', 'dismissed', 'stale kept citation'] as const)('still restates an emerging signal with %s reading support', async reading => {
  const f = await supportedDraft();
  if (reading !== 'absent') {
    await publishDraftReading(f);
    const live = await getLiveTopOfMind(t.db as never, f);
    const entryId = live!.entries[0]!.id;
    const patch = reading === 'dismissed' ? { dismissedAt: new Date() } : { pinnedAt: new Date() };
    await updateLiveEntry(t.db as never, { profileId: f.profileId, entryId, patch });
    if (reading === 'stale kept citation') {
      await t.sql`UPDATE top_of_mind_entry_signals SET entry_body_revision=2 WHERE entry_id=${entryId}`;
      expect((await getLiveTopOfMind(t.db as never, f))?.entries).toMatchObject([{ pinned: true, citedSignals: [] }]);
    }
  }
  const result = await run(f, quietMornings, same);
  expect(result.matchedSignalIds).toEqual([f.signalId]);
  expect(await t.sql`SELECT statement,statement_revision::text FROM signals WHERE id=${f.signalId}`)
    .toEqual([{ statement: quietMornings, statement_revision: '2' }]);
});

it('preserves only the current citation of a kept entry with a stale sibling link', async () => {
  const f = await supportedDraft();
  await publishDraftReading(f);
  const live = await getLiveTopOfMind(t.db as never, f);
  const entryId = live!.entries[0]!.id;
  await updateLiveEntry(t.db as never, { profileId: f.profileId, entryId, patch: { pinnedAt: new Date() } });
  const [peer] = await t.sql`INSERT INTO signals(profile_id,statement) VALUES (${f.profileId},'Take a break before lunch.') RETURNING id`;
  await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id,signal_id,statement_revision,entry_body_revision)
    VALUES (${entryId},${peer.id},1,1)`;
  await t.sql`UPDATE signals SET statement='Take a break after lunch.' WHERE id=${peer.id}`;
  expect((await getLiveTopOfMind(t.db as never, f))?.entries).toMatchObject([{
    id: entryId, pinned: true, supportChanged: true, citedSignals: [{ id: f.signalId }],
  }]);

  const result = await run(f, quietMornings, same);
  expect(result).toMatchObject({ matchedSignalIds: [f.signalId], promotedSignalIds: [f.signalId] });
  expect((await getLiveTopOfMind(t.db as never, f))?.entries).toMatchObject([{
    id: entryId, pinned: true, supportChanged: true, citedSignals: [{ id: f.signalId, statement: original }],
  }]);
});

it('reuses one exact judgement when a reading commits during the judge call', async () => {
  const f = await supportedDraft();
  const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, connection: { search_path: t.schemaName } });
  try {
    const judge = vi.fn<ModelProvider['judgeSignalMatch']>(async () => {
      await publishDraftReading(f, drizzle(other) as typeof t.db);
      return { relation: 'same' };
    });
    const result = await run(f, quietMornings, judge);
    expect(judge).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ matchedSignalIds: [f.signalId], promotedSignalIds: [f.signalId] });
    expect(await t.sql`SELECT statement,statement_revision::text FROM signals WHERE id=${f.signalId}`)
      .toEqual([{ statement: original, statement_revision: '1' }]);
    expect((await getLiveTopOfMind(t.db as never, f))?.entries).toHaveLength(1);
  } finally { await other.end(); }
});

it('replans a changed later candidate with the same source and already embedded batch', async () => {
  const f = await supportedDraft();
  const fullVector = [1, ...new Array<number>(767).fill(0)];
  await t.db.transaction(tx => writeSignalEmbedding(tx as never, {
    profileId: f.profileId, signalId: f.signalId, statement: original, embedding: fullVector, model,
  }));
  const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, connection: { search_path: t.schemaName } });
  try {
    const judge = vi.fn<ModelProvider['judgeSignalMatch']>(same).mockImplementationOnce(async () => {
      await publishDraftReading(f, drizzle(other) as typeof t.db);
      return { relation: 'same' };
    });
    const extract = vi.fn<ModelProvider['extractSignalCandidates']>(async () => ({
      category: null, statements: [{ statement: quietMornings }, { statement: beforeNoise }],
    }));
    const embed = vi.fn(async (_input: string) => fullVector);
    const result = await deriveSignalsForInspiration({ inspirationId: f.inspirationId, reason: 'created' }, {
      db: t.db as never,
      modelProvider: { judgeSignalMatch: judge, extractSignalCandidates: extract } as unknown as ModelProvider,
      embeddingClient: { model, dimensions: fullVector.length, embed },
    });

    expect(extract).toHaveBeenCalledOnce();
    expect(embed).toHaveBeenCalledTimes(3);
    expect(judge.mock.calls.map(([input]) => input.existingStatement))
      .toEqual([original, quietMornings, original]);
    expect(result).toMatchObject({ matchedSignalIds: [f.signalId, f.signalId], mintedSignalIds: [], promotedSignalIds: [f.signalId] });
    expect(await t.sql`SELECT statement,statement_revision::text FROM signals WHERE id=${f.signalId}`)
      .toEqual([{ statement: original, statement_revision: '1' }]);
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id=${f.signalId}`).toHaveLength(3);
    expect((await getLiveTopOfMind(t.db as never, f))?.entries).toHaveLength(1);
  } finally { await other.end(); }
});
