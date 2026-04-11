import assert from "node:assert/strict";
import test from "node:test";

import {
  API_KEY_CREATE_METADATA_INVALID_ERROR,
  API_KEY_CREATE_NAME_REQUIRED_ERROR,
  createApiKeyAction,
  normalizeCreateApiKeyActionInput,
  parseCreateApiKeyRequestBody,
  toApiKeyRecordResponse,
} from "../apps/web/src/auth/api-key-issuance.ts";
import { hashApiKey } from "../apps/web/src/auth/api-key.ts";
import {
  deriveApiKeyPrefix,
  type ApiKeyCreateData,
  type ApiKeyPersistenceClient,
  type ApiKeyRecordWhere,
  type ApiKeySafeRecord,
  type ApiKeyUpdateData,
  type StoredApiKeyRecord,
} from "../apps/web/src/auth/api-key-persistence.ts";
import type { CurrentWorkspaceApiKeyScopeResolver } from "../apps/web/src/auth/api-key-current-workspace.ts";

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

function assertSafeRecord(record: ApiKeySafeRecord): void {
  assert.equal("hashedKey" in record, false);
  assert.equal("plainKey" in record, false);
}

test("normalizeCreateApiKeyActionInput trims object fields and preserves JSON metadata", () => {
  assert.deepEqual(
    normalizeCreateApiKeyActionInput({
      name: "  CLI laptop  ",
      description: "  MacBook capture key  ",
      metadata: {
        device: "macbook-pro",
      },
    }),
    {
      name: "CLI laptop",
      description: "MacBook capture key",
      metadata: {
        device: "macbook-pro",
      },
    },
  );
});

test("parseCreateApiKeyRequestBody strips client-supplied ownership fields", () => {
  const parsedBody = parseCreateApiKeyRequestBody({
    userId: "forged-user",
    tenantId: "forged-tenant",
    workspaceId: "forged-workspace",
    name: "  CLI laptop  ",
    description: "  MacBook capture key  ",
    metadata: {
      device: "macbook-pro",
    },
  });

  assert.deepEqual(parsedBody, {
    name: "CLI laptop",
    description: "MacBook capture key",
    metadata: {
      device: "macbook-pro",
    },
  });
  assert.equal("userId" in parsedBody, false);
  assert.equal("tenantId" in parsedBody, false);
  assert.equal("workspaceId" in parsedBody, false);
});

test("normalizeCreateApiKeyActionInput parses FormData metadata JSON and normalizes blank description to null", () => {
  const formData = new FormData();
  formData.set("name", "  CLI laptop  ");
  formData.set("description", "   ");
  formData.set("metadata", JSON.stringify({ device: "iphone", surface: "pwa" }));

  assert.deepEqual(normalizeCreateApiKeyActionInput(formData), {
    name: "CLI laptop",
    description: null,
    metadata: {
      device: "iphone",
      surface: "pwa",
    },
  });
});

test("normalizeCreateApiKeyActionInput rejects blank key names", () => {
  assert.throws(
    () =>
      normalizeCreateApiKeyActionInput({
        name: "   ",
      }),
    new Error(API_KEY_CREATE_NAME_REQUIRED_ERROR),
  );
});

test("normalizeCreateApiKeyActionInput rejects invalid metadata JSON", () => {
  const formData = new FormData();
  formData.set("name", "CLI laptop");
  formData.set("metadata", "{invalid");

  assert.throws(
    () => normalizeCreateApiKeyActionInput(formData),
    new Error(API_KEY_CREATE_METADATA_INVALID_ERROR),
  );
});

test("createApiKeyAction issues a workspace-scoped key and returns the plaintext key only in the create response", async () => {
  const { client, createCalls } = createInMemoryApiKeyPersistenceClient();
  const plainKey = "waka_live_createdFromAction";
  const action = createApiKeyAction(
    {
      apiKeyPersistenceClient: client,
      currentWorkspaceScopeResolver: createScopeResolver({
        userId: "user-7",
        tenantId: "tenant-7",
        workspaceId: "workspace-9",
      }),
    },
    {
      plainKey,
    },
  );

  const result = await action({
    name: "  CLI laptop  ",
    description: "  MacBook capture key  ",
    metadata: {
      device: "macbook-pro",
      surface: "cli",
    },
  });

  assert.equal(createCalls.length, 1);
  assert.deepEqual(createCalls[0], {
    userId: "user-7",
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
  assert.equal("plainKey" in createCalls[0], false);
  assert.equal(result.plainKey, plainKey);
  assertSafeRecord(result.apiKey);
});

test("createApiKeyAction only exposes plaintext key material during creation", async () => {
  const { client, records } = createInMemoryApiKeyPersistenceClient();
  const plainKey = "waka_live_oneTimeOnly";
  const action = createApiKeyAction(
    {
      apiKeyPersistenceClient: client,
      currentWorkspaceScopeResolver: createScopeResolver({
        userId: "user-8",
        tenantId: "tenant-8",
        workspaceId: "workspace-8",
      }),
    },
    {
      plainKey,
    },
  );

  const result = await action({
    name: "CLI laptop",
  });
  const persistedResponse = toApiKeyRecordResponse(records[0]!);

  assert.equal(result.plainKey, plainKey);
  assert.deepEqual(persistedResponse.apiKey, result.apiKey);
  assert.equal("plainKey" in persistedResponse, false);
  assert.equal("plainKey" in persistedResponse.apiKey, false);
  assert.equal("plainKey" in records[0]!, false);
  assert.equal("hashedKey" in persistedResponse.apiKey, false);
});

test("toApiKeyRecordResponse never includes plaintext key material", () => {
  const response = toApiKeyRecordResponse(
    createStoredApiKeyRecord({
      id: "key-visible",
      hashedKey: hashApiKey("waka_live_visible"),
    }),
  );

  assertSafeRecord(response.apiKey);
  assert.equal("plainKey" in response, false);
});
