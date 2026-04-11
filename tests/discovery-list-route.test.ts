import assert from "node:assert/strict";
import test from "node:test";

import { CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE } from "../apps/web/src/discoveries/cluster-reassignment-persistence.ts";
import type {
  ListDiscoveriesClusterPersistenceArgs,
  ListDiscoveriesEventsPersistenceArgs,
  ListDiscoveriesPersistenceClient,
  ListedDiscoveryClusterRecord,
  ListedDiscoveryEventRecord,
} from "../apps/web/src/discoveries/list-route.ts";
import {
  DEFAULT_LIST_DISCOVERIES_LIMIT,
  LIST_DISCOVERIES_ROUTE_BAD_REQUEST_STATUS,
  LIST_DISCOVERIES_ROUTE_LIMIT_INVALID_ERROR,
  LIST_DISCOVERIES_ROUTE_OK_STATUS,
  LIST_DISCOVERIES_ROUTE_UNAUTHORIZED_ERROR,
  LIST_DISCOVERIES_ROUTE_UNAUTHORIZED_STATUS,
  buildListDiscoveriesClusterPersistenceArgs,
  buildListDiscoveriesEventPersistenceArgs,
  configureListDiscoveriesRouteDependencies,
  handleListDiscoveriesRouteRequest,
  listDiscoveries,
} from "../apps/web/src/discoveries/list-route.ts";

type SeededDiscoveryEvent = {
  createdAt: string;
  eventType: typeof CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE;
  id: string;
  inspiration: {
    id: string;
    rawContent: string;
    sourceType:
      | "AI_CONVERSATION"
      | "CLI_CONVERSATION"
      | "PHOTO"
      | "TEXT_NOTE"
      | "URL_IMPORT"
      | "VOICE_NOTE";
    summary?: string | null;
    title?: string | null;
  };
  newClusterId: string;
  previousClusterId: string;
  userId: string;
};

type SeededCluster = {
  description?: string | null;
  id: string;
  label?: string | null;
  userId: string;
};

class StubListDiscoveriesPersistenceClient
  implements
    ListDiscoveriesPersistenceClient<
      ListedDiscoveryEventRecord,
      ListedDiscoveryClusterRecord
    >
{
  readonly findManyClusterCalls: ListDiscoveriesClusterPersistenceArgs[] = [];
  readonly findManyDiscoveryEventCalls: ListDiscoveriesEventsPersistenceArgs[] = [];
  private readonly clusters: readonly SeededCluster[];
  private readonly discoveryEvents: readonly SeededDiscoveryEvent[];

  constructor(input: {
    clusters: readonly SeededCluster[];
    discoveryEvents: readonly SeededDiscoveryEvent[];
  }) {
    this.clusters = input.clusters;
    this.discoveryEvents = input.discoveryEvents;
  }

  readonly cluster = {
    findMany: async (
      args: ListDiscoveriesClusterPersistenceArgs,
    ): Promise<ListedDiscoveryClusterRecord[]> => {
      this.findManyClusterCalls.push(args);

      const requestedIds = new Set(args.where.id.in);

      return this.clusters
        .filter((cluster) => cluster.userId === args.where.userId)
        .filter((cluster) => requestedIds.has(cluster.id))
        .map((cluster) => ({
          description: cluster.description,
          id: cluster.id,
          label: cluster.label,
        }));
    },
  };

  readonly discoveryEvent = {
    findMany: async (
      args: ListDiscoveriesEventsPersistenceArgs,
    ): Promise<ListedDiscoveryEventRecord[]> => {
      this.findManyDiscoveryEventCalls.push(args);

      return this.discoveryEvents
        .filter((event) => event.userId === args.where.userId)
        .filter((event) => event.eventType === args.where.eventType)
        .sort(
          (left, right) =>
            new Date(right.createdAt).getTime() -
              new Date(left.createdAt).getTime() ||
            right.id.localeCompare(left.id),
        )
        .slice(0, args.take)
        .map((event) => ({
          createdAt: event.createdAt,
          eventType: event.eventType,
          id: event.id,
          inspiration: event.inspiration,
          newClusterId: event.newClusterId,
          previousClusterId: event.previousClusterId,
        }));
    },
  };
}

test("buildListDiscoveriesEventPersistenceArgs scopes the feed query to the authenticated user and selects render metadata", () => {
  assert.deepEqual(buildListDiscoveriesEventPersistenceArgs("user-42"), {
    where: {
      eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
      userId: "user-42",
    },
    orderBy: [{ createdAt: "desc" }],
    take: DEFAULT_LIST_DISCOVERIES_LIMIT,
    select: {
      createdAt: true,
      eventType: true,
      id: true,
      inspiration: {
        select: {
          id: true,
          rawContent: true,
          sourceType: true,
          summary: true,
          title: true,
        },
      },
      newClusterId: true,
      previousClusterId: true,
    },
  });
});

test("buildListDiscoveriesClusterPersistenceArgs dedupes cluster lookups inside the authenticated scope", () => {
  assert.deepEqual(
    buildListDiscoveriesClusterPersistenceArgs("user-42", [
      "cluster-previous",
      "cluster-next",
      "cluster-previous",
    ]),
    {
      where: {
        id: {
          in: ["cluster-previous", "cluster-next"],
        },
        userId: "user-42",
      },
      select: {
        description: true,
        id: true,
        label: true,
      },
    },
  );
});

test("listDiscoveries returns cluster reassignment events with the cluster metadata needed to render the move", async () => {
  const persistence = new StubListDiscoveriesPersistenceClient({
    clusters: [
      {
        description: "Older AI research notes.",
        id: "cluster-ai-research",
        label: "AI research",
        userId: "user-42",
      },
      {
        description: "Fresh notes about resilient capture flows.",
        id: "cluster-capture-reliability",
        label: "Capture reliability",
        userId: "user-42",
      },
      {
        description: "Another user's cluster should never leak.",
        id: "cluster-other",
        label: "Other",
        userId: "user-other",
      },
    ],
    discoveryEvents: [
      {
        createdAt: "2026-04-11T05:30:00.000Z",
        eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
        id: "evt-newer",
        inspiration: {
          id: "insp-1",
          rawContent: "Offline queues should always win over flaky networks.",
          sourceType: "TEXT_NOTE",
          summary: "Durable capture note",
          title: "Offline durability",
        },
        newClusterId: "cluster-capture-reliability",
        previousClusterId: "cluster-ai-research",
        userId: "user-42",
      },
      {
        createdAt: "2026-04-10T05:30:00.000Z",
        eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
        id: "evt-older",
        inspiration: {
          id: "insp-2",
          rawContent: "CLI imports now feel related to voice capture.",
          sourceType: "CLI_CONVERSATION",
        },
        newClusterId: "cluster-ai-research",
        previousClusterId: "cluster-capture-reliability",
        userId: "user-42",
      },
      {
        createdAt: "2026-04-12T05:30:00.000Z",
        eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
        id: "evt-other-user",
        inspiration: {
          id: "insp-other",
          rawContent: "Should be excluded",
          sourceType: "TEXT_NOTE",
        },
        newClusterId: "cluster-other",
        previousClusterId: "cluster-other",
        userId: "user-other",
      },
    ],
  });

  const discoveries = await listDiscoveries(persistence, "user-42", 2);

  assert.deepEqual(
    discoveries.map((discovery) => discovery.id),
    ["evt-newer", "evt-older"],
  );
  assert.deepEqual(discoveries[0], {
    createdAt: "2026-04-11T05:30:00.000Z",
    eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
    id: "evt-newer",
    inspiration: {
      id: "insp-1",
      rawContent: "Offline queues should always win over flaky networks.",
      sourceType: "TEXT_NOTE",
      summary: "Durable capture note",
      title: "Offline durability",
    },
    newCluster: {
      description: "Fresh notes about resilient capture flows.",
      id: "cluster-capture-reliability",
      label: "Capture reliability",
    },
    previousCluster: {
      description: "Older AI research notes.",
      id: "cluster-ai-research",
      label: "AI research",
    },
  });
  assert.deepEqual(
    persistence.findManyDiscoveryEventCalls[0],
    buildListDiscoveriesEventPersistenceArgs("user-42", 2),
  );
  assert.deepEqual(
    persistence.findManyClusterCalls[0],
    buildListDiscoveriesClusterPersistenceArgs("user-42", [
      "cluster-ai-research",
      "cluster-capture-reliability",
      "cluster-capture-reliability",
      "cluster-ai-research",
    ]),
  );
});

test("listDiscoveries preserves cluster ids even when a prior cluster was deleted after reassignment", async () => {
  const persistence = new StubListDiscoveriesPersistenceClient({
    clusters: [
      {
        id: "cluster-active",
        label: "Active cluster",
        userId: "user-42",
      },
    ],
    discoveryEvents: [
      {
        createdAt: "2026-04-11T05:30:00.000Z",
        eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
        id: "evt-move",
        inspiration: {
          id: "insp-1",
          rawContent: "A note that outgrew its old cluster.",
          sourceType: "TEXT_NOTE",
        },
        newClusterId: "cluster-active",
        previousClusterId: "cluster-retired",
        userId: "user-42",
      },
    ],
  });

  const discoveries = await listDiscoveries(persistence, "user-42", 1);

  assert.deepEqual(discoveries, [
    {
      createdAt: "2026-04-11T05:30:00.000Z",
      eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
      id: "evt-move",
      inspiration: {
        id: "insp-1",
        rawContent: "A note that outgrew its old cluster.",
        sourceType: "TEXT_NOTE",
      },
      newCluster: {
        id: "cluster-active",
        label: "Active cluster",
      },
      previousCluster: {
        id: "cluster-retired",
      },
    },
  ]);
});

test("handleListDiscoveriesRouteRequest returns 401 when the caller is not authenticated", async () => {
  const response = await handleListDiscoveriesRouteRequest(
    new Request("https://waka.app/api/discoveries"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return null;
          },
        },
        persistence: new StubListDiscoveriesPersistenceClient({
          clusters: [],
          discoveryEvents: [],
        }),
      },
    },
  );

  assert.equal(response.status, LIST_DISCOVERIES_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: LIST_DISCOVERIES_ROUTE_UNAUTHORIZED_ERROR,
  });
});

test("handleListDiscoveriesRouteRequest keeps the discoveries feed scoped to the authenticated user", async () => {
  const persistence = new StubListDiscoveriesPersistenceClient({
    clusters: [
      {
        id: "cluster-team",
        label: "Team notes",
        userId: "user-42",
      },
    ],
    discoveryEvents: [
      {
        createdAt: "2026-04-11T05:30:00.000Z",
        eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
        id: "evt-user-42",
        inspiration: {
          id: "insp-1",
          rawContent: "Keep my feed private.",
          sourceType: "TEXT_NOTE",
        },
        newClusterId: "cluster-team",
        previousClusterId: "cluster-team-old",
        userId: "user-42",
      },
      {
        createdAt: "2026-04-12T05:30:00.000Z",
        eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
        id: "evt-user-other",
        inspiration: {
          id: "insp-other",
          rawContent: "Another user's feed item.",
          sourceType: "TEXT_NOTE",
        },
        newClusterId: "cluster-other",
        previousClusterId: "cluster-other-old",
        userId: "user-other",
      },
    ],
  });

  const response = await handleListDiscoveriesRouteRequest(
    new Request("https://waka.app/api/discoveries?userId=user-other&limit=5"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
    },
  );

  assert.equal(response.status, LIST_DISCOVERIES_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    discoveries: [
      {
        createdAt: "2026-04-11T05:30:00.000Z",
        eventType: CLUSTER_REASSIGNMENT_DISCOVERY_EVENT_TYPE,
        id: "evt-user-42",
        inspiration: {
          id: "insp-1",
          rawContent: "Keep my feed private.",
          sourceType: "TEXT_NOTE",
        },
        newCluster: {
          id: "cluster-team",
          label: "Team notes",
        },
        previousCluster: {
          id: "cluster-team-old",
        },
      },
    ],
  });
});

test("handleListDiscoveriesRouteRequest returns 400 for invalid limits", async () => {
  const response = await handleListDiscoveriesRouteRequest(
    new Request("https://waka.app/api/discoveries?limit=0"),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence: new StubListDiscoveriesPersistenceClient({
          clusters: [],
          discoveryEvents: [],
        }),
      },
    },
  );

  assert.equal(response.status, LIST_DISCOVERIES_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await response.json(), {
    error: LIST_DISCOVERIES_ROUTE_LIMIT_INVALID_ERROR,
  });
});

test.afterEach(() => {
  configureListDiscoveriesRouteDependencies(null);
});
