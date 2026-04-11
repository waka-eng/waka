import {
  createCurrentWorkspaceApiKey,
  type CurrentWorkspaceApiKeyCreateInput,
  type CurrentWorkspaceApiKeyScopeResolver,
} from "./api-key-current-workspace.ts";
import type {
  ApiKeyPersistenceClient,
  CreateApiKeyOptions,
  CreatedApiKeyResult,
  StoredApiKeyRecord,
} from "./api-key-persistence.ts";

export interface CurrentWorkspaceApiKeyCreationServiceDependencies<
  TRecord extends StoredApiKeyRecord,
> {
  apiKeyRepository: ApiKeyPersistenceClient<TRecord>;
  currentWorkspaceScopeResolver: CurrentWorkspaceApiKeyScopeResolver;
}

export interface CurrentWorkspaceApiKeyCreationService<
  TRecord extends StoredApiKeyRecord,
> {
  create(
    input: CurrentWorkspaceApiKeyCreateInput,
    options?: CreateApiKeyOptions,
  ): Promise<CreatedApiKeyResult>;
}

export async function createApiKeyForCurrentWorkspace<
  TRecord extends StoredApiKeyRecord,
>(
  dependencies: CurrentWorkspaceApiKeyCreationServiceDependencies<TRecord>,
  input: CurrentWorkspaceApiKeyCreateInput,
  options: CreateApiKeyOptions = {},
): Promise<CreatedApiKeyResult> {
  return createCurrentWorkspaceApiKey(
    dependencies.apiKeyRepository,
    dependencies.currentWorkspaceScopeResolver,
    input,
    options,
  );
}

export function createCurrentWorkspaceApiKeyCreationService<
  TRecord extends StoredApiKeyRecord,
>(
  dependencies: CurrentWorkspaceApiKeyCreationServiceDependencies<TRecord>,
): CurrentWorkspaceApiKeyCreationService<TRecord> {
  return {
    async create(
      input: CurrentWorkspaceApiKeyCreateInput,
      options: CreateApiKeyOptions = {},
    ): Promise<CreatedApiKeyResult> {
      return createApiKeyForCurrentWorkspace(dependencies, input, options);
    },
  };
}
