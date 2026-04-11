import assert from "node:assert/strict";
import test from "node:test";

import {
  CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
  buildCreateClusterReassignmentDiscoveryEventArgs,
  buildFindDiscoveryEventInspirationClusterArgs,
  shouldCreateClusterReassignmentDiscoveryEvent,
} from "../apps/web/src/discoveries/cluster-reassignment-persistence.ts";

test("buildFindDiscoveryEventInspirationClusterArgs scopes the lookup to the owning user and excludes soft-deleted inspirations", () => {
  assert.deepEqual(
    buildFindDiscoveryEventInspirationClusterArgs(
      "user_capture",
      "insp_reassigned",
    ),
    {
      select: {
        clusterId: true,
        id: true,
      },
      where: {
        deletedAt: null,
        id: "insp_reassigned",
        userId: "user_capture",
      },
    },
  );
});

test("buildCreateClusterReassignmentDiscoveryEventArgs records the previous and new cluster references under the cluster reassignment event type", () => {
  const createdAt = new Date("2026-04-11T03:00:00.000Z");

  assert.deepEqual(
    buildCreateClusterReassignmentDiscoveryEventArgs({
      createdAt,
      inspirationId: "insp_reassigned",
      newClusterId: "cluster_next",
      previousClusterId: "cluster_previous",
      userId: "user_capture",
    }),
    {
      data: {
        createdAt,
        eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
        inspirationId: "insp_reassigned",
        newClusterId: "cluster_next",
        previousClusterId: "cluster_previous",
        userId: "user_capture",
      },
    },
  );
});

test("shouldCreateClusterReassignmentDiscoveryEvent only returns true for real cluster-to-cluster moves", () => {
  assert.equal(
    shouldCreateClusterReassignmentDiscoveryEvent(
      "cluster_previous",
      "cluster_next",
    ),
    true,
  );
  assert.equal(
    shouldCreateClusterReassignmentDiscoveryEvent(
      "cluster_previous",
      "cluster_previous",
    ),
    false,
  );
  assert.equal(
    shouldCreateClusterReassignmentDiscoveryEvent(null, "cluster_next"),
    false,
  );
  assert.equal(
    shouldCreateClusterReassignmentDiscoveryEvent("cluster_previous", null),
    false,
  );
});
