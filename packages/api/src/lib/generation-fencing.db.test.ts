import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { refreshTopOfMindForProfile, refreshTopOfMindForGroup } from "./top-of-mind-synthesis.js";
import { refreshPrinciplesForProfile } from "./principle-generation.js";
import { readGenerationRevision, assertGenerationRevision } from "./generation-revision.js";
import { createGroupForProfile, joinGroupByCode } from "../routes/groups-membership.js";
import { createFeedbackForProfile } from "../routes/feedback.js";
import type { ModelProvider } from "./model-provider.js";
type RelationInput=Parameters<ModelProvider['judgePrincipleRelation']>[0];
const relations=(input:RelationInput,relation:'same'|'independent'|'conflicting')=>({relations:input.existingPrinciples.map(row=>({principleId:row.id,relation}))});

let t: TestDatabase;
let sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); });
afterAll(async () => { await t?.cleanup(); });

async function fixture() {
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`fence-${++sequence}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Owner') RETURNING id`;
  const signalIds: string[] = [], sourceIds: string[] = [];
  for (let i = 0; i < 3; i++) {
    const [signal] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${profile.id}, ${`Pattern ${i}`}) RETURNING id`;
    signalIds.push(signal.id as string);
    for (let j = 0; j < 3; j++) {
      const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, ${`Source ${i}-${j}`}) RETURNING id`;
      sourceIds.push(source.id as string);
      await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
        VALUES (${profile.id}, ${profile.id}, ${signal.id}, ${source.id})`;
    }
    await t.sql`UPDATE signals SET status = 'active' WHERE id = ${signal.id}`;
  }
  const [artifact] = await t.sql`INSERT INTO top_of_minds(profile_id, version) VALUES (${profile.id}, 1) RETURNING id`;
  const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id, type, body) VALUES (${artifact.id}, 'pattern', 'The current reading') RETURNING id`;
  for (const signalId of signalIds) await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id, signal_id) VALUES (${entry.id}, ${signalId})`;
  return { profileId: profile.id as string, signalIds, sourceIds, artifactId: artifact.id as string, entryId: entry.id as string };
}

const synthesizer = (ids: string[], change?: () => Promise<unknown>, body = 'A stale new reading') => ({
  synthesizeTopOfMind: async () => { await change?.(); return { entries: [{ type: 'pattern', body, citedSignalIds: ids }] }; },
}) as unknown as ModelProvider;

async function groupFixture() {
  const f = await fixture();
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`fence-other-${++sequence}@example.test`}) RETURNING id`;
  const [other] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Other') RETURNING id`;
  const group = await createGroupForProfile(t.db as never, { profileId: f.profileId, name: 'Shared room' });
  await joinGroupByCode(t.db as never, { profileId: other.id as string, joinCode: group.joinCode });
  const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id = ${group.id}`;
  await t.sql`UPDATE inspirations SET visibility = 'public' WHERE profile_id = ${f.profileId}`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text, visibility) VALUES (${other.id}, 'Other public material', 'public') RETURNING id`;
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const [signal] = await t.sql`INSERT INTO signals(profile_id, statement, input_policy) VALUES (${mind.id}, ${`Shared pattern ${i}`}, 'group-public-v1') RETURNING id`;
    ids.push(signal.id as string);
    for (const [owner, inspirationId] of [[f.profileId, f.sourceIds[0]!], [other.id, source.id], [f.profileId, f.sourceIds[1]!]]) {
      await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id, material_revision)
        VALUES (${mind.id}, ${owner}, ${signal.id}, ${inspirationId},
          (SELECT public_revision FROM inspiration_revisions WHERE inspiration_id = ${inspirationId}))`;
    }
    await t.sql`UPDATE signals SET status = 'active' WHERE id = ${signal.id}`;
  }
  const [artifact] = await t.sql`INSERT INTO top_of_minds(group_id, version) VALUES (${group.id}, 1) RETURNING id`;
  const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id, type, body, input_policy)
    VALUES (${artifact.id}, 'pattern', 'Our current reading', 'group-public-v1') RETURNING id`;
  for (const id of ids) await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id, signal_id) VALUES (${entry.id}, ${id})`;
  const [reflection] = await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer)
    VALUES (${f.profileId}, ${f.sourceIds[0]!}, 'Why?', 'PRIVATE_SENTINEL') RETURNING id`;
  return { ...f, groupId: group.id, mindId: mind.id as string, groupSignalIds: ids, reflectionId: reflection.id as string };
}

describe('generation commit fences', () => {
  it('a final-commit race retries generation without aborting a human principle edit', async () => {
    const f = await fixture();
    const [principle] = await t.sql`INSERT INTO principles(profile_id, statement, origin, state, rank, locked_at)
      VALUES (${f.profileId}, 'My rule', 'declared', 'aspirational', 1, now()) RETURNING id`;
    const applicationName = `principle-race-${t.schemaName}`;
    const human = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false,
      connection: { search_path: t.schemaName, application_name: applicationName } });
    const observer = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false });
    let edit: Promise<unknown> | undefined;
    try {
      await expect(refreshPrinciplesForProfile({ profileId: f.profileId }, { db: t.db as never,
        modelProvider: { distillPrinciples: async () => ({ candidates: [{ statement: 'A supported rule', type: 'maxim', citedSignalIds: f.signalIds }] }),
          judgePrincipleRelation: async (input:RelationInput) => relations(input,'same') } as unknown as ModelProvider,
        beforeCommit: async () => {
          edit = human`UPDATE principles SET statement = 'My corrected rule', locked_at = now() WHERE id = ${principle.id}`.then(() => true);
          let waiting = false;
          for (let i = 0; i < 50; i++) {
            const [row] = await observer`SELECT wait_event_type FROM pg_stat_activity WHERE application_name = ${applicationName}`;
            if (row?.wait_event_type === 'Lock') { waiting = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          expect(waiting, 'the human owns the row while waiting on the revision fence').toBe(true);
        },
      })).rejects.toThrow(/inputs changed/i);
      expect(await edit).toBe(true);
      expect((await t.sql`SELECT statement, state FROM principles WHERE id = ${principle.id}`)[0])
        .toEqual({ statement: 'My corrected rule', state: 'aspirational' });
    } finally { await human.end(); await observer.end(); }
  });
  it('idempotent inserts that change nothing do not invalidate generation', async () => {
    const f = await fixture();
    const [answer] = await t.sql`INSERT INTO reflections(profile_id, inspiration_id, question, answer)
      VALUES (${f.profileId}, ${f.sourceIds[0]!}, 'Why?', 'A stable answer') RETURNING id`;
    const before = await readGenerationRevision(t.db, { profileId: f.profileId });
    await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${f.profileId}, ${f.profileId}, ${f.signalIds[0]!}, ${f.sourceIds[0]!}) ON CONFLICT DO NOTHING`;
    await t.sql`INSERT INTO reflections(id, profile_id, inspiration_id, question, answer)
      VALUES (${answer.id}, ${f.profileId}, ${f.sourceIds[0]!}, 'Why?', 'A stable answer') ON CONFLICT DO NOTHING`;
    expect(await readGenerationRevision(t.db, { profileId: f.profileId })).toEqual(before);
  });
  it('other profiles’ feedback cannot crowd an owned correction out of the bounded context', async () => {
    const a = await fixture(), b = await fixture();
    await t.sql`INSERT INTO feedback(profile_id, target_type, target_id, value, correction_text, created_at)
      VALUES (${a.profileId}, 'signal', ${a.signalIds[0]!}, 'partly', 'My own correction', '2000-01-01')`;
    for (let n = 0; n < 25; n++) await t.sql`INSERT INTO feedback(profile_id, target_type, target_id, value)
      VALUES (${a.profileId}, 'signal', ${b.signalIds[0]!}, 'true')`;
    await refreshTopOfMindForProfile({ profileId: a.profileId, reason: 'manual' }, { db: t.db as never,
      modelProvider: { synthesizeTopOfMind: async (input: { recentFeedback: unknown[] }) => {
        expect(input.recentFeedback).toEqual([{ target: 'signal', about: 'Pattern 0', value: 'partly', correction: 'My own correction' }]);
        return { noChange: true, entries: [] };
      } } as unknown as ModelProvider,
    });
  });

  it('the final fence orders a concurrent mutation after the protected commit', async () => {
    const f = await fixture();
    const revision = await readGenerationRevision(t.db, { profileId: f.profileId });
    const applicationName = `generation-race-${t.schemaName}`;
    const other = postgres(process.env.DB_CONNECTION_URL!, { max: 1, prepare: false,
      connection: { search_path: t.schemaName, application_name: applicationName } });
    let pending: Promise<unknown> | undefined;
    try {
      await t.db.transaction(async (tx) => {
        await assertGenerationRevision(tx, revision!);
        pending = other`UPDATE inspirations SET text = 'After the protected commit' WHERE id = ${f.sourceIds[0]!}`.then(() => true);
        let waiting = false;
        for (let i = 0; i < 50; i++) {
          await tx.execute(sql`SELECT pg_stat_clear_snapshot()`);
          const rows = await tx.execute(sql`SELECT wait_event_type FROM pg_stat_activity WHERE application_name = ${applicationName}`);
          if ((rows[0] as { wait_event_type?: string })?.wait_event_type === 'Lock') { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting, 'source mutation must wait on the final revision fence').toBe(true);
        expect(await readGenerationRevision(tx, { profileId: f.profileId })).toEqual(revision);
      });
      await pending;
      expect((await readGenerationRevision(t.db, { profileId: f.profileId }))!.revision).toBeGreaterThan(revision!.revision);
    } finally { await other.end(); }
  });
  it('does not fetch another profile’s now-private statement through old feedback', async () => {
    const a = await fixture(), b = await fixture();
    const group = await createGroupForProfile(t.db as never, { profileId: a.profileId, name: 'Once shared' });
    await joinGroupByCode(t.db as never, { profileId: b.profileId, joinCode: group.joinCode });
    await t.sql`INSERT INTO signal_shares(profile_id, signal_id, group_id) VALUES (${b.profileId}, ${b.signalIds[0]!}, ${group.id})`;
    expect(await createFeedbackForProfile(t.db as never, { profileId: a.profileId, targetType: 'signal', targetId: b.signalIds[0]!, value: 'not_true' })).not.toBeNull();
    await t.sql`DELETE FROM signal_shares WHERE signal_id = ${b.signalIds[0]!}`;
    await t.sql`UPDATE signals SET statement = 'PRIVATE_SENTINEL changed after revocation' WHERE id = ${b.signalIds[0]!}`;
    await refreshTopOfMindForProfile({ profileId: a.profileId, reason: 'manual' }, { db: t.db as never,
      modelProvider: { synthesizeTopOfMind: async (input: unknown) => {
        expect(JSON.stringify(input)).not.toContain('PRIVATE_SENTINEL');
        return { noChange: true, entries: [] };
      } } as unknown as ModelProvider,
    });
  });
  it('rejects an intervening change even if the wording changes back', async () => {
    const f = await fixture();
    const provider = synthesizer(f.signalIds, async () => {
      await t.sql`UPDATE signals SET statement = 'A transient change' WHERE id = ${f.signalIds[0]!}`;
      await t.sql`UPDATE signals SET statement = 'Pattern 0' WHERE id = ${f.signalIds[0]!}`;
    });
    await expect(refreshTopOfMindForProfile({ profileId: f.profileId, reason: 'manual' }, { db: t.db as never, modelProvider: provider }))
      .rejects.toThrow(/inputs changed/i);
  });

  it('does not invalidate a room read when only a private answer changes', async () => {
    const f = await groupFixture();
    const before = await readGenerationRevision(t.db, { groupId: f.groupId });
    const personalBefore = await readGenerationRevision(t.db, { profileId: f.profileId });
    const provider = synthesizer(f.groupSignalIds, async () => {
      await t.sql`UPDATE reflections SET answer = 'A different PRIVATE_SENTINEL' WHERE id = ${f.reflectionId}`;
      expect(await readGenerationRevision(t.db, { groupId: f.groupId })).toEqual(before);
      expect((await readGenerationRevision(t.db, { profileId: f.profileId }))!.revision).toBeGreaterThan(personalBefore!.revision);
    }, 'Our current public reading');
    expect((await refreshTopOfMindForGroup({ groupId: f.groupId, reason: 'manual' }, { db: t.db as never, modelProvider: provider })).status).toBe('versioned');
  });

  it.each(['public_source', 'public_delete', 'member_name', 'feedback'] as const)('rejects room output after %s changes', async (changed) => {
    const f = await groupFixture();
    const provider = synthesizer(f.groupSignalIds, async () => {
      if (changed === 'public_source') await t.sql`UPDATE inspirations SET text = 'New public material' WHERE id = ${f.sourceIds[0]!}`;
      else if (changed === 'public_delete') await t.sql`DELETE FROM inspirations WHERE id = ${f.sourceIds[0]!}`;
      else if (changed === 'member_name') await t.sql`UPDATE profiles SET name = 'A corrected name' WHERE id = ${f.profileId}`;
      else await t.sql`INSERT INTO feedback(profile_id, target_type, target_id, value) VALUES (${f.profileId}, 'signal', ${f.groupSignalIds[0]!}, 'not_true')`;
    });
    await expect(refreshTopOfMindForGroup({ groupId: f.groupId, reason: 'manual' }, { db: t.db as never, modelProvider: provider }))
      .rejects.toThrow(/inputs changed/i);
    expect(await t.sql`SELECT id FROM top_of_minds WHERE group_id = ${f.groupId}`).toHaveLength(1);
  });

  it('rolls back the revision as well as an aborted source edit', async () => {
    const f = await fixture();
    const before = await readGenerationRevision(t.db, { profileId: f.profileId });
    await expect(t.sql.begin(async (tx) => {
      await tx`UPDATE inspirations SET text = 'Rolled-back words' WHERE id = ${f.sourceIds[0]!}`;
      throw new Error('abort');
    })).rejects.toThrow('abort');
    expect(await readGenerationRevision(t.db, { profileId: f.profileId })).toEqual(before);
    expect((await refreshTopOfMindForProfile({ profileId: f.profileId, reason: 'manual' }, {
      db: t.db as never, modelProvider: synthesizer(f.signalIds),
    })).status).toBe('versioned');
  });

  it('later candidates can match an earlier planned principle without minting duplicates', async () => {
    const f = await fixture();
    const result = await refreshPrinciplesForProfile({ profileId: f.profileId }, { db: t.db as never,
      modelProvider: { distillPrinciples: async () => ({ candidates: [
        { statement: 'A useful directive', type: 'maxim', citedSignalIds: f.signalIds },
        { statement: 'The same directive reworded', type: 'maxim', citedSignalIds: f.signalIds },
      ] }), judgePrincipleRelation: async (input:RelationInput) => relations(input,'same') } as unknown as ModelProvider,
    });
    expect(result).toMatchObject({ minted: 1, attached: 0 });
    expect(await t.sql`SELECT id FROM principles WHERE profile_id = ${f.profileId}`).toHaveLength(1);
  });

  it('a changed existing principle invalidates comparisons before any conflict is written', async () => {
    const f = await fixture();
    const [original] = await t.sql`INSERT INTO principles(profile_id, statement, origin, state, rank, locked_at)
      VALUES (${f.profileId}, 'My rule', 'declared', 'aspirational', 1, now()) RETURNING id`;
    await expect(refreshPrinciplesForProfile({ profileId: f.profileId }, { db: t.db as never,
      modelProvider: { distillPrinciples: async () => ({ candidates: [{ statement: 'A candidate', type: 'maxim', citedSignalIds: f.signalIds }] }),
        judgePrincipleRelation: async (input:RelationInput) => {
          await t.sql`UPDATE principles SET statement = 'My corrected rule', locked_at = now() WHERE id = ${original.id}`;
          return relations(input,'conflicting');
        } } as unknown as ModelProvider,
    })).rejects.toThrow(/inputs changed/i);
    expect((await t.sql`SELECT statement, state FROM principles WHERE profile_id = ${f.profileId}`)).toEqual([{ statement: 'My corrected rule', state: 'aspirational' }]);
  });
  it.each(['source', 'source_delete', 'signal', 'entry'] as const)('rejects a personal reading after its %s changes during the model call', async (changed) => {
    const f = await fixture();
    const provider = synthesizer(f.signalIds, async () => {
      if (changed === 'source') await t.sql`UPDATE inspirations SET text = 'A new choice' WHERE id = ${f.sourceIds[0]!}`;
      else if (changed === 'source_delete') await t.sql`DELETE FROM inspirations WHERE id = ${f.sourceIds[0]!}`;
      else if (changed === 'signal') await t.sql`UPDATE signals SET statement = 'My corrected words', locked_at = now() WHERE id = ${f.signalIds[0]!}`;
      else await t.sql`UPDATE top_of_mind_entries SET body = 'The words I chose', locked_at = now() WHERE id = ${f.entryId}`;
    });
    await expect(refreshTopOfMindForProfile({ profileId: f.profileId, reason: 'manual' }, { db: t.db as never, modelProvider: provider }))
      .rejects.toThrow(/inputs changed/i);
    expect(await t.sql`SELECT id FROM top_of_minds WHERE profile_id = ${f.profileId}`).toHaveLength(1);
    if (changed === 'entry') expect((await t.sql`SELECT body FROM top_of_mind_entries WHERE id = ${f.entryId}`)[0].body).toBe('The words I chose');
  });

  it('an older pass cannot supersede a newer completed reading', async () => {
    const f = await fixture();
    const older = synthesizer(f.signalIds, async () => {
      await refreshTopOfMindForProfile({ profileId: f.profileId, reason: 'manual' }, {
        db: t.db as never, modelProvider: synthesizer(f.signalIds, undefined, 'The newer reading'),
      });
    });
    await expect(refreshTopOfMindForProfile({ profileId: f.profileId, reason: 'manual' }, { db: t.db as never, modelProvider: older }))
      .rejects.toThrow(/inputs changed/i);
    expect(await t.sql`SELECT id FROM top_of_minds WHERE profile_id = ${f.profileId}`).toHaveLength(2);
    expect((await t.sql`SELECT e.body FROM top_of_mind_entries e JOIN top_of_minds m ON m.id = e.top_of_mind_id
      WHERE m.profile_id = ${f.profileId} AND m.status = 'live'`)[0].body).toBe('The newer reading');
  });

  it('a principle cannot be minted from evidence changed during distillation', async () => {
    const f = await fixture();
    await expect(refreshPrinciplesForProfile({ profileId: f.profileId }, { db: t.db as never,
      modelProvider: { distillPrinciples: async () => {
        await t.sql`DELETE FROM signal_evidence WHERE signal_id = ${f.signalIds[0]!}`;
        return { candidates: [{ statement: 'An unsupported directive', type: 'maxim', citedSignalIds: f.signalIds }] };
      } } as unknown as ModelProvider,
    })).rejects.toThrow(/inputs changed/i);
    expect(await t.sql`SELECT id FROM principles WHERE profile_id = ${f.profileId}`).toHaveLength(0);
  });

  it('failure in a later principle comparison leaves no partially applied batch', async () => {
    const f = await fixture();
    await t.sql`INSERT INTO principles(profile_id, statement, origin, state, rank, locked_at)
      VALUES (${f.profileId}, 'My own rule', 'declared', 'aspirational', 1, now())`;
    let comparisons = 0;
    await expect(refreshPrinciplesForProfile({ profileId: f.profileId }, { db: t.db as never,
      modelProvider: { distillPrinciples: async () => ({ candidates: [
        { statement: 'Candidate one', type: 'maxim', citedSignalIds: f.signalIds },
        { statement: 'Candidate two', type: 'maxim', citedSignalIds: f.signalIds },
      ] }), judgePrincipleRelation: async (input:RelationInput) => {
        if (++comparisons > 1) throw new Error('comparison unavailable');
        return relations(input,'independent');
      } } as unknown as ModelProvider,
    })).rejects.toThrow(/comparison unavailable/);
    expect((await t.sql`SELECT statement FROM principles WHERE profile_id = ${f.profileId}`).map((row) => row.statement)).toEqual(['My own rule']);
  });
});
