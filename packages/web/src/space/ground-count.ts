/**
 * THE DOOR HAS TO COUNT THE GROUND IT OPENS.
 *
 * Reported by the founder on 2026-08-28, standing on a room's wall: the
 * archive door said "3 INSPIRATIONS" and the ground under it held none.
 *
 * Both halves were behaving as designed, which is why it survived. A ROOM
 * POURS ONE MEMBER'S GROUND AT A TIME — that is deliberate, it is why the
 * world carries a "whose inspirations are on the ground" chooser, and
 * `onThisWall` enforces it: on a group's wall a ball is present only when
 * its owner is the member you are standing in. Meanwhile the door counted
 * `groupFieldRef` — the room's WHOLE pooled field, every member's public
 * memories together, which is what D5 built when it stopped the door
 * understating an archive.
 *
 * Two correct rules, two different sets, one label. Standing in your own
 * ground in a room where none of the pooled memories are yours, the door
 * said three and the ground had nothing in it.
 *
 * The door is the half that is wrong, because it sits directly above the
 * ground and its caret is what takes you down into it. A count over a thing
 * must be a count OF that thing.
 *
 * AND WHY THE REMAINDER IS NOT ADDED HERE. A room's field is loaded to a
 * ceiling, and `groupBeyondRef` holds what the ceiling did not let through —
 * for the ROOM. Nothing says whose those unloaded memories are, so adding
 * them to one member's count would be the same lie in the other direction:
 * a number over a ground, describing something else. D5's rule stands where
 * it can be honoured — your own archive and an agent's, where the count and
 * the remainder describe the same set.
 */
import type { ApiGroupFieldInspiration } from "../lib/api/groups";

/**
 * How many of a room's pooled field belong to the ground currently poured.
 *
 * @param field    the room's whole field, every member's public memories
 * @param standing the member being stood in, or `null` for your own ground
 * @param viewerId who you are — the owner of the ground `null` means
 */
export function groundCount(
  field: readonly ApiGroupFieldInspiration[] | undefined,
  standing: string | null,
  viewerId: string | null,
): number {
  if (!field || field.length === 0) return 0;
  /* the same fallback `onThisWall` uses, so the door and the ground cannot
     disagree about whose memories are underfoot */
  const whose = standing ?? viewerId ?? "";
  if (whose === "") return 0;
  let n = 0;
  for (const c of field) if (c.ownerProfileId === whose) n += 1;
  return n;
}
