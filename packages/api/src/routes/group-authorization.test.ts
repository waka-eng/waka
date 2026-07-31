/**
 * The group authorization boundary, against a real database.
 *
 * `groups.test.ts` and `group-rooms.test.ts` stub the service layer, so their
 * "returns 404 when the caller is not a member" cases assert that a route
 * forwards a `null` a mock just returned. That verifies routing. It does not
 * verify that a non-member is actually turned away, because the functions that
 * decide it — `loadGroupWithMembers`, `assertRoomMembership`,
 * `fetchOwnedSignalPreviews` — never run.
 *
 * These do run them. Every case here is two real users and real rows: the only
 * shape in which "B cannot read A's group" means anything.
 *
 * Deliberately NOT in `vitest.unit.config.ts` — it needs a migrated disposable
 * database, so it belongs to the full suite.
 */

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createTestDatabase, type TestDatabase } from "../../test/helpers/index.js";
import { createUserFixture } from "../../test/fixtures/users.js";
import {
  groupTopOfMindNoteSignals,
  groupTopOfMindNotes,
  inspirationEmbeddings,
  signals,
} from "../db/index.js";
import { loadTriggerSignals } from "../lib/group-top-of-mind-synthesis.js";
import {
  createGroupForUser,
  joinGroupByCode,
  leaveGroup,
  listGroupTopOfMind,
} from "../lib/group-top-of-mind.js";
import {
  addSignalsToGroupRoom,
  createGroupRoomFeedback,
  createGroupRoomForUser,
  listGroupRoomsForUser,
} from "./group-rooms.js";

let harness: TestDatabase;

beforeEach(async () => {
  harness ??= await createTestDatabase();
  await harness.truncateAll();
});

afterAll(async () => {
  await harness?.cleanup();
});

const db = () => harness.db as never;

async function twoUsers() {
  const alice = await createUserFixture(harness.db);
  const bob = await createUserFixture(harness.db);
  return { alice: alice.user, bob: bob.user };
}

async function saveSignal(userId: string, text: string, shared = true, wowScore = 0) {
  const [row] = await harness.db
    .insert(signals)
    .values({ userId, text, kind: "note", sharedToGroups: shared, wowScore })
    .returning({ id: signals.id });
  return row!.id;
}

/** Embeddings gate trigger eligibility, so a trigger test has to write one. */
async function embed(userId: string, signalId: string) {
  await harness.db.insert(inspirationEmbeddings).values({
    userId,
    inspirationId: signalId,
    model: "test-model",
    dimensions: 3,
    embedding: [0.1, 0.2, 0.3],
    inputHash: `hash-${signalId}`,
  });
}

describe("group board membership", () => {
  it("hides a group's board from a non-member", async () => {
    const { alice, bob } = await twoUsers();
    const group = await createGroupForUser(db(), { userId: alice.id, name: "studio" });

    await expect(
      listGroupTopOfMind(db(), { userId: bob.id, groupId: group.id, limit: 5 }),
    ).resolves.toBeNull();

    // And is not merely hiding it from everyone.
    await expect(
      listGroupTopOfMind(db(), { userId: alice.id, groupId: group.id, limit: 5 }),
    ).resolves.not.toBeNull();
  });

  it("opens the board to a member once they join by code", async () => {
    const { alice, bob } = await twoUsers();
    const group = await createGroupForUser(db(), { userId: alice.id, name: "studio" });

    const joined = await joinGroupByCode(db(), { userId: bob.id, joinCode: group.joinCode });
    expect(joined.ok).toBe(true);

    await expect(
      listGroupTopOfMind(db(), { userId: bob.id, groupId: group.id, limit: 5 }),
    ).resolves.not.toBeNull();
  });

  it("rejects an unknown join code without creating anything", async () => {
    const { bob } = await twoUsers();
    const result = await joinGroupByCode(db(), { userId: bob.id, joinCode: "ZZZZZZZZ" });
    expect(result.ok).toBe(false);
  });

  it("takes a leaver's evidence off the board with them", async () => {
    const { alice, bob } = await twoUsers();
    const group = await createGroupForUser(db(), { userId: alice.id, name: "studio" });
    await joinGroupByCode(db(), { userId: bob.id, joinCode: group.joinCode });

    // A note grounded in both members, as a real group note must be.
    const aliceSignal = await saveSignal(alice.id, "the bench in the window");
    const bobSignal = await saveSignal(bob.id, "the hallway that tells you where to stand");
    const [note] = await harness.db
      .insert(groupTopOfMindNotes)
      .values({
        groupId: group.id,
        title: "Rooms that instruct without speaking",
        kind: "recurrence",
        idempotencyKey: "test-key",
        why: "Both collections keep circling architecture as instruction.",
      })
      .returning({ id: groupTopOfMindNotes.id });
    await harness.db.insert(groupTopOfMindNoteSignals).values([
      { groupTopOfMindNoteId: note!.id, signalId: aliceSignal, ownerUserId: alice.id },
      { groupTopOfMindNoteId: note!.id, signalId: bobSignal, ownerUserId: bob.id },
    ]);

    await leaveGroup(db(), { userId: bob.id, groupId: group.id });

    // Bob's previews and name must not survive his membership, and the note
    // itself no longer spans two members so it is not the group's any more.
    const remainingEvidence = await harness.db.select().from(groupTopOfMindNoteSignals);
    expect(remainingEvidence.map((row) => row.ownerUserId)).not.toContain(bob.id);
    const remainingNotes = await harness.db.select().from(groupTopOfMindNotes);
    expect(remainingNotes).toHaveLength(0);
  });
});

describe("synthesis trigger selection", () => {
  it("represents a quiet member even when a prolific one outranks them entirely", async () => {
    // The round-robin interleave exists so one member cannot dominate a pass.
    // A single query with a global score-ordered LIMIT silently defeats it:
    // the quiet member falls outside the window and seeds nothing, so the pass
    // only ever asks "what does A's collection say", never "what do A and B
    // say together" — which is the whole point of a group board.
    const { alice, bob } = await twoUsers();

    for (let i = 0; i < 40; i += 1) {
      const id = await saveSignal(alice.id, `alice signal ${i}`, true, 900 + i);
      await embed(alice.id, id);
    }
    const bobSignal = await saveSignal(bob.id, "the one thing bob saved", true, 1);
    await embed(bob.id, bobSignal);

    const triggers = await loadTriggerSignals(db(), [alice.id, bob.id]);

    expect(triggers.map((t) => t.userId)).toContain(bob.id);
    expect(triggers.some((t) => t.id === bobSignal)).toBe(true);
    // And still bounded rather than reading everything Alice ever saved.
    expect(triggers.length).toBeLessThanOrEqual(24);
  });
});

describe("group room membership", () => {
  it("lists only the caller's rooms", async () => {
    const { alice, bob } = await twoUsers();
    await createGroupRoomForUser(db(), { userId: alice.id, name: "alice's room" });

    await expect(
      listGroupRoomsForUser(db(), { userId: bob.id, limit: 5 }),
    ).resolves.toEqual([]);
    await expect(
      listGroupRoomsForUser(db(), { userId: alice.id, limit: 5 }),
    ).resolves.toHaveLength(1);
  });

  it("refuses to add a signal the caller does not own", async () => {
    const { alice, bob } = await twoUsers();
    const room = await createGroupRoomForUser(db(), { userId: alice.id, name: "room" });
    const bobsSignal = await saveSignal(bob.id, "not alice's to share");

    await expect(
      addSignalsToGroupRoom(db(), {
        userId: alice.id,
        roomId: room.id,
        signalIds: [bobsSignal],
      }),
    ).resolves.toBeNull();
  });

  it("refuses to touch a room the caller is not in", async () => {
    const { alice, bob } = await twoUsers();
    const room = await createGroupRoomForUser(db(), { userId: alice.id, name: "room" });
    const bobsSignal = await saveSignal(bob.id, "bob's own signal");

    await expect(
      addSignalsToGroupRoom(db(), {
        userId: bob.id,
        roomId: room.id,
        signalIds: [bobsSignal],
      }),
    ).resolves.toBeNull();
    await expect(
      createGroupRoomFeedback(db(), { userId: bob.id, roomId: room.id, reaction: "useful" }),
    ).resolves.toBeNull();
  });

  it("honors shareRaw when deciding how much of a signal the room reads", async () => {
    const { alice } = await twoUsers();
    const room = await createGroupRoomForUser(db(), { userId: alice.id, name: "room" });
    const long = "x".repeat(400);
    const rawId = await saveSignal(alice.id, long);
    const previewId = await saveSignal(alice.id, long);

    await addSignalsToGroupRoom(db(), {
      userId: alice.id,
      roomId: room.id,
      signalIds: [rawId],
      shareRaw: true,
    });
    const after = await addSignalsToGroupRoom(db(), {
      userId: alice.id,
      roomId: room.id,
      signalIds: [previewId],
      shareRaw: false,
    });

    const raw = after!.selectedSignals.find((s) => s.signalId === rawId);
    const preview = after!.selectedSignals.find((s) => s.signalId === previewId);

    // The flag was previously inert: both branches truncated, so declining to
    // share raw text shared exactly as much as agreeing to.
    expect(raw!.textPreview).toHaveLength(400);
    expect(preview!.textPreview.length).toBeLessThanOrEqual(140);
  });
});
