import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { getLiveTopOfMind, getTopOfMindVersion, updateLiveEntry } from "../routes/top-of-mind.js";
import { createPublicProfileRoutes } from "../routes/public-profiles.js";
import { refreshTopOfMindForProfile } from "./top-of-mind-synthesis.js";
import { reconcileSignalsAfterEvidenceLoss } from "./signal-lifecycle.js";
import type { ModelProvider } from "./model-provider.js";

let t: TestDatabase;
let sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); });
afterAll(async () => { await t?.cleanup(); });

async function fixture(kept: 'locked' | 'pinned' | null = null) {
  const handle = `support${++sequence}`;
  const [account] = await t.sql`INSERT INTO accounts(email) VALUES (${`${handle}@example.test`}) RETURNING id`;
  const [profile] = await t.sql`INSERT INTO profiles(account_id, type, name, public_handle, public_profile_enabled, public_top_of_mind_enabled)
    VALUES (${account.id}, 'human', 'Owner', ${handle}, true, true) RETURNING id`;
  const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${profile.id}, 'A source') RETURNING id`;
  const [signal] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${profile.id}, 'A pattern') RETURNING id`;
  await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
    VALUES (${profile.id}, ${profile.id}, ${signal.id}, ${source.id})`;
  const [artifact] = await t.sql`INSERT INTO top_of_minds(profile_id, version) VALUES (${profile.id}, 1) RETURNING id`;
  const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id, type, body, belief, prompt, locked_at, pinned_at)
    VALUES (${artifact.id}, 'pattern', 'A reading that lost its support', 'An old inference', 'An old suggestion',
      ${kept === 'locked' ? new Date().toISOString() : null}, ${kept === 'pinned' ? new Date().toISOString() : null}) RETURNING id`;
  await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id, signal_id) VALUES (${entry.id}, ${signal.id})`;
  await t.sql`DELETE FROM inspirations WHERE id = ${source.id}`;
  await reconcileSignalsAfterEvidenceLoss(t.db as never, { profileId: profile.id as string, signalIds: [signal.id as string] });
  return { profileId: profile.id as string, signalId: signal.id as string, entryId: entry.id as string, artifactId: artifact.id as string, handle };
}

describe('a personal reading reports current support', () => {
  it.each(['dismissed', 'foreign-owner'] as const)('does not regenerate from a %s signal that the reader rejects', async (reason) => {
    const f = await fixture();
    const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${f.profileId}, 'An owned witness') RETURNING id`;
    await t.sql`UPDATE signals SET status = 'emerging', unsupported_at = NULL, support_retired_at = NULL WHERE id = ${f.signalId}`;
    await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${f.profileId}, ${f.profileId}, ${f.signalId}, ${source.id})`;
    if (reason === 'dismissed') {
      await t.sql`UPDATE signals SET dismissed_at = now() WHERE id = ${f.signalId}`;
    } else {
      const [account] = await t.sql`INSERT INTO accounts(email) VALUES ('another@example.test') RETURNING id`;
      const [owner] = await t.sql`INSERT INTO profiles(account_id, type, name) VALUES (${account.id}, 'human', 'Another') RETURNING id`;
      const [foreign] = await t.sql`INSERT INTO inspirations(profile_id, text, visibility) VALUES (${owner.id}, 'Another person’s witness', 'public') RETURNING id`;
      await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
        VALUES (${f.profileId}, ${owner.id}, ${f.signalId}, ${foreign.id})`;
    }
    expect((await getLiveTopOfMind(t.db as never, { profileId: f.profileId }))?.entries).toEqual([]);
    const result = await refreshTopOfMindForProfile({ profileId: f.profileId, reason: 'manual' }, {
      db: t.db as never, modelProvider: { synthesizeTopOfMind: async () => { throw new Error('Invalid signal reached generation'); } } as unknown as ModelProvider,
    });
    expect(result.entryCount).toBe(0);
  });

  it('does not fetch newly private content after public sharing is turned off during a read', async () => {
    const f = await fixture('locked');
    const app = new Hono();
    app.route('/api/public/profiles', createPublicProfileRoutes({ getDatabase: () => t.db as never,
      getProfileByHandle: async () => {
        await t.sql`UPDATE profiles SET public_top_of_mind_enabled = false WHERE id = ${f.profileId}`;
        await t.sql`UPDATE top_of_mind_entries SET body = 'PRIVATE_AFTER_OPT_OUT' WHERE id = ${f.entryId}`;
        return { id: f.profileId, name: 'Owner', publicHandle: f.handle, preferredLocale: 'en-US', publicTopOfMindEnabled: true };
      },
    }));
    const response = await app.request(`/api/public/profiles/${f.handle}`);
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).not.toContain('PRIVATE_AFTER_OPT_OUT');
  });

  it('revalidates a specific version without allowing another profile to read it', async () => {
    const f = await fixture();
    const current = await getTopOfMindVersion(t.db as never, { profileId: f.profileId, artifactId: f.artifactId });
    expect(current).toMatchObject({ id: f.artifactId, entries: [], supportChanged: true, profileId: f.profileId });
    expect(current?.generationRevision).toMatch(/^\d+$/);
    expect(await getTopOfMindVersion(t.db as never, { profileId: '00000000-0000-4000-8000-000000000001', artifactId: f.artifactId })).toBeNull();
  });

  it('does not keep a generated conclusion by silently dropping only the invalid citation', async () => {
    const f = await fixture();
    const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${f.profileId}, 'Another witness') RETURNING id`;
    const [signal] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${f.profileId}, 'A still-supported pattern') RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id) VALUES (${f.profileId}, ${f.profileId}, ${signal.id}, ${source.id})`;
    await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id, signal_id) VALUES (${f.entryId}, ${signal.id})`;
    expect((await getLiveTopOfMind(t.db as never, { profileId: f.profileId }))?.entries).toEqual([]);
  });

  it('can return a mutation receipt for an entry that is no longer a current supported conclusion', async () => {
    const f = await fixture('locked');
    const result = await updateLiveEntry(t.db as never, { profileId: f.profileId, entryId: f.entryId, patch: { lockedAt: null } });
    expect(result).toMatchObject({ id: f.entryId, locked: false, supportChanged: true });
    expect((await getLiveTopOfMind(t.db as never, { profileId: f.profileId }))?.entries).toEqual([]);
  });

  it.each(['locked', 'pinned'] as const)('regrounds exact %s words with fresh citations even when the model calls the wording unchanged', async (kept) => {
    const f = await fixture(kept);
    const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${f.profileId}, 'A current witness') RETURNING id`;
    const [signal] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${f.profileId}, 'A current pattern') RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id) VALUES (${f.profileId}, ${f.profileId}, ${signal.id}, ${source.id})`;
    await refreshTopOfMindForProfile({ profileId: f.profileId, reason: 'manual' }, { db: t.db as never,
      modelProvider: { synthesizeTopOfMind: async (input: { currentEntries: unknown[]; lockedEntries: unknown[] }) => {
        expect(input.currentEntries).toEqual([]);
        expect(input.lockedEntries[0]).toMatchObject({ supportChanged: true, belief: null, prompt: null, citedSignalIds: [] });
        return { noChange: true, entries: [{ type: 'pattern', body: 'A reading that lost its support', citedSignalIds: [signal.id] }] };
      } } as unknown as ModelProvider,
    });
    const view = await getLiveTopOfMind(t.db as never, { profileId: f.profileId });
    expect(view).toMatchObject({ supportChanged: false });
    expect(view?.entries[0]).toMatchObject({ body: 'A reading that lost its support', locked: kept === 'locked', pinned: kept === 'pinned', supportChanged: false });
    expect(view?.entries[0]?.citedSignals.map((row) => row.id)).toEqual([signal.id]);
  });
  it('withholds an unsupported generated conclusion without deleting its stored history', async () => {
    const f = await fixture();
    const view = await getLiveTopOfMind(t.db as never, { profileId: f.profileId });
    expect(view).toMatchObject({ entries: [], supportChanged: true });
    expect((await t.sql`SELECT body FROM top_of_mind_entries WHERE id = ${f.entryId}`)[0].body).toBe('A reading that lost its support');
  });

  it.each(['locked', 'pinned'] as const)('keeps %s wording but does not pretend the old explanation still supports it', async (kept) => {
    const f = await fixture(kept);
    const view = await getLiveTopOfMind(t.db as never, { profileId: f.profileId });
    expect(view?.entries).toHaveLength(1);
    expect(view?.entries[0]).toMatchObject({ body: 'A reading that lost its support', belief: null, prompt: null,
      citedSignals: [], supportChanged: true });
  });

  it('does not publish unsupported generated text on the public profile', async () => {
    const f = await fixture();
    const app = new Hono();
    app.route('/api/public/profiles', createPublicProfileRoutes({ getDatabase: () => t.db as never }));
    const response = await app.request(`/api/public/profiles/${f.handle}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ topOfMind: null });
  });

  it('publishes kept wording with changed standing but without private IDs or explanations', async () => {
    const f = await fixture('locked');
    const app = new Hono();
    app.route('/api/public/profiles', createPublicProfileRoutes({ getDatabase: () => t.db as never }));
    const response = await app.request(`/api/public/profiles/${f.handle}`);
    const body = await response.json();
    expect(body).toMatchObject({ topOfMind: { entries: [{ type: 'pattern', body: 'A reading that lost its support',
      belief: null, prompt: null, pinned: false, supportChanged: true }] } });
    for (const id of [f.profileId, f.artifactId, f.entryId, f.signalId]) expect(JSON.stringify(body)).not.toContain(id);
  });

  it('applies public support filtering before the requested entry limit', async () => {
    const f = await fixture();
    const [source] = await t.sql`INSERT INTO inspirations(profile_id, text) VALUES (${f.profileId}, 'A current witness') RETURNING id`;
    const [signal] = await t.sql`INSERT INTO signals(profile_id, statement) VALUES (${f.profileId}, 'A current pattern') RETURNING id`;
    await t.sql`INSERT INTO signal_evidence(profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${f.profileId}, ${f.profileId}, ${signal.id}, ${source.id})`;
    const [entry] = await t.sql`INSERT INTO top_of_mind_entries(top_of_mind_id, type, body, sort_order)
      VALUES (${f.artifactId}, 'pattern', 'The supported reading', 10) RETURNING id`;
    await t.sql`INSERT INTO top_of_mind_entry_signals(entry_id, signal_id) VALUES (${entry.id}, ${signal.id})`;
    const app = new Hono();
    app.route('/api/public/profiles', createPublicProfileRoutes({ getDatabase: () => t.db as never }));
    const response = await app.request(`/api/public/profiles/${f.handle}?limit=1`);
    expect(await response.json()).toMatchObject({ topOfMind: { entries: [{ body: 'The supported reading', supportChanged: false }] } });
  });

  it('a no-signal refresh cannot carry an unsupported generated conclusion forward as no change', async () => {
    const f = await fixture();
    const result = await refreshTopOfMindForProfile({ profileId: f.profileId, reason: 'manual' }, {
      db: t.db as never, modelProvider: { synthesizeTopOfMind: async () => { throw new Error('no model needed'); } } as unknown as ModelProvider,
    });
    expect(result.entryCount).toBe(0);
    expect(result.reason).toBe('regenerated');
    expect(await t.sql`SELECT e.body FROM top_of_mind_entries e JOIN top_of_minds m ON m.id = e.top_of_mind_id
      WHERE m.profile_id = ${f.profileId} AND m.status = 'live'`).toHaveLength(0);
  });
});
