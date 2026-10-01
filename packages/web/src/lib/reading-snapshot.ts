import type { TopOfMind } from "./data";

/** Private read-snapshot ordering, not generation completion or artifact age. */
export function acceptsReadingSnapshot(current: TopOfMind | null, incoming: TopOfMind | null, profileId?: string): boolean {
  if (!incoming) return current === null;
  if (profileId && incoming.profileId && incoming.profileId !== profileId) return false;
  if (!current) return true;
  if (incoming.version < current.version) return false;
  const before = current.generationRevision;
  const next = incoming.generationRevision;
  if (before && /^\d+$/.test(before)) return Boolean(next && /^\d+$/.test(next) && BigInt(next) >= BigInt(before));
  return true;
}
