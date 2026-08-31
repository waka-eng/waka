/**
 * The gardener's asks — pairs of standing signals the weekly pass judged to
 * name ONE pattern, waiting on the owner's answer. Reading lists the open
 * proposals; resolving is the owner's act: `merge` (the survivor keeps the
 * union, the other retires with its provenance) or `keep_apart` (a standing
 * answer the gardener respects forever).
 */
import { apiPath, getJson, postJson } from "./http";

export interface ApiSignalDuplicate {
  id: string;
  similarity: number;
  createdAt: string;
  a: { signalId: string; statement: string };
  b: { signalId: string; statement: string };
}

export async function fetchSignalDuplicates(): Promise<ApiSignalDuplicate[]> {
  const body = await getJson<{ duplicates: ApiSignalDuplicate[] }>(
    apiPath("/signal-duplicates"),
    "The gardener's asks could not be loaded",
  );
  return body.duplicates;
}

export async function resolveSignalDuplicate(
  id: string,
  act: "merge" | "keep_apart",
): Promise<void> {
  await postJson(
    apiPath(`/signal-duplicates/${id}/resolve`),
    { act },
    "The answer was not recorded",
  );
}
