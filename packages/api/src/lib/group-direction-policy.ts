/**
 * How many distinct current room members must shape a shared top-of-mind pass.
 *
 * Half the room is enough to ask for a draft: exact halves count, odd rooms
 * round up, and a multi-member room never lets one person stand in for the
 * collective. Proposal acceptance is intentionally a separate, stricter
 * policy owned by `requiredDirectionResponses`.
 */
export function requiredDirectionContributors(memberCount: number): number {
  const normalizedMemberCount = Math.max(0, Math.floor(memberCount));
  if (normalizedMemberCount <= 1) return normalizedMemberCount;
  return Math.max(2, Math.ceil(normalizedMemberCount / 2));
}
