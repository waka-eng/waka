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
import { removeGroupMember, rotateJoinCode } from "./groups-membership.js";
import { listGroupProposals } from "./groups-proposals.js";

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

/* File scope: a describe-scoped afterAll would close the pool before the next
   describe runs, which fails as a connection error and reads as a real bug.

   `cleanup()` rather than `sql.end()` — it drops the schema AND closes the
   socket, where ending the connection alone left `waka_test_<hex>` behind on
   every run. Thirty-one of them had accumulated on the local test database by
   the time this was noticed, which is exactly the failure the helper's own
   documentation warns about: nothing breaks, so nothing tells you. */
afterAll(async () => {
  await t?.cleanup();
});

describe("a removed member cannot walk back in", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
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

/**
 * A second room, hosted by a stranger, that `memberProfileId` is also in, with
 * an open proposal they have affirmed. Nobody here has any relationship to the
 * room the removal under test happens in — that is the entire point of the
 * fixture, so keep the host and the join code distinct from `seedGroup`'s.
 */
async function seedGroupElsewhere(
  memberProfileId: string,
): Promise<{ groupId: string; host: string; proposalId: string }> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`rot-${seq}-host@example.test`}) RETURNING id`;
  const [host] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', 'Host') RETURNING id`;
  const [g] = await t.sql`
    INSERT INTO groups (name, join_code, created_by_profile_id)
    VALUES (${`elsewhere ${seq}`}, ${`ELSE${seq}${"X".repeat(4)}`}, ${host.id}) RETURNING id`;
  await t.sql`
    INSERT INTO group_members (group_id, profile_id, role)
    VALUES (${g.id}, ${host.id}, 'owner'), (${g.id}, ${memberProfileId}, 'member')`;
  const [proposal] = await t.sql`
    INSERT INTO group_top_of_mind_proposals (group_id, proposed_by_profile_id, kind, body, status)
    VALUES (${g.id}, ${host.id}, 'add_entry', 'what they decided', 'open') RETURNING id`;
  await t.sql`
    INSERT INTO group_top_of_mind_affirmations (proposal_id, profile_id)
    VALUES (${proposal.id}, ${host.id}), (${proposal.id}, ${memberProfileId})`;
  return {
    groupId: g.id as string,
    host: host.id as string,
    proposalId: proposal.id as string,
  };
}

/**
 * A REMOVED MEMBER'S VOTE GOES WITH THEM.
 *
 * An affirmation's foreign key is to `profiles`, not to membership, so the
 * denominator followed the room while the numerator did not:
 *
 *   four members, owner opens a proposal (auto-affirmed, 1/4), B affirms
 *   (2/4, not carried), owner removes B, owner affirms again — the duplicate
 *   no-ops but the tally reruns, and 2 against 3 now carries.
 *
 * Two votes, one of them an ejected person's, overruling the two members who
 * never agreed.
 */
describe("a vote is a statement by someone in the room", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("stops counting an affirmation once its author is removed", async () => {
    const g = await seedGroup();
    const [proposal] = await t.sql`
      INSERT INTO group_top_of_mind_proposals (group_id, proposed_by_profile_id, kind, body, status)
      VALUES (${g.groupId}, ${g.owner}, 'add_entry', 'what we decided', 'open') RETURNING id`;
    await t.sql`
      INSERT INTO group_top_of_mind_affirmations (proposal_id, profile_id)
      VALUES (${proposal.id}, ${g.owner}), (${proposal.id}, ${g.other})`;

    const counted = async () => {
      const [row] = await t.sql`
        SELECT count(*)::int AS n
        FROM group_top_of_mind_affirmations a
        INNER JOIN group_members m
          ON m.profile_id = a.profile_id AND m.group_id = ${g.groupId}
        WHERE a.proposal_id = ${proposal.id}`;
      return row.n as number;
    };

    expect(await counted()).toBe(2);

    await removeGroupMember(t.db as never, {
      groupId: g.groupId,
      memberProfileId: g.other,
    });

    expect(
      await counted(),
      "the removed member's vote still counts, against a room that is now smaller",
    ).toBe(1);
  });

  /**
   * THE ROOM THEY LEFT, AND ONLY THAT ROOM.
   *
   * `group_top_of_mind_affirmations` carries no `group_id` — `proposal_id` is
   * its only scoping — so a cleanup keyed on the profile alone reaches every
   * room the person is in. An owner's authority stops at their own door, and
   * this delete walked through everyone else's: rooms they are not in, cannot
   * read, and have never been named in the request.
   *
   * The case above cannot see any of this, and cannot see the delete at all.
   * Its `counted()` INNER JOINs `group_members` for the one group, and the
   * membership row is gone three statements before the affirmation delete
   * runs, so the count falls to 1 whether or not the vote row survives —
   * removing the delete outright leaves it green. This case asks
   * `listGroupProposals` instead, which is the query the proposals endpoint
   * answers with, so what it asserts is what a member actually sees.
   */
  it("takes the vote out of the room they left and leaves the other rooms alone", async () => {
    const here = await seedGroup();
    const elsewhere = await seedGroupElsewhere(here.other);
    const [proposal] = await t.sql`
      INSERT INTO group_top_of_mind_proposals (group_id, proposed_by_profile_id, kind, body, status)
      VALUES (${here.groupId}, ${here.owner}, 'add_entry', 'what we decided', 'open') RETURNING id`;
    await t.sql`
      INSERT INTO group_top_of_mind_affirmations (proposal_id, profile_id)
      VALUES (${proposal.id}, ${here.owner}), (${proposal.id}, ${here.other})`;

    await removeGroupMember(t.db as never, {
      groupId: here.groupId,
      memberProfileId: here.other,
    });

    const [seenHere] = await listGroupProposals(t.db as never, {
      groupId: here.groupId,
      viewerProfileId: here.owner,
    });
    expect(
      seenHere?.stances.map((a) => a.profileId),
      "the removed member's vote is still on the proposal in the room they were removed from",
    ).toEqual([here.owner]);

    const [seenElsewhere] = await listGroupProposals(t.db as never, {
      groupId: elsewhere.groupId,
      viewerProfileId: here.other,
    });
    expect(
      seenElsewhere?.stances.map((a) => a.profileId).sort(),
      "removing them from one room destroyed their vote in another room, whose owner never touched them",
    ).toEqual([elsewhere.host, here.other].sort());
    expect(
      seenElsewhere?.viewerStance,
      "the other room now shows them as never having agreed to something they did agree to",
    ).toBe("affirmed");
  });
});
