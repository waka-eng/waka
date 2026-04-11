import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createSettingsApiKeyRevokeConfirmationMessage,
  createSettingsApiKeysCreateFormViewModel,
  createSettingsApiKeysSectionViewModel,
  SETTINGS_API_KEYS_EMPTY_MESSAGE,
  SETTINGS_API_KEYS_EMPTY_TITLE,
  SETTINGS_API_KEYS_LOADING_MESSAGE,
  SETTINGS_API_KEYS_REVOKE_ACTION_LABEL,
  SETTINGS_API_KEYS_SECTION_TITLE,
  upsertSettingsApiKey,
} from "../apps/web/app/(app)/settings/settings-page-model.ts";
import { submitSettingsApiKeyCreateForm } from "../apps/web/app/(app)/settings/actions.ts";
import { API_KEY_CREATE_NAME_FIELD } from "../apps/web/src/auth/api-key-form-fields.ts";
import { loadCurrentWorkspaceSettingsApiKeys } from "../apps/web/src/auth/api-key-settings-loader.ts";
import type {
  ApiKeyPersistenceClient,
  ApiKeyRecordWhere,
  StoredApiKeyRecord,
} from "../apps/web/src/auth/api-key-persistence.ts";
import type { CurrentWorkspaceApiKeyScopeResolver } from "../apps/web/src/auth/api-key-current-workspace.ts";
import { hashApiKey } from "../apps/web/src/auth/api-key.ts";

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
  const keyPrefix = overrides.keyPrefix ?? "waka_live_demo";

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
    keyPrefix,
    metadata: overrides.metadata ?? { surface: "settings" },
    hashedKey: overrides.hashedKey ?? hashApiKey(`${keyPrefix}_secret`),
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
        throw new Error("settings page rendering should not create API keys");
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
        throw new Error("settings page rendering should not revoke API keys");
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

test("settings page API keys section renders only active workspace keys", async () => {
  const viewModel = createSettingsApiKeysSectionViewModel(
    await loadCurrentWorkspaceSettingsApiKeys({
      apiKeyPersistenceClient: createInMemoryApiKeyPersistenceClient([
        createStoredApiKeyRecord({
          id: "key-active",
          name: "Desktop capture",
          description: "Office machine",
          keyPrefix: "waka_live_desktop",
          metadata: {
            deviceName: "Office iMac",
            platform: "macOS",
            surface: "settings",
          },
          createdAt: new Date("2026-04-10T02:00:00.000Z"),
          updatedAt: new Date("2026-04-10T02:00:00.000Z"),
          lastUsedAt: new Date("2026-04-10T03:00:00.000Z"),
        }),
        createStoredApiKeyRecord({
          id: "key-revoked",
          name: "CLI laptop",
          description: null,
          keyPrefix: "waka_live_laptop",
          metadata: {
            deviceName: "MacBook Pro",
            surface: "cli",
          },
          createdAt: new Date("2026-04-10T01:00:00.000Z"),
          updatedAt: new Date("2026-04-10T01:00:00.000Z"),
          revokedAt: new Date("2026-04-10T04:00:00.000Z"),
        }),
      ]),
      currentWorkspaceScopeResolver: createScopeResolver({
        userId: "user-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
      }),
    }),
  );

  assert.equal(viewModel.title, SETTINGS_API_KEYS_SECTION_TITLE);
  assert.equal(viewModel.isEmpty, false);
  assert.equal(viewModel.apiKeys.length, 1);
  assert.deepEqual(viewModel.apiKeys[0], {
    id: "key-active",
    name: "Desktop capture",
    keyPrefix: "waka_live_desktop",
    description: "Office machine",
    deviceSummary: "Office iMac · macOS · settings",
    isRevoked: false,
    statusLabel: "Active",
    createdLabel: "Apr 10, 2026, 2:00 AM UTC",
    lastUsedLabel: "Apr 10, 2026, 3:00 AM UTC",
    revokedLabel: "Never",
  });
  assert.equal(
    viewModel.apiKeys.some((apiKey) => apiKey.id === "key-revoked"),
    false,
  );
});

test("settings page API keys section renders an empty state when no keys exist", async () => {
  const viewModel = createSettingsApiKeysSectionViewModel(
    await loadCurrentWorkspaceSettingsApiKeys({
      apiKeyPersistenceClient: createInMemoryApiKeyPersistenceClient([]),
      currentWorkspaceScopeResolver: createScopeResolver({
        userId: "user-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
      }),
    }),
  );

  assert.equal(viewModel.isEmpty, true);
  assert.equal(viewModel.emptyTitle, SETTINGS_API_KEYS_EMPTY_TITLE);
  assert.equal(viewModel.emptyMessage, SETTINGS_API_KEYS_EMPTY_MESSAGE);
  assert.deepEqual(viewModel.apiKeys, []);
});

test("settings page API keys section renders an empty state when every key is revoked", async () => {
  const viewModel = createSettingsApiKeysSectionViewModel(
    await loadCurrentWorkspaceSettingsApiKeys({
      apiKeyPersistenceClient: createInMemoryApiKeyPersistenceClient([
        createStoredApiKeyRecord({
          id: "key-revoked",
          revokedAt: new Date("2026-04-10T04:00:00.000Z"),
        }),
      ]),
      currentWorkspaceScopeResolver: createScopeResolver({
        userId: "user-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
      }),
    }),
  );

  assert.equal(viewModel.isEmpty, true);
  assert.equal(viewModel.emptyTitle, SETTINGS_API_KEYS_EMPTY_TITLE);
  assert.equal(viewModel.emptyMessage, SETTINGS_API_KEYS_EMPTY_MESSAGE);
  assert.deepEqual(viewModel.apiKeys, []);
});

test("settings page loading state keeps the API keys section visible while data resolves", () => {
  assert.equal(SETTINGS_API_KEYS_LOADING_MESSAGE, "Loading your keys...");
});

test("settings page API keys section includes a create-key form with a name field and submit action", () => {
  const form = createSettingsApiKeysCreateFormViewModel();

  assert.equal(form.action, "/api/api-keys");
  assert.equal(form.method, "post");
  assert.equal(form.nameField.name, API_KEY_CREATE_NAME_FIELD);
  assert.equal(form.nameField.type, "text");
  assert.equal(form.nameField.label, "Name");
  assert.equal(form.submitLabel, "Create key");
});

test("settings page revoke confirmation message names the targeted key", () => {
  assert.equal(
    createSettingsApiKeyRevokeConfirmationMessage("CLI laptop"),
    'Revoke "CLI laptop"? This key will stop working immediately.',
  );
  assert.equal(
    createSettingsApiKeyRevokeConfirmationMessage("   "),
    "Revoke this API key? This key will stop working immediately.",
  );
});

test("settings page prepends the newly created key to the rendered list state", () => {
  const viewModel = createSettingsApiKeysSectionViewModel(
    upsertSettingsApiKey(
      {
        apiKeys: [
          createStoredApiKeyRecord({
            id: "key-existing",
            name: "Existing CLI",
            createdAt: new Date("2026-04-10T01:00:00.000Z"),
            updatedAt: new Date("2026-04-10T01:00:00.000Z"),
          }),
        ],
      },
      createStoredApiKeyRecord({
        id: "key-new",
        name: "Phone capture",
        keyPrefix: "waka_live_phone",
        createdAt: new Date("2026-04-10T02:00:00.000Z"),
        updatedAt: new Date("2026-04-10T02:00:00.000Z"),
      }),
    ),
  );

  assert.deepEqual(
    viewModel.apiKeys.map((apiKey) => apiKey.id),
    ["key-new", "key-existing"],
  );
  assert.equal(viewModel.apiKeys[0]?.name, "Phone capture");
});

test("settings page removes the revoked key entry after a revoke response returns the same key id", () => {
  const viewModel = createSettingsApiKeysSectionViewModel(
    upsertSettingsApiKey(
      {
        apiKeys: [
          createStoredApiKeyRecord({
            id: "key-active",
            name: "Existing CLI",
            createdAt: new Date("2026-04-10T02:00:00.000Z"),
            updatedAt: new Date("2026-04-10T02:00:00.000Z"),
          }),
          createStoredApiKeyRecord({
            id: "key-older",
            name: "Older key",
            createdAt: new Date("2026-04-10T01:00:00.000Z"),
            updatedAt: new Date("2026-04-10T01:00:00.000Z"),
          }),
        ],
      },
      createStoredApiKeyRecord({
        id: "key-active",
        name: "Existing CLI",
        createdAt: new Date("2026-04-10T02:00:00.000Z"),
        updatedAt: new Date("2026-04-10T04:00:00.000Z"),
        revokedAt: new Date("2026-04-10T04:00:00.000Z"),
      }),
    ),
  );

  assert.deepEqual(
    viewModel.apiKeys.map((apiKey) => apiKey.id),
    ["key-older"],
  );
});

test("settings page create-key form is wired to the server action bridge and refreshes after success", () => {
  const settingsPageSource = readFileSync(
    "apps/web/app/(app)/settings/settings-api-keys-client.tsx",
    "utf8",
  );

  assert.match(settingsPageSource, /submitSettingsApiKeyCreateForm/u);
  assert.match(settingsPageSource, /router\.refresh\(\)/u);
  assert.equal(typeof submitSettingsApiKeyCreateForm, "function");
});

test("settings page renders revoke controls for each API key entry and wires them to the revoke action bridge", () => {
  const settingsPageSource = readFileSync(
    "apps/web/app/(app)/settings/settings-api-keys-client.tsx",
    "utf8",
  );

  assert.equal(SETTINGS_API_KEYS_REVOKE_ACTION_LABEL, "Revoke key");
  assert.match(settingsPageSource, /createSettingsApiKeyRevokeConfirmationMessage/u);
  assert.match(
    settingsPageSource,
    /window\.confirm\(createSettingsApiKeyRevokeConfirmationMessage\(apiKeyName\)\)/u,
  );
  assert.match(
    settingsPageSource,
    /if \(!confirmApiKeyRevocation\(apiKeyName\)\) \{\s+return;\s+\}/u,
  );
  assert.match(settingsPageSource, /submitSettingsApiKeyRevoke/u);
  assert.match(settingsPageSource, /handleRevokeApiKey/u);
  assert.match(settingsPageSource, /SETTINGS_API_KEYS_REVOKE_ACTION_LABEL/u);
  assert.match(settingsPageSource, /type="button"/u);
  assert.match(
    settingsPageSource,
    /disabled=\{apiKey\.isRevoked \|\| isRevoking\}/u,
  );
  assert.match(
    settingsPageSource,
    /useEffect\(\(\) => \{\s+setData\(initialData\);\s+\}, \[initialData\]\);/u,
  );
});
