import {
  revokeCurrentWorkspaceApiKey,
  type CurrentWorkspaceApiKeyLookupInput,
  type CurrentWorkspaceApiKeyScopeResolver,
} from "./api-key-current-workspace.ts";
import { toApiKeyRecordResponse, type ApiKeyRecordResponse } from "./api-key-issuance.ts";
import type {
  ApiKeyPersistenceClient,
  RevokeApiKeyOptions,
  StoredApiKeyRecord,
} from "./api-key-persistence.ts";

export const API_KEY_REVOKE_ID_FIELD = "apiKeyId";
export const API_KEY_REVOKE_ID_REQUIRED_ERROR =
  "API key id must be a non-empty string";
export const API_KEY_REVOKE_REQUEST_BODY_INVALID_ERROR =
  "API key revoke request body must be a JSON object";
export const API_KEY_REVOKE_REQUEST_BODY_JSON_INVALID_ERROR =
  "API key revoke request body must be valid JSON";
export const API_KEY_REVOKE_NOT_FOUND_ERROR = "API key not found";

export type RevokeApiKeyActionInput = CurrentWorkspaceApiKeyLookupInput;
export type RevokeApiKeyRequestBody = RevokeApiKeyActionInput;
export type RevokeApiKeyActionRequest = RevokeApiKeyActionInput | FormData;
export type RevokeApiKeyResponse = ApiKeyRecordResponse;
export type RevokeApiKeyResponseBody = RevokeApiKeyResponse;
export type RevokeApiKeyActionResult = RevokeApiKeyResponse;

export interface RevokeApiKeyActionDependencies<
  TRecord extends StoredApiKeyRecord,
> {
  apiKeyPersistenceClient: ApiKeyPersistenceClient<TRecord>;
  currentWorkspaceScopeResolver: CurrentWorkspaceApiKeyScopeResolver;
}

export class ApiKeyNotFoundError extends Error {
  constructor() {
    super(API_KEY_REVOKE_NOT_FOUND_ERROR);
    this.name = "ApiKeyNotFoundError";
  }
}

function normalizeRequiredString(
  value: string,
  errorMessage: string,
): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(errorMessage);
  }

  return normalizedValue;
}

function readFormDataString(
  formData: FormData,
  field: string,
): string | null | undefined {
  const value = formData.get(field);

  if (value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`${field} must be a string`);
  }

  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeRevokeApiKeyActionInput(
  input: RevokeApiKeyActionRequest,
): RevokeApiKeyActionInput {
  if (input instanceof FormData) {
    return {
      apiKeyId: normalizeRequiredString(
        readFormDataString(input, API_KEY_REVOKE_ID_FIELD) ?? "",
        API_KEY_REVOKE_ID_REQUIRED_ERROR,
      ),
    };
  }

  return {
    apiKeyId: normalizeRequiredString(
      input.apiKeyId,
      API_KEY_REVOKE_ID_REQUIRED_ERROR,
    ),
  };
}

export function parseRevokeApiKeyRequestBody(
  input: unknown,
): RevokeApiKeyRequestBody {
  if (!isRecord(input)) {
    throw new TypeError(API_KEY_REVOKE_REQUEST_BODY_INVALID_ERROR);
  }

  return normalizeRevokeApiKeyActionInput({
    apiKeyId: typeof input.apiKeyId === "string" ? input.apiKeyId : "",
  });
}

export async function revokeCurrentWorkspaceApiKeyForResponse<
  TRecord extends StoredApiKeyRecord,
>(
  dependencies: RevokeApiKeyActionDependencies<TRecord>,
  input: RevokeApiKeyActionRequest,
  options: RevokeApiKeyOptions = {},
): Promise<RevokeApiKeyResponse> {
  const revokedApiKey = await revokeCurrentWorkspaceApiKey(
    dependencies.apiKeyPersistenceClient,
    dependencies.currentWorkspaceScopeResolver,
    normalizeRevokeApiKeyActionInput(input),
    options,
  );

  if (revokedApiKey === null) {
    throw new ApiKeyNotFoundError();
  }

  return toApiKeyRecordResponse(revokedApiKey);
}

export function createRevokeApiKeyAction<TRecord extends StoredApiKeyRecord>(
  dependencies: RevokeApiKeyActionDependencies<TRecord>,
  options: RevokeApiKeyOptions = {},
): (
  input: RevokeApiKeyActionRequest,
) => Promise<RevokeApiKeyResponse> {
  return async function handleRevokeApiKeyAction(
    input: RevokeApiKeyActionRequest,
  ): Promise<RevokeApiKeyResponse> {
    return revokeCurrentWorkspaceApiKeyForResponse(dependencies, input, options);
  };
}

export const revokeApiKeyAction = createRevokeApiKeyAction;
export const createCurrentWorkspaceApiKeyRevocationAction =
  createRevokeApiKeyAction;
