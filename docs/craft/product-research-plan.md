# Research plan: the whole experience, end to end

Status: proposed 2026-08-03. Supersedes the first draft, which scoped this to
five algorithmic decisions and demoted craft to a closing bullet list — the
exact mistake the plan exists to correct.

## The problem with how this product has been designed

Every surface has been optimised in isolation, by argument, without anyone
watching a person use it. One night produced three rebuilds of one rail and two
of one list, each replaced before it was ever used. The wall, the drawer, the
capture cell and the rooms were each made good on their own terms and were
never once designed as a **sequence someone moves through**.

Two consequences, both visible tonight:

- **Nobody has designed the joins.** Arriving at a save from a post-it and
  arriving from the drawer are the same screen, so it serves neither.
- **Everything is designed at one state.** 24 saves, 6 notes, one room, one
  day of history. Empty, first-run, 600 saves, a reading that is wrong, a room
  of one — none of these have been drawn.

## The north star, now that it is stated

The founder's answer: **the payoff is the naming.**

> "What I'd been calling 'fun' for three years was that ambition trying to be
> seen."

So the design question for every surface is not "is this good" but **"does this
make that sentence more likely, or more forceful?"** A surface that does
neither is plumbing and should get plumbing's share of the craft budget.

Two more answers that constrain the design:

- **Mirror AND aim.** It says what is true, and the truth is what makes saying
  no possible. Never a warning, never a pace monitor.
- **Precision over recall, stated by the founder:** *"5 of 20 post-its feeling
  right is worse than 5 of 5."* More is not better. The measure is the SHARE
  that lands, not the count that exists.

  *This is the single most consequential principle in the document, and the
  product currently contradicts it in code.* `TARGET_NOTES = 6` is a fill
  target, not a quality bar: a pass gathers candidates and picks six whether or
  not six are worth showing, and selection is written to fill the board rather
  than to stop. A wall that can only ever be six is a wall that must pad. The
  design has to make **two post-its a legitimate, finished state** — not an
  error, not an empty state, not a board still loading.
- **A room never tells anyone they do not belong.** Founder-stated, and it
  settles what "the room as its own entity" means: a room **remembers** — it
  accumulates a character that changes how a new signal reads — but it never
  **wants** in a way that measures a person against it. No drift warnings, no
  alignment scores, no "this isn't what we're about."

  *The teeth: the product already says this by accident.* A member whose signals
  never reach a board is being told something, in silence, by a surface that
  never decided to say it — and it happened to a real person with fourteen
  signals. The audibility gate can now remove someone entirely. Coverage is
  reported as "3/6 members", which frames a person as covered or not.

  **Absence from a board must never read as a verdict on a person.** Every
  surface that can show a member missing needs an answer for why, and the
  answer has to be about the material, never about them.

  *And it is in direct tension with precision:* a wall of two strong readings
  shows fewer people than a wall of six weak ones. Choosing fewer readings
  cannot be allowed to become choosing fewer people. Nobody has designed for
  this collision and it is the sharpest open question in the document.
- **Four kinds of heart** a signal can meet: another person's, your own past
  self's, a stranger's, and the room's own accumulated character. Only the
  first is built. *Design consequence: the combination mechanic needs one
  visual language that works for all four, or the product will grow four
  unrelated surfaces.*

---

## 1. The journey, honestly mapped

Each moment gets: what it is for, what it currently feels like, and the design
question nobody has answered.

### M1 — First open, nothing saved
**For:** believing this is worth the effort before any evidence exists.
**Now:** an empty wall, a first-run card, and a bottom hint that flashed at
established users until tonight.
**Unanswered:** what does an empty WAKA promise, and how does it prove it
before the first reading exists? *This is the only moment every user has.*

### M2 — Capture
**For:** getting it out before it is lost. No deciding, no filing.
**Now:** the most finished surface in the product.
**Unanswered:** capture is designed as an interruption of the app. Most saving
happens elsewhere — a phone, a browser, a conversation. *Where does capture
actually live?*

### M3 — The wait
**For:** nothing. But it is real: between saving and being read there is a gap
of hours to days, and the product says nothing.
**Now:** undesigned. The wall looks identical before and after a save.
**Unanswered:** does the product acknowledge that it heard you? *This is where
trust is won or lost cheaply, and nothing is there.*

### M4 — The naming
**For:** the payoff. Everything else exists for this.
**Now:** six post-its of roughly equal weight, dated, dimming by position.
**Unanswered:** should a reading ever arrive rather than be found? Does the
strongest reading deserve a different treatment from the sixth? *The moment
the product is for is currently rendered as a grid.*

### M5 — "Is that true?"
**For:** judging a claim about yourself.
**Now:** click an evidence row → drawer → expand a save → a highlight, if one
of the 13% exists.
**Unanswered:** four clicks to answer the question the reading provokes. *Why
is provenance not on the reading itself?*

### M6 — "That's wrong"
**For:** repair. The single most trust-critical moment in a memory product.
**Now:** **no surface at all.** A correction textarea exists in the code with
nothing that opens it.
**Unanswered:** everything.

### M7 — Returning to the collection
**For:** inventory, re-finding, and being surprised by your own past.
**Now:** one drawer serving all three, with search at the bottom of the screen.
**Unanswered:** the founder's own answer was "both, and that's the problem."

### M8 — The room
**For:** the claim — an ambition none of the collections held alone.
**Now:** a room is a switcher entry and a board. Joining is a code.
**Unanswered:** what does it feel like to *put your heart in a room?* Sharing
is a per-signal flag with no surface. *The most important act in the product
has no ceremony.*

### M9 — Time
**For:** watching a reading turn because a heart arrived.
**Now:** a rail, built tonight.
**Unanswered:** does anyone travel? And the hinge — the product's whole thesis
on the time axis — currently marks a moment where nothing visibly happened,
because joining does not trigger a re-read.

---

## 2. The states nobody has drawn

A state that has never been drawn will be discovered by a user. Every surface
needs all of these, and today most have one.

| State | Drawn? |
|---|---|
| Zero saves | partially |
| One save | no |
| Enough to read, nothing found yet | **no — and this is most of week one** |
| A reading the person disagrees with | **no** |
| A room of one | no |
| A room where only you are audible | **no — it happened, and nothing said so** |
| 600 saves | no |
| 40 readings on one save | **no — it renders as a wall of rows** |
| Offline / model unavailable | partially |
| A save whose page refused to load | no |

---

## 3. Craft audit, surface by surface

Not "make it prettier" — a fixed rubric applied to every surface so the results
are comparable.

For each of: the wall, a post-it, the capture cell, the drawer list, an
expanded save, the readings list, the reflections block, the room switcher, the
time rail, the room title.

1. **Hierarchy** — can a stranger tell in one second what the most important
   thing is? *(The reflections block fails: the AI's question is larger than
   the person's own answer.)*
2. **Voice** — is it obvious which words are the person's and which are the
   machine's? *(Fails in three places.)*
3. **Typographic system** — how many sizes, weights and greys are in play, and
   is the count justified?
4. **Density and rhythm** — at 3, 30 and 300 items.
5. **Motion** — does it explain a relationship or decorate a transition?
6. **Affordance honesty** — does everything clickable look clickable, and
   nothing else?
7. **Naming** — is the same object called the same thing everywhere? *(Fails:
   a reading shows its title in one place and its belief statement in another,
   which confused the founder twice in one night.)*
8. **The exit** — is there always an obvious way back to where you came from?

**Output:** one page per surface, scored, with the three worst offences named.
This is the part that produces a redesign brief rather than opinions.

---

## 4. Precedent study — mechanisms, not moodboards

Look at how other products solve *these specific problems*, and steal the
mechanism rather than the look.

- **Provenance without leaving the claim** — how do research tools, legal
  software and annotated readers show "this is what that rests on" in place?
- **A growing personal archive** — what happens at 600 items in products where
  people genuinely accumulate for years? What replaced browsing?
- **Two voices in one document** — where a machine and a person both write,
  how is authorship made visually unambiguous?
- **Instruments over menus** — dials, rails, scrubbers: when does a control
  with weight beat a list of options? *(The room switcher already commits to
  this and the time rail follows it; is that a principle or a habit?)*
- **Saying one thing forcefully** — products whose main surface is a single
  sentence. What carries it when there is nothing else on screen?
- **Ceremony around a commitment** — how do products make an irreversible or
  intimate act (sharing, joining, publishing) feel weighty rather than
  incidental?

**Output:** six mechanisms, each with the WAKA moment it applies to.

---

## 5. Principles, made explicit

The product already has principles — they are buried in source comments where
no designer will find them. Extract, argue, and write them where they can be
applied:

- *Saving is never gatekept.* A save is the signal; nothing may stand between a
  person and keeping something.
- *A reading dissolves its evidence, never stacks it.*
- *Recency reads as warmth, not obligation.* No badges, no unread counts.
- *Arithmetic proposes, judgement disposes; only decisions become memory.*
- *Nothing is inferred where it can be proven.* A missing highlight beats a
  guessed one.
- *The record never lies about what happened.* Departures stay marked.

Candidates the research should test: *the product may say fewer things than it
knows* · *the machine's words never outrank the person's* · *every claim is
answerable in one move*.

---

## 6. The decisions that are actually stuck

Kept from the first draft, demoted to their proper size.

| # | Decision |
|---|---|
| D1 | Destination or detour — the founder says both, so it serves neither. |
| D2 | Does provenance change trust, or is salience decoration? |
| D3 | What does a person do when a reading is wrong? |
| D4 | What breaks first at 600 saves? |
| D5 | Is the board narrow because the room is narrow — and if so, is the answer *fewer, stronger* readings? |

---

## 7. Method and sequence

**Phase 0 — Instrument (week 1, no users).** You cannot design a sequence you
cannot see. Minimum: where each drawer open came from, search issued vs.
abandoned, salience hovered, rail scrubbed, time from save to first reading.
*Half the questions in this plan stop needing a study once these events exist.*

**Phase 1 — Craft audit (week 1, parallel, no users).** The rubric in §3 across
ten surfaces. Needs nobody's time but a designer's.

**Phase 2 — Six sessions, task-based (week 2).** Not interviews. Watch where
they hesitate: find the Midjourney save · judge whether a reading is true ·
fix one that is wrong · show me what Waka can see of yours · go back to before
Se One joined.

**Phase 3 — The 600-save simulation (week 2, parallel).** Real-shaped material,
re-dated. The only way to test the founder's stated target before a year
passes.

**Phase 4 — Precedent study (week 2).**

**Phase 5 — Redesign the sequence, not the screens (week 3).** Storyboard M1
through M9 as one journey before any single screen is drawn. *Every screen in
this product was designed alone; this is the phase that has never happened.*

---

## What this plan expects to find

Written in advance so it can be disconfirmed.

- **Detour dominates.** Most drawer opens come from a post-it, so the browsing
  UI serves the minority path.
- **The naming is under-designed relative to its importance.** The moment the
  whole product exists for is rendered as one of six equal cards.
- **M3 and M6 — the wait, and being wrong — are where trust is actually lost**,
  and neither has a surface.
- **The room is genuinely narrow**, and the honest design answer is one
  forceful reading rather than six weak ones.
- **Craft debt is concentrated in the joins**, not the screens. Each surface is
  decent alone; the transitions between them are undesigned.

## Non-goals

- A design system. The problem is unserved jobs and undesigned joins, not
  inconsistent buttons.
- Testing with strangers. At six users the material is the point.
- Redesigning any screenshot. No screen is drawn before its moment in the
  journey is agreed.
