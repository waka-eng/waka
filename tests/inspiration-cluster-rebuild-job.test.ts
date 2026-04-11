import assert from "node:assert/strict";
import test from "node:test";

import {
  buildClusterRebuildJobPayload,
  buildCountClusterableInspirationsArgs,
  DEFAULT_CLUSTER_REBUILD_DBSCAN_EPSILON,
  DEFAULT_CLUSTER_REBUILD_DBSCAN_MIN_SAMPLES,
  DEFAULT_CLUSTER_REBUILD_TRIGGER_EVERY,
  shouldTriggerClusterRebuild,
} from "../apps/web/src/jobs/inspiration-cluster-rebuild-job.ts";

test("cluster rebuild job exports the Loop 7 DBSCAN constants", () => {
  assert.equal(DEFAULT_CLUSTER_REBUILD_TRIGGER_EVERY, 5);
  assert.equal(DEFAULT_CLUSTER_REBUILD_DBSCAN_EPSILON, 0.25);
  assert.equal(DEFAULT_CLUSTER_REBUILD_DBSCAN_MIN_SAMPLES, 3);
});

test("buildCountClusterableInspirationsArgs scopes the cadence count to non-deleted embedded inspirations for one user", () => {
  assert.deepEqual(
    buildCountClusterableInspirationsArgs("user-clusters"),
    {
      where: {
        deletedAt: null,
        embedding: {
          not: null,
        },
        userId: "user-clusters",
      },
    },
  );
});

test("shouldTriggerClusterRebuild fires only on exact multiples of the configured cadence", () => {
  assert.equal(shouldTriggerClusterRebuild(5), true);
  assert.equal(shouldTriggerClusterRebuild(10), true);
  assert.equal(shouldTriggerClusterRebuild(4), false);
  assert.equal(shouldTriggerClusterRebuild(9), false);
});

test("buildClusterRebuildJobPayload normalizes the user id and optional trigger inspiration id", () => {
  assert.deepEqual(
    buildClusterRebuildJobPayload({
      triggerInspirationId: "  insp-trigger  ",
      userId: "  user-clusters  ",
    }),
    {
      jobType: "cluster_rebuild",
      triggerInspirationId: "insp-trigger",
      userId: "user-clusters",
    },
  );
});
