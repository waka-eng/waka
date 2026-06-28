import { describe, expect, it, vi } from "vitest";

import {
  persistWowMomentForInspirationJudgment,
  type WowMomentJudgment,
} from "./wow-judge.js";

const userId = "00000000-0000-4000-8000-000000000001";
const triggerId = "00000000-0000-4000-8000-000000000101";
const relatedId = "00000000-0000-4000-8000-000000000102";
const otherRelatedId = "00000000-0000-4000-8000-000000000103";

function chainWithLimit<T>(terminal: T) {
  return {
    from: vi.fn(() => ({
      innerJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => terminal) })),
          limit: vi.fn(async () => terminal),
        })),
      })),
      leftJoin: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => terminal) })),
        })),
      })),
      where: vi.fn(() => ({
        limit: vi.fn(async () => terminal),
        orderBy: vi.fn(() => ({ limit: vi.fn(async () => terminal) })),
      })),
    })),
  };
}

function chainWithOrderByResult<T>(terminal: T) {
  return {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        orderBy: vi.fn(async () => terminal),
      })),
    })),
  };
}

function insertChain<T>(returningRows: T) {
  return {
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(() => ({
        returning: vi.fn(async () => returningRows),
      })),
    })),
  };
}

function linkInsertChain() {
  return {
    values: vi.fn(() => ({
      onConflictDoNothing: vi.fn(async () => undefined),
    })),
  };
}

const trigger = {
  id: triggerId,
  userId,
  text: "I want rooms where unfinished ambition can be shown.",
  kind: "note",
  category: 1,
  cluster: "rooms",
  importanceScore: 80,
  wowScore: 70,
  createdAt: new Date("2026-06-01T10:00:00.000Z"),
  updatedAt: new Date("2026-06-01T11:00:00.000Z"),
};
const related = {
  id: relatedId,
  userId,
  text: "Public experiments need real rooms and brave peers.",
  kind: "note",
  category: 1,
  cluster: "rooms",
  importanceScore: 78,
  wowScore: 69,
  createdAt: new Date("2026-06-02T10:00:00.000Z"),
  updatedAt: new Date("2026-06-02T11:00:00.000Z"),
};
const otherRelated = {
  ...related,
  id: otherRelatedId,
  text: "Street-level repair starts when neighbors can see small acts of care.",
  cluster: "repair",
};
const embedding = {
  model: "test-model",
  dimensions: 2,
  embedding: [1, 0],
  inputHash: "hash",
  updatedAt: new Date("2026-06-02T12:00:00.000Z"),
};

function trueJudgment(overrides: Partial<Extract<WowMomentJudgment, { isWowMoment: true }>> = {}): Extract<WowMomentJudgment, { isWowMoment: true }> {
  return {
    isWowMoment: true,
    kind: "bridge",
    title: "Rooms where unfinished ambition is allowed",
    why: "Two signals connect public experiments with rooms where unfinished ambition can be shown.",
    beliefStatement: "rooms where unfinished ambition is allowed",
    relatedInspirationIds: [triggerId, relatedId],
    sourceEvidence: [
      {
        inspirationId: triggerId,
        role: "The atmosphere",
        reason: "Shows the desired room for unfinished ambition.",
      },
      {
        inspirationId: relatedId,
        role: "The practice",
        reason: "Connects public experiments to real rooms.",
      },
    ],
    ...overrides,
  };
}

function existingMoment(overrides: Record<string, unknown> = {}) {
  return {
    id: "00000000-0000-4000-8000-000000000201",
    userId,
    title: "Rooms where unfinished ambition is allowed.",
    kind: "bridge",
    idempotencyKey: "existing-key",
    why: "Two signals connect public experiments with rooms where unfinished ambition can be shown.",
    beliefStatement: "rooms where unfinished ambition is allowed",
    reflectionQuestion: null,
    reflectionGuide: null,
    locale: "en-US",
    wowScore: 80,
    createdAt: new Date("2026-06-03T10:00:00.000Z"),
    updatedAt: new Date("2026-06-03T11:00:00.000Z"),
    ...overrides,
  };
}

function buildDb(params: { duplicateRows?: unknown[]; createdMoment?: unknown }) {
  const links = [
    {
      id: "link-1",
      userId,
      wowMomentId: "00000000-0000-4000-8000-000000000201",
      inspirationId: triggerId,
      role: "The atmosphere",
      reason: "Shows the desired room.",
      sortOrder: 0,
      createdAt: new Date("2026-06-03T10:00:00.000Z"),
      updatedAt: new Date("2026-06-03T10:00:00.000Z"),
    },
    {
      id: "link-2",
      userId,
      wowMomentId: "00000000-0000-4000-8000-000000000201",
      inspirationId: relatedId,
      role: "The practice",
      reason: "Connects the practice.",
      sortOrder: 1,
      createdAt: new Date("2026-06-03T10:00:00.000Z"),
      updatedAt: new Date("2026-06-03T10:00:00.000Z"),
    },
  ];
  const tx = {
    insert: vi.fn().mockReturnValueOnce(insertChain([params.createdMoment])).mockReturnValueOnce(linkInsertChain()),
    select: vi.fn(() => chainWithOrderByResult(links)),
  };
  return {
    tx,
    db: {
      select: vi
        .fn()
        .mockReturnValueOnce(chainWithLimit([{ id: triggerId }]))
        .mockReturnValueOnce(chainWithLimit([{ inspiration: trigger, embedding }]))
        .mockReturnValueOnce(chainWithLimit([
          { inspiration: related, embedding: { ...embedding, embedding: [0.9, 0.1] } },
          { inspiration: otherRelated, embedding: { ...embedding, embedding: [0.1, 0.9] } },
        ]))
        .mockReturnValueOnce(chainWithOrderByResult([]))
        .mockReturnValueOnce(chainWithLimit(params.duplicateRows ?? []))
        .mockReturnValueOnce(chainWithOrderByResult(links)),
      transaction: vi.fn(async (callback) => callback(tx)),
    },
  };
}

describe("persistWowMomentForInspirationJudgment duplicate guard", () => {
  it("returns an existing same-user note for a normalized duplicate without inserting", async () => {
    const duplicate = existingMoment();
    const { db } = buildDb({
      duplicateRows: [
        { moment: duplicate, inspirationId: triggerId },
        { moment: duplicate, inspirationId: relatedId },
      ],
    });

    const result = await persistWowMomentForInspirationJudgment({
      db: db as any,
      userId,
      triggerInspirationId: triggerId,
      judgment: trueJudgment(),
      locale: "en-US",
    });

    expect(result).toMatchObject({ persisted: true, status: "existing", wowMoment: { id: duplicate.id } });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("uses source overlap plus moderate text similarity as a duplicate signal", async () => {
    const duplicate = existingMoment({
      title: "Real rooms keep asking for public experiments",
      beliefStatement: "public experiments need real rooms",
    });
    const { db } = buildDb({
      duplicateRows: [
        { moment: duplicate, inspirationId: triggerId },
        { moment: duplicate, inspirationId: relatedId },
      ],
    });

    const result = await persistWowMomentForInspirationJudgment({
      db: db as any,
      userId,
      triggerInspirationId: triggerId,
      judgment: trueJudgment({
        title: "Public experiments keep asking for real rooms",
        beliefStatement: "public experiments need real rooms",
      }),
      locale: "en-US",
    });

    expect(result.persisted).toBe(true);
    expect(result.persisted ? result.status : undefined).toBe("existing");
  });

  it("creates when no same-user duplicate is returned by the tenant-scoped lookup", async () => {
    const created = existingMoment({
      id: "00000000-0000-4000-8000-000000000301",
      title: "Quiet repair belongs near neighbors",
      kind: "tension",
    });
    const { db, tx } = buildDb({ duplicateRows: [], createdMoment: created });

    const result = await persistWowMomentForInspirationJudgment({
      db: db as any,
      userId,
      triggerInspirationId: triggerId,
      judgment: trueJudgment({
        kind: "tension",
        title: "Quiet repair belongs near neighbors",
        why: "Two signals connect repair with street-level neighbor care.",
        beliefStatement: "quiet repair belongs near neighbors",
        relatedInspirationIds: [triggerId, otherRelatedId],
        sourceEvidence: [
          {
            inspirationId: triggerId,
            role: "The atmosphere",
            reason: "Shows the room where care starts.",
          },
          {
            inspirationId: otherRelatedId,
            role: "The neighbor signal",
            reason: "Adds the street-level repair source.",
          },
        ],
      }),
      locale: "en-US",
    });

    expect(result.persisted).toBe(true);
    expect(result.persisted ? result.status : undefined).toBe("created");
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.insert).toHaveBeenCalled();
  });
});
