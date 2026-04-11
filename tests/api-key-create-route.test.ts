import assert from "node:assert/strict";
import test from "node:test";

import { submitSettingsApiKeyCreateFormToBackend } from "../apps/web/app/(app)/settings/actions.ts";
import {
  CREATE_API_KEY_ROUTE_BAD_REQUEST_STATUS,
  CREATE_API_KEY_ROUTE_CREATED_STATUS,
  CREATE_API_KEY_ROUTE_UNAUTHORIZED_STATUS,
  CREATE_API_KEY_ROUTE_UNAUTHORIZED_ERROR,
  CREATE_API_KEY_ROUTE_WORKSPACE_REQUIRED_ERROR,
  CREATE_API_KEY_ROUTE_WORKSPACE_REQUIRED_STATUS,
  configureCreateApiKeyRouteDependencies,
  handleCreateApiKeyRouteRequest,
} from "../apps/web/src/auth/api-key-create-route.ts";
import {
  API_KEY_CREATE_DESCRIPTION_INVALID_ERROR,
  API_KEY_CREATE_REQUEST_BODY_INVALID_ERROR,
  API_KEY_CREATE_REQUEST_BODY_JSON_INVALID_ERROR,
} from "../apps/web/src/auth/api-key-issuance.ts";
import { hashApiKey } from "../apps/web/src/auth/api-key.ts";
import {
  deriveApiKeyPrefix,
  type ApiKeyCreateData,
  type ApiKeyPersistenceClient,
  type ApiKeyRecordWhere,
  type ApiKeyUpdateData,
  type StoredApiKeyRecord,
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

function createInMemoryApiKeyPersistenceClient(): {
  client: ApiKeyPersistenceClient<StoredApiKeyRecord>;
  createCalls: ApiKeyCreateData[];
  records: StoredApiKeyRecord[];
  updateCalls: Array<{ where: { id: string }; data: ApiKeyUpdateData }>;
} {
  const records: StoredApiKeyRecord[] = [];
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

test("handleCreateApiKeyRouteRequest returns 401 when no authenticated session is present", async () => {
  const { client, createCalls } = createInMemoryApiKeyPersistenceClient();
  const membershipLookup = createMembershipLookupClient(null);
  const response = await handleCreateApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: "CLI laptop" }),
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

  assert.equal(response.status, CREATE_API_KEY_ROUTE_UNAUTHORIZED_STATUS);
  assert.deepEqual(await response.json(), {
    error: CREATE_API_KEY_ROUTE_UNAUTHORIZED_ERROR,
  });
  assert.equal(createCalls.length, 0);
  assert.equal(membershipLookup.lookups.length, 0);
});

test("handleCreateApiKeyRouteRequest rejects invalid JSON and non-object payloads as 400s", async () => {
  const { client } = createInMemoryApiKeyPersistenceClient();
  const membershipLookup = createMembershipLookupClient(null);
  const dependencies = {
    apiKeyPersistenceClient: client,
    membershipClient: membershipLookup.client,
    sessionProvider: createSessionProvider({
      userId: "user-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    }),
  };

  const invalidJsonResponse = await handleCreateApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "POST",
      body: "{invalid",
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies,
    },
  );
  const invalidShapeResponse = await handleCreateApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "POST",
      body: JSON.stringify("not-an-object"),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      dependencies,
    },
  );

  assert.equal(invalidJsonResponse.status, CREATE_API_KEY_ROUTE_BAD_REQUEST_STATUS);
  assert.match(
    (await invalidJsonResponse.json()).error,
    new RegExp(`^${API_KEY_CREATE_REQUEST_BODY_JSON_INVALID_ERROR}`),
  );
  assert.equal(invalidShapeResponse.status, CREATE_API_KEY_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await invalidShapeResponse.json(), {
    error: API_KEY_CREATE_REQUEST_BODY_INVALID_ERROR,
  });
});

test("handleCreateApiKeyRouteRequest validates JSON field types before issuing the key", async () => {
  const { client, createCalls } = createInMemoryApiKeyPersistenceClient();
  const membershipLookup = createMembershipLookupClient(null);
  const response = await handleCreateApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "POST",
      body: JSON.stringify({
        name: "CLI laptop",
        description: 42,
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
          tenantId: "tenant-2",
          workspaceId: "workspace-2",
        }),
      },
    },
  );

  assert.equal(response.status, CREATE_API_KEY_ROUTE_BAD_REQUEST_STATUS);
  assert.deepEqual(await response.json(), {
    error: API_KEY_CREATE_DESCRIPTION_INVALID_ERROR,
  });
  assert.equal(createCalls.length, 0);
});

test("handleCreateApiKeyRouteRequest returns 409 when the authenticated user has no current workspace", async () => {
  const { client } = createInMemoryApiKeyPersistenceClient();
  const membershipLookup = createMembershipLookupClient(null);
  const response = await handleCreateApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "POST",
      body: JSON.stringify({
        name: "CLI laptop",
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
          userId: "user-3",
        }),
      },
    },
  );

  assert.equal(response.status, CREATE_API_KEY_ROUTE_WORKSPACE_REQUIRED_STATUS);
  assert.deepEqual(await response.json(), {
    error: CREATE_API_KEY_ROUTE_WORKSPACE_REQUIRED_ERROR,
  });
});

test("handleCreateApiKeyRouteRequest returns 409 when the active workspace is not a membership of the authenticated user", async () => {
  const { client, createCalls } = createInMemoryApiKeyPersistenceClient();
  const membershipLookup = createMembershipLookupClient([
    {
      createdAt: new Date("2026-04-10T00:00:00.000Z"),
      tenantId: "tenant-allowed",
      workspaceId: "workspace-allowed",
    },
  ]);
  const response = await handleCreateApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "POST",
      body: JSON.stringify({
        name: "CLI laptop",
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
          userId: "user-4",
          tenantId: "tenant-forged",
          workspaceId: "workspace-forged",
        }),
      },
    },
  );

  assert.equal(response.status, CREATE_API_KEY_ROUTE_WORKSPACE_REQUIRED_STATUS);
  assert.deepEqual(await response.json(), {
    error: CREATE_API_KEY_ROUTE_WORKSPACE_REQUIRED_ERROR,
  });
  assert.deepEqual(membershipLookup.lookups, [
    {
      where: {
        userId: "user-4",
        tenantId: "tenant-forged",
        workspaceId: "workspace-forged",
      },
      orderBy: [{ createdAt: "desc" }],
    },
  ]);
  assert.equal(createCalls.length, 0);
});

test("handleCreateApiKeyRouteRequest creates a workspace-scoped API key and returns the plaintext key once", async () => {
  const { client, createCalls } = createInMemoryApiKeyPersistenceClient();
  const membershipLookup = createMembershipLookupClient({
    tenantId: "tenant-7",
    workspaceId: "workspace-9",
  });
  const plainKey = "waka_live_route_success";
  const response = await handleCreateApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "POST",
      body: JSON.stringify({
        name: "  CLI laptop  ",
        description: "   ",
        metadata: {
          device: "macbook-pro",
          surface: "cli",
        },
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    {
      createApiKeyOptions: {
        plainKey,
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

  assert.equal(response.status, CREATE_API_KEY_ROUTE_CREATED_STATUS);
  assert.equal(membershipLookup.lookups.length, 1);
  assert.deepEqual(membershipLookup.lookups[0], {
    where: {
      userId: "user-7",
      tenantId: "tenant-7",
      workspaceId: "workspace-9",
    },
    orderBy: [{ createdAt: "desc" }],
  });
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    userId: "user-7",
    tenantId: "tenant-7",
    workspaceId: "workspace-9",
    name: "CLI laptop",
    description: null,
    keyPrefix: deriveApiKeyPrefix(plainKey),
    metadata: {
      device: "macbook-pro",
      surface: "cli",
    },
    hashedKey: hashApiKey(plainKey),
    lastUsedAt: null,
    revokedAt: null,
  });
  assert.equal("plainKey" in createCalls[0], false);
  assert.deepEqual(body, {
    apiKey: {
      id: "key-1",
      userId: "user-7",
      tenantId: "tenant-7",
      workspaceId: "workspace-9",
      name: "CLI laptop",
      description: null,
      keyPrefix: deriveApiKeyPrefix(plainKey),
      metadata: {
        device: "macbook-pro",
        surface: "cli",
      },
      lastUsedAt: null,
      revokedAt: null,
      createdAt: "2026-04-10T00:00:10.000Z",
      updatedAt: "2026-04-10T00:00:10.000Z",
    },
    plainKey,
  });
});

test("handleCreateApiKeyRouteRequest accepts settings form submissions with a user-defined name", async () => {
  const { client, createCalls } = createInMemoryApiKeyPersistenceClient();
  const membershipLookup = createMembershipLookupClient({
    tenantId: "tenant-form",
    workspaceId: "workspace-form",
  });
  const formData = new FormData();
  const plainKey = "waka_live_form_submission";

  formData.set("name", "  Work laptop CLI  ");

  const response = await handleCreateApiKeyRouteRequest(
    new Request("https://waka.app/api/api-keys", {
      method: "POST",
      body: formData,
    }),
    {
      createApiKeyOptions: {
        plainKey,
      },
      dependencies: {
        apiKeyPersistenceClient: client,
        membershipClient: membershipLookup.client,
        sessionProvider: createSessionProvider({
          userId: "user-form",
          tenantId: "tenant-form",
          workspaceId: "workspace-form",
        }),
      },
    },
  );
  const body = await response.json();

  assert.equal(response.status, CREATE_API_KEY_ROUTE_CREATED_STATUS);
  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    userId: "user-form",
    tenantId: "tenant-form",
    workspaceId: "workspace-form",
    name: "Work laptop CLI",
    description: null,
    keyPrefix: deriveApiKeyPrefix(plainKey),
    metadata: null,
    hashedKey: hashApiKey(plainKey),
    lastUsedAt: null,
    revokedAt: null,
  });
  assert.equal(body.apiKey.name, "Work laptop CLI");
  assert.equal(body.plainKey, plainKey);
});

test("submitSettingsApiKeyCreateFormToBackend creates a key from the submitted settings form name", async () => {
  const { client, createCalls } = createInMemoryApiKeyPersistenceClient();
  const membershipLookup = createMembershipLookupClient({
    tenantId: "tenant-settings",
    workspaceId: "workspace-settings",
  });
  const formData = new FormData();

  formData.set("name", "  Capture Surface Laptop  ");

  const result = await submitSettingsApiKeyCreateFormToBackend(formData, {
    createApiKeyOptions: {
      plainKey: "waka_live_settings_submit",
    },
    dependencies: {
      apiKeyPersistenceClient: client,
      membershipClient: membershipLookup.client,
      sessionProvider: createSessionProvider({
        userId: "user-settings",
        tenantId: "tenant-settings",
        workspaceId: "workspace-settings",
      }),
    },
  });

  assert.equal(createCalls.length, 1);
  assert.equal(result.apiKey.name, "Capture Surface Laptop");
  assert.equal(result.plainKey, "waka_live_settings_submit");
  assert.equal(result.apiKey.createdAt instanceof Date, true);
  assert.deepEqual(createCalls[0], {
    userId: "user-settings",
    tenantId: "tenant-settings",
    workspaceId: "workspace-settings",
    name: "Capture Surface Laptop",
    description: null,
    keyPrefix: deriveApiKeyPrefix("waka_live_settings_submit"),
    metadata: null,
    hashedKey: hashApiKey("waka_live_settings_submit"),
    lastUsedAt: null,
    revokedAt: null,
  });
});

test(
  "POST route creates a one-time API key secret for an authenticated user",
  { concurrency: false },
  async () => {
    const { POST } = await import("../apps/web/app/api/api-keys/route.ts");
    const { client, createCalls } = createInMemoryApiKeyPersistenceClient();
    const membershipLookup = createMembershipLookupClient({
      tenantId: "tenant-11",
      workspaceId: "workspace-11",
    });

    configureCreateApiKeyRouteDependencies({
      apiKeyPersistenceClient: client,
      membershipClient: membershipLookup.client,
      sessionProvider: createSessionProvider({
        userId: "user-11",
        tenantId: "tenant-11",
        workspaceId: "workspace-11",
      }),
    });

    try {
      const response = await POST(
        new Request("https://waka.app/api/api-keys", {
          method: "POST",
          body: JSON.stringify({
            name: "CLI route key",
          }),
          headers: {
            "content-type": "application/json",
          },
        }) as never,
      );
      const body = await response.json();

      assert.equal(response.status, CREATE_API_KEY_ROUTE_CREATED_STATUS);
      assert.equal(body.apiKey.workspaceId, "workspace-11");
      assert.equal(createCalls.length, 1);
      assert.equal(createCalls[0]?.userId, "user-11");
      assert.equal(typeof body.plainKey, "string");
      assert.equal(body.plainKey.startsWith("waka_live_"), true);
      assert.equal(createCalls[0]?.hashedKey, hashApiKey(body.plainKey));
    } finally {
      configureCreateApiKeyRouteDependencies(null);
    }
  },
);

test(
  "POST route rejects API key secret creation when authentication is missing",
  { concurrency: false },
  async () => {
    const { POST } = await import("../apps/web/app/api/api-keys/route.ts");
    const { client, createCalls } = createInMemoryApiKeyPersistenceClient();

    configureCreateApiKeyRouteDependencies({
      apiKeyPersistenceClient: client,
      membershipClient: createMembershipLookupClient(null).client,
      sessionProvider: createSessionProvider(null),
    });

    try {
      const response = await POST(
        new Request("https://waka.app/api/api-keys", {
          method: "POST",
          body: JSON.stringify({
            name: "CLI route key",
          }),
          headers: {
            "content-type": "application/json",
          },
        }) as never,
      );

      assert.equal(response.status, CREATE_API_KEY_ROUTE_UNAUTHORIZED_STATUS);
      assert.deepEqual(await response.json(), {
        error: CREATE_API_KEY_ROUTE_UNAUTHORIZED_ERROR,
      });
      assert.equal(createCalls.length, 0);
    } finally {
      configureCreateApiKeyRouteDependencies(null);
    }
  },
);
