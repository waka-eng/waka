# Plan: wall craft, second pass

Status: proposed (authored 2026-07-26)
Scope: the signed-in wall, capture, and the saved-signals drawer.
Excluded from PRs by convention — this file is a working plan, not shipped.

## What this addresses

Six findings from looking at the real signed-in app rather than the source:

1. The room switcher is not discoverable — a 13px caret at 0.22 opacity.
2. Starting a room presents two unlabelled text fields stacked.
3. Each post-it answers "where did this come from" twice, on two lines.
4. Post-its are uniform boxes set in interface type.
5. Capture is a white form sheet, not the paper it becomes.
6. Several controls are misplaced, and a few probably should not exist.

## A. Ship now — front-end, no product decisions

**A1. Give the title a resting surface.**
A soft rounded ground behind the room title at rest, deepening on hover, and
a caret sized to the type rather than to the chrome. The title reads as an
object instead of text with a mark after it. `RoomTitle.tsx`, `global.css`.

*Alternative worth considering:* let the rooms you are **not** in peek beside
the name as a small stack of overlapping initials. More distinctive, and more
on-thesis — a wall is people, so show the other people. Bigger change, so it
is offered rather than assumed.

**A2. One field to start or join a room.**
Replace the two stacked inputs with a single "name a room, or paste an
invite". If the value looks like a code or a `?join=` URL, join; otherwise
create. Removes the mode, the second field and the "have an invite code
instead?" link together. Telling create from join is the product's problem,
not the user's. `RoomTitle.tsx`.

**A3. Merge the provenance line.**
A card currently carries contributor faces *and* an evidence count — two lines
saying where the thought came from. One line at the foot of the paper: faces,
then `you + jaegyu · 3 inspirations`, opening the evidence on click. Deletes a
row from every card. `Home.tsx`, `global.css`.

**A4. Let a short thought be a small note.**
Set the thought in Fraunces rather than Inter — it is a thought, not interface
copy — and drop the 200px `min-height` so a six-word note is a six-word note.
Uniform card height is what makes a wall read as a grid of widgets.
`global.css`.

**A5. Remove the DEBUG chip** from the signed-in wall, or gate it behind the
existing internal-status flag if it is load-bearing for QA.

## B. Needs a decision before I touch it

**B1. "Re-read this room" is in the wrong place, and may not belong at all.**
It sits in the invite panel: invite is about people, re-reading is about
content. Worse, asking someone to tell the product to think is a chore. It
should run when a room's signals change. Removing the button is front-end;
making it automatic is not.

**B2. The raw invite URL is developer UI.** `http://localhost:5173/?join=…`
on screen is a debugging affordance. "Copy invite" is the whole feature.

**B3. Capture's "Shared with groups / Private" toggle contradicts two
decisions already taken** — that capture is pre-verbal and asks nothing at
save time, and that joining a room *is* the consent. Per-save privacy is a
third model competing with both. It is also agikee's, and it encodes a real
product position, so it is theirs to defend or drop.

**B4. Pin.** Pinning an intentionally ephemeral note fights the model. What
does a pinned top-of-mind mean once it is replaced?

**B5. Delete.** The mechanism is keep/cut — correction, not destruction. The
label frames it more harshly than the behaviour warrants.

**B6. Drawer tabs advertise emptiness** — `recently saved 0`. Hide a tab with
nothing behind it.

## C. Larger, and one is blocked

**C1. Capture should look like the note it becomes.** It is the moment a
reaction turns into paper, so the composer should be paper: the note's colour,
tilt and type, narrower and taller, with the input at thought-size rather than
form-size. Real redesign, worth doing after A lands.

**C2. Sentence length is the actual constraint on how good the wall can
look.** Merged readings are 25-word essay sentences on a surface built for a
thought you can hold in your head, and six text-density tiers exist to shrink
type until they fit. No typography choice survives that. This is a generation
change, so it sits outside the front-end-only rule and is blocked until that
rule is lifted for it.

## Sequencing

A1–A5 are independent of each other and of everything in B; they can land as
one PR on top of the room-object work. B is a single conversation, most of it
with agikee. C1 follows A. C2 is the highest-value item on this page and the
only one that cannot be done in CSS.
