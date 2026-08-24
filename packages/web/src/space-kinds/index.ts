/**
 * WHAT KIND OF SPACE THIS IS, AND WHAT FOLLOWS FROM IT.
 *
 * A **space** is the thing that owns a full set of three layers —
 * inspirations, signals, one top of mind. Yours is one, each of your agents
 * has one, each group has one. `docs/architecture.md` calls it the one word
 * this frontend invents, for a real reason: the backend has `profiles` and it
 * has `groups`, and no single noun for "the thing whose three layers these
 * are". Every space renders identically and differs only in whose material it
 * holds, which is what this module is for.
 *
 * THE NAMES CHANGED HERE, and this is why the rename had to wait for the
 * split. It was `Wall` / `WallKind` / `wallKey` with a kind called `"room"`.
 * The backend says `groups`, `group_members`, `group_top_of_mind_proposals` —
 * one word at both ends — so the code says `group`. Doing that inside a
 * 13,000-line file means a scripted find-and-replace over 300-odd matches;
 * doing it inside seventy lines is something the compiler checks and a person
 * can read. "Room" survives in what a person sees on screen, which is a
 * different register and deliberately unchanged.
 *
 * `docs/codebase.md` names the bug this exists to end: "how does an agent's
 * space differ" is answered independently in at least six places, and they
 * have disagreed in production — a body hashed from a group id, typography
 * and motion wired separately, one space reading as a machine's in one place
 * and a person's in another. A fourth kind of space should be a new entry
 * here, not a hunt.
 *
 * THIS DIRECTORY AND `space/` ARE NOT THE SAME AXIS, and the names do not say
 * so. `space/` is split by LAYER — one subdirectory per canon layer, the code
 * every space runs. `space-kinds/` is split by KIND — what differs between
 * yours, an agent's and a group's. The trap is that reading the two names cold
 * suggests the reverse, a general `space/` with its variants in `space-kinds/`:
 * in fact the `Space` type is the one declared right here, and `space/` has no
 * type by that name. `space/README.md` states the rule, the file that most
 * embarrasses it (`space/settings/SpaceSettings.tsx` importing `Space` from
 * this file), and why the directories were not simply renamed.
 */

/** The three kinds, in the axis order they stand in: agents ← you → groups. */
export type SpaceKind = "self" | "group" | "agent";

export interface Space {
  kind: SpaceKind;
  /** the group id, the agent id, or "" for your own */
  id: string;
  /** the eyebrow, and the name a neighbouring column's edge says */
  name: string;
  /** where it stands: agents negative, you at the origin, groups positive */
  col: number;
}

/** One space, one key. Two spaces of different kinds can share an id. */
export const spaceKey = (s: Space): string => `${s.kind}:${s.id}`;

/**
 * EVERY SPACE HAS A SKY, INCLUDING A GROUP'S.
 *
 * Groups were carved out of this when a group had nothing to put up there.
 * Under the canon they do: members share SIGNALS in, and what hangs there is
 * exactly that — statements, other people's, not yet agreed. Without a sky
 * those shared statements have nowhere to live at all, because the field is
 * always your own memories by ruling and headquarters holds only what has
 * been settled. The shape is the same everywhere, which is the point.
 */
export const hasSky = (k: SpaceKind): boolean =>
  k === "self" || k === "agent" || k === "group";

/**
 * THE DIAL WINDS EVERY SPACE, INCLUDING A ROOM — AND IN A ROOM IT WINDS THE
 * BOARD, NOT THE GROUND.
 *
 * It used to stay out of a group, and the reason written here was that a
 * group is several people's statements arriving on their own clocks so there
 * is no single history to scrub. That is true of a room's FIELD and it was
 * never true of the thing the dial actually governs. A room's board is one
 * chain — version one superseded by version two superseded by version three,
 * each with a reason — hung on one door ledger of arrivals and departures.
 * That is a single history, and it is the room's own.
 *
 * The founder's line in `goals/room-timeline.md` is "scrubber before dial":
 * the flat surface's rail came first, the world's dial second. This is the
 * second one. What it winds is the sentence over the room and the marks on
 * its door; the ground below stays your own memories at present time, because
 * whose memories those are is a ruling and not a matter of when.
 */
export const hasDial = (_k: SpaceKind): boolean => true;

/**
 * Whether this space is a machine's. The predicate lives here so the body,
 * the typography, the orbs and the motion cannot disagree about it — which
 * they have.
 */
export const isMachine = (k: SpaceKind): boolean => k === "agent";
