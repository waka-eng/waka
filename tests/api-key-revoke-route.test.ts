import assert from "node:assert/strict";
import test from "node:test";

import { submitSettingsApiKeyRevokeToBackend } from "../apps/web/app/(app)/settings/actions.ts";
import {
  REVOKE_API_KEY_ROUTE_BAD_REQUEST_STATUS,
  REVOKE_API_KEY_ROUTE_NOT_FOUND_ERROR,
  REVOKE_API_KEY_ROUTE_NOT_FOUND_STATUS,
  REVOKE_API_KEY_ROUTE_OK_STATUS,
  REVOKE_API_KEY_ROUTE_UNAUTHORIZED_ERROR,
  REVOKE_API_KEY_ROUTE_UNAUTHORIZED_STATUS,
  REVOKE_API_KEY_ROUTE_WORKSPACE_REQUIRED_ERROR,
  REVOKE_API_KEY_ROUTE_WORKSPACE_REQUIRED_STATUS,
  configureRevokeApiKeyRouteDependencies,
  handleRevokeApiKeyRouteRequest,
} from "../apps/web/src/auth/api-key-revoke-route.ts";
import {
  API_KEY_REVOKE_ID_REQUIRED_ERROR,
  API_KEY_REVOKE_REQUEST_BODY_INVALID_ERROR,
  API_KEY_REVOKE_REQUEST_BODY_JSON_INVALID_ERROR,
} from "../apps/web/src/auth/api-key-revocation.ts";
import { hashApiKey } from "../apps/web/src/auth/api-key.ts";
import type {
  ApiKeyCreateData,
  ApiKeyPersistenceClient,
  ApiKeyRecordWhere,
  ApiKeyUpdateData,
  StoredApiKeyRecord,
} from "../apps/web/src/auth/api-key-persistence.ts";
import type {
  CurrentWorkspaceApiKeySessionLike,
  CurrentWorkspaceMembershipLookupClient,
} from "../apps/web/src/auth/api-key-current-workspace.ts";

function matchesWhere(
  record: StoredApiKeyRecord,
  where: ApiKeyRecordWhere,
): boolean {
  if (where.id !== undefined && record.id !== where.id) {
    return false;
  }

  if (where.userId !== undefined && record.userId !== where.userId) {
    return false;
  }

  if (where.tenantId !== undefined && record.tenantId !== where.tenantId) {
    return false;
  }

  if (where.workspaceId !== undefined && record.workspaceId !== where.workspaceId) {
    return false;
  }

  if (where.hashedKey !== undefined && record.hashedKey !== where.hashedKey) {
    return false;
  }

  return true;
}

function createStoredApiKeyRecord(
  overrides: Partial<StoredApiKeyRecord> = {},
): StoredApiKeyRecord {
  const createdAt = overrides.createdAt ?? new Date("2026-04-10T00:00:00.000Z");
  const keyPrefix = overrides.keyPrefix ?? "waka_live_revocation";

  return {
    id: overrides.id ?? "key-1",
    userId: overrides.userId ?? "user-1",
    tenantId: overrides.tenantId ?? "tenant-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    name: overrides.name ?? "CLI laptop",
    description: overrides.description ?? "Workspace-scoped key",
    keyPrefix,
    metadata: overrides.metadata ?? { surface: "cli" },
    hashedKey: overrides.hashedKey ?? hashApiKey(`${keyPrefix}_secret`),
    lastUsedAt: overrides.lastUsedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
  };
}

function createInMemoryApiKeyPersistenceClient(
  initialRecords: StoredApiKeyRecord[] = [],
): {
  client: ApiKeyPersistenceClient<StoredApiKeyRecord>;
  createCalls: ApiKeyCreateData[];
  records: StoredApiKeyRecord[];
  updateCalls: Array<{ where: { id: string }; data: ApiKeyUpdateData }>;
} {
  const records = [...initialRecords];
  const createCalls: ApiKeyCreateData[] = [];
  const updateCalls: Array<{ where: { id: string }; data: ApiKeyUpdateData }> = [];

  return {
    client: {
      apiKey: {
        async create({ data }) {
          createCalls.push(data);

          const createdAt = new Date("2026-04-10T00:00:10.000Z");
          const record: StoredApiKeyRecord = {
            id: `key-${records.length + 1}`,
            ...data,
            createdAt,
            updatedAt: createdAt,
          };

          records.push(record);

          return record;
        },
        async findFirst({ where }) {
          return records.find((record) => matchesWhere(record, where)) ?? null;
        },
        async findMany() {
          return [];
        },
        async update({ where, data }) {
          updateCalls.push({ where, data });

          const index = records.findIndex((record) => record.id === where.id);

          if (index === -1) {
            throw new Error(`API key ${where.id} was not found`);
          }

          const updatedAt = new Date("2026-04-10T00:00:20.000Z");
          const nextRecord: StoredApiKeyRecord = {
            ...records[index],
            ...data,
            updatedAt,
          };

          records[index] = nextRecord;

          return nextRecord;
        },
      },
    },
    createCalls,
    records,
    updateCalls,
  };
}

function createMembershipLookupClient(
  memberships:
    | Array<{
        createdAt?: Date;
        tenantId: string;
        workspaceId: string;
      }>
    | {
        createdAt?: Date;
        tenantId: string;
        workspaceId: string;
      }
    | null,
): {
  client: CurrentWorkspaceMembershipLookupClient;
  lookups: Array<{
    where: {
      userId: string;
      tenantId?: string;
      workspaceId?: string;
    };
    orderBy: Array<{ createdAt: "asc" | "desc" }>;
  }>;
} {
  const storedMemberships =
    memberships === null
      ? []
      : Array.isArray(memberships)
        ? memberships
        : [memberships];
  const lookups: Array<{
    where: {
      userId: string;
      tenantId?: string;
      workspaceId?: string;
    };
    orderBy: Array<{ createdAt: "asc" | "desc" }>;
  }> = [];

  return {
    client: {
      membership: {
        async findFirst(args) {
          lookups.push(args);
          const matches = storedMemberships.filter((membership) => {
            if (
              args.where.tenantId !== undefined &&
              membership.tenantId !== args.where.tenantId
            ) {
              return false;
            }

            if (
              args.where.workspaceId !== undefined &&
              membership.workspaceId !== args.where.workspaceId
            ) {
              return false;
            }

            return true;
          });
          const [firstOrder] = args.orderBy;

          if (firstOrder?.createdAt === "asc") {
            return (
              [...matches].sort(
                (left, right) =>
                  (left.createdAt ?? new Date(0)).getTime() -
                  (right.createdAt ?? new Date(0)).getTime(),
              )[0] ?? null
            );
          }

          return (
            [...matches].sort(
              (left, right) =>
                (right.createdAt ?? new Date(0)).getTime() -
                (left.createdAt ?? new Date(0)).getTime(),
            )[0] ?? null
          );
        },
      },
    },
    lookups,
  };
}

function createSessionProvider(session: CurrentWorkspaceApiKeySessionLike | null) {
  return {
    async getCurrentWorkspaceSession() {
      return session;
    },
  };
}

test("handleRevokeApiKeyRouteRequest returns 401 when no authenticated session is present", async () => {
  const { client, updateCalls } = createInMemoryApiKeyPersistenceClient();
  const membershipLookup = createMembershipLookupClient(null);
  const response = await handleRevokeApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "DELETE",
      body: JSON.stringify({ apiKeyId: "key-1" }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        apiKeyPersistenceClient: client,
        membershipClient: membershipLookup.client,
        sessionProvider: createSessionProvider(null),
      },
    },
  );

  assert.equal(response.status, REVOKE_API_KEY_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: REVOKE_API_KEY_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(updateCalls.length, 0);
  assert.equal(membershipLookup.lookups.length, 0);
});

test("handleRevokeApiKeyRouteRequest rejects invalid JSON and blank ids as 400s", async () => {
  const { client } = createInMemoryApiKeyPersistenceClient();
  const membershipLookup = createMembershipLookupClient({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
  });
  const dependencies = {
    apiKeyPersistenceClient: client,
    membershipClient: membershipLookup.client,
    sessionProvider: createSessionProvider({
      userId: "user-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    }),
  };

  const invalidJsonResponse = await handleRevokeApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "DELETE",
      body: "{invalid",
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies,
    },
  );
  const invalidShapeResponse = await handleRevokeApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "DELETE",
      body: JSON.stringify("not-an-object"),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies,
    },
  );
  const blankIdResponse = await handleRevokeApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "DELETE",
      body: JSON.stringify({
        apiKeyId: "   ",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies,
    },
  );

  assert.equal(invalidJsonResponse.status, REVOKE_API_KEY_ROUTE_BAD_REQUEST_STATUS);
  assert.match(
    (await invalidJsonResponse.json()).error,
    new RegExp(`^${API_KEY_REVOKE_REQUEST_BODY_JSON_INVALID_ERROR}`),
  );
  assert.equal(invalidShapeResponse.status, REVOKE_API_KEY_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await invalidShapeResponse.json(), {
    error: API_KEY_REVOKE_REQUEST_BODY_INVALID_ERROR,
  });
  assert.equal(blankIdResponse.status, REVOKE_API_KEY_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await blankIdResponse.json(), {
    error: API_KEY_REVOKE_ID_REQUIRED_ERROR,
  });
});

test("handleRevokeApiKeyRouteRequest returns 409 when the authenticated user has no current workspace", async () => {
  const { client } = createInMemoryApiKeyPersistenceClient();
  const membershipLookup = createMembershipLookupClient(null);
  const response = await handleRevokeApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "DELETE",
      body: JSON.stringify({
        apiKeyId: "key-1",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        apiKeyPersistenceClient: client,
        membershipClient: membershipLookup.client,
        sessionProvider: createSessionProvider({
          userId: "user-2",
        }),
      },
    },
  );

  assert.equal(response.status, REVOKE_API_KEY_ROUTE_WORKSPACE_REQUIRED_STATUS);
  assert.deepEqual(await response.json(), {
    error: REVOKE_API_KEY_ROUTE_WORKSPACE_REQUIRED_ERROR,
  });
});

test("handleRevokeApiKeyRouteRequest returns 404 when the key is not in the current workspace scope", async () => {
  const { client, updateCalls } = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-other-workspace",
      workspaceId: "workspace-2",
    }),
  ]);
  const membershipLookup = createMembershipLookupClient({
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
  });
  const response = await handleRevokeApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "DELETE",
      body: JSON.stringify({
        apiKeyId: "key-other-workspace",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies: {
        apiKeyPersistenceClient: client,
        membershipClient: membershipLookup.client,
        sessionProvider: createSessionProvider({
          userId: "user-1",
          tenantId: "tenant-1",
          workspaceId: "workspace-1",
        }),
      },
    },
  );

  assert.equal(response.status, REVOKE_API_KEY_ROUTE_NOT_FOUND_STATUS);
  assert.deepEqual(await response.json(), {
    error: REVOKE_API_KEY_ROUTE_NOT_FOUND_ERROR,
  });
  assert.equal(updateCalls.length, 0);
});

test("handleRevokeApiKeyRouteRequest persists the revoked key in the backing store and returns the inactive record", async () => {
  const { client, records, updateCalls } = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-active",
      userId: "user-7",
      tenantId: "tenant-7",
      workspaceId: "workspace-9",
      name: "CLI laptop",
    }),
  ]);
  const membershipLookup = createMembershipLookupClient({
    tenantId: "tenant-7",
    workspaceId: "workspace-9",
  });
  const revokedAt = new Date("2026-04-10T04:30:00.000Z");
  const response = await handleRevokeApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "DELETE",
      body: JSON.stringify({
        apiKeyId: "key-active",
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      revokeApiKeyOptions: {
        revokedAt,
      },
      dependencies: {
        apiKeyPersistenceClient: client,
        membershipClient: membershipLookup.client,
        sessionProvider: createSessionProvider({
          userId: "user-7",
          tenantId: "tenant-7",
          workspaceId: "workspace-9",
        }),
      },
    },
  );
  const body = await response.json();

  assert.equal(response.status, REVOKE_API_KEY_ROUTE_OK_STATUS);
  assert.equal(updateCalls.length, 1);
  assert.deepEqual(updateCalls[0], {
    where: {
      id: "key-active",
    },
    data: {
      revokedAt,
    },
  });
  assert.equal(records[0]?.revokedAt?.toISOString(), revokedAt.toISOString());
  assert.deepEqual(body, {
    apiKey: {
      id: "key-active",
      userId: "user-7",
      tenantId: "tenant-7",
      workspaceId: "workspace-9",
      name: "CLI laptop",
      description: "Workspace-scoped key",
      keyPrefix: "waka_live_revocation",
      metadata: {
        surface: "cli",
      },
      lastUsedAt: null,
      revokedAt: "2026-04-10T04:30:00.000Z",
      createdAt: "2026-04-10T00:00:00.000Z",
      updatedAt: "2026-04-10T00:00:20.000Z",
    },
  });
});

test("submitSettingsApiKeyRevokeToBackend revokes the key through the backend bridge and returns the persisted record", async () => {
  const { client, records, updateCalls } = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-settings",
      userId: "user-settings",
      tenantId: "tenant-settings",
      workspaceId: "workspace-settings",
    }),
  ]);
  const revokedAt = new Date("2026-04-10T05:00:00.000Z");

  configureRevokeApiKeyRouteDependencies({
    apiKeyPersistenceClient: client,
    membershipClient: createMembershipLookupClient({
      tenantId: "tenant-settings",
      workspaceId: "workspace-settings",
    }).client,
    sessionProvider: createSessionProvider({
      userId: "user-settings",
      tenantId: "tenant-settings",
      workspaceId: "workspace-settings",
    }),
  });

  try {
    const result = await submitSettingsApiKeyRevokeToBackend("  key-settings  ", {
      revokeApiKeyOptions: {
        revokedAt,
      },
    });

    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0]?.where.id, "key-settings");
    assert.equal(records[0]?.revokedAt?.toISOString(), revokedAt.toISOString());
    assert.equal(result.apiKey.id, "key-settings");
    assert.equal(result.apiKey.revokedAt?.toISOString(), revokedAt.toISOString());
  } finally {
    configureRevokeApiKeyRouteDependencies(null);
  }
});
