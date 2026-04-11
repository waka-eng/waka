import assert from "node:assert/strict";
import test from "node:test";

import {
  createApiKeyForCurrentWorkspace,
  createCurrentWorkspaceApiKeyCreationService,
} from "../apps/web/src/auth/api-key-creation-service.ts";
import {
  createCurrentWorkspaceApiKeyScopeResolver,
  MissingCurrentWorkspaceApiKeyScopeError,
  type CurrentWorkspaceApiKeySessionLike,
  type CurrentWorkspaceMembershipLookupClient,
} from "../apps/web/src/auth/api-key-current-workspace.ts";
import { hashApiKey } from "../apps/web/src/auth/api-key.ts";
import {
  createApiKeyPersistenceRepository,
  deriveApiKeyPrefix,
  type ApiKeyCreateData,
  type ApiKeyPersistenceClient,
  type ApiKeyRecordWhere,
  type ApiKeyUpdateData,
  type StoredApiKeyRecord,
} from "../apps/web/src/auth/api-key-persistence.ts";

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

  return {
    id: overrides.id ?? "key-1",
    userId: overrides.userId ?? "user-1",
    tenantId: overrides.tenantId ?? "tenant-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    name: overrides.name ?? "CLI laptop",
    description: overrides.description ?? "Default workstation key",
    keyPrefix: overrides.keyPrefix ?? "waka_live_demo",
    metadata: overrides.metadata ?? { device: "macbook-pro" },
    hashedKey:
      overrides.hashedKey ??
      hashApiKey(`${overrides.keyPrefix ?? "waka_live_demo"}_secret`),
    lastUsedAt: overrides.lastUsedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
  };
}

function createInMemoryApiKeyRepository(
  initialRecords: StoredApiKeyRecord[] = [],
): {
  createCalls: ApiKeyCreateData[];
  records: StoredApiKeyRecord[];
  repository: ApiKeyPersistenceClient<StoredApiKeyRecord>;
  updateCalls: Array<{ where: { id: string }; data: ApiKeyUpdateData }>;
} {
  const records = [...initialRecords];
  const createCalls: ApiKeyCreateData[] = [];
  const updateCalls: Array<{ where: { id: string }; data: ApiKeyUpdateData }> = [];

  const root = {
    apiKey: {
      async create({ data }: { data: ApiKeyCreateData }) {
        createCalls.push(data);

        const timestamp = new Date("2026-04-10T00:00:10.000Z");
        const createdRecord: StoredApiKeyRecord = {
          id: `key-${records.length + 1}`,
          ...data,
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        records.push(createdRecord);

        return createdRecord;
      },
      async findFirst({ where }: { where: ApiKeyRecordWhere }) {
        return records.find((record) => matchesWhere(record, where)) ?? null;
      },
      async findMany({
        where,
        orderBy,
      }: {
        where: ApiKeyRecordWhere;
        orderBy: Array<{ createdAt: "asc" | "desc" }>;
      }) {
        const filteredRecords = records.filter((record) => matchesWhere(record, where));
        const [firstOrder] = orderBy;

        if (firstOrder?.createdAt === "desc") {
          return [...filteredRecords].sort(
            (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
          );
        }

        return [...filteredRecords].sort(
          (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
        );
      },
      async update({
        where,
        data,
      }: {
        where: { id: string };
        data: ApiKeyUpdateData;
      }) {
        updateCalls.push({ where, data });

        const recordIndex = records.findIndex((record) => record.id === where.id);

        if (recordIndex === -1) {
          throw new Error(`API key ${where.id} was not found`);
        }

        const nextRecord: StoredApiKeyRecord = {
          ...records[recordIndex],
          ...data,
          updatedAt: new Date("2026-04-10T00:00:20.000Z"),
        };

        records[recordIndex] = nextRecord;

        return nextRecord;
      },
    },
    async $transaction<T>(
      operation: (
        client: {
          apiKey: {
            create(args: { data: ApiKeyCreateData }): Promise<StoredApiKeyRecord>;
            findFirst(args: { where: ApiKeyRecordWhere }): Promise<StoredApiKeyRecord | null>;
            findMany(args: {
              where: ApiKeyRecordWhere;
              orderBy: Array<{ createdAt: "asc" | "desc" }>;
            }): Promise<StoredApiKeyRecord[]>;
            update(args: {
              where: { id: string };
              data: ApiKeyUpdateData;
            }): Promise<StoredApiKeyRecord>;
          };
        },
      ) => Promise<T>,
    ): Promise<T> {
      return operation(root);
    },
  };

  return {
    createCalls,
    records,
    repository: createApiKeyPersistenceRepository(root),
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

test("createCurrentWorkspaceApiKeyScopeResolver validates the active workspace on the session against membership", async () => {
  const membershipLookup = createMembershipLookupClient({
    tenantId: "tenant-session",
    workspaceId: "workspace-session",
  });
  const resolver = createCurrentWorkspaceApiKeyScopeResolver({
    membershipClient: membershipLookup.client,
    sessionProvider: createSessionProvider({
      userId: "user-4",
      tenantId: "tenant-session",
      workspaceId: "workspace-session",
    }),
  });

  const scope = await resolver.resolveCurrentWorkspaceApiKeyScope();

  assert.deepEqual(scope, {
    userId: "user-4",
    tenantId: "tenant-session",
    workspaceId: "workspace-session",
  });
  assert.deepEqual(membershipLookup.lookups, [
    {
      where: {
        userId: "user-4",
        tenantId: "tenant-session",
        workspaceId: "workspace-session",
      },
      orderBy: [{ createdAt: "desc" }],
    },
  ]);
});

test("createCurrentWorkspaceApiKeyScopeResolver falls back to the latest membership for the signed-in user", async () => {
  const membershipLookup = createMembershipLookupClient({
    tenantId: "tenant-fallback",
    workspaceId: "workspace-fallback",
  });
  const resolver = createCurrentWorkspaceApiKeyScopeResolver({
    membershipClient: membershipLookup.client,
    sessionProvider: createSessionProvider({
      user: {
        id: "user-8",
      },
    }),
  });

  const scope = await resolver.resolveCurrentWorkspaceApiKeyScope();

  assert.deepEqual(scope, {
    userId: "user-8",
    tenantId: "tenant-fallback",
    workspaceId: "workspace-fallback",
  });
  assert.deepEqual(membershipLookup.lookups, [
    {
      where: {
        userId: "user-8",
      },
      orderBy: [{ createdAt: "desc" }],
    },
  ]);
});

test("createCurrentWorkspaceApiKeyScopeResolver rejects active workspace scopes that do not belong to the signed-in user", async () => {
  const membershipLookup = createMembershipLookupClient([
    {
      createdAt: new Date("2026-04-10T00:00:00.000Z"),
      tenantId: "tenant-allowed",
      workspaceId: "workspace-allowed",
    },
    {
      createdAt: new Date("2026-04-10T00:00:10.000Z"),
      tenantId: "tenant-latest",
      workspaceId: "workspace-latest",
    },
  ]);
  const resolver = createCurrentWorkspaceApiKeyScopeResolver({
    membershipClient: membershipLookup.client,
    sessionProvider: createSessionProvider({
      userId: "user-9",
      tenantId: "tenant-forged",
      workspaceId: "workspace-forged",
    }),
  });

  const scope = await resolver.resolveCurrentWorkspaceApiKeyScope();

  assert.equal(scope, null);
  assert.deepEqual(membershipLookup.lookups, [
    {
      where: {
        userId: "user-9",
        tenantId: "tenant-forged",
        workspaceId: "workspace-forged",
      },
      orderBy: [{ createdAt: "desc" }],
    },
  ]);
});

test("createApiKeyForCurrentWorkspace persists only hashed key material and returns the one-time plaintext value", async () => {
  const persistence = createInMemoryApiKeyRepository();
  const plainKey = "waka_live_serviceCreated";
  const creationResult = await createApiKeyForCurrentWorkspace(
    {
      apiKeyRepository: persistence.repository,
      currentWorkspaceScopeResolver: createCurrentWorkspaceApiKeyScopeResolver({
        membershipClient: createMembershipLookupClient({
          tenantId: "tenant-11",
          workspaceId: "workspace-11",
        }).client,
        sessionProvider: createSessionProvider({
          userId: "user-11",
          tenantId: "tenant-11",
          workspaceId: "workspace-11",
        }),
      }),
    },
    {
      name: "CLI capture key",
      description: "MacBook auth",
      metadata: {
        surface: "cli",
        device: "macbook-pro",
      },
    },
    {
      plainKey,
    },
  );

  assert.deepEqual(persistence.createCalls[0], {
    userId: "user-11",
    tenantId: "tenant-11",
    workspaceId: "workspace-11",
    name: "CLI capture key",
    description: "MacBook auth",
    keyPrefix: deriveApiKeyPrefix(plainKey),
    metadata: {
      surface: "cli",
      device: "macbook-pro",
    },
    hashedKey: hashApiKey(plainKey),
    lastUsedAt: null,
    revokedAt: null,
  });
  assert.equal("plainKey" in persistence.createCalls[0], false);
  assert.equal(creationResult.plainKey, plainKey);
  assert.equal("hashedKey" in creationResult.apiKey, false);
});

test("createCurrentWorkspaceApiKeyCreationService creates a workspace-scoped key for an authenticated membership", async () => {
  const persistence = createInMemoryApiKeyRepository();
  const plainKey = "waka_live_serviceWrapper";
  const service = createCurrentWorkspaceApiKeyCreationService({
    apiKeyRepository: persistence.repository,
    currentWorkspaceScopeResolver: createCurrentWorkspaceApiKeyScopeResolver({
      membershipClient: createMembershipLookupClient({
        tenantId: "tenant-12",
        workspaceId: "workspace-12",
      }).client,
      sessionProvider: createSessionProvider({
        userId: "user-12",
        tenantId: "tenant-12",
        workspaceId: "workspace-12",
      }),
    }),
  });

  const creationResult = await service.create(
    {
      name: "CLI capture key",
      description: "Desk machine auth",
      metadata: {
        surface: "cli",
        device: "macbook-pro",
      },
    },
    {
      plainKey,
    },
  );

  assert.deepEqual(persistence.createCalls[0], {
    userId: "user-12",
    tenantId: "tenant-12",
    workspaceId: "workspace-12",
    name: "CLI capture key",
    description: "Desk machine auth",
    keyPrefix: deriveApiKeyPrefix(plainKey),
    metadata: {
      surface: "cli",
      device: "macbook-pro",
    },
    hashedKey: hashApiKey(plainKey),
    lastUsedAt: null,
    revokedAt: null,
  });
  assert.equal(creationResult.plainKey, plainKey);
  assert.equal("hashedKey" in creationResult.apiKey, false);
  assert.equal(creationResult.apiKey.workspaceId, "workspace-12");
});

test("createCurrentWorkspaceApiKeyCreationService rejects forged workspace sessions without persisting a key", async () => {
  const persistence = createInMemoryApiKeyRepository();
  const membershipLookup = createMembershipLookupClient([
    {
      createdAt: new Date("2026-04-10T00:00:00.000Z"),
      tenantId: "tenant-allowed",
      workspaceId: "workspace-allowed",
    },
  ]);
  const service = createCurrentWorkspaceApiKeyCreationService({
    apiKeyRepository: persistence.repository,
    currentWorkspaceScopeResolver: createCurrentWorkspaceApiKeyScopeResolver({
      membershipClient: membershipLookup.client,
      sessionProvider: createSessionProvider({
        userId: "user-13",
        tenantId: "tenant-forged",
        workspaceId: "workspace-forged",
      }),
    }),
  });

  await assert.rejects(
    service.create({
      name: "CLI capture key",
    }),
    MissingCurrentWorkspaceApiKeyScopeError,
  );

  assert.deepEqual(membershipLookup.lookups, [
    {
      where: {
        userId: "user-13",
        tenantId: "tenant-forged",
        workspaceId: "workspace-forged",
      },
      orderBy: [{ createdAt: "desc" }],
    },
  ]);
  assert.equal(persistence.createCalls.length, 0);
  assert.deepEqual(persistence.records, []);
});

test("createCurrentWorkspaceApiKeyCreationService rejects creation when the current session has no workspace scope", async () => {
  const persistence = createInMemoryApiKeyRepository([
    createStoredApiKeyRecord(),
  ]);
  const service = createCurrentWorkspaceApiKeyCreationService({
    apiKeyRepository: persistence.repository,
    currentWorkspaceScopeResolver: createCurrentWorkspaceApiKeyScopeResolver({
      membershipClient: createMembershipLookupClient(null).client,
      sessionProvider: createSessionProvider({
        userId: "user-without-membership",
      }),
    }),
  });

  await assert.rejects(
    service.create({
      name: "CLI capture key",
    }),
    MissingCurrentWorkspaceApiKeyScopeError,
  );
});
