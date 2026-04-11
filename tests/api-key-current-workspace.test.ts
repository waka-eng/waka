import assert from "node:assert/strict";
import test from "node:test";

import { hashApiKey } from "../apps/web/src/auth/api-key.ts";
import {
  createCurrentWorkspaceApiKey,
  fetchCurrentWorkspaceApiKey,
  listCurrentWorkspaceApiKeys,
  MissingCurrentWorkspaceApiKeyScopeError,
  requireCurrentWorkspaceApiKeyScope,
  revokeCurrentWorkspaceApiKey,
  rotateCurrentWorkspaceApiKey,
  type CurrentWorkspaceApiKeyScopeResolver,
} from "../apps/web/src/auth/api-key-current-workspace.ts";
import {
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
    name: overrides.name ?? "CLI key",
    description: overrides.description ?? "Workspace-scoped key",
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

function createInMemoryApiKeyPersistenceClient(
  initialRecords: StoredApiKeyRecord[] = [],
): {
  client: ApiKeyPersistenceClient<StoredApiKeyRecord>;
  createCalls: ApiKeyCreateData[];
  updateCalls: Array<{ where: { id: string }; data: ApiKeyUpdateData }>;
  records: StoredApiKeyRecord[];
} {
  const records = [...initialRecords];
  const createCalls: ApiKeyCreateData[] = [];
  const updateCalls: Array<{ where: { id: string }; data: ApiKeyUpdateData }> = [];

  const client: ApiKeyPersistenceClient<StoredApiKeyRecord> = {
    apiKey: {
      async create({ data }) {
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
      async findFirst({ where }) {
        return records.find((record) => matchesWhere(record, where)) ?? null;
      },
      async findMany({ where, orderBy }) {
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
      async update({ where, data }) {
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
  };

  return {
    client,
    createCalls,
    updateCalls,
    records,
  };
}

function createScopeResolver(
  scope: Awaited<
    ReturnType<CurrentWorkspaceApiKeyScopeResolver["resolveCurrentWorkspaceApiKeyScope"]>
  >,
): CurrentWorkspaceApiKeyScopeResolver {
  return {
    async resolveCurrentWorkspaceApiKeyScope() {
      return scope;
    },
  };
}

test("requireCurrentWorkspaceApiKeyScope rejects writes without an active membership scope", async () => {
  await assert.rejects(
    requireCurrentWorkspaceApiKeyScope(createScopeResolver(null)),
    MissingCurrentWorkspaceApiKeyScopeError,
  );
});

test("createCurrentWorkspaceApiKey persists hashed secret and metadata for the resolved user workspace", async () => {
  const { client, createCalls } = createInMemoryApiKeyPersistenceClient();
  const plainKey = "waka_live_currentWorkspace";

  const result = await createCurrentWorkspaceApiKey(
    client,
    createScopeResolver({
      userId: "user-77",
      tenantId: "tenant-7",
      workspaceId: "workspace-9",
    }),
    {
      name: "CLI laptop",
      description: "MacBook capture key",
      metadata: {
        device: "macbook-pro",
        surface: "cli",
      },
    },
    {
      plainKey,
    },
  );

  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    userId: "user-77",
    tenantId: "tenant-7",
    workspaceId: "workspace-9",
    name: "CLI laptop",
    description: "MacBook capture key",
    keyPrefix: deriveApiKeyPrefix(plainKey),
    metadata: {
      device: "macbook-pro",
      surface: "cli",
    },
    hashedKey: hashApiKey(plainKey),
    lastUsedAt: null,
    revokedAt: null,
  });
  assert.equal("hashedKey" in result.apiKey, false);
  assert.equal(result.apiKey.workspaceId, "workspace-9");
  assert.equal(result.plainKey, plainKey);
});

test("createCurrentWorkspaceApiKey keeps created key secrets isolated to the owning user workspace", async () => {
  const { client, records } = createInMemoryApiKeyPersistenceClient();
  const ownerResolver = createScopeResolver({
    userId: "user-owner",
    tenantId: "tenant-42",
    workspaceId: "workspace-owner",
  });
  const otherWorkspaceResolver = createScopeResolver({
    userId: "user-owner",
    tenantId: "tenant-42",
    workspaceId: "workspace-other",
  });
  const otherUserResolver = createScopeResolver({
    userId: "user-other",
    tenantId: "tenant-42",
    workspaceId: "workspace-owner",
  });

  const createdRecord = await createCurrentWorkspaceApiKey(
    client,
    ownerResolver,
    {
      name: "Owner CLI key",
      description: "Only the active workspace should see this key",
      metadata: {
        device: "macbook-pro",
        surface: "cli",
      },
    },
    {
      plainKey: "waka_live_ownerScopedKey",
    },
  );

  const ownerVisibleRecord = await fetchCurrentWorkspaceApiKey(
    client,
    ownerResolver,
    {
      apiKeyId: createdRecord.apiKey.id,
    },
  );
  const otherWorkspaceVisibleRecord = await fetchCurrentWorkspaceApiKey(
    client,
    otherWorkspaceResolver,
    {
      apiKeyId: createdRecord.apiKey.id,
    },
  );
  const otherUserVisibleRecord = await fetchCurrentWorkspaceApiKey(
    client,
    otherUserResolver,
    {
      apiKeyId: createdRecord.apiKey.id,
    },
  );
  const ownerRecords = await listCurrentWorkspaceApiKeys(client, ownerResolver);
  const otherWorkspaceRecords = await listCurrentWorkspaceApiKeys(
    client,
    otherWorkspaceResolver,
  );
  const otherUserRecords = await listCurrentWorkspaceApiKeys(client, otherUserResolver);

  assert.equal(records.length, 1);
  assert.equal(records[0]?.userId, "user-owner");
  assert.equal(records[0]?.tenantId, "tenant-42");
  assert.equal(records[0]?.workspaceId, "workspace-owner");
  assert.equal(records[0]?.hashedKey, hashApiKey("waka_live_ownerScopedKey"));
  assert.ok(ownerVisibleRecord);
  assert.equal(ownerVisibleRecord.id, createdRecord.apiKey.id);
  assert.equal("hashedKey" in ownerVisibleRecord, false);
  assert.equal(otherWorkspaceVisibleRecord, null);
  assert.equal(otherUserVisibleRecord, null);
  assert.deepEqual(
    ownerRecords.map((record) => record.id),
    [createdRecord.apiKey.id],
  );
  assert.deepEqual(otherWorkspaceRecords, []);
  assert.deepEqual(otherUserRecords, []);
});

test("fetchCurrentWorkspaceApiKey and listCurrentWorkspaceApiKeys stay bound to the resolved workspace", async () => {
  const { client } = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-visible",
      userId: "user-2",
      tenantId: "tenant-2",
      workspaceId: "workspace-a",
      createdAt: new Date("2026-04-10T00:00:00.000Z"),
    }),
    createStoredApiKeyRecord({
      id: "key-hidden",
      userId: "user-2",
      tenantId: "tenant-2",
      workspaceId: "workspace-b",
      createdAt: new Date("2026-04-10T00:00:05.000Z"),
    }),
  ]);
  const resolver = createScopeResolver({
    userId: "user-2",
    tenantId: "tenant-2",
    workspaceId: "workspace-a",
  });

  const visibleRecord = await fetchCurrentWorkspaceApiKey(client, resolver, {
    apiKeyId: "key-visible",
  });
  const hiddenRecord = await fetchCurrentWorkspaceApiKey(client, resolver, {
    apiKeyId: "key-hidden",
  });
  const records = await listCurrentWorkspaceApiKeys(client, resolver);

  assert.ok(visibleRecord);
  assert.equal(visibleRecord.id, "key-visible");
  assert.equal("hashedKey" in visibleRecord, false);
  assert.equal(hiddenRecord, null);
  assert.deepEqual(
    records.map((record) => record.id),
    ["key-visible"],
  );
});

test("revokeCurrentWorkspaceApiKey and rotateCurrentWorkspaceApiKey update only the resolved workspace record", async () => {
  const revokedAt = new Date("2026-04-10T02:00:00.000Z");
  const { client, createCalls, updateCalls, records } =
    createInMemoryApiKeyPersistenceClient([
      createStoredApiKeyRecord({
        id: "key-active",
        userId: "user-8",
        tenantId: "tenant-4",
        workspaceId: "workspace-6",
        name: "Active key",
      }),
      createStoredApiKeyRecord({
        id: "key-rotate",
        userId: "user-8",
        tenantId: "tenant-4",
        workspaceId: "workspace-6",
        name: "Rotate key",
      }),
      createStoredApiKeyRecord({
        id: "key-other-workspace",
        userId: "user-8",
        tenantId: "tenant-4",
        workspaceId: "workspace-7",
      }),
    ]);
  const resolver = createScopeResolver({
    userId: "user-8",
    tenantId: "tenant-4",
    workspaceId: "workspace-6",
  });

  const revokedRecord = await revokeCurrentWorkspaceApiKey(
    client,
    resolver,
    { apiKeyId: "key-active" },
    { revokedAt },
  );
  const rotatedRecord = await rotateCurrentWorkspaceApiKey(
    client,
    resolver,
    {
      apiKeyId: "key-rotate",
      description: "Replacement key",
    },
    {
      plainKey: "waka_live_replacement",
      revokedAt,
    },
  );

  assert.ok(revokedRecord);
  assert.equal(revokedRecord.revokedAt?.toISOString(), revokedAt.toISOString());
  assert.ok(rotatedRecord);
  assert.equal(rotatedRecord.apiKey.workspaceId, "workspace-6");
  assert.equal(rotatedRecord.previousApiKey.workspaceId, "workspace-6");
  assert.equal(createCalls.at(-1)?.hashedKey, hashApiKey("waka_live_replacement"));
  assert.equal(updateCalls[0]?.where.id, "key-active");
  assert.equal(updateCalls[1]?.where.id, "key-rotate");
  assert.equal(records.some((record) => record.id === "key-other-workspace"), true);
});
