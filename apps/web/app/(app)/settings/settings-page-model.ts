import { API_KEY_CREATE_NAME_FIELD } from "../../../src/auth/api-key-form-fields.ts";
import type { SettingsApiKeysData } from "../../../src/auth/api-key-settings-loader.ts";
import type { ApiKeySafeRecord, JsonValue } from "../../../src/auth/api-key-persistence.ts";

export const SETTINGS_API_KEYS_SECTION_TITLE = "API Keys";
export const SETTINGS_API_KEYS_SECTION_DESCRIPTION =
  "Manage the API keys that let the CLI and other tools save into this workspace.";
export const SETTINGS_API_KEYS_EMPTY_TITLE = "No keys yet";
export const SETTINGS_API_KEYS_EMPTY_MESSAGE =
  "Create a key to connect the CLI or another tool.";
export const SETTINGS_API_KEYS_LOADING_MESSAGE =
  "Loading your keys...";
export const SETTINGS_API_KEYS_MISSING_DESCRIPTION = "No description provided.";
export const SETTINGS_API_KEYS_MISSING_DEVICE_METADATA = "No device info";
export const SETTINGS_API_KEYS_CREATE_FORM_ACTION = "/api/api-keys";
export const SETTINGS_API_KEYS_CREATE_FORM_METHOD = "post";
export const SETTINGS_API_KEYS_CREATE_FORM_TITLE = "Create API key";
export const SETTINGS_API_KEYS_CREATE_FORM_DESCRIPTION =
  "Give this key a name you'll recognize later. You'll only see the full key once.";
export const SETTINGS_API_KEYS_CREATE_FORM_HINT =
  "Use a separate key for each device or integration.";
export const SETTINGS_API_KEYS_CREATE_FORM_NAME_LABEL = "Name";
export const SETTINGS_API_KEYS_CREATE_FORM_NAME_PLACEHOLDER = "MacBook Pro";
export const SETTINGS_API_KEYS_CREATE_FORM_SUBMIT_LABEL = "Create key";
export const SETTINGS_API_KEYS_CREATE_FORM_SUBMIT_PENDING_LABEL = "Creating key...";
export const SETTINGS_API_KEYS_REVOKE_ACTION_LABEL = "Revoke key";
export const SETTINGS_API_KEYS_REVOKE_ACTION_PENDING_LABEL = "Revoking...";
export const SETTINGS_API_KEYS_REVOKED_ACTION_LABEL = "Revoked";
export const SETTINGS_API_KEYS_REVOKE_CONFIRMATION_FALLBACK_NAME = "this API key";
export const SETTINGS_API_KEYS_REVOKE_CONFIRMATION_SUFFIX =
  "This key will stop working immediately.";

export interface SettingsApiKeysCreateFormFieldViewModel {
  autoComplete: "off";
  id: string;
  label: string;
  minLength: number;
  name: string;
  placeholder: string;
  required: true;
  type: "text";
}

export interface SettingsApiKeysCreateFormViewModel {
  action: string;
  description: string;
  hint: string;
  method: "post";
  nameField: SettingsApiKeysCreateFormFieldViewModel;
  submitLabel: string;
  title: string;
}

export interface SettingsApiKeyListItemViewModel {
  id: string;
  name: string;
  keyPrefix: string;
  description: string;
  deviceSummary: string;
  isRevoked: boolean;
  statusLabel: "Active" | "Revoked";
  createdLabel: string;
  lastUsedLabel: string;
  revokedLabel: string;
}

export interface SettingsApiKeysSectionViewModel {
  title: string;
  description: string;
  isEmpty: boolean;
  emptyTitle: string | null;
  emptyMessage: string | null;
  apiKeys: SettingsApiKeyListItemViewModel[];
}

export function createSettingsApiKeysCreateFormViewModel(): SettingsApiKeysCreateFormViewModel {
  return {
    action: SETTINGS_API_KEYS_CREATE_FORM_ACTION,
    description: SETTINGS_API_KEYS_CREATE_FORM_DESCRIPTION,
    hint: SETTINGS_API_KEYS_CREATE_FORM_HINT,
    method: SETTINGS_API_KEYS_CREATE_FORM_METHOD,
    nameField: {
      autoComplete: "off",
      id: API_KEY_CREATE_NAME_FIELD,
      label: SETTINGS_API_KEYS_CREATE_FORM_NAME_LABEL,
      minLength: 1,
      name: API_KEY_CREATE_NAME_FIELD,
      placeholder: SETTINGS_API_KEYS_CREATE_FORM_NAME_PLACEHOLDER,
      required: true,
      type: "text",
    },
    submitLabel: SETTINGS_API_KEYS_CREATE_FORM_SUBMIT_LABEL,
    title: SETTINGS_API_KEYS_CREATE_FORM_TITLE,
  };
}

export function createSettingsApiKeyRevokeConfirmationMessage(apiKeyName: string): string {
  const normalizedApiKeyName = apiKeyName.trim();
  const keyLabel =
    normalizedApiKeyName.length > 0
      ? `"${normalizedApiKeyName}"`
      : SETTINGS_API_KEYS_REVOKE_CONFIRMATION_FALLBACK_NAME;

  return `Revoke ${keyLabel}? ${SETTINGS_API_KEYS_REVOKE_CONFIRMATION_SUFFIX}`;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

function getJsonRecord(
  value: JsonValue | null,
): Record<string, JsonValue> | null {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    return null;
  }

  return value;
}

function readMetadataString(
  metadata: JsonValue | null,
  field: string,
): string | null {
  const record = getJsonRecord(metadata);

  if (record === null) {
    return null;
  }

  const value = record[field];

  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function formatDateTime(value: Date | null): string {
  if (value === null) {
    return "Never";
  }

  return `${dateTimeFormatter.format(value)} UTC`;
}

function toSettingsApiKeyListItemViewModel(
  apiKey: ApiKeySafeRecord,
): SettingsApiKeyListItemViewModel {
  const deviceName = readMetadataString(apiKey.metadata, "deviceName");
  const platform = readMetadataString(apiKey.metadata, "platform");
  const surface = readMetadataString(apiKey.metadata, "surface");

  return {
    id: apiKey.id,
    name: apiKey.name,
    keyPrefix: apiKey.keyPrefix,
    description: apiKey.description ?? SETTINGS_API_KEYS_MISSING_DESCRIPTION,
    deviceSummary:
      [deviceName, platform, surface].filter(
        (value): value is string => value !== null,
      ).join(" · ") || SETTINGS_API_KEYS_MISSING_DEVICE_METADATA,
    isRevoked: apiKey.revokedAt !== null,
    statusLabel: apiKey.revokedAt === null ? "Active" : "Revoked",
    createdLabel: formatDateTime(apiKey.createdAt),
    lastUsedLabel: formatDateTime(apiKey.lastUsedAt),
    revokedLabel: formatDateTime(apiKey.revokedAt),
  };
}

function isVisibleSettingsApiKey(apiKey: ApiKeySafeRecord): boolean {
  return apiKey.revokedAt === null;
}

export function createSettingsApiKeysSectionViewModel(
  data: SettingsApiKeysData,
): SettingsApiKeysSectionViewModel {
  const apiKeys = data.apiKeys
    .filter((apiKey) => isVisibleSettingsApiKey(apiKey))
    .map((apiKey) => toSettingsApiKeyListItemViewModel(apiKey));

  return {
    title: SETTINGS_API_KEYS_SECTION_TITLE,
    description: SETTINGS_API_KEYS_SECTION_DESCRIPTION,
    isEmpty: apiKeys.length === 0,
    emptyTitle: apiKeys.length === 0 ? SETTINGS_API_KEYS_EMPTY_TITLE : null,
    emptyMessage: apiKeys.length === 0 ? SETTINGS_API_KEYS_EMPTY_MESSAGE : null,
    apiKeys,
  };
}

export function upsertSettingsApiKey(
  data: SettingsApiKeysData,
  apiKey: ApiKeySafeRecord,
): SettingsApiKeysData {
  return {
    apiKeys: [apiKey, ...data.apiKeys.filter((record) => record.id !== apiKey.id)].sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    ),
  };
}
