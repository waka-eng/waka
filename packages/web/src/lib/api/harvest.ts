/**
 * Client for `/api/harvest` — mirrors `packages/api/src/routes/harvest.ts`.
 *
 * The basket of the person's own sentences, picked from their work by a
 * collector they run, waiting to be kept or let go. Proposing is the
 * collector's job and lives in the MCP, not here; this module is the
 * browser's half — what is waiting, and the two decisions.
 */
import { apiPath, getJson, postJson } from "./http";

export type HarvestReason = "not_mine" | "already_kept" | "private" | "trivial" | "miscut" | "other";

export interface ApiHarvestCandidate {
  id: string;
  /** The person's own words, verbatim. */
  text: string;
  /** A short label the collector gave it, or nothing. Never a rewrite. */
  title: string | null;
  /** The app that proposed it, as it named itself ("claude-code"), or nothing. */
  tool?: string | null;
  createdAt: string;
  /** When the words are deleted if nobody chooses. */
  lapsesAt: string;
}

/** GET /harvest — what is waiting, oldest first. A malformed body is an empty basket. */
export async function listHarvest(): Promise<ApiHarvestCandidate[]> {
  const body = await getJson<{ candidates?: ApiHarvestCandidate[] }>(apiPath("/harvest"), "Failed to load what was picked for you");
  return (body.candidates ?? []).filter(
    (row): row is ApiHarvestCandidate => typeof row?.id === "string" && typeof row?.text === "string" && row.text.length > 0,
  );
}

/** POST /harvest/:id/keep — the save already exists; this says which one it became. */
/** `savedAs`: the words the save was first made with, when it has been
    corrected since — the server checks the save's request id against them. */
export async function keepHarvest(id: string, inspirationId: string, savedAs?: string): Promise<void> {
  await postJson(apiPath(`/harvest/${encodeURIComponent(id)}/keep`), { inspirationId, ...(savedAs !== undefined ? { savedAs } : {}) }, "Couldn’t keep this");
}

/** POST /harvest/:id/decline — the words are deleted; the reason, if any,
    stays. `note` is the person's own reason, and goes only with `other`. */
export async function declineHarvest(id: string, reason?: HarvestReason, note?: string): Promise<void> {
  await postJson(apiPath(`/harvest/${encodeURIComponent(id)}/decline`), reason ? { reason, ...(reason === "other" && note ? { note } : {}) } : {}, "Couldn’t let this go");
}
