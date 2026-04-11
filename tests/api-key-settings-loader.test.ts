import assert from "node:assert/strict";
import test from "node:test";

import {
  createCurrentWorkspaceSettingsApiKeysLoader,
  loadCurrentWorkspaceSettingsApiKeys,
} from "../apps/web/src/auth/api-key-settings-loader.ts";
import {
  MissingCurrentWorkspaceApiKeyScopeError,
  type CurrentWorkspaceApiKeyScopeResolver,
} from "../apps/web/src/auth/api-key-current-workspace.ts";
import { hashApiKey } from "../apps/web/src/auth/api-key.ts";
import type {
  ApiKeyPersistenceClient,
  ApiKeyRecordWhere,
  StoredApiKeyRecord,
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
    description:
      overrides.description === undefined
        ? "Default API key"
        : overrides.description,
    keyPrefix: overrides.keyPrefix ?? "waka_live_demo",
    metadata: overrides.metadata ?? { surface: "settings" },
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
  initialRecords: StoredApiKeyRecord[],
): ApiKeyPersistenceClient<StoredApiKeyRecord> {
  const records = [...initialRecords];

  return {
    apiKey: {
      async create() {
        throw new Error("create should not be called by the settings loader");
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
      async update() {
        throw new Error("update should not be called by the settings loader");
      },
    },
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

test("loadCurrentWorkspaceSettingsApiKeys returns the current workspace keys with display metadata", async () => {
  const response = await loadCurrentWorkspaceSettingsApiKeys({
    apiKeyPersistenceClient: createInMemoryApiKeyPersistenceClient([
      createStoredApiKeyRecord({
        id: "key-newest",
        createdAt: new Date("2026-04-10T02:00:00.000Z"),
        updatedAt: new Date("2026-04-10T02:00:00.000Z"),
        name: "Desktop capture",
        description: "Office machine",
        keyPrefix: "waka_live_desktop",
        metadata: {
          deviceName: "Office iMac",
          platform: "macOS",
          surface: "settings",
        },
        lastUsedAt: new Date("2026-04-10T03:00:00.000Z"),
      }),
      createStoredApiKeyRecord({
        id: "key-older",
        createdAt: new Date("2026-04-10T01:00:00.000Z"),
        updatedAt: new Date("2026-04-10T01:00:00.000Z"),
        name: "CLI laptop",
        description: null,
        keyPrefix: "waka_live_laptop",
        metadata: {
          deviceName: "MacBook Pro",
          surface: "cli",
        },
        revokedAt: new Date("2026-04-10T04:00:00.000Z"),
      }),
      createStoredApiKeyRecord({
        id: "key-other-workspace",
        workspaceId: "workspace-2",
        createdAt: new Date("2026-04-10T05:00:00.000Z"),
        keyPrefix: "waka_live_hidden",
      }),
    ]),
    currentWorkspaceScopeResolver: createScopeResolver({
      userId: "user-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    }),
  });

  assert.deepEqual(response, {
    apiKeys: [
      {
        id: "key-newest",
        userId: "user-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        name: "Desktop capture",
        description: "Office machine",
        keyPrefix: "waka_live_desktop",
        metadata: {
          deviceName: "Office iMac",
          platform: "macOS",
          surface: "settings",
        },
        lastUsedAt: new Date("2026-04-10T03:00:00.000Z"),
        revokedAt: null,
        createdAt: new Date("2026-04-10T02:00:00.000Z"),
        updatedAt: new Date("2026-04-10T02:00:00.000Z"),
      },
      {
        id: "key-older",
        userId: "user-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        name: "CLI laptop",
        description: null,
        keyPrefix: "waka_live_laptop",
        metadata: {
          deviceName: "MacBook Pro",
          surface: "cli",
        },
        lastUsedAt: null,
        revokedAt: new Date("2026-04-10T04:00:00.000Z"),
        createdAt: new Date("2026-04-10T01:00:00.000Z"),
        updatedAt: new Date("2026-04-10T01:00:00.000Z"),
      },
    ],
  });
});

test("createCurrentWorkspaceSettingsApiKeysLoader returns a reusable settings-side loader", async () => {
  const loadSettingsApiKeys = createCurrentWorkspaceSettingsApiKeysLoader({
    apiKeyPersistenceClient: createInMemoryApiKeyPersistenceClient([
      createStoredApiKeyRecord({
        id: "key-1",
        metadata: {
          surface: "web",
        },
      }),
    ]),
    currentWorkspaceScopeResolver: createScopeResolver({
      userId: "user-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    }),
  });

  assert.deepEqual(await loadSettingsApiKeys(), {
    apiKeys: [
      {
        id: "key-1",
        userId: "user-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        name: "CLI laptop",
        description: "Default API key",
        keyPrefix: "waka_live_demo",
        metadata: {
          surface: "web",
        },
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date("2026-04-10T00:00:00.000Z"),
        updatedAt: new Date("2026-04-10T00:00:00.000Z"),
      },
    ],
  });
});

test("loadCurrentWorkspaceSettingsApiKeys rejects when the user has no current workspace scope", async () => {
  await assert.rejects(
    loadCurrentWorkspaceSettingsApiKeys({
      apiKeyPersistenceClient: createInMemoryApiKeyPersistenceClient([]),
      currentWorkspaceScopeResolver: createScopeResolver(null),
    }),
    MissingCurrentWorkspaceApiKeyScopeError,
  );
});

test("settings actions keep the server-action bridge focused on mutations", async () => {
  const settingsActions = await import("../apps/web/app/(app)/settings/actions.ts");

  assert.equal(
    "loadCurrentWorkspaceSettingsApiKeys" in settingsActions,
    false,
  );
  assert.equal(
    "createCurrentWorkspaceSettingsApiKeysLoader" in settingsActions,
    false,
  );
  assert.equal(typeof settingsActions.submitSettingsApiKeyCreateForm, "function");
  assert.equal(typeof settingsActions.submitSettingsApiKeyRevoke, "function");
});
