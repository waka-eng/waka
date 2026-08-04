# The post-it, taken seriously

Status: proposed 2026-08-03. Supersedes the wall sections of
`from-scratch.md`. Nothing here is built.

---

## The thesis

**WAKA has post-it skin and no post-it mechanics.**

What the product borrowed: paper texture, a degree of tilt, pastel colour, a
soft drop shadow. That is the *look* of a post-it.

What it did not borrow — and this is the whole of what a post-it actually is:

- you cannot peel one off
- pushing two together does nothing
- they never age, curl, or fall
- they stick to nothing; they float on a background
- where one sits means nothing
- colour means array index
- there is no hand that wrote it

Every redesign of this wall has been a redesign of the *skin* — bigger type,
flatter cards, no cards, different colour. That is why each one felt like
either decoration or subtraction. **The post-it was never the problem, and it
was never being used.**

---

## The distinction everything depends on

A post-it is not content. A post-it is **a provisional claim, stuck to
something real.** Two objects, not one:

| | what it is | is it a post-it? |
|---|---|---|
| **a save** | your material — the article, the thought, the thing that moved you | **no.** It's the page. |
| **a reading** | the machine's guess about what your material means | **yes.** |

A reading sticks to a surface. Which surface it sticks to is what it is about:

- stuck **to the wall** → a claim about the room
- stuck **to a save** → *this is the passage that carried it*

That second case is salience. It has been designed twice as a "highlight" and
both times it read as stray emphasis. It is not a highlight. **It is a post-it
flagging a passage in a book**, which is the single most ordinary thing anyone
has ever done with one. Same object, two surfaces — no second concept needed.

---

## The eight mechanics, and the job each one does

### 1. Peel → correction · **J6**

Peel it off. It's gone.

This is the most trust-critical job in the product, it has **no surface at
all** today, and the vocabulary already contains the perfect gesture for it. A
correction `<textarea>` sits in the code with nothing that opens it — a form,
for an act that wants to be one movement of the hand.

Where does a peeled post-it go? **Not deleted.** It goes into the record as
*the room said this and you took it down*, which is material the next pass
reads. Correction that changes nothing teaches you the product isn't
listening.

### 2. Cluster → the naming · **J1**

Push two post-its together. You have just said *these are the same thing* —
without a form, a tag, or a menu.

Affinity mapping is the oldest sensemaking ritual there is, it is what people
already do with post-its unprompted, and it is **exactly the payoff this
product is for**. The founder's account of the moment: *"what I'd been calling
'fun' for three years was that ambition trying to be seen."* That is a person
naming a cluster.

The interaction: you push two together, the machine offers a name for the
pair, you accept it or write your own over it. *Arithmetic proposes, judgement
disposes* — the principle is already in the codebase, buried in a source
comment.

Two things fall out of this for free:

- **It is the highest-quality signal the product could collect**, and it costs
  the user nothing, because it is the thing they'd do with post-its anyway.
- It resolves the board-collapse investigation from the other side. Five
  readings that all say one thing is a *failure* when the machine has to pick
  six. It is a *cluster* when you can push them together and name what they
  share.

**This is the riskiest idea here** — it is the only mechanic that asks the
person to do something. It earns the risk by being the only one that makes the
payoff a moment they participate in rather than read.

### 3. Write over → correction, softer · **J6**

Cross out its words, write yours. The reading keeps its evidence and its
history; the sentence becomes yours. Half-built already.

### 4. Stick to a save → salience · **J5**

Opening a save shows the post-its stuck to it, on the passages they came from.
The claim and the evidence are the same object seen from the other side, so
"is that true?" stops being a four-click journey to a different screen.

### 5. Size is a hard limit → precision · **J1**

A post-it physically cannot hold a paragraph. Write too much and it doesn't
fit, and everyone can see it doesn't fit.

The founder's rule — a top-of-mind must *dissolve* its saves into one
observation, not stack three summaries — is currently enforced by a length
budget in a prompt. Make it physical instead. **A reading that overflows its
post-it is visibly a reading that failed to say one thing.**

### 6. Age → the wall that evolves · **J3**

Adhesive weakens. A reading that stops being reconfirmed goes soft, curls, and
eventually comes off — into the record, never into nothing.

This is the honest rendering of `reconfirmedNoteIds`, which the pipeline
already computes every pass and throws away. And it gives *"the top of mind not
shifting is itself signal"* a physical form: a post-it that has been on the
wall for three weeks, faded, and is still firmly stuck.

Nothing here dims by *position*. The fourth reading is not weaker; it is fourth
in an array. Fading is earned by time and by failing to be reconfirmed, and by
nothing else.

### 7. Position is yours → why readings stand equal

The machine puts them up in no order. Where they sit is what **you** decided.
Drag persists.

This is the argument for readings standing equal that I couldn't make earlier:
on a real wall, rank is the reader's to assign, and a machine that arranges
your wall for you is claiming an authority it hasn't got.

### 8. Whose hand → rooms and people · **J2**

Colour means whose hearts a reading rests between — never position. A room is
a different wall, not a tab: the same material, re-read in a different room,
with different hands on it.

---

## What the product becomes

**Two surfaces. No third.**

- **A wall** — a room's wall of post-its. Yours is a wall of one.
- **A save** — a page, with the post-its that cite it stuck to their passages.

And **one object** — the post-it — which you can peel, cluster, write over,
move, and watch age, on either surface.

Every screen currently in the product that is neither of these is a symptom:
the drawer is a wall pretending to be a list, the readings section is a
disclosure toggle standing in for post-its stuck to a page, and the reflections
thread is a conversation with nowhere to live.

---

## What this costs

Honest accounting, because "trash everything" is expensive and some of it
shouldn't be trashed:

**Survives intact:** capture and enrichment · the judge and its evidence
contract · quote verification (`salience.ts` — refusing what can't be proven is
the right stance and the mechanic depends on it) · the time rail · the room
timeline · everything agikee and q00 built underneath.

**Gets replaced:** the wall's rendering, the expanded save's eight stacked
sections, the drawer as a list, the readings disclosure toggle, `TARGET_NOTES`
as a fill target.

**Genuinely new:** peel · cluster-and-name · persisted position · ageing ·
post-its rendered on a save's passages.

**The hard part is not the front end.** Clustering needs somewhere to store a
user-made grouping and its name, and the next synthesis pass has to read them
or the gesture is theatre. Peel needs the same. That is the real work, and it
is the work that would make the product listen.

---

## The order I'd build it

1. **Peel.** Smallest, and it's the missing trust-critical job. One gesture,
   one table, one thing the next pass reads.
2. **Post-its on a save.** Turns the salience work already done into the thing
   it should have been, and kills the readings toggle.
3. **Size as a hard limit.** Nearly free, and it enforces the precision
   principle physically.
4. **Ageing.** Renders data already computed and thrown away.
5. **Cluster and name.** The biggest bet, and worth doing last — by then the
   wall behaves like a wall, and pushing two together is the obvious next thing
   to try.
