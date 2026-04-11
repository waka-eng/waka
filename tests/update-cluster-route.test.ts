import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type {
  UpdateClusterPersistenceArgs,
  UpdateClusterPersistenceClient,
  UpdatedClusterRecord,
} from "../apps/web/src/clusters/update-route.ts";
import {
  buildUpdateClusterPersistenceArgs,
  CLUSTER_SHARE_SLUG_PREFIX,
  configureUpdateClusterRouteDependencies,
  generateClusterShareSlug,
  handleUpdateClusterRouteRequest,
  parseUpdateClusterRequestBody,
  UPDATE_CLUSTER_IS_PUBLIC_INVALID_ERROR,
  UPDATE_CLUSTER_REQUEST_BODY_EMPTY_ERROR,
  UPDATE_CLUSTER_ROUTE_NOT_FOUND_ERROR,
  UPDATE_CLUSTER_ROUTE_NOT_FOUND_STATUS,
  UPDATE_CLUSTER_ROUTE_OK_STATUS,
  UPDATE_CLUSTER_ROUTE_UNAUTHORIZED_ERROR,
  UPDATE_CLUSTER_ROUTE_UNAUTHORIZED_STATUS,
} from "../apps/web/src/clusters/update-route.ts";

type SeededCluster = {
  id: string;
  isPublic: boolean;
  shareSlug?: string | null;
  userId: string;
};

class StubUpdateClusterPersistenceClient
  implements UpdateClusterPersistenceClient<UpdatedClusterRecord>
{
  readonly clusters: SeededCluster[];
  readonly updateCalls: UpdateClusterPersistenceArgs[] = [];

  constructor(clusters: readonly SeededCluster[]) {
    this.clusters = clusters.map((cluster) => ({
      ...cluster,
    }));
  }

  readonly cluster = {
    update: async (
      args: UpdateClusterPersistenceArgs,
    ): Promise<UpdatedClusterRecord> => {
      this.updateCalls.push(args);

      const index = this.clusters.findIndex(
        (candidate) =>
          candidate.id === args.where.userId_id.id &&
          candidate.userId === args.where.userId_id.userId,
      );

      if (index === -1) {
        throw {
          code: "P2025",
          name: "PrismaClientKnownRequestError",
        };
      }

      const nextCluster = {
        ...this.clusters[index],
        ...(typeof args.data.isPublic === "boolean"
          ? { isPublic: args.data.isPublic }
          : {}),
        ...(typeof args.data.shareSlug === "string" || args.data.shareSlug === null
          ? { shareSlug: args.data.shareSlug }
          : {}),
      };

      this.clusters[index] = nextCluster;

      return {
        id: nextCluster.id,
        isPublic: nextCluster.isPublic,
        shareSlug: nextCluster.shareSlug ?? null,
      };
    },
  };
}

test("generateClusterShareSlug returns URL-safe unique slugs with a cluster prefix", () => {
  assert.equal(
    generateClusterShareSlug(
      () => "123e4567-e89b-12d3-a456-426614174000",
    ),
    "cluster_123e4567e89b12d3a456426614174000",
  );

  const generatedSlugs = new Set(
    Array.from({ length: 16 }, () => generateClusterShareSlug()),
  );

  assert.equal(generatedSlugs.size, 16);

  for (const generatedSlug of generatedSlugs) {
    assert.match(generatedSlug, new RegExp(`^${CLUSTER_SHARE_SLUG_PREFIX}[A-Za-z0-9]+$`));
  }
});

test("buildUpdateClusterPersistenceArgs scopes updates to the authenticated user", () => {
  assert.deepEqual(
    buildUpdateClusterPersistenceArgs("user-42", "cluster-1", {
      isPublic: true,
      shareSlug: "cluster_publicshare",
    }),
    {
      data: {
        isPublic: true,
        shareSlug: "cluster_publicshare",
      },
      select: {
        id: true,
        isPublic: true,
        shareSlug: true,
      },
      where: {
        userId_id: {
          id: "cluster-1",
          userId: "user-42",
        },
      },
    },
  );
});

test("parseUpdateClusterRequestBody accepts public-share toggles and rejects invalid values", async () => {
  const validRequest = new Request("https://waka.app/api/clusters/cluster-1", {
    body: JSON.stringify({
      isPublic: true,
      ignored: "field",
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "PUT",
  });

  assert.deepEqual(await parseUpdateClusterRequestBody(validRequest), {
    isPublic: true,
  });

  await assert.rejects(
    () =>
      parseUpdateClusterRequestBody(
        new Request("https://waka.app/api/clusters/cluster-1", {
          body: JSON.stringify({
            isPublic: "true",
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "PUT",
        }),
      ),
    new TypeError(UPDATE_CLUSTER_IS_PUBLIC_INVALID_ERROR),
  );

  await assert.rejects(
    () =>
      parseUpdateClusterRequestBody(
        new Request("https://waka.app/api/clusters/cluster-1", {
          body: JSON.stringify({
            ignored: true,
          }),
          headers: {
            "content-type": "application/json",
          },
          method: "PUT",
        }),
      ),
    new TypeError(UPDATE_CLUSTER_REQUEST_BODY_EMPTY_ERROR),
  );
});

test("handleUpdateClusterRouteRequest returns 401 when the caller is not authenticated", async () => {
  const persistence = new StubUpdateClusterPersistenceClient([]);

  const response = await handleUpdateClusterRouteRequest(
    new Request("https://waka.app/api/clusters/cluster-1", {
      body: JSON.stringify({
        isPublic: true,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "PUT",
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return null;
          },
        },
        persistence,
      },
      params: {
        clusterId: "cluster-1",
      },
    },
  );

  assert.equal(response.status, UPDATE_CLUSTER_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: UPDATE_CLUSTER_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(persistence.updateCalls.length, 0);
});

test("handleUpdateClusterRouteRequest generates a share slug when a cluster becomes public", async () => {
  const persistence = new StubUpdateClusterPersistenceClient([
    {
      id: "cluster-1",
      isPublic: false,
      shareSlug: null,
      userId: "user-42",
    },
  ]);

  const response = await handleUpdateClusterRouteRequest(
    new Request("https://waka.app/api/clusters/cluster-1", {
      body: JSON.stringify({
        isPublic: true,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "PUT",
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
        shareSlugGenerator() {
          return "cluster_publicshare";
        },
      },
      params: {
        clusterId: "cluster-1",
      },
    },
  );

  assert.equal(response.status, UPDATE_CLUSTER_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "cluster-1",
    isPublic: true,
    shareSlug: "cluster_publicshare",
  });
  assert.deepEqual(persistence.updateCalls[0], {
    data: {
      isPublic: true,
      shareSlug: "cluster_publicshare",
    },
    select: {
      id: true,
      isPublic: true,
      shareSlug: true,
    },
    where: {
      userId_id: {
        id: "cluster-1",
        userId: "user-42",
      },
    },
  });
});

test("handleUpdateClusterRouteRequest clears the share slug when a cluster is unshared", async () => {
  const persistence = new StubUpdateClusterPersistenceClient([
    {
      id: "cluster-1",
      isPublic: true,
      shareSlug: "cluster_publicshare",
      userId: "user-42",
    },
  ]);

  const response = await handleUpdateClusterRouteRequest(
    new Request("https://waka.app/api/clusters/cluster-1", {
      body: JSON.stringify({
        isPublic: false,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "PUT",
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence,
      },
      params: {
        clusterId: "cluster-1",
      },
    },
  );

  assert.equal(response.status, UPDATE_CLUSTER_ROUTE_OK_STATUS);
  assert.deepEqual(await response.json(), {
    id: "cluster-1",
    isPublic: false,
    shareSlug: null,
  });
});

test("handleUpdateClusterRouteRequest returns the shared not-found contract for missing or cross-user clusters", async () => {
  const crossUserPersistence = new StubUpdateClusterPersistenceClient([
    {
      id: "cluster-secret",
      isPublic: true,
      shareSlug: "cluster_secretshare",
      userId: "user-other",
    },
  ]);
  const missingPersistence = new StubUpdateClusterPersistenceClient([]);

  const crossUserResponse = await handleUpdateClusterRouteRequest(
    new Request("https://waka.app/api/clusters/cluster-secret", {
      body: JSON.stringify({
        isPublic: false,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "PUT",
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence: crossUserPersistence,
      },
      params: {
        clusterId: "cluster-secret",
      },
    },
  );

  const missingResponse = await handleUpdateClusterRouteRequest(
    new Request("https://waka.app/api/clusters/cluster-missing", {
      body: JSON.stringify({
        isPublic: true,
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "PUT",
    }),
    {
      dependencies: {
        auth: {
          async resolveAuthenticatedUserId() {
            return "user-42";
          },
        },
        persistence: missingPersistence,
      },
      params: {
        clusterId: "cluster-missing",
      },
    },
  );

  assert.equal(crossUserResponse.status, UPDATE_CLUSTER_ROUTE_NOT_FOUND_STATUS);
  assert.equal(missingResponse.status, UPDATE_CLUSTER_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await crossUserResponse.json(), {
    error: UPDATE_CLUSTER_ROUTE_NOT_FOUND_ERROR,
  });
  assert.deepEqual(await missingResponse.json(), {
    error: UPDATE_CLUSTER_ROUTE_NOT_FOUND_ERROR,
  });
});

test("cluster api route delegates PUT requests to the cluster update handler", () => {
  const routeSource = readFileSync(
    "apps/web/app/api/clusters/[id]/route.ts",
    "utf8",
  );

  assert.match(routeSource, /handleUpdateClusterRouteRequest/u);
  assert.match(routeSource, /clusterId: params\.id/u);
});

test.after(() => {
  configureUpdateClusterRouteDependencies(null);
});
