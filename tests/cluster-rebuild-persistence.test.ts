import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDeleteEmptyClustersArgs,
  buildFindClusterRebuildClustersArgs,
  buildFindClusterRebuildInspirationsArgs,
  resolveEmptyClusterIds,
} from "../apps/web/src/jobs/cluster-rebuild-persistence.ts";

test("buildFindClusterRebuildInspirationsArgs scopes empty-cluster cleanup to active inspirations for one user", () => {
  assert.deepEqual(buildFindClusterRebuildInspirationsArgs("user-clusters"), {
    select: {
      clusterId: true,
      id: true,
    },
    where: {
      deletedAt: null,
      userId: "user-clusters",
    },
  });
});

test("buildFindClusterRebuildClustersArgs scopes cluster lookup to one user", () => {
  assert.deepEqual(buildFindClusterRebuildClustersArgs("user-clusters"), {
    select: {
      id: true,
    },
    where: {
      userId: "user-clusters",
    },
  });
});

test("resolveEmptyClusterIds returns only clusters left without active inspiration members", () => {
  assert.deepEqual(
    resolveEmptyClusterIds(
      [
        { id: "cluster-empty" },
        { id: "cluster-active" },
        { id: "cluster-still-empty" },
      ],
      [
        {
          clusterId: " cluster-active ",
          id: "insp-active",
        },
        {
          clusterId: null,
          id: "insp-unclustered",
        },
      ],
    ),
    ["cluster-empty", "cluster-still-empty"],
  );
});

test("buildDeleteEmptyClustersArgs deduplicates stale cluster ids before deletion", () => {
  assert.deepEqual(
    buildDeleteEmptyClustersArgs(" user-clusters ", [
      " cluster-empty ",
      "cluster-empty",
      "cluster-still-empty",
    ]),
    {
      where: {
        id: {
          in: ["cluster-empty", "cluster-still-empty"],
        },
        userId: "user-clusters",
      },
    },
  );
});
