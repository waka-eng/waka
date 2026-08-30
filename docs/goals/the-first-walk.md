# Goal: the first walk

Status: phase 0 in flight — the shape below is settled; nothing is built yet
Branch: `claude/waka-first-walk-ere0jd`
Depends on: `lighting-a-room` phases 1–2 (the arrival primitive), merged here.
Asked for by the founder, 2026-08-29: a first-run walk where the companion
"starts in the center to explain how to save something, then moves to the
bottom of the screen to tell the user what the ground is for, then moves up
and says what the sky is for", then left to register an agent and right to
make a room and invite people — "onboarding for all of the key features".

## The problem

A person signs up, gives their name, and lands in a black world with a mouth
at the bottom and nothing else. The one thing that speaks — the companion's
`"Say one thing and I will hold it"` — has been there since 2026-08-20 and
says nothing about the ground, the sky, agents or rooms. The world's whole
shape is geography, and nobody is ever shown the geography.

The landing page now promises "WAKA does the rereading". Nothing inside the
product makes that promise legible, and the derivation is asynchronous and
gated on three pieces of evidence, so the honest first week is quiet.

## Two things the obvious design cannot do

Both were measured before this document was written, not assumed.

### The companion cannot go to the bottom or the top of the screen

It is canvas-drawn and pinned at headquarters in LAYOUT coordinates —
`companion.y = clamp(view.h / 2, lo, hi)`, set in the layout pass — and the
draw subtracts `cam.y`. Going to the field or the sky scrolls it out of frame.
Its speech goes with it: `charSay` renders in `.jar-mouth-rest`, and the mouth
layer is camera-translated every frame.

So "the companion moves to the bottom and tells you what the ground is for"
would require making the creature camera-relative, which is a different
product: the being would stop being a thing standing in a place and become a
heads-up display.

**The resolution: the companion does not travel — the person does, and the
place explains itself on arrival.** This is what the world already believes.
`Home.tsx` on the sky's own sentence: *"It was chrome — screen-positioned,
mounted on arrival — so the words appeared BECAUSE you looked, which is the
one thing this world never does."* The line for a place therefore stands in
that place, at that place's own height, and travelling simply brings it into
frame. The companion's voice carries the beats that happen AT headquarters,
which is where it lives.

### A new person has no left and no right

`walls` is `[{ kind: "self", col: 0 }]` until an agent or a room exists —
agents take negative columns, rooms positive. `goToWall(-1)` and
`goToWall(1)` both clamp to `0` and refuse silently. The two beats the founder
most wants are, for exactly the person this is built for, journeys to nowhere.

**The resolution: those beats make the thing, and the travel is the payoff.**
"Let's go left and register an agent" becomes *give your first agent a wall,
and be taken to it* — which is the same act `lighting-a-room` phase 1 built
for rooms, and which **agents still do not do**: `makeAgent` appends a column
and leaves you standing where you were. Fixing that is phase 4 and it is worth
doing whether or not the walk ships.

## The law this must not break

> the world never moves unless the user moved it

Stated nine times in `Home.tsx` and enforced in five places — `place()` does
not move the camera, `born()` does not, `standIn()` does not, and
`revealMemory` was **deleted outright** for flying the camera from a statement
to its memory (founder, 2026-08-25: "never move from sky to ground").

A tour that drives the camera on its own is the exact thing that law forbids.
There is one precedent for automatic motion — the greeting — and it is hedged
hard: held until the pour settles, one beat, always returning to headquarters,
and it *undoes only its own gesture*.

**So every move in this walk is caused by a press.** The walk proposes; the
person moves. A beat never advances on a timer, and the walk never leaves
somebody somewhere they did not ask to be. That is not a compromise to fit the
law — a walk you are driven through teaches less than one you take.

## The second law

> states render, numerals never

No "step 2 of 5", no dots, no progress bar. The walk's own position is not a
quantity, and the one numeral this product allows — the size of your archive,
under the door — was asked for by name and is not this.

## Phases

Each phase is shippable alone and leaves the product better than it found it.

### Phase 0 — the walk exists, and can be left

A named first-run state with its own key, entered once, skippable at every
beat, and never re-entered. `waka.seen === 0` is the only existing first-run
signal and the greeting consumes it on the first render, so this needs its own.

The scaffold that was here before was deleted on the owner's call — its
condition was "no top of mind and no inspirations", so it fired for anybody
who emptied a wall they had kept for months and read as being put back into
onboarding. **The key must mean "this account has not walked", never "this
wall is empty".**

**Gate:** a fresh account enters the walk; leaving it at any beat ends it for
good; a reload does not resume it; an emptied old wall never enters it.

### Phase 1 — the centre: keeping something

At headquarters, where the companion lives and can speak. One line, in its own
slot, about what the mouth is for. It ends when the person keeps something —
not when they press next. The first orb falling is the answer.

**Gate:** a fresh account is told what to do, does it, and the walk advances on
the keep rather than on a press.

### Phase 2 — the ground

The person goes down. The field's own chrome says what the ground is: where
everything you keep comes to rest, oldest deepest. The line stands in the
field at the field's height and is brought into frame by travelling, never
mounted on arrival.

**Gate:** the line is in the field's column, not in screen chrome; it is
readable at 390px; travelling up and back does not re-animate it.

### Phase 3 — the sky

The same shape, upward: what you keep coming back to, whatever the day is.
The sky is empty for every new person and honestly says so, so this beat must
not promise something the person will then not find.

**Gate:** the sky's line is true of an empty sky; no numeral reaches the
screen; the caret home works from there.

### Phase 4 — left: an agent gets a wall

Make an agent, and be taken to it — the `landedGroup` shape, for agents.
`makeAgent` currently leaves you where you were.

**Gate:** making an agent walks the traveller to its column with no further
tap, the same way making a room does; the wall it lands on says honestly that
the agent has not signed in yet.

### Phase 5 — right: a room, and someone in it

Hand off to the flow `lighting-a-room` already built rather than duplicating
it: open the make sheet, and stop. From `make it` onward the existing code
carries the person to the room and puts the invite in front of them.

**Gate:** the walk reaches the room form and lets go; `e2e:lighting`'s four
existing steps still pass unchanged.

## Out of scope, deliberately

- **Anything that needs a model key.** A room only lights once statements are
  derived from pooled public memories, which needs embeddings. The walk can
  truthfully show `alone → bare`; it must not promise a lit wall.
- **The invitee's side and the cold link.** `lighting-a-room` phases 4–5.
- **Re-opening the deleted scaffold.** No floating list over the world.

## Log

Nothing built yet. This document is the shape, written after reading the
movement API and the room branch rather than before.
