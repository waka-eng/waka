import {
  type CurrentWorkspaceApiKeyCreateInput,
  type CurrentWorkspaceApiKeyScopeResolver,
} from "./api-key-current-workspace.ts";
import { createCurrentWorkspaceApiKeyCreationService } from "./api-key-creation-service.ts";
import {
  API_KEY_CREATE_DESCRIPTION_FIELD,
  API_KEY_CREATE_METADATA_FIELD,
  API_KEY_CREATE_NAME_FIELD,
} from "./api-key-form-fields.ts";
import type {
  ApiKeyPersistenceClient,
  ApiKeySafeRecord,
  CreateApiKeyOptions,
  CreatedApiKeyResult,
  JsonValue,
  StoredApiKeyRecord,
} from "./api-key-persistence.ts";
import { toApiKeySafeRecord } from "./api-key-persistence.ts";

export const API_KEY_CREATE_NAME_REQUIRED_ERROR =
  "API key name must be a non-empty string";
export const API_KEY_CREATE_REQUEST_BODY_INVALID_ERROR =
  "API key create request body must be a JSON object";
export const API_KEY_CREATE_REQUEST_BODY_JSON_INVALID_ERROR =
  "API key create request body must be valid JSON";
export const API_KEY_CREATE_DESCRIPTION_INVALID_ERROR =
  "API key description must be a string";
export const API_KEY_CREATE_METADATA_INVALID_ERROR =
  "API key metadata must be valid JSON";

export interface ApiKeyRecordResponse {
  apiKey: ApiKeySafeRecord;
}

export interface CreateApiKeyResponse extends ApiKeyRecordResponse {
  plainKey: string;
}

export type CreateApiKeyRequestBody = CreateApiKeyActionInput;
export type CreateApiKeyResponseBody = CreateApiKeyResponse;
export type CreateApiKeyActionResult = CreateApiKeyResponse;

export interface CreateApiKeyActionDependencies<
  TRecord extends StoredApiKeyRecord,
> {
  apiKeyPersistenceClient: ApiKeyPersistenceClient<TRecord>;
  currentWorkspaceScopeResolver: CurrentWorkspaceApiKeyScopeResolver;
}

export type CreateApiKeyActionInput = CurrentWorkspaceApiKeyCreateInput;

export type CreateApiKeyActionRequest = CreateApiKeyActionInput | FormData;

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

function normalizeOptionalString(
  value: string | null | undefined,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  const normalizedValue = value.trim();

  return normalizedValue.length === 0 ? null : normalizedValue;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }

  if (typeof value !== "object") {
    return false;
  }

  return Object.values(value).every((item) => isJsonValue(item));
}

function parseJsonMetadata(value: string): JsonValue {
  try {
    const parsedValue = JSON.parse(value) as unknown;

    if (!isJsonValue(parsedValue)) {
      throw new Error(API_KEY_CREATE_METADATA_INVALID_ERROR);
    }

    return parsedValue;
  } catch {
    throw new Error(API_KEY_CREATE_METADATA_INVALID_ERROR);
  }
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

function normalizeMetadata(
  metadata: JsonValue | null | undefined,
): JsonValue | null | undefined {
  if (metadata === undefined) {
    return undefined;
  }

  if (metadata === null || isJsonValue(metadata)) {
    return metadata;
  }

  throw new Error(API_KEY_CREATE_METADATA_INVALID_ERROR);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stripCreateOwnershipFields(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const {
    userId: _userId,
    tenantId: _tenantId,
    workspaceId: _workspaceId,
    ...sanitizedInput
  } = input;

  return sanitizedInput;
}

function readOptionalDescription(
  value: unknown,
): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value !== "string") {
    throw new Error(API_KEY_CREATE_DESCRIPTION_INVALID_ERROR);
  }

  return value;
}

export function parseCreateApiKeyRequestBody(
  input: unknown,
): CreateApiKeyRequestBody {
  if (!isRecord(input)) {
    throw new TypeError(API_KEY_CREATE_REQUEST_BODY_INVALID_ERROR);
  }

  const sanitizedInput = stripCreateOwnershipFields(input);

  return normalizeCreateApiKeyActionInput({
    name: typeof sanitizedInput.name === "string" ? sanitizedInput.name : "",
    description: readOptionalDescription(sanitizedInput.description),
    metadata: normalizeMetadata(
      sanitizedInput.metadata as JsonValue | null | undefined,
    ),
  });
}

export function normalizeCreateApiKeyActionInput(
  input: CreateApiKeyActionRequest,
): CreateApiKeyActionInput {
  if (input instanceof FormData) {
    const metadata = readFormDataString(input, API_KEY_CREATE_METADATA_FIELD);

    return {
      name: normalizeRequiredString(
        readFormDataString(input, API_KEY_CREATE_NAME_FIELD) ?? "",
        API_KEY_CREATE_NAME_REQUIRED_ERROR,
      ),
      description: normalizeOptionalString(
        readFormDataString(input, API_KEY_CREATE_DESCRIPTION_FIELD),
      ),
      metadata:
        typeof metadata !== "string"
          ? undefined
          : metadata.trim().length === 0
            ? null
            : parseJsonMetadata(metadata),
    };
  }

  return {
    name: normalizeRequiredString(
      input.name,
      API_KEY_CREATE_NAME_REQUIRED_ERROR,
    ),
    description: normalizeOptionalString(input.description),
    metadata: normalizeMetadata(input.metadata),
  };
}

export function toApiKeyRecordResponse(
  apiKey: ApiKeySafeRecord | StoredApiKeyRecord,
): ApiKeyRecordResponse {
  return {
    apiKey:
      "hashedKey" in apiKey ? toApiKeySafeRecord(apiKey) : apiKey,
  };
}

export function toCreateApiKeyResponse(
  result: CreatedApiKeyResult,
): CreateApiKeyResponse {
  return {
    ...toApiKeyRecordResponse(result.apiKey),
    plainKey: result.plainKey,
  };
}

export async function issueCurrentWorkspaceApiKey<
  TRecord extends StoredApiKeyRecord,
>(
  dependencies: CreateApiKeyActionDependencies<TRecord>,
  input: CreateApiKeyActionRequest,
  options: CreateApiKeyOptions = {},
): Promise<CreateApiKeyResponse> {
  const service = createCurrentWorkspaceApiKeyCreationService({
    apiKeyRepository: dependencies.apiKeyPersistenceClient,
    currentWorkspaceScopeResolver: dependencies.currentWorkspaceScopeResolver,
  });
  const result = await service.create(
    normalizeCreateApiKeyActionInput(input),
    options,
  );

  return toCreateApiKeyResponse(result);
}

export function createApiKeyAction<TRecord extends StoredApiKeyRecord>(
  dependencies: CreateApiKeyActionDependencies<TRecord>,
  options: CreateApiKeyOptions = {},
): (
  input: CreateApiKeyActionRequest,
) => Promise<CreateApiKeyResponse> {
  return async function handleCreateApiKeyAction(
    input: CreateApiKeyActionRequest,
  ): Promise<CreateApiKeyResponse> {
    return issueCurrentWorkspaceApiKey(dependencies, input, options);
  };
}

export const createApiKeyCreateAction = createApiKeyAction;
export const createCurrentWorkspaceApiKeyAction = createApiKeyAction;
export const issueApiKey = issueCurrentWorkspaceApiKey;

export {
  API_KEY_CREATE_DESCRIPTION_FIELD,
  API_KEY_CREATE_METADATA_FIELD,
  API_KEY_CREATE_NAME_FIELD,
};
