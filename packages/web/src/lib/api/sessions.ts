import { apiPath, getJson, requestVoid, type ApiProfileType } from "./http";

export interface ApiSession {
  id: string;
  deviceLabel: string | null;
  profile: { id: string; name: string; type: ApiProfileType };
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export async function fetchSessions(): Promise<ApiSession[]> {
  const response = await getJson<{ sessions: ApiSession[] }>(apiPath("/sessions"), "Could not load connections");
  return response.sessions;
}

export function revokeSession(id: string): Promise<void> {
  return requestVoid(apiPath(`/sessions/${encodeURIComponent(id)}`), "DELETE", undefined, "Could not disconnect device");
}
