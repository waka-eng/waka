/**
 * Client for `/api/principles` — mirrors `packages/api/src/routes/principles.ts`.
 *
 * Layer 4: the durable statements a person stands behind, resting on the
 * signals that earned them (`principle_signals`). They are GENERATED — the
 * product has no verb that writes one from nothing (founder, 2026-09-08), so
 * what this client offers is reading them, correcting the words of one that
 * exists, disputing it, reordering the set, and removing one.
 *
 * Moved here verbatim from the single-file client this package used to be, so
 * that `lib/api/` is the one place HTTP happens. Nothing about the requests
 * changed in the move; `lib/api-surface.ts` now re-exports this module, which
 * is why `pages/Surface.tsx` needed no edit.
 */

import { apiPath, getJson, patchJson, postJson, requestVoid } from "./http";

export type ApiPrincipleState = "held" | "aspirational" | "contested";
export type ApiPrincipleKind = "value" | "maxim" | "stance";

export interface ApiPrinciple {
  id: string;
  statement: string;
  type: ApiPrincipleKind;
  state: ApiPrincipleState;
  origin: "minted" | "declared";
  rank: number;
  locked: boolean;
  unsupported?: boolean;
  heldSince: string | null;
  conflictsWithId: string | null;
  citedSignals: Array<{ id: string; statement: string; examples?: Array<{ text: string; createdAt: string }> }>;
  createdAt: string;
  disputeId?: string | null;
}

export interface ApiPrincipleStatus {
  phase: "waiting" | "pending" | "processing" | "ready" | "failed";
  eligible: boolean;
  signalCount: number;
  topOfMindCount: number;
}

export async function fetchPrincipleRead(groupId?: string): Promise<{
  principles: ApiPrinciple[]; status: ApiPrincipleStatus;
}> {
  const path = groupId ? `/groups/${encodeURIComponent(groupId)}/principles` : "/principles";
  const [rows, state] = await Promise.all([
    getJson<{ principles: ApiPrinciple[] }>(apiPath(path), "Principles could not be loaded"),
    getJson<{ status: ApiPrincipleStatus }>(apiPath(`${path}/status`), "Principles status could not be loaded"),
  ]);
  return { principles: rows.principles, status: state.status };
}

export async function requestPrincipleRead(groupId?: string, retry = false): Promise<void> {
  const path = groupId ? `/groups/${encodeURIComponent(groupId)}/principles` : "/principles";
  await postJson(apiPath(`${path}/refresh${retry ? "?retry=1" : ""}`), {}, "Principles could not be started");
}

/** GET /principles — the acting profile's ranked set. */
export async function fetchPrinciples(): Promise<ApiPrinciple[]> {
  const body = await getJson<{ principles: ApiPrinciple[] }>(
    apiPath("/principles"),
    "Your principles could not be loaded",
  );
  return Array.isArray(body.principles) ? body.principles : [];
}

/* NO CLIENT FOR `POST /principles`. Founder, 2026-09-08: "You cannot declare
   your own values. This can only be generated. So remove this option." The
   route is still there and still routes a statement internally — what
   qualifies is minted, what reads as a goal is kept as an inspiration — but
   the product no longer offers a way to reach it, so the wrapper that did is
   gone rather than left sitting here uncalled. Restoring the act means
   restoring this function and its caller in `Home.tsx`; the server half needs
   nothing. */

/** PATCH /principles/:id — edit the statement; locks it. */
export async function updatePrinciple(
  principleId: string,
  statement: string,
): Promise<ApiPrinciple> {
  const body = await patchJson<{ principle: ApiPrinciple }>(
    apiPath(`/principles/${encodeURIComponent(principleId)}`),
    { statement },
    "That principle could not be updated",
  );
  return body.principle;
}

/** DELETE /principles/:id. */
export async function deletePrinciple(principleId: string): Promise<void> {
  await requestVoid(
    apiPath(`/principles/${encodeURIComponent(principleId)}`),
    "DELETE",
    undefined,
    "That principle could not be removed",
  );
}

/** POST /principles/reorder — the whole order; sticky against generation. */
export async function reorderPrinciples(order: string[]): Promise<ApiPrinciple[]> {
  const body = await postJson<{ principles: ApiPrinciple[] }>(
    apiPath("/principles/reorder"),
    { order },
    "That order could not be saved",
  );
  return Array.isArray(body.principles) ? body.principles : [];
}

/** POST /feedback with a not_true verdict — marks the principle contested. */
export async function disputePrinciple(principleId: string): Promise<void> {
  await requestVoid(
    apiPath("/feedback"),
    "POST",
    { targetType: "principle", targetId: principleId, value: "not_true" },
    "That dispute could not be recorded",
  );
}

export async function undoPrincipleDispute(principleId: string, disputeId: string): Promise<void> {
  await requestVoid(apiPath(`/principles/${encodeURIComponent(principleId)}/disputes/${encodeURIComponent(disputeId)}`),
    "DELETE", undefined, "That dispute could not be undone");
}
