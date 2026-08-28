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
 * WHAT A ROOM THAT HAS NOT SPOKEN YET IS WAITING FOR.
 *
 * A room's silence is designed, and that is exactly why it needs explaining. A
 * room reads its members' PUBLIC memories, and serves a statement only once
 * memories from more than one member stand under it — so a room of one, or a
 * room of people whose memories are all private, is correctly dark. Nothing on
 * the surface said which of those it was: every one of them rendered the same
 * "Forming — nothing read together yet", a sentence that describes four
 * different situations and names an act in none of them.
 *
 * The stages are ordered, and the room reports THE FIRST MISSING THING rather
 * than the nearest one. Ordered this way because each stage is a precondition
 * of the next: a room with nobody in it cannot have a ground, a room with no
 * ground cannot have a two-voiced statement, and a statement nobody has
 * answered is the last thing standing between a room and its first reading.
 * Telling somebody to open a memory when there is nobody to read it would be
 * advice that cannot work — which is the failure the room's one old sentence
 * made four different ways.
 */
export type GroupStage = "alone" | "bare" | "one-voiced" | "unanswered";

export interface GroupWaiting {
  /** the roll, including you */
  members: number;
  /** public memories standing on the room's ground */
  ground: number;
  /** statements the room has grown from that ground */
  wall: number;
}

/**
 * The first thing a dark room is missing.
 *
 * Always answers: a room that has all four is not dark, and its own sentence
 * is up instead — `deriveGroupChrome` asks this only when there is nothing
 * adopted to say.
 */
export function groupStage(waiting: GroupWaiting): GroupStage {
  if (waiting.members < 2) return "alone";
  if (waiting.ground === 0) return "bare";
  if (waiting.wall === 0) return "one-voiced";
  return "unanswered";
}

/**
 * The stage as a sentence — a STATE and the one act that moves it.
 *
 * No counts, in either half. "More than one of you" is the two-voices rule in
 * words, and it is the closest this surface comes to a number on purpose: the
 * law is that states render and numerals never, and a room that said "1 of 2
 * voices" would be reporting its own arithmetic instead of its condition.
 */
export function groupStageWords(stage: GroupStage): string {
  switch (stage) {
    case "alone":
      return "Nobody else is here yet — the invite is the way in.";
    case "bare":
      return "Nothing is open here yet — a memory you open stands on this ground.";
    case "one-voiced":
      return "Nothing here stands under more than one of you yet.";
    case "unanswered":
      return "Something is forming — say whether it is true of you.";
  }
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
  /* What the room is still waiting for, when it has not spoken. The wall count
     is `evidence` itself — the room's grown statements are what furnish it —
     so only the two the orbs cannot answer are passed. */
  waiting: Pick<GroupWaiting, "members" | "ground">,
): WallChrome {
  const lead = top.entries.find((e) => e.pinnedAt) ?? top.entries[0] ?? null;
  const ambition = lead?.body ?? null;
  return {
    text: ambition,
    awayFrom: null,
    formingAlt: ambition
      ? null
      : groupStageWords(groupStage({ ...waiting, wall: evidence.length })),
    asOf: null,
    /* A room forms through proposals, not through signals overhead: members'
       signals stay on their own walls, so an open proposal is the only thing
       a room has that is on its way to becoming what it believes. */
    forming: formingWords(Date.now(), openProposalMs, null),
    empty: evidence.length === 0,
    prevText: null,
  };
}
