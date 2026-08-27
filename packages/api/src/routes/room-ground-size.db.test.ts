/**
 * A ROOM'S GROUND SAYS HOW MUCH IT HOLDS, AND ONLY WHAT IT MAY.
 *
 * `loadGroupField` stops at four hundred. That is a real ceiling and a right
 * one — a room of five people each keeping a couple of hundred public memories
 * is a thousand orbs, past what the ground lays out legibly. Until 2026-08-27
 * nothing said so: the room's door printed the length of what arrived, so a
 * room that had passed the ceiling understated itself and looked like a room
 * that had lost things. `docs/audits/at-scale-2026-08-26.md` measured the same
 * shape on a personal archive, at the higher ceiling of two thousand.
 *
 * The count is the sensitive half. A room's ground is other people's memories,
 * filtered to the ones they marked public — so a total computed with a
 * predicate even slightly wider than the page's would tell a member "there are
 * nine hundred memories here" about memories the room may never draw. It would
 * leak the SIZE of what it correctly refuses to show. That is why the page and
 * the count share one named predicate rather than two copies, and why the
 * cases below seed private memories and a non-member's memories and then
 * demand the total ignore both.
 *
 * A real database, because these are facts about a `count` joined across
 * membership and visibility — the shape a mocked query would simply agree
 * with.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { loadGroupField } from "./groups-field.js";
import { createGroupForProfile, joinGroupByCode } from "./groups-membership.js";

let t: TestDatabase;
let seq = 0;

async function seedPerson(name: string): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`ground-${seq}-${name}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  return p.id as string;
}

/** `howMany` memories kept by one person, all at once, in one statement. */
async function keep(
  profileId: string,
  howMany: number,
  visibility: "public" | "private",
): Promise<void> {
  await t.sql`
    INSERT INTO inspirations (profile_id, text, source, visibility)
    SELECT ${profileId}, 'kept ' || i, 'app', ${visibility}
    FROM generate_series(1, ${howMany}) AS i`;
}

afterAll(async () => {
  await t?.cleanup();
});

describe("what a room's ground says it holds", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("is the length of the page for a room under the ceiling", async () => {
    const owner = await seedPerson("Owner");
    const group = await createGroupForProfile(t.db as never, {
      profileId: owner,
      name: "the room",
    });
    await keep(owner, 12, "public");

    const ground = await loadGroupField(t.db as never, group.id);
    expect(ground.inspirations).toHaveLength(12);
    /* The ordinary room, and the reason the door prints one number for it:
       there is nothing behind the page to be short of. */
    expect(ground.total).toBe(12);
  });

  it("is the whole ground past the ceiling, while the page stays capped", async () => {
    const owner = await seedPerson("Owner");
    const group = await createGroupForProfile(t.db as never, {
      profileId: owner,
      name: "the busy room",
    });
    const other = await seedPerson("Hana");
    const joined = await joinGroupByCode(t.db as never, {
      profileId: other,
      joinCode: group.joinCode,
    });
    expect(joined.ok).toBe(true);

    /* 401 between two members: one past the ceiling is the whole question, and
       two members is what makes it a room's ground rather than an archive. */
    await keep(owner, 200, "public");
    await keep(other, 201, "public");

    const ground = await loadGroupField(t.db as never, group.id);
    expect(
      ground.inspirations,
      "the page is still capped — the ceiling is the point, not the bug",
    ).toHaveLength(400);
    expect(
      ground.total,
      "and the room knows it is standing on more than it was handed",
    ).toBe(401);
  });

  /**
   * PAST THE CEILING, ON PURPOSE, AND THAT IS THE WHOLE OF WHY.
   *
   * The loader short-circuits under the ceiling: when the page came back
   * shorter than the cap, the page IS the ground and counting again would be
   * work done to learn something already known. Correct — and it means a case
   * seeded with five memories never reaches the count at all.
   *
   * The first version of the two cases below did exactly that. Both passed.
   * Both then passed again with the count's predicate deliberately widened to
   * every member row in the room — the precise leak they were written to
   * catch — because neither had ever run the query it was making claims about.
   * A test that cannot reach the code it names is not a weak test; it is a
   * green light wired to nothing.
   *
   * So both seed past four hundred.
   */
  it("counts nothing the page would refuse to draw", async () => {
    const owner = await seedPerson("Owner");
    const group = await createGroupForProfile(t.db as never, {
      profileId: owner,
      name: "the careful room",
    });
    const member = await seedPerson("Hana");
    expect(
      (await joinGroupByCode(t.db as never, { profileId: member, joinCode: group.joinCode })).ok,
    ).toBe(true);
    const stranger = await seedPerson("Nobody");

    await keep(owner, 250, "public");
    await keep(member, 200, "public");
    /* Everything below is invisible to this room, and must be invisible to its
       COUNT as well — a size is information about the things it counts. */
    await keep(owner, 40, "private");
    await keep(member, 40, "private");
    await keep(stranger, 500, "public");

    const ground = await loadGroupField(t.db as never, group.id);
    expect(ground.inspirations).toHaveLength(400);
    expect(
      ground.total,
      "a total wider than the page leaks the size of what the room may not see",
    ).toBe(450);
  });

  it("does not count a member's memories after they leave", async () => {
    const owner = await seedPerson("Owner");
    const group = await createGroupForProfile(t.db as never, {
      profileId: owner,
      name: "the changed room",
    });
    const leaver = await seedPerson("Gone");
    expect(
      (await joinGroupByCode(t.db as never, { profileId: leaver, joinCode: group.joinCode })).ok,
    ).toBe(true);
    await keep(owner, 450, "public");
    await keep(leaver, 60, "public");
    expect((await loadGroupField(t.db as never, group.id)).total).toBe(510);

    await t.sql`
      DELETE FROM group_members
      WHERE group_id = ${group.id} AND profile_id = ${leaver}`;

    const after = await loadGroupField(t.db as never, group.id);
    /* CURRENT members, in both halves. The page has always read membership
       live; a count that read it any other way would report a room holding
       memories it no longer draws. */
    expect(after.inspirations).toHaveLength(400);
    expect(after.total).toBe(450);
  });
});
