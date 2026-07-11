import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  feedback,
  inspirations,
  users,
  wowMomentInspirations,
  wowMoments,
} from "../db/index.js";
import { getDb } from "./db.js";
import { persistTopOfMindRevision } from "./top-of-mind-persistence.js";
import {
  getTopOfMindNoteForUser,
  updateTopOfMindNoteForUser,
} from "../routes/top-of-mind.js";

const db = getDb();
const userId = "40000000-0000-4000-8000-000000000027";
const otherUserId = "40000000-0000-4000-8000-000000000028";
const evidenceIds = [
  "40000000-0000-4000-8000-000000000031",
  "40000000-0000-4000-8000-000000000032",
  "40000000-0000-4000-8000-000000000033",
  "40000000-0000-4000-8000-000000000034",
] as const;

async function persist(input: {
  semanticKey: string;
  fingerprint: string;
  value: number;
  suffix: string;
  evidenceIds?: string[];
  kind?: "recurrence" | "bridge" | "surprise_bridge" | "tension" | "outlier";
}) {
  return persistTopOfMindRevision({
    db,
    userId,
    semanticKey: input.semanticKey,
    evidenceFingerprint: input.fingerprint,
    evidenceIds: input.evidenceIds ?? [],
    value: input.value,
    createRevision: async (tx) => {
      const [note] = await tx
        .insert(wowMoments)
        .values({
          userId,
          title: `note ${input.suffix}`,
          kind: input.kind ?? "recurrence",
          idempotencyKey: `persistence-test:${input.suffix}`,
          why: "integration test",
          wowScore: input.value,
          semanticKey: input.semanticKey,
          evidenceFingerprint: input.fingerprint,
        })
        .returning();
      if (input.evidenceIds?.length) {
        await tx.insert(wowMomentInspirations).values(
          input.evidenceIds.map((inspirationId, sortOrder) => ({
            userId,
            wowMomentId: note!.id,
            inspirationId,
            role: "Evidence signal",
            reason: "integration test evidence",
            sortOrder,
          })),
        );
      }
      return note!;
    },
  });
}

describe.sequential("top-of-mind persistence", () => {
  beforeAll(async () => {
    await db.insert(users).values([
      { id: userId, email: "top-mind-persistence@test.local" },
      { id: otherUserId, email: "top-mind-persistence-other@test.local" },
    ]);
    await db.insert(inspirations).values(
      evidenceIds.map((id, index) => ({
        id,
        userId,
        text: `persistence evidence ${index + 1}`,
      })),
    );
  });

  afterAll(async () => {
    await db.delete(users).where(eq(users.id, userId));
    await db.delete(users).where(eq(users.id, otherUserId));
  });

  it("serializes exact retries and atomically replaces only a five-point improvement", async () => {
    const created = await persist({
      semanticKey: "same idea",
      fingerprint: "a",
      value: 70,
      suffix: "a",
    });
    const [retryA, retryB] = await Promise.all([
      persist({
        semanticKey: "same idea",
        fingerprint: "a",
        value: 99,
        suffix: "retry-a",
      }),
      persist({
        semanticKey: "same idea",
        fingerprint: "a",
        value: 99,
        suffix: "retry-b",
      }),
    ]);
    expect(retryA.action).toBe("keep_existing");
    expect(retryB.action).toBe("keep_existing");
    expect(retryA.note.id).toBe(created.note.id);

    const kept = await persist({
      semanticKey: "same idea",
      fingerprint: "b",
      value: 74,
      suffix: "b",
    });
    expect(kept.action).toBe("keep_existing");

    const replaced = await persist({
      semanticKey: "same idea",
      fingerprint: "c",
      value: 75,
      suffix: "c",
    });
    expect(replaced.action).toBe("replace");
    const rows = await db
      .select()
      .from(wowMoments)
      .where(eq(wowMoments.userId, userId));
    expect(rows.filter((row) => row.lifecycleStatus === "active")).toHaveLength(
      1,
    );
    expect(rows.find((row) => row.id === created.note.id)).toMatchObject({
      lifecycleStatus: "replaced",
      replacedById: replaced.note.id,
    });

    await expect(
      persist({
        semanticKey: "same idea",
        fingerprint: "a",
        value: 100,
        suffix: "archived-retry",
      }),
    ).rejects.toThrow();
    const activeAfterArchivedRetry = await db
      .select()
      .from(wowMoments)
      .where(eq(wowMoments.userId, userId));
    expect(
      activeAfterArchivedRetry.filter(
        (row) => row.lifecycleStatus === "active",
      ),
    ).toHaveLength(1);
    expect(
      activeAfterArchivedRetry.find(
        (row) => row.lifecycleStatus === "active",
      )?.id,
    ).toBe(replaced.note.id);

    await expect(
      getTopOfMindNoteForUser(db, {
        userId,
        noteId: created.note.id,
      }),
    ).resolves.toBeNull();
    await expect(
      updateTopOfMindNoteForUser(db, {
        userId,
        noteId: created.note.id,
        title: "must not edit archived revisions",
      }),
    ).resolves.toBeNull();
  });

  it("never replaces a pinned active note", async () => {
    const created = await persist({
      semanticKey: "pinned idea",
      fingerprint: "p1",
      value: 40,
      suffix: "p1",
    });
    await db.insert(feedback).values({
      userId,
      targetType: "top_of_mind_note",
      targetId: created.note.id,
      value: "important",
    });
    const result = await persist({
      semanticKey: "pinned idea",
      fingerprint: "p2",
      value: 100,
      suffix: "p2",
    });
    expect(result.action).toBe("blocked_by_pin");
    expect(result.note.id).toBe(created.note.id);

    await db.insert(feedback).values({
      userId,
      targetType: "top_of_mind_note",
      targetId: created.note.id,
      value: "not_true",
    });
    const correctedWhilePinned = await persist({
      semanticKey: "pinned idea",
      fingerprint: "p3",
      value: 100,
      suffix: "p3",
    });
    expect(correctedWhilePinned.action).toBe("blocked_by_pin");

    await db.insert(feedback).values({
      userId,
      targetType: "top_of_mind_note",
      targetId: created.note.id,
      value: "not_important",
    });
    const unpinnedReplacement = await persist({
      semanticKey: "pinned idea",
      fingerprint: "p4",
      value: 100,
      suffix: "p4",
    });
    expect(unpinnedReplacement.action).toBe("replace");
  });

  it("keeps a deleted semantic family suppressed until its evidence grows", async () => {
    const created = await persist({
      semanticKey: "deleted semantic idea",
      fingerprint: "baseline-fingerprint",
      evidenceIds: [...evidenceIds.slice(0, 3)],
      value: 70,
      suffix: "deleted-baseline",
    });
    await db.insert(feedback).values({
      userId,
      targetType: "top_of_mind_note",
      targetId: created.note.id,
      value: "not_true",
    });

    const unchangedFamilyAttempts = await Promise.all([
      persist({
        semanticKey: "deleted semantic idea",
        fingerprint: "reordered-fingerprint",
        evidenceIds: [evidenceIds[2], evidenceIds[0], evidenceIds[1]],
        value: 100,
        suffix: "different-copy-trigger-and-id",
        kind: "surprise_bridge",
      }),
      persist({
        semanticKey: "deleted semantic idea",
        fingerprint: "subset-fingerprint",
        evidenceIds: [evidenceIds[1], evidenceIds[0]],
        value: 100,
        suffix: "different-model-kind",
        kind: "tension",
      }),
    ]);

    expect(unchangedFamilyAttempts.map((result) => result.action)).toEqual([
      "keep_existing",
      "keep_existing",
    ]);
    expect(
      unchangedFamilyAttempts.every((result) => result.note.id === created.note.id),
    ).toBe(true);

    const evolvedAttempts = await Promise.all([
      persist({
        semanticKey: "deleted semantic idea",
        fingerprint: "evolved-fingerprint",
        evidenceIds: [...evidenceIds],
        value: 75,
        suffix: "evolved-a",
      }),
      persist({
        semanticKey: "deleted semantic idea",
        fingerprint: "evolved-fingerprint",
        evidenceIds: [...evidenceIds].reverse(),
        value: 75,
        suffix: "evolved-b",
        kind: "bridge",
      }),
    ]);
    expect(evolvedAttempts.map((result) => result.action).sort()).toEqual([
      "keep_existing",
      "replace",
    ]);

    const familyRows = await db
      .select()
      .from(wowMoments)
      .where(eq(wowMoments.semanticKey, "deleted semantic idea"));
    expect(familyRows).toHaveLength(2);
    expect(familyRows.filter((row) => row.lifecycleStatus === "active")).toHaveLength(
      1,
    );
    const links = await db
      .select()
      .from(wowMomentInspirations)
      .where(eq(wowMomentInspirations.userId, userId));
    expect(
      links.filter((link) => familyRows.some((row) => row.id === link.wowMomentId)),
    ).toHaveLength(7);
  });

  it("rolls back archival when revision creation conflicts", async () => {
    const created = await persist({
      semanticKey: "conflict idea",
      fingerprint: "c1",
      value: 40,
      suffix: "conflict",
    });
    await expect(
      persist({
        semanticKey: "conflict idea",
        fingerprint: "c2",
        value: 100,
        suffix: "conflict",
      }),
    ).rejects.toThrow();
    const [after] = await db
      .select()
      .from(wowMoments)
      .where(eq(wowMoments.id, created.note.id));
    expect(after).toMatchObject({
      lifecycleStatus: "active",
      replacedById: null,
    });
  });

  it("rejects cross-user replacement links and out-of-range scores", async () => {
    const [first, second] = await db
      .insert(wowMoments)
      .values([
        {
          userId,
          title: "first scoped note",
          kind: "recurrence",
          idempotencyKey: "persistence-test:scoped-first",
          why: "integration test",
          wowScore: 50,
        },
        {
          userId: otherUserId,
          title: "other user's note",
          kind: "recurrence",
          idempotencyKey: "persistence-test:scoped-second",
          why: "integration test",
          wowScore: 50,
        },
      ])
      .returning();

    await expect(
      db
        .update(wowMoments)
        .set({
          lifecycleStatus: "replaced",
          replacedAt: new Date(),
          replacedById: second!.id,
        })
        .where(eq(wowMoments.id, first!.id)),
    ).rejects.toThrow();

    await expect(
      db.insert(wowMoments).values({
        userId,
        title: "invalid score",
        kind: "recurrence",
        idempotencyKey: "persistence-test:invalid-score",
        why: "integration test",
        wowScore: 101,
      }),
    ).rejects.toThrow();
  });
});
