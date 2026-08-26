/**
 * ERASURE IS THE ONE TRUE DELETE — AND THE ROOM'S RECORD SURVIVES IT.
 *
 * goal: a-room-you-can-trust, Phase 0b Step 2 — the founder's ruling,
 * 2026-08-23: **a sentence the room approved belongs to the room.** Erasing
 * an account removes the person's own stack, their shares, and their NAME —
 * and nothing the room settled. Before the ruling, `eraseAccount` deleted
 * every group artifact the person was ever cited in ("to regenerate clean"):
 * one member erasing themselves unwrote the room's history, the exact class
 * of destruction Phase 0a closed at every other door.
 *
 * What the doctrine says survives, and how, each pinned below:
 *
 *   - versions and entries: untouched rows;
 *   - citations: `owner_profile_id` goes null — a departed mark;
 *   - settled proposals and the stances that carried them: rows stay,
 *     names go null;
 *   - the door's ledger: a `left` mark is written for every seat, then the
 *     name goes null — the room keeps "someone left";
 *   - open asks: withdrawn — an unanswered proposal leaves with its asker,
 *     a live stance goes the way a removed member's does (the 0a rule);
 *   - the room itself: handed to the longest-standing survivor.
 *
 * And what must be GONE: every profile, signal, inspiration, and session the
 * account owned — erasure is not a soft delete. The previous suite mocked
 * the query chain and pinned the old doctrine call-by-call; cascades,
 * set-null FKs, and transaction ordering are database facts, so this one
 * runs the real `eraseAccount` against real Postgres (only the S3 delete is
 * stubbed — those bytes live outside the database).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import {
  createGroupForProfile,
  joinGroupByCode,
} from "../routes/groups-membership.js";
import {
  affirmGroupProposal,
  createGroupProposal,
  declineGroupProposal,
} from "../routes/groups-proposals.js";
import { eraseAccount } from "./account-erasure.js";

let t: TestDatabase;
let seq = 0;

async function seedPerson(name: string): Promise<{ accountId: string; profileId: string }> {
  seq += 1;
  const [account] = await t.sql`
    INSERT INTO accounts (email) VALUES (${`erase-${seq}-${name}@example.test`}) RETURNING id`;
  const [p] = await t.sql`
    INSERT INTO profiles (account_id, type, name)
    VALUES (${account.id}, 'human', ${name}) RETURNING id`;
  return { accountId: account.id as string, profileId: p.id as string };
}

/** Ari founds the room, Bo joins — through the real membership functions. */
async function seedGroup() {
  const ari = await seedPerson("Ari");
  const bo = await seedPerson("Bo");
  const group = await createGroupForProfile(t.db as never, {
    profileId: ari.profileId,
    name: "the room",
  });
  const joined = await joinGroupByCode(t.db as never, {
    profileId: bo.profileId,
    joinCode: group.joinCode,
  });
  expect(joined.ok).toBe(true);
  return { groupId: group.id, ari, bo };
}

/** One live version whose single entry cites Ari's signal. */
async function seedCitedVersion(groupId: string, ownerProfileId: string) {
  const [signal] = await t.sql`
    INSERT INTO signals (profile_id, statement)
    VALUES (${ownerProfileId}, 'keeps choosing depth over breadth') RETURNING id`;
  const [version] = await t.sql`
    INSERT INTO top_of_minds (group_id, version, status, reason)
    VALUES (${groupId}, 1, 'live', 'initial') RETURNING id`;
  const [entry] = await t.sql`
    INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, sort_order)
    VALUES (${version.id}, 'pattern', 'what the room keeps circling', 0) RETURNING id`;
  await t.sql`
    INSERT INTO top_of_mind_entry_signals (entry_id, signal_id, owner_profile_id)
    VALUES (${entry.id}, ${signal.id}, ${ownerProfileId})`;
  return { signalId: signal.id as string, versionId: version.id as string };
}

const erase = (accountId: string) =>
  eraseAccount(accountId, {
    db: t.db as never,
    deleteAttachmentObjects: vi.fn(async () => undefined),
  });

afterAll(async () => {
  await t?.cleanup();
});

describe("the gate: a member's erasure and the room's record, side by side", () => {
  beforeEach(async () => {
    t ??= await createTestDatabase();
    await t.truncateAll();
  });

  it("keeps the approved record whole — as departed marks — while the person's own stack goes", async () => {
    const g = await seedGroup();
    // A third seat, so one no is a live hand rather than the answer that
    // settles a two-person room (the 0c arithmetic).
    const cy = await seedPerson("Cy");
    const [{ join_code }] = await t.sql`SELECT join_code FROM groups WHERE id = ${g.groupId}`;
    expect(
      (await joinGroupByCode(t.db as never, {
        profileId: cy.profileId,
        joinCode: join_code as string,
      })).ok,
    ).toBe(true);
    const cited = await seedCitedVersion(g.groupId, g.ari.profileId);

    // A settled decision carried (Ari proposes, Bo's yes makes two of
    // three), and Bo's open ask that Ari has a live no on.
    const settled = await createGroupProposal(t.db as never, {
      groupId: g.groupId,
      profileId: g.ari.profileId,
      kind: "add_entry",
      body: "what we decided",
    });
    if (!settled.ok) throw new Error("seed proposal did not open");
    const carried = await affirmGroupProposal(t.db as never, {
      groupId: g.groupId,
      proposalId: settled.proposal.id,
      profileId: g.bo.profileId,
    });
    expect(carried.ok && carried.accepted).toBe(true);

    const openAsk = await createGroupProposal(t.db as never, {
      groupId: g.groupId,
      profileId: g.bo.profileId,
      kind: "add_entry",
      body: "still being decided",
    });
    if (!openAsk.ok) throw new Error("seed open proposal did not open");
    const liveNo = await declineGroupProposal(t.db as never, {
      groupId: g.groupId,
      proposalId: openAsk.proposal.id,
      profileId: g.ari.profileId,
    });
    expect(liveNo.ok && liveNo.proposal.status).toBe("open");

    await erase(g.ari.accountId);

    // THE PERSON IS GONE. Not renamed, not dimmed — gone.
    expect(await t.sql`SELECT id FROM accounts WHERE id = ${g.ari.accountId}`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM profiles WHERE id = ${g.ari.profileId}`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM signals WHERE id = ${cited.signalId}`).toHaveLength(0);

    // THE RECORD IS WHOLE. The version and its entry stand; the citation
    // survives as a mark with no signal and no name behind it.
    expect(
      await t.sql`SELECT id FROM top_of_minds WHERE id = ${cited.versionId}`,
      "erasure unwrote a version of the room's record",
    ).toHaveLength(1);
    const [citation] = await t.sql`
      SELECT es.signal_id, es.owner_profile_id
      FROM top_of_mind_entry_signals es
      INNER JOIN top_of_mind_entries e ON e.id = es.entry_id
      WHERE e.top_of_mind_id = ${cited.versionId}`;
    expect(citation, "the citation row itself must survive").toBeTruthy();
    expect(citation!.signal_id).toBeNull();
    expect(
      citation!.owner_profile_id,
      "a departed owner must be a legible absence, not a dangling id",
    ).toBeNull();

    // THE SETTLED DECISION IS HISTORY. The proposal row stays, its author
    // anonymous; both stances stay, one of them anonymous.
    const [settledRow] = await t.sql`
      SELECT status, proposed_by_profile_id FROM group_top_of_mind_proposals
      WHERE id = ${settled.proposal.id}`;
    expect(settledRow, "erasure unmade a settled decision").toBeTruthy();
    expect(settledRow!.status).toBe("accepted");
    expect(settledRow!.proposed_by_profile_id).toBeNull();
    const settledStances = await t.sql`
      SELECT profile_id, stance FROM group_top_of_mind_affirmations
      WHERE proposal_id = ${settled.proposal.id}`;
    expect(
      settledStances,
      "the record of who carried an accepted decision lost rows to erasure",
    ).toHaveLength(2);
    expect(settledStances.map((row) => row.profile_id).sort()).toEqual(
      [null, g.bo.profileId].sort(),
    );

    // LIVE HANDS ARE WITHDRAWN. Bo's open ask survives — it is Bo's — but
    // Ari's live no on it is gone, the way a removed member's would be.
    const openStances = await t.sql`
      SELECT profile_id FROM group_top_of_mind_affirmations
      WHERE proposal_id = ${openAsk.proposal.id}`;
    expect(
      openStances.map((row) => row.profile_id),
      "the erased member kept a live hand in a decision they no longer exist to hold",
    ).toEqual([g.bo.profileId]);

    // THE DOOR TELLS IT. Ari's marks survive nameless: arrived, then left.
    const marks = await t.sql`
      SELECT profile_id, kind FROM group_membership_events
      WHERE group_id = ${g.groupId} ORDER BY occurred_at, id`;
    expect(marks.map((row) => [row.profile_id, row.kind])).toEqual([
      [null, "joined"],
      [g.bo.profileId, "joined"],
      [cy.profileId, "joined"],
      [null, "left"],
    ]);

    // THE ROOM IS BO'S NOW.
    const [seat] = await t.sql`
      SELECT role FROM group_members
      WHERE group_id = ${g.groupId} AND profile_id = ${g.bo.profileId}`;
    expect(seat!.role, "the room was left without an owner").toBe("owner");
  });

  it("withdraws the erased member's own open ask — an unanswered proposal leaves with its asker", async () => {
    const g = await seedGroup();
    const openAsk = await createGroupProposal(t.db as never, {
      groupId: g.groupId,
      profileId: g.ari.profileId,
      kind: "add_entry",
      body: "still being decided",
    });
    if (!openAsk.ok) throw new Error("seed open proposal did not open");

    await erase(g.ari.accountId);

    expect(
      await t.sql`SELECT id FROM group_top_of_mind_proposals WHERE id = ${openAsk.proposal.id}`,
      "an unanswered ask outlived the person asking it",
    ).toHaveLength(0);
  });

  it("erases uploaded objects before the rows that inventory them, deduplicated — and keeps the inventory when that fails", async () => {
    const person = await seedPerson("Solo");
    const [inspiration] = await t.sql`
      INSERT INTO inspirations (profile_id, text)
      VALUES (${person.profileId}, 'a saved page') RETURNING id`;
    await t.sql`
      INSERT INTO attachments (profile_id, inspiration_id, type, url, s3_key)
      VALUES
        (${person.profileId}, ${inspiration.id}, 'link', 'https://example.test/a', 'key-one'),
        (${person.profileId}, ${inspiration.id}, 'link', 'https://example.test/b', 'key-one'),
        (${person.profileId}, ${inspiration.id}, 'link', 'https://example.test/c', 'key-two')`;

    const failing = vi.fn(async () => {
      throw new Error("bucket unreachable");
    });
    await expect(
      eraseAccount(person.accountId, {
        db: t.db as never,
        deleteAttachmentObjects: failing,
      }),
    ).rejects.toThrow("bucket unreachable");
    expect(failing).toHaveBeenCalledWith(["key-one", "key-two"]);
    expect(
      await t.sql`SELECT id FROM accounts WHERE id = ${person.accountId}`,
      "external erasure failed but the database inventory was dropped — the retry has nothing to work from",
    ).toHaveLength(1);

    // The retry, with the bucket back, finishes the same work.
    const working = vi.fn(async () => undefined);
    await eraseAccount(person.accountId, {
      db: t.db as never,
      deleteAttachmentObjects: working,
    });
    expect(working).toHaveBeenCalledWith(["key-one", "key-two"]);
    expect(await t.sql`SELECT id FROM accounts WHERE id = ${person.accountId}`).toHaveLength(0);
  });
});

/**
 * ── AND NOTHING ANYWHERE STILL POINTS AT THEM ──────────────────────────────
 *
 * The suite above pins the DOCTRINE — what survives an erasure, what goes
 * null, what is gone — table by named table, thirteen of them. That is the
 * right way to hold a ruling, and it has one blind spot it cannot see past:
 * it only checks the tables somebody remembered to write down.
 *
 * The schema has thirty-four. The other twenty-one rely on `ON DELETE
 * CASCADE` from `accounts` or `profiles`, which is the correct mechanism and
 * is completely invisible here — a table added next month with a plain
 * `references()` and no cascade would keep a person's rows after they asked
 * to be forgotten, every test above would still pass, and the first anyone
 * would know is a subject-access request.
 *
 * So this asks the database itself. It reads every foreign key that points at
 * `accounts.id` or `profiles.id` out of `information_schema`, and afterwards
 * requires that no such column anywhere still holds an erased id.
 *
 * THE DOCTRINE FALLS OUT OF THAT RATHER THAN FIGHTING IT. "The row stays and
 * the name goes null" satisfies this exactly — a survived row holds NULL
 * there, and NULL is not the erased id. The two checks agree by construction:
 * the named ones say what must remain, this one says nothing may still be
 * attributable.
 *
 * A table that does not exist yet is covered the day it is created.
 */
describe("erasure, swept from the schema rather than from memory", () => {
  /** Every FK column in this schema that points at a person. */
  async function columnsPointingAtPeople(): Promise<Array<{ table: string; column: string }>> {
    const rows = await t.sql`
      SELECT tc.table_name AS table, kcu.column_name AS column
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
       AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = ${t.schemaName}
        AND ccu.table_name IN ('accounts', 'profiles')
      ORDER BY 1, 2`;
    return rows.map((r) => ({ table: String(r.table), column: String(r.column) }));
  }

  it("finds the references it claims to sweep", async () => {
    /* THE SWEEP'S OWN FLOOR. A discovery query that silently returned nothing
       would sweep an empty list and report a spotless erasure — the most
       convincing possible way to be wrong, and the failure mode every gate
       this session found had in common. If this number ever collapses, the
       query broke, not the schema. */
    const refs = await columnsPointingAtPeople();
    expect(refs.length).toBeGreaterThanOrEqual(15);
    expect(refs.map((r) => `${r.table}.${r.column}`)).toContain("reflections.profile_id");
  });

  it("leaves no column anywhere still holding an erased person's id", async () => {
    /* Seeded through the real membership and proposal functions, so the rows
       are the ones the product actually writes — plus three the doctrine
       suite never reaches and a person would most mind being left behind:
       their reflections, their agents' credentials, and their sessions. */
    const founder = await seedGroup();
    const ids = [founder.ari.accountId, founder.ari.profileId];

    const [insp] = await t.sql`
      INSERT INTO inspirations (profile_id, text) VALUES (${founder.ari.profileId}, 'a thing said')
      RETURNING id`;
    await t.sql`
      INSERT INTO reflections (profile_id, inspiration_id, question, answer)
      VALUES (${founder.ari.profileId}, ${insp!.id}, 'what did this stir?', 'something private')`;
    await t.sql`
      INSERT INTO agent_keys (profile_id, token_hash, prefix)
      VALUES (${founder.ari.profileId}, ${"a".repeat(64)}, 'wk_test')`;
    await t.sql`
      INSERT INTO sessions (profile_id, token_hash, expires_at)
      VALUES (${founder.ari.profileId}, ${"b".repeat(64)}, now() + interval '1 day')`;

    const refs = await columnsPointingAtPeople();

    /* WHICH OF THOSE THE SEED ACTUALLY EXERCISED. A column with no rows for
       this person passes the sweep for free, so the count is reported rather
       than assumed: the sweep is only evidence about the tables it had
       something to find. */
    const populated: string[] = [];
    for (const ref of refs) {
      const [before] = await t.sql`
        SELECT count(*)::int AS n FROM ${t.sql(ref.table)}
        WHERE ${t.sql(ref.column)} = ANY(${ids}::uuid[])`;
      if ((before!.n as number) > 0) populated.push(`${ref.table}.${ref.column}`);
    }
    expect(
      populated.length,
      "the seed reached no person-linked column at all, so the sweep below would " +
        "pass over an empty database and prove nothing",
    ).toBeGreaterThanOrEqual(6);

    await eraseAccount(founder.ari.accountId, { db: t.db as never });

    const stillPointing: string[] = [];
    for (const ref of refs) {
      const [after] = await t.sql`
        SELECT count(*)::int AS n FROM ${t.sql(ref.table)}
        WHERE ${t.sql(ref.column)} = ANY(${ids}::uuid[])`;
      if ((after!.n as number) > 0) {
        stillPointing.push(`${ref.table}.${ref.column} (${after!.n} row(s))`);
      }
    }

    expect(
      stillPointing,
      "these columns still hold an erased person's id. Either the table needs " +
        "`onDelete: \"cascade\"` from accounts/profiles, or — if the row is meant " +
        "to survive the way a room's approved text does — the id must be set null " +
        "so what remains is no longer attributable to them.",
    ).toEqual([]);
  });
});
