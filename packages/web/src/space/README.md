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
  contents differ. Plus `settings/`, which is not a layer — see the bend below.
  Plus one loose file, `editing.ts`: changing the words is the same gesture on
  all three layers, so it belongs to none of them and sits above all three.
  That is the test for anything else arriving at this level — not "it is
  shared", but "it is the SAME ACT on every layer".
- `space-kinds/` — **how spaces differ from each other.** A space is yours, or
  an agent's, or a group's, and the three are not identical: an agent's orbs are
  pixelated, a group has members and hues and no dial. Everything that answers
  "how does *this kind* differ" is one of these four files.

A *space* is the thing that owns a full set of three layers — your own is one,
each of your agents has one, each group has one. `space-kinds/index.ts` defines
the word, and its header is worth the two minutes.

## The wrong guess, and it is the common one

**The `Space` type is in `space-kinds/index.ts`. It is not in `space/`.**

Read the two names cold and you would expect the opposite: `space/` holding the
thing, `space-kinds/` holding its variants — the way `Error` and its subclasses
would sit. It is the other way round. `space-kinds/index.ts` owns `Space`,
`SpaceKind`, `spaceKey`, `hasSky`, `hasDial` and `isMachine`; `space/` declares
no type named `Space` at all.

The sharpest illustration is real and in this tree: `space/settings/
SpaceSettings.tsx` — a file with "Space" in its name, sitting inside `space/` —
imports `Space` from `../../space-kinds`. If you were hunting for that type by
following names, you would have looked here first and not found it.

## Where does my change go

| The change | Where |
| --- | --- |
| How a save looks or lies on the ground | `space/inspiration/` |
| The one synthesized artifact, its entries, its poster | `space/top-of-mind/` |
| What you can do *to* a space | `space/settings/` |
| Opening, retyping or keeping a thing's words | `space/editing.ts` |
| "An agent's memories should look different" | `space-kinds/agent.ts` |
| "A group needs another member-facing rule" | `space-kinds/group.ts` |
| **A fourth kind of space** | a new file in `space-kinds/` — never a branch inside a layer |

The last row is the whole reason `space-kinds/` exists, and `docs/codebase.md`
records the bug class it ended: "how does an agent's space differ" used to be
answered independently in at least six places, and they disagreed in production
— a body hashed from a group id, typography and motion wired separately, one
space reading as a machine's in one place and a person's in another.

## Two things that are true and look like mistakes

**`space/settings/` is not a layer.** Every other subdirectory of `space/` is
named by a canon word; this one is a screen. It is the one place this tree's own
rule bends, and it bends because settings are about a space as a whole rather
than about any one of its layers, so neither directory is clean. It is recorded
rather than hidden.

**`space-kinds/` imports back up into `space/`.** `space-kinds/group.ts`
reaches into `space/inspiration/` and `space/top-of-mind/` for `colorBall`,
`scatterSeed`, `Ball` and `formingWords`. `docs/codebase.md` plans a one-way
layering — `space-kinds/` as pure predicates underneath `space/` — and the code
does not obey it. Do not trust the documented layering when tracing a
dependency; trust the imports.

This used to be a true CYCLE, with `space/signal/sky-engine.ts` reaching down
into `space-kinds/group.ts` for `makeGroupBall`. `space/signal/` was deleted on
2026-08-25 — layer 2 has no drawing of its own any more — so the loop is a
one-way violation now rather than a knot.

Also: `docs/codebase.md` names a `space-kinds/self.ts`. It was never written.
"Your own space" is a `SpaceKind` with no file, because so far nothing about it
differs — which is the correct outcome and only the document is stale.

## Why the names were not simply fixed

The names are the problem and renaming is the real repair. The shape it should
take: `space/` becomes `layers/` (its three canon subdirectories *are* the three
layers), `space-kinds/` becomes `space/` (it already owns the `Space` type), and
`settings/` moves under the new `space/`, which also ends the bend above.

That was measured and not done in the sitting that wrote this file, for one
mechanical reason. There are 11 source files across the two directories and 18
import statements that cross into them from outside. **Eleven of those 18 are in
`pages/Home.tsx`, and Home imports from all 11 files** — so nothing in either
directory can be renamed or moved without editing Home.tsx, which was being
rewritten by other work at the time. A rename that skipped it would not compile,
and a compatibility shim would leave two paths naming one directory, which is
the exact debt the vocabulary gate exists to prevent.

So: the rename is correct, it is blocked on `Home.tsx` alone, and it should be
done in a sitting that owns that file. Until then this page is the answer, and
`docs/map.md` carries the same rule in its directory table.
