/**
 * THE ROOM'S COMPANY — who stands behind your companion, and where.
 *
 * founder, 2026-08-27: "if room is group, show the character as many times as
 * number of members are there. but the character should feel like its behind
 * mine, and more small and subtle."
 *
 * This module is the half of that which is a FACT rather than a frame: which
 * members appear, in what order, at what offsets. The sim multiplies the
 * offsets by the companion's size and does the drawing; keeping the placement
 * pure is what lets a test hold the three rules that would otherwise only
 * break visibly in a live room with real people in it:
 *
 *   - the viewer is never among them — your companion already IS you, and a
 *     room that drew you twice would be a room with a stranger in it;
 *   - humans stand before machines, and otherwise in the room's own member
 *     order — the same order the legend, the hues and `groupCompany`'s words
 *     are numbered from, so the company reads in the same sequence everywhere
 *     the room is named;
 *   - every offset is derived from the member's id and their seat, and from
 *     nothing else — the world never moves unless the user moved it, and that
 *     includes nobody reshuffling between frames or between visits.
 *
 * Offsets are in units of the companion's size, so the placement scales with
 * the being it stands behind rather than with the viewport.
 */
import { unit } from "../character/body";
import type { ApiGroupMember } from "../lib/api";

export interface CompanyPlace {
  profileId: string;
  /** a machine member wears the machine bake — pixels, colder light */
  agent: boolean;
  /** horizontal offset from the companion's centre, in companion sizes */
  dx: number;
  /** vertical offset — always negative: behind means above and beyond */
  dy: number;
  /** where its hover starts, 0..1 — so a row of beings breathes out of step */
  phase: number;
}

export function groupCompanyPlaces(
  members: ApiGroupMember[] | undefined,
  viewerId: string | null,
): CompanyPlace[] {
  if (!members || members.length === 0) return [];
  /* without knowing which one is you, drawing anyone risks drawing you —
     same guard, same reason, as `groupCompany`'s words */
  if (!viewerId) return [];
  const others = members.filter((m) => m.profileId !== viewerId);
  const ordered = [
    ...others.filter((m) => m.type !== "agent"),
    ...others.filter((m) => m.type === "agent"),
  ];
  const n = ordered.length;
  return ordered.map((m, i) => {
    /* a shallow arc behind and above: centred on yours, rising a little
       toward the edges, with a per-id nudge so a full room does not read as
       a picket fence */
    const k = i - (n - 1) / 2;
    return {
      profileId: m.profileId,
      agent: m.type === "agent",
      dx: k * 0.6 + (unit(m.profileId, "cx") - 0.5) * 0.14,
      dy: -(0.52 + Math.abs(k) * 0.06) + (unit(m.profileId, "cy") - 0.5) * 0.1,
      phase: unit(m.profileId, "bp"),
    };
  });
}
