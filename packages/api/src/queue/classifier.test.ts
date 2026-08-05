import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: {} as any }));

vi.mock("../lib/db.js", () => ({ getDb: () => state.db }));

import { runClassificationJob } from "./classifier.js";

const row = {
  id: "00000000-0000-4000-8000-000000000010",
  userId: "00000000-0000-4000-8000-000000000001",
  text: "A workshop where unfinished work is normal",
  cluster: "convergence",
};

function classifiedDb() {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: vi.fn(async () => [row]) })),
      })),
    })),
  };
}

function refreshResult(failed = 0) {
  return {
    generated: failed ? 0 : 1,
    existing: 0,
    skipped: 0,
    synthesis: {
      attempted: 1,
      synthesized: failed ? 0 : 1,
      failed,
      skipped: 0,
      failures: [],
    },
    candidates: [],
    notes: [],
  };
}

describe("classification context pipeline", () => {
  beforeEach(() => {
    state.db = classifiedDb();
  });

  it("uses the one packet → graph → top-of-mind path even for an already-classified retry", async () => {
    const ensureEnrichment = vi.fn(async () => "no_url" as const);
    const ensureEmbedding = vi.fn(async () => ({ status: "unchanged" } as any));
    const generateSignalPacket = vi.fn(async () => ({ status: "created_or_updated", packet: {} }));
    const persistMeaningGraph = vi.fn(async () => ({ nodes: [], evidence: [], edges: [] }));
    const refreshTopOfMind = vi.fn(async () => refreshResult());
    const modelProvider = {
      name: "test",
      contextGraphRelationshipJudge: {},
      generateSignalPacket,
    } as any;

    await runClassificationJob(row.id, {
      userId: row.userId,
      modelProvider,
      ensureEnrichment,
      ensureEmbedding,
      persistMeaningGraph: persistMeaningGraph as any,
      refreshTopOfMind: refreshTopOfMind as any,
    });

    expect(ensureEnrichment).toHaveBeenCalledWith(
      state.db,
      expect.objectContaining({ userId: row.userId, signalId: row.id }),
    );
    expect(ensureEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ userId: row.userId, inspirationId: row.id }),
    );
    expect(generateSignalPacket).toHaveBeenCalledWith(
      expect.objectContaining({ userId: row.userId, signalId: row.id }),
    );
    expect(persistMeaningGraph).toHaveBeenCalledWith(
      expect.objectContaining({ userId: row.userId, triggerInspirationId: row.id }),
    );
    expect(refreshTopOfMind).toHaveBeenCalledWith(
      state.db,
      expect.objectContaining({ userId: row.userId, synthesisTrigger: "qualified_cluster" }),
    );
    expect(ensureEnrichment.mock.invocationCallOrder[0]).toBeLessThan(
      ensureEmbedding.mock.invocationCallOrder[0]!,
    );
    expect(ensureEmbedding.mock.invocationCallOrder[0]).toBeLessThan(
      generateSignalPacket.mock.invocationCallOrder[0]!,
    );
    expect(generateSignalPacket.mock.invocationCallOrder[0]).toBeLessThan(
      persistMeaningGraph.mock.invocationCallOrder[0]!,
    );
    expect(persistMeaningGraph.mock.invocationCallOrder[0]).toBeLessThan(
      refreshTopOfMind.mock.invocationCallOrder[0]!,
    );
  });

  it("lets a total synthesis failure reach the durable worker for retry", async () => {
    const modelProvider = {
      name: "test",
      contextGraphRelationshipJudge: {},
      generateSignalPacket: vi.fn(async () => ({ status: "created_or_updated", packet: {} })),
    } as any;

    await expect(
      runClassificationJob(row.id, {
        userId: row.userId,
        modelProvider,
        ensureEnrichment: vi.fn(async () => "no_url" as const),
        ensureEmbedding: vi.fn(async () => ({ status: "unchanged" } as any)),
        persistMeaningGraph: vi.fn(async () => ({ nodes: [], evidence: [], edges: [] })) as any,
        refreshTopOfMind: vi.fn(async () => refreshResult(1)) as any,
      }),
    ).rejects.toThrow("Top-of-mind synthesis did not complete");
  });
});
