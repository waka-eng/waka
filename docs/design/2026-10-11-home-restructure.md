# The home restructure — research, brainstorm, decision

**2026-10-11.** Written before implementation, so the reasoning can be audited
after it.

Founder, on the design this replaces: *"I hate the current experience of how
your inspirations or claims your top of mind your principles are shown like
below the agent. your claims are duplicated so that's like even bad... It's a
horrible design, a horrible user experience, information hierarchy, workflow.
It's just absolutely horrendous in a UX designer's perspective."* And: *"I need
some dramatic changes to the information hierarchy and like, interaction and
workflow. Don't just like, change some font and placement subtly."*

---

## 1. What six research tracks found

Six parallel tracks: derived-insight IA, answer-queue patterns, capture bars,
companion screens, end-to-end teardowns of six products, and empty/early
states. Convergent findings, each verified across more than one product.

**C1. Exactly one derived object on home. Six for six.** Oura shows Readiness.
Whoop shows Recovery. Finch shows the pet's state. Readwise shows one review
card. Day One shows one opening prompt. Wrapped shows one slide. Not one of
the six stacks even two derived layers. WAKA stacks four.

**C2. Evidence lives one level down, never beside.** Oura's nine contributors
sit behind a tap on the score; Readwise puts "Referenced Highlights" below the
answer; Spotify's method is a separate page. A claim and its proof on the same
plane reads as hedging and doubles the screen.

**C3. Raw material is a destination. It never greets the user.**

**C4. Derived claims arrive as dismissible EVENTS, not residents.** Oura
Discoveries appear as a card on Today, can be dismissed, and stay retrievable.
This is what keeps a home screen one screen tall without deleting anything.

**C5. A queue has exactly ONE surface where an item is answerable.** Other
surfaces may advertise that the queue exists; they must never render an
answerable item. GitHub's badge carries zero item content. Anki shows load on
the deck screen and never renders a card there. Linear's Priority/Other is a
partition, not two copies. YouTube's second surface holds *already-given*
feedback — a history, not a second queue.

**C6. Sessions are finite and end on a gift.** Readwise ends on a Bonus
Highlight; Finch's pet returns with a story. Never a "you're done" screen.

**C7. Conversation is never the home surface** — not in one of the six,
including the three whose derived layer is entirely LLM-driven.

**C8. Capture is on home, one tap, never gated** — and never hides its
destinations behind focus. Composers grow with CONTENT, never with focus.

**C9. States, not numerals.** Oura rates contributors *pay attention / fair /
good / optimal*. Whoop's Healthspan says *lower / higher / on pace*. Readwise's
iOS badge "will never be a number larger than one." Four independent products
converged on the constraint this product already holds.

**C10. A reserved blank slot is the one option no design system recommends.**
Carbon: *"Empty states should replace the element that would ordinarily show."*
The CLS literature that justifies reserving space scopes it to *"a network
request that may take a while to complete"* — milliseconds, not weeks.

---

## 2. The finding that reframes the product

**WAKA sits in an empty quadrant.**

| | passive input | authored input |
|---|---|---|
| **asserts claims about you** | Oura, Whoop, Spotify | **nobody — this is WAKA** |
| **refuses to assert** | — | Day One, Readwise |

Products that assert identity claims all run on data the user did not author.
A wrong claim reads as a sensor quirk.

Products running on voluntarily authored personal text REFUSE to assert
anything about the person. Day One built Multi-Entry Summary — structurally
WAKA's top of mind — and deliberately aimed it at the entries rather than the
author. It keeps a private model of you and, verbatim: *"Reviewing or deleting
individual memories isn't available."*

A wrong claim about text you deliberately wrote is not a quirk. It is being
misread.

**Therefore: Yes / Partly / Not true is not a feature among features. It is
what earns WAKA the right to assert at all.** Spotify needed a published
methodology page to survive being wrong once a year. WAKA will be wrong weekly,
about authored text. Every product in the set asserts; not one lets the user
say "you misread me." That gap is the entire differentiation — and today it is
buried below the creature, in the least prominent block on the screen.

---

## 3. What is wrong today, stated structurally

**W1. Four layers on one screen.** Top of mind (top), creature, one claim
(below), capture (bottom), plus a switcher naming four destinations. Violates
C1 four times over.

**W2. The hierarchy is inverted against the data's own timeline.** Claims draw
from `active` AND `emerging` signals, and a signal is born emerging on the
FIRST capture. The top of mind needs `active` — three pieces of evidence.

| | exists from | current home gives it |
|---|---|---|
| a claim | the first save | secondary, below the creature |
| top of mind | ~3 saves on one theme | the hero |
| principles | weeks | a destination |

The screen leads with the thing that takes longest to exist and buries the
thing available on day one.

**W3. Claims are answerable in two places.** Violates C5. Structural, not
cosmetic — there is no copy fix.

**W4. Two blank reserves hold holes open for ~10 days.** `home.css:263` and
`claims.css:2312`. They exist because the creature's vertical position is
computed from the height of the blocks around it, and the founder's rule — *"so
changing between me and my agent doesn't change position"* — was implemented as
a LIFETIME invariant rather than a WITHIN-SESSION one. Nobody asked for the
lifetime rule and nobody can perceive it: there is no session in which a person
sees both day 1 and day 30. The code already names the symptom: *"The result
reads as a screen with a hole in the lower third."*

**W5. The loop is invisible.** Answering a claim changes the top of mind, and
nothing on screen ever shows that happening. The one mechanic that earns the
product its licence produces no visible consequence.

**W6. 13 surfaces, 4 navigation controls.** `/days` — a built surface — has no
entry point anywhere in the UI.

---

## 4. Brainstorm — five structures considered

### A. "Today" (the Oura skeleton)
One home. One derived object. Claims arrive as dismissible cards. Upper-left
reaches the past, lower-right acts. Everything else is a destination.
*Strength:* the only verified structure that holds four layers at this cadence.
*Weakness:* on its own it does not make the loop visible (W5). Oura's own
failure is instructive — it fixed its home and then grew five more homes
behind it, producing "substantial UI redundancy."

### B. "The session" (the Readwise skeleton)
Home IS a finite review session: open, answer what is asked, end on a terminal
card. *Strength:* best mechanic for expensive judgements; gives the loop a
shape. *Weakness:* a product whose home is a chore queue has nothing to show
somebody who just wants to look at their own reading.

### C. "The wall"
Home is only the top of mind — a statement you live with. Everything else
behind one menu. *Strength:* maximal calm, strongest C1 compliance.
*Weakness:* the correction channel disappears from the surface entirely, which
inverts §2. Rejected.

### D. "Capture-first"
Home is the box; everything derived is a destination. *Strength:* honours the
no-gatekeeping ruling absolutely. *Weakness:* the product stops saying anything
about you on the screen everyone starts on. Rejected.

### E. **"One thing at a time, and the creature decides which"** ← chosen
A synthesis of A and B. Home holds exactly one object. Which object it is, is
chosen by state, by the creature, in priority order. Answering runs a finite
session in place, and the session ends by showing what the answers changed.

### Why E

It is the only option that satisfies C1 (one object) *and* C5 (one answerable
surface) *and* C6 (finite session, terminal gift) *and* fixes W5 — the loop
becomes visible because the session's last beat IS the consequence.

It also inverts W2 at no cost: when a claim exists it leads, and a claim exists
from the first save. The thing available on day one becomes the thing the
screen leads with, and the top of mind takes the stage once it has earned one.

---

## 5. The design

### 5.1 Home is one object, chosen by state

In priority order, home shows exactly ONE of:

1. **A claim**, when one is waiting. The creature asks it. Statement, three
   answers, and a dim line naming what it was read from (one tap down).
   **This is the only place in the product a claim can be answered.**
2. **The top of mind**, when no claim waits and a reading exists. Largest type
   on the screen, the only element at full light, with the same dim
   provenance line beneath it.
3. **The creature's own line**, when neither exists. Day one. No reserves, no
   labels, no empty frames.

Never two. The capture bar and the creature are the only permanent residents.

### 5.2 Answering runs a session in place, ending on the consequence

Answer a claim and the next takes its place — up to **three per sitting**,
which is the cap the research argues for: claims are expensive, quality of
answer degrades fast, and bad answers poison every downstream layer.

The session's last beat is not "done". It is **the top of mind, rewritten from
what you just answered**, with a line naming that it changed. The user watches
their own input move the product's view of them, in the same sitting.

This is C6's terminal gift, and it is the strongest move available to this
product specifically: the outputs are written from the answers, so the
consequence is always available and always specific.

### 5.3 The claims room becomes what you have answered

Per C5. Unanswered claims live with the creature and nowhere else. The room
holds **answered** claims, each wearing the answer given, each re-openable to
change it. It becomes the correction channel's archive and the evidence trail
for how the top of mind got written — and it gains a reason to visit that is
not guilt.

### 5.4 The reserves collapse — invariance per epoch, not per lifetime

The founder's rule is honoured exactly as stated: within a session, switching
between me and my agent must not move the creature. That requires a reserve
only when occupancy VARIES across the faces you can switch between right now.

- No face has a reading or a claim → zero variance → collapse both reserves.
- A face has a claim and an agent structurally cannot → variance is real →
  reserve, as today.

The creature sits higher on day one than on day thirty, and never moves during
either session. The complaint that produced the rule cannot recur, because it
was about switching faces, not about weeks.

### 5.5 Evidence one tap down

Per C2. The provenance line under the statement names what it was read from in
words, and opens the saves. Nothing is printed beside the claim.

---

## 6. What this deletes

Deliberately, because Oura's failure mode is fixing the home screen and
growing the old surfaces behind it:

- the top of mind and the claim appearing together — ever
- the second answerable claim surface
- both blank reserves on day one
- the top-of-mind label standing over a sentence about its own absence

---

## 7. Not in this pass, and why

- **Principles born as an arriving card.** The right design (C4), but it needs
  server-side support for "this has held long enough" and is a larger change
  than one night can carry safely.
- **`/days` entry point.** A real orphan, but adding a fifth destination while
  this pass is removing vocabulary would fight itself. It wants deciding, not
  smuggling.
- **Capture copy.** The research says a placeholder should name ONE purpose,
  not enumerate two, and the right-hand labels are heavy. That is the
  two-destinations question and it deserves its own pass.

---

## 8. The measured defect underneath all of it

Found by the companion-screens track, by replicating the layout pass
numerically against the real constants.

**The founder's ruling is already violated in code.** `companion.y` is computed
from the LIVE heights of the blocks around the creature — `hqH` (the poster,
`Home.tsx:5955`) and `voiceH` (the claim, `Home.tsx:6047`) — so the creature
drifts with content today:

| change | creature moves |
|---|---|
| top of mind grows to 5 lines | **+38px down** |
| top of mind grows to 7 lines | **+75px down** |
| claim wraps to 3 lines | −12px up |
| pressing "Not true" (the correction field opens) | **−19px up** |

75px is 62% of the creature's own 120px body, and the last row is the worst: a
normal press in the main loop moves the character.

**So the reserves were never the design — they were a patch over this.** The
`min-height` on `.jar-char-say` exists only because `voiceH` is in the
equation. Take the content out of the equation and the reserve has no job.

**And the void is unbounded by construction.** `companion.y = (lo + hi) / 2` is
"the middle of what is left", so every pixel of extra viewport height is split
evenly into the two gaps, forever:

| viewport | upper void | lower void | share of screen that is void |
|---|---|---|---|
| iPhone 15 Pro (760) | 128px | 78px | 27% |
| MacBook Pro 14" (890) | 173px | 123px | **33%** |
| iPad Pro 11" (1100) | 298px | 248px | **50%** |
| 27" 1440p (1330) | 392px | 342px | **55%** |

`home.css:236` caps the column at `max-width: 680px`. **There is no vertical
equivalent anywhere.** That is the whole bug in one sentence.

Three findings decide the shape of the fix:

- **Equal spacing is anti-hierarchy by definition.** Gestalt proximity: *"elements
  separated by whitespace are perceived as being less related."* Two equal
  400px voids dissolve the relationship between statement, creature and box, so
  the three stop reading as one composition. That is the founder's
  "information hierarchy" complaint, and it is the direct mathematical
  consequence of the Oct 8 instruction "equal space between the three things" —
  an instruction that is right on a phone, where there is no surplus, and
  wrong on a desktop, where it has no upper bound.
- **The vertical middle is not the attention centre.** NN/g: more than 65% of
  above-fold viewing time lands in the **top half** of the viewport. Centring
  the creature at 50% of a tall window is not neutral — it is a demotion.
- **Google solves exactly this in production CSS**: clamp the BAND, not the
  element; make every band `flex-shrink: 0` with exactly ONE `flex-grow: 1`
  sink, so surplus goes to one declared place instead of two accidental
  voids; and anchor each band so its content grows INWARD, toward the focal
  element, never away from it.

### The fix, in dependency order

1. **`companion.y` becomes a function of viewport height only** —
   `clamp(Y_MIN, view.h * 0.34, Y_MAX)`. Zero drift for any statement length,
   any claim length, and for pressing "Not true". Above roughly 1235px of
   viewport it stops descending: the vertical twin of `max-width: 680px`.
2. **Both reserves are deleted**, because nothing reads them any more.
3. **The bands anchor inward** — the statement grows down toward the creature,
   the box grows up toward it — so one bounded void sits below the cluster
   instead of two unbounded ones around it.

This honours the Oct 8 instruction's intent ("things feel so skewed to the
bottom") while discarding the literal implementation, which has no cap.
