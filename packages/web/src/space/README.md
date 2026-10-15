# `space/` and `space-kinds/` — which one holds what

Two directories sit side by side here whose names are near-synonyms. Nothing in
either name tells you which holds what, and one of them holds the opposite of
what its name suggests. This file exists because that ambiguity has a right
answer and no way to reach it from the names alone.

It lives in `space/` rather than in `docs/` because `space/` is almost entirely
subdirectories, so there was nowhere inside it for its own rule to be written
down. A reader who opens the folder now finds one.

## The rule, in one line

**`space/` is split by LAYER. `space-kinds/` is split by KIND.**

- `space/` — **what every space has.** One subdirectory per canon layer:
  `inspiration/`, `signal/`, `top-of-mind/`. Same code for everyone; only the
  contents differ. Plus one loose file, `editing.ts`: changing the words is the
  same gesture on all three layers, so it belongs to none of them and sits
  above all three. That is the test for anything else arriving at this level —
  not "it is shared", but "it is the SAME ACT on every layer".
- `space-kinds/` — **how spaces differ from each other.** A space is yours or
  an agent's, and the two are not identical: an agent's orbs are pixelated.
  Everything that answers "how does *this kind* differ" is one of these files.

A *space* is the thing that owns a full set of three layers — your own is one,
each of your agents has one. `space-kinds/index.ts` defines the word, and its
header is worth the two minutes.

## Rooms were the third kind, and they are gone (2026-10-12)

Founder: "방 없애" — remove rooms. This page described three kinds of space and
two of this tree's oddities were rooms' doing, so it is corrected here rather
than left to read as current.

- **`space/settings/` is gone**, with `SpaceSettings.tsx` — the panel that held
  a room's roll, its invite link, rename, leave, close and remove-a-member. It
  could not mount: `setSettingsFor` had exactly three call sites and all three
  passed `null`, because its opener was deleted with `.jar-here-list` on
  2026-10-09 — the same commit that removed the only list of your rooms. **That
  also ends the bend below**: every subdirectory of `space/` is now named by a
  canon word, which is what the rule always said it should be.
- **`space-kinds/group.ts` is gone**, and so is **`space/group-company.ts`**.
  The first held `groupWallOrbs`, `deriveGroupChrome`, the two shared-read
  predicates and `GROUP_READ_TTL_MS`; by 2026-10-12 it was down to the two
  interfaces `GroupData` and `GroupEvidence`, kept alive only because
  `canvas/simulation.ts` imported the first by name and could not be edited
  from that change. The second placed a room's members behind your companion
  and carried the NPC research that gave them four idles, a depth and a
  reaction delay. Both were deleted on 2026-10-15 with the loop's group
  branches, along with `lib/api/groups.ts`. **CORRECTION (2026-10-15): the
  upward import is NOT gone.** This claimed "nothing in `space-kinds/` reaches
  into `space/top-of-mind/` any more" and that the layering `docs/codebase.md`
  planned was accidentally satisfied. Neither is true: `space-kinds/agent.ts:16`
  still does `import { formingWords, type WallChrome } from
  "../space/top-of-mind/board"`, and always did. Deleting `group.ts` removed
  one upward import, not the layering violation — which was never `group.ts`'s.
- **`space/ground-count.ts` is gone.** It answered "how many of a room's pooled
  field belong to the ground currently poured", which was the fix for a real
  defect: the founder stood in a room holding three memories, none of them
  theirs, and read "3 INSPIRATIONS" over an empty ground.

## The wrong guess, and it is the common one

**The `Space` type is in `space-kinds/index.ts`. It is not in `space/`.**

Read the two names cold and you would expect the opposite: `space/` holding the
thing, `space-kinds/` holding its variants — the way `Error` and its subclasses
would sit. It is the other way round. `space-kinds/index.ts` owns `Space`,
`SpaceKind`, `spaceKey`, `hasSky`, `hasDial` and `isMachine`; `space/` declares
no type named `Space` at all.

The sharpest illustration used to be real and in this tree: `space/settings/
SpaceSettings.tsx` — a file with "Space" in its name, sitting inside `space/` —
imported `Space` from `../../space-kinds`. If you had hunted for that type by
following names, you would have looked there first and not found it. That file
went with rooms, so the illustration is now history rather than a specimen —
and the trap it illustrated is not, which is why this section stands.

## Where does my change go

| The change | Where |
| --- | --- |
| How a save looks or lies on the ground | `space/inspiration/` |
| The one synthesized artifact, its entries, its poster | `space/top-of-mind/` |
| Opening, retyping or keeping a thing's words | `space/editing.ts` |
| "An agent's memories should look different" | `space-kinds/agent.ts` |
| **A fourth kind of space** | a new file in `space-kinds/` — never a branch inside a layer |

The last row is the whole reason `space-kinds/` exists, and `docs/codebase.md`
records the bug class it ended: "how does an agent's space differ" used to be
answered independently in at least six places, and they disagreed in production
— a body hashed from a group id, typography and motion wired separately, one
space reading as a machine's in one place and a person's in another.

## Two things that were true and looked like mistakes

**One is fixed, by a deletion rather than by design — the other is NOT**
(corrected 2026-10-15: the upward import from `space-kinds/agent.ts` into
`space/top-of-mind/board` is still there, and deleting `group.ts` never
touched it). Worth knowing before anyone reintroduces either, and before
anyone trusts this file's layering claim.

**`space/settings/` was not a layer.** Every other subdirectory of `space/` is
named by a canon word; that one was a screen. It was the one place this tree's
rule bent, and it bent because settings are about a space as a whole rather
than about any one of its layers. It went with rooms on 2026-10-12.

**`space-kinds/` imported back up into `space/`, once.** `space-kinds/group.ts`
reached into `space/top-of-mind/` for `formingWords` and `WallChrome`, and
`docs/codebase.md` plans a one-way layering that the import did not obey. That
file was down to two interfaces importing nothing, and is now deleted
outright. The standing advice survives both repairs: trust the imports when
tracing a dependency, not the documented layering.

It was a true CYCLE until 2026-08-25, and much wider: `space/signal/sky-engine.ts`
reached down for `makeGroupBall`, which reached back up for `colorBall`,
`scatterSeed` and `Ball` to build a room's evidence as a real field orb before
the sky hung it. Deleting `space/signal/` left `makeGroupBall` with no caller;
deleting that closed the loop and took three of the four upward imports with
it.

Also: `docs/codebase.md` names a `space-kinds/self.ts`. It was never written.
"Your own space" is a `SpaceKind` with no file, because so far nothing about it
differs — which is the correct outcome and only the document is stale.

## Why the names were not simply fixed

The names are the problem and renaming is the real repair. The shape it should
take: `space/` becomes `layers/` (its three canon subdirectories *are* the three
layers) and `space-kinds/` becomes `space/` (it already owns the `Space` type).
`settings/` was to move under the new `space/`; it has since been deleted
outright, which removes one step.

That was measured and not done in the sitting that wrote this file, for one
mechanical reason: 11 source files across the two directories and 18 import
statements crossing in from outside, **eleven of those 18 in `pages/Home.tsx`**
— so nothing could be renamed without editing Home, which other work was
rewriting at the time.

THE COUNT IS SMALLER NOW AND THE BLOCKER IS THE SAME SHAPE. Removing rooms
deleted six files across the two directories (`settings/SpaceSettings.tsx`,
`ground-count.ts`, and `space-kinds/`'s `GroupPanel`, `GroupMoment`,
`GroupSignalFeedback` and `group-history`) and took Home's imports with them.
What blocks the rename today is `canvas/simulation.ts`, which imports from both
directories and belongs to a change in flight. The rename is still correct, and
it should be done in a sitting that owns both big files. Until then this page is
the answer, and `docs/map.md` carries the same rule in its directory table.
