/**
 * The keeper-key client: the person's own standing credentials.
 *
 * Founder ask, 2026-08-29, completing that day's separation ruling: agents no
 * longer capture into the human profile, so the person mints a key of their
 * own for MCP — keep and recall, from the account screen. The mirror of
 * `agents.ts`'s key trio with the binding fixed: no profileId is ever sent,
 * because a keeper key is always for the session's own human profile — there
 * is nothing to choose, so nothing is asked (routes/keeper-keys.ts makes the
 * same argument server-side).
 */
import { apiPath, getJson, postJson, requestVoid } from "./http";

export interface ApiKeeperKey {
  id: string;
  profileId: string;
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiMintedKeeperKey extends Omit<ApiKeeperKey, "lastUsedAt" | "revokedAt"> {
  /** Present in this one response and never retrievable again. */
  secret: string;
}

/** GET /keeper-keys — the person's keys, revoked rows included. */
export async function fetchKeeperKeys(): Promise<ApiKeeperKey[]> {
  const body = await getJson<{ keys: ApiKeeperKey[] }>(
    apiPath("/keeper-keys"),
    "Failed to load your keys",
  );
  return Array.isArray(body.keys) ? body.keys : [];
}

/** POST /keeper-keys — mint one. Show the secret now; it does not come back. */
export async function createKeeperKey(label?: string): Promise<ApiMintedKeeperKey> {
  const body = await postJson<{ key: ApiMintedKeeperKey }>(
    apiPath("/keeper-keys"),
    label ? { label } : {},
    "That key could not be created",
  );
  return body.key;
}

/** DELETE /keeper-keys/:id — revoke. Immediate on the key's next request. */
export async function revokeKeeperKey(keyId: string): Promise<void> {
  await requestVoid(
    apiPath(`/keeper-keys/${encodeURIComponent(keyId)}`),
    "DELETE",
    undefined,
    "That key could not be revoked",
  );
}
