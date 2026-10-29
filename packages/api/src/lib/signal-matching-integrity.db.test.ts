/** WHAT THIS MOCKS, AND WHY (gate G6): `judgeSignalMatch` and
 * `extractSignalCandidates` supply controlled semantic verdicts;
 * `embeddingClient` supplies deliberately identical vectors, reproducing
 * negation/temporal-scope collisions. Real matching, locks, evidence,
 * confidence and queue writes run on disposable local Postgres. */
import { afterAll, beforeEach, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { acquireSignalDerivationLock, applyCandidates } from './signal-match-or-mint.js';
import { writeSignalEmbedding } from './signal-embeddings.js';
import { deriveSignalsForInspiration } from './signal-derivation.js';
import type { ModelProvider } from './model-provider.js';

let t: TestDatabase, sequence = 0;
const model = 'signal-integrity-fixture', vector = [1, 0, 0, 0];
const original = 'I prefer quiet mornings for focused work.';
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); vi.stubEnv('WAKA_BACKGROUND_JOB_AUTODRAIN', '0'); });
afterAll(async () => { vi.unstubAllEnvs(); await t?.cleanup(); });
async function fixture(cachedStatement = original, dismissed = false) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`signal-integrity-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id,type,name) VALUES (${account.id},'agent','First agent') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id,text) VALUES (${profile.id},'I now prefer busy mornings, although I used to prefer quiet mornings.') RETURNING id`;
  const [signal] = await t.sql`INSERT INTO signals(profile_id,statement,locked_at,status,dismissed_at)
    VALUES (${profile.id},${original},now(),${dismissed ? 'retired' : 'emerging'},${dismissed ? new Date().toISOString() : null}) RETURNING id`;
  await t.db.transaction(tx => writeSignalEmbedding(tx as never, { profileId: profile.id as string, signalId: signal.id as string,
    statement: cachedStatement, embedding: vector, model }));
  return { accountId: account.id as string, profileId: profile.id as string, inspirationId: source.id as string, signalId: signal.id as string };
}
function run(f: Awaited<ReturnType<typeof fixture>>, statement: string, judge: ModelProvider['judgeSignalMatch']) {
  return t.db.transaction(async tx => {
    await acquireSignalDerivationLock(tx as never, f.profileId);
    return applyCandidates(tx as never, { profileId: f.profileId, evidenceOwnerProfileId: f.profileId,
      inspirationId: f.inspirationId, embeddingModel: model, preferredLocale: 'en-US', now: new Date(),
      provider: { judgeSignalMatch: judge } as ModelProvider, beforeWrites: async () => {},
      candidates: [{ statement, reason: null, quote: null, quoteSource: null, embedding: vector, relatedEvidence: [] }],
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
