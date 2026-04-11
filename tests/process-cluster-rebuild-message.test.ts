import assert from "node:assert/strict";
import test from "node:test";

import {
  createInspirationQueueRecordProcessingRequest,
} from "../apps/web/src/jobs/inspiration-queue.ts";
import type {
  ClusterRebuildPersistenceClient,
  DeleteEmptyClustersArgs,
} from "../apps/web/src/jobs/cluster-rebuild-persistence.ts";
import {
  prepareClusterRebuildWorkerProcessing,
  processClusterRebuildQueueMessage,
} from "../apps/web/src/jobs/process-cluster-rebuild-message.ts";

type SeededCluster = {
  id: string;
  userId: string;
};

type SeededInspiration = {
  clusterId?: string | null;
  deletedAt?: string | null;
  id: string;
  userId: string;
};

class StubClusterRebuildPersistenceClient
  implements ClusterRebuildPersistenceClient
{
  readonly deleteManyCalls: DeleteEmptyClustersArgs[] = [];
  private readonly clusters: readonly SeededCluster[];
  private readonly inspirations: readonly SeededInspiration[];

  constructor(input: {
    clusters: readonly SeededCluster[];
    inspirations: readonly SeededInspiration[];
  }) {
    this.clusters = input.clusters;
    this.inspirations = input.inspirations;
  }

  readonly cluster = {
    deleteMany: async (args: DeleteEmptyClustersArgs) => {
      this.deleteManyCalls.push(args);

      return {
        count: args.where.id.in.length,
      };
    },
    findMany: async (args: { where: { userId: string } }) =>
      this.clusters
        .filter((cluster) => cluster.userId === args.where.userId)
        .map((cluster) => ({
          id: cluster.id,
        })),
  };

  readonly inspiration = {
    findMany: async (args: { where: { deletedAt: null; userId: string } }) =>
      this.inspirations
        .filter((inspiration) => inspiration.userId === args.where.userId)
        .filter((inspiration) => inspiration.deletedAt == null)
        .map((inspiration) => ({
          clusterId: inspiration.clusterId ?? null,
          id: inspiration.id,
        })),
  };
}

function createClusterRebuildRequest(
  payloadOverrides: Partial<{
    triggerInspirationId: string;
    userId: string;
  }> = {},
) {
  const payload = {
    jobType: "cluster_rebuild" as const,
    userId: "user-clusters",
    ...payloadOverrides,
  };
  const record = {
    body: JSON.stringify(payload),
    messageId: "message-cluster-rebuild",
  };

  return {
    ...createInspirationQueueRecordProcessingRequest(record),
    jobType: "cluster_rebuild" as const,
    payload,
  };
}

test("prepareClusterRebuildWorkerProcessing identifies clusters left empty after membership changes", async () => {
  const persistenceClient = new StubClusterRebuildPersistenceClient({
    clusters: [
      {
        id: "cluster-empty",
        userId: "user-clusters",
      },
      {
        id: "cluster-active",
        userId: "user-clusters",
      },
      {
        id: "cluster-other-user",
        userId: "user-other",
      },
    ],
    inspirations: [
      {
        clusterId: "cluster-active",
        id: "insp-active",
        userId: "user-clusters",
      },
      {
        clusterId: "cluster-empty",
        deletedAt: "2026-04-11T00:00:00.000Z",
        id: "insp-deleted",
        userId: "user-clusters",
      },
      {
        clusterId: "cluster-other-user",
        id: "insp-other-user",
        userId: "user-other",
      },
    ],
  });

  const input = await prepareClusterRebuildWorkerProcessing(
    createClusterRebuildRequest(),
    {
      persistenceClient,
    },
  );

  assert.deepEqual(input.emptyClusterIds, ["cluster-empty"]);
});

test("processClusterRebuildQueueMessage deletes only empty clusters for the job user", async () => {
  const persistenceClient = new StubClusterRebuildPersistenceClient({
    clusters: [
      {
        id: "cluster-empty",
        userId: "user-clusters",
      },
      {
        id: "cluster-active",
        userId: "user-clusters",
      },
      {
        id: "cluster-other-user",
        userId: "user-other",
      },
    ],
    inspirations: [
      {
        clusterId: "cluster-active",
        id: "insp-active",
        userId: "user-clusters",
      },
      {
        clusterId: "cluster-other-user",
        id: "insp-other-user",
        userId: "user-other",
      },
    ],
  });

  const input = await processClusterRebuildQueueMessage(
    createClusterRebuildRequest(),
    {
      persistenceClient,
    },
  );

  assert.deepEqual(input.emptyClusterIds, ["cluster-empty"]);
  assert.deepEqual(persistenceClient.deleteManyCalls, [
    {
      where: {
        id: {
          in: ["cluster-empty"],
        },
        userId: "user-clusters",
      },
    },
  ]);
});

test("processClusterRebuildQueueMessage skips deletion when every cluster still has a member", async () => {
  const persistenceClient = new StubClusterRebuildPersistenceClient({
    clusters: [
      {
        id: "cluster-active",
        userId: "user-clusters",
      },
    ],
    inspirations: [
      {
        clusterId: "cluster-active",
        id: "insp-active",
        userId: "user-clusters",
      },
    ],
  });

  const input = await processClusterRebuildQueueMessage(
    createClusterRebuildRequest(),
    {
      persistenceClient,
    },
  );

  assert.deepEqual(input.emptyClusterIds, []);
  assert.deepEqual(persistenceClient.deleteManyCalls, []);
});
