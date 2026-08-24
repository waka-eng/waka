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
 *   3. THE MEMORY'S OWN VECTOR STAYS WITH ITS OWNER. The layer-1 embedding
 *      written during a room pass belongs to the member (the composite FK
 *      demands it), and a personal pass after a room pass finds it already
 *      there rather than writing a copy under the mind.
 *
 * WHAT THIS MOCKS, AND WHY: the model provider and the embedding client —
 * the two network edges — with deterministic vectors, exactly as the other
 * derivation contract suites do. The database, the pipeline, the locks and
 * every constraint are real; a mocked query builder would prove none of the
 * three facts above.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createGroupForProfile, joinGroupByCode } from "../routes/groups-membership.js";
import { deriveSignalsForInspiration } from "./signal-derivation.js";
import type { ModelProvider } from "./model-provider.js";

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
    embed: async () => {
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

  it("writes the memory's layer-1 vector under its owner, once, whoever derives", async () => {
    const ari = await seedPerson("Ari");
    const group = await createGroupForProfile(t.db as never, {
      profileId: ari,
      name: "the room",
    });
    const mind = await mindOf(group.id);
    const keep = await keepPublic(ari, "one memory, two passes, one vector");

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
      SELECT profile_id AS p FROM inspiration_embeddings WHERE inspiration_id = ${keep}`;
    expect(vectors.length, "one vector, not one per pass").toBe(1);
    expect(vectors[0]!.p, "and it belongs to the memory's owner, never the mind").toBe(ari);
  });
});
