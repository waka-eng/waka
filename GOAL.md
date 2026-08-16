# Goal

**Make the world the product, on main's backend.**

The world (`packages/web/src/pages/World.tsx`) is the main experience: one
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

`packages/web/src/styles/world-chrome.css` already assumes this split: it gives
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

## Non-negotiables

- Everything stays local. No PRs, no pushes to GitHub.
- Evidence never crosses an account boundary, whatever a capture's visibility
  says.
- Nothing is deleted for being wrong about itself: a signal that loses its
  grounds is demoted, not removed.

See `CLAUDE.md` for how to work in this repo.
