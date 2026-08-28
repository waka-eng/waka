/**
 * A ROOM'S MIND IS A PROFILE, AND ITS EVIDENCE CAN BORROW A MEMBER'S GROUND.
 *
 * Founder ruling, 2026-08-24: "that room should create signals based on
 * x+y+z" — the pooled public memories of its members. Everything at layer 2
 * is keyed to a profile through composite foreign keys, so the room's mind IS
 * a profile (`type = 'group'`, migration 0024/0025), and `signal_evidence`
 * grew `owner_profile_id` so a room-owned signal can cite a member-owned
 * memory without loosening the tenancy net.
 *
 * Every claim here is a constraint fact — CHECKs, composite FKs, cascades —
 * so only a real database can prove them. The four load-bearing ones:
 *
 *   1. THE MIND'S SHAPE IS PINNED BOTH WAYS. A group profile without a room,
 *      a group profile with an account, and a human profile with a room are
 *      all unstorable — `profiles_mind_shape_check` — and a second mind for
 *      the same room is refused by the unique index.
 *
 *   2. THE BORROWED GROUND IS LAWFUL AND NOTHING ELSE IS. An evidence row
 *      may pair a room-mind signal with a member's inspiration through
 *      `owner_profile_id` — and a row whose stated owner does not hold the
 *      inspiration is refused by Postgres, exactly as before the split.
 *
 *   3. THE ROOM TAKES ITS MIND WITH IT. Deleting the group cascades through
 *      `profiles.group_id` to the mind, its signals, and their evidence.
 *
 *   4. A MEMBER'S MEMORY LEAVES ON ITS OWN TERMS. Deleting the member's
 *      inspiration cascades through the owner-keyed FK and takes only the
 *      evidence rows that cited it; the room's signal row survives.
 *
 * WHAT THIS MOCKS, AND WHY: nothing. Constraints do not exist in a mocked
 * query builder.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createGroupForProfile } from "../routes/groups-membership.js";

let t: TestDatabase;
let seq = 0;

async function seedPerson(name: string): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`room-mind-${seq}-${name}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  return p.id as string;
}

async function mindOf(groupId: string): Promise<{ id: string } | undefined> {
  const rows = await t.sql`
    SELECT id FROM profiles WHERE group_id = ${groupId} AND type = 'group'`;
  return rows[0] as { id: string } | undefined;
}

afterAll(async () => {
  await t?.cleanup();
});

describe("the room's mind", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("is born with the room, through the real creation path", async () => {
    const owner = await seedPerson("Ari");
    const group = await createGroupForProfile(t.db as never, {
      profileId: owner,
      name: "the reading circle",
    });
    const mind = await mindOf(group.id);
    expect(mind, "creation writes the mind in the same transaction").toBeDefined();

    /* and the mind never shows up as anyone's account profile */
    const listed = await t.sql`
      SELECT id FROM profiles WHERE account_id IS NOT NULL AND type = 'group'`;
    expect(listed.length).toBe(0);
  });

  it("pins the mind's shape both ways, and one mind per room", async () => {
    const owner = await seedPerson("Ari");
    const group = await createGroupForProfile(t.db as never, {
      profileId: owner,
      name: "the room",
    });
    const [account] = await t.sql`
      SELECT account_id AS id FROM profiles WHERE id = ${owner}`;

    /* a group mind carrying an account */
    await expect(
      t.sql`INSERT INTO profiles (account_id, type, name, group_id)
            VALUES (${account.id}, 'group', 'impostor', ${group.id})`,
    ).rejects.toThrow(/mind_shape_check/);

    /* a group mind belonging to no room */
    await expect(
      t.sql`INSERT INTO profiles (account_id, type, name, group_id)
            VALUES (NULL, 'group', 'orphan', NULL)`,
    ).rejects.toThrow(/mind_shape_check/);

    /* a human wearing a room */
    await expect(
      t.sql`INSERT INTO profiles (account_id, type, name, group_id)
            VALUES (${account.id}, 'human', 'confused', ${group.id})`,
    ).rejects.toThrow(/mind_shape_check/);

    /* a second mind for the same room */
    await expect(
      t.sql`INSERT INTO profiles (account_id, type, name, group_id)
            VALUES (NULL, 'group', 'twin', ${group.id})`,
    ).rejects.toThrow(/unique/i);
  });

  it("lets a room signal cite a member's memory, and refuses a mis-stated owner", async () => {
    const member = await seedPerson("Bo");
    const other = await seedPerson("Cass");
    const group = await createGroupForProfile(t.db as never, {
      profileId: member,
      name: "the room",
    });
    const mind = (await mindOf(group.id))!;

    const [memory] = await t.sql`
      INSERT INTO inspirations (profile_id, text, visibility)
      VALUES (${member}, 'walking beats every meeting I have ever had', 'public')
      RETURNING id`;
    const [signal] = await t.sql`
      INSERT INTO signals (profile_id, statement)
      VALUES (${mind.id}, 'this room keeps choosing walks over meetings')
      RETURNING id`;

    /* the lawful pairing: room-owned signal, member-owned memory */
    await t.sql`
      INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${mind.id}, ${member}, ${signal.id}, ${memory.id})`;

    /* the unlawful ones: an owner who does not hold the memory. A fresh
       memory, because the lawful row above already occupies the
       (signal, inspiration) slot and the unique index would answer first —
       the claim here is about the FK, so the FK must be what speaks. */
    const [second] = await t.sql`
      INSERT INTO inspirations (profile_id, text, visibility)
      VALUES (${member}, 'another walk, another thought', 'public') RETURNING id`;
    await expect(
      t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
            VALUES (${mind.id}, ${other}, ${signal.id}, ${second.id})`,
    ).rejects.toThrow(/inspiration_fk/);

    /* ...and a signal outside the row's own profile, exactly as before: the
       room's signal belongs to the mind, so a member cannot own a row on it.
       A third memory, for the same reason as the second — the pair index
       answers before the FK on an occupied slot, and the FK is the claim. */
    const [third] = await t.sql`
      INSERT INTO inspirations (profile_id, text, visibility)
      VALUES (${member}, 'a third walk entirely', 'public') RETURNING id`;
    await expect(
      t.sql`INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
            VALUES (${member}, ${member}, ${signal.id}, ${third.id})`,
    ).rejects.toThrow(/signal_fk/);
  });

  it("cascades the mind, its signals and their evidence when the room goes", async () => {
    const member = await seedPerson("Bo");
    const group = await createGroupForProfile(t.db as never, {
      profileId: member,
      name: "the room",
    });
    const mind = (await mindOf(group.id))!;
    const [memory] = await t.sql`
      INSERT INTO inspirations (profile_id, text, visibility)
      VALUES (${member}, 'a memory the room read', 'public') RETURNING id`;
    const [signal] = await t.sql`
      INSERT INTO signals (profile_id, statement)
      VALUES (${mind.id}, 'a statement the room grew') RETURNING id`;
    await t.sql`
      INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${mind.id}, ${member}, ${signal.id}, ${memory.id})`;

    await t.sql`DELETE FROM groups WHERE id = ${group.id}`;

    expect((await t.sql`SELECT id FROM profiles WHERE id = ${mind.id}`).length).toBe(0);
    expect((await t.sql`SELECT id FROM signals WHERE id = ${signal.id}`).length).toBe(0);
    expect(
      (await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${signal.id}`).length,
    ).toBe(0);
    /* and the member's own memory is untouched — it was never the room's */
    expect((await t.sql`SELECT id FROM inspirations WHERE id = ${memory.id}`).length).toBe(1);
  });

  it("lets a member's memory leave without taking the room's statement", async () => {
    const member = await seedPerson("Bo");
    const group = await createGroupForProfile(t.db as never, {
      profileId: member,
      name: "the room",
    });
    const mind = (await mindOf(group.id))!;
    const [memory] = await t.sql`
      INSERT INTO inspirations (profile_id, text, visibility)
      VALUES (${member}, 'a memory later deleted', 'public') RETURNING id`;
    const [signal] = await t.sql`
      INSERT INTO signals (profile_id, statement)
      VALUES (${mind.id}, 'a statement that outlives one citation') RETURNING id`;
    await t.sql`
      INSERT INTO signal_evidence (profile_id, owner_profile_id, signal_id, inspiration_id)
      VALUES (${mind.id}, ${member}, ${signal.id}, ${memory.id})`;

    await t.sql`DELETE FROM inspirations WHERE id = ${memory.id}`;

    expect(
      (await t.sql`SELECT id FROM signal_evidence WHERE signal_id = ${signal.id}`).length,
      "the citation goes with the memory it cited",
    ).toBe(0);
    expect(
      (await t.sql`SELECT id FROM signals WHERE id = ${signal.id}`).length,
      "the statement row stands — losing support is a state, not a deletion",
    ).toBe(1);
  });
});
