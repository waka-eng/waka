# Goal: Group Top of Mind boards

Status: in progress (started 2026-07-07)
Branch: `goal/group-top-of-mind-latest`
PRD story: US-052

## Why

WAKA's core object is the personal **Top of Mind** wall — five ephemeral post-its
synthesized from the inspirations a person saved. The next move is social: let a
small group pool what they saved so WAKA can show a **shared Top of Mind** that
belongs to the group, not just to one person.

The earlier attempt (US-051, `group_conversation_rooms`) modeled this as *chat
rooms* — participants, prompts, reactions, "keep talking." That is not the mental
model the product wants. The product wants **boards**:

- A board for **my own Top of Mind**.
- One board per **group** I belong to (there can be several).
- For each inspiration I save, I decide whether it's **shared** with my groups or
  **kept private**.

US-051's conversation-room tables are left in place but are not part of this
experience. This goal introduces a clean `groups` / `group_members` model.

## User-facing behavior

1. **Boards.** The Top of Mind experience gains a board switcher. "Mine" is the
   existing personal wall. Each group I'm in is another board with the same
   post-it visual language, showing the group's synthesized Top of Mind.
2. **Create a group.** I name a group; WAKA creates it, makes me the owner, and
   gives me a **join link / code** to share.
3. **Join a group.** Anyone with the link/code joins the group and starts
   contributing their shared inspirations to it.
4. **Share vs private.** New inspirations are **shared with my groups by default**.
   At capture time (and later) I can flip a single control to keep an inspiration
   **private** — private inspirations never feed any group board.

## What lands on a group board (synthesis model)

A group board is **synthesized from the pool of all members' shared
inspirations**, not a side-by-side of each member's own board.

v1 synthesis (deterministic, no live model required, privacy-safe):

- Collect the set of **shared** signal ids across all members (a signal is shared
  when `signals.shared_to_groups = true`).
- For each member, take their synthesized Top of Mind notes and keep only those
  **backed by at least one shared signal**. Evidence previews for non-shared
  signals are **redacted** so a private inspiration is never exposed through a
  group note.
- **Dedupe across members** (reusing `dedupeTopOfMindNotes`) so the same pattern
  surfaced by two people merges into one group post-it.
- Rank by confidence + recency; show the strongest few.

This is genuine pool-level synthesis at the note layer: a note only reaches the
group because its evidence was shared, and cross-member near-duplicates merge into
one shared truth.

Deferred (documented, not built in v1): cross-member *signal-level* generation —
running the wow-judge over a pooled candidate set spanning multiple users to
create brand-new group notes whose evidence spans several people. This needs the
model provider and a group-scoped candidate/persistence path; it slots in behind
the same `/api/groups/:id/top-of-mind` surface without changing the client.

## Data model

- `groups`: `id`, `owner_user_id`, `name`, `join_code` (unique), timestamps.
- `group_members`: `id`, `group_id`, `user_id`, `role` (`owner`|`member`),
  `created_at`; unique `(group_id, user_id)`.
- `signals.shared_to_groups boolean not null default true` — the private/shared
  switch, shared-by-default.

## API

- `GET  /api/groups` — groups I belong to (name, role, member count, join code
  for owners).
- `POST /api/groups` — create `{ name }` → group + owner membership + join code.
- `POST /api/groups/join` — `{ joinCode }` → join (idempotent).
- `POST /api/groups/:groupId/leave` — leave.
- `GET  /api/groups/:groupId/top-of-mind` — synthesized group notes (member-only).
- `POST /api/inspirations` — accepts `shareToGroups` (default `true`).
- `PATCH /api/inspirations/:id/sharing` — `{ shareToGroups }` to flip later.

All routes are tenant-scoped and require auth. Group-scoped reads verify
membership before returning anything.

## Acceptance criteria

See US-052 in `prd.json`. Summary:

- Board switcher shows "Mine" + each group; switching loads that board.
- Create + join (via link/code) work end to end.
- Group board renders synthesized notes from members' **shared** inspirations,
  deduped; private inspirations and their evidence never appear.
- Capture defaults to shared and offers a private toggle; the choice persists.
- Membership is enforced on every group read.
- API + web tests; typecheck; run and verify on localhost:3030.
