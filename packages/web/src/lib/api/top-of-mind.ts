/**
 * Client for `/api/top-of-mind` — mirrors `packages/api/src/routes/top-of-mind.ts`.
 *
 * Layer 3: the one artifact that says who you are becoming. It is versioned
 * rather than mutated — a regeneration writes a new version and supersedes the
 * old one — so there is a history endpoint here as well as a current one.
 *
 * Six of these helpers were physically stranded in the middle of the
 * connections section of the single-file client, several hundred lines from
 * `fetchTopOfMind`, purely because that is where they were appended. Nothing
 * about them changed in the move; they had simply never been filed.
 */

import {
  apiPath,
  getJson,
  patchJson,
  postJson,
  type ProfileScoped,
} from "./http";

// ---------------------------------------------------------------------------
// What the artifact is
// ---------------------------------------------------------------------------

export type ApiTopOfMindEntryType =
  | "pattern"
  | "tension"
  | "question"
  | "hypothesis"
  | "action";

export type ApiTopOfMindReason =
  | "initial"
  | "regenerated"
  | "no_change"
  | "member_proposal"
  | "human_edit";

/**
 * One statement inside the artifact. `locked` is the same rule as a signal's:
 * a human edit freezes the words and the server works around them.
 */
export interface ApiTopOfMindEntry {
  id: string;
  type: ApiTopOfMindEntryType;
  body: string;
  belief: string | null;
  prompt: string | null;
  locked: boolean;
  pinned: boolean;
  dismissed: boolean;
  sortOrder: number;
  /** What the entry rests on: signals this profile holds, named. `answered`
      is the ground's ratified standing — the owner has spoken to it (a
      verdict or their own locked words) — computed server-side from the
      feedback and lock records at serve time, never stored. */
  citedSignals: Array<{ id: string; statement: string; statementRevision?: string; answered: boolean; locked: boolean; contested: boolean }>;
  createdAt: string;
  supportChanged?: boolean;
}

/**
 * The single synthesized artifact for a profile. (It was "for a profile or a
 * group" until rooms were removed on 2026-10-12.) Entries compose
 * it, but the artifact is the unit: one identity, one current version, a
 * linear history. A regeneration writes a new version rather than mutating
 * this one.
 */
export interface ApiTopOfMind {
  id: string;
  version: number;
  reason: ApiTopOfMindReason;
  createdAt: string;
  entries: ApiTopOfMindEntry[];
  supportChanged?: boolean;
  generationRevision?: string;
  profileId?: string;
}

export type ApiTopOfMindStatus = "live" | "superseded";

/** A row of the version history — the artifact without its entries. */
export interface ApiTopOfMindVersion {
  id: string;
  version: number;
  status: ApiTopOfMindStatus;
  reason: ApiTopOfMindReason;
  entryCount: number;
  replacedById: string | null;
  replacedAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// The current reading, and the ones it replaced
// ---------------------------------------------------------------------------

/**
 * GET /top-of-mind
 *
 * Null until the first synthesis lands, which is a real state rather than an
 * error: a profile with nothing to read has nothing on its board.
 */
export async function fetchTopOfMind(
  options: ProfileScoped = {},
  signal?: AbortSignal,
): Promise<ApiTopOfMind | null> {
  const query = options.profile
    ? `?profile=${encodeURIComponent(options.profile)}`
    : "";
  const body = await getJson<{ topOfMind: ApiTopOfMind | null }>(
    apiPath(`/top-of-mind${query}`),
    "Failed to load your top of mind",
    signal,
  );
  return body.topOfMind ?? null;
}

/** GET /top-of-mind/versions — newest first. */
export async function fetchTopOfMindVersions(options: ProfileScoped = {}, signal?: AbortSignal): Promise<ApiTopOfMindVersion[]> {
  const query=options.profile?`?profile=${encodeURIComponent(options.profile)}`:'';
  const body = await getJson<{ versions: ApiTopOfMindVersion[] }>(
    apiPath(`/top-of-mind/versions${query}`),
    "Failed to load earlier versions",signal,
  );
  return Array.isArray(body.versions) ? body.versions : [];
}

export async function fetchTopOfMindVersion(artifactId: string, options: ProfileScoped = {}, signal?: AbortSignal): Promise<ApiTopOfMind> {
  const query = options.profile ? `?profile=${encodeURIComponent(options.profile)}` : "";
  const body = await getJson<{ topOfMind: ApiTopOfMind }>(
    apiPath(`/top-of-mind/versions/${encodeURIComponent(artifactId)}${query}`), "Failed to check this reading", signal);
  return body.topOfMind;
}

/**
 * POST /top-of-mind/refresh
 *
 * Accepted, not done: synthesis runs in the background and the caller polls
 * `fetchTopOfMind` for the version that replaces the current one.
 */
export interface ApiTopOfMindRefreshResult {
  kind: "top_of_mind";
  topOfMindId: string | null;
  version: number;
  outcome: "changed" | "unchanged" | "empty";
}

export interface ApiTopOfMindRefreshStatus {
  status: "pending" | "running" | "succeeded" | "failed" | "unknown";
  runAfter: string | null;
  result: ApiTopOfMindRefreshResult | null;
  requestVersion?: string;
  completedVersion?: string;
}

export interface ApiTopOfMindRefreshReceipt { jobId: string; requestVersion: string }

export async function refreshTopOfMind(): Promise<ApiTopOfMindRefreshReceipt> {
  const receipt = await postJson<ApiTopOfMindRefreshReceipt>(
    apiPath("/top-of-mind/refresh"),
    {},
    "Failed to start a new reading",
  );
  if (typeof receipt?.jobId !== "string" || !receipt.jobId || typeof receipt.requestVersion !== "string" ||
    !/^[1-9]\d{0,18}$/.test(receipt.requestVersion)) throw new Error("The reading request did not return a versioned receipt");
  return { jobId: receipt.jobId, requestVersion: receipt.requestVersion };
}

export function fetchTopOfMindRefresh(jobId: string, signal?: AbortSignal, requestVersion?: string): Promise<ApiTopOfMindRefreshStatus> {
  const query = requestVersion ? `?requestVersion=${encodeURIComponent(requestVersion)}` : "";
  return getJson(apiPath(`/top-of-mind/refresh/${encodeURIComponent(jobId)}${query}`), "Failed to check your reading", signal);
}

// ---------------------------------------------------------------------------
// One entry at a time
// ---------------------------------------------------------------------------

/** PATCH /top-of-mind/entries/:entryId — rewriting an entry locks it. */
export async function updateTopOfMindEntry(
  entryId: string,
  input: { body: string },
): Promise<ApiTopOfMindEntry> {
  const body = await patchJson<{ entry: ApiTopOfMindEntry }>(
    apiPath(`/top-of-mind/entries/${encodeURIComponent(entryId)}`),
    input,
    "Failed to update this entry",
  );
  return body.entry;
}

/**
 * POST /top-of-mind/entries/:entryId/pin
 *
 * Holding is one-directional by design: the generator reads a held entry on
 * every pass and carries it into the version it writes, so releasing it is
 * dismissing it rather than a second state to toggle back through.
 */
export async function holdTopOfMindEntry(
  entryId: string,
): Promise<ApiTopOfMindEntry> {
  const body = await postJson<{ entry: ApiTopOfMindEntry }>(
    apiPath(`/top-of-mind/entries/${encodeURIComponent(entryId)}/pin`),
    {},
    "Failed to hold that entry",
  );
  return body.entry;
}

/** POST /top-of-mind/entries/:entryId/dismiss */
export async function dismissTopOfMindEntry(
  entryId: string,
): Promise<ApiTopOfMindEntry> {
  const body = await postJson<{ entry: ApiTopOfMindEntry }>(
    apiPath(`/top-of-mind/entries/${encodeURIComponent(entryId)}/dismiss`),
    {},
    "Failed to take that entry down",
  );
  return body.entry;
}

/**
 * POST /top-of-mind/entries/:entryId/release
 *
 * Hands an edited entry back to the generator: the words stand until the
 * next synthesis, which may then reword or retire them like any generated
 * line. Nothing is rewritten at release time.
 */
export async function releaseTopOfMindEntry(
  entryId: string,
): Promise<ApiTopOfMindEntry> {
  const body = await postJson<{ entry: ApiTopOfMindEntry }>(
    apiPath(`/top-of-mind/entries/${encodeURIComponent(entryId)}/release`),
    {},
    "Failed to hand this line back",
  );
  return body.entry;
}

/** POST /top-of-mind/entries/:entryId/restore */
export async function restoreTopOfMindEntry(
  entryId: string,
): Promise<ApiTopOfMindEntry> {
  const body = await postJson<{ entry: ApiTopOfMindEntry }>(
    apiPath(`/top-of-mind/entries/${encodeURIComponent(entryId)}/restore`),
    {},
    "Failed to put that entry back",
  );
  return body.entry;
}
