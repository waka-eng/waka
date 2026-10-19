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

import { ApiError,apiPath, getJson, patchJson, postJson, requestVoid, type ProfileScoped } from "./http";
import type {ApiSignalReviewEvidence} from './signals';

export type ApiPrincipleState = "held" | "aspirational" | "contested";
export type ApiPrincipleKind = "value" | "maxim" | "stance";

export interface ApiPrinciple {
  id: string;
  statement: string;
  statementRevision?: string;
  type: ApiPrincipleKind;
  state: ApiPrincipleState;
  origin: "minted" | "declared";
  rank: number;
  locked: boolean;
  unsupported?: boolean;
  supportChanged?: boolean;
  heldSince: string | null;
  conflictsWithId: string | null;
  citedSignals: Array<{ id: string; statement: string; examples?: Array<{ text: string; createdAt: string }>; reviewExamples?: ApiSignalReviewEvidence[] }>;
  createdAt: string;
  disputeId?: string | null;
}

export interface ApiPrincipleStatus {
  supportPending?: boolean;
  phase: "waiting" | "pending" | "processing" | "ready" | "failed";
  /** The latest reading or principles job failed (see `readingPausedFor` in
      the API's `lib/principle-status.ts`). Optional so an older server that
      never sends it reads as "not paused" rather than as an error. */
  readingPaused?: boolean;
  eligible: boolean;
  signalCount: number;
  topOfMindCount: number;
}
export interface ApiPrincipleStatements {
  profileId:string;principleId:string;currentStatementId:string|null;
  previousStatementId?:string|null;
  statements:Array<{id:string;statement:string;createdAt:string}>;
}
export async function fetchPrincipleStatements(id:string,profileId:string,signal?:AbortSignal):Promise<ApiPrincipleStatements>{
  const row=await getJson<ApiPrincipleStatements>(apiPath(`/principles/${encodeURIComponent(id)}/statements?profile=${encodeURIComponent(profileId)}`),'Earlier wording could not be loaded',signal);
  if(!row||row.profileId!==profileId||row.principleId!==id||!Array.isArray(row.statements)||row.statements.length>50||
    row.statements.some(item=>typeof item.id!=='string'||typeof item.statement!=='string'||!Number.isFinite(Date.parse(item.createdAt)))||
    (row.currentStatementId!==null&&!row.statements.some(item=>item.id===row.currentStatementId))||
    (row.previousStatementId!=null&&!row.statements.some(item=>item.id===row.previousStatementId&&item.id!==row.currentStatementId)))throw new ApiError({status:200,code:'invalid_principle_statements',message:'Could not verify earlier wording'});
  return row;
}

/* THE OPTIONAL `groupId` IS GONE FROM BOTH OF THESE. It switched the path
   onto `/groups/:id/principles` — a room's own philosophies and values,
   which `goals/room-timeline.md` (since removed) had ruled every room would eventually grow.
   Rooms are gone (founder, 2026-10-12: "방 없애"), the route is unmounted,
   and the only caller passed `undefined` by the end. `retry` is now the
   first parameter rather than the second, which is the whole change at the
   one call site in `components/PrincipleRead.tsx`. */

/* NO SHARED STATUS CACHE. Each reader of `/principles/status` makes its own
   GET, as on dev: a shared in-flight request with published answers was
   tried here and every ordering it allowed (a GET sent before a retry
   landing after it, an answer from before a sign-out) needed its own rule. */

/** GET /principles/status. */
export async function fetchPrincipleStatus(): Promise<ApiPrincipleStatus> {
  return (await getJson<{ status: ApiPrincipleStatus }>(apiPath("/principles/status"), "Principles status could not be loaded")).status;
}

export async function fetchPrincipleRead(): Promise<{
  principles: ApiPrinciple[]; status: ApiPrincipleStatus;
}> {
  const [rows, status] = await Promise.all([
    getJson<{ principles: ApiPrinciple[] }>(apiPath("/principles"), "Principles could not be loaded"),
    fetchPrincipleStatus(),
  ]);
  return { principles: rows.principles, status };
}

/** POST /principles/refresh?retry=1 — restarts a failed reading and principles. */
export async function retryPausedReading(): Promise<ApiPrincipleStatus> {
  return (await postJson<{ status: ApiPrincipleStatus }>(apiPath("/principles/refresh?retry=1"), {}, "The reading could not be restarted")).status;
}

export async function requestPrincipleRead(retry = false): Promise<void> {
  await postJson(apiPath(`/principles/refresh${retry ? "?retry=1" : ""}`), {}, "Principles could not be started");
}

/** GET /principles — the acting profile's ranked set. */
export async function fetchPrinciples(options:ProfileScoped={},signal?:AbortSignal): Promise<ApiPrinciple[]> {
  const query=options.profile?`?profile=${encodeURIComponent(options.profile)}`:'';
  const body = await getJson<{ principles: ApiPrinciple[] }>(
    apiPath(`/principles${query}`),
    "Your principles could not be loaded",signal,
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
  options?:{profile:string;expectedStatementRevision:string;signal?:AbortSignal},
): Promise<ApiPrinciple> {
  const body = await patchJson<{ principle: ApiPrinciple }>(
    apiPath(`/principles/${encodeURIComponent(principleId)}${options?`?profile=${encodeURIComponent(options.profile)}`:''}`),
    { statement,...(options?{expectedStatementRevision:options.expectedStatementRevision}:{}) },
    "That principle could not be updated",
    options?.signal,
  );
  if(options&&(!body.principle||body.principle.id!==principleId||body.principle.statement!==statement.trim()||!body.principle.locked||!body.principle.statementRevision))throw new ApiError({status:200,message:'Could not verify the principle update.'});
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
export async function disputePrinciple(principleId: string, targetRevision?: string): Promise<void> {
  await requestVoid(
    apiPath("/feedback"),
    "POST",
    { targetType: "principle", targetId: principleId, value: "not_true", ...(targetRevision ? { targetRevision } : {}) },
    "That dispute could not be recorded",
  );
}

export async function undoPrincipleDispute(principleId: string, disputeId: string): Promise<void> {
  await requestVoid(apiPath(`/principles/${encodeURIComponent(principleId)}/disputes/${encodeURIComponent(disputeId)}`),
    "DELETE", undefined, "That dispute could not be undone");
}
