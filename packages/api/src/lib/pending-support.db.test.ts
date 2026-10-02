/** Pending checks through real rows, serving projections and reviewed writes.
 * Providers return deterministic verdicts; no model or hosted database runs. */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDatabase, type TestDatabase } from '../../test/helpers/index.js';
import { getLiveTopOfMind, getTopOfMindVersion, updateLiveEntry } from '../routes/top-of-mind.js';
import { loadPrincipleViews } from '../routes/principles.js';
import { loadInspirationMaterial } from './inspiration-material.js';
import { reviewSignalSupport } from './signal-support-review.js';
import { applySignalSupportReview } from './signal-support-apply.js';
import { setDefaultModelProviderForTests, type ModelProvider, type SignalSupportAssessmentInput, type TopOfMindSynthesisInput } from './model-provider.js';
import { enqueueTopOfMindRefresh, postgresBackgroundJobStore, processBackgroundJob } from './queue.js';
import { BackgroundJobHeldError } from './background-job-hold.js';
import { loadPrincipleStatus, requestPrincipleRefresh } from './principle-status.js';
import { deriveSignalsForInspiration } from './signal-derivation.js';
import { writeSignalEmbedding } from './signal-embeddings.js';
import { createGroupForProfile, joinGroupByCode } from '../routes/groups-membership.js';
import { loadGroupTopOfMind } from '../routes/groups-top-of-mind.js';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('./db.js', () => ({ getDb: () => state.db }));

let t: TestDatabase, sequence = 0;
beforeEach(async () => { setDefaultModelProviderForTests(null); t ??= await createTestDatabase(); await t.truncateAll(); state.db = t.db; });
afterAll(async () => { setDefaultModelProviderForTests(null); await t?.cleanup(); });
const supported = { assessSignalSupport: async (input: SignalSupportAssessmentInput) => ({
  assessments: input.claims.map((claim) => ({ signalId: claim.signalId, verdict: 'supported' as const, sourceIds: [input.sources[0]!.id] })),
}) };

async function fixture(locked = false) {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`pending-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'Quiet helps me decide') RETURNING id`;
  const [signal] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${profile.id}, 'I seek quiet before deciding') RETURNING id`;
  const material = await loadInspirationMaterial(t.db as never, profile.id as string, source.id as string, 'personal');
  await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id, material)
    VALUES (${profile.id}, ${profile.id}, ${signal.id}, ${source.id}, ${JSON.stringify(material!.identity)}::jsonb)`;
  const [artifact] = await t.sql`INSERT INTO top_of_minds(profile_id, version) VALUES (${profile.id}, 1) RETURNING id`;
  const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id, type, body, belief, prompt, locked_at)
    VALUES (${artifact.id}, 'hypothesis', 'A little quiet may help you choose', 'An old explanation', 'An old prompt',
      ${locked ? new Date().toISOString() : null}) RETURNING id`;
  await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id, signal_id) VALUES (${entry.id}, ${signal.id})`;
  const profileId = profile.id as string, sourceId = source.id as string, signalId = signal.id as string;
  const read = () => getLiveTopOfMind(t.db as never, { profileId });
  const review = () => reviewSignalSupport(t.db as never, { ownerProfileId: profileId, inspirationId: sourceId, provider: supported, maxCalls: 1 });
  expect((await read())?.entries).toHaveLength(1);
  return { profileId, sourceId, signalId, entryId: entry.id as string, artifactId: artifact.id as string, read, review };
}

describe('pending support is not current proof', () => {
  it('withholds the generated conclusion immediately after a source changes, before any worker runs', async () => {
    const f = await fixture();
    await t.sql`UPDATE inspirations SET text = 'I now prefer choosing with other people' WHERE id = ${f.sourceId}`;
    expect(await f.read()).toMatchObject({ entries: [], supportChanged: true });
    expect(await getTopOfMindVersion(t.db as never, { profileId: f.profileId, artifactId: f.artifactId }))
      .toMatchObject({ entries: [], supportChanged: true });
    expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(1);
    expect((await t.sql`SELECT body FROM top_of_mind_entries WHERE id = ${f.entryId}`)[0].body).toBe('A little quiet may help you choose');
  });

  it('keeps protected wording while withdrawing its unchecked generated explanation and citations', async () => {
    const f = await fixture(true);
    await t.sql`UPDATE signals SET statement = 'I prefer company when deciding', locked_at = now() WHERE id = ${f.signalId}`;
    expect((await f.read())?.entries[0]).toMatchObject({ body: 'A little quiet may help you choose', locked: true,
      belief: null, prompt: null, citedSignals: [], supportChanged: true });
  });

  it('a positive source check can restore unchanged wording without duplicating evidence', async () => {
    const f = await fixture();
    await t.sql`UPDATE inspirations SET text = 'A quiet walk still helps me decide' WHERE id = ${f.sourceId}`;
    expect((await f.read())?.entries).toEqual([]);
    await applySignalSupportReview(t.db as never, await f.review());
    expect(await f.read()).toMatchObject({ supportChanged: false, entries: [{ body: 'A little quiet may help you choose' }] });
    expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(1);
  });

  it('checking a rewritten signal does not retroactively recertify the old artifact wording', async () => {
    const f = await fixture();
    await t.sql`UPDATE signals SET statement = 'I prefer company when deciding', locked_at = now() WHERE id = ${f.signalId}`;
    await applySignalSupportReview(t.db as never, await f.review());
    expect(await f.read()).toMatchObject({ entries: [], supportChanged: true });
    expect((await t.sql`SELECT statement FROM signals WHERE id = ${f.signalId}`)[0].statement).toBe('I prefer company when deciding');
  });

  it('a failed provider keeps the relationship but cannot clear pending support', async () => {
    const f = await fixture(true);
    await t.sql`UPDATE inspirations SET text = 'A changed explanation' WHERE id = ${f.sourceId}`;
    const report = await reviewSignalSupport(t.db as never, { ownerProfileId: f.profileId, inspirationId: f.sourceId, maxCalls: 1,
      provider: { assessSignalSupport: async () => { throw new Error('Synthetic provider failure'); } } });
    await applySignalSupportReview(t.db as never, report);
    expect(await t.sql`SELECT id FROM signal_evidence`).toHaveLength(1);
    expect((await f.read())?.entries[0]).toMatchObject({ locked: true, supportChanged: true, citedSignals: [], belief: null, prompt: null });
  });

  it('rejects a review after wording changes and returns to the same words', async () => {
    const f = await fixture();
    const report = await f.review();
    await t.sql`UPDATE signals SET statement = 'A temporary different claim' WHERE id = ${f.signalId}`;
    await t.sql`UPDATE signals SET statement = 'I seek quiet before deciding' WHERE id = ${f.signalId}`;
    await expect(applySignalSupportReview(t.db as never, report)).rejects.toThrow(/claims changed/);
    expect(await t.sql`SELECT review_id FROM signal_support_reviews`).toHaveLength(0);
  });

  it.each(['statement', 'material'] as const)('does not reuse a cached verdict after %s changes and returns', async (change) => {
    const f = await fixture();
    await applySignalSupportReview(t.db as never, await f.review());
    const cached = () => reviewSignalSupport(t.db as never, { ownerProfileId: f.profileId, inspirationId: f.sourceId,
      provider: supported, maxCalls: 1, reuseCurrentAssessments: true });
    expect((await cached()).calls).toBe(0);
    if (change === 'statement') {
      await t.sql`UPDATE signals SET statement = 'A temporary different claim' WHERE id = ${f.signalId}`;
      await t.sql`UPDATE signals SET statement = 'I seek quiet before deciding' WHERE id = ${f.signalId}`;
    } else {
      await t.sql`UPDATE inspirations SET text = 'A temporary different source' WHERE id = ${f.sourceId}`;
      await t.sql`UPDATE inspirations SET text = 'Quiet helps me decide' WHERE id = ${f.sourceId}`;
    }
    expect((await cached()).calls).toBe(1);
  });

  it('an explicit read waits for active support without publishing an empty success', async () => {
    const f = await fixture();
    await t.sql`UPDATE inspirations SET text = 'Quiet still helps me decide' WHERE id = ${f.sourceId}`;
    const request = await enqueueTopOfMindRefresh(f.profileId, 'manual');
    await t.sql`UPDATE background_jobs SET run_after = now() + interval '30 minutes' WHERE type::text = 'review_signal_support'`;
    const synthesis = vi.fn(async (input: TopOfMindSynthesisInput) => ({
      entries: [{ type: 'hypothesis' as const, body: 'A current checked reading', citedSignalIds: input.signals.map((signal) => signal.id) }],
    }));
    setDefaultModelProviderForTests({ ...supported, synthesizeTopOfMind: synthesis } as unknown as ModelProvider);
    const readingJob = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    expect(readingJob?.id).toBe(request.jobId);
    try { await processBackgroundJob(readingJob!); throw new Error('Pending checks must hold the reading'); }
    catch (error) {
      expect(error).toBeInstanceOf(BackgroundJobHeldError);
      const until = (error as BackgroundJobHeldError).heldUntil;
      expect(until.getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
      await postgresBackgroundJobStore.holdJob(readingJob!, until, 'support');
    }
    expect(synthesis).not.toHaveBeenCalled();
    expect(await t.sql`SELECT id FROM top_of_minds`).toHaveLength(1);
    expect((await t.sql`SELECT status, attempts, result FROM background_jobs WHERE id = ${request.jobId}`)[0])
      .toMatchObject({ status: 'pending', attempts: 0, result: null });
    expect(await loadPrincipleStatus(t.db as never, f.profileId)).toMatchObject({ phase: 'pending', supportPending: true });

    await t.sql`UPDATE background_jobs SET run_after = now() WHERE type::text = 'review_signal_support'`;
    const check = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    expect(check?.type).toBe('review_signal_support');
    await processBackgroundJob(check!); await postgresBackgroundJobStore.markSucceeded(check!, null);
    // Read again upgrades the held parent, using the already finished check.
    await enqueueTopOfMindRefresh(f.profileId, 'manual');
    const ready = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    expect(ready?.type).toBe('refresh_top_of_mind');
    const result = await processBackgroundJob(ready!); await postgresBackgroundJobStore.markSucceeded(ready!, result ?? null);
    expect(synthesis).toHaveBeenCalledOnce();
    expect((await f.read())?.entries[0]?.body).toBe('A current checked reading');
  });

  it('a principle retry recovers a failed check instead of asking for more inspirations', async () => {
    const f = await fixture(true);
    await t.sql`UPDATE inspirations SET text = 'A changed source' WHERE id = ${f.sourceId}`;
    await enqueueTopOfMindRefresh(f.profileId, 'manual');
    await t.sql`UPDATE background_jobs SET status = 'failed' WHERE type::text = 'review_signal_support'`;
    expect(await loadPrincipleStatus(t.db as never, f.profileId)).toMatchObject({ phase: 'failed', supportPending: true });
    expect(await requestPrincipleRefresh(t.db as never, f.profileId, true)).toMatchObject({ phase: 'pending', supportPending: true });
    expect(await t.sql`SELECT id FROM background_jobs WHERE type::text = 'review_signal_support'`).toHaveLength(1);
    expect((await t.sql`SELECT status, attempts FROM background_jobs WHERE type::text = 'review_signal_support'`)[0])
      .toEqual({ status: 'pending', attempts: 0 });
    expect(await t.sql`SELECT id FROM inspirations`).toHaveLength(1);
  });

  it('editing an entry keeps the new words without attributing the previous body’s citations', async () => {
    const f = await fixture(true);
    await updateLiveEntry(t.db as never, { profileId: f.profileId, entryId: f.entryId,
      patch: { body: 'I choose lively company now', lockedAt: new Date() } });
    expect((await f.read())?.entries[0]).toMatchObject({ body: 'I choose lively company now', supportChanged: true,
      citedSignals: [], belief: null, prompt: null });
  });

  it('editing a principle keeps the words but does not reuse proof of its previous statement', async () => {
    const f = await fixture();
    const ids = [f.signalId];
    for (let i = 0; i < 2; i++) {
      const [row] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${f.profileId}, ${`A supported statement ${i}`}) RETURNING id`;
      ids.push(row.id as string);
    }
    for (const id of ids) {
      for (let n = 0; n < 3; n++) {
        const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${f.profileId}, ${`Synthetic witness ${n}`}) RETURNING id`;
        await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
          VALUES (${f.profileId}, ${f.profileId}, ${id}, ${source.id})`;
      }
      await t.sql`UPDATE signals SET status = 'active' WHERE id = ${id}`;
    }
    const [principle] = await t.sql`INSERT INTO principles(profile_id, statement, rank, origin, state, held_since)
      VALUES (${f.profileId}, 'Choose quiet deliberate work', 1, 'minted', 'held', now()) RETURNING id`;
    for (const id of ids) await t.sql`INSERT INTO principle_signals(profile_id, principle_id, signal_id)
      VALUES (${f.profileId}, ${principle.id}, ${id})`;
    expect((await loadPrincipleViews(t.db as never, f.profileId))[0]?.supportChanged).toBe(false);
    await t.sql`UPDATE principles SET statement = 'Choose lively company', locked_at = now() WHERE id = ${principle.id}`;
    expect((await loadPrincipleViews(t.db as never, f.profileId))[0]).toMatchObject({ statement: 'Choose lively company',
      locked: true, supportChanged: true, citedSignals: [] });
  });

  it('machine restatement reviews older witnesses, then publishes a reading bound to the new words', async () => {
    const f = await fixture();
    const vector = [1, ...new Array<number>(767).fill(0)], model = 'pending-support-test';
    await writeSignalEmbedding(t.db as never, { profileId: f.profileId, signalId: f.signalId,
      statement: 'I seek quiet before deciding', model, embedding: vector });
    const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${f.profileId}, 'A quiet walk helps me choose') RETURNING id`;
    const provider = { ...supported,
      extractSignalCandidates: async () => ({ statements: [{ statement: 'Quiet walking helps me choose', quote: 'A quiet walk helps me choose' }] }),
      synthesizeTopOfMind: async (input: TopOfMindSynthesisInput) => ({ entries: [{ type: 'hypothesis', body: 'Quiet walking is a current thread', citedSignalIds: input.signals.map((signal) => signal.id) }] }),
    } as unknown as ModelProvider;
    const outcome = await deriveSignalsForInspiration({ inspirationId: source.id as string, reason: 'created' }, {
      db: t.db as never, modelProvider: provider, embeddingClient: { model, embed: async () => vector },
    });
    expect(outcome.matchedSignalIds).toEqual([f.signalId]);
    expect((await t.sql`SELECT statement_revision::text FROM signals WHERE id = ${f.signalId}`)[0].statement_revision).toBe('2');
    expect((await t.sql`SELECT payload FROM background_jobs WHERE type::text = 'review_signal_support'`)[0].payload)
      .toEqual({ inspirationId: f.sourceId });
    expect((await f.read())?.entries).toEqual([]);
    setDefaultModelProviderForTests(provider);
    let check = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    // Both requests share a transaction timestamp. Fairness may claim the
    // reading first; it must yield to the review without publishing anything.
    if (check?.type === 'refresh_top_of_mind') {
      try { await processBackgroundJob(check); throw new Error('Unfinished proof must hold the reading'); }
      catch (error) {
        expect(error).toBeInstanceOf(BackgroundJobHeldError);
        await postgresBackgroundJobStore.holdJob(check, (error as BackgroundJobHeldError).heldUntil, 'support');
      }
      check = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    }
    expect(check?.type).toBe('review_signal_support');
    await processBackgroundJob(check!); await postgresBackgroundJobStore.markSucceeded(check!, null);
    expect((await f.read())?.entries).toEqual([]); // old artifact still cites revision one
    await enqueueTopOfMindRefresh(f.profileId, 'manual');
    const reading = await postgresBackgroundJobStore.claimNext(new Date(Date.now() + 1000));
    expect(reading?.type).toBe('refresh_top_of_mind');
    const result = await processBackgroundJob(reading!); await postgresBackgroundJobStore.markSucceeded(reading!, result ?? null);
    expect((await f.read())?.entries[0]?.body).toBe('Quiet walking is a current thread');
    expect(await t.sql`SELECT id FROM signals WHERE profile_id = ${f.profileId}`).toHaveLength(1);
  });

  it('private answers leave room proof current, while public source edits require a fresh check', async () => {
    const f = await fixture();
    const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`room-other-${++sequence}@example.test`}) RETURNING id`;
    const [other] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Other') RETURNING id`;
    const group = await createGroupForProfile(t.db as never, { profileId: f.profileId, name: 'Current support' });
    await joinGroupByCode(t.db as never, { profileId: other.id as string, joinCode: group.joinCode });
    const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id = ${group.id}`;
    await t.sql`UPDATE inspirations SET visibility = 'public' WHERE id = ${f.sourceId}`;
    const [second] = await t.sql`INSERT INTO inspirations(profile_id, text, visibility) VALUES (${other.id}, 'Quiet space helps me choose', 'public') RETURNING id`;
    const [signal] = await t.sql`INSERT INTO signals(profile_id, statement, input_policy) VALUES (${mind.id}, 'We value quiet spaces', 'group-public-v1') RETURNING id`;
    for (const [owner, id] of [[f.profileId, f.sourceId], [other.id as string, second.id as string]]) {
      const material = await loadInspirationMaterial(t.db as never, owner!, id!, 'public');
      await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id, material)
        VALUES (${mind.id}, ${owner}, ${signal.id}, ${id}, ${JSON.stringify(material!.identity)}::jsonb)`;
    }
    const [artifact] = await t.sql`INSERT INTO top_of_minds(group_id) VALUES (${group.id}) RETURNING id`;
    const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id, type, body, input_policy)
      VALUES (${artifact.id}, 'hypothesis', 'Quiet space is a shared thread', 'group-public-v1') RETURNING id`;
    await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id, signal_id) VALUES (${entry.id}, ${signal.id})`;
    const read = () => loadGroupTopOfMind(t.db as never, group.id);
    expect((await read()).entries).toHaveLength(1);
    await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer)
      VALUES (${f.profileId}, ${f.sourceId}, 'Why?', 'PRIVATE_ANSWER')`;
    expect((await read()).entries).toHaveLength(1);
    await t.sql`UPDATE inspirations SET text = 'A quiet walk still helps me decide' WHERE id = ${f.sourceId}`;
    expect((await read()).entries).toEqual([]);
    const report = await reviewSignalSupport(t.db as never, { ownerProfileId: f.profileId, inspirationId: f.sourceId,
      deriveIntoProfileId: mind.id as string, maxCalls: 1, provider: { assessSignalSupport: async (input) => {
        expect(input.sources.some((source) => source.kind === 'reflection')).toBe(false);
        return supported.assessSignalSupport(input);
      } } });
    await applySignalSupportReview(t.db as never, report);
    expect((await read()).entries).toHaveLength(1);
  });
});
