/**
 * Client for `/api/sessions` — mirrors `packages/api/src/routes/sessions.ts`.
 *
 * The machines holding a credential for this account. Called *connections*
 * here rather than sessions, because "session" already means the one this tab
 * is running inside and a person reading a settings screen means the other
 * thing: the phone they signed in on last month.
 */

import { apiPath, getJson, requestVoid, type ApiProfileType } from "./http";

export interface ApiConnection {
  id: string;
  /** What the machine called itself; null for logins that never said. */
  deviceLabel: string | null;
  profile: { id: string; name: string; type: ApiProfileType };
  /** True for the connection making this request. */
  current: boolean;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

/**
 * GET /sessions — every live connection, newest use first.
 *
 * No token or hash is ever returned; a credential cannot be read back, only
 * listed and ended.
 */
export async function fetchConnections(): Promise<ApiConnection[]> {
  const body = await getJson<{ sessions: ApiConnection[] }>(
    apiPath("/sessions"),
    "Your connections could not be loaded",
  );
  return Array.isArray(body.sessions) ? body.sessions : [];
}

/**
 * DELETE /sessions/:id — end one connection.
 *
 * Ending the current one is a logout from this device, which the caller has
 * to handle rather than discover.
 */
export async function endConnection(sessionId: string): Promise<void> {
  await requestVoid(
    apiPath(`/sessions/${encodeURIComponent(sessionId)}`),
    "DELETE",
    undefined,
    "That connection could not be ended",
  );
}
