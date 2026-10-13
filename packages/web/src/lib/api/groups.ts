/**
 * THREE SHAPES, AND NO CLIENT. ROOMS ARE GONE.
 *
 * Founder, 2026-10-12: "방 없애" — remove rooms. This file was the client for
 * `/api/groups`: twelve verbs, fourteen response shapes, a room's wall, its
 * ground, its board, its proposals and the four verbs that maintained it. The
 * routes it mirrored are gone from `packages/api/src/routes/` and so is every
 * caller. What is left below is three interfaces, kept for one reason that is
 * stated so nobody mistakes it for a plan to bring rooms back.
 *
 * WHY THE DECISION WENT THIS WAY, because the argument is the point and a
 * future reader will otherwise assume rooms were simply unfinished. An audit
 * on 2026-10-12 established that `.jar-here-list`, deleted on 2026-10-09, was
 * at once the ONLY list of the rooms you belong to and the ONLY opener of
 * `SpaceSettings` — the panel holding leave, rename, remove-member, close and
 * the invite link. Proof of unreachability, not a grep: `setSettingsFor` had
 * exactly three call sites and all three passed `null`, so the panel could
 * never mount. Room CREATION had already gone (`3e577129`). So what shipped
 * was a room you could be let into by a link somebody made before the cut and
 * never leave, never rename, never invite into, never close. Shown the choice
 * between rebuilding the missing half and finishing the removal, the founder
 * chose the removal.
 *
 * WHY THESE THREE SURVIVE, AND WHAT ENDS THEM. `canvas/simulation.ts` is
 * owned by another change in flight and may not be edited from here; it still
 * imports `ApiGroupSummary`, `ApiGroupMember` and `ApiGroupFieldInspiration`
 * by name, through `lib/api`'s barrel, for `SimulationOptions` fields that
 * `pages/Home` now feeds permanently-empty refs. The moment that file's group
 * branches come out, THIS WHOLE FILE GOES — it has no other reader, there is
 * no route behind it, and nothing can fill these shapes. It is a compile-time
 * splint on a removal that is otherwise complete, not a surface.
 *
 * `ApiGroupRole` stands only because the two interfaces below name it.
 */

import type { ApiProfileType } from "./http";
import type { ApiInspirationKind, ApiInspirationSource } from "./inspirations";

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
  /** Human or agent — what kind of company this room kept. */
  type: ApiProfileType;
  role: ApiGroupRole;
  joinedAt: string;
}

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
