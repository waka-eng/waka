# Goal: the room remembers becoming itself

Status: Phases 0 and 1 shipped (2026-08-01). Phase 2 — the UI — not started.
Branch: `goal/room-timeline`
Follows: ambition-reading (2026-08-01), the readings + divergence layer (PR1–4, 2026-08-01)
Decided by founder, 2026-08-01: keep everything · full history for newcomers · departures stay marked · scrubber before dial

## Why

The vision is a narrative in time: months of capture → sudden naming → a heart
arrives → the reading turns → recognition. The product is entirely present
tense. Every surface shows a current state; no surface shows becoming.

The wall says what the room reads *now*. It cannot show that in March the room
read X, that the reading turned when Jaegyu joined, or that what the founder
called "fun" for three years was an ambition trying to be seen. A group chat
feels co-curated because you can scroll back through three years of it; this
room has no back.

Worse: the history the timeline would replay is being **deleted on every
refresh**. `refreshGroupTopOfMind` prunes superseded notes
(`group-top-of-mind.ts`), and `leave` hard-deletes the membership row, so a
departed member never existed. Every week this goal waits is a week of the
founders' own room's history gone. Phase 0 is urgent independent of everything
above it.

The experience when built: the wall becomes a position on the room's life.
Scrub back and see March. Scrub across a join mark and watch the reading turn
because a heart arrived — the thesis ("the same signal points to a different
ambition depending on which other signals it sits next to") expressed on the
time axis, as something that actually happened. A newcomer lands at the
beginning and watches the room become itself, ending on their own join.

## Founder decisions (2026-08-01)

- **Retention: keep everything.** Replaced readings persist forever. Storage
  is text rows; the timeline is the product. Room deletion still cascades.
- **Pre-join view: full history.** Sharing to the room means sharing to its
  future members. A newcomer scrubs to formation and sees the whole becoming,
  evidence included.
- **Departures: past stays, marked.** Join AND leave are hinges. Readings a
  departed member shaped remain in their era, faces intact. The timeline
  never lies about what happened; leaving stops future contribution, not past
  fact.
- **Instrument: scrubber first, dial later.** The meech-derived wheel (arc
  spacing proportional to elapsed time, pulse-trace revolution counter) is a
  Phase-4 upgrade that must be earned by evidence that people travel at all.

## Settled: the timeline is group-keyed (2026-08-01)

`room-timeline` and `combination-as-an-act` both want to key history to a set
of hearts. Decided here so neither builds on the other's assumption:

**The timeline keys to `group_id`. `combination_id` is an attribute of its
entries, never its spine.**

`combinations.member_set_hash` is globally unique and derived from the sorted
member ids, so a room whose membership changes maps to a *sequence* of
combinations. Keying the timeline to `combination_id` would therefore:

- fragment a room's history at exactly the joins and leaves the timeline
  exists to show — the hinge would become a boundary between two unrelated
  timelines rather than a mark on one; and
- merge two different rooms that happen to share a membership, since they
  share a combination row. That is a correctness bug, not a preference.

The room is the continuous identity; a combination is which set of hearts was
reading in a given era. This makes combinations *more* legible on the
timeline: scrubbing across a join shows the reading turn AND the combination
change, because the member-set hash actually changed. Subsets and handshakes
get readings without ever needing a room timeline, since
`combinations.group_id` is already nullable.

## Naming

room (who) · wall (surface) · reading (what it says) · timeline (the axis).
No new metaphors; nothing renamed.

## Phases

### Phase 0 — Make time exist (URGENT: history is being destroyed)

- **Group notes get a lifecycle.** `group_top_of_mind_notes` gains
  `lifecycle_status` / `replaced_at` / `replaced_by_note_id`, mirroring the
  solo table. The refresh prune becomes *mark replaced* instead of DELETE.
  `readGroupNotes` filters to active — today's wall is pixel-identical.
- **Membership becomes events.** New `group_member_events`
  (`group_id, user_id, event: joined|left|removed, at`), written alongside
  the existing operations. Backfill `joined` from `group_members.created_at`.
  `group_members` stays the access-control truth; events are the memory.
- **Measure turn density.** Script over the now-preserved succession: how
  often does a board's reading meaningfully drift? Decides whether the
  timeline shows every refresh (~150 marks over 3 years — unusable) or turns
  only, plus every join/leave always. Gates Phase 2's visual density.
- **Drift must be semantic, not lexical.** The other session found Waka's five
  active notes score 0.08 mean pairwise word overlap — "distinct" by the
  eval's token measure — while being five phrasings of *physical versus
  screen*. A timeline built on a lexical drift measure would replay a room
  that never changed its mind as one that turned five times. Turn detection
  uses embedding cosine between note titles; `inspiration-embeddings.ts`
  already has the machinery.

**Gate:** a refresh on a real board deletes nothing; a leave writes an event
and revokes access; the turn-density number exists and is written down here.

**Measured 2026-08-01** (`pnpm tsx tools/turn-density.ts`):

```
room        age(mo)  readings  active  generations  hinges  marks/mo
Waka            0.9        11       6            1       6       9.4
builders        0.9         0       0            0       1       2.3
builders        0.9         0       0            0       2       3.5
```

**Phase 2 reads this as: show every generation, plus every hinge always.** The
threshold is ~30 marks total; Waka has 7 and is the busiest room by an order of
magnitude. The scrubber does not need to summarise or bucket anything yet.

Caveat the tool prints for itself: lifecycle recording only began 2026-08-01
(migration 0038), and before that refresh deleted superseded readings outright.
Every room's history therefore starts empty and fills from now on, so these are
**floors, not counts** — marks/mo will climb toward the true rate. Re-run before
committing to a visual density, and re-check once a room has a few months of
preserved succession.

### Phase 1 — The timeline read model

- `GET /api/groups/:groupId/timeline` — ordered events: formed → readings
  created/replaced → joins/leaves. Member-gated like every group route.
- **Board-as-of-T** resolver: `created_at <= T AND (replaced_at > T OR
  active)`. Index `(group_id, created_at, replaced_at)`.
- Addressable position: `?at=<timestamp>` — deep-linkable.

**Gate:** unit tests pin the replaced/active boundary; board-as-of-now equals
the current wall exactly.

### Phase 2 — The wall travels (the core UX)

- **First, a pure refactor:** extract `GroupWall` from `Home.tsx` (5,600
  lines). Zero visual change, own commit. Scrub state and diff animation do
  not go into that file.
- **The scrub:** horizontal time rail at the wall's bottom edge (the travel-
  between-rooms animation is vertical; the axes must not collide). Drag with
  momentum, snap to marks, resting position is now.
- **The diff is the animation.** Keyed on `idempotency_key`: notes that
  persist across the scrubbed boundary stay perfectly still; notes that
  formed arrive; replaced ones leave. Blur-at-the-seam sequencing (the
  `applyCategoryFilter` pattern), sequence-guarded so fast scrubbing cannot
  cross itself. `prefers-reduced-motion` → instant swap.
- **Join marks are hinges.** Distinct mark shape; crossing one animates the
  face into the room's face row as the reading turns. This is the thesis on
  the time axis — it gets the emphasis budget.
- "Four hearts, since March" — one line on the wall header from
  `groups.created_at` + member events. No badge, no count of unread.

**Gate:** scrubbing a real board with 3+ readings and 1+ join reads as
travel, not as a slideshow; nothing moves except what changed.

### Phase 3 — The room is alive

- The wall updates without the viewer acting (poll first; SSE only if it
  earns it). A note another member's save produced **arrives** via the Phase
  2 machinery — the present is the timeline's leading edge, not new code.
- **Newcomer arrival:** first open after joining offers "see what this room
  was before you" — plays formation → their join mark. Invitation, not
  autoplay.

**Gate:** two sessions open on the same board; a refresh in one arrives in
the other without interaction.

### Phase 4 — The dial (decide after Phase 2 ships)

The wheel: hub below the fold, readings on the arc, slot angle proportional
to elapsed time (busy months crowd, quiet stretches stretch), one revolution
= one step, pulse-trace as the revolution counter. Replaces the scrubber only
if people actually travel. Building the beautiful instrument before knowing
that is the trap.

### Later, rides free

Solo wall timeline — solo notes already carry the lifecycle, so the Phase 1
resolver generalizes. Sequenced after group because the group timeline has
join-hinges and the solo one does not; the group version is the thesis.

## Non-goals

- Auto-renaming the room from its readings (founder: a name is a handle,
  like a group chat — stable because it is stable).
- Seat-toggling / private member exclusion (founder: group identity is the
  feeling; the room does the combining and shows its work).
- Unread badges or chore-mechanics on the rail (`RoomRail.tsx` already says
  why: recency reads as warmth, not obligation).
