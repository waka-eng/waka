/**
 * TWO SHAPES OF A ROOM THAT NO LONGER EXISTS.
 *
 * Founder, 2026-10-12: "방 없애" — remove rooms. This file held what a group's
 * wall was made of: `groupWallOrbs` turning members' shared statements into
 * orbs, `deriveGroupChrome` resolving what the room's headquarters said,
 * `groupReadingRestricts` and `groupReadingChanged` deciding when a shared
 * read had to be thrown away, and `GROUP_READ_TTL_MS` — thirty seconds,
 * because a permission-sensitive read is stale even when its version is not.
 * All of it is gone, along with the routes that fed it.
 *
 * WHAT WAS REJECTED. The alternative was to rebuild the half of rooms that
 * had gone missing. `.jar-here-list`, deleted on 2026-10-09, was at once the
 * only list of the rooms you belong to and the only opener of `SpaceSettings`
 * — leave, rename, remove a member, close, invite. Room creation had already
 * gone. What remained was a room you could be let into by an old link and
 * never leave: a one-way door. Shown that, the founder cut rooms rather than
 * rebuild the exits.
 *
 * WHY THE TWO INTERFACES STAND. `canvas/simulation.ts` belongs to another
 * change in flight and may not be edited from here. It imports `GroupData`
 * by name for `GroupCacheEntry`, which it declares itself and `pages/Home`
 * now holds as a permanently-empty map. When that file's group branches come
 * out, THIS FILE GOES WITH THEM: nothing can fill these shapes — the server
 * routes that produced them no longer exist — and nothing else imports it.
 *
 * `GroupEvidence` stands only because `GroupData` names it.
 */

/** One deduped evidence signal: a save a room's readings cited. */
export interface GroupEvidence {
  signalId: string;
  textPreview: string;
  quote: string | null;
  kind: string | null;
  createdMs: number;
  authorUserId: string | null;
  authorName: string | null;
  /** Every reading of the room's that cited it. */
  citedBy: string[];
}

/** The verified reading and evidence for one short-lived room snapshot. */
export interface GroupData {
  evidence: GroupEvidence[];
  top: null;
}
