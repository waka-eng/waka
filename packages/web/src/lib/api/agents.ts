/**
 * The agent-management client: keys, and the graph behind any profile.
 *
 * Meeting, 2026-08-17 — the "MCP 관리 탭"'s data: which agents exist (the
 * profiles client owns that), which keys each holds, minting one (the secret
 * appears in the 201 and never again), revoking one, and the graph endpoint
 * that shows what an agent has come to hold.
 */
import { apiPath, getJson, postJson, requestVoid } from "./http";

export interface ApiAgentKey {
  id: string;
  profileId: string;
  prefix: string;
  label: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiMintedKey extends Omit<ApiAgentKey, "lastUsedAt" | "revokedAt"> {
  /** Present in this one response and never retrievable again. */
  secret: string;
}

/** GET /agent-keys — every key on the account's agents. */
export async function fetchAgentKeys(): Promise<ApiAgentKey[]> {
  const body = await getJson<{ keys: ApiAgentKey[] }>(
    apiPath("/agent-keys"),
    "Failed to load agent keys",
  );
  return Array.isArray(body.keys) ? body.keys : [];
}

/** POST /agent-keys — mint one. Show the secret now; it does not come back. */
export async function createAgentKey(
  profileId: string,
  label?: string,
): Promise<ApiMintedKey> {
  const body = await postJson<{ key: ApiMintedKey }>(
    apiPath("/agent-keys"),
    { profileId, ...(label ? { label } : {}) },
    "That key could not be created",
  );
  return body.key;
}

/** DELETE /agent-keys/:id — revoke. Immediate on the next request. */
export async function revokeAgentKey(keyId: string): Promise<void> {
  await requestVoid(
    apiPath(`/agent-keys/${encodeURIComponent(keyId)}`),
    "DELETE",
    undefined,
    "That key could not be revoked",
  );
}

export interface ApiGraphNode {
  id: string;
  kind: "principle" | "signal" | "experience";
  label: string;
  status?: string;
}

export interface ApiGraphEdge {
  from: string;
  to: string;
}

export interface ApiGraph {
  profileId: string;
  nodes: ApiGraphNode[];
  edges: ApiGraphEdge[];
}

/** GET /graph — one profile's mind as nodes and edges. */
export async function fetchGraph(profileId?: string): Promise<ApiGraph> {
  const query = profileId ? `?profile=${encodeURIComponent(profileId)}` : "";
  return getJson<ApiGraph>(apiPath(`/graph${query}`), "Failed to load the graph");
}
