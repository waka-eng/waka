"use server";

import {
  CREATE_API_KEY_ROUTE_CREATED_STATUS,
  handleCreateApiKeyRouteRequest,
  type CreateApiKeyRouteErrorResponse,
  type HandleCreateApiKeyRouteRequestOptions,
} from "../../../src/auth/api-key-create-route.ts";
import {
  REVOKE_API_KEY_ROUTE_OK_STATUS,
  handleRevokeApiKeyRouteRequest,
  type HandleRevokeApiKeyRouteRequestOptions,
} from "../../../src/auth/api-key-revoke-route.ts";
import {
  API_KEY_REVOKE_ID_REQUIRED_ERROR,
  type RevokeApiKeyActionResult as SettingsRevokeApiKeyActionResult,
} from "../../../src/auth/api-key-revocation.ts";
import type {
  ApiKeySafeRecord,
  JsonValue,
} from "../../../src/auth/api-key-persistence.ts";
import type { CreateApiKeyActionResult as SettingsCreateApiKeyActionResult } from "../../../src/auth/api-key-issuance.ts";

import { SETTINGS_API_KEYS_CREATE_FORM_ACTION } from "./settings-page-model.ts";

const DEFAULT_SETTINGS_API_KEY_REQUEST_URL = "http://localhost:3000";

function resolveSettingsApiKeyRequestUrl(): string {
  const configuredAppUrl =
    typeof process.env.APP_URL === "string" && process.env.APP_URL.trim().length > 0
      ? process.env.APP_URL
      : DEFAULT_SETTINGS_API_KEY_REQUEST_URL;

  return new URL(
    SETTINGS_API_KEYS_CREATE_FORM_ACTION,
    configuredAppUrl,
  ).toString();
}

async function readCreateApiKeyActionError(
  response: Response,
): Promise<string> {
  const payload = (await response.json()) as Partial<CreateApiKeyRouteErrorResponse>;

  return typeof payload.error === "string" && payload.error.trim().length > 0
    ? payload.error
    : `API key creation failed with status ${response.status}`;
}

function readDateValue(value: unknown): Date {
  const nextValue = new Date(
    typeof value === "string" || value instanceof Date ? value : Number.NaN,
  );

  if (Number.isNaN(nextValue.getTime())) {
    throw new Error("API key creation returned an invalid timestamp.");
  }

  return nextValue;
}

function readNullableDateValue(value: unknown): Date | null {
  return value === null ? null : readDateValue(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeCreateApiKeyActionResult(
  payload: unknown,
): SettingsCreateApiKeyActionResult {
  return {
    plainKey: readCreateApiKeyActionResultPlainKey(payload),
    apiKey: normalizeApiKeySafeRecordPayload(payload),
  };
}

function normalizeApiKeySafeRecordPayload(
  payload: unknown,
): ApiKeySafeRecord {
  if (!isRecord(payload) || !isRecord(payload.apiKey)) {
    throw new Error("API key action returned an invalid response body.");
  }

  const { apiKey } = payload;

  return {
    id: String(apiKey.id),
    userId: String(apiKey.userId),
    tenantId: String(apiKey.tenantId),
    workspaceId: String(apiKey.workspaceId),
    name: String(apiKey.name),
    description:
      typeof apiKey.description === "string" ? apiKey.description : null,
    keyPrefix: String(apiKey.keyPrefix),
    metadata: (apiKey.metadata ?? null) as JsonValue | null,
    lastUsedAt: readNullableDateValue(apiKey.lastUsedAt),
    revokedAt: readNullableDateValue(apiKey.revokedAt),
    createdAt: readDateValue(apiKey.createdAt),
    updatedAt: readDateValue(apiKey.updatedAt),
  } satisfies ApiKeySafeRecord;
}

function readCreateApiKeyActionResultPlainKey(payload: unknown): string {
  if (!isRecord(payload)) {
    throw new Error("API key creation returned an invalid response body.");
  }

  if (typeof payload.plainKey !== "string") {
    throw new Error("API key creation returned an invalid plaintext key.");
  }

  return payload.plainKey;
}

export async function submitSettingsApiKeyCreateFormToBackend(
  formData: FormData,
  options: HandleCreateApiKeyRouteRequestOptions = {},
): Promise<SettingsCreateApiKeyActionResult> {
  const response = await handleCreateApiKeyRouteRequest(
    new Request(resolveSettingsApiKeyRequestUrl(), {
      method: "POST",
      body: formData,
    }),
    options,
  );

  if (response.status === CREATE_API_KEY_ROUTE_CREATED_STATUS) {
    return normalizeCreateApiKeyActionResult(await response.json());
  }

  throw new Error(await readCreateApiKeyActionError(response));
}

export async function submitSettingsApiKeyCreateForm(
  formData: FormData,
): Promise<SettingsCreateApiKeyActionResult> {
  return submitSettingsApiKeyCreateFormToBackend(formData);
}

export async function submitSettingsApiKeyRevokeToBackend(
  apiKeyId: string,
  options: HandleRevokeApiKeyRouteRequestOptions = {},
): Promise<SettingsRevokeApiKeyActionResult> {
  const normalizedApiKeyId = apiKeyId.trim();

  if (normalizedApiKeyId.length === 0) {
    throw new Error(API_KEY_REVOKE_ID_REQUIRED_ERROR);
  }

  const response = await handleRevokeApiKeyRouteRequest(
    new Request(resolveSettingsApiKeyRequestUrl(), {
      method: "DELETE",
      body: JSON.stringify({
        apiKeyId: normalizedApiKeyId,
      }),
      headers: {
        "content-type": "application/json",
      },
    }),
    options,
  );

  if (response.status === REVOKE_API_KEY_ROUTE_OK_STATUS) {
    return {
      apiKey: normalizeApiKeySafeRecordPayload(await response.json()),
    };
  }

  throw new Error(await readCreateApiKeyActionError(response));
}

export async function submitSettingsApiKeyRevoke(
  apiKeyId: string,
): Promise<SettingsRevokeApiKeyActionResult> {
  return submitSettingsApiKeyRevokeToBackend(apiKeyId);
}
