/**
 * WHAT KIND OF SPACE THIS IS, AND WHAT FOLLOWS FROM IT.
 *
 * A **space** is the thing that owns a full set of three layers —
 * inspirations, signals, one top of mind. Yours is one, each of your agents
 * has one. `docs/architecture.md` calls it the one word this frontend
 * invents, for a real reason: the backend has `profiles` and no single noun
 * for "the thing whose three layers these are". Every space renders
 * identically and differs only in whose material it holds, which is what
 * this module is for.
 *
 * ── ROOMS WERE THE THIRD KIND, AND THEY ARE GONE (2026-10-12) ───────────
 *
 * Founder: "방 없애" — remove rooms.
 *
 * THIS FILE'S OLD HEADER ARGUED THE OPPOSITE AT LENGTH, and the argument was
 * sound at the time, which is why the ruling is written here rather than the
 * paragraphs simply disappearing. It said the backend's one word was
 * `groups`, so the code should say `group`; it said every space has a sky
 * because "every room will eventually have its own philosophies and values"
 * (founder, 2026-08-27); it said the dial winds a room's board because a
 * room's board is one chain and therefore one history. None of that was
 * wrong. It was all downstream of rooms existing.
 *
 * WHAT MADE THEM GO. An audit on 2026-10-12 established that the deletion of
 * `.jar-here-list` on 2026-10-09 had removed, in one commit, both the ONLY
 * list of the rooms you belong to and the ONLY opener of `SpaceSettings` —
 * the panel that held leave, rename, remove-member, close and the invite
 * link. The proof was not a grep but a closed set: `setSettingsFor` had three
 * call sites and all three passed `null`, so the panel could never mount.
 * Creating a room had already gone. What shipped, therefore, was a room you
 * could be let into by a link made before the cut and could then never leave,
 * rename, invite into, or close — a one-way door. Offered the choice between
 * rebuilding the exits and finishing the removal, the founder removed rooms.
 *
 * WHY `"group"` IS STILL IN THE UNION BELOW, which is the one thing here a
 * reader will think is an oversight. `canvas/simulation.ts` is owned by
 * another change in flight and may not be edited from this one. It compares
 * `w.kind === "group"` in eight places, and TypeScript rejects a comparison
 * against a literal the union does not contain — so dropping the member now
 * would break the build in a file this change is not allowed to touch.
 * Nothing constructs a `Space` with that kind any more: `pages/Home`'s axis
 * is agents, then you, and stops. The member is a compile-time splint, and it
 * comes out the moment the loop's group branches do.
 *
 * THIS DIRECTORY AND `space/` ARE NOT THE SAME AXIS, and the names do not say
 * so. `space/` is split by LAYER — one subdirectory per canon layer, the code
 * every space runs. `space-kinds/` is split by KIND — what differs between
 * yours and an agent's. The trap is that reading the two names cold suggests
 * the reverse, a general `space/` with its variants in `space-kinds/`: in
 * fact the `Space` type is the one declared right here, and `space/` has no
 * type by that name. `space/README.md` states the rule and why the
 * directories were not simply renamed.
 */

/** The kinds, in the axis order they stand in: agents ← you. */
export type SpaceKind = "self" | "group" | "agent";

export interface Space {
  kind: SpaceKind;
  /** the agent id, or "" for your own */
  id: string;
  /** the eyebrow, and the name a neighbouring column's edge says */
  name: string;
  /** where it stands: agents negative, you at the origin */
  col: number;
}

/** One space, one key. Two spaces of different kinds can share an id. */
export const spaceKey = (s: Space): string => `${s.kind}:${s.id}`;

/**
 * EVERY SPACE HAS A SKY, and with rooms gone there is nothing left for this
 * to decide. It was ruled three times — every space including a room's, then
 * your own column alone (founder, 2026-08-25), then opened again when the
 * founder said every room would grow its own philosophies and values
 * (2026-08-27). Yours and your agent's both have one, which is the answer the
 * third ruling landed on for the two kinds that remain. The function stays
 * because `hasDial` beside it stays, and a space asking the two questions
 * through the same shape is what keeps a fourth kind a new entry here rather
 * than a hunt.
 */
export const hasSky = (_k: SpaceKind): boolean => true;

/**
 * THE DIAL WINDS EVERY SPACE.
 *
 * It used to stay out of a room, then it wound a room's BOARD — one chain of
 * versions on one door ledger, which is a single history and was the room's
 * own. The founder's line in `goals/room-timeline.md` was "scrubber before
 * dial". Both the board and the ledger went with rooms; what the dial winds
 * now is your own wall and your agent's, which is what it wound first.
 */
export const hasDial = (_k: SpaceKind): boolean => true;
