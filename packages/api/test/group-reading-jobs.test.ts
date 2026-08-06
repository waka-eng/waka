import { afterEach, describe, expect, it } from "vitest";

import { and, eq, sql } from "drizzle-orm";

import { backgroundJobs, signals } from "../src/db/index.js";
import { getDb } from "../src/lib/db.js";
import {
  createGroupForUser,
  joinGroupByCode,
} from "../src/lib/group-top-of-mind.js";
import {
  enqueueGroupReadingRefresh,
  getGroupReadingGenerationStatus,
} from "../src/lib/queue.js";
import { createUserFixture } from "./fixtures/users.js";
import { createCleanupTracker } from "./helpers/index.js";

const cleanup = createCleanupTracker();

afterEach(async () => {
  await cleanup.flush();
});

describe("durable room reading jobs", () => {
  it("dedupes repeated opens by the room's material fingerprint", async () => {
    const alice = await createUserFixture(getDb());
    const bob = await createUserFixture(getDb());
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);
    const group = await createGroupForUser(getDb(), {
      userId: alice.user.id,
      name: "studio",
    });
    await joinGroupByCode(getDb(), {
      userId: bob.user.id,
      joinCode: group.joinCode,
    });
    const insertedSignals = await getDb()
      .insert(signals)
      .values([
        { userId: alice.user.id, text: "A courtyard that makes strangers linger", sharedToGroups: true },
        { userId: bob.user.id, text: "A workshop organized around an open table", sharedToGroups: true },
      ])
      .returning({ id: signals.id });

    const first = await enqueueGroupReadingRefresh({
      groupId: group.id,
      requestedByUserId: alice.user.id,
      preferredLocale: "en-US",
    });
    const second = await enqueueGroupReadingRefresh({
      groupId: group.id,
      requestedByUserId: alice.user.id,
      preferredLocale: "en-US",
    });
    // Classification and scoring legitimately touch updated_at, but those
    // bookkeeping writes do not change what the room reads and must not fan
    // one capture batch out into redundant model passes.
    await getDb()
      .update(signals)
      .set({ updatedAt: new Date("2026-08-04T12:00:00.000Z") })
      .where(eq(signals.id, insertedSignals[0]!.id));
    const afterBookkeepingUpdate = await enqueueGroupReadingRefresh({
      groupId: group.id,
      requestedByUserId: alice.user.id,
      preferredLocale: "en-US",
    });

    expect(first?.job?.id).toBeTruthy();
    expect(second?.job?.id).toBe(first?.job?.id);
    expect(afterBookkeepingUpdate?.job?.id).toBe(first?.job?.id);
    const rows = await getDb()
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(backgroundJobs)
      .where(
        and(
          eq(backgroundJobs.type, "group_reading_refresh"),
          sql`${backgroundJobs.payload} ->> 'groupId' = ${group.id}`,
        ),
      );
    expect(rows[0]?.count).toBe(1);

    const status = await getGroupReadingGenerationStatus({
      groupId: group.id,
      requestedByUserId: alice.user.id,
      preferredLocale: "en-US",
    });
    expect(status).toMatchObject({
      phase: "processing",
      memberCount: 2,
      sharedSignalCount: 2,
      job: { id: first!.job!.id, type: "group_reading_refresh", status: "pending" },
    });
    const polledStatus = await getGroupReadingGenerationStatus({
      groupId: group.id,
      requestedByUserId: alice.user.id,
      preferredLocale: "en-US",
      ensure: false,
    });
    expect(polledStatus).toMatchObject({
      phase: "processing",
      memberCount: 2,
      sharedSignalCount: 2,
      job: { id: first!.job!.id },
    });
  });

  it("makes a manual reread a real retry and keeps outsiders out", async () => {
    const alice = await createUserFixture(getDb());
    const bob = await createUserFixture(getDb());
    const outsider = await createUserFixture(getDb());
    cleanup.trackUser(alice.user.id);
    cleanup.trackUser(bob.user.id);
    cleanup.trackUser(outsider.user.id);
    const group = await createGroupForUser(getDb(), {
      userId: alice.user.id,
      name: "studio",
    });
    await joinGroupByCode(getDb(), {
      userId: bob.user.id,
      joinCode: group.joinCode,
    });
    await getDb().insert(signals).values({
      userId: alice.user.id,
      text: "A library that feels more like a public living room",
      sharedToGroups: true,
    });

    const automatic = await enqueueGroupReadingRefresh({
      groupId: group.id,
      requestedByUserId: alice.user.id,
      preferredLocale: "en-US",
    });
    const manual = await enqueueGroupReadingRefresh({
      groupId: group.id,
      requestedByUserId: alice.user.id,
      preferredLocale: "en-US",
      reason: "manual",
      force: true,
    });

    expect(manual?.job?.id).toBeTruthy();
    expect(manual?.job?.id).not.toBe(automatic?.job?.id);
    await expect(
      enqueueGroupReadingRefresh({
        groupId: group.id,
        requestedByUserId: outsider.user.id,
      }),
    ).resolves.toBeNull();
  });

  it("explains that a solo room needs another person without queuing model work", async () => {
    const alice = await createUserFixture(getDb());
    cleanup.trackUser(alice.user.id);
    const group = await createGroupForUser(getDb(), {
      userId: alice.user.id,
      name: "solo for now",
    });
    await getDb().insert(signals).values({
      userId: alice.user.id,
      text: "Material waiting for a second collection",
      sharedToGroups: true,
    });

    const status = await getGroupReadingGenerationStatus({
      groupId: group.id,
      requestedByUserId: alice.user.id,
    });

    expect(status).toMatchObject({
      phase: "needs_people",
      memberCount: 1,
      job: null,
    });
  });
});
