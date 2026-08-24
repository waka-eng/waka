/**
 * THE ONE SWITCH TURNS BOTH WAYS.
 *
 * Sharing, by the founder's ruling of 2026-08-24, is not a verb: it is a
 * memory being public. A public keep stands on the ground of every room its
 * keeper belongs to, and the room distils from that pooled ground. The
 * ruling was implemented in one direction only — turning the switch ON fanned
 * a memory out to every room, and turning it OFF did nothing at all. The
 * memory kept its voice under the room's statement, kept counting toward the
 * two-voices gate, and kept its keeper's name printed on the wall as a
 * contributor, for as long as the room existed.
 *
 * This file holds the other direction. Three facts:
 *
 *   1. A MEMORY TURNED PRIVATE TAKES ITS VOICE BACK. The room's statement
 *      drops to one voice and stops being served — not deleted, not retired,
 *      simply no longer standing on enough ground to wear the room's name.
 *
 *   2. TURNING IT PUBLIC AGAIN PUTS THE VOICE BACK, with no re-derivation.
 *      This is why the withdrawal reads visibility at serve time instead of
 *      deleting evidence rows: a delete would make the switch one-way in the
 *      other direction, and the founder's law is that fading never deletes.
 *
 *   3. A ROOM PASS RE-READS THE SWITCH IT WAS ENQUEUED ON. The fan-out
 *      checks visibility when it enqueues; the job then waits in a queue, and
 *      the keeper can turn the memory private inside that gap. The worker
 *      refuses rather than deriving a private memory into a room.
 *
 * WHAT THIS MOCKS, AND WHY: the model provider and the embedding client — the
 * two network edges — with deterministic vectors, exactly as the other
 * derivation contract suites do. The database, the pipeline and the serve
 * path are real: every claim here is about what a member SEES after somebody
 * else moves a switch, and a mocked query builder sees nothing.
 *
 * The backfill cases mock one thing more: the ENQUEUE. `enqueueDeriveSignals`
 * writes through the process-wide database handle rather than this suite's
 * schema, so a real enqueue would be invisible here — and what those cases
 * actually claim is which memories a room is asked to read, whose they are,
 * and where the ask stops. A recorder holds exactly that and nothing else;
 * the queue's own insert is covered by the queue's own suites.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createGroupForProfile, joinGroupByCode } from "../routes/groups-membership.js";
import { GROUP_JOIN_BACKFILL_LIMIT } from "./signal-derivation-thresholds.js";
import { loadGroupWall } from "../routes/groups-wall.js";
import { deriveSignalsForInspiration } from "./signal-derivation.js";
import type { ModelProvider } from "./model-provider.js";

const EMBEDDING_MODEL = "room-visibility-test-embedding";

let t: TestDatabase;
let seq = 0;

async function seedPerson(name: string): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`room-vis-${seq}-${name}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  return p.id as string;
}

async function keep(
  profileId: string,
  text: string,
  visibility: "public" | "private" = "public",
): Promise<string> {
  const [row] = await t.sql`
    INSERT INTO inspirations (profile_id, text, visibility)
    VALUES (${profileId}, ${text}, ${visibility}) RETURNING id`;
  return row.id as string;
}

async function setVisibility(id: string, visibility: "public" | "private"): Promise<void> {
  await t.sql`UPDATE inspirations SET visibility = ${visibility} WHERE id = ${id}`;
}

async function mindOf(groupId: string): Promise<string> {
  const rows = await t.sql`
    SELECT id FROM profiles WHERE group_id = ${groupId} AND type = 'group'`;
  return rows[0]!.id as string;
}

/** One statement per pass on a fixed vector: same vector converges, an
    orthogonal one mints apart. */
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

/** Records what the room was asked to read, in the order it was asked. */
function recorder() {
  const list: Array<{ profileId: string; inspirationId: string; into: string | undefined }> = [];
  return {
    list,
    deps: {
      enqueueDerive: async (
        profileId: string,
        inspirationId: string,
        _reason: "created" | "edited",
        into?: string,
      ) => {
        list.push({ profileId, inspirationId, into });
        return { enqueued: true } as never;
      },
    },
  };
}

/** Two members, two converging public keeps, one served room statement. */
async function groupWithTwoVoices(): Promise<{
  groupId: string;
  ari: string;
  bo: string;
  ariKeep: string;
  signalId: string;
}> {
  const ari = await seedPerson("Ari");
  const bo = await seedPerson("Bo");
  const group = await createGroupForProfile(t.db as never, {
    profileId: ari,
    name: "the walking room",
  });
  await joinGroupByCode(t.db as never, { profileId: bo, joinCode: group.joinCode });
  const mind = await mindOf(group.id);

  const ariKeep = await keep(ari, "walked the reservoir instead of the standup");
  const boKeep = await keep(bo, "cancelled the mixer and walked with one friend");

  const a = stubs("This room keeps choosing walks over meetings.", 0);
  const first = await deriveSignalsForInspiration(
    { inspirationId: ariKeep, reason: "created", deriveIntoProfileId: mind },
    { db: t.db as never, modelProvider: a.provider, embeddingClient: a.embeddingClient },
  );
  const b = stubs("We keep choosing walks over meetings.", 0);
  await deriveSignalsForInspiration(
    { inspirationId: boKeep, reason: "created", deriveIntoProfileId: mind },
    { db: t.db as never, modelProvider: b.provider, embeddingClient: b.embeddingClient },
  );

  return { groupId: group.id, ari, bo, ariKeep, signalId: first.mintedSignalIds[0]! };
}

afterAll(async () => {
  await t?.cleanup();
});

describe("the one switch, turned back", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("withdraws a voice from the room's wall when its memory goes private, and returns it when it comes back", async () => {
    const { groupId, ariKeep, signalId } = await groupWithTwoVoices();

    const before = await loadGroupWall(t.db as never, groupId);
    expect(before, "two public voices put the statement on the wall").toHaveLength(1);
    expect(before[0]!.signalId).toBe(signalId);
    expect(before[0]!.contributors.map((c) => c.name).sort()).toEqual(["Ari", "Bo"]);

    await setVisibility(ariKeep, "private");

    const during = await loadGroupWall(t.db as never, groupId);
    expect(
      during,
      "one voice is not a room's pattern — the statement stops being served",
    ).toHaveLength(0);

    /* and it is a withdrawal, not a deletion: the statement and its evidence
       both stand, which is what lets the switch turn back */
    const [sig] = await t.sql`
      SELECT status, dismissed_at AS dismissed FROM signals WHERE id = ${signalId}`;
    expect(sig!.status).not.toBe("retired");
    expect(sig!.dismissed).toBeNull();
    const evidence = await t.sql`
      SELECT id FROM signal_evidence WHERE signal_id = ${signalId}`;
    expect(evidence.length, "the record survives the withdrawal").toBe(2);

    await setVisibility(ariKeep, "public");

    const after = await loadGroupWall(t.db as never, groupId);
    expect(after, "the switch turns both ways, with nothing re-derived").toHaveLength(1);
    expect(after[0]!.contributors.map((c) => c.name).sort()).toEqual(["Ari", "Bo"]);
  });

  it("refuses a room pass on a memory that went private while the job waited", async () => {
    const ari = await seedPerson("Ari");
    const group = await createGroupForProfile(t.db as never, {
      profileId: ari,
      name: "the room",
    });
    const mind = await mindOf(group.id);

    /* enqueued while public, run after the keeper changed their mind */
    const memory = await keep(ari, "a memory the keeper thought better of", "public");
    await setVisibility(memory, "private");

    const s = stubs("A pattern the room should never have seen.", 1);
    const result = await deriveSignalsForInspiration(
      { inspirationId: memory, reason: "created", deriveIntoProfileId: mind },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );

    expect(result.status).toBe("not_public");
    expect(result.mintedSignalIds).toHaveLength(0);
    const grown = await t.sql`SELECT id FROM signals WHERE profile_id = ${mind}`;
    expect(grown.length, "the room read nothing").toBe(0);
  });

  it("leaves a personal pass alone at any visibility — your own memory is yours to distil", async () => {
    const ari = await seedPerson("Ari");
    const memory = await keep(ari, "a private memory, distilled for its own keeper", "private");

    const s = stubs("A pattern only its keeper sees.", 2);
    const result = await deriveSignalsForInspiration(
      { inspirationId: memory, reason: "created" },
      { db: t.db as never, modelProvider: s.provider, embeddingClient: s.embeddingClient },
    );

    expect(result.status).toBe("derived");
    expect(result.mintedSignalIds).toHaveLength(1);
  });

  /**
   * THE GROUND A PERSON ARRIVES CARRYING.
   *
   * Fan-out fires when a memory is kept, so a room formed AFTER its members
   * had already kept their memories read none of them: every real user's
   * case, and the reason a seeded demo room rendered with an empty wall.
   * Joining now asks the room to read what the joiner already stands on.
   */
  it("asks the room to read the public ground a member already had when they arrived", async () => {
    const ari = await seedPerson("Ari");
    const bo = await seedPerson("Bo");

    /* kept BEFORE any room exists — the ordinary case */
    const ariKeep = await keep(ari, "walked the reservoir instead of the standup");
    const boKeep = await keep(bo, "cancelled the mixer and walked with one friend");
    await keep(ari, "a private one, which the room must never be asked to read", "private");

    const asks = recorder();
    const group = await createGroupForProfile(
      t.db as never,
      { profileId: ari, name: "the walking room" },
      asks.deps,
    );
    await joinGroupByCode(
      t.db as never,
      { profileId: bo, joinCode: group.joinCode },
      asks.deps,
    );
    const mind = await mindOf(group.id);

    expect(
      asks.list.map((a) => a.inspirationId).sort(),
      "both members' existing public memories are asked for, and only those",
    ).toEqual([ariKeep, boKeep].sort());
    expect(
      [...new Set(asks.list.map((a) => a.into))],
      "every ask lands on the room's mind",
    ).toEqual([mind]);

    /* and each ask is billed to the person whose arrival caused it */
    const payer = new Map(asks.list.map((a) => [a.inspirationId, a.profileId]));
    expect(payer.get(ariKeep), "the maker pays for reading her own ground").toBe(ari);
    expect(payer.get(boKeep), "and the joiner for his").toBe(bo);
  });

  it("asks for nothing on a re-join — a second arrival is not a second reading", async () => {
    const ari = await seedPerson("Ari");
    const bo = await seedPerson("Bo");
    await keep(bo, "one memory, and one ask for it");
    const asks = recorder();
    const group = await createGroupForProfile(
      t.db as never,
      { profileId: ari, name: "the room" },
      asks.deps,
    );

    await joinGroupByCode(t.db as never, { profileId: bo, joinCode: group.joinCode }, asks.deps);
    const afterFirst = asks.list.length;
    await joinGroupByCode(t.db as never, { profileId: bo, joinCode: group.joinCode }, asks.deps);

    expect(afterFirst, "the arrival did ask").toBeGreaterThan(0);
    expect(asks.list.length, "and the re-join asked for nothing more").toBe(afterFirst);
  });

  it("reads the newest memories and stops at the bound", async () => {
    const ari = await seedPerson("Ari");
    /* two past the cap, so the cut is proved rather than assumed */
    const kept: string[] = [];
    for (let i = 0; i < GROUP_JOIN_BACKFILL_LIMIT + 2; i += 1) {
      kept.push(await keep(ari, `memory number ${i}`));
    }

    const asks = recorder();
    await createGroupForProfile(
      t.db as never,
      { profileId: ari, name: "the room" },
      asks.deps,
    );

    expect(asks.list.length, "an archive has no ceiling; the ask does").toBe(
      GROUP_JOIN_BACKFILL_LIMIT,
    );
    const askedFor = new Set(asks.list.map((a) => a.inspirationId));
    expect(
      askedFor.has(kept.at(-1)!),
      "the newest memory is the one a room most needs",
    ).toBe(true);
    expect(
      askedFor.has(kept[0]!),
      "and the oldest is the one it can live without",
    ).toBe(false);
  });
});
