/**
 * REFUSAL IS A COUNTED STANCE, NOT A VETO.
 *
 * goal: a-room-you-can-trust, Phase 0c — the founder's ruling, 2026-08-23.
 * Before it, `declineGroupProposal` resolved the proposal on any member's
 * first "not us": one person could kill a sentence for a room of five by
 * pressing first. Now a no is RECORDED beside the yeses, and the proposal
 * falls only when the nos make a yes-majority arithmetically impossible
 * (`fallsToDeclines`: declines * 2 >= members). The author's own decline is
 * the one that still resolves alone — withdrawing your own sentence is not
 * a veto over anyone else.
 *
 * These are tally-against-live-membership facts — upserts on a unique index,
 * counts joined to current members, status transitions guarded on `open` —
 * so only a real database can prove them. Every act goes through the real
 * production functions.
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createGroupForProfile, joinGroupByCode } from "./groups-membership.js";
import {
  affirmGroupProposal,
  createGroupProposal,
  declineGroupProposal,
} from "./groups-proposals.js";

let t: TestDatabase;
let seq = 0;

async function seedPerson(name: string): Promise<string> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`room-decl-${seq}-${name}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  return p.id as string;
}

/** A room of `size` people seated through the real membership functions. */
async function seedGroup(size: number): Promise<{ groupId: string; people: string[] }> {
  const people: string[] = [];
  for (let i = 0; i < size; i += 1) people.push(await seedPerson(`P${i}`));
  const group = await createGroupForProfile(t.db as never, {
    profileId: people[0]!,
    name: "the room",
  });
  for (const person of people.slice(1)) {
    const joined = await joinGroupByCode(t.db as never, {
      profileId: person,
      joinCode: group.joinCode,
    });
    expect(joined.ok).toBe(true);
  }
  return { groupId: group.id, people };
}

async function openProposal(groupId: string, byProfileId: string): Promise<string> {
  const created = await createGroupProposal(t.db as never, {
    groupId,
    profileId: byProfileId,
    kind: "add_entry",
    body: "We keep choosing walks over meetings.",
  });
  if (!created.ok) throw new Error("seed proposal did not open");
  return created.proposal.id;
}

const statusOf = async (proposalId: string): Promise<string> => {
  const [row] = await t.sql`
    SELECT status FROM group_top_of_mind_proposals WHERE id = ${proposalId}`;
  return row!.status as string;
};

afterAll(async () => {
  await t?.cleanup();
});

describe("the gate: a no is an answer in the record, not a kill switch", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("carries a one-member room when its only member proposes", async () => {
    const g = await seedGroup(1);
    const created = await createGroupProposal(t.db as never, {
      groupId: g.groupId,
      profileId: g.people[0]!,
      kind: "add_entry",
      body: "We keep choosing walks over meetings.",
    });
    expect(created.ok && created.proposal.status).toBe("accepted");
    if (!created.ok) return;
    expect(created.proposal.viewerStance).toBe("affirmed");
    expect(await statusOf(created.proposal.id)).toBe("accepted");
  });

  it("keeps a four-person proposal open through one no, and closes it on the second", async () => {
    const g = await seedGroup(4);
    const proposalId = await openProposal(g.groupId, g.people[0]!);

    const first = await declineGroupProposal(t.db as never, {
      groupId: g.groupId,
      proposalId,
      profileId: g.people[1]!,
    });
    // one no in a room of four leaves two yeses still reachable —
    // resolving here would be the veto the ruling removed
    expect(
      first.ok && first.proposal.status,
      "one person killed a sentence for a room of four",
    ).toBe("open");
    expect(
      first.ok ? first.proposal.stances : [],
      "the no vanished instead of standing in the record beside the yes",
    ).toContainEqual(
      expect.objectContaining({ profileId: g.people[1], value: "declined" }),
    );
    expect(first.ok ? first.proposal.viewerStance : null).toBe("declined");

    const second = await declineGroupProposal(t.db as never, {
      groupId: g.groupId,
      proposalId,
      profileId: g.people[2]!,
    });
    // two nos of four: the most yeses still reachable is two, and two of
    // four is a tie, which does not carry — the question is settled
    expect(second.ok && second.proposal.status).toBe("declined");
    expect(await statusOf(proposalId)).toBe("declined");
  });

  it("still closes a two-person proposal on the other member's single no — arithmetic, not veto", async () => {
    const g = await seedGroup(2);
    const proposalId = await openProposal(g.groupId, g.people[0]!);

    const answer = await declineGroupProposal(t.db as never, {
      groupId: g.groupId,
      proposalId,
      profileId: g.people[1]!,
    });
    expect(answer.ok && answer.proposal.status).toBe("declined");
  });

  it("lets the author withdraw alone, and records their stance as the no it was", async () => {
    const g = await seedGroup(4);
    const proposalId = await openProposal(g.groupId, g.people[0]!);

    const withdrawn = await declineGroupProposal(t.db as never, {
      groupId: g.groupId,
      proposalId,
      profileId: g.people[0]!,
    });
    expect(withdrawn.ok && withdrawn.proposal.status).toBe("declined");
    expect(
      withdrawn.ok ? withdrawn.proposal.stances : [],
      "the settled row shows an author still backing a sentence the record says was turned down",
    ).toContainEqual(
      expect.objectContaining({ profileId: g.people[0], value: "declined" }),
    );
  });

  it("answering again replaces the answer: a flipped no becomes the yes that carries", async () => {
    const g = await seedGroup(3);
    const proposalId = await openProposal(g.groupId, g.people[0]!);

    const no = await declineGroupProposal(t.db as never, {
      groupId: g.groupId,
      proposalId,
      profileId: g.people[1]!,
    });
    expect(no.ok && no.proposal.status).toBe("open");

    const flipped = await affirmGroupProposal(t.db as never, {
      groupId: g.groupId,
      proposalId,
      profileId: g.people[1]!,
    });
    // proposer's auto-yes plus the flipped yes: two of three carries
    expect(flipped.ok && flipped.accepted).toBe(true);
    expect(
      flipped.ok ? flipped.proposal.stances.filter((s) => s.profileId === g.people[1]) : [],
      "changing your mind must replace the answer, not add a second voice",
    ).toHaveLength(1);
  });

  it("counts only the people still here: a decliner's removal reopens the arithmetic", async () => {
    const { removeGroupMember } = await import("./groups-membership.js");
    const g = await seedGroup(4);
    const proposalId = await openProposal(g.groupId, g.people[0]!);

    const firstNo = await declineGroupProposal(t.db as never, {
      groupId: g.groupId,
      proposalId,
      profileId: g.people[1]!,
    });
    expect(firstNo.ok && firstNo.proposal.status).toBe("open");

    // removal withdraws their live hand (the 0a rule); the room is three now
    expect(
      await removeGroupMember(t.db as never, {
        groupId: g.groupId,
        memberProfileId: g.people[1]!,
      }),
    ).toBe(true);

    // in the room as it is NOW — three people — a single no leaves two
    // yeses reachable, so this second no must not settle anything
    const after = await declineGroupProposal(t.db as never, {
      groupId: g.groupId,
      proposalId,
      profileId: g.people[2]!,
    });
    expect(
      after.ok && after.proposal.status,
      "a departed member's no still counted against the room as it is now",
    ).toBe("open");
  });
});
