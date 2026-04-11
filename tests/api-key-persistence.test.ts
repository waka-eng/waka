import assert from "node:assert/strict";
import test from "node:test";

import {
  API_KEY_PLAINTEXT_PREFIX,
  extractApiKeySecret,
  hashApiKey,
} from "../apps/web/src/auth/api-key.ts";
import {
  API_KEY_SECRET_PREFIX,
  createApiKeyMaterial,
  createApiKey,
  createApiKeyAuthStore,
  createApiKeyPersistenceRepository,
  deriveApiKeyPrefix,
  fetchApiKey,
  generatePlainApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  type ApiKeyCreateData,
  type ApiKeyPersistenceClient,
  type ApiKeyRecordWhere,
  type ApiKeySafeRecord,
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

  if (where.revokedAt !== undefined && record.revokedAt !== where.revokedAt) {
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
    metadata:
      overrides.metadata ?? {
        device: "macbook-pro",
      },
    hashedKey:
      overrides.hashedKey ?? hashApiKey(`${overrides.keyPrefix ?? "waka_live_demo"}_secret`),
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
  transactionCalls: number;
  records: StoredApiKeyRecord[];
} {
  const records = [...initialRecords];
  const createCalls: ApiKeyCreateData[] = [];
  const updateCalls: Array<{ where: { id: string }; data: ApiKeyUpdateData }> = [];
  let transactionCalls = 0;

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
    async $transaction(operation) {
      transactionCalls += 1;

      return operation(client);
    },
  };

  return {
    client,
    createCalls,
    updateCalls,
    get transactionCalls() {
      return transactionCalls;
    },
    records,
  };
}

function assertSafeRecord(record: ApiKeySafeRecord): void {
  assert.equal("hashedKey" in record, false);
  assert.equal("plainKey" in (record as Record<string, unknown>), false);
}

function assertPersistedRecordStoresOnlyHashedSecret(
  record: StoredApiKeyRecord,
  plainKey: string,
): void {
  const serializedRecord = JSON.stringify(record);
  const secret = extractApiKeySecret(plainKey);

  assert.equal(record.hashedKey, hashApiKey(plainKey));
  assert.equal("plainKey" in record, false);
  assert.equal("secret" in (record as Record<string, unknown>), false);
  assert.equal(serializedRecord.includes(plainKey), false);
  assert.equal(serializedRecord.includes(secret), false);
}

function assertNoPlaintextKeyExposure(
  value: unknown,
  plainKey: string,
): void {
  const serializedValue = JSON.stringify(value);
  const secret = extractApiKeySecret(plainKey);

  assert.equal(serializedValue.includes(plainKey), false);
  assert.equal(serializedValue.includes(secret), false);
}

test("generatePlainApiKey creates a key in the expected public format", () => {
  const plainKey = generatePlainApiKey();

  assert.ok(plainKey.startsWith(API_KEY_SECRET_PREFIX));
  assert.match(plainKey, /^waka_live_[A-Za-z0-9_-]+$/u);
  assert.ok(extractApiKeySecret(plainKey).length > 0);
});

test("createApiKeyMaterial derives the plain key, prefix, secret, and hashed secret", () => {
  const plainKey = `${API_KEY_PLAINTEXT_PREFIX}createdKey`;
  const material = createApiKeyMaterial(plainKey);

  assert.deepEqual(material, {
    plainKey,
    secret: "createdKey",
    keyPrefix: deriveApiKeyPrefix(plainKey),
    hashedKey: hashApiKey(plainKey),
  });
});

test("createApiKey persists only the hashed secret and returns a metadata-safe result", async () => {
  const { client, createCalls, records } = createInMemoryApiKeyPersistenceClient();
  const plainKey = "waka_live_createdKey_shouldNeverPersist";

  const result = await createApiKey(
    client,
    {
      userId: "user-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
      name: "Primary CLI key",
      description: "Created from settings",
      metadata: {
        device: "macbook",
        platform: "darwin",
      },
    },
    {
      plainKey,
    },
  );

  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    userId: "user-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    name: "Primary CLI key",
    description: "Created from settings",
    keyPrefix: deriveApiKeyPrefix(plainKey),
    metadata: {
      device: "macbook",
      platform: "darwin",
    },
    hashedKey: hashApiKey(plainKey),
    lastUsedAt: null,
    revokedAt: null,
  });
  assert.equal("plainKey" in createCalls[0], false);
  assert.equal(records.length, 1);
  assertPersistedRecordStoresOnlyHashedSecret(records[0]!, plainKey);
  assert.equal(result.plainKey, plainKey);
  assertSafeRecord(result.apiKey);
  assert.equal(result.apiKey.keyPrefix, deriveApiKeyPrefix(plainKey));
});

test("fetchApiKey scopes reads to the user workspace and strips secret material", async () => {
  const { client } = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-visible",
      userId: "user-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    }),
    createStoredApiKeyRecord({
      id: "key-hidden",
      userId: "user-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-2",
    }),
  ]);

  const record = await fetchApiKey(client, {
    apiKeyId: "key-visible",
    userId: "user-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
  });
  const missingRecord = await fetchApiKey(client, {
    apiKeyId: "key-hidden",
    userId: "user-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
  });

  assert.ok(record);
  assertSafeRecord(record);
  assert.equal(record.id, "key-visible");
  assert.equal(missingRecord, null);
});

test("listApiKeys returns only scoped records ordered by newest first", async () => {
  const { client } = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-older",
      createdAt: new Date("2026-04-10T00:00:00.000Z"),
      updatedAt: new Date("2026-04-10T00:00:00.000Z"),
    }),
    createStoredApiKeyRecord({
      id: "key-newer",
      createdAt: new Date("2026-04-10T00:00:05.000Z"),
      updatedAt: new Date("2026-04-10T00:00:05.000Z"),
    }),
    createStoredApiKeyRecord({
      id: "key-other-workspace",
      workspaceId: "workspace-2",
    }),
  ]);

  const records = await listApiKeys(client, {
    userId: "user-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
  });

  assert.deepEqual(
    records.map((record) => record.id),
    ["key-newer", "key-older"],
  );
  for (const record of records) {
    assertSafeRecord(record);
  }
});

test("createApiKey returns plaintext only once and never through later fetch, list, or auth lookup paths", async () => {
  const persistence = createInMemoryApiKeyPersistenceClient();
  const plainKey = "waka_live_lookupRegression";

  const creationResult = await createApiKey(
    persistence.client,
    {
      userId: "user-lookup",
      tenantId: "tenant-lookup",
      workspaceId: "workspace-lookup",
      name: "Lookup regression key",
      description: null,
      metadata: {
        surface: "settings",
      },
    },
    {
      plainKey,
    },
  );
  const fetchedRecord = await fetchApiKey(persistence.client, {
    apiKeyId: creationResult.apiKey.id,
    userId: "user-lookup",
    tenantId: "tenant-lookup",
    workspaceId: "workspace-lookup",
  });
  const listedRecords = await listApiKeys(persistence.client, {
    userId: "user-lookup",
    tenantId: "tenant-lookup",
    workspaceId: "workspace-lookup",
  });
  const authLookup = await createApiKeyAuthStore(
    persistence.client,
  ).findApiKeyByHashedKey(hashApiKey(plainKey));

  assert.equal(creationResult.plainKey, plainKey);
  assert.ok(fetchedRecord);
  assertSafeRecord(fetchedRecord);
  assert.deepEqual(
    listedRecords.map((record) => record.id),
    [creationResult.apiKey.id],
  );
  listedRecords.forEach((record) => assertSafeRecord(record));
  assert.deepEqual(authLookup, {
    id: creationResult.apiKey.id,
    userId: "user-lookup",
    revokedAt: null,
  });
  assertNoPlaintextKeyExposure(fetchedRecord, plainKey);
  assertNoPlaintextKeyExposure(listedRecords, plainKey);
  assertNoPlaintextKeyExposure(authLookup, plainKey);
});

test("revokeApiKey revokes active keys within scope and is idempotent for revoked records", async () => {
  const revokedAt = new Date("2026-04-10T01:00:00.000Z");
  const { client, updateCalls } = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-active",
      revokedAt: null,
    }),
    createStoredApiKeyRecord({
      id: "key-revoked",
      revokedAt: new Date("2026-04-09T23:59:00.000Z"),
    }),
  ]);

  const revokedRecord = await revokeApiKey(
    client,
    {
      apiKeyId: "key-active",
      userId: "user-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    },
    {
      revokedAt,
    },
  );
  const alreadyRevokedRecord = await revokeApiKey(client, {
    apiKeyId: "key-revoked",
    userId: "user-1",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
  });

  assert.ok(revokedRecord);
  assertSafeRecord(revokedRecord);
  assert.equal(revokedRecord.revokedAt?.toISOString(), revokedAt.toISOString());
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0]?.where.id, "key-active");
  assert.ok(alreadyRevokedRecord);
  assert.equal(
    alreadyRevokedRecord.revokedAt?.toISOString(),
    "2026-04-09T23:59:00.000Z",
  );
});

test("rotateApiKey revokes the previous key, creates a replacement, and keeps plaintext secret material out of persisted records", async () => {
  const revokedAt = new Date("2026-04-10T02:00:00.000Z");
  const persistenceClient = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-rotate",
      userId: "user-7",
      tenantId: "tenant-9",
      workspaceId: "workspace-5",
      name: "Work laptop",
      description: "Old key",
      metadata: {
        device: "linux",
      },
    }),
  ]);
  const plainKey = "waka_live_rotatedKey_shouldNeverPersist";

  const result = await rotateApiKey(
    persistenceClient.client,
    {
      apiKeyId: "key-rotate",
      userId: "user-7",
      tenantId: "tenant-9",
      workspaceId: "workspace-5",
      description: "Rotated key",
    },
    {
      plainKey,
      revokedAt,
    },
  );

  assert.ok(result);
  assert.equal(persistenceClient.transactionCalls, 1);
  assert.equal(result.plainKey, plainKey);
  assertSafeRecord(result.previousApiKey);
  assertSafeRecord(result.apiKey);
  assert.equal(
    result.previousApiKey.revokedAt?.toISOString(),
    revokedAt.toISOString(),
  );
  assert.equal(result.apiKey.description, "Rotated key");
  assert.equal(persistenceClient.updateCalls.length, 1);
  assert.equal(persistenceClient.updateCalls[0]?.where.id, "key-rotate");
  assert.equal(persistenceClient.createCalls.length, 1);
  assert.equal(
    persistenceClient.createCalls[0]?.hashedKey,
    hashApiKey(plainKey),
  );
  assert.equal(persistenceClient.records.length, 2);
  assertPersistedRecordStoresOnlyHashedSecret(
    persistenceClient.records[1]!,
    plainKey,
  );
});

test("rotateApiKey only exposes the replacement plaintext in the rotate result and not later reads", async () => {
  const persistence = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-rotate-readback",
      userId: "user-rotate",
      tenantId: "tenant-rotate",
      workspaceId: "workspace-rotate",
      name: "Rotating key",
    }),
  ]);
  const rotatedPlainKey = "waka_live_rotateReadback";

  const rotationResult = await rotateApiKey(
    persistence.client,
    {
      apiKeyId: "key-rotate-readback",
      userId: "user-rotate",
      tenantId: "tenant-rotate",
      workspaceId: "workspace-rotate",
    },
    {
      plainKey: rotatedPlainKey,
    },
  );

  assert.ok(rotationResult);
  const fetchedReplacement = await fetchApiKey(persistence.client, {
    apiKeyId: rotationResult.apiKey.id,
    userId: "user-rotate",
    tenantId: "tenant-rotate",
    workspaceId: "workspace-rotate",
  });
  const listedRecords = await listApiKeys(persistence.client, {
    userId: "user-rotate",
    tenantId: "tenant-rotate",
    workspaceId: "workspace-rotate",
  });
  const authLookup = await createApiKeyAuthStore(
    persistence.client,
  ).findApiKeyByHashedKey(hashApiKey(rotatedPlainKey));

  assert.equal(rotationResult.plainKey, rotatedPlainKey);
  assert.ok(fetchedReplacement);
  assertSafeRecord(fetchedReplacement);
  listedRecords.forEach((record) => assertSafeRecord(record));
  assert.deepEqual(authLookup, {
    id: rotationResult.apiKey.id,
    userId: "user-rotate",
    revokedAt: null,
  });
  assertNoPlaintextKeyExposure(fetchedReplacement, rotatedPlainKey);
  assertNoPlaintextKeyExposure(listedRecords, rotatedPlainKey);
  assertNoPlaintextKeyExposure(authLookup, rotatedPlainKey);
});

test("createApiKeyAuthStore looks up hashed keys and records lastUsedAt updates", async () => {
  const { client, updateCalls } = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-auth",
      userId: "user-auth",
      hashedKey: hashApiKey("waka_live_auth"),
    }),
  ]);
  const authStore = createApiKeyAuthStore(client);
  const usedAt = new Date("2026-04-10T03:00:00.000Z");

  const record = await authStore.findApiKeyByHashedKey(hashApiKey("waka_live_auth"));

  assert.deepEqual(record, {
    id: "key-auth",
    userId: "user-auth",
    revokedAt: null,
  });

  await authStore.markApiKeyUsed("key-auth", usedAt);

  assert.deepEqual(updateCalls.at(-1), {
    where: {
      id: "key-auth",
    },
    data: {
      lastUsedAt: usedAt,
    },
  });
});

test("createApiKeyAuthStore excludes revoked keys from active authentication lookups", async () => {
  const revokedAt = new Date("2026-04-10T03:30:00.000Z");
  const { client } = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-revoked-auth",
      userId: "user-auth",
      hashedKey: hashApiKey("waka_live_revoked_auth"),
      revokedAt,
    }),
  ]);
  const authStore = createApiKeyAuthStore(client);

  const activeLookup = await authStore.findApiKeyByHashedKey(
    hashApiKey("waka_live_revoked_auth"),
  );
  const inactiveLookup = await authStore.findInactiveApiKeyByHashedKey?.(
    hashApiKey("waka_live_revoked_auth"),
  );

  assert.equal(activeLookup, null);
  assert.deepEqual(inactiveLookup, {
    id: "key-revoked-auth",
    userId: "user-auth",
    revokedAt,
  });
});

test("createApiKeyPersistenceRepository adapts a repository root for create and rotate flows", async () => {
  const persistenceClient = createInMemoryApiKeyPersistenceClient([
    createStoredApiKeyRecord({
      id: "key-rotate",
      userId: "user-14",
      tenantId: "tenant-14",
      workspaceId: "workspace-14",
      name: "Workstation key",
      description: "Original key",
      metadata: {
        device: "linux",
      },
    }),
  ]);
  const repository = createApiKeyPersistenceRepository({
    apiKey: persistenceClient.client.apiKey,
    async $transaction(operation) {
      return operation({
        apiKey: persistenceClient.client.apiKey,
      });
    },
  });
  const plainKey = "waka_live_repositoryCreated";
  const rotatedKey = "waka_live_repositoryRotated";

  const createdResult = await createApiKey(
    repository,
    {
      userId: "user-14",
      tenantId: "tenant-14",
      workspaceId: "workspace-14",
      name: "CLI key",
      description: "Created through repository adapter",
      metadata: {
        surface: "cli",
      },
    },
    {
      plainKey,
    },
  );
  const rotatedResult = await rotateApiKey(
    repository,
    {
      apiKeyId: "key-rotate",
      userId: "user-14",
      tenantId: "tenant-14",
      workspaceId: "workspace-14",
    },
    {
      plainKey: rotatedKey,
    },
  );

  assert.equal(createdResult.plainKey, plainKey);
  assertSafeRecord(createdResult.apiKey);
  assert.equal(
    persistenceClient.createCalls[0]?.hashedKey,
    hashApiKey(plainKey),
  );
  assert.ok(rotatedResult);
  assert.equal(rotatedResult.plainKey, rotatedKey);
  assert.equal(
    persistenceClient.createCalls.at(-1)?.hashedKey,
    hashApiKey(rotatedKey),
  );
  assertSafeRecord(rotatedResult.apiKey);
  assertSafeRecord(rotatedResult.previousApiKey);
});
