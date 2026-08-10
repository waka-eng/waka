# Goal: a wall worth watching change

Status: proposed 2026-08-02.
Replaces the sequencing in `board-selection.md`; that doc keeps the design
detail, this one says what to build and in what order.

## What we're actually after

Two things, in the founder's words:

1. **The wall shows the best set of notes** — not the same idea written five
   ways, and not whichever notes happened to be made first.
2. **You can watch the wall change over time** — scrub back and see what the
   room used to think, and what changed when.

The second one is only interesting if the first one is true. A time axis over a
wall that never meaningfully changes is a camera pointed at a still life.

## Where things actually stand

- **History is no longer being destroyed** (correction 2026-08-10): Step 1
  shipped — the room-remembers work is in dev and in production `main`
  (`room-timeline.ts`, note lifecycle, join/leave records; promoted
  2026-08-06). The paragraph below is kept as written for the record, but
  Step 1 is done.
- **The wall is whatever came first.** Notes are made one at a time and posted
  immediately, stopping at six. Nothing ever looks at six notes together.
- **Most refreshes redo work for nothing.** The only guard on a pass is a
  15-minute timer. Nothing asks whether anything changed, so a room that gets
  opened a few times a day pays full price to produce the identical wall.

---

## Step 1 — Stop losing history (urgent, already built)

**The problem.** Every time the wall refreshes, the notes it replaces are
deleted. Leaving a room erases the fact you were ever in it. So there is
nothing to build a time axis *on* — the record it would replay is being thrown
away weekly.

**What to build.** Nothing. It's written, tested, and CI-green. It needs to be
split out of the big unmerged branch and shipped: keep replaced notes instead of
deleting them, and write down when people join and leave.

**Why first.** Everything else on this list can wait a month at no permanent
cost. This can't. Signals can be re-read, notes can be regenerated, walls can be
rebuilt — what the room used to think exists once.

**Done when:** a refresh on the real product deletes nothing, and joins and
departures start being recorded.

**Visible change for users:** none. That's the point — it's a recorder, not a
feature.

---

## Step 2 — Don't redo work when nothing changed

**The problem.** A pass costs around twenty AI calls. The only thing stopping
one is a timer. If nobody has saved anything since the last pass, the system
still runs the whole thing and produces the identical wall.

**What to build.** Before starting a pass, remember what the last one was built
from — which saves were shared, and who was in the room. If neither has changed,
skip the pass and show the wall as it is.

**Why it matters beyond cost.** Three reasons:

- Most refreshes become free. The expensive ones happen exactly when they
  should — when someone actually saved something.
- Pressing refresh can finally tell the truth. Today, getting the same wall back
  might mean "looked and found nothing" or "the timer said no." This adds the
  honest and most common third answer: *nothing has changed since last time.*
- **It cleans the time axis.** Today every pass leaves a mark in the room's
  history whether or not the wall moved. With this, the timeline only records
  moments where something actually happened — so scrubbing back shows real
  changes instead of a hundred no-ops.

**Done when:** opening a room twice in a row with no new saves costs one
database query and zero AI calls, and the wall is unchanged.

**Size:** small. One piece of remembered state, one comparison.

---

## Step 3 — Pick the best six instead of the first six

**The problem.** Notes are made one at a time and posted as they're made. The
wall is the first six that worked. If the first six all say the same thing,
that's the wall, and nothing is in a position to notice.

**What to build.** Hold the notes instead of posting them. When the pass is
done, look at all of them together and pick the six that make the best wall:
covering the most different people, saying the most different things. Post
those. Keep the rest, marked as *considered, not shown*.

Most of this is already written — the holding, and the picking function with its
tests. What's left is connecting them and embedding each candidate note so
"different" can be measured.

**What it does and doesn't promise.** It guarantees the wall is the best
available six rather than the first six. It cannot invent variety that isn't
there: if every note the room can produce is about one idea, you'll get the six
most spread-out versions of that idea. That's still better, and it's honest.

**Why the notes that don't make it are kept.** They cost the same to make, and
they're the most interesting thing the time axis could show — not just what the
wall said, but what the room considered and set aside.

**One decision for agikee.** Not stopping early costs about four extra AI calls
per pass — roughly 20% more, and far less than Step 2 saves. But the early stop
is a cost limit they set on purpose, so reversing it is theirs to approve.

**Done when:** one pass's notes, picked the old way and the new way, are put
side by side and the founder reads the new wall as covering more distinct ideas.
The comparison costs nothing extra — same notes, picked twice.

---

## Step 4 — The time axis (the part you can see)

**The problem.** Every surface is present tense. The wall says what the room
reads now. Nothing shows what it used to read, or that a reading changed when
someone joined.

**What's already built.** The whole back half: what the wall looked like at any
past moment, and a record of every join and departure. It works and nothing
calls it.

**What to build.**

- **A time bar along the bottom edge of the wall.** Drag it to move back
  through the room's life. It snaps to moments where something actually
  happened — a wall that changed, someone arriving, someone leaving. Resting
  position is now. The address bar carries the moment, so a point in the room's
  history can be shared as a link.
- **The change is the animation.** Notes that survive a move stay perfectly
  still. New ones arrive, replaced ones leave. Nothing moves except what
  changed — that's what makes it read as travel rather than a slideshow.
- **Arrivals get the emphasis.** Someone joining is marked differently, and
  crossing that moment animates their face into the room as the wall re-reads.
  That single moment is the whole idea of the product on a time axis: the same
  saves, read differently because another person is in the room.

**Two small back-end gaps to close first.**

- **Record which note replaced which.** The place to store it exists and nothing
  writes to it, so today you can see that the wall changed but not that *this
  note became that one*. Roughly twenty lines, and it's what lets a note morph
  rather than just vanish and reappear.
- **A new member should trigger a fresh reading.** Today someone joins and the
  wall doesn't re-read until somebody presses refresh — possibly days later. So
  the arrival mark would sit at a moment where nothing visibly happened, which
  is exactly the moment that should be the most alive.

**Done when:** scrubbing a real room with a few changes and one arrival reads
as travel, and nothing moves except what changed.

---

## The order, and why

```
1. Stop losing history   ← irreversible; every day costs a day
2. Don't redo work       ← biggest saving, smallest change, cleans the timeline
3. Pick the best six     ← makes the wall worth watching
4. The time axis         ← the visible payoff, on a wall that now moves
```

Steps 2 and 3 are what make step 4 worth building. A time axis over a wall that
only changes when someone saves, and then changes to whatever came first, is a
scrubber across a room that never appeared to change its mind.

## What this plan does not claim

It does not explain why this room's wall keeps circling one idea. Three
explanations were tested on 2026-08-02 and rejected: notes not seeing each other
(tried, made it worse), one member dominating the material (measured, false),
and members being unreadable (false, their links had already been filled in).

The remaining untested one: the setting that decides what counts as a
"surprising" connection was tuned against one person's collection, and this
room's saves are far more alike than that setting expects — so the mechanism
meant to find non-obvious pairings may simply never fire here. That belongs to
whoever tuned it, and it is a separate goal.

Step 3 is worth building either way. It removes accident from the answer, which
is a defect regardless of what the room turns out to contain.
