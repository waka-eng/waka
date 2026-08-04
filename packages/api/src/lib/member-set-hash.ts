/**
 * Canonical identity of a set of hearts.
 *
 * A combination IS its members, so the same people must hash the same way
 * however they were listed — otherwise the same room read twice becomes two
 * combinations and every reading looks new. Sorted and deduplicated before
 * hashing for exactly that reason.
 */

import { createHash } from "node:crypto";

export function memberSetHashFor(userIds: string[]): string {
  const canonical = [...new Set(userIds)].sort().join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
