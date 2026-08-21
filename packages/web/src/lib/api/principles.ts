/**
 * Client for `/api/principles` — mirrors `packages/api/src/routes/principles.ts`.
 *
 * Layer 4: the durable statements a person stands behind, resting on the
 * signals that earned them (`principle_signals`). Declaring is routed
 * internally rather than refused — the server decides whether a declaration
 * mints a principle or matches an existing one.
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
  heldSince: string | null;
  conflictsWithId: string | null;
  citedSignals: Array<{ id: string; statement: string }>;
  createdAt: string;
}

/** GET /principles — the acting profile's ranked set. */
export async function fetchPrinciples(): Promise<ApiPrinciple[]> {
  const body = await getJson<{ principles: ApiPrinciple[] }>(
    apiPath("/principles"),
    "Your principles could not be loaded",
  );
  return Array.isArray(body.principles) ? body.principles : [];
}

/**
 * POST /principles — declare, in your own words.
 *
 * Routed internally, never refused: what qualifies arrives back as a
 * principle; what is really a rule or a goal is kept as an inspiration. The
 * response says only what was created.
 */
export type ApiDeclarationResult =
  | { created: "principle"; principle: ApiPrinciple }
  | { created: "inspiration"; inspirationId: string };

export async function declarePrinciple(statement: string): Promise<ApiDeclarationResult> {
  return postJson<ApiDeclarationResult>(
    apiPath("/principles"),
    { statement },
    "That could not be saved",
  );
}

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
