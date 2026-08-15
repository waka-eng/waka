# Goal: the metabolism game — every save pays, every return is true

Status: proposed 2026-08-10.
Why this exists: `docs/craft/second-brain-graveyard.md` — the evidence that
capture products die of unpaid saves, and what survives. This goal is the
build plan that keeps WAKA out of that graveyard.
Decided by founder, 2026-08-09: scope is the whole system (walls, solo
surfaces, readings, timeline) · game visibility is vital signs only —
numbers only ever as rhythm, never points, streaks, badges, or
leaderboards · rewards may touch the act of saving itself, not only the
aftermath · WAKA is the default destination for everything worth keeping.
Shares machinery with `wall-that-evolves.md` (its Step 2 sensor, its two
named Step 4 gaps); consumes the readings-of-a-signal surface; extends
`signal-capture.md`'s capture grammar. Lands as one PR per step, per the
per-goal scoping rule.

## What we're actually after

In the founder's words: users constantly save, and come back to view the
different walls. The graveyard research says both behaviors are the same
loop seen from opposite ends, and that the loop has laws:

- A save is never a debt. The dead tools turned saves into guilt piles;
  WAKA's saves must be consumption — paid at the moment of saving.
- The payback window is days wide. Primary data (Instapaper, Pocket):
  what a save will ever give back, it gives back within days. First
  payment must land in seconds, the second within the week.
- "Come back whenever" is come back never. Every survivor manufactures
  its return. WAKA needs true event marks and at least one scheduled
  heartbeat.
- Trust is spent at retrieval, not capture. One unexplained misreading
  starts corpus-wide decay; a correctable one is just a conversation.
- The inversion that wins: dead tools degraded with loyalty (bigger pile,
  worse product). Every WAKA surface must visibly improve with volume.

"Gamification" here means those laws made into product mechanics, worn as
vital signs. The badge-and-streak kind is what the graveyard is full of.

## Where things actually stand

- A save already asks nothing and gatekeeps nothing (shipped 2026-08-09),
  and the anti-guilt discipline is written law. Death 1 (saving feels
  like knowing) and death 3 (the maintenance ritual) are covered — this
  goal must not un-cover them.
- The save's payback is currently silent. Local wow scores persist at
  save time using stored embeddings, and a classification job is
  enqueued — but the user sees a toast and nothing else. The machinery to
  pay them exists; no surface spends it.
- Returns depend on wall changes and wow moments. Walls don't re-read on
  arrival, refresh redoes unchanged work, note lineage isn't recorded,
  and wow generation is best-effort with failures swallowed. The unread
  mark, the strongest return trigger available, has nothing to stand on
  until `wall-that-evolves` Step 2's sensor exists.
- No scheduled beat exists anywhere. `/sit` is the closest thing: a
  designed-no-guilt daily invitation, currently discoverable only by
  opening the solo wall.
- Correction exists on kept lines (keep/cut) but not on walls, readings,
  or wow moments. Receipts (evidence rows) exist on readings.

## Step A — The save pays now

**The problem.** The save's reward is a toast. The collector's-fallacy
death begins exactly here: a save that returns nothing is a promissory
note, and the user is the one who will be asked to pay it.

**What to build.**
- **The landing.** The capture paper visibly becomes the saved object and
  lands — on the solo wall, into the archive — instead of a form
  submitting. (Depends on `wall-craft-plan.md` C1, capture-looks-like-
  the-note; this is its motion half.)
- **Being read.** A fresh save carries one quiet in-progress state. It
  resolves — seconds to a minute later, riding the existing embedding +
  local-score path — into the **first reading**: one true line about
  where this landed. "This landed near your March save about drift."
  Nearest stored neighbor, plain words, labeled as machine output per the
  copy law. If the archive is too young to have a neighbor, say that
  honestly — "your third save; too early for neighbors" — never fake a
  connection. Pulse-is-truth applies to the machine too.
- **The second beat stays.** The existing post-save invitations ("keep
  this one to yourself", "say why this caught you") sit beside the first
  reading unchanged.

**Done when:** every save with ≥1 embedded prior resolves to one true
association within a minute, a young archive gets the honest line
instead, and deleting the feature would make saving feel like posting
into a void again.

**Design gate (mechanics-beauty):** the landing is the product's single
most-repeated moment; it ships when the motion feels like paper settling,
not a notification arriving. No progress spinners — the being-read state
is typographic, not chrome.

## Step B — True return marks

**The problem.** A user who leaves has no reason to come back that we
control. The graveyard's only working pull is "something true happened to
what you fed in" — and today nothing records or surfaces that.

**What to build.**
- **The unread wall.** A room carries one quiet mark when its wall
  changed since *you* last looked. Stands on `wall-that-evolves` Step 2's
  remembered-inputs sensor (which also makes the mark honest: after Step
  2, "changed" only ever means changed).
- **Your save moved a wall.** When a pass replaces a note, record which
  note became which (the ~20-line lineage gap already named in Step 4),
  and when the cause was your save, tell you exactly that: "the wall
  re-read because of you — this note became that one." Agency is the
  strongest reward in the whole record; it must always name its evidence.
- **Arrivals re-read.** A new member triggers a fresh reading (the other
  named Step 4 gap), and members hear the product's thesis as its most
  natural notification: "the wall changed when Jaegyu arrived."
- **Unopened bridges.** A wow moment that lands while you're away becomes
  an unopened pairing — one of the four permitted counts ("3 bridges
  since Tuesday"), spent by opening them.
- **Notification law, codified:** every push and every mark names a real
  event of reading, arrival, or bridging. Manufactured urgency ("you
  haven't saved today!") is forbidden — it is the guilt engine that
  killed the read-it-later category wearing our clothes.

**Done when:** a user away for a week returns to marks that are all true,
each opens directly to the thing that changed, and a week with no events
produces zero marks — silence is a legal state.

**Design gate:** marks are ink and warmth on existing surfaces (a lifted
note, a labeled line), never badge chrome. Freshness is shown by the
paper, not a red dot.

## Step C — One scheduled heartbeat

**The problem.** Steps A and B are event-driven, and events depend on
activity — the cold room and the quiet week produce nothing. The
graveyard's loudest single lesson: every surviving loop also has a
manufactured beat (Readwise's daily review, Anki's scheduler,
Pinterest's feed). We chose event-driven on 2026-08-09; the evidence says
event-driven *alone* is the most repeated cause of death.

**What to build.** One scheduled beat, founder to pick the carrier:
1. **The sit as the daily beat** — `/sit`'s invitation surfaces on a
   daily rhythm (a quiet line, one tap away), not only when the solo
   wall is opened. Already designed no-guilt: passes recorded, nothing
   re-nags, no counter ages.
2. **The weekly reading digest** — one weekly note, in product and by
   push where granted: what your saves were read as this week — the wall
   notes they fed, the bridges they formed, the neighbors they gained.
   The week's metabolism, witnessed.

Either carrier obeys the sit's own law: skipping is free, skipping is
unrecorded on any visible surface, and the beat never references what you
missed.

**Done when:** the chosen beat fires on schedule, opens to something true
even in a quiet week (the digest's quiet-week form is "held steady" — the
honest line, not an apology), and a user who ignores it for a month sees
zero accumulated debt.

**Design gate (typographic-beauty):** the digest is a statement page —
set like a letter, not a dashboard.

## Step D — The four instruments

**The problem.** The game needs to be felt to work, and the founder's
visibility decision is vital signs: rhythm, never score.

**What to build.** Exactly four instruments, and a written forbidden list.
- **Your tempo** — a small rhythm strip on the solo wall: your pulse over
  the recent weeks as a breathing line. Quiet weeks slow it; nothing
  breaks, nothing resets, no number counts up.
- **Room heartbeat** — the room switcher shows each room's collective
  tempo as an ambient beat. A quickening room is its own invitation; your
  save feeds the beat.
- **Wall freshness** — Step B's unread mark, worn as warmth on the room's
  name rather than a count.
- **Unopened bridges** — the one place a count is permitted, because it
  is spendable and reaches zero.

**Forbidden, in writing, in this doc:** XP, points, streaks, badges,
levels, leaderboards, rankings between people or rooms, any number that
can be farmed by saving for its own sake, any red that accumulates. If a
future mechanic needs one of these to work, the mechanic is wrong.
(Pulse is truth: a chased number stops being a reading of the heart.)

**Done when:** all four render from real event data, none can be
increased by insincere saving faster than by honest use, and the
stranger test passes on every label.

**Design gate (mechanics-beauty):** instruments read at a glance and
reward a second look; if one needs a tooltip to be understood, it isn't
done.

## Step E — Correction everywhere (parallel, any time)

**The problem.** WAKA is structurally the thing every AI organizer
retreated from — passive resurfacing. Their deaths localize the risk
precisely: the first visible misreading the user cannot answer. Keep/cut
exists on kept lines; walls, readings, and wow moments can misread you
with no reply possible.

**What to build.** The two trust verbs on every model-output surface:
- **Receipts:** every reading, wall note, and wow shows its evidence rows
  (already true for readings; make it invariant).
- **Correction:** one-tap "this reading is wrong" (the keep/cut verb
  extended) on wall notes, readings, and wow moments. A cut is recorded
  as correction signal — cut rate is already designated the health
  metric; this step is what makes it measurable everywhere.

**Done when:** no surface shows model output that lacks either verb, and
cut rate per surface flows to the health metric.

**Design gate:** correction is quiet and adjacent (the same register as
"keep this one to yourself"), never a moderation UI.

## The order, and why

```
A. The save pays now        ← opens the payback window at second zero
B. True return marks        ← spends the window; needs Step 2's sensor + the two Step 4 gaps
C. One scheduled heartbeat  ← covers the quiet week the events can't; founder picks carrier
D. The four instruments     ← the visibility layer over A–C's events
E. Correction everywhere    ← trust floor; parallel to all, cheap per surface, never blocked
```

A before B because a return mark that opens onto a product that didn't
pay at save time teaches the user marks aren't worth following. C after B
because the heartbeat should carry real events once they exist — but C
must not wait if B slips; a heartbeat over a quiet product is still the
graveyard's strongest lesson. E has no dependencies and no excuse.

## Acceptance — the anti-graveyard invariants

The goal is done when all six hold, and they become standing law for
every future surface:

1. A first save returns something true within a minute.
2. Marks are never false and silence is legal; nothing manufactures
   urgency.
3. One scheduled beat exists; skipping it is free and unrecorded.
4. Every model output shows receipts and takes correction in one tap.
5. No visible number can be farmed; the four instruments are the only
   instruments.
6. Every surface improves visibly with volume — more pulses, better
   readings — checked per surface at review, the inversion of the
   monotonic-queue death.

## Decisions for the founder

1. **The heartbeat carrier** (Step C): sit-as-daily, weekly digest, or
   both. The evidence supports either; it does not support neither.
2. **Access gates**: rewards-touch-everything was decided 2026-08-09, so
   gating is permitted — but if any surface ever unblurs only for recent
   pulsers, a held save must count as having pulsed. The game may reward
   saving; it must never pressure held into out loud.
3. **Push scope**: which of Step B's events may leave the app (per-room,
   per-event-kind consent), before any notification ships.

## What this goal does not cover

- `wall-that-evolves` Step 1 (history merge). Prerequisite trust work,
  urgent, and its own PR — this goal builds nothing on unmerged history.
- Capture-door ubiquity (share sheet, extension, cursor). The other half
  of "default destination"; already scoped as `signal-capture.md`
  follow-ups. The game pulls returns; doors win captures.
- Room activation and the two-person-room path. The graveyard says
  two-person rooms are the wedge; getting a second person into a room is
  its own goal.
- The export door, pricing posture, and everything else in graveyard
  rules 7–8. Business-shape decisions, founder's table.
