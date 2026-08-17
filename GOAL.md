# Goal

**Make the world the product, on main's backend.**

The world (`packages/web/src/pages/Home.tsx`) is the main experience: one
column per mind — your wall, your agents' walls, your rooms — each with its
own three layers rendered as sky, headquarters and field. It replaced the
archive, which is deleted.

`origin/main` is the source of truth for **data structure and backend**. This
branch adapts the design to it, never the other way round. Where main has a
route, a table or a client function, the world uses main's rather than its own.

## The split, once both exist

Main built rooms and account-memory management as lists on the profile page.
This branch built the same concepts as walls in the world. Both are now in the
tree, and the duplication gets resolved deliberately:

- **Flat screens keep what is genuinely flat** — rename a profile, end a
  session, delete an account, change language. These need focus traps, text
  reflow at 200%, and plain confirmations that in-world UI cannot give.
- **The world keeps what is spatial** — travelling between minds, the field of
  memories, the sky of patterns, provenance, rooms as places.

`packages/web/src/styles/chrome.css` already assumes this split: it gives
the flat screens the world's palette and type without dragging them into its
geometry.

## What this branch adds on top of main

- `visibility` on inspirations (`private` default, `public` per capture), so a
  room's field can be its members' public memories. Reverses the old "layer 1
  never crosses an account boundary" rule — see `docs/data-model.md`.
- `GET /groups/:id/field` — a room's ground, public captures only, gated on
  current membership.
- A trigger refusing to make a signal `active` without 3 evidence rows, which
  the derivation pass already honored but nothing enforced.

## A room's top of mind is approved, not assigned

A room does not generate signals. Members form statements on their own walls,
share them in, and react to them. From that shared, affirmed material the
machine synthesises a draft, and the room approves it.

**Every member votes, whichever kind of mind they are.** A room of agents is
decided by its agents, because they are the only ones in it. A room of people
is decided by its people. A mixed room votes together, with no weighting — a
room is its members, and a member is a member.

**Synthesis fires on evidence, not on a clock or a button.** The same shape as
`emerging → active` at 3: the room proposes when enough shared and affirmed
material has accumulated to have something to say, and stays silent otherwise.
A cadence would draft from thin evidence in a slow week, which is exactly how
ungrounded statements reached the sky before.

**A pending draft shows WHO has approved, never a tally.** Named or by hue, so
you read the room rather than a scoreboard — and you can always tell whether
the missing approval is your own. This keeps the numerals law intact: the
count is legible because the people are, not because a number is printed.

**Approval freezes it.** The vote settles the artifact; it is versioned and
stands until a new draft is approved. Members joining or leaving afterwards do
not retroactively unmake what the room decided.

### Build it on what is already there

Most of this loop exists on the server. It was built by the rest of the team
and the world simply never called it. The job is to reach it, not to rebuild
it.

**Already working, end to end:**

- `group_top_of_mind_affirmations` — a table recording WHO affirmed which
  proposal. The "named, not counted" display reads straight from it; no new
  schema is needed for the vote.
- `affirmGroupProposal` already promotes automatically, atomically, guarded on
  `status = 'open'` so a decline racing an affirm cannot resurrect a proposal.
- acceptance already triggers synthesis:
  `requestRefresh(groupId, profileId, "proposal_accepted")`. Proposal → affirm
  → accepted → the room's artifact regenerates, today.
- `decline`, membership gating on every route, and
  `POST /groups/:id/top-of-mind/refresh`.

**The one real divergence from the ruling above:** the existing rule is "one
OTHER member seconds it" — an existence check for a single affirmation that is
not the proposer's. Majority means counting affirmations against the member
roll instead. That is a few lines inside one function, not a new system, and
everything downstream of it already works.

### The order, smallest unlock first

1. **Majority.** Replace the seconded-existence check with
   `affirmations >= ceil(members / 2)`, same atomic guard. Every member counts,
   whichever kind of mind they are. Extends the tests that already cover it.
2. **React to another member's statement.** `createFeedback` targets your own
   signals only, so a room cannot accumulate the affirmations synthesis is
   meant to read. Without this, step 3 has nothing to read.
3. **Synthesis on accumulated evidence.** Today a person must propose. The
   room should draft when enough shared, affirmed material exists — the same
   shape as `emerging → active` at 3.
4. **The world's surface for all of it**: a proposal with its author, who has
   affirmed, and a way to counter.

### Backend the UI is not using yet

Built and reachable, called from nowhere. Each is a feature the product paid
for and does not show:

- `refreshGroupTopOfMind` — ask a room to re-synthesise. Needed by step 3 and
  worth having as a verb regardless.
- `fetchTopOfMindVersions` — `/top-of-mind/versions`. The artifact is
  VERSIONED and nothing anywhere lets a person read an earlier version. The
  world's dial scrubs the field through time but the poster cannot be scrubbed
  through its own history.
- `fetchReflections` — reflections are counted on an orb and answered in the
  panel, but never listed on their own.
- `fetchPublicProfile` — the read-only `/@handle` page the account screen
  advertises.

### What this needs that does not exist yet

The server has the pieces and the world has almost none of them:

- `POST /groups/:id/top-of-mind/refresh` exists; nothing calls it
- `proposals` → `affirm` / `decline` exist; the world renders an open proposal
  but shows no author, no who-affirmed, and offers no counter
- reacting to a signal (`createFeedback`) targets your OWN signals only; there
  is no way to react to a statement another member shared
- nothing counts a majority or promotes on reaching one
- nothing triggers synthesis from accumulated shared evidence

## Non-negotiables

- Nothing merges. No PRs, nothing into `dev` or `main` until this is done.
  **Amended 2026-08-16:** the branch itself IS pushed — `origin/world/three-layers`
  is a backup, not a proposal. The original rule said "no pushes to GitHub",
  which conflated *merging* with *having a copy*, and by then this branch was
  ~20k lines of unreproducible work living on one laptop. Pushing a branch
  nobody has opened a PR against gives up nothing the rule was protecting.

  It does NOT get you CI for free: `.github/workflows/ci.yml` fires on
  `pull_request` and on pushes to `dev`/`main`, so a feature branch with no PR
  triggers nothing. Run it deliberately —
  `gh workflow run ci.yml --ref world/three-layers` — which the workflow allows
  via `workflow_dispatch`.
- Evidence never crosses an account boundary, whatever a capture's visibility
  says.
- Nothing is deleted for being wrong about itself: a signal that loses its
  grounds is demoted, not removed.

See `CLAUDE.md` for how to work in this repo.
