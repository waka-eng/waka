/**
 * A ROOM READS ITS MEMBERS' PUBLIC MEMORIES AND CONVERGES THEM.
 *
 * Founder ruling, 2026-08-24: "that room would have x inspirations from
 * person x, y from person y, z from person z. that room should create
 * signals based on x+y+z." This file drives the REAL pipeline —
 * `deriveSignalsForInspiration` with `deriveIntoProfileId` set to the
 * room's mind — on real Postgres, and holds the three facts the feature is:
 *
 *   1. TWO MEMBERS' KEEPS CONVERGE ON ONE ROOM SIGNAL. The first pass mints
 *      under the mind; the second — a near-identical embedding from a
 *      DIFFERENT member — matches instead of minting, and the evidence rows
 *      name two distinct owners. That distinct-owner count is what the
 *      two-voices gate (`GROUP_SIGNAL_MIN_VOICES`) reads.
 *
 *   2. THE ROOM'S PASS NEVER TOUCHES THE KEEPER'S OWN WALL. Same capture,
 *      same statements — zero signals under the member's profile, because
 *      the pass landed where it was aimed.
 *
 *   3. BOTH INPUT SCOPES STAY WITH THE OWNER. A public-only vector serves
 *      room retrieval; a separate personal vector can include private answers.
 *      Neither is stored under the mind or substituted for the other.
 *
 * WHAT THIS MOCKS, AND WHY: the model provider and the embedding client —
 * the two network edges — with deterministic vectors, exactly as the other
 * derivation contract suites do. The database, the pipeline, the locks and
 * every constraint are real; a mocked query builder would prove none of the
 * three facts above.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createGroupForProfile, joinGroupByCode } from "../routes/groups-membership.js";
import { deriveSignalsForInspiration } from "./signal-derivation.js";
import type { ModelProvider } from "./model-provider.js";
import { ensureInspirationEmbedding } from "./inspiration-embeddings.js";
import { buildGroupInputImpactReport } from "./group-input-impact.js";

const EMBEDDING_MODEL = "room-derivation-test-embedding";

let t: TestDatabase;
let seq = 0;

async function seedPerson(name: string): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`room-derive-${seq}-${name}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  return p.id as string;
}

async function keepPublic(profileId: string, text: string): Promise<string> {
  const [row] = await t.sql`
    INSERT INTO inspirations (profile_id, text, visibility)
    VALUES (${profileId}, ${text}, 'public') RETURNING id`;
  return row.id as string;
}

async function mindOf(groupId: string): Promise<string> {
  const rows = await t.sql`
    SELECT id FROM profiles WHERE group_id = ${groupId} AND type = 'group'`;
  return rows[0]!.id as string;
}

/** One statement per pass, on a fixed vector: passes with the same vector
    converge, passes with an orthogonal one mint apart. */
function stubs(statement: string, axis: number) {
  const provider = {
    extractSignalCandidates: async () => ({
      statements: [{ statement, reason: "test reason", quote: null }],
    }),
    judgeSignalMatch: async () => {
      throw new Error("identical embeddings match above the judge band");
    },
  } as unknown as ModelProvider;
  const embeddingClient = {
    model: EMBEDDING_MODEL,
    embed: async (_input: string) => {
      const vector = new Array<number>(768).fill(0);
      vector[axis] = 1;
      return vector;
    },
  };
  return { provider, embeddingClient };
}

afterAll(async () => {
  await t?.cleanup();
});

describe("a room distilling from its pooled ground", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  async function privateReflectionFixture() {
    const owner = await seedPerson("Reflection owner");
    const group = await createGroupForProfile(t.db as never, { profileId: owner, name: "Public room" });
    const mind = await mindOf(group.id);
    const keep = await keepPublic(owner, "I enjoy long walks and quiet mornings.");
    await t.sql`INSERT INTO reflections (profile_id, inspiration_id, question, answer)
      VALUES (${owner}, ${keep}, 'Why?', 'PRIVATE_SENTINEL family medical decision')`;
    return { owner, group, mind, keep };
  }

  it("never sends private reflection answers to the room extractor", async () => {
    const { mind, keep } = await privateReflectionFixture();
    const s = stubs("We like quiet walks.", 0);
    const extract = vi.spyOn(s.provider, "extractSignalCandidates");
    await deriveSignalsForInspiration(
      { inspirationId: keep, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );
    expect(extract.mock.calls[0]![0].reflections).toEqual([]);
    expect(JSON.stringify(extract.mock.calls)).not.toContain("PRIVATE_SENTINEL");
  });

  it("never embeds private reflection answers for room retrieval", async () => {
    const { mind, keep } = await privateReflectionFixture();
    const s = stubs("We like quiet walks.", 0);
    const embed = vi.spyOn(s.embeddingClient, "embed");
    await deriveSignalsForInspiration(
      { inspirationId: keep, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );
    expect(JSON.stringify(embed.mock.calls)).not.toContain("PRIVATE_SENTINEL");
  });

  it.each(["before", "during"])("refuses a departed member's room pass (%s extraction)", async (when) => {
    const { owner, group, mind, keep } = await privateReflectionFixture();
    const s = stubs("Must not land in the room.", 0);
    const leave = () => t.sql`DELETE FROM group_members WHERE group_id = ${group.id} AND profile_id = ${owner}`;
    if (when === "before") await leave();
    const original = s.provider.extractSignalCandidates;
    const extract = vi.spyOn(s.provider, "extractSignalCandidates").mockImplementation(async (input) => {
      if (when === "during") await leave();
      return original(input);
    });
    const result = await deriveSignalsForInspiration(
      { inspirationId: keep, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );
    expect(result.status).toBe("not_authorized");
    expect(await t.sql`SELECT id FROM signals WHERE profile_id = ${mind}`).toHaveLength(0);
    if (when === "before") expect(extract).not.toHaveBeenCalled();
  });

  it.each(["visibility", "text"])("rejects room output when %s changes during extraction", async (change) => {
    const { mind, keep } = await privateReflectionFixture();
    const s = stubs("An outdated interpretation.", 0);
    const original = s.provider.extractSignalCandidates;
    vi.spyOn(s.provider, "extractSignalCandidates").mockImplementation(async (input) => {
      if (change === "visibility") await t.sql`UPDATE inspirations SET visibility = 'private' WHERE id = ${keep}`;
      else await t.sql`UPDATE inspirations SET text = 'A different thought' WHERE id = ${keep}`;
      return original(input);
    });
    const run = deriveSignalsForInspiration(
      { inspirationId: keep, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );
    if (change === "visibility") expect((await run).status).toBe("not_public");
    else await expect(run).rejects.toThrow("Room material changed");
    expect(await t.sql`SELECT id FROM signals WHERE profile_id = ${mind}`).toHaveLength(0);
  });

  it("does not allow an override to another person's stack", async () => {
    const { keep } = await privateReflectionFixture();
    const stranger = await seedPerson("Not a room");
    const s = stubs("Should not be written.", 0);
    const extract = vi.spyOn(s.provider, "extractSignalCandidates");
    const result = await deriveSignalsForInspiration(
      { inspirationId: keep, reason: "created", deriveIntoProfileId: stranger },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );
    expect(result.status).toBe("not_authorized");
    expect(extract).not.toHaveBeenCalled();
  });

  it("rolls back matching and restatement if privacy changes inside the match judge", async () => {
    const { owner, mind, keep } = await privateReflectionFixture();
    const initial = stubs("A public pattern before the race.", 0);
    const first = await deriveSignalsForInspiration(
      { inspirationId: keep, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: initial.provider, embeddingClient: initial.embeddingClient },
    );
    const next = await keepPublic(owner, "Another quiet walk.");
    const s = stubs("Should never replace the original.", 0);
    s.embeddingClient.embed = async () => {
      const vector = new Array<number>(768).fill(0);
      vector[0] = 0.8; vector[1] = 0.6;
      return vector;
    };
    const judge = vi.spyOn(s.provider, "judgeSignalMatch").mockImplementation(async () => {
      // The harness pool has max=1. This acts as a genuinely separate user
      // connection, never as a query waiting behind its own transaction.
      const concurrent = postgres(process.env.DB_CONNECTION_URL!, {
        max: 1, prepare: false, connection: { search_path: t.schemaName },
      });
      try {
        await concurrent`UPDATE inspirations SET visibility = 'private' WHERE id = ${next}`;
      } finally {
        await concurrent.end();
      }
      return { relation: "same" };
    });
    const result = await deriveSignalsForInspiration(
      { inspirationId: next, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );
    expect(judge).toHaveBeenCalledOnce();
    expect(result.status).toBe("not_public");
    const [signal] = await t.sql`SELECT statement FROM signals WHERE id = ${first.mintedSignalIds[0]!}`;
    expect(signal.statement).toBe("A public pattern before the race.");
    expect(await t.sql`SELECT id FROM signal_evidence WHERE inspiration_id = ${next}`).toHaveLength(0);
  });

  it("revalidates related public material, not only the primary capture", async () => {
    const { owner, mind, keep } = await privateReflectionFixture();
    const related = await keepPublic(owner, "Earlier public words.");
    const s = stubs("A pattern with earlier support.", 0);
    await ensureInspirationEmbedding({ profileId: owner, inspirationId: related, inputScope: "public", db: t.db, client: s.embeddingClient });
    vi.spyOn(s.provider, "extractSignalCandidates").mockImplementation(async (input) => {
      expect(input.relatedInspirations?.map((row) => row.id)).toEqual([related]);
      await t.sql`UPDATE inspirations SET visibility = 'private' WHERE id = ${related}`;
      return { statements: [{ statement: "Do not keep this", reason: "Earlier words",
        relatedEvidence: [{ inspirationId: related, quote: "Earlier public words." }] }] };
    });
    const result = await deriveSignalsForInspiration(
      { inspirationId: keep, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );
    expect(result.status).toBe("not_public");
    expect(await t.sql`SELECT id FROM signals WHERE profile_id = ${mind}`).toHaveLength(0);
  });

  it.each([false, true])("excludes unverified legacy context, match targets and suppression (dismissed=%s)", async (dismissed) => {
    const { mind, keep } = await privateReflectionFixture();
    const s = stubs("A public pattern.", 0);
    const [legacy] = await t.sql`INSERT INTO signals (profile_id, statement, status, dismissed_at)
      VALUES (${mind}, 'PRIVATE_SENTINEL carried from old reflection', ${dismissed ? "retired" : "emerging"}, ${dismissed ? new Date().toISOString() : null}) RETURNING id`;
    const vector = await s.embeddingClient.embed("ignored");
    await t.sql`INSERT INTO signal_embeddings (profile_id, signal_id, model, dimensions, input_hash, embedding)
      VALUES (${mind}, ${legacy.id}, ${EMBEDDING_MODEL}, 768, 'legacy', ${JSON.stringify(vector)}::jsonb)`;
    const extract = vi.spyOn(s.provider, "extractSignalCandidates");
    const result = await deriveSignalsForInspiration(
      { inspirationId: keep, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );
    expect(extract.mock.calls[0]![0].existingStatements).toEqual([]);
    expect(result.matchedSignalIds).toEqual([]);
    expect(result.mintedSignalIds).toHaveLength(1);
    const [minted] = await t.sql`SELECT input_policy FROM signals WHERE id = ${result.mintedSignalIds[0]!}`;
    expect(minted.input_policy).toBe("group-public-v1");
    const [unchanged] = await t.sql`SELECT statement, input_policy FROM signals WHERE id = ${legacy.id}`;
    expect(unchanged.statement).toContain("PRIVATE_SENTINEL");
    expect(unchanged.input_policy).toBeNull();
  });

  it("keeps room retrieval unchanged when only private answers change", async () => {
    const { owner, mind, keep } = await privateReflectionFixture();
    const earlier = await keepPublic(owner, "Quiet walks clear my head.");
    await t.sql`INSERT INTO reflections (profile_id, inspiration_id, question, answer)
      VALUES (${owner}, ${earlier}, 'Why?', 'PRIVATE_SENTINEL earlier answer')`;
    const s = stubs("not used", 0);
    const embed = vi.spyOn(s.embeddingClient, "embed").mockImplementation(async (input) => {
      const vector = new Array<number>(768).fill(0);
      vector[input.includes("PRIVATE_SENTINEL") ? 1 : 0] = 1;
      return vector;
    });
    for (const inputScope of ["personal", "public"] as const) {
      await ensureInspirationEmbedding({ profileId: owner, inspirationId: earlier, inputScope, db: t.db, client: s.embeddingClient });
    }
    const extract = vi.spyOn(s.provider, "extractSignalCandidates").mockResolvedValue({ statements: [] });
    const run = () => deriveSignalsForInspiration(
      { inspirationId: keep, reason: "edited", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );
    await run();
    const before = extract.mock.calls[0]![0];
    expect(before.relatedInspirations?.map((row) => row.id)).toEqual([earlier]);
    const calls = embed.mock.calls.length;
    await t.sql`UPDATE reflections SET answer = 'PRIVATE_SENTINEL completely changed answer' WHERE profile_id = ${owner}`;
    await run();
    expect(extract.mock.calls[1]![0]).toEqual(before);
    expect(embed).toHaveBeenCalledTimes(calls);
    // Personal use still receives the answer; privacy does not erase context.
    await ensureInspirationEmbedding({ profileId: owner, inspirationId: keep, db: t.db, client: s.embeddingClient });
    expect(embed.mock.lastCall?.[0]).toContain("PRIVATE_SENTINEL completely changed answer");
  });

  it("inventories legacy risk without exposing content or changing rows", async () => {
    const { owner, group, mind, keep } = await privateReflectionFixture();
    const otherOwner = await seedPerson("Other group");
    const other = await createGroupForProfile(t.db as never, { profileId: otherOwner, name: "Outside scope" });
    const otherMind = await mindOf(other.id);
    const [legacy] = await t.sql`INSERT INTO signals (profile_id, statement, locked_at)
      VALUES (${mind}, 'PRIVATE_SENTINEL legacy statement', now()) RETURNING id`;
    await t.sql`INSERT INTO signals (profile_id, statement) VALUES (${mind}, 'Another unverified statement'), (${otherMind}, 'Outside scope')`;
    await t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${mind}, ${owner}, ${legacy.id}, ${keep})`;
    const before = await t.sql`SELECT * FROM signals ORDER BY id`;
    const report = await buildGroupInputImpactReport(t.sql, group.id);
    expect(report.mode).toBe("read_only");
    expect(report.unverifiedSignals.total).toBe(2);
    expect(report.unverifiedSignals.records.find((r) => r.id === legacy.id)).toMatchObject({
      human_edited: true, has_current_reflection_on_evidence: true,
    });
    expect(JSON.stringify(report)).not.toContain("PRIVATE_SENTINEL");
    expect(JSON.stringify(report)).not.toContain(otherMind);
    expect(await t.sql`SELECT * FROM signals ORDER BY id`).toEqual(before);
    const limited = await buildGroupInputImpactReport(t.sql, group.id, 1);
    expect(limited.unverifiedSignals).toMatchObject({ total: 2, truncated: true });
    expect(limited.unverifiedSignals.records).toHaveLength(1);
  });

  it("converges two members' keeps onto one room signal with two voices under it", async () => {
    const ari = await seedPerson("Ari");
    const bo = await seedPerson("Bo");
    const group = await createGroupForProfile(t.db as never, {
      profileId: ari,
      name: "the walking room",
    });
    const joined = await joinGroupByCode(t.db as never, { profileId: bo, joinCode: group.joinCode });
    expect(joined.ok).toBe(true);
    const mind = await mindOf(group.id);

    const ariKeep = await keepPublic(ari, "walked the reservoir instead of the standup");
    const boKeep = await keepPublic(bo, "cancelled the mixer and walked with one friend");

    const a = stubs("This room keeps choosing walks over meetings.", 0);
    const first = await deriveSignalsForInspiration(
      { inspirationId: ariKeep, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: a.provider, embeddingClient: a.embeddingClient },
    );
    expect(first.status).toBe("derived");
    expect(first.mintedSignalIds, "the first voice mints under the mind").toHaveLength(1);
    expect(first.profileId, "the pass landed on the mind").toBe(mind);

    const b = stubs("We keep choosing walks over meetings.", 0);
    const second = await deriveSignalsForInspiration(
      { inspirationId: boKeep, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: b.provider, embeddingClient: b.embeddingClient },
    );
    expect(second.status).toBe("derived");
    expect(second.mintedSignalIds, "the second voice must not mint a twin").toHaveLength(0);
    expect(second.matchedSignalIds, "it strengthens the first").toEqual(first.mintedSignalIds);

    const signalId = first.mintedSignalIds[0]!;
    const owners = await t.sql`
      SELECT DISTINCT owner_profile_id AS owner FROM signal_evidence
      WHERE signal_id = ${signalId} ORDER BY owner`;
    expect(
      owners.map((r) => r.owner).sort(),
      "the evidence names both members — the fact the two-voices gate reads",
    ).toEqual([ari, bo].sort());

    /* and the signal genuinely belongs to the room's mind */
    const [sig] = await t.sql`SELECT profile_id AS p FROM signals WHERE id = ${signalId}`;
    expect(sig!.p).toBe(mind);
  });

  it("keeps the room's pass off the keeper's own wall", async () => {
    const ari = await seedPerson("Ari");
    const group = await createGroupForProfile(t.db as never, {
      profileId: ari,
      name: "the room",
    });
    const mind = await mindOf(group.id);
    const keep = await keepPublic(ari, "a memory read only by the room in this test");

    const s = stubs("A pattern the room saw.", 1);
    await deriveSignalsForInspiration(
      { inspirationId: keep, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );

    const personal = await t.sql`SELECT id FROM signals WHERE profile_id = ${ari}`;
    expect(personal.length, "the room pass minted nothing under the member").toBe(0);
    const groupOwned = await t.sql`SELECT id FROM signals WHERE profile_id = ${mind}`;
    expect(groupOwned.length).toBe(1);
  });

  it("keeps separate public and personal vectors under the capture's owner", async () => {
    const ari = await seedPerson("Ari");
    const group = await createGroupForProfile(t.db as never, {
      profileId: ari,
      name: "the room",
    });
    const mind = await mindOf(group.id);
    const keep = await keepPublic(ari, "one memory, two input scopes");

    const groupPass = stubs("Seen by the room.", 2);
    await deriveSignalsForInspiration(
      { inspirationId: keep, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: groupPass.provider, embeddingClient: groupPass.embeddingClient },
    );
    const personalPass = stubs("Seen by its owner.", 3);
    await deriveSignalsForInspiration(
      { inspirationId: keep, reason: "created" },
      { db: t.db as never, modelProvider: personalPass.provider, embeddingClient: personalPass.embeddingClient },
    );

    const vectors = await t.sql`
      SELECT profile_id AS p, input_scope FROM inspiration_embeddings WHERE inspiration_id = ${keep} ORDER BY input_scope`;
    expect(vectors).toEqual([{ p: ari, input_scope: "personal" }, { p: ari, input_scope: "public" }]);
  });
});
