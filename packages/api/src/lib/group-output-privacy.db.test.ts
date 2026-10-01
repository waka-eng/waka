import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createGroupForProfile, joinGroupByCode } from "../routes/groups-membership.js";
import { loadGroupWall } from "../routes/groups-wall.js";
import { loadGroupTopOfMind } from "../routes/groups-top-of-mind.js";
import { loadPrincipleViews } from "../routes/principles.js";
import { refreshTopOfMindForGroup } from "./top-of-mind-synthesis.js";
import type { ModelProvider } from "./model-provider.js";
import { refreshPrinciplesForProfile } from "./principle-generation.js";
import { loadPrincipleStatus } from "./principle-status.js";
import { buildGroupInputImpactReport } from "./group-input-impact.js";

let t: TestDatabase;
let sequence = 0;
beforeEach(async () => { t ??= await createTestDatabase(); await t.truncateAll(); });
afterAll(async () => { await t?.cleanup(); });

async function person() {
  const [a] = await t.sql`INSERT INTO accounts (email) VALUES (${`group-output-${++sequence}@example.test`}) RETURNING id`;
  const [p] = await t.sql`INSERT INTO profiles (account_id, type, name) VALUES (${a.id}, 'human', 'A member') RETURNING id`;
  return p.id as string;
}

async function fixture() {
  const a = await person(), b = await person();
  const group = await createGroupForProfile(t.db as never, { profileId: a, name: "Shared walks" });
  await joinGroupByCode(t.db as never, { profileId: b, joinCode: group.joinCode });
  const [mind] = await t.sql`SELECT id FROM profiles WHERE group_id = ${group.id} AND type = 'group'`;
  const inspirationIds: string[] = [];
  for (const owner of [a, b, a]) {
    const [inspiration] = await t.sql`INSERT INTO inspirations (profile_id, text, visibility)
      VALUES (${owner}, 'Public walks', 'public') RETURNING id`;
    inspirationIds.push(inspiration.id as string);
  }
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const [signal] = await t.sql`INSERT INTO signals (profile_id, statement, status, input_policy)
      VALUES (${mind.id}, ${`Public pattern ${i}`}, 'emerging', 'group-public-v1') RETURNING id`;
    ids.push(signal.id as string);
    for (const [index, owner] of [a, b, a].entries()) await t.sql`
      INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${mind.id}, ${owner}, ${signal.id}, ${inspirationIds[index]!})`;
    await t.sql`UPDATE signals SET status = 'active' WHERE id = ${signal.id}`;
  }
  return { groupId: group.id, mind: mind.id as string, a, b, ids, inspirationIds };
}

async function legacyReading(groupId: string, ids: string[], locked = true) {
  const [artifact] = await t.sql`INSERT INTO top_of_minds (group_id, version, status) VALUES (${groupId}, 1, 'live') RETURNING id`;
  const [entry] = await t.sql`INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, belief, prompt, locked_at)
    VALUES (${artifact.id}, 'pattern', 'PRIVATE_SENTINEL legacy body', 'PRIVATE_SENTINEL belief', 'PRIVATE_SENTINEL prompt', ${locked ? new Date().toISOString() : null}) RETURNING id`;
  for (const id of ids) await t.sql`INSERT INTO top_of_mind_entry_signals (entry_id, signal_id) VALUES (${entry.id}, ${id})`;
  return { artifactId: artifact.id as string, entryId: entry.id as string };
}

describe("room output privacy", () => {
  it("does not serve an unverified signal even with two current public voices", async () => {
    const f = await fixture();
    await t.sql`UPDATE signals SET input_policy = NULL, statement = 'PRIVATE_SENTINEL signal' WHERE id = ${f.ids[0]!}`;
    const wall = await loadGroupWall(t.db as never, f.groupId);
    expect(wall.map((row) => row.signalId)).not.toContain(f.ids[0]);
    expect(JSON.stringify(wall)).not.toContain("PRIVATE_SENTINEL");
  });

  it("withholds both current and historical unverified text without deleting human wording", async () => {
    const f = await fixture();
    const old = await legacyReading(f.groupId, f.ids);
    for (const query of [{}, { version: 1 }]) {
      const view = await loadGroupTopOfMind(t.db as never, f.groupId, query);
      expect(view.entries).toEqual([]);
      expect(view).toMatchObject({ restricted: true });
      expect(JSON.stringify(view)).not.toContain("PRIVATE_SENTINEL");
    }
    const [kept] = await t.sql`SELECT body, locked_at FROM top_of_mind_entries WHERE id = ${old.entryId}`;
    expect(kept.body).toBe("PRIVATE_SENTINEL legacy body");
    expect(kept.locked_at).not.toBeNull();
  });

  it("serves approved member wording without its unverified generated explanation", async () => {
    const f = await fixture();
    const old = await legacyReading(f.groupId, f.ids);
    await t.sql`UPDATE top_of_mind_entries SET body = 'Our approved words' WHERE id = ${old.entryId}`;
    await t.sql`INSERT INTO group_top_of_mind_proposals (group_id, proposed_by_profile_id, kind, body, status, resolved_at)
      VALUES (${f.groupId}, ${f.a}, 'add_entry', 'Our approved words', 'accepted', now())`;
    const view = await loadGroupTopOfMind(t.db as never, f.groupId);
    expect(view.entries[0]?.body).toBe("Our approved words");
    expect(view.entries[0]?.belief).toBeNull();
    expect(view.entries[0]?.prompt).toBeNull();
    expect(JSON.stringify(view)).not.toContain("PRIVATE_SENTINEL");
  });

  it("does not reuse unverified entries in synthesis or lose their locked original", async () => {
    const f = await fixture();
    const old = await legacyReading(f.groupId, f.ids);
    const synthesize = vi.fn(async () => ({ entries: [{ type: "pattern", body: "A public reading", citedSignalIds: f.ids }] }));
    await refreshTopOfMindForGroup({ groupId: f.groupId, reason: "manual" }, {
      db: t.db as never, modelProvider: { synthesizeTopOfMind: synthesize } as unknown as ModelProvider,
    });
    expect(synthesize).toHaveBeenCalledOnce();
    expect(JSON.stringify(synthesize.mock.calls)).not.toContain("PRIVATE_SENTINEL");
    const view = await loadGroupTopOfMind(t.db as never, f.groupId);
    expect(view.entries.map((row) => row.body)).toContain("A public reading");
    expect(JSON.stringify(view)).not.toContain("PRIVATE_SENTINEL");
    expect(view).toMatchObject({ restricted: true });
    expect((await t.sql`SELECT body FROM top_of_mind_entries WHERE id = ${old.entryId}`)[0].body).toContain("PRIVATE_SENTINEL");
    const report = await buildGroupInputImpactReport(t.sql, f.groupId);
    expect(report.readingsForReview.records).toHaveLength(2);
    expect(report.readingsForReview.records.map((row) => row.unverified_entry_count)).toEqual([1, 1]);
  });

  it("does not serve legacy principles just because their current citations are safe", async () => {
    const f = await fixture();
    const [principle] = await t.sql`INSERT INTO principles (profile_id, statement, type, state, origin, rank)
      VALUES (${f.mind}, 'PRIVATE_SENTINEL principle', 'value', 'held', 'minted', 1) RETURNING id`;
    for (const id of f.ids) await t.sql`INSERT INTO principle_signals (profile_id, principle_id, signal_id)
      VALUES (${f.mind}, ${principle.id}, ${id})`;
    expect(await loadPrincipleViews(t.db as never, f.mind)).toEqual([]);
    expect(await t.sql`SELECT id FROM principles WHERE id = ${principle.id}`).toHaveLength(1);
    expect(await loadPrincipleStatus(t.db as never, f.mind)).toMatchObject({ restricted: true });
  });

  it("preserves a verified room reading when the provider explicitly says no change", async () => {
    const f = await fixture();
    const old = await legacyReading(f.groupId, f.ids, false);
    await t.sql`UPDATE top_of_mind_entries SET body = 'Our current public direction', belief = NULL, prompt = NULL,
      input_policy = 'group-public-v1' WHERE id = ${old.entryId}`;
    await refreshTopOfMindForGroup({ groupId: f.groupId, reason: "manual" }, {
      db: t.db as never, modelProvider: { synthesizeTopOfMind: async () => ({ noChange: true, entries: [] }) } as unknown as ModelProvider,
    });
    const view = await loadGroupTopOfMind(t.db as never, f.groupId);
    expect(view.topOfMind?.reason).toBe("no_change");
    expect(view.entries.map((entry) => entry.body)).toEqual(["Our current public direction"]);
  });

  it("excludes legacy principles and entries from every new principle prompt", async () => {
    const f = await fixture();
    const old = await legacyReading(f.groupId, f.ids);
    const [safeEntry] = await t.sql`INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, input_policy)
      VALUES (${old.artifactId}, 'pattern', 'A verified public reading', 'group-public-v1') RETURNING id`;
    for (const id of f.ids) await t.sql`INSERT INTO top_of_mind_entry_signals (entry_id, signal_id) VALUES (${safeEntry.id}, ${id})`;
    const [legacy] = await t.sql`INSERT INTO principles (profile_id, statement, type, state, origin, rank, locked_at)
      VALUES (${f.mind}, 'PRIVATE_SENTINEL old principle', 'maxim', 'held', 'minted', 1, now()) RETURNING id`;
    const distill = vi.fn(async () => ({ candidates: [{ statement: "Protect time for shared walks.", type: "maxim", citedSignalIds: f.ids }] }));
    const judge = vi.fn(async () => ({ relation: "same" }));
    const result = await refreshPrinciplesForProfile({ profileId: f.mind }, {
      db: t.db as never, modelProvider: { distillPrinciples: distill, judgePrincipleRelation: judge } as unknown as ModelProvider,
    });
    expect(result.minted).toBe(1);
    expect(JSON.stringify(distill.mock.calls)).not.toContain("PRIVATE_SENTINEL");
    expect(judge).not.toHaveBeenCalled();
    const visible = await loadPrincipleViews(t.db as never, f.mind);
    expect(visible.map((row) => row.statement)).toEqual(["Protect time for shared walks."]);
    expect((await t.sql`SELECT statement FROM principles WHERE id = ${legacy.id}`)[0].statement).toContain("PRIVATE_SENTINEL");
    await t.sql`UPDATE signals SET input_policy = NULL WHERE id = ${f.ids[0]!}`;
    expect(await loadPrincipleViews(t.db as never, f.mind)).toEqual([]);
  });

  it("discards a reading when membership changes during synthesis", async () => {
    const f = await fixture();
    await legacyReading(f.groupId, f.ids);
    const synthesize = vi.fn(async () => {
      await t.sql`DELETE FROM group_members WHERE group_id = ${f.groupId} AND profile_id = ${f.b}`;
      return { entries: [{ type: "pattern", body: "Outdated group", citedSignalIds: f.ids }] };
    });
    await expect(refreshTopOfMindForGroup({ groupId: f.groupId, reason: "manual" }, {
      db: t.db as never, modelProvider: { synthesizeTopOfMind: synthesize } as unknown as ModelProvider,
    })).rejects.toThrow("Generation inputs changed");
    expect(await t.sql`SELECT id FROM top_of_minds WHERE group_id = ${f.groupId}`).toHaveLength(1);
  });

  it("includes room principle jobs billed to a member in the impact inventory", async () => {
    const f = await fixture();
    const [job] = await t.sql`INSERT INTO background_jobs (profile_id, type, payload)
      VALUES (${f.a}, 'refresh_principles', ${JSON.stringify({ profileId: f.mind })}::jsonb) RETURNING id`;
    const report = await buildGroupInputImpactReport(t.sql, f.groupId);
    expect(report.jobsForReview.records.map((row) => row.id)).toEqual([job.id]);
    expect(report.jobsForReview.records[0]).not.toHaveProperty("payload");
  });
});
