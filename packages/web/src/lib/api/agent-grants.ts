/**
 * The sibling-door client: who may read whom, by the owner's hand.
 *
 * The canon (docs/data-model.md) has promised since the 2026-08-23 ruling
 * that grants are "listed beside credentials" — this module is the wire for
 * that promise. A grant is one-directional and read-only by construction
 * (the matrix refuses writes whatever the grant says); revocation takes
 * effect on the target's next request and the revoked row stays as record.
 */
import { apiPath, getJson, postJson, requestVoid } from "./http";

export interface ApiAgentGrant {
  id: string;
  /** The agent that may read. */
  granteeProfileId: string;
  /** The agent whose memory opens. */
  targetProfileId: string;
  grantedByProfileId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** GET /agent-grants — every grant in the account, live and revoked. */
export async function fetchAgentGrants(): Promise<ApiAgentGrant[]> {
  const body = await getJson<{ grants: ApiAgentGrant[] }>(
    apiPath("/agent-grants"),
    "Failed to load grants",
  );
  return Array.isArray(body.grants) ? body.grants : [];
}

/** POST /agent-grants — open one door: grantee may read target. */
export async function createAgentGrant(
  granteeProfileId: string,
  targetProfileId: string,
): Promise<ApiAgentGrant> {
  const body = await postJson<{ grant: ApiAgentGrant }>(
    apiPath("/agent-grants"),
    { granteeProfileId, targetProfileId },
    "That grant could not be given",
  );
  return body.grant;
}

/** DELETE /agent-grants/:id — close it; effective on the next request. */
export async function revokeAgentGrant(grantId: string): Promise<void> {
  await requestVoid(
    apiPath(`/agent-grants/${encodeURIComponent(grantId)}`),
    "DELETE",
    undefined,
    "That grant could not be revoked",
  );
}
