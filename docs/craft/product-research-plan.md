# Research plan: what WAKA is for, end to end

Status: proposed 2026-08-03.
Founder answers already locked in: the saves surface serves **four** jobs, it is
**both** a destination and a detour ("and that's the problem"), and the design
target is **hundreds of saves — a year in**, not today's two dozen.

## Why research rather than more redesign

Every surface has been designed by argument. Tonight alone produced three
rebuilds of one rail and two of one list, each replaced before anyone used it.
That is not a craft problem, it is a **missing feedback loop** — there is no
evidence in the system about what anyone does, so taste is the only input and
the last opinion wins.

The goal is not a report. It is: **stop guessing about five specific decisions.**

---

## 1. The product's jobs, end to end

Thirteen, in the order a person meets them. The ones the founder confirmed for
the saves surface are marked ★.

### Capture
- **J1 — Get it out of my head before I lose it.** Zero friction, no
  categorising, no deciding. *Today: strong. The capture cell is the most
  finished thing in the product.*
- **J2 — Keep what I reacted to, not a pointer to it.** A bare link is not the
  thing. *Today: enrichment fixes this, unshipped to production.*

### Being read
- **J3 — Tell me something about myself I could not have said.** The whole
  promise. *Today: the board says one thing five ways; unresolved.*
- **J4 ★ — Show me why you think that.** A reading is a claim about a person;
  it has to be answerable. *Today: salience just shipped, 13% coverage.*
- **J5 — Let me correct you when you are wrong.** *Today: a correction textarea
  exists with nothing opening it. This job has no surface at all.*

### The collection
- **J6 ★ — What have I been saving?** Inventory, no target.
- **J7 ★ — Where is that one thing?** Re-find a half-remembered save. *Today:
  search is a box at the bottom of the screen, below the fold of attention.*
- **J8 — What am I circling that I cannot name?** The pattern nobody asked for.

### Rooms
- **J9 — What are we after together that none of us said alone?** *Today:
  combination reading exists, gate unpassed.*
- **J10 ★ — Control what a room can see of me.** Per-signal sharing with no
  surface that answers "what are they reading of mine?"
- **J11 — Find people whose hearts beat with mine.** Deferred, and the reason
  the rest exists.

### Time
- **J12 — See how we got here.** *Today: the rail, shipped tonight.*
- **J13 — Watch a reading turn because someone arrived.** The thesis on the
  time axis. *Today: the hinge exists; nothing triggers a re-read on join, so
  it may sit at a moment where nothing happened.*

**The map's own finding:** J5 has no surface, J10 has no surface, and J7's
surface is a search box placed where nobody looks. Three of thirteen jobs are
unserved before any user is asked anything.

---

## 2. The five decisions this research exists to settle

Everything below is scoped to answering these. Anything that does not move one
of them is not in the plan.

| # | Decision | Why it is stuck |
|---|---|---|
| D1 | Is the saves surface a destination or a detour? | The founder says both, which is why it serves neither. Needs behaviour, not opinion. |
| D2 | Does provenance change trust? | Salience shipped on a belief. If seeing the words does not change how a reading lands, it is decoration. |
| D3 | What does a person do when a reading is wrong? | Nobody knows, because there is nowhere to do it. |
| D4 | What breaks first at 600 saves? | The design target is a year in; nothing has ever been tested past 24. |
| D5 | Is the board narrow because the room is narrow? | Three algorithmic explanations tested and rejected. The remaining answer may be about people, not code. |

---

## 3. Method, sized to six users

There are six real users and years of their real material. That rules out
surveys and rules **in** depth. Four instruments, in order.

### Phase 0 — Instrument the product (week 1, no users involved)

You cannot research a product that records nothing. Today there is no way to
answer "did anyone open the drawer on purpose."

Minimum events: capture started/saved (and elapsed), drawer opened **and from
where**, search issued + result chosen or abandoned, save expanded, reading
expanded, salience mark hovered, rail scrubbed, refresh pressed, room switched.

**Gate:** you can answer D1 from data alone within a week of use.

*This phase is also the cheapest lever in the whole plan. Half these questions
stop needing a study once the events exist.*

### Phase 1 — Four sessions, 45 minutes, task-based (week 2)

The four founders plus the two other members. Not interviews — **tasks**, and
watch where they hesitate.

1. *"Find the save about the Midjourney spa."* → D1, D7-ish: do they search,
   scroll, or go via a post-it?
2. *"This top-of-mind says X about you. Is it right?"* → D2. Do they look for
   evidence unprompted? Does the highlight change the answer?
3. *"Here is a reading you think is wrong. Fix it."* → D3. Watch them fail, and
   watch *what they try* — that is the design.
4. *"Show me what Waka can see of your saves."* → J10. Time how long, or watch
   them give up.
5. *"Scrub the room back to before Se One joined."* → J12/J13.

**Recorded, not summarised.** Founder-led is fine at this N; the bias risk is
lower than the cost of a stranger who does not know the material.

### Phase 2 — The scale simulation (week 2, parallel)

Generate 600 saves for one account from real-shaped material — the founders'
own text, shuffled and re-dated. Then run the same five tasks.

This is the only way to answer D4 before a year passes, and it needs no users.
Expect: scanning dies, the search box's position becomes the product's biggest
usability bug, and the reading list on a save becomes unusable at 40 readings.

### Phase 3 — Corpus audit for D5 (week 3)

Not a UX method. Read all 63 shared signals with the four members and ask each:
*"Are these three or four different interests, or one?"* If the room says one,
the board is correct and the product's honest output is fewer, stronger
readings — which is a design brief, not a bug.

---

## 4. What the plan expects to find

Written down in advance so the research can disconfirm rather than confirm.

- **D1 → detour dominates.** Most drawer opens will come from a post-it. If so,
  the browsing UI is serving a minority path and the design should invert:
  continuity from the reading, with search as the escape hatch for J7.
- **D2 → provenance matters most where the claim is uncomfortable.** People
  will look for evidence when a reading is *nearly* right, not when it is
  obviously right or obviously wrong.
- **D3 → people will try to edit the save, not the reading.** The correction
  affordance probably belongs on the evidence, not on the note.
- **D4 → the search box's position breaks first**, well before pagination or
  performance.
- **D5 → the room is genuinely narrow right now**, and the product needs to say
  so honestly rather than manufacture six readings from one idea.

---

## 5. Known craft debts, to fix regardless of what research says

These do not need a study. They are inconsistencies, and they cost trust every
time someone notices.

- **A reading has two names.** The wall shows the belief statement; every other
  surface shows the title. The same reading is two different sentences
  depending on where you meet it — the founder has been confused by this twice
  in one night.
- **The reflections block has no hierarchy.** The AI's question is large and
  the person's own answer is small. The artifact should lead; the scaffolding
  should recede.
- **`delete` sits at the weight of a timestamp**, three times down one column.
- **One timestamp repeated per row** where a single header would do.
- **The room switcher is undiscoverable** — its own source comment says nobody
  found it, and it is still a strip of text at the left edge.
- **The bottom bar does not know what you are doing.** It changes for editing
  and undo, but not for the expanded save that fills the screen.

---

## Non-goals

- A design system. The problem is not inconsistent components, it is unserved
  jobs and no feedback loop.
- Testing with strangers. At six users the material is the point; a stranger
  would be evaluating a memory product with none of their own memory in it.
- Redesigning a screenshot. Every screen in this plan is downstream of a job,
  and no screen gets redesigned before its job is confirmed.
