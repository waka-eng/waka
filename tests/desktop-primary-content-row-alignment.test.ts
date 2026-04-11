import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createSettingsApiKeysSectionViewModel,
  SETTINGS_API_KEYS_MISSING_DESCRIPTION,
} from "../apps/web/app/(app)/settings/settings-page-model.ts";
import type { ApiKeySafeRecord } from "../apps/web/src/auth/api-key-persistence.ts";

const WEB_APP_ROOT = path.join(process.cwd(), "apps/web");
const SETTINGS_API_KEYS_CLIENT_PATH = path.join(
  WEB_APP_ROOT,
  "app/(app)/settings/settings-api-keys-client.tsx",
);
const WORKSPACE_HOME_SCREEN_PATH = path.join(
  WEB_APP_ROOT,
  "src/home/workspace-home-screen.tsx",
);

function createApiKeySafeRecord(
  overrides: Partial<ApiKeySafeRecord> = {},
): ApiKeySafeRecord {
  const createdAt = overrides.createdAt ?? new Date("2026-04-10T00:00:00.000Z");

  return {
    id: overrides.id ?? "key-1",
    userId: overrides.userId ?? "user-1",
    tenantId: overrides.tenantId ?? "tenant-1",
    workspaceId: overrides.workspaceId ?? "workspace-1",
    name: overrides.name ?? "Desktop capture",
    description:
      overrides.description === undefined
        ? "Primary desktop auth"
        : overrides.description,
    keyPrefix: overrides.keyPrefix ?? "waka_live_desktop",
    metadata: overrides.metadata ?? {
      deviceName: "Studio Display Mac",
      platform: "macOS",
      surface: "settings",
    },
    lastUsedAt: overrides.lastUsedAt ?? null,
    revokedAt: overrides.revokedAt ?? null,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
  };
}

test("desktop rows keep settings metadata and recent-record actions aligned in the light layout", () => {
  const settingsSource = readFileSync(SETTINGS_API_KEYS_CLIENT_PATH, "utf8");
  const workspaceHomeSource = readFileSync(WORKSPACE_HOME_SCREEN_PATH, "utf8");

  assert.match(
    settingsSource,
    /className="grid min-w-0 gap-3 sm:grid-cols-\[minmax\(0,1fr\)_auto\] sm:items-start"/u,
  );
  assert.match(
    settingsSource,
    /const metadataListClassName =\s*"mt-4 grid min-w-0 gap-3 text-sm text-stone-600 min-\[56rem\]:grid-cols-\[repeat\(auto-fit,minmax\(9rem,1fr\)\)\]";/u,
  );
  assert.match(
    workspaceHomeSource,
    /data-section="recent-records"[\s\S]*Open a note only when you need detail/u,
  );
  assert.match(
    workspaceHomeSource,
    /data-record-detail-list-action=\{item\.id\}[\s\S]*widestLabel="Viewing detail"/u,
  );
  assert.match(
    workspaceHomeSource,
    /data-record-detail-dismiss="true"[\s\S]*Close note/u,
  );
});

test("filtered settings rows still preserve the active-key summary after revoked keys are removed", () => {
  const settingsSource = readFileSync(SETTINGS_API_KEYS_CLIENT_PATH, "utf8");
  const viewModel = createSettingsApiKeysSectionViewModel({
    apiKeys: [
      createApiKeySafeRecord({
        id: "key-active",
        name: "Desktop capture",
        description: null,
      }),
      createApiKeySafeRecord({
        id: "key-revoked",
        name: "Old laptop",
        revokedAt: new Date("2026-04-10T03:00:00.000Z"),
      }),
    ],
  });

  assert.equal(viewModel.isEmpty, false);
  assert.deepEqual(
    viewModel.apiKeys.map((apiKey) => ({
      description: apiKey.description,
      name: apiKey.name,
      statusLabel: apiKey.statusLabel,
    })),
    [
      {
        description: SETTINGS_API_KEYS_MISSING_DESCRIPTION,
        name: "Desktop capture",
        statusLabel: "Active",
      },
    ],
  );
  assert.match(settingsSource, /renderApiKeyListItem/u);
});
