import { apiPath, getJson, postJson, requestVoid } from './http';

export interface ApiAgentKey {
  id: string;
  profileId: string;
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export async function fetchAgentKeys(profileId: string): Promise<ApiAgentKey[]> {
  const { keys } = await getJson<{ keys: ApiAgentKey[] }>(apiPath('/agent-keys'), 'Could not load API keys');
  return keys.filter(key => key.profileId === profileId && !key.revokedAt);
}

export async function createAgentKey(profileId: string, label: string): Promise<ApiAgentKey & { secret: string }> {
  const { key } = await postJson<{ key: Omit<ApiAgentKey, 'lastUsedAt' | 'revokedAt'> & { secret: string } }>(
    apiPath('/agent-keys'), { profileId, label }, 'Could not create API key');
  return { ...key, lastUsedAt: null, revokedAt: null };
}

export function revokeAgentKey(id: string): Promise<void> {
  return requestVoid(apiPath(`/agent-keys/${encodeURIComponent(id)}`), 'DELETE', undefined, 'Could not revoke API key');
}
