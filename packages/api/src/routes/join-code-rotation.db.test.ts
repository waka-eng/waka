/**
 * REMOVAL RE-KEYS THE DOOR; LEAVING DOES NOT.
 *
 * Deleting a `group_members` row ended the person's access to nothing. The
 * invite link carries a join code, the code never expires, and joining asks
 * only whether the code matches — so anyone removed who had seen the link
 * could walk straight back in, indistinguishable from a normal join.
 *
 * The distinction below is the whole rule, and it is why this cannot be a
 * unit test: both halves are a database row changing or not changing, and a
 * mocked query builder would assert only that this file calls what this file
 * calls.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { removeGroupMember, rotateJoinCode } from "./groups.js";

let t: TestDatabase;
let seq = 0;

async function seedGroup(): Promise<{ groupId: string; owner: string; other: string; code: string }> {
  seq += 1;
  const profile = async (name: string) => {
    const [account] = await t.sql`
      INSERT INTO accounts (email) VALUES (${`rot-${seq}-${name}@example.test`}) RETURNING id`;
    const [p] = await t.sql`
      INSERT INTO profiles (account_id, type, name)
      VALUES (${account.id}, 'human', ${name}) RETURNING id`;
    return p.id as string;
  };
  const owner = await profile("Owner");
  const other = await profile("Other");
  const code = `CODE${seq}${"X".repeat(4)}`;
  const [g] = await t.sql`
    INSERT INTO groups (name, join_code, created_by_profile_id)
    VALUES (${`room ${seq}`}, ${code}, ${owner}) RETURNING id, join_code`;
  await t.sql`
    INSERT INTO group_members (group_id, profile_id, role)
    VALUES (${g.id}, ${owner}, 'owner'), (${g.id}, ${other}, 'member')`;
  return { groupId: g.id as string, owner, other, code: g.join_code as string };
}

const codeOf = async (groupId: string) => {
  const [row] = await t.sql`SELECT join_code FROM groups WHERE id = ${groupId}`;
  return row.join_code as string;
};

describe("a removed member cannot walk back in", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });
  afterAll(async () => {
    await t?.sql.end();
  });

  /** THE REGRESSION. Before the fix the code was unchanged and the link worked. */
  it("rotates the join code when someone is removed", async () => {
    const g = await seedGroup();

    const removed = await removeGroupMember(t.db as never, {
      groupId: g.groupId,
      memberProfileId: g.other,
    });

    expect(removed).toBe(true);
    expect(
      await codeOf(g.groupId),
      "the invite link the removed member kept still opens this room",
    ).not.toBe(g.code);
  });

  /**
   * Leaving is voluntary and the person may be asked back, so re-keying on
   * every departure would invalidate the link in everyone else's hands for no
   * security gain. This case exists so that stays a decision rather than
   * drifting into "rotate on any membership change".
   */
  it("does not rotate when the group merely loses a member some other way", async () => {
    const g = await seedGroup();

    await t.sql`
      DELETE FROM group_members
      WHERE group_id = ${g.groupId} AND profile_id = ${g.other}`;

    expect(await codeOf(g.groupId)).toBe(g.code);
  });

  it("gives a different code each time it rotates", async () => {
    const g = await seedGroup();

    const first = await rotateJoinCode(t.db as never, g.groupId);
    const second = await rotateJoinCode(t.db as never, g.groupId);

    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);
  });
});
