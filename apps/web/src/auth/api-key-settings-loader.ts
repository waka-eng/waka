import {
  listCurrentWorkspaceApiKeys,
  type CurrentWorkspaceApiKeyScopeResolver,
} from "./api-key-current-workspace.ts";
import type {
  ApiKeyPersistenceClient,
  ApiKeySafeRecord,
  StoredApiKeyRecord,
} from "./api-key-persistence.ts";

export interface LoadCurrentWorkspaceSettingsApiKeysDependencies<
  TRecord extends StoredApiKeyRecord,
> {
  apiKeyPersistenceClient: ApiKeyPersistenceClient<TRecord>;
  currentWorkspaceScopeResolver: CurrentWorkspaceApiKeyScopeResolver;
}

export interface SettingsApiKeysData {
  apiKeys: ApiKeySafeRecord[];
}

export async function loadCurrentWorkspaceSettingsApiKeys<
  TRecord extends StoredApiKeyRecord,
>(
  dependencies: LoadCurrentWorkspaceSettingsApiKeysDependencies<TRecord>,
): Promise<SettingsApiKeysData> {
  return {
    apiKeys: await listCurrentWorkspaceApiKeys(
      dependencies.apiKeyPersistenceClient,
      dependencies.currentWorkspaceScopeResolver,
    ),
  };
}

export function createCurrentWorkspaceSettingsApiKeysLoader<
  TRecord extends StoredApiKeyRecord,
>(
  dependencies: LoadCurrentWorkspaceSettingsApiKeysDependencies<TRecord>,
): () => Promise<SettingsApiKeysData> {
  return async function loadSettingsApiKeys(): Promise<SettingsApiKeysData> {
    return loadCurrentWorkspaceSettingsApiKeys(dependencies);
  };
}
