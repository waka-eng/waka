import { apiPath, getJson, postJson, requestVoid } from './http';

export interface ApiProfileKey {
  id: string;
  profileId: string;
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export type KeyProfile = { id: string; type: 'human' | 'agent' };
const keyPath = (profile: KeyProfile) => profile.type === 'human' ? '/keeper-keys' : '/agent-keys';

export async function fetchProfileKeys(profile: KeyProfile): Promise<ApiProfileKey[]> {
  const { keys } = await getJson<{ keys: ApiProfileKey[] }>(apiPath(keyPath(profile)), 'Could not load API keys');
  return keys.filter(key => key.profileId === profile.id && !key.revokedAt);
}

export async function createProfileKey(profile: KeyProfile, label: string): Promise<ApiProfileKey & { secret: string }> {
  // Personal keys bind to the authenticated human on the server, never a
  // caller-supplied destination. Agent keys still require the selected ID.
  const { key } = await postJson<{ key: Omit<ApiProfileKey, 'lastUsedAt' | 'revokedAt'> & { secret: string } }>(
    apiPath(keyPath(profile)), profile.type === 'human' ? { label } : { profileId: profile.id, label }, 'Could not create API key');
  if (key.profileId !== profile.id) throw new Error('API key belongs to a different profile');
  return { ...key, lastUsedAt: null, revokedAt: null };
}

export function revokeProfileKey(profile: KeyProfile, id: string): Promise<void> {
  return requestVoid(apiPath(`${keyPath(profile)}/${encodeURIComponent(id)}`), 'DELETE', undefined, 'Could not revoke API key');
}
