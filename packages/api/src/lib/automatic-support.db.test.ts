import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { deriveSignalsForInspiration } from "./signal-derivation.js";
import type { ModelProvider, SignalSupportAssessmentInput } from "./model-provider.js";

let t: TestDatabase;
let sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); });
afterAll(async () => { await t?.cleanup(); });

async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`automatic-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'A morning walk') RETURNING id`;
  const [answer] = await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer)
    VALUES (${profile.id}, ${source.id}, 'Why?', 'Quiet helps me choose') RETURNING id`;
  const extractSignalCandidates = vi.fn(async () => ({ statements: [{ statement: 'I seek quiet before deciding', quote: 'Quiet helps me choose' }] }));
  const assessSignalSupport = vi.fn(async (input: SignalSupportAssessmentInput) => ({ assessments: input.claims.map((claim) => ({
    signalId: claim.signalId, verdict: 'supported' as 'supported' | 'unsupported' | 'unresolved', sourceIds: [input.sources[0]!.id],
  })) }));
  const deps = { db: t.db as never, modelProvider: { extractSignalCandidates, assessSignalSupport,
    judgeSignalMatch: async () => ({ relation: 'same' }) } as unknown as ModelProvider,
    embeddingClient: { model: 'automatic-support-test', embed: async () => [1, ...new Array<number>(767).fill(0)] } };
  const run = () => deriveSignalsForInspiration({ inspirationId: source.id as string, reason: 'edited' }, deps);
  const first = await run();
  extractSignalCandidates.mockResolvedValue({ statements: [] });
  return { sourceId: source.id as string, profileId: profile.id as string, answerId: answer.id as string,
    signalId: first.mintedSignalIds[0]!, assessSignalSupport, extractSignalCandidates, run };
}

describe('automatic current-support reconciliation', () => {
  it('does not request another reading when discovery is empty and existing support still holds', async () => {
    const f = await fixture();
    await t.sql`DELETE FROM background_jobs`;
    await f.run();
    await f.run();
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'refresh_top_of_mind'`).toHaveLength(0);
  });

  it('rolls discovery changes back if their reading request cannot be persisted', async () => {
    const f = await fixture();
    await f.run(); // a current support check, so this isolates the discovery transaction
    await t.sql`DELETE FROM background_jobs`;
    const before = await t.sql`SELECT s.statement, e.quote FROM signals s JOIN signal_evidence e ON e.signal_id = s.id WHERE s.id = ${f.signalId}`;
    f.extractSignalCandidates.mockResolvedValue({ statements: [{ statement: 'A more precise discovery', quote: 'A morning walk' }] });
    await t.sql`CREATE FUNCTION reject_reading_request() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'refresh queue unavailable'; END; $$ LANGUAGE plpgsql`;
    await t.sql`CREATE TRIGGER reject_reading_request BEFORE INSERT ON background_jobs FOR EACH ROW EXECUTE FUNCTION reject_reading_request()`;
    try {
      await expect(f.run()).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'refresh queue unavailable' }) });
      expect(await t.sql`SELECT s.statement, e.quote FROM signals s JOIN signal_evidence e ON e.signal_id = s.id WHERE s.id = ${f.signalId}`).toEqual(before);
    } finally { await t.sql`DROP TRIGGER reject_reading_request ON background_jobs`; await t.sql`DROP FUNCTION reject_reading_request()`; }
  });
  it('reuses a completed check only while both material and wording are unchanged', async () => {
    const f = await fixture();
    expect(f.assessSignalSupport).not.toHaveBeenCalled(); // no pre-existing claims on first capture
    await f.run();
    expect(f.assessSignalSupport).toHaveBeenCalledTimes(1);
    await f.run();
    expect(f.assessSignalSupport).toHaveBeenCalledTimes(1);
    await t.sql`UPDATE signal_support_reviews SET policy = 'older-policy'`;
    await f.run();
    expect(f.assessSignalSupport).toHaveBeenCalledTimes(2);
    await t.sql`UPDATE signals SET statement = 'My more precise wording', locked_at = now() WHERE id = ${f.signalId}`;
    await f.run();
    expect(f.assessSignalSupport).toHaveBeenCalledTimes(3);
    await t.sql`UPDATE reflections SET answer = 'A new explanation' WHERE id = ${f.answerId}`;
    await f.run();
    expect(f.assessSignalSupport).toHaveBeenCalledTimes(4);
  });

  it('provider failure preserves links and requests a retry rather than claiming a completed check', async () => {
    const f = await fixture();
    f.assessSignalSupport.mockRejectedValue(new Error('PRIVATE_PROVIDER_SENTINEL'));
    const result = await f.run();
    expect(result.supportReview).toMatchObject({ checked: 1, withdrawn: 0, unresolved: 1, retryable: true });
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_SENTINEL');
    await f.run();
    expect(f.assessSignalSupport).toHaveBeenCalledTimes(2); // unavailable checks are never cached as final
  });

  it('an omitted support verdict cannot be treated as negative evidence', async () => {
    const f = await fixture();
    f.assessSignalSupport.mockResolvedValue({ assessments: [] });
    const result = await f.run();
    expect(result.supportReview).toMatchObject({ withdrawn: 0, unresolved: 1, retryable: true });
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(1);
  });

  it('an uncertain but valid verdict is distinct from provider failure', async () => {
    const f = await fixture();
    f.assessSignalSupport.mockImplementation(async (input) => ({ assessments: input.claims.map((claim) => ({
      signalId: claim.signalId, verdict: 'unresolved', sourceIds: [],
    })) }));
    const result = await f.run();
    expect(result.supportReview).toMatchObject({ withdrawn: 0, unresolved: 1, retryable: false });
    await f.run();
    expect(f.assessSignalSupport).toHaveBeenCalledTimes(1);
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(1);
  });

  it('a source changed during assessment cannot receive that decision', async () => {
    const f = await fixture();
    f.assessSignalSupport.mockImplementation(async (input) => {
      await t.sql`UPDATE inspirations SET text = 'New material arrived' WHERE id = ${f.sourceId}`;
      return { assessments: input.claims.map((claim) => ({ signalId: claim.signalId, verdict: 'unsupported', sourceIds: [] })) };
    });
    await expect(f.run()).rejects.toThrow(/material changed/);
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(1);
    expect(await t.sql`SELECT review_id FROM signal_support_reviews`).toHaveLength(0);
  });
  it('checks existing support even when discovery proposes nothing', async () => {
    const f = await fixture();
    await t.sql`UPDATE signals SET locked_at = now() WHERE id = ${f.signalId}`;
    await t.sql`DELETE FROM reflections WHERE id = ${f.answerId}`;
    f.assessSignalSupport.mockImplementation(async (input) => ({ assessments: input.claims.map((claim) => ({
      signalId: claim.signalId, verdict: 'unsupported', sourceIds: [],
    })) }));
    await f.run();
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(0);
    const [signal] = await t.sql`SELECT statement, locked_at, unsupported_at FROM signals WHERE id = ${f.signalId}`;
    expect(signal.statement).toBe('I seek quiet before deciding');
    expect(signal.locked_at).not.toBeNull();
    expect(signal.unsupported_at).not.toBeNull();
    expect(await t.sql`SELECT id FROM background_jobs WHERE type = 'refresh_top_of_mind'`).toHaveLength(1);
  });

  it('recovers withdrawn support after new material supports the same claim', async () => {
    const f = await fixture();
    await t.sql`DELETE FROM reflections WHERE id = ${f.answerId}`;
    f.assessSignalSupport.mockImplementation(async (input) => ({ assessments: input.claims.map((claim) => ({
      signalId: claim.signalId, verdict: 'unsupported', sourceIds: [],
    })) }));
    await f.run();
    expect((await t.sql`SELECT status FROM signals WHERE id = ${f.signalId}`)[0].status).toBe('retired');
    await t.sql`UPDATE inspirations SET text = 'I take a quiet walk before deciding' WHERE id = ${f.sourceId}`;
    f.assessSignalSupport.mockImplementation(async (input) => ({ assessments: input.claims.map((claim) => ({
      signalId: claim.signalId, verdict: 'supported', sourceIds: [input.sources[0]!.id],
    })) }));
    await f.run();
    expect((await t.sql`SELECT status FROM signals WHERE id = ${f.signalId}`)[0].status).toBe('emerging');
    expect(await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${f.signalId}`).toHaveLength(1);
  });
});
