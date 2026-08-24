/**
 * THE ROOM'S RECORD SURVIVES ITS MEMBERS.
 *
 * goal: a-room-you-can-trust, Phase 0a. The gate, verbatim: a seeded
 * two-person room performs refresh, proposal acceptance, member removal, and
 * re-join, and every prior version and join/departure mark remains readable
 * afterwards.
 *
 * Three ways the record used to be destroyable, each pinned here:
 *
 *   1. Membership had no history at all. The `group_members` row is the
 *      current seat — deleted on leave and removal, re-created on re-join
 *      with a fresh `createdAt` — so who had been in a room, and when, was a
 *      row that no longer existed. Now every arrival and departure appends a
 *      `group_membership_events` row, and nothing ever edits one.
 *
 *   2. Removal deleted the member's affirmations on EVERY proposal in the
 *      room, settled ones included — destroying the record of who carried an
 *      accepted version. The delete is now scoped to open proposals: a vote
 *      on a live decision goes with the voter; a vote on a settled one is
 *      history.
 *
 *   3. `top_of_mind_entry_signals.signal_id` cascaded on signal delete, so
 *      one owner deleting one signal stripped citation rows out of every
 *      historical version that had ever rested on it. The FK is now
 *      `set null`: the citation survives as the record that the entry rested
 *      on something whose owner has since taken it back.
 *
 * These are database facts — cascades, scoped deletes, append-only rows — so
 * only a real database can prove them. A mocked query builder would assert
 * that this file calls what this file calls.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import {
  createGroupForProfile,
  joinGroupByCode,
  leaveGroup,
  removeGroupMember,
} from "./groups-membership.js";
import { loadGroupTimeline, loadGroupTopOfMind } from "./groups-top-of-mind.js";

let t: TestDatabase;
let seq = 0;

async function seedPerson(name: string): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`room-hist-${seq}-${name}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  return p.id as string;
}

/** A two-person room, seated through the real membership functions so the
    arrival events under test are the ones production writes. */
async function seedGroup(): Promise<{ groupId: string; a: string; b: string }> {
  const a = await seedPerson("Ari");
  const b = await seedPerson("Bo");
  const group = await createGroupForProfile(t.db as never, { profileId: a, name: "the room" });
  const joined = await joinGroupByCode(t.db as never, { profileId: b, joinCode: group.joinCode });
  expect(joined.ok).toBe(true);
  return { groupId: group.id, a, b };
}

/** Two versions of the room's artifact, v1 superseded by v2, each with one
    entry citing `signalId` with per-member attribution — the shape the group
    synthesis writer produces, materialized directly because this test is
    about what SURVIVES, not about the writer (covered elsewhere). */
async function seedVersions(
  groupId: string,
  ownerProfileId: string,
  signalId: string,
): Promise<{ v1: string; v2: string }> {
  const [v1] = await t.sql`
    INSERT INTO top_of_minds (group_id, version, status, reason)
    VALUES (${groupId}, 1, 'superseded', 'initial') RETURNING id`;
  const [v2] = await t.sql`
    INSERT INTO top_of_minds (group_id, version, status, reason)
    VALUES (${groupId}, 2, 'live', 'member_proposal') RETURNING id`;
  await t.sql`
    UPDATE top_of_minds SET replaced_by_id = ${v2.id}, replaced_at = now() WHERE id = ${v1.id}`;
  for (const versionId of [v1.id, v2.id]) {
    const [entry] = await t.sql`
      INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, sort_order)
      VALUES (${versionId}, 'pattern', 'what the room keeps circling', 0) RETURNING id`;
    await t.sql`
      INSERT INTO top_of_mind_entry_signals (entry_id, signal_id, owner_profile_id)
      VALUES (${entry.id}, ${signalId}, ${ownerProfileId})`;
  }
  return { v1: v1.id as string, v2: v2.id as string };
}

const eventKinds = async (groupId: string, profileId: string): Promise<string[]> => {
  const rows = await t.sql`
    SELECT kind FROM group_membership_events
    WHERE group_id = ${groupId} AND profile_id = ${profileId}
    ORDER BY occurred_at, id`;
  return rows.map((row) => row.kind as string);
};

afterAll(async () => {
  await t?.cleanup();
});

describe("the gate: refresh, acceptance, removal, re-join — everything prior stays readable", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("keeps every version, every vote on a settled decision, and every door mark", async () => {
    const g = await seedGroup();

    // Ari's signal feeds the artifact; both versions cite it.
    const [signal] = await t.sql`
      INSERT INTO signals (profile_id, statement)
      VALUES (${g.a}, 'keeps choosing depth over breadth') RETURNING id`;
    const versions = await seedVersions(g.groupId, g.a, signal.id as string);

    // A settled decision, carried by both — and a live one Bo has a hand in.
    const [accepted] = await t.sql`
      INSERT INTO group_top_of_mind_proposals (group_id, proposed_by_profile_id, kind, body, status, resolved_at)
      VALUES (${g.groupId}, ${g.a}, 'add_entry', 'what we decided', 'accepted', now()) RETURNING id`;
    await t.sql`
      INSERT INTO group_top_of_mind_affirmations (proposal_id, profile_id)
      VALUES (${accepted.id}, ${g.a}), (${accepted.id}, ${g.b})`;
    const [open] = await t.sql`
      INSERT INTO group_top_of_mind_proposals (group_id, proposed_by_profile_id, kind, body, status)
      VALUES (${g.groupId}, ${g.a}, 'add_entry', 'still being decided', 'open') RETURNING id`;
    await t.sql`
      INSERT INTO group_top_of_mind_affirmations (proposal_id, profile_id)
      VALUES (${open.id}, ${g.a}), (${open.id}, ${g.b})`;

    // The acts under test, through the real functions.
    expect(
      await removeGroupMember(t.db as never, {
        groupId: g.groupId,
        memberProfileId: g.b,
      }),
    ).toBe(true);
    const [rekeyed] = await t.sql`SELECT join_code FROM groups WHERE id = ${g.groupId}`;
    const rejoined = await joinGroupByCode(t.db as never, {
      profileId: g.b,
      joinCode: rekeyed.join_code as string,
    });
    expect(rejoined.ok).toBe(true);

    // Every prior version remains readable, chain intact.
    const versionRows = await t.sql`
      SELECT id, version, status, replaced_by_id FROM top_of_minds
      WHERE group_id = ${g.groupId} ORDER BY version`;
    expect(
      versionRows.map((row) => [row.version, row.status]),
      "a membership change unmade a version of the room's record",
    ).toEqual([
      [1, "superseded"],
      [2, "live"],
    ]);
    expect(versionRows[0]!.replaced_by_id).toBe(versions.v2);

    // The settled decision still shows who carried it; the live one no longer
    // counts the removed member's hand.
    const votesOn = async (proposalId: string) => {
      const rows = await t.sql`
        SELECT profile_id FROM group_top_of_mind_affirmations
        WHERE proposal_id = ${proposalId} ORDER BY created_at`;
      return rows.map((row) => row.profile_id as string);
    };
    expect(
      (await votesOn(accepted.id as string)).sort(),
      "removal unmade the record of who carried an accepted version",
    ).toEqual([g.a, g.b].sort());
    expect(
      await votesOn(open.id as string),
      "the removed member kept a live hand in a decision they no longer belong to",
    ).toEqual([g.a]);

    // The door's ledger tells the whole story, original arrival included.
    expect(
      await eventKinds(g.groupId, g.b),
      "the room cannot say how it came to hold these people",
    ).toEqual(["joined", "removed", "joined"]);
    expect(await eventKinds(g.groupId, g.a)).toEqual(["joined"]);
  });

  it("keeps the citation rows of every version when a cited signal is deleted", async () => {
    const g = await seedGroup();
    const [signal] = await t.sql`
      INSERT INTO signals (profile_id, statement)
      VALUES (${g.a}, 'keeps choosing depth over breadth') RETURNING id`;
    await seedVersions(g.groupId, g.a, signal.id as string);

    const citationRows = async () => {
      const rows = await t.sql`
        SELECT es.signal_id, es.owner_profile_id
        FROM top_of_mind_entry_signals es
        INNER JOIN top_of_mind_entries e ON e.id = es.entry_id
        INNER JOIN top_of_minds tom ON tom.id = e.top_of_mind_id
        WHERE tom.group_id = ${g.groupId}`;
      return rows;
    };
    expect(await citationRows()).toHaveLength(2);

    await t.sql`DELETE FROM signals WHERE id = ${signal.id}`;

    const after = await citationRows();
    expect(
      after,
      "deleting one signal stripped the citation record out of the room's history",
    ).toHaveLength(2);
    expect(
      after.every((row) => row.signal_id === null),
      "a deleted signal must leave a legible absence, not a dangling id",
    ).toBe(true);
    expect(
      after.every((row) => row.owner_profile_id === g.a),
      "the attribution of who fed the entry outlives the signal itself",
    ).toBe(true);
  });

  it("serves the room's timeline: the chain with entry counts, and the door's marks in order", async () => {
    const g = await seedGroup();
    const [signal] = await t.sql`
      INSERT INTO signals (profile_id, statement)
      VALUES (${g.a}, 'keeps choosing depth over breadth') RETURNING id`;
    await seedVersions(g.groupId, g.a, signal.id as string);
    await removeGroupMember(t.db as never, { groupId: g.groupId, memberProfileId: g.b });
    const [rekeyed] = await t.sql`SELECT join_code FROM groups WHERE id = ${g.groupId}`;
    await joinGroupByCode(t.db as never, {
      profileId: g.b,
      joinCode: rekeyed.join_code as string,
    });

    const timeline = await loadGroupTimeline(t.db as never, g.groupId);
    expect(
      timeline.versions.map((v) => [v.version, v.status, v.entryCount]),
      "the chain must arrive newest first with its entry counts",
    ).toEqual([
      [2, "live", 1],
      [1, "superseded", 1],
    ]);
    expect(
      timeline.doorMarks.map((m) => m.kind),
      "the door's story, oldest first",
    ).toEqual(["joined", "joined", "removed", "joined"]);
  });

  it("opens an old version — the room as it stood, not a date with nothing behind it", async () => {
    /* `loadGroupTimeline` says of itself: "entry counts, never entry bodies —
       an old version's words are read by OPENING it." Nothing could open one.
       The chain was served, the door's marks were served, and the only board a
       caller could read was the live one, so the room's history was a list of
       dates with nothing behind them and the dial had nothing to wind. */
    const g = await seedGroup();
    const [signal] = await t.sql`
      INSERT INTO signals (profile_id, statement)
      VALUES (${g.a}, 'keeps choosing depth over breadth') RETURNING id`;

    const [v1] = await t.sql`
      INSERT INTO top_of_minds (group_id, version, status, reason)
      VALUES (${g.groupId}, 1, 'superseded', 'initial') RETURNING id`;
    const [v2] = await t.sql`
      INSERT INTO top_of_minds (group_id, version, status, reason)
      VALUES (${g.groupId}, 2, 'live', 'member_proposal') RETURNING id`;
    await t.sql`
      UPDATE top_of_minds SET replaced_by_id = ${v2.id}, replaced_at = now() WHERE id = ${v1.id}`;
    for (const [versionId, body] of [
      [v1.id, "what the room read in March"],
      [v2.id, "what the room reads now"],
    ] as const) {
      const [entry] = await t.sql`
        INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, sort_order)
        VALUES (${versionId}, 'pattern', ${body}, 0) RETURNING id`;
      await t.sql`
        INSERT INTO top_of_mind_entry_signals (entry_id, signal_id, owner_profile_id)
        VALUES (${entry.id}, ${signal.id}, ${g.a})`;
    }

    const live = await loadGroupTopOfMind(t.db as never, g.groupId);
    expect(live.topOfMind?.version, "no version named reads the live one").toBe(2);
    expect(live.entries.map((e) => e.body)).toEqual(["what the room reads now"]);

    const then = await loadGroupTopOfMind(t.db as never, g.groupId, { version: 1 });
    expect(then.topOfMind?.version).toBe(1);
    expect(then.topOfMind?.status, "and it is honest about being superseded").toBe(
      "superseded",
    );
    expect(
      then.entries.map((e) => e.body),
      "the words the room actually had up, not today's",
    ).toEqual(["what the room read in March"]);
    expect(
      then.entries[0]?.contributors.map((c) => c.profileId),
      "and who fed it, as it stood",
    ).toEqual([g.a]);
  });

  it("will not serve another room's version to someone who guesses an integer", async () => {
    /* A version number is only unique WITHIN a room. Matching on it alone
       would hand any member of any room the board of a room they have never
       been in, for the price of guessing a small integer — so the group id
       stays in the predicate beside it. */
    const mine = await seedGroup();
    const theirs = await seedGroup();
    const [ours] = await t.sql`
      INSERT INTO top_of_minds (group_id, version, status, reason)
      VALUES (${mine.groupId}, 1, 'live', 'initial') RETURNING id`;
    await t.sql`
      INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, sort_order)
      VALUES (${ours.id}, 'pattern', 'ours', 0)`;
    const [alsoOne] = await t.sql`
      INSERT INTO top_of_minds (group_id, version, status, reason)
      VALUES (${theirs.groupId}, 1, 'live', 'initial') RETURNING id`;
    await t.sql`
      INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, sort_order)
      VALUES (${alsoOne.id}, 'pattern', 'theirs', 0)`;

    const read = await loadGroupTopOfMind(t.db as never, mine.groupId, { version: 1 });
    expect(read.entries.map((e) => e.body)).toEqual(["ours"]);
  });

  it("reads a version the room never had as an empty board, not as the live one", async () => {
    /* The dial can be wound to a moment before this room synthesized
       anything. The honest answer is a blank wall — falling back to the live
       board would print today's sentence over a month that never had one,
       which is the one thing a history must never do. */
    const g = await seedGroup();
    const [live] = await t.sql`
      INSERT INTO top_of_minds (group_id, version, status, reason)
      VALUES (${g.groupId}, 1, 'live', 'initial') RETURNING id`;
    await t.sql`
      INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, sort_order)
      VALUES (${live.id}, 'pattern', 'what the room reads now', 0)`;

    const missing = await loadGroupTopOfMind(t.db as never, g.groupId, { version: 9 });
    expect(missing.topOfMind).toBeNull();
    expect(missing.entries).toEqual([]);
  });

  it("records a voluntary departure as left, not as removal", async () => {
    const g = await seedGroup();

    const left = await leaveGroup(t.db as never, {
      profileId: g.b,
      groupId: g.groupId,
    });
    expect(left.ok).toBe(true);

    expect(await eventKinds(g.groupId, g.b)).toEqual(["joined", "left"]);
  });

  it("does not invent an arrival when a join loses the race to an existing seat", async () => {
    const g = await seedGroup();
    const [current] = await t.sql`SELECT join_code FROM groups WHERE id = ${g.groupId}`;

    // Bo is already seated; joining again must not write a second arrival.
    const again = await joinGroupByCode(t.db as never, {
      profileId: g.b,
      joinCode: current.join_code as string,
    });
    expect(again.ok && again.alreadyMember).toBe(true);

    expect(await eventKinds(g.groupId, g.b)).toEqual(["joined"]);
  });
});
