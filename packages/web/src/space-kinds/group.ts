/**
 * A GROUP AS A SPACE: the wall a group is drawn as, and what furnishes it.
 *
 * `index.ts` beside this file says what KINDS of space exist and which of them
 * have a sky or a dial. This says what a group's own wall is made of: the
 * shared signals that become its orbs (`groupWallOrbs`) and what its
 * headquarters says
 * (`deriveGroupChrome`).
 *
 * The canon draws the boundary this module exists to hold: sharing is a
 * per-signal choice, an inspiration never crosses an account boundary, and a
 * member may see THAT someone's shared signal fed an entry, never which one.
 * Everything here works from `ApiGroupWallSignal` — the shared statement — and
 * never from anyone's raw saves, so the boundary is enforced by what this file
 * is able to reach rather than by remembering not to.
 */
import type { ApiGroupTopOfMind, ApiGroupWallSignal } from "../lib/api";
import { formingWords, type WallChrome } from "../space/top-of-mind/board";


/** One deduped evidence signal: a save this room's readings cited. */
export interface GroupEvidence {
  signalId: string;
  textPreview: string;
  quote: string | null;
  kind: string | null;
  createdMs: number;
  /** the LEAD contributor of a room-grown statement; null when the room
      served no names (never on a gated wall, defensive elsewhere) */
  authorUserId: string | null;
  authorName: string | null;
  /** Every reading of the room's that cited it — the panel's links sentence. */
  citedBy: string[];
}

/** Everything a room needs before it is allowed to wake. Cached per session. */
export interface GroupData {
  evidence: GroupEvidence[];
  top: ApiGroupTopOfMind | null;
}

/**
 * A ROOM IS A WALL OF STATEMENTS, AND EVERYTHING ELSE STAYS HOME.
 *
 * This used to build a room's orbs out of the evidence its readings cited —
 * other people's raw memories, previewed and quoted. The canon closed that:
 * sharing is a per-signal choice, an inspiration never crosses an account
 * boundary, and "a member may see that someone's shared signal fed an entry,
 * never which one".
 *
 * So a room's orbs are the shared PATTERNS themselves. Each carries whose it
 * is, and what it says. There is no quote, because the words behind it were
 * never sent and inventing one here would be the leak the canon forbids.
 * `citedBy` names the readings this member contributed to — attribution by
 * person, which is the finest grain the room is allowed to know.
 */
export function groupWallOrbs(wall: ApiGroupWallSignal[], top: ApiGroupTopOfMind | null): GroupEvidence[] {
  const fedBy = new Map<string, string[]>();
  for (const entry of top?.entries ?? []) {
    for (const c of entry.contributors) {
      const got = fedBy.get(c.profileId);
      if (got) {
        if (!got.includes(entry.body)) got.push(entry.body);
      } else fedBy.set(c.profileId, [entry.body]);
    }
  }
  const seen = new Map<string, GroupEvidence>();
  for (const s of wall) {
    if (seen.has(s.signalId)) continue;
    /* a room-grown statement leads with its first contributor — the member
       whose memory reached it first — and the board's citedBy is collected
       across every contributor, since the entry may credit any of them */
    const lead = s.contributors[0] ?? null;
    const cited = s.contributors.flatMap((c) => fedBy.get(c.profileId) ?? []);
    seen.set(s.signalId, {
      signalId: s.signalId,
      textPreview: s.statement,
      quote: null,
      kind: null,
      createdMs: Date.parse(s.sharedAt) || Date.now(),
      authorUserId: lead?.profileId ?? null,
      authorName: lead?.name ?? null,
      citedBy: [...new Set(cited)],
    });
  }
  return [...seen.values()];
}

/**
 * What the room's HQ will say, resolved before the room may wake.
 *
 * A group's artifact is the same one-artifact shape as a person's: entries,
 * pinned or in order, changed together through proposals. The room's poster is
 * its lead entry — pinned first, otherwise the top of the order — and there is
 * no generated stand-in when there is none.
 */
/* The room's NAME and the company standing in it were parameters until
   2026-08-27: they fed the eyebrow, and the eyebrow is gone (see
   `board.ts`'s note where the field was). The name is still on screen twice
   — the pill at the top left, and the axis below — and who is in the room is
   said by the company itself, drawn behind your companion. */
export function deriveGroupChrome(
  top: ApiGroupTopOfMind,
  openProposalMs: number | null,
  evidence: GroupEvidence[],
): WallChrome {
  const lead = top.entries.find((e) => e.pinnedAt) ?? top.entries[0] ?? null;
  const ambition = lead?.body ?? null;
  return {
    text: ambition,
    awayFrom: null,
    formingAlt: ambition ? null : "Forming — nothing read together yet",
    asOf: null,
    /* A room forms through proposals, not through signals overhead: members'
       signals stay on their own walls, so an open proposal is the only thing
       a room has that is on its way to becoming what it believes. */
    forming: formingWords(Date.now(), openProposalMs, null),
    empty: evidence.length === 0,
    prevText: null,
  };
}
