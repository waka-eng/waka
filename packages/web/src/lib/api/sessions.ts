import { apiPath, getJson, requestVoid, type ApiProfileType } from "./http";

export interface ApiSession {
  id: string;
  deviceLabel: string | null;
  profile: { id: string; name: string; type: ApiProfileType };
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  verifiedAt?: string | null;
}

export async function fetchSessions(): Promise<ApiSession[]> {
  const response = await getJson<{ sessions: ApiSession[] }>(apiPath("/sessions"), "Could not load connections");
  return response.sessions;
}

export function revokeSession(id: string): Promise<void> {
  return requestVoid(apiPath(`/sessions/${encodeURIComponent(id)}`), "DELETE", undefined, "Could not disconnect device");
}

/** What a standing key read of this memory, newest first (`GET /api/mcp-reads`). */
export type ApiMcpReadTool = "principles" | "recall" | "inspirations" | "inspiration" | "signals" | "top_of_mind" | "profiles";
export interface ApiMcpRead {
  id: string;
  tool: ApiMcpReadTool;
  /** A search's words, or how many principles; never the memory itself. */
  detail: string | null;
  readAt: string;
  key: { kind: "keeper" | "agent"; label: string | null; prefix: string | null; revoked: boolean };
}

export async function fetchMcpReads(profileId?: string): Promise<ApiMcpRead[]> {
  const query = profileId ? `?profile=${encodeURIComponent(profileId)}` : "";
  return (await getJson<{ reads: ApiMcpRead[] }>(apiPath(`/mcp-reads${query}`), "Could not load recent reads")).reads;
}
