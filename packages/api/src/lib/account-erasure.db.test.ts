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

/**
 * ── THE SEED IS HAND-WRITTEN NOW, AND THIS IS WHAT THAT COST ───────────────
 *
 * Founder: "방 없애" — remove rooms. The web half went first (405ee4aa); this
 * file is the first thing the API half had to touch, because until today
 * every room row below arrived through `createGroupForProfile`,
 * `joinGroupByCode`, `createGroupProposal`, `affirmGroupProposal` and
 * `declineGroupProposal`, and all five are being deleted. The header of this
 * suite used to be able to say the seed went "through the real membership and
 * proposal functions, so the rows are the ones the product actually writes".
 * It cannot say that any more, and pretending otherwise would be the exact
 * class of gate this whole pass was opened to kill — one that passes by
 * asserting a shape rather than a fact.
 *
 * WHAT WAS TRADED. The seed used to be a composition of product writers: if a
 * writer started stamping a new column, or writing a row in a sixth table,
 * the seed picked it up for free and the sweep below swept it. Now the seed
 * is this file's BELIEF about what those writers wrote, frozen on 2026-10-15,
 * and a belief cannot notice that it has gone stale. A column added to
 * `group_members` tomorrow is a column this seed will never populate, and an
 * unpopulated column passes the sweep for nothing.
 *
 * WHY IT IS STILL THE RIGHT TRADE, AND NOT MERELY THE ONLY ONE LEFT. The
 * guarantee that was lost had already stopped existing: there is no longer
 * any product code that writes these rows, so "the rows the product writes"
 * has no referent to be faithful to. The five tables are KEPT — nothing is
 * dropped, no migration is written, and people's rows stand — so erasure must
 * go on working over them, and a test of erasure over kept tables has to seed
 * them from the only authority still standing, which is the schema. Reading
 * `src/db/schema-groups.ts` and `src/db/schema-group-coedit.ts` and writing
 * the inserts straight at them keeps this suite alive past the deletion
 * instead of dying with it.
 *
 * AND THE STALENESS IS NOT UNGUARDED. Two floors below do the work the lost
 * composition used to: `refs.length >= 15` fails if the discovery query stops
 * finding person-linked columns, and `populated.length >= 6` fails if this
 * hand-written seed stops reaching them. A new not-null column breaks these
 * inserts loudly at the database. What genuinely is not covered any more is a
 * new NULLABLE column on a room table holding a person's id — write that, and
 * add it here.
 *
 * WHAT ALSO WENT, DELIBERATELY. The old seed asserted on its way through that
 * a join succeeded, that two of three carried a proposal, and that one no left
 * a three-seat room's question open. Those were assertions about
 * `joinGroupByCode`, `carriesMajority` and `fallsToDeclines` riding along in
 * an erasure suite, and their own gates went with their code. What is left
 * here asserts only erasure, which is what this file is for. The shapes they
 * produced — one accepted proposal carrying two yeses, one open proposal
 * carrying a yes and a live no — are reproduced exactly, because those shapes
 * are the doctrine's input.
 */

/** Door marks are ordered by `occurred_at`; stamp them rather than race the
    clock, so the ledger assertion reads the arrivals in arrival order. */
let doorTick = 0;
async function markDoor(
  groupId: string,
  profileId: string,
  kind: "joined" | "left" | "removed",
): Promise<void> {
  doorTick += 1;
  await t.sql`
    INSERT INTO group_membership_events (group_id, profile_id, kind, occurred_at)
    VALUES (${groupId}, ${profileId}, ${kind},
            now() - interval '1 day' + (${doorTick} * interval '1 second'))`;
}

/** What `createGroupForProfile` wrote: the room, the owner's seat, the
    arrival mark, and — in the same transaction — the room's own mind, an
    account-less profile that must outlive its founder's erasure. */
async function foundGroup(profileId: string, name: string): Promise<string> {
  seq += 1;
  const [group] = await t.sql`
    INSERT INTO groups (name, join_code, created_by_profile_id)
    VALUES (${name}, ${`SEEDROOM${seq}`}, ${profileId}) RETURNING id`;
  const groupId = group!.id as string;
  await t.sql`
    INSERT INTO group_members (group_id, profile_id, role)
    VALUES (${groupId}, ${profileId}, 'owner')`;
  await markDoor(groupId, profileId, "joined");
  await t.sql`
    INSERT INTO profiles (account_id, type, name, group_id)
    VALUES (NULL, 'group', ${name}, ${groupId})`;
  return groupId;
}

/** What `joinGroupByCode` wrote for a genuine arrival. */
async function seatMember(groupId: string, profileId: string): Promise<void> {
  await t.sql`
    INSERT INTO group_members (group_id, profile_id, role)
    VALUES (${groupId}, ${profileId}, 'member')`;
  await markDoor(groupId, profileId, "joined");
}

/** What a proposal and its answers looked like once the room had settled —
    or not settled — them. `resolved_at` is stamped exactly when the status
    is terminal, the way `affirmGroupProposal` stamped it. */
async function seedProposal(input: {
  groupId: string;
  proposedBy: string;
  body: string;
  status: "open" | "accepted" | "declined";
  stances: Array<{ profileId: string; stance: "affirmed" | "declined" }>;
}): Promise<string> {
  const [proposal] = await t.sql`
    INSERT INTO group_top_of_mind_proposals
      (group_id, proposed_by_profile_id, kind, status, body, resolved_at)
    VALUES (${input.groupId}, ${input.proposedBy}, 'add_entry', ${input.status},
            ${input.body}, ${input.status === "open" ? null : new Date().toISOString()})
    RETURNING id`;
  const proposalId = proposal!.id as string;
  for (const stance of input.stances) {
    await t.sql`
      INSERT INTO group_top_of_mind_affirmations (proposal_id, profile_id, stance)
      VALUES (${proposalId}, ${stance.profileId}, ${stance.stance})`;
  }
  return proposalId;
}

/** Ari founds the room, Bo joins. */
async function seedGroup() {
  const ari = await seedPerson("Ari");
  const bo = await seedPerson("Bo");
  const groupId = await foundGroup(ari.profileId, "the room");
  await seatMember(groupId, bo.profileId);
  return { groupId, ari, bo };
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

  it("retries a rolled-back worker deadlock without repeating object deletion", async () => {
    const owner = await seedPerson('Busy');
    const transaction = vi.spyOn(t.db, 'transaction');
    transaction.mockRejectedValueOnce(Object.assign(new Error('wrapped query error'), { cause: { code: '40P01' } }));
    const deleteObjects = vi.fn(async () => undefined);
    try {
      await eraseAccount(owner.accountId, { db: t.db as never, deleteAttachmentObjects: deleteObjects });
      expect(transaction).toHaveBeenCalledTimes(2);
      expect(deleteObjects).toHaveBeenCalledTimes(1);
      expect(await t.sql`SELECT id FROM accounts WHERE id = ${owner.accountId}`).toHaveLength(0);
    } finally { transaction.mockRestore(); }
  });

  it("stops after three deadlocks and leaves the account available for retry", async () => {
    const owner = await seedPerson('Still busy');
    const deadlock = Object.assign(new Error('deadlock'), { code: '40P01' });
    const transaction = vi.spyOn(t.db, 'transaction').mockRejectedValue(deadlock);
    try {
      await expect(eraseAccount(owner.accountId, { db: t.db as never, deleteAttachmentObjects: async () => undefined })).rejects.toBe(deadlock);
      expect(transaction).toHaveBeenCalledTimes(3);
      expect(await t.sql`SELECT id FROM accounts WHERE id = ${owner.accountId}`).toHaveLength(1);
    } finally { transaction.mockRestore(); }
  });

  it("keeps the approved record whole — as departed marks — while the person's own stack goes", async () => {
    const g = await seedGroup();
    // A third seat, so one no is a live hand rather than the answer that
    // settles a two-person room (the 0c arithmetic).
    const cy = await seedPerson("Cy");
    await seatMember(g.groupId, cy.profileId);
    const cited = await seedCitedVersion(g.groupId, g.ari.profileId);

    // A settled decision carried (Ari proposed, Bo's yes made two of three,
    // so the room accepted it), and Bo's open ask that Ari has a live no on
    // (one no in a room of three leaves a yes-majority still reachable).
    const settledId = await seedProposal({
      groupId: g.groupId,
      proposedBy: g.ari.profileId,
      body: "what we decided",
      status: "accepted",
      stances: [
        { profileId: g.ari.profileId, stance: "affirmed" },
        { profileId: g.bo.profileId, stance: "affirmed" },
      ],
    });
    const openAskId = await seedProposal({
      groupId: g.groupId,
      proposedBy: g.bo.profileId,
      body: "still being decided",
      status: "open",
      stances: [
        { profileId: g.bo.profileId, stance: "affirmed" },
        { profileId: g.ari.profileId, stance: "declined" },
      ],
    });

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
      WHERE id = ${settledId}`;
    expect(settledRow, "erasure unmade a settled decision").toBeTruthy();
    expect(settledRow!.status).toBe("accepted");
    expect(settledRow!.proposed_by_profile_id).toBeNull();
    const settledStances = await t.sql`
      SELECT profile_id, stance FROM group_top_of_mind_affirmations
      WHERE proposal_id = ${settledId}`;
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
      WHERE proposal_id = ${openAskId}`;
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
    const openAskId = await seedProposal({
      groupId: g.groupId,
      proposedBy: g.ari.profileId,
      body: "still being decided",
      status: "open",
      stances: [{ profileId: g.ari.profileId, stance: "affirmed" }],
    });

    await erase(g.ari.accountId);

    expect(
      await t.sql`SELECT id FROM group_top_of_mind_proposals WHERE id = ${openAskId}`,
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

  /* 60s, not the suite's 20s. The discovery query below joins three
     `information_schema` views and costs ~8s on its own against a
     schema-isolated test database; both cases here were already running
     11-13s at baseline, which left no headroom at all — under a loaded
     machine they tip over and report a TIMEOUT, which reads exactly like
     erasure breaking. Raising the budget does not weaken either gate: the
     floors they assert (>= 15 person-linked columns found, >= 6 of them
     populated by the seed) are unchanged. */
  it("finds the references it claims to sweep", async () => {
    /* THE SWEEP'S OWN FLOOR. A discovery query that silently returned nothing
       would sweep an empty list and report a spotless erasure — the most
       convincing possible way to be wrong, and the failure mode every gate
       this session found had in common. If this number ever collapses, the
       query broke, not the schema. */
    const refs = await columnsPointingAtPeople();
    expect(refs.length).toBeGreaterThanOrEqual(15);
    expect(refs.map((r) => `${r.table}.${r.column}`)).toContain("reflections.profile_id");
  }, 60_000);

  it("leaves no column anywhere still holding an erased person's id", async () => {
    /* Seeded against the schema rather than through the room writers, which
       are gone — see the long note above `markDoor` for what that traded and
       why. Plus three columns the doctrine suite never reaches and a person
       would most mind being left behind: their reflections, their agents'
       credentials, and their sessions. */
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
  }, 60_000);
});

/**
 * The mixed-action race, pinned. `top_of_mind_entry_signals` points three
 * ways — entry CASCADE, signal SET NULL, owner SET NULL — and before the
 * pre-clear in eraseAccount, the account cascade could fire a SET NULL
 * update on a citation whose entry was already deleted, re-validate the
 * entry FK, and fail the WHOLE erasure (live, 2026-08-31: an account with
 * a board citing its own signals answered 500 to DELETE /auth/me).
 */
describe("erasing an account whose board cites its own signals", () => {
  it("erases cleanly — citations, board, signals, account all gone", async () => {
    const [account] = await t.sql`
      INSERT INTO accounts (email) VALUES ('cited-board@example.test') RETURNING id`;
    const [profile] = await t.sql`
      INSERT INTO profiles (account_id, type, name)
      VALUES (${account.id}, 'human', 'Cited') RETURNING id`;
    const [signal] = await t.sql`
      INSERT INTO signals (profile_id, statement, status, confidence)
      VALUES (${profile.id}, 'The pattern the board stands on.', 'emerging', 0) RETURNING id`;
    const [tom] = await t.sql`
      INSERT INTO top_of_minds (profile_id, version, status, reason)
      VALUES (${profile.id}, 1, 'live', 'initial') RETURNING id`;
    const [entry] = await t.sql`
      INSERT INTO top_of_mind_entries (top_of_mind_id, type, body, sort_order)
      VALUES (${tom.id}, 'pattern', 'It stands on one thing.', 0) RETURNING id`;
    await t.sql`
      INSERT INTO top_of_mind_entry_signals (entry_id, signal_id, owner_profile_id)
      VALUES (${entry.id}, ${signal.id}, ${profile.id})`;

    await erase(account.id as string);

    expect(await t.sql`SELECT id FROM accounts WHERE id = ${account.id}`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM top_of_mind_entry_signals WHERE entry_id = ${entry.id}`).toHaveLength(0);
    expect(await t.sql`SELECT id FROM signals WHERE id = ${signal.id}`).toHaveLength(0);
  });
});
