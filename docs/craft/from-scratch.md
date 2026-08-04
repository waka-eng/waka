# WAKA from scratch — jobs, workflows, and the design that serves them

Status: proposed 2026-08-03. Nothing here is built. This is the structural
argument that has to be agreed before any screen is drawn, because six
redesigns have now been built and rejected for skipping this step.

---

## 0. The thing I got wrong first, since it explains the rest

I removed the post-it and set the readings as plain type. That was a
regression, and not because people are attached to paper.

**A post-it is the correct object for a reading, and it is correct for a
reason.** A post-it is provisional. It is cheap. It can be moved, taken down,
written over, and thrown away without ceremony. That is exactly the epistemic
status of a machine-generated claim about a person: *here is a guess, pinned
up, that you may remove.* A framed page of type asserts something the product
has no right to assert.

So the post-it stays, and this document never proposes replacing it. What was
actually wrong was never the post-it — it was **everything that happens when
you touch one**, and the fact that the product has one screen where it needs
two.

---

## 1. Jobs to be done

Written as jobs, not features: a struggling moment, a desired progress, and
the reason it matters. Ordered by how much of WAKA's reason to exist rides on
them, not by how often they happen.

### The three jobs only WAKA can do

**J1 — Name the thing I've been circling.**
> When I've been drawn to dozens of unrelated things over months, I want
> something to tell me what they have in common, so I can finally say out loud
> what I've been chasing.

This is the product. The founder's own account of the payoff is a sentence:
*"What I'd been calling 'fun' for three years was that ambition trying to be
seen."* Everything else in this document exists to make that sentence more
likely or more forceful.

Two constraints ride on it, both founder-stated and both currently violated in
code:

- **Precision, not recall.** *"5 of 20 post-its feeling right is worse than
  5 of 5."* `TARGET_NOTES = 6` is a fill target. A pass gathers candidates and
  picks six whether or not six are worth showing. A wall that can only ever be
  six is a wall that must pad.
- **Obvious is worthless.** *"Very obvious syntheses don't require WAKA —
  anyone can just do it themselves."* A reading anyone in the room could have
  written by skimming the saves is a failure even when it is true.

**J2 — Find the people whose fire matches mine.**
> When I meet people by title, role, or industry, I want to find the ones whose
> ambitions actually rhyme with mine, so I can build with people who are
> pulling in the same direction for the same reasons.

The founder's framing: *"finding your people is best done when it's not by
title, but by what makes your hearts beat together."* And the mechanism claim:
four people interested in visibly different things, whose unknown knowns point
at a shared ambition.

Hard constraint: **a room never tells anyone they don't belong.** The product
already breaks this by accident — a member whose saves never reach a board is
being told something, in silence, by a surface that never decided to say it.
It happened to a real person with fourteen saves.

**J3 — Show me the room changing its mind.**
> When someone new joins and the room starts reading differently, I want to see
> the turn, so I can understand what that person brought.

This is the whole thesis on the time axis: a reading turns *because a heart
arrived*. It is also the least-served job — the rail exists and works, but the
event it is meant to reveal (joining triggers a re-read) doesn't fire.

### The four jobs WAKA must not be bad at

These don't differentiate. They kill the product if they're wrong.

**J4 — Don't let me lose the thing that just moved me.**
> When something catches me mid-scroll or mid-conversation, I want it kept
> before the feeling passes, without deciding what it is or where it goes.

Already the best surface in the product. Its unsolved half is *where* it lives:
capture is designed as an interruption of the app, and most saving happens
somewhere else.

**J5 — Let me check whether a claim about me is true.**
> When Waka tells me something about myself, I want to see exactly which of my
> own words it's resting on, so I can decide whether to believe it.

A claim about a person that can't be checked is worse than no claim. This is
what salience is for and it is currently four clicks from the claim.

**J6 — Let me correct it when it's wrong.**
> When a reading misreads me, I want to say so and have it change something, so
> the record becomes more true instead of less.

**There is no surface for this.** A correction textarea exists in the code with
nothing that opens it. This is the single most trust-critical moment in any
memory product and it is unbuilt.

**J7 — Let me get back to something I know I kept.**
> When I half-remember saving something, I want to get to it in one move, so
> the archive stays worth adding to.

### The job nobody has named

**J8 — Tell me you heard me.**
> When I've just saved something, I want to know it landed somewhere that will
> do something with it, so I keep saving.

Between a save and a reading there is a gap of hours to days, and the product
says nothing. The wall looks identical before and after. This is the cheapest
trust in the product and it is lying on the floor.

---

## 2. Where the craft has actually gone

| Job | Differentiating? | Craft invested | Verdict |
|---|---|---|---|
| J1 name it | **yes — this is the product** | a grid of six equal cards | **starved** |
| J2 find my people | **yes** | a room switcher and a join code | **starved** |
| J3 show the turn | **yes** | a rail, built well, firing on nothing | **half** |
| J4 capture | no | the most finished surface here | **over** |
| J5 check it | no | four clicks, 13% coverage | under |
| J6 correct it | no | nothing | **absent** |
| J7 re-find | no | one drawer serving three jobs | under |
| J8 acknowledge | no | nothing | **absent** |

**The pattern: every job that distinguishes WAKA from a notes app is
under-designed, and the one job any notes app already does is the most polished
thing in the product.** That is the whole diagnosis, and it explains why the
app feels careful but not remarkable.

---

## 3. The workflows, as they'd exist from scratch

Today there is essentially one path — open the app, look at the wall, click a
post-it, land in the drawer — and it is asked to serve all eight jobs. That is
why the expanded save has eight stacked sections: each job bolted its answer to
the bottom of the same screen.

From scratch there are **six workflows and two surfaces.** Everything is a
state of *the wall* or *a save*.

### W1 — The pulse → J4, J8
`something moves you → it's kept → you're told it landed`

Capture lives where your pulse quickens: share sheet, extension, shortcut. The
in-app composer stays but stops being the loudest object on the wall.

The third beat is the missing one. Not a toast — **the wall itself acknowledges
it.** A save appears at the edge of the wall as un-read material: present,
visibly not yet a reading, waiting. That single element answers J8, and it does
it by showing the truth rather than asserting it.

### W2 — The return → J1
`you open Waka → the room says what it's been circling`

The wall. However many readings held, that's how many show. Two is finished and
says nothing about being two. Readings stand equal.

The unchanged wall is meaningful and must not read as a stall: *the room has
been saying the same thing for three weeks* is a finding, not a failure state.

### W3 — The check → J5
`a reading claims something → you ask "is that true?" → it shows you your words`

Evidence resolves **in place**, under the claim that provoked it. This is where
the one saturated colour is spent — the marked words are the most vivid pixels
in the product. Where a reading has no quotable span (87% of them today), it
says so, rather than looking identical to one that does.

### W4 — The turn → J6
`a reading is wrong → you say what's true → the record changes`

Unbuilt. Minimum: a reading can be retired with a reason, and the reason
becomes material the next pass reads. Correction that changes nothing is worse
than no correction, because it teaches you the product isn't listening.

### W5 — The joining → J2
`you put your heart in a room → the room re-reads → something appears that
wasn't there before`

**The most important act in the product currently has no ceremony.** Sharing is
a per-signal flag with no surface; joining is a code. From scratch, joining a
room is the moment the product exists for: you commit material, the room reads
it against everyone else's, and *the join itself triggers the re-read* — which
is also what finally makes W6 have something to show.

### W6 — The re-read → J3
`you scrub back → the wall re-forms as it was → you see what a person brought`

The rail, kept as built. It needs W5 to fire so its hinges land on moments where
something actually happened.

### W7 — The search → J7
`you half-remember something → you ask → you're there`

Separate from W3. Arriving from a reading and going looking are different jobs
and must stop being the same screen.

---

## 4. The two surfaces

### The wall

Post-its, on parchment. What changes is not the object:

- **However many held is however many show.** No fill target. Two is finished.
- **Nothing dims by position.** The opacity decay and the five positional
  pastels both encode a rank the product doesn't have — the fourth reading is
  not weaker, it is fourth in an array.
- **Un-read saves are visible at the edge.** W1's third beat.
- **Colour means whose heart, or nothing.** Not position.

### A save — two shapes, by how you got there

This is the change that matters most and the one the founder already chose.
Today there is one shape, and the only difference by entry path is at
`Home.tsx:5477`, where arriving from a post-it narrows the highlight to one
span. Everything else is identical, which is why both paths feel wrong.

**Arrived from a reading.** You have exactly one question: *is that true?*

> the reading's claim
> your words, with the one span that carried it marked
> back to the wall

Nothing else. No reflections, no metadata, no delete, no list of other
readings — those answer questions you did not ask.

**Arrived from the drawer.** A different question: *what is this, and what
became of it?*

> your words, with every span they produced marked
> the readings, as a real list — here the list IS the point, not a disclosure
> reflect · delete, last

Reflections stop being a peer of readings. They are your conversation with the
machine about this save, collapsed under the text — not a second grey toggle
sitting a few lines from the first one.

**What this fixes structurally:** the expanded save currently renders its
reflections thread *after* the delete button, because "reflections" was
appended to the bottom of an `<article>` whose footer was already last. Nobody
designed that. Splitting by entry path dissolves it rather than reordering it.

---

## 5. States nobody has drawn

A state that has never been drawn gets discovered by a user. Most surfaces here
have exactly one.

| State | Drawn? |
|---|---|
| Zero saves | partially |
| Enough to read, nothing found yet | **no — and this is most of week one** |
| A reading the person disagrees with | **no** |
| A room where only you are audible | **no — it happened, and nothing said so** |
| A wall of two | no — it reads as broken |
| 600 saves | no |
| 40 readings on one save | **no — renders as a wall of rows** |
| A save whose page refused to load | no |

---

## 6. What I'd do first

Ordered by *how much of the product's reason to exist is unserved*, not by
effort.

1. **Split the save by entry path** (W3/W7). Highest ratio of impact to risk,
   already chosen, and it dissolves the eight-section stack rather than
   rearranging it.
2. **Make joining trigger a re-read** (W5 → W6). One backend change that makes
   the rail's hinges mean something and gives the product's central claim a
   moment where it visibly happens.
3. **The un-read edge of the wall** (W1/J8). Small, and it's the cheapest trust
   in the product.
4. **Correction** (W4/J6). The largest genuinely unbuilt thing.
5. **Kill the fill target.** `TARGET_NOTES` becomes a ceiling, not a goal —
   the wall is allowed to say two things.

---

## Non-goals

- A design system. The problem is unserved jobs and undesigned joins.
- Replacing the post-it. See §0.
- Redesigning any screenshot. No screen gets drawn before its workflow is
  agreed — which is the step the last six attempts skipped.
