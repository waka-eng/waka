/**
 * Client for `/api/groups` — mirrors `packages/api/src/routes/groups.ts`.
 *
 * A group is a space whose three layers are made of other people's material,
 * and that shows in the shapes here: its wall is members' shared statements,
 * its field is members' PUBLIC captures, and its top of mind is changed by
 * proposal rather than by anyone editing it. Nothing a member owns lives here
 * — it is all read through current membership, which is why removing someone
 * takes their contributions off the wall without deleting anything of theirs.
 *
 * This is the one resource whose types borrow from two others: a group's
 * artifact reuses layer 3's entry vocabulary and its field reuses layer 1's,
 * so the imports below point at `top-of-mind.ts` and `inspirations.ts`. The
 * borrowing is one-way, matching the server, where a group reads those layers
 * and neither of them knows a group exists.
 */

import {
  apiPath,
  getJson,
  patchJson,
  postJson,
  requestVoid,
  type ApiProfileType,
} from "./http";
import type { ApiInspirationKind, ApiInspirationSource } from "./inspirations";
import type {
  ApiTopOfMindEntryType,
  ApiTopOfMindReason,
  ApiTopOfMindStatus,
} from "./top-of-mind";

// ---------------------------------------------------------------------------
// What a group is
// ---------------------------------------------------------------------------

export type ApiGroupRole = "owner" | "member";

export interface ApiGroupSummary {
  id: string;
  name: string;
  joinCode: string;
  role: ApiGroupRole;
  memberCount: number;
  createdAt: string;
}

export interface ApiGroupMember {
  profileId: string;
  name: string;
  initials: string;
  /** Human or agent — what kind of company this room keeps. */
  type: ApiProfileType;
  role: ApiGroupRole;
  joinedAt: string;
}

/**
 * A group wall row. The distilled statement crosses the account boundary;
 * the captures it rests on never do, which is why there is no evidence here.
 */
export interface ApiGroupWallReaction {
  profileId: string;
  name: string;
  value: "true" | "partly" | "not_true";
}

export interface ApiGroupWallSignal {
  signalId: string;
  statement: string;
  statementRevision?: string;
  /** The room's own confidence, as its lifecycle last wrote it. */
  confidenceAsWritten: number;
  /** The words are held (locked) — the star renders where they are read. */
  locked: boolean;
  /**
   * WHOSE MEMORIES STAND UNDER IT (2026-08-24). A wall statement is the
   * ROOM'S — grown from its members' pooled public memories — so it carries
   * contributors rather than an owner: at least two current members, in
   * first-contributed order, by the serve gate.
   */
  contributors: Array<{ profileId: string; name: string }>;
  /** When the room first held this statement. */
  sharedAt: string;
  /** Latest verdict per current member — contributors' stances count too. */
  reactions: ApiGroupWallReaction[];
}

/**
 * A room's field: every PUBLIC capture belonging to every current member,
 * each carrying whose it is and whether that profile is a person or an agent.
 *
 * This is the only place layer 1 crosses an account boundary, and it does so
 * only for captures their author marked public. Private ones are not filtered
 * on the client — they never leave the server.
 */
export interface ApiGroupFieldInspiration {
  id: string;
  text: string;
  kind: ApiInspirationKind | null;
  source: ApiInspirationSource;
  createdAt: string;
  updatedAt: string;
  ownerProfileId: string;
  ownerName: string;
  ownerType: "human" | "agent";
}

export type ApiGroupProposalKind = "edit_entry" | "add_entry" | "remove_entry";
export type ApiGroupProposalStatus = "open" | "accepted" | "declined";

/** How members change a group's top of mind together. */
export interface ApiGroupProposal {
  id: string;
  kind: ApiGroupProposalKind;
  status: ApiGroupProposalStatus;
  entryId: string | null;
  body: string | null;
  rationale: string | null;
  /** Null when the proposer erased their account after a settled decision —
      the record outlives its author and the world says "someone". */
  proposedByProfileId: string | null;
  proposedByName: string | null;
  /** Every recorded answer, yes and no alike — one per member, latest wins. */
  stances: Array<{
    profileId: string | null;
    name: string | null;
    value: "affirmed" | "declined";
    createdAt: string;
  }>;
  viewerStance: "affirmed" | "declined" | null;
  resolvedAt: string | null;
  createdAt: string;
}

/**
 * A group's artifact, which is not shaped like a profile's.
 *
 * Entries carry contributors rather than cited signals: a member may see that
 * someone's shared signal fed an entry, never which one, because the signal
 * belongs to the account that shared it.
 */
export interface ApiGroupTopOfMindEntry {
  id: string;
  type: ApiTopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  lockedAt: string | null;
  pinnedAt: string | null;
  sortOrder: number;
  createdAt: string;
  contributors: Array<{ profileId: string; name: string }>;
}

export interface ApiGroupTopOfMind {
  restricted?: boolean;
  topOfMind: {
    id: string;
    version: number;
    status: ApiTopOfMindStatus;
    reason: ApiTopOfMindReason;
    createdAt: string;
  } | null;
  entries: ApiGroupTopOfMindEntry[];
}

// ---------------------------------------------------------------------------
// Joining and leaving
// ---------------------------------------------------------------------------

/** GET /groups — the groups the acting profile belongs to. */
export async function fetchGroups(): Promise<ApiGroupSummary[]> {
  const body = await getJson<{ groups: ApiGroupSummary[] }>(
    apiPath("/groups"),
    "Failed to load rooms",
  );
  return Array.isArray(body.groups) ? body.groups : [];
}

/** POST /groups — create one; the caller becomes its owner. */
export async function createGroup(name: string): Promise<ApiGroupSummary> {
  const body = await postJson<{ group: ApiGroupSummary }>(
    apiPath("/groups"),
    { name },
    "Failed to create room",
  );
  return body.group;
}

/** POST /groups/join — join by the shareable code. */
export async function joinGroup(
  joinCode: string,
): Promise<{ group: ApiGroupSummary; alreadyMember: boolean }> {
  const body = await postJson<{ group: ApiGroupSummary; alreadyMember?: boolean }>(
    apiPath("/groups/join"),
    { joinCode },
    "Failed to join room",
  );
  return { group: body.group, alreadyMember: Boolean(body.alreadyMember) };
}

/**
 * POST /groups/:id/leave
 *
 * Walk out. The signals you shared to this room stop appearing on its wall;
 * they remain yours, and the memories under them never went anywhere.
 */
export async function leaveGroup(groupId: string): Promise<void> {
  await postJson<unknown>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/leave`),
    {},
    "Failed to leave this room",
  );
}

// ---------------------------------------------------------------------------
// Maintaining one
// ---------------------------------------------------------------------------

/**
 * MAINTAINING A GROUP — three verbs the server has always answered and the
 * client never asked.
 *
 * `PATCH /groups/:id`, `DELETE /groups/:id` and
 * `DELETE /groups/:id/members/:profileId` are implemented, membership-gated
 * and owner-gated on the server (groups.ts:1392, :1372, :1425). Until now the
 * only group verb the client could perform was leaving, so a room could be
 * made and joined and then never renamed, never tidied, and never closed —
 * and an owner who wanted a member gone had no way to say so.
 */

/** PATCH /groups/:id — rename. Owner only; the server enforces it. */
export async function renameGroup(groupId: string, name: string): Promise<ApiGroupSummary> {
  const body = await patchJson<{ group: ApiGroupSummary }>(
    apiPath(`/groups/${encodeURIComponent(groupId)}`),
    { name },
    "Failed to rename this room",
  );
  return body.group;
}

/**
 * DELETE /groups/:id — close the room for everyone. Owner only.
 *
 * This is the most destructive act in the group surface: it takes the room's
 * top of mind with it, which is the one artifact its members made together.
 * Nobody's own memories or signals are touched — a room never owned those —
 * but what the room concluded is gone. Any caller must confirm first.
 */
export async function deleteGroup(groupId: string): Promise<void> {
  await requestVoid(
    apiPath(`/groups/${encodeURIComponent(groupId)}`),
    "DELETE",
    undefined,
    "Failed to close this room",
  );
}

/**
 * DELETE /groups/:id/members/:profileId — remove someone. Owner only.
 *
 * Their shared statements stop appearing on the wall and their public captures
 * leave the room's ground, because both are read through current membership
 * rather than copied — so this is reversible by re-inviting, and it removes
 * nothing they own.
 */
export async function removeGroupMember(
  groupId: string,
  memberProfileId: string,
): Promise<void> {
  await requestVoid(
    apiPath(
      `/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberProfileId)}`,
    ),
    "DELETE",
    undefined,
    "Failed to remove this member",
  );
}

// ---------------------------------------------------------------------------
// What a group holds — members, wall, field
// ---------------------------------------------------------------------------

/** GET /groups/:id/members */
export async function fetchGroupMembers(groupId: string): Promise<ApiGroupMember[]> {
  const body = await getJson<{ members: ApiGroupMember[] }>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/members`),
    "Failed to load members",
  );
  return Array.isArray(body.members) ? body.members : [];
}

/** GET /groups/:id/wall — the signals members have shared here. */
export async function fetchGroupWall(groupId: string, signal?: AbortSignal): Promise<ApiGroupWallSignal[]> {
  const body = await getJson<{ wall: ApiGroupWallSignal[] }>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/wall`),
    "Failed to load this room's wall",
    signal,
  );
  return Array.isArray(body.wall) ? body.wall : [];
}

export interface ApiGroupField {
  field: ApiGroupFieldInspiration[];
  /** What the room's ground holds. Equals `field.length` until the room passes
      the server's ceiling, and is the length for a server too old to say. */
  total: number;
}

export async function fetchGroupField(groupId: string, signal?: AbortSignal): Promise<ApiGroupField> {
  const body = await getJson<{ field: ApiGroupFieldInspiration[]; total?: number }>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/field`),
    "Failed to load this room's field",
    signal,
  );
  const field = Array.isArray(body.field) ? body.field : [];
  return {
    field,
    total: typeof body.total === "number" ? Math.max(body.total, field.length) : field.length,
  };
}

// ---------------------------------------------------------------------------
// A group's top of mind, and the proposals that change it
// ---------------------------------------------------------------------------

/**
 * GET /groups/:id/top-of-mind — the group's own artifact.
 *
 * Naming a version reads the room AS IT STOOD at that version instead of as
 * it stands now: the same shape, the same gate, and an honest empty board for
 * a version the room never had. Absent, it reads the live one, which is every
 * caller that existed before the dial reached in here.
 */
export async function fetchGroupTopOfMind(
  groupId: string,
  version?: number,
  signal?: AbortSignal,
): Promise<ApiGroupTopOfMind> {
  const at = version === undefined ? "" : `?version=${encodeURIComponent(String(version))}`;
  const body = await getJson<ApiGroupTopOfMind>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/top-of-mind${at}`),
    "Failed to load this room's top of mind",
    signal,
  );
  return { topOfMind: body.topOfMind ?? null, entries: body.entries ?? [], restricted: body.restricted === true };
}

/** POST /groups/:id/top-of-mind/refresh */
export async function refreshGroupTopOfMind(groupId: string): Promise<void> {
  await requestVoid(
    apiPath(`/groups/${encodeURIComponent(groupId)}/top-of-mind/refresh`),
    "POST",
    {},
    "Failed to start a new room reading",
  );
}

export interface ApiGroupTimelineVersion {
  id: string;
  version: number;
  status: "live" | "superseded";
  reason: string;
  entryCount: number;
  createdAt: string;
}

export interface ApiGroupDoorMark {
  /** Null when the person has since erased their account: the mark outlives
      them (the erasure doctrine) and the world says "someone". */
  profileId: string | null;
  name: string | null;
  kind: "joined" | "left" | "removed";
  occurredAt: string;
}

export interface ApiGroupTimeline {
  versions: ApiGroupTimelineVersion[];
  doorMarks: ApiGroupDoorMark[];
}

/** GET /groups/:id/top-of-mind/versions — the room's own becoming. */
export async function fetchGroupTimeline(groupId: string): Promise<ApiGroupTimeline> {
  const body = await getJson<ApiGroupTimeline>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/top-of-mind/versions`),
    "Failed to load the room's timeline",
  );
  return {
    versions: Array.isArray(body.versions) ? body.versions : [],
    doorMarks: Array.isArray(body.doorMarks) ? body.doorMarks : [],
  };
}

/** GET /groups/:id/proposals */
export async function fetchGroupProposals(
  groupId: string,
  signal?: AbortSignal,
): Promise<ApiGroupProposal[]> {
  const body = await getJson<{ proposals: ApiGroupProposal[] }>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/proposals`),
    "Failed to load proposals",
    signal,
  );
  return Array.isArray(body.proposals) ? body.proposals : [];
}

export interface CreateGroupProposalRequest {
  kind: ApiGroupProposalKind;
  entryId?: string | null;
  body?: string;
  rationale?: string;
}

/** POST /groups/:id/proposals */
export async function createGroupProposal(
  groupId: string,
  input: CreateGroupProposalRequest,
): Promise<ApiGroupProposal> {
  const body = await postJson<{ proposal: ApiGroupProposal }>(
    apiPath(`/groups/${encodeURIComponent(groupId)}/proposals`),
    input,
    "Failed to propose that change",
  );
  return body.proposal;
}

/**
 * POST /groups/:id/proposals/:proposalId/affirm
 *
 * Standing behind a proposal. Enough affirmations and the server accepts it,
 * which is what writes the group's next version — so the answer says whether
 * this press was the one that carried it.
 */
export async function affirmGroupProposal(
  groupId: string,
  proposalId: string,
): Promise<{ proposal: ApiGroupProposal; accepted: boolean }> {
  const body = await postJson<{ proposal: ApiGroupProposal; accepted?: boolean }>(
    apiPath(
      `/groups/${encodeURIComponent(groupId)}/proposals/${encodeURIComponent(proposalId)}/affirm`,
    ),
    {},
    "That was not saved",
  );
  return { proposal: body.proposal, accepted: Boolean(body.accepted) };
}

/** POST /groups/:id/proposals/:proposalId/decline */
export async function declineGroupProposal(
  groupId: string,
  proposalId: string,
): Promise<ApiGroupProposal> {
  const body = await postJson<{ proposal: ApiGroupProposal }>(
    apiPath(
      `/groups/${encodeURIComponent(groupId)}/proposals/${encodeURIComponent(proposalId)}/decline`,
    ),
    {},
    "That was not saved",
  );
  return body.proposal;
}
